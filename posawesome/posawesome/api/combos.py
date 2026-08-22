# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

"""POS read model for combos (roadmap §17.6).

A combo IS an ERPNext ``Product Bundle``. This module deliberately adds no
second source of truth for what a bundle contains:

* ``Product Bundle`` already carries the component lines, and
* ``packed_item.py`` already decrements stock per component for any sold item
  that is a non-disabled bundle's ``new_item_code``.

Re-declaring components in a posawesome doctype would duplicate the one part
of combos ERPNext gets right for free, and a hand-rolled decrement is how a
component goes negative — which §11 treats as a zero-tolerance incident.

What the POS genuinely lacks, and this module supplies, is a read model:
components enriched with the price-list rate and warehouse stock, so the
register can show the LIST price the parts would have cost, the SAVING the
bundle represents, and the component summary under the combo's name.

``POS Combo`` (see the doctype beside this file) is a thin, OPTIONAL overlay
that decides which bundles a register shows as combos and which device each
one targets. When a tenant has created none, every enabled bundle is offered,
so the feature degrades to "all bundles" rather than to nothing.

AVAILABILITY IS NOT ANSWERED HERE. §17.6 leaves ``min(components)`` as an open
back-end decision, and the frontend's ``comboAvailability.ts`` refuses to
guess it. This module returns per-component ``actual_qty`` so the rule can be
implemented without another round trip, and returns no combo-level
availability figure at all.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from posawesome.posawesome.api.utils import _ensure_pos_profile


def _as_list(value):
    """Accept a JSON string, a list, or a bare code — the POS sends all three."""
    if not value:
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("["):
            try:
                return json.loads(stripped)
            except ValueError:
                return []
        return [stripped]
    if isinstance(value, (list, tuple)):
        return list(value)
    return []


def _bundle_rows(bundle_codes=None):
    """Enabled Product Bundles, optionally narrowed to specific parent items."""
    filters = {"disabled": 0}
    if bundle_codes:
        filters["new_item_code"] = ["in", list(bundle_codes)]
    return frappe.get_all(
        "Product Bundle",
        filters=filters,
        fields=["name", "new_item_code", "description"],
    )


def _pos_combo_overlay():
    """POS presentation/eligibility rows keyed by Product Bundle name.

    Absent doctype or empty table both mean "no opinion": the caller then
    offers every enabled bundle. A tenant that has never opened the combo
    settings still gets working combos.
    """
    if not frappe.db.exists("DocType", "POS Combo"):
        return {}

    rows = frappe.get_all(
        "POS Combo",
        filters={"disabled": 0},
        fields=["name", "product_bundle", "priority"],
    )
    if not rows:
        return {}

    # `targets` is a child table, so it cannot ride along on the parent query.
    target_rows = frappe.get_all(
        "POS Combo Target",
        filters={"parent": ["in", [r["name"] for r in rows]]},
        fields=["parent", "item_code"],
        order_by="parent asc, idx asc",
    )
    targets_by_parent = {}
    for row in target_rows:
        targets_by_parent.setdefault(row["parent"], []).append(row["item_code"])

    overlay = {}
    for row in rows:
        overlay[row.get("product_bundle")] = {
            "priority": flt(row.get("priority")),
            "targets": targets_by_parent.get(row["name"], []),
        }
    return overlay


def _component_rows(bundle_names):
    """Product Bundle Item lines for the given bundles, in table order."""
    if not bundle_names:
        return {}
    rows = frappe.get_all(
        "Product Bundle Item",
        filters={"parent": ["in", list(bundle_names)]},
        fields=["parent", "item_code", "qty", "uom", "idx"],
        order_by="parent asc, idx asc",
    )
    grouped = {}
    for row in rows:
        grouped.setdefault(row["parent"], []).append(row)
    return grouped


def _item_meta(item_codes):
    """Names and stock-item flags for every code we are about to price."""
    if not item_codes:
        return {}
    rows = frappe.get_all(
        "Item",
        filters={"name": ["in", list(item_codes)]},
        fields=["name", "item_name", "is_stock_item", "stock_uom", "image"],
    )
    return {row["name"]: row for row in rows}


def _price_map(item_codes, price_list, currency, customer=None):
    """Selling rates from the register's price list, keyed by item_code.

    Uses the cached fetcher the item catalogue already uses, so a combo and the
    same item in the grid can never quote two different numbers.
    """
    if not item_codes or not price_list:
        return {}

    from posawesome.posawesome.api.item_fetchers import get_item_prices

    rows = get_item_prices(
        price_list,
        currency,
        tuple(sorted(item_codes)),
        customer,
        nowdate(),
    ) or []

    prices = {}
    for row in rows:
        code = row.get("item_code")
        # Rows arrive newest-first per the fetcher's ordering; keep the first.
        if code and code not in prices:
            prices[code] = flt(row.get("price_list_rate"))
    return prices


def _stock_map(item_codes, warehouse):
    """Free quantity per component in the register's warehouse."""
    if not item_codes or not warehouse:
        return {}

    from posawesome.posawesome.api.item_processing.stock import (
        get_bulk_stock_availability,
    )

    requested = [{"item_code": code, "warehouse": warehouse} for code in item_codes]
    raw = get_bulk_stock_availability(requested) or {}

    stock = {}
    for key, qty in raw.items():
        code = key[0] if isinstance(key, (tuple, list)) else key
        stock[code] = flt(stock.get(code, 0)) + flt(qty)
    return stock


