# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import json

import frappe
from erpnext.accounts.party import get_party_account
from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
from frappe.utils import getdate, nowdate

from posawesome.posawesome.api.payment_entry import create_payment_entry


def _payment_entry_job(order_name, payments):
    """Background task to create payment entries."""
    so_doc = frappe.get_doc("Sales Order", order_name)
    _create_payment_entries(so_doc, payments)


@frappe.whitelist(methods=["GET", "POST"])
def search_orders(company, currency, order_name=None, pos_profile=None):
    # Scope + feature (POS-PROFILE-SPEC P2): `custom_allow_select_sales_order`
    # only hid the SO source in the UI; the listing endpoint answered for any
    # company regardless of the flag or the caller's membership.
    from posawesome.posawesome.api._scope import assert_company, assert_profile_feature

    assert_company(frappe.session.user, company)
    assert_profile_feature(
        frappe.session.user, pos_profile, "custom_allow_select_sales_order", company
    )
    filters = {
        "billing_status": ["in", ["Not Billed", "Partly Billed"]],
        # docstatus=1 drops Cancelled (docstatus=2); billing_status drops
        # Completed (Fully Billed). The operative addition here is "Closed": a
        # Closed SO stays submitted + Not Billed and leaked into the picker as
        # if billable. Same status exclusion commercial_flow applies to its
        # other sources. "On Hold" is deliberately NOT excluded — parked /
        # apartado (layaway) SOs must stay billable from the POS.
        "status": ["not in", ["Closed", "Cancelled", "Completed"]],
        "docstatus": 1,
        "company": company,
        "currency": currency,
    }
    if order_name:
        filters["name"] = ["like", f"%{order_name}%"]
    orders_list = frappe.get_list(
        "Sales Order",
        filters=filters,
        fields=["name"],
        limit_page_length=0,
        order_by="customer",
    )
    data = []
    for order in orders_list:
        data.append(frappe.get_doc("Sales Order", order["name"]))
    return data


def _map_delivery_dates(data):
    """Ensure mandatory delivery_date fields are populated."""

    def parse_date(value):
        if not value:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            if normalized.lower() in {"invalid date", "nan", "none", "null", "undefined"}:
                return None
            value = normalized
        try:
            return str(getdate(value))
        except Exception:
            return None

    # Map order level delivery date with robust fallback.
    order_delivery_date = (
        parse_date(data.get("delivery_date"))
        or parse_date(data.get("posa_delivery_date"))
        or parse_date(data.get("transaction_date"))
        or parse_date(data.get("posting_date"))
        or str(getdate(nowdate()))
    )
    data["delivery_date"] = order_delivery_date

    # Map item level delivery dates
    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue

        item_delivery = (
            parse_date(item.get("delivery_date"))
            or parse_date(item.get("posa_delivery_date"))
            or order_delivery_date
        )
        if item_delivery:
            item["delivery_date"] = item_delivery
            item.setdefault("posa_delivery_date", item_delivery)


@frappe.whitelist(methods=["POST"])
def update_sales_order(data):
    """Create or update a Sales Order document."""
    data = json.loads(data)
    # Scope: SO is a financial commitment — caller's company + profile
    # (when present) + customer (when present) must all be in their POS
    # Profile membership (REVIEW2/03 §2.1 row sales_orders.py).
    from posawesome.posawesome.api._scope import (
        assert_company,
        assert_customer_in_profile,
        assert_profile,
    )
    pos_profile = data.get("pos_profile") or data.get("posa_pos_profile")
    if pos_profile:
        assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, data.get("company"))
    assert_customer_in_profile(frappe.session.user, data.get("customer"), pos_profile)
    _map_delivery_dates(data)
    if data.get("name") and frappe.db.exists("Sales Order", data.get("name")):
        so_doc = frappe.get_doc("Sales Order", data.get("name"))
        so_doc.update(data)
    else:
        so_doc = frappe.get_doc(data)

    so_doc.flags.ignore_permissions = True
    so_doc.docstatus = 0
    from posawesome.posawesome.api._perms import account_perm_bypass
    with account_perm_bypass():
        so_doc.save()
    return so_doc


def _create_payment_entries(so_doc, payments):
    """Create payment entries referencing the sales order."""
    for pay in payments or []:
        if not pay.get("amount"):
            continue

        # Create payment entry using helper to ensure exchange rates are set
        pe = create_payment_entry(
            company=so_doc.company,
            customer=so_doc.customer,
            amount=pay.get("amount"),
            currency=pay.get("currency") or so_doc.currency,
            mode_of_payment=pay.get("mode_of_payment"),
            reference_no=so_doc.get("posa_pos_opening_shift"),
            reference_date=nowdate(),
            posting_date=nowdate(),
            submit=0,
        )

        # Link payment entry to the sales order
        pe.append(
            "references",
            {
                "allocated_amount": pay.get("amount"),
                "reference_doctype": "Sales Order",
                "reference_name": so_doc.name,
            },
        )

        pe.flags.ignore_permissions = True
        from posawesome.posawesome.api._perms import account_perm_bypass
        with account_perm_bypass():
            pe.save()
            pe.submit()


@frappe.whitelist(methods=["POST"])
def submit_sales_order(order):
    """Submit sales order and create payment entries."""
    order = json.loads(order)
    # Scope mirrors update_sales_order — submit creates payment entries
    # via _create_payment_entries which writes journal entries; gating
    # here is mandatory (REVIEW2/03 §2.1 row sales_orders.py).
    from posawesome.posawesome.api._scope import (
        assert_company,
        assert_customer_in_profile,
        assert_profile,
    )
    pos_profile = order.get("pos_profile") or order.get("posa_pos_profile")
    if pos_profile:
        assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, order.get("company"))
    assert_customer_in_profile(frappe.session.user, order.get("customer"), pos_profile)
    _map_delivery_dates(order)
    if order.get("name") and frappe.db.exists("Sales Order", order.get("name")):
        so_doc = frappe.get_doc("Sales Order", order.get("name"))
        so_doc.update(order)
    else:
        so_doc = frappe.get_doc(order)

    payments = order.get("payments")

    so_doc.flags.ignore_permissions = True
    from posawesome.posawesome.api._perms import account_perm_bypass
    with account_perm_bypass():
        so_doc.save()
        so_doc.submit()

    if payments:
        frappe.enqueue(
            "posawesome.posawesome.api.sales_orders._payment_entry_job",
            queue="short",
            order_name=so_doc.name,
            payments=payments,
        )

    # Payment entries run in the background to speed up checkout

    return {"name": so_doc.name, "status": so_doc.docstatus}
