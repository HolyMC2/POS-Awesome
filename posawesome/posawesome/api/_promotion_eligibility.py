"""Verify zero-price promotions against server offers and ERPNext pricing rules."""

import math

import frappe
from frappe.utils import flt


def _get(row, key, default=None):
    return row.get(key, default)


def _quantity(row):
    return abs(flt(_get(row, "qty")))


def _giveaway(row):
    return bool(flt(_get(row, "is_free_item")) or flt(_get(row, "posa_is_offer")))


def _zero_price(offer, price, default_free=False):
    kind = offer.get("discount_type")
    if not kind:
        return default_free
    return (
        (kind == "Discount Percentage" and flt(offer.get("discount_percentage")) == 100)
        or (kind == "Discount Amount" and price > 0 and abs(flt(offer.get("discount_amount")) - price) < 0.001)
        or (kind == "Rate" and flt(offer.get("rate")) == 0)
    )


def _matches(offer, row, metadata):
    scope = offer.get("apply_on") or offer.get("apply_type")
    code = _get(row, "item_code")
    item = metadata.get(code, {})
    if scope == "Transaction":
        return True
    if scope == "Item Code":
        return code == (offer.get("item") or offer.get("apply_item_code"))
    if scope == "Item Group":
        target = offer.get("item_group") or offer.get("apply_item_group")
        return bool(target) and item.get("item_group") == target
    if scope == "Brand":
        return bool(offer.get("brand")) and item.get("brand") == offer.get("brand")
    return False


def _item_group_scope(group):
    """The group and its descendants, as ERPNext pricing rules apply them.

    An unreadable tree narrows the scope to the exact group; it never widens it.
    """
    scope = {group}
    try:
        scope.update(frappe.db.get_descendants("Item Group", group) or [])
    except Exception:
        frappe.log_error(frappe.get_traceback(), "POSAwesome gift item group lookup")
    return scope


def _group_gift_codes(offer, candidates, metadata, prices):
    """Item codes a Give Product offer lets the cashier pick from its item group.

    The offer names ``apply_item_group`` instead of one item, so a gift is
    authorized by server metadata: the item's group, its price below
    ``less_then`` when that ceiling is set, and the offer's own price rule.
    Every zero-price row of a code must qualify for the code to qualify.
    """
    group = offer.get("apply_item_group")
    if not group:
        return set()
    scope = _item_group_scope(group)
    ceiling = flt(offer.get("less_then"))
    verdicts = {}
    for row in candidates:
        code = _get(row, "item_code")
        price = prices.get(id(row), 0)
        fits = (
            metadata.get(code, {}).get("item_group") in scope
            and (ceiling <= 0 or 0 < price < ceiling)
            and _zero_price(offer, price, default_free=True)
        )
        verdicts[code] = verdicts.get(code, True) and fits
    return {code for code, fits in verdicts.items() if code and fits}


def _coupon_allowed(offer, invoice):
    if not flt(offer.get("coupon_based")):
        return True
    from posawesome.posawesome.doctype.pos_coupon.pos_coupon import check_coupon_code

    for row in _get(invoice, "posa_coupons", []) or []:
        code = _get(row, "coupon_code")
        if not code:
            continue
        result = check_coupon_code(code, _get(invoice, "customer"), _get(invoice, "company"))
        coupon = result.get("coupon")
        if coupon and coupon.get("pos_offer") == offer.get("name"):
            return True
    return False


def _returned_free_lines(invoice, candidates):
    """A returned gift keeps the original price even after its offer expires."""
    doctype = _get(invoice, "doctype")
    if doctype not in ("Sales Invoice", "POS Invoice") or not _get(invoice, "return_against"):
        return set()
    original = frappe.get_doc(doctype, _get(invoice, "return_against"))
    if (int(_get(original, "docstatus") or 0) != 1
            or _get(original, "company") != _get(invoice, "company")
            or _get(original, "customer") != _get(invoice, "customer")):
        return set()
    budgets = {}
    for row in _get(original, "items", []) or []:
        if flt(_get(row, "rate")) == 0:
            code = _get(row, "item_code")
            budgets[code] = budgets.get(code, 0) + _quantity(row)
    allowed = set()
    for code, budget in budgets.items():
        rows = [row for row in candidates if _get(row, "item_code") == code]
        if sum(_quantity(row) for row in rows) <= budget + 0.000001:
            allowed.update(id(row) for row in rows)
    return allowed


