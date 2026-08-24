"""Server-side invariants for invoice updates.

Spec: REVIEW2/03_security.md §3.3 — payment-surface tampering window.

The client builds the invoice JSON in the SPA, including rates, taxes,
discount, and payments. Without server-side invariants, a malicious
cashier can submit any invoice for any amount because
``set_missing_values`` blesses client rates (especially when
``ignore_pricing_rule = 1``).

This module provides three invariants called from ``update_invoice`` /
``submit_invoice`` AFTER the scope assertions in ``_scope.py``:

  * ``enforce_discount_limit(invoice_doc, profile_doc)``
      Cap per-item percentage or fixed-amount discount against
      ``Item.max_discount`` and the POS Profile's
      ``posa_max_discount_allowed`` (if present).

  * ``assert_payments_match_grand_total(invoice_doc)``
      Sum of ``payments[].amount`` must equal ``grand_total`` within a
      tolerance derived from the invoice currency's smallest unit.
      Catches the "client tells the server $0 due, then submits $1000
      worth of items" attack.

  * ``assert_rates_within_band(invoice_doc, profile_doc, ...)``
      If the POS Profile's ``posa_allow_user_to_edit_rate`` is OFF,
      every line's declared pre-discount ``price_list_rate`` must match
      the Item Price for the profile's price list, and ``rate`` must be
      exactly that price with the line's declared discount applied
      (offers/pricing rules are not rate edits). If ON, the typed price
      must stay within ±``posa_max_rate_change_pct`` of the Item Price,
      unless the item (or its Item Group) carries
      ``posa_skip_rate_band``.

Full re-fetch + recompute (``reprice_invoice_items``) is intentionally
deferred to a follow-up commit gated by ``posa_server_side_reprice``
flag — changing every invoice's math in a single drop is too risky for
mid-shift cashiers without a soak window.
"""

from __future__ import annotations

from typing import Any, Iterable

import frappe
from frappe import _
from frappe.utils import flt


# ---------------------------------------------------------------------------
# tolerances
# ---------------------------------------------------------------------------

# Default rate-band when posa_allow_user_to_edit_rate is on. ±20% covers
# manager-approved price adjustments without letting a fat-fingered 4000
# through where 400 was meant. Per-register override lives on the POS
# Profile as ``posa_max_rate_change_pct``.
DEFAULT_RATE_BAND_PCT = 20.0

# Currency-unit slack on the band edges so a rate that lands exactly on
# the boundary is not rejected by float noise.
RATE_BAND_TOLERANCE = 0.01

# Tolerance for payment-total comparison. We use 0.01 for currencies with
# 2 decimal places. Currencies with more precision (e.g. BTC) would need
# per-currency calibration — out of scope here.
PAYMENT_MATCH_TOLERANCE = 0.01


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _profile_value(profile_doc: Any, key: str, default: Any = None) -> Any:
    if profile_doc is None:
        return default
    if isinstance(profile_doc, dict):
        return profile_doc.get(key, default)
    return getattr(profile_doc, key, default)


def _iter_lines(invoice_doc: Any) -> Iterable[Any]:
    """Yield invoice item-line objects (handles doc + dict shapes)."""
    if invoice_doc is None:
        return []
    items = getattr(invoice_doc, "items", None) if not isinstance(invoice_doc, dict) else invoice_doc.get("items")
    return items or []


def _line_value(line: Any, key: str, default: Any = None) -> Any:
    if line is None:
        return default
    if isinstance(line, dict):
        return line.get(key, default)
    return getattr(line, key, default)


_GRANTABLE_SENTINEL = object()
_NON_ITEM_TOKENS = {"", "nothing", "null", "undefined", "none"}