@frappe.whitelist(methods=["GET", "POST"])
def get_combos(pos_profile=None, bundles=None, customer=None):
    """Combos sellable on this register, with components priced and counted.

    Read-only by construction: it reads Product Bundle, Item, Item Price and
    Bin, and writes nothing. ``bundles`` narrows the answer to specific parent
    item codes (the cart asking about what it already holds); omitting it
    returns every combo the register offers.

    Returns a list of::

        {item_code, item_name, rate, image, priority, targets,
         components: [{item_code, item_name, qty, rate, uom,
                       actual_qty, is_stock_item}]}

    No combo-level availability: see the module docstring.
    """
    profile, _profile_json = _ensure_pos_profile(pos_profile)

    price_list = profile.get("selling_price_list")
    currency = profile.get("currency")
    warehouse = profile.get("warehouse")

    overlay = _pos_combo_overlay()
    wanted = _as_list(bundles)
    rows = _bundle_rows(wanted)

    # A configured overlay is an allowlist; an empty one is no opinion.
    if overlay:
        rows = [r for r in rows if r["name"] in overlay]

    if not rows:
        return []

    components_by_bundle = _component_rows([r["name"] for r in rows])

    codes = {r["new_item_code"] for r in rows if r.get("new_item_code")}
    for lines in components_by_bundle.values():
        codes.update(line["item_code"] for line in lines if line.get("item_code"))

    meta = _item_meta(codes)
    prices = _price_map(codes, price_list, currency, customer)
    stock = _stock_map(
        {line["item_code"] for lines in components_by_bundle.values() for line in lines},
        warehouse,
    )

    combos = []
    for row in rows:
        parent_code = row.get("new_item_code")
        if not parent_code:
            continue
        parent_meta = meta.get(parent_code) or {}
        settings = overlay.get(row["name"]) or {}

        components = []
        for line in components_by_bundle.get(row["name"], []):
            code = line["item_code"]
            line_meta = meta.get(code) or {}
            components.append(
                {
                    "item_code": code,
                    "item_name": line_meta.get("item_name") or code,
                    "qty": flt(line.get("qty")) or 1,
                    "rate": flt(prices.get(code)),
                    "uom": line.get("uom") or line_meta.get("stock_uom"),
                    "actual_qty": flt(stock.get(code)),
                    # Carried so the availability rule, when it lands, can
                    # exclude services without a second query. A combo whose
                    # components include labour must not read as out of stock.
                    "is_stock_item": int(line_meta.get("is_stock_item") or 0),
                }
            )

        combos.append(
            {
                "item_code": parent_code,
                "item_name": parent_meta.get("item_name") or parent_code,
                "rate": flt(prices.get(parent_code)),
                "image": parent_meta.get("image"),
                "priority": settings.get("priority", 0),
                "targets": settings.get("targets", []),
                "components": components,
            }
        )

    combos.sort(key=lambda c: (flt(c.get("priority")), c.get("item_name") or ""))
    return combos


@frappe.whitelist(methods=["GET", "POST"])
def get_combo_components(bundles, pos_profile=None, customer=None):
    """Components for specific combos — the cart's narrow question.

    Thin wrapper over :func:`get_combos` so the cart does not fetch the whole
    catalogue to render one line, and so both paths price identically.
    """
    codes = _as_list(bundles)
    if not codes:
        return {}
    return {
        combo["item_code"]: combo["components"]
        for combo in get_combos(pos_profile=pos_profile, bundles=codes, customer=customer)
    }
