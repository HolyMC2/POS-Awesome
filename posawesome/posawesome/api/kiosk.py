# Copyright (c) 2026, Doco and contributors
"""Self-service kiosk (POS critique D2).

Not a register and not a cashier: a customer-facing screen that browses a
priced catalog and ends in «PAGA EN CAJA» — a numbered POS Charge Request
(the D3 order hub) that the register collects like any other queue row.
The kiosk itself never touches money, stock or invoices, which is the whole
security story: the worst a hijacked kiosk can do is queue orders a human
still has to charge.

Three reads/writes, all gated on the ``kiosk`` capability token of the
profile's preset (server-side, like every other capability):

  * ``get_kiosk_context``  — which profiles this login may serve.
  * ``get_kiosk_catalog``  — item groups + items, SERVER-priced.
  * ``place_kiosk_order``  — item_code + qty only. Rates are never taken
    from the device; they are re-read from the profile's price list at
    placement, so a tampered kiosk cannot discount its own order.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, strip_html_tags

from posawesome.posawesome.api._scope import assert_profile
from posawesome.posawesome.api.vertical import shift_effective_capability_payload

KIOSK_CAPABILITY = "kiosk"
CATALOG_LIMIT = 300
MAX_LINES = 30
MAX_QTY = 20
# A runaway or abused device must not flood the register: past this many
# Open kiosk rows on one profile the kiosk asks the customer to see a human.
MAX_OPEN_KIOSK_ORDERS = 30
_SOURCE_PREFIX = "Kiosko"


def _kiosk_enabled(pos_profile: str) -> bool:
    try:
        payload = shift_effective_capability_payload(pos_profile) or {}
        tokens = {
            str(entry).partition(":")[0].strip()
            for entry in (payload.get("capabilities") or [])
        }
        return KIOSK_CAPABILITY in tokens
    except Exception:
        return False


def _assert_kiosk(pos_profile: str):
    assert_profile(frappe.session.user, pos_profile)
    if not _kiosk_enabled(pos_profile):
        frappe.throw(_("This register is not configured for kiosk service."))


@frappe.whitelist(methods=["GET", "POST"])
def get_kiosk_context():
    """A kiosk tablet's boot: the profiles this login may serve (the KDS
    pattern — an account with none is told so, not shown an empty menu)."""
    frappe.has_permission("Item", "read", throw=True)
    names = sorted(
        set(
            frappe.get_all(
                "POS Profile User",
                filters={"user": frappe.session.user},
                pluck="parent",
            )
        )
    )
    profiles = []
    for name in names:
        row = frappe.db.get_value(
            "POS Profile", name, ["name", "company", "disabled", "customer"], as_dict=True
        )
        if not row or cint(row.disabled):
            continue
        if not _kiosk_enabled(name):
            continue
        profiles.append(
            {
                "pos_profile": name,
                "company": row.company,
                # No walk-in customer means orders cannot be queued — the
                # picker says so up front instead of failing at checkout.
                "ready": bool(row.customer),
            }
        )
    return {"profiles": profiles}


def _profile_catalog_scope(pos_profile: str):
    row = frappe.db.get_value(
        "POS Profile", pos_profile, ["selling_price_list", "company", "customer"], as_dict=True
    )
    groups = frappe.get_all(
        "POS Item Group",
        filters={"parent": pos_profile, "parenttype": "POS Profile"},
        pluck="item_group",
        ignore_permissions=True,
    )
    return row, [g for g in groups if g]


@frappe.whitelist(methods=["GET", "POST"])
def get_kiosk_catalog(pos_profile):
    """Groups + items with SERVER prices. Unpriced items are not on the menu:
    a kiosk cannot negotiate, so a missing Item Price means «not sold here»."""
    _assert_kiosk(pos_profile)
    frappe.has_permission("Item", "read", throw=True)
    row, groups = _profile_catalog_scope(pos_profile)
    if not row or not row.selling_price_list:
        frappe.throw(_("This register has no selling price list."))

    filters = {"disabled": 0, "is_sales_item": 1, "has_variants": 0}
    if groups:
        filters["item_group"] = ["in", groups]
    items = frappe.get_all(
        "Item",
        filters=filters,
        fields=["name", "item_code", "item_name", "item_group", "image"],
        order_by="item_group asc, item_name asc",
        limit_page_length=CATALOG_LIMIT,
    )
    prices = {}
    if items:
        for price in frappe.get_all(
            "Item Price",
            filters={
                "price_list": row.selling_price_list,
                "item_code": ["in", [i.item_code for i in items]],
            },
            fields=["item_code", "price_list_rate"],
            order_by="valid_from asc",
            ignore_permissions=True,
        ):
            # Later rows win: same "latest valid_from" the register reads.
            prices[price.item_code] = flt(price.price_list_rate)

    catalog = [
        {
            "item_code": item.item_code,
            "item_name": item.item_name or item.item_code,
            "item_group": item.item_group,
            "image": item.image,
            "rate": prices[item.item_code],
        }
        for item in items
        if prices.get(item.item_code)
    ]
    seen_groups = []
    for entry in catalog:
        if entry["item_group"] not in seen_groups:
            seen_groups.append(entry["item_group"])
    return {"groups": seen_groups, "items": catalog}


@frappe.whitelist(methods=["POST"])
def place_kiosk_order(pos_profile, lines, customer_label=None):
    """The kiosk's only write: queue a «paga en caja» charge request.

    The device sends item_code + qty and NOTHING else. Rates come from the
    price list at placement; unknown, disabled or unpriced items are refused
    whole — a kiosk order must be exactly chargeable, or the cashier inherits
    an argument at the counter.
    """
    _assert_kiosk(pos_profile)
    if not frappe.db.exists("DocType", "POS Charge Request"):
        frappe.throw(_("This site has no charge request spine."))

    row, groups = _profile_catalog_scope(pos_profile)
    if not row or not row.selling_price_list:
        frappe.throw(_("This register has no selling price list."))
    if not row.customer:
        frappe.throw(_("This register has no walk-in customer configured."))

    open_kiosk = frappe.db.count(
        "POS Charge Request",
        {
            "status": "Open",
            "pos_profile": pos_profile,
            "source_label": ["like", f"{_SOURCE_PREFIX}%"],
        },
    )
    if open_kiosk >= MAX_OPEN_KIOSK_ORDERS:
        frappe.throw(_("The queue is full — please order at the counter."))

    if isinstance(lines, str):
        try:
            lines = json.loads(lines)
        except (TypeError, ValueError):
            frappe.throw(_("Order lines are not valid JSON."))
    if not isinstance(lines, list) or not lines or len(lines) > MAX_LINES:
        frappe.throw(_("An order needs between 1 and {0} lines.").format(MAX_LINES))

    priced = []
    for idx, line in enumerate(lines, 1):
        if not isinstance(line, dict):
            frappe.throw(_("Line {0} is malformed.").format(idx))
        item_code = str(line.get("item_code") or "").strip()
        qty = cint(line.get("qty"))
        if not item_code or qty < 1 or qty > MAX_QTY:
            frappe.throw(
                _("Line {0} needs an item and a qty between 1 and {1}.").format(idx, MAX_QTY)
            )
        item = frappe.db.get_value(
            "Item",
            {"item_code": item_code, "disabled": 0, "is_sales_item": 1},
            ["item_code", "item_name", "item_group"],
            as_dict=True,
        )
        if not item or (groups and item.item_group not in groups):
            frappe.throw(_("Item {0} is not sold at this kiosk.").format(item_code))
        rate = flt(
            frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": row.selling_price_list},
                "price_list_rate",
                order_by="valid_from desc",
            )
        )
        if rate <= 0:
            frappe.throw(_("Item {0} has no price here.").format(item_code))
        priced.append(
            {
                "item_code": item.item_code,
                "item_name": item.item_name or item.item_code,
                "qty": qty,
                "rate": rate,
            }
        )

    label = _SOURCE_PREFIX
    tag = strip_html_tags(str(customer_label or "")).strip()[:40]
    if tag:
        label = f"{_SOURCE_PREFIX} · {tag}"

    request = frappe.get_doc(
        {
            "doctype": "POS Charge Request",
            "status": "Open",
            "customer": row.customer,
            "company": row.company,
            "pos_profile": pos_profile,
            "source_label": label,
            "settle_mode": "Register",
            "items_json": json.dumps(priced),
        }
    )
    request.insert(ignore_permissions=True)

    digits = "".join(ch for ch in request.name if ch.isdigit())
    return {
        "name": request.name,
        "order_number": digits[-3:].lstrip("0") or digits[-2:] or request.name,
        "amount_total": flt(request.amount_total),
    }