def _server_grantable_free_items(invoice_doc: Any, profile_doc: Any) -> set | None:
    """Item codes a valid Give-Product offer can hand out for free.

    Audit r2 P0: a client-set ``is_free_item`` / ``posa_is_offer`` marker
    is untrusted — a crafted payload can flag a normally-priced item free
    to zero-price it on a rate-edit-OFF profile. The exemption in the two
    guards below must be verified against the SERVER's offer set, not the
    client's claim.

    Returns a set of grantable item codes, or ``None`` when the offer set
    cannot be determined (offers infra error) — the caller then falls back
    to the old client-trust behaviour rather than blocking the counter. A
    successful lookup that omits the item is a forgery: the guards enforce.

    Scope covers explicit give items plus same-item ("buy X get X free")
    offers, intersected with the cart so an offer's apply group/brand only
    grants items actually in this basket.
    """
    profile_name = _profile_value(profile_doc, "name") or _line_value(
        invoice_doc, "pos_profile"
    )
    if not profile_name:
        return None
    try:
        from posawesome.posawesome.api.offers import get_offers

        offers = get_offers(profile_name) or []
    except Exception:
        frappe.log_error(
            frappe.get_traceback(), "POSAwesome free-item offer verification"
        )
        return None

    give_offers = [o for o in offers if str(o.get("offer") or "").strip() == "Give Product"]

    cart_codes = {
        str(_line_value(line, "item_code")).strip()
        for line in _iter_lines(invoice_doc)
        if _line_value(line, "item_code")
    }

    # Item metadata for same-item scope resolution, fetched once for the cart.
    meta = {}
    if cart_codes:
        try:
            for row in frappe.get_all(
                "Item",
                filters={"item_code": ["in", list(cart_codes)]},
                fields=["item_code", "item_group", "brand"],
            ):
                meta[row.get("item_code")] = row
        except Exception:
            meta = {}

    def _clean(code):
        code = str(code or "").strip()
        return code if code.lower() not in _NON_ITEM_TOKENS else ""

    grantable: set = set()
    for offer in give_offers:
        explicit = _clean(offer.get("give_item")) or _clean(offer.get("apply_item_code"))
        if explicit and not (offer.get("replace_item") or offer.get("replace_cheapest_item")):
            grantable.add(explicit)
            continue

        # Same-item / replace: the free item is a purchased line matching the
        # offer's apply scope. Only cart items can qualify.
        apply_type = str(offer.get("apply_type") or offer.get("apply_on") or "").strip()
        target_code = _clean(offer.get("apply_item_code")) or _clean(offer.get("item"))
        target_group = _clean(offer.get("apply_item_group")) or _clean(offer.get("item_group"))
        target_brand = _clean(offer.get("brand"))
        for code in cart_codes:
            if apply_type == "Item Code" and code == target_code:
                grantable.add(code)
            elif apply_type == "Item Group" and target_group and (
                meta.get(code, {}).get("item_group") == target_group
            ):
                grantable.add(code)
            elif apply_type == "Brand" and target_brand and (
                meta.get(code, {}).get("brand") == target_brand
            ):
                grantable.add(code)
            elif explicit and code == explicit:
                grantable.add(code)

    return grantable


def _line_free_exemption(line: Any, invoice_doc: Any, profile_doc: Any) -> bool:
    """True when a zero-rate line is a legitimate, server-verified freebie.

    A client free/offer marker only earns the exemption when the server's
    own Give-Product offer set can actually grant this item (or when the
    offer set is indeterminate — fail open to avoid blocking the counter).
    Rate-edit-enabled profiles keep the operator prerogative separately;
    this helper is consulted only for the marker-based exemption.
    """
    is_marker = bool(
        flt(_line_value(line, "is_free_item") or 0)
        or flt(_line_value(line, "posa_is_offer") or 0)
    )
    if not is_marker:
        return False

    cache = getattr(invoice_doc, "_posa_grantable_free", _GRANTABLE_SENTINEL)
    if cache is _GRANTABLE_SENTINEL:
        cache = _server_grantable_free_items(invoice_doc, profile_doc)
        try:
            invoice_doc._posa_grantable_free = cache
        except Exception:
            pass
    if cache is None:
        # Offer set indeterminate — preserve prior client-trust behaviour.
        return True
    item_code = str(_line_value(line, "item_code") or "").strip()
    return bool(item_code) and item_code in cache


# ---------------------------------------------------------------------------
# discount cap
# ---------------------------------------------------------------------------