def eligible_free_lines(invoice, profile, price_list):
    """Return object identities of lines whose entire quantity is authorized.

    Never persist/cache this decision on the client-updatable Document. Each
    guard evaluates its current cart; errors deny an exemption.
    """
    lines = list(_get(invoice, "items", []) or [])
    candidates = [row for row in lines if flt(_get(row, "rate")) == 0 and _quantity(row) > 0]
    if _get(invoice, "is_return"):
        return _returned_free_lines(invoice, candidates)
    if not candidates or not price_list:
        return set()
    name = _get(profile, "name") or _get(invoice, "pos_profile")
    if not name:
        return set()
    codes = list({_get(row, "item_code") for row in lines if _get(row, "item_code")})
    metadata = {row.get("item_code"): row for row in frappe.get_all(
        "Item", filters={"item_code": ["in", codes]}, fields=["item_code", "item_group", "brand"]
    )}
    from posawesome.posawesome.api.pricing_context import reference_rate_lookup

    reference_rate = reference_rate_lookup(invoice, price_list)
    prices = {id(row): flt(reference_rate(row)) for row in lines}
    allowed = set()
    budgets = {}
    # Item-group gifts: one quantity allowance shared by every code the offer
    # lets the cashier pick, instead of a per-code budget.
    group_pools = []

    from posawesome.posawesome.api.offers import get_offers

    for offer in get_offers(name) or []:
        # Flattened scheme rows omit some party restrictions. Let ERPNext
        # evaluate those rules with the full customer context below.
        if offer.get("promo_source") == "Promotional Scheme":
            continue
        if offer.get("offer") not in ("Give Product", "Item Price"):
            continue
        # Give-product eligibility must come from purchased rows, never from
        # the zero-price giveaway itself. Item-price offers include their own
        # discounted row when evaluating a quantity threshold.
        qualifying = [row for row in lines if not _giveaway(row)
                      and (offer.get("offer") == "Item Price" or flt(_get(row, "rate")) > 0)
                      and _matches(offer, row, metadata)]
        qty = sum(_quantity(row) for row in qualifying)
        amount = sum(_quantity(row) * prices.get(id(row), 0) for row in qualifying)
        if not qty or not _coupon_allowed(offer, invoice):
            continue
        if any(value < flt(offer.get(minimum)) or
               (flt(offer.get(maximum)) > 0 and value > flt(offer.get(maximum)))
               for value, minimum, maximum in ((qty, "min_qty", "max_qty"), (amount, "min_amt", "max_amt"))):
            continue
        if offer.get("offer") == "Item Price":
            for row in qualifying:
                price = prices.get(id(row), 0)
                if _zero_price(offer, price) and row in candidates:
                    allowed.add(id(row))
            continue
        budget = flt(offer.get("given_qty") or 1)
        if flt(offer.get("is_recursive")):
            factor = max(qty - flt(offer.get("apply_recursion_over")), 0) / (flt(offer.get("recurse_for")) or 1)
            budget *= math.floor(factor) if flt(offer.get("round_free_qty")) else factor
        if budget <= 0:
            continue
        if offer.get("replace_item"):
            give_code = offer.get("item") or offer.get("apply_item_code")
        elif offer.get("replace_cheapest_item"):
            give_code = _get(min(qualifying, key=lambda row: prices.get(id(row), 0)), "item_code")
        elif offer.get("apply_type") == "Item Group":
            codes = _group_gift_codes(offer, candidates, metadata, prices)
            if codes:
                group_pools.append({"codes": codes, "remaining": budget})
            continue
        else:
            give_code = offer.get("give_item") or offer.get("apply_item_code")
        given_rows = [row for row in candidates if _get(row, "item_code") == give_code]
        if give_code and given_rows and all(
            _zero_price(offer, prices.get(id(row), 0), default_free=True) for row in given_rows
        ):
            budgets[give_code] = budgets.get(give_code, 0) + budget

    # Reuse the normal ERPNext reconciliation path, but build the complete
    # context from server metadata and remove all client rule/rate claims.
    unresolved = [row for row in candidates if id(row) not in allowed]
    if any(sum(_quantity(other) for other in unresolved if _get(other, "item_code") == _get(row, "item_code"))
           > budgets.get(_get(row, "item_code"), 0) for row in unresolved):
        from posawesome.posawesome.api.pricing_rules import reconcile_line_prices

        customer = _get(invoice, "customer")
        context = {
            "company": _get(invoice, "company"), "customer": customer,
            "customer_group": frappe.db.get_value("Customer", customer, "customer_group") if customer else None,
            "territory": frappe.db.get_value("Customer", customer, "territory") if customer else None,
            "currency": _get(invoice, "currency"), "price_list": price_list,
            "conversion_rate": _get(invoice, "conversion_rate") or 1,
        }
        pricing_lines = []
        by_key = {}
        for index, row in enumerate(lines):
            if _giveaway(row):
                continue
            code = _get(row, "item_code")
            key = str(index)
            by_key[key] = row
            pricing_lines.append({
                "posa_row_id": key, "item_code": code, "qty": _quantity(row),
                "conversion_factor": _get(row, "conversion_factor") or 1,
                "uom": _get(row, "uom"), "warehouse": _get(row, "warehouse"),
                "rate": prices.get(id(row), 0), "price_list_rate": prices.get(id(row), 0),
                "item_group": metadata.get(code, {}).get("item_group"),
                "brand": metadata.get(code, {}).get("brand"),
            })
        result = reconcile_line_prices({"context": context, "lines": pricing_lines})
        for update in result.get("updates", []):
            row = by_key.get(str(update.get("row_id")))
            if row is not None and update.get("pricing_rules") and update.get("rate") is not None and flt(update.get("rate")) == 0:
                allowed.add(id(row))
        for free in result.get("free_lines", []):
            if flt(free.get("rate")) == 0 and free.get("pricing_rules"):
                code = free.get("item_code")
                budgets[code] = budgets.get(code, 0) + max(flt(free.get("qty")), 0)

    # Aggregate all giveaway quantities before granting any line: splitting a
    # gift into several rows must not multiply the offer's quantity allowance.
    # A code spends its own budget first; the rest must fit the remaining
    # allowance of item-group offers that list the code, or no row is granted.
    pending = [row for row in candidates if id(row) not in allowed]
    for code in dict.fromkeys(_get(row, "item_code") for row in pending):
        rows = [row for row in pending if _get(row, "item_code") == code]
        need = sum(_quantity(row) for row in rows) - budgets.get(code, 0)
        if need > 0.000001:
            pools = [pool for pool in group_pools if code in pool["codes"]]
            if sum(pool["remaining"] for pool in pools) + 0.000001 < need:
                continue
            for pool in pools:
                spent = min(pool["remaining"], need)
                pool["remaining"] -= spent
                need -= spent
        allowed.update(id(row) for row in rows)
    return allowed
