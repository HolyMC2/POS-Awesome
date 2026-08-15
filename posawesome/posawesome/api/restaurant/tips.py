# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""Restaurant-tip validation and the lazy accounting item."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

TIP_ITEM_CODE = "PROPINA"


def _tip_item_docname() -> str | None:
    # The docname is NOT a reliable key: doco autonames Items by IPN series,
    # so docname != item_code on those sites (a fresh core site keeps them
    # equal). Lookup always goes through the item_code FIELD filter — and
    # get_or_create_tip_item restores that field after insert, because a
    # Naming Series autoname overwrites item_code itself (item.py sets
    # `self.item_code = self.name`), which would otherwise orphan a new
    # PROPINA per settle and defeat the selector exclusion.
    return frappe.db.get_value("Item", {"item_code": TIP_ITEM_CODE}, "name")


def order_line_total(order) -> float:
    return sum(flt(row.qty) * flt(row.rate) for row in (order.items or []))


def _tips_capability_enabled(pos_profile: str) -> bool:
    # Shift-aware (roadmap F1): an open shift resolves from its stamped
    # contract, so a mid-shift preset edit cannot flip tip acceptance; the
    # emergency kill switch still removes it immediately.
    from posawesome.posawesome.api.vertical import shift_effective_capability_payload

    payload = shift_effective_capability_payload(pos_profile) or {}
    return "tips" in (payload.get("capabilities") or [])


def validate_tip_amount(order, tip_amount) -> float:
    amount = flt(tip_amount)
    if amount < 0:
        frappe.throw(_("Tip amount cannot be negative."))
    if not amount:
        # Zero-tip settles never consult the cap or the capability — a
        # return-heavy order with a negative line total must still settle
        # tip-free, on any register.
        return 0.0
    if not _tips_capability_enabled(order.pos_profile):
        # Capability tokens gate the UI everywhere else (tables precedent);
        # tips are money, so the endpoint refuses independently — a crafted
        # client must not book propinas on a register whose preset lacks the
        # token (Marco ruling 2026-08-12, spec §6.6 M8).
        frappe.throw(_("This register does not accept tips."))
    maximum = 2 * order_line_total(order)
    if amount > maximum:
        frappe.throw(_("Tip amount cannot exceed twice the order total."))
    return amount


TIP_ITEM_GROUP = "Servicios POS"


def _default_item_group() -> str:
    # A dedicated, defaults-free leaf group. Reusing the site's default
    # product group makes Item.insert inherit its Item Group Defaults rows —
    # legacy sites carry cross-company warehouse rows there, and Item
    # validation rejects the whole insert (bit doco-mirror: «Stores - TPC»
    # under a different company). A group PROPINA owns inherits nothing.
    if frappe.db.exists("Item Group", TIP_ITEM_GROUP):
        return TIP_ITEM_GROUP
    frappe.get_doc(
        {
            "doctype": "Item Group",
            "item_group_name": TIP_ITEM_GROUP,
            "parent_item_group": frappe.db.get_value(
                "Item Group", {"is_group": 1, "parent_item_group": ""}, "name"
            )
            or "All Item Groups",
            "is_group": 0,
        }
    ).insert(ignore_permissions=True)
    return TIP_ITEM_GROUP


def _ensure_company_default(item, company: str) -> None:
    income_account = frappe.db.get_value("Company", company, "default_income_account")
    for row in item.item_defaults or []:
        if row.company != company:
            continue
        # Presence is not completeness: a row born while the company had no
        # default income account self-heals once one exists.
        if not row.income_account and income_account:
            row.income_account = income_account
            item.save(ignore_permissions=True)
        return
    row = item.append(
        "item_defaults",
        {"company": company, "income_account": income_account},
    )
    # frappe fills matching user/global defaults (e.g. `default_warehouse`)
    # into new child rows — a stale cross-company warehouse default fails the
    # whole Item save. PROPINA is non-stock; a warehouse is never wanted.
    # "" not None: _set_defaults re-fills None at insert, but leaves "" alone.
    row.default_warehouse = ""
    item.save(ignore_permissions=True)


def get_or_create_tip_item(company: str) -> str:
    """Return the PROPINA item's DOCNAME, creating the item once and adding
    each company's defaults. The docname is what invoice lines link to — on
    doco sites it is an IPN serial, never the literal item_code."""
    docname = _tip_item_docname()
    if docname:
        item = frappe.get_doc("Item", docname)
        if item.is_stock_item:
            # An operator flipped it — a stock tip line with no warehouse
            # fails deep inside invoice validation with an opaque message.
            frappe.throw(
                _("The tip item {0} must remain a non-stock item.").format(item.name)
            )
        _ensure_company_default(item, company)
        return item.name

    income_account = frappe.db.get_value("Company", company, "default_income_account")
    item = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": TIP_ITEM_CODE,
            "item_name": _("Tip"),
            "item_group": _default_item_group(),
            "stock_uom": frappe.db.get_single_value("Stock Settings", "stock_uom") or "Nos",
            "is_stock_item": 0,
            "is_sales_item": 1,
            "include_item_in_manufacturing": 0,
            "item_defaults": [
                {"company": company, "income_account": income_account},
            ],
        }
    )
    for row in item.item_defaults:
        # See _ensure_company_default — strip the auto-filled warehouse.
        row.default_warehouse = ""
    try:
        item.insert(ignore_permissions=True)
    except Exception:
        # item_code is unique. A concurrent first settle may win between the
        # lookup and insert; only swallow that race, never a bad item. Under
        # REPEATABLE READ the re-lookup can miss the winner's uncommitted-at-
        # snapshot row and re-raise — that settle reverts to Open and the
        # retry (fresh transaction) succeeds. Accepted: first-ever tip, two
        # simultaneous settles, self-healing.
        docname = _tip_item_docname()
        if not docname:
            raise
        item = frappe.get_doc("Item", docname)
        _ensure_company_default(item, company)
    if item.item_code != TIP_ITEM_CODE:
        # Naming Series autoname rewrote the FIELD (item_code = docname).
        # Restore it so the lookup above finds this item next settle and the
        # item-selector exclusion keeps matching.
        item.db_set("item_code", TIP_ITEM_CODE, update_modified=False)
    return item.name


# NOTE for the contador packet: never create an Item Price for PROPINA. A
# master price makes assert_rates_within_band compare it against the
# per-settle tip rate and every tipped settle throws on profiles without
# rate editing. The rate-band check skips the line only while no price exists.


def tip_invoice_line(company: str, amount: float) -> dict:
    item_code = get_or_create_tip_item(company)
    return {
        "item_code": item_code,
        "item_name": _("Tip"),
        "qty": 1,
        "rate": amount,
        "price_list_rate": amount,
    }