def enforce_discount_limit(invoice_doc: Any, profile_doc: Any | None = None) -> None:
    """Cap per-line discount against Item.max_discount + profile cap.

    Frappe enforces ``Item.max_discount`` only when the standard pricing
    rules run (which we explicitly disable via ``ignore_pricing_rule = 1``
    in update_invoice). So the gate has to live in our wrapper.

    POS-Profile-wide cap (``posa_max_discount_allowed``) is optional —
    falls back to "no profile-wide cap" when missing.
    """

    profile_cap = flt(_profile_value(profile_doc, "posa_max_discount_allowed") or 0)
    price_list = _profile_value(profile_doc, "selling_price_list") or _line_value(
        invoice_doc, "selling_price_list"
    )

    for line in _iter_lines(invoice_doc):
        discount_pct = flt(_line_value(line, "discount_percentage") or 0)
        discount_amount = flt(_line_value(line, "discount_amount") or 0)
        if discount_pct <= 0 and discount_amount <= 0:
            continue

        item_code = _line_value(line, "item_code")
        item_cap = flt(
            frappe.db.get_value("Item", item_code, "max_discount") or 0
        ) if item_code else 0

        # Effective cap is the strictest non-zero limit. A zero from
        # either side means "no opinion", not "100% discount allowed".
        caps = [c for c in (item_cap, profile_cap) if c > 0]
        if not caps:
            continue

        base_rate = flt(_line_value(line, "price_list_rate") or 0)
        if discount_amount > 0 and base_rate <= 0 and item_code and price_list:
            base_rate = flt(
                frappe.db.get_value(
                    "Item Price",
                    {"item_code": item_code, "price_list": price_list},
                    "price_list_rate",
                    order_by="valid_from desc",
                ) or 0
            )
        if discount_amount > 0 and base_rate > 0:
            discount_pct = max(discount_pct, discount_amount / base_rate * 100.0)

        # Product giveaways and fully-discounted offer/pricing-rule lines
        # are authorized freebies, not operator-entered discounts. The free
        # marker is client-supplied, so verify it against the server's own
        # Give-Product offer set before honouring the exemption (audit r2).
        client_rate = flt(_line_value(line, "rate") or 0)
        is_free = _line_free_exemption(line, invoice_doc, profile_doc)
        has_rule = bool(
            flt(_line_value(line, "posa_offer_applied") or 0)
            or _line_value(line, "pricing_rules")
            or _line_value(line, "pricing_rule")
            or _line_value(line, "source_rule")
        )
        if client_rate <= 0 and (is_free or (has_rule and discount_pct >= 100.0)):
            continue

        max_allowed = min(caps)
        if discount_pct > max_allowed:
            frappe.throw(
                _(
                    "Line {0} discount {1}% exceeds the configured maximum {2}% for item {3}."
                ).format(
                    _line_value(line, "idx") or "?",
                    discount_pct,
                    max_allowed,
                    item_code or "?",
                ),
                frappe.PermissionError,
            )


# ---------------------------------------------------------------------------
# payment-vs-total invariant
# ---------------------------------------------------------------------------


def assert_payments_match_grand_total(
    invoice_doc: Any,
    tolerance: float | None = None,
    is_credit_sale: bool = False,
    declared_change: float = 0.0,
) -> None:
    """Require sum(payments[].amount) - declared_change == grand_total.

    Catches the "client sends payments=[$0] for a $1000 cart" attack.
    Frappe re-sums line totals in ``calculate_taxes_and_totals`` but
    accepts whatever the client put in ``payments`` if the invoice is
    being saved as a draft. By the time submit happens it's too late.

    Credit-sale flow (`data.is_credit_sale=1`) intentionally accepts a
    partial payment: customer pays $200 of a $400 invoice, the
    remaining $200 becomes outstanding (anticipo / receivable). The
    "$0 for $1000 cart" threat doesn't apply — the outstanding IS the
    deferred liability, not an exfiltration. Skip the equality check
    when the caller flags the request as a credit sale.

    ``declared_change`` is the cash-back the register hands over when
    the customer tenders above the total (``data.paid_change`` +
    ``data.credit_change``): cashier receives $1900 on a $1882 ticket,
    payments carry the $1900 actually tendered and the $18 comes back
    out of the drawer as a post-submit change Payment Entry
    (``_create_change_payment_entries``). The invariant therefore holds
    on the NET amount — under-payment stays blocked, and change larger
    than the tender fails the same equality.
    """

    if is_credit_sale:
        return

    tol = tolerance if tolerance is not None else PAYMENT_MATCH_TOLERANCE

    # Prefer rounded_total when set — Frappe rounds the customer-facing
    # number, and payments are collected against that, not grand_total.
    rounded = _line_value(invoice_doc, "rounded_total")
    grand_total = flt(rounded if rounded else _line_value(invoice_doc, "grand_total") or 0)

    # Returns / credit notes have negative grand_total; absolute the
    # comparison so the invariant still applies.
    paid = 0.0
    payments = (
        getattr(invoice_doc, "payments", None)
        if not isinstance(invoice_doc, dict)
        else invoice_doc.get("payments")
    ) or []
    for pay in payments:
        paid += flt(_line_value(pay, "amount") or 0)

    # Sales Invoices with `is_pos = 0` (regular non-POS) may have empty
    # payments — that's legitimate (outstanding_amount tracks the debt).
    # Only enforce when payments[] is non-empty OR is_pos is truthy.
    is_pos = bool(_line_value(invoice_doc, "is_pos"))
    if not payments and not is_pos:
        return

    change = max(flt(declared_change), 0.0)
    if abs(paid - change - grand_total) > tol:
        if change:
            frappe.throw(
                _(
                    "Payment total {0} minus change {1} does not match grand total {2} (difference {3})."
                ).format(paid, change, grand_total, paid - change - grand_total),
                frappe.ValidationError,
            )
        frappe.throw(
            _(
                "Payment total {0} does not match grand total {1} (difference {2})."
            ).format(paid, grand_total, paid - grand_total),
            frappe.ValidationError,
        )


# ---------------------------------------------------------------------------
# rate-band invariant
# ---------------------------------------------------------------------------


def _resolve_band_pct(profile_doc: Any, band_pct: float | None) -> float:
    """Band half-width, in percent, for a rate-edit-enabled register.

    Precedence: explicit argument → POS Profile
    ``posa_max_rate_change_pct`` → ``DEFAULT_RATE_BAND_PCT``.

    **Zero means "not configured", never "no deviation allowed."** The
    patch's ``default: 20`` does reach existing rows (verified on
    doco-mirror), but the column underneath is ``NOT NULL DEFAULT 0``, so
    0 is what a profile reads when the field is cleared by hand, added
    without a default, or written by anything that bypasses the meta.
    Reading that as a zero-width band would refuse every rate edit on
    that register — a silent till outage produced by an absent value — so
    0 falls through to the 20% default instead. The deliberate
    per-register kill switch is a NEGATIVE value (set -1 to turn the band
    off for that till), which no column default can produce by accident.
    """
    raw = (
        band_pct
        if band_pct is not None
        else _profile_value(profile_doc, "posa_max_rate_change_pct")
    )
    if raw is None:
        return DEFAULT_RATE_BAND_PCT
    raw = flt(raw)
    if raw < 0:
        return raw
    return raw or DEFAULT_RATE_BAND_PCT


def _skips_rate_band(item_code: str, cache: dict) -> bool:
    """True when this item — or its Item Group — is flagged variable-price.

    ``posa_skip_rate_band`` is the per-SKU opt-out that lets "cambiar
    pantalla" quote 400 against a 150 price-list entry while the band
    still guards ordinary retail lines. The Item Group flag exists so a
    whole category ("Servicio Técnico") can be opted out in one place.

    A lookup failure counts as flagged. The likeliest cause is a site
    running this code before ``add_rate_band_controls`` created the
    field, and enforcing a band whose opt-out cannot be read would block
    exactly the counter flow the flag exists to unblock.
    """
    if item_code in cache:
        return cache[item_code]
    try:
        skipped = bool(
            flt(frappe.db.get_value("Item", item_code, "posa_skip_rate_band") or 0)
        )
        if not skipped:
            group = frappe.db.get_value("Item", item_code, "item_group")
            skipped = bool(group) and bool(
                flt(
                    frappe.db.get_value("Item Group", group, "posa_skip_rate_band")
                    or 0
                )
            )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "POSAwesome rate-band opt-out lookup")
        skipped = True
    cache[item_code] = skipped
    return skipped


def assert_rates_within_band(
    invoice_doc: Any,
    profile_doc: Any | None = None,
    band_pct: float | None = None,
) -> None:
    """Validate line rates against Item Price for the profile's price list.

    Three behaviors:
      * Profile blocks rate edits → the declared pre-discount
        ``price_list_rate`` must match Item Price (within rounding) and
        ``rate`` must equal it with the line's declared discount applied
        — offer/pricing-rule discounts are not rate edits.
      * Profile allows rate edits → the typed pre-discount price must
        stay within ±``posa_max_rate_change_pct`` (default 20) of the
        Item Price. Items and Item Groups carrying
        ``posa_skip_rate_band`` are exempt: that flag, not the profile
        flag, is what lets a variable-price SKU quote any figure.
      * No Item Price found for the item × price-list combo → skip
        validation for that line (legacy items without price master).

    Note: this does NOT enforce price-list-currency match; that's the
    job of full reprice (deferred).
    """

    # Demo tenants skip the gate entirely: demos must never hard-block
    # selling; their integrity story is the nightly golden restore, not
    # this gate. Inline conf read (twin of shifts.is_demo_pos_site) —
    # importing shifts here would drag its module deps into the
    # stub-frappe unit harness.
    try:
        if int(getattr(frappe, "conf", {}).get("muelle_demo") or 0):
            return
    except (TypeError, ValueError, AttributeError):
        pass

    allow_edit = bool(_profile_value(profile_doc, "posa_allow_user_to_edit_rate"))
    price_list = _profile_value(profile_doc, "selling_price_list") or _line_value(
        invoice_doc, "selling_price_list"
    )
    if not price_list:
        # Without a price list we have no source of truth to compare
        # against; skipping is safer than failing legitimate flows.
        return

    band = _resolve_band_pct(profile_doc, band_pct)
    skip_cache: dict = {}

    for line in _iter_lines(invoice_doc):
        item_code = _line_value(line, "item_code")
        if not item_code:
            continue

        # Cart line rates are commonly stored as `rate` (per-unit, post
        # discount). `price_list_rate` is the pre-discount price.
        client_rate = flt(_line_value(line, "rate") or 0)

        master_rate = frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list},
            "price_list_rate",
            order_by="valid_from desc",
        )
        if master_rate is None:
            continue
        master_rate = flt(master_rate)
        if master_rate <= 0:
            continue

        if client_rate <= 0 and not allow_edit:
            # Only guard zero/negative rates on profiles that FORBID rate
            # edits. When posa_allow_user_to_edit_rate=1 a zero rate is the
            # operator's prerogative (comp, warranty, promo) — the same
            # "operator judgment rules" bypass applied to positive rates
            # below. Gating here prevents this guard from 403'ing legitimate
            # zero lines on rate-edit-enabled registers.
            # Client free/offer markers are untrusted — verify against the
            # server's Give-Product offer set (audit r2 zero-price bypass).
            is_free = _line_free_exemption(line, invoice_doc, profile_doc)
            declared_plr = flt(_line_value(line, "price_list_rate") or 0)
            base_rate = declared_plr if declared_plr > 0 else master_rate
            disc_pct = flt(_line_value(line, "discount_percentage") or 0)
            disc_amt = flt(_line_value(line, "discount_amount") or 0)
            expected_rate = (
                base_rate * (1 - disc_pct / 100.0)
                if disc_pct
                else base_rate - disc_amt if disc_amt else base_rate
            )
            has_rule = bool(
                flt(_line_value(line, "posa_offer_applied") or 0)
                or _line_value(line, "pricing_rules")
                or _line_value(line, "pricing_rule")
                or _line_value(line, "source_rule")
            )
            declared_matches_master = (
                declared_plr <= 0 or abs(declared_plr - master_rate) <= 0.01
            )
            if not is_free and not (
                has_rule
                and declared_matches_master
                and abs(expected_rate) <= 0.01
            ):
                frappe.throw(
                    _(
                        "Rate edit is not permitted for this POS Profile. "
                        "Line {0} ({1}): {2} vs price-list rate {3}."
                    ).format(
                        _line_value(line, "idx") or "?",
                        item_code,
                        client_rate,
                        master_rate,
                    ),
                    frappe.PermissionError,
                )
            continue

        if not allow_edit:
            # An offer / pricing-rule discount is NOT a rate edit: the line
            # ships the pre-discount price in `price_list_rate` plus the
            # discount applied (`discount_percentage`, else per-unit
            # `discount_amount`), and `rate` is their result. So validate in
            # two steps: the declared pre-discount price must match the Item
            # Price master, and `rate` must be exactly that price with the
            # declared discount applied. A hand-typed rate still fails both;
            # a seeded offer passes. Discount SIZE is enforce_discount_limit's
            # job, not this gate's. (Was: rate-vs-master directly, which
            # 403'd every offer-discounted line — bit demo.muelle.mx
            # 2026-07-31.) Lines that omit price_list_rate fall back to the
            # master price, preserving the old exact-match behavior.
            declared_plr = flt(_line_value(line, "price_list_rate") or 0)
            if declared_plr > 0 and abs(declared_plr - master_rate) > 0.01:
                frappe.throw(
                    _(
                        "Price list rate mismatch for this POS Profile. "
                        "Line {0} ({1}): declared {2} vs price-list rate {3}."
                    ).format(
                        _line_value(line, "idx") or "?",
                        item_code,
                        declared_plr,
                        master_rate,
                    ),
                    frappe.PermissionError,
                )
            base_rate = declared_plr if declared_plr > 0 else master_rate
            disc_pct = flt(_line_value(line, "discount_percentage") or 0)
            disc_amt = flt(_line_value(line, "discount_amount") or 0)
            if disc_pct:
                expected_rate = base_rate * (1 - disc_pct / 100.0)
            elif disc_amt:
                expected_rate = base_rate - disc_amt
            else:
                expected_rate = base_rate
            if abs(client_rate - expected_rate) > 0.01:
                frappe.throw(
                    _(
                        "Rate edit is not permitted for this POS Profile. "
                        "Line {0} ({1}): {2} vs price-list rate {3}."
                    ).format(
                        _line_value(line, "idx") or "?",
                        item_code,
                        client_rate,
                        master_rate,
                    ),
                    frappe.PermissionError,
                )
            continue

        # Editable rate. The profile flag says WHETHER the operator may
        # retype a price; the band says HOW FAR from the price list that
        # price may land. The two were never wired together, which is why
        # the band was switched off wholesale in 23ca94e6 after it blocked
        # "cambiar pantalla" (labor charged per device model, customer
        # brings the display). The opt-out now lives on the SKU, so the
        # fraud/typo cap can come back for everything else.
        if band <= 0:
            # Negative band = this register's kill switch (see
            # _resolve_band_pct); restores the 23ca94e6 full bypass.
            continue
        if _skips_rate_band(item_code, skip_cache):
            continue

        # Compare the PRE-DISCOUNT price the line asserts. A declared
        # discount lowers `rate` legitimately and its size is
        # enforce_discount_limit's job — gating it here as well would 403
        # every offer line on a rate-edit register. With no discount
        # declared, `rate` IS the asserted price.
        declared_plr = flt(_line_value(line, "price_list_rate") or 0)
        has_discount = bool(
            flt(_line_value(line, "discount_percentage") or 0)
            or flt(_line_value(line, "discount_amount") or 0)
        )
        subject = declared_plr if (has_discount and declared_plr > 0) else client_rate
        if subject <= 0:
            # Comp / warranty / zero lines stay the operator's prerogative
            # on a rate-edit register, unchanged since 23ca94e6.
            continue

        low = master_rate * (1 - band / 100.0)
        high = master_rate * (1 + band / 100.0)
        if subject < low - RATE_BAND_TOLERANCE or subject > high + RATE_BAND_TOLERANCE:
            # Read at a till by whoever is standing there: name the item,
            # what they typed, what the list says, and what would pass.
            frappe.throw(
                _(
                    "Line {0} ({1}): the rate {2} is outside the allowed "
                    "{3} – {4} for this register (price list {5}, ±{6}%). "
                    "Correct the rate, update the price list, or have the "
                    "item marked as variable-price."
                ).format(
                    _line_value(line, "idx") or "?",
                    item_code,
                    subject,
                    round(low, 2),
                    round(high, 2),
                    master_rate,
                    band,
                ),
                frappe.PermissionError,
            )
