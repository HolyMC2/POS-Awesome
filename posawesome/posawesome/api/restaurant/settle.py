# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""Settle a Record-Only ticket into an accounting document.

This is the ONE place the table world touches the ledger. It does not build
its own submit path: it hands the invoice to the shipped
``invoice_processing.creation.submit_invoice``, which owns the durable
submission ledger (SHA-256 over ``client_request_id|company|pos_profile|
doctype``, race-safe on the DocType PK). Reusing it means a lost ack replays
into the same invoice instead of a duplicate sale (spec §2.3, §6.2).

``Settling`` is the only stored transient in the whole design, and it exists
solely so a double-settle under a lost ack is answerable.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from posawesome.posawesome.api.restaurant._tickets import (
    OPEN_STATUS,
    SETTLING_STATUS,
    get_scoped_order,
    publish_order_change,
)
from posawesome.posawesome.api.restaurant.orders import _current_user_shift, order_payload


def _parse_payload(invoice_payload):
    if invoice_payload in (None, ""):
        return {}
    if isinstance(invoice_payload, dict):
        return dict(invoice_payload)
    try:
        parsed = json.loads(invoice_payload)
    except (TypeError, ValueError):
        frappe.throw(_("invoice_payload must be valid JSON."))
        return {}
    if not isinstance(parsed, dict):
        frappe.throw(_("invoice_payload must be a JSON object."))
    return parsed


def _target_doctype(pos_profile):
    """Mirror the resolution submit_invoice does, for the stamp/link decision."""
    if pos_profile and frappe.db.get_value(
        "POS Profile", pos_profile, "create_pos_invoice_instead_of_sales_invoice"
    ):
        return "POS Invoice"
    return "Sales Invoice"


def _invoice_items(order):
    """Invoice lines from the ORDER's lines — the payload does not get a vote.

    `rate` is pinned as `price_list_rate` too so the price list cannot
    re-derive a rate the waiter never quoted; update_invoice already runs
    with `ignore_pricing_rule`.
    """
    items = []
    for row in order.items or []:
        line = {
            "item_code": row.item_code,
            "qty": flt(row.qty),
            "rate": flt(row.rate),
            "price_list_rate": flt(row.rate),
        }
        if row.item_name:
            line["item_name"] = row.item_name
        if row.uom:
            line["uom"] = row.uom
        items.append(line)
    return items


def _build_invoice(order, payload, client_request_id):
    """Order lines + provenance stamps merged OVER the client's payload.

    The payload supplies what only the till knows — payments, taxes,
    discounts, the customer the cashier picked. Scope, lines and provenance
    come from the fetched order, so a crafted payload cannot settle one
    table's food against another register's books.
    """
    invoice = dict(payload)
    invoice.pop("name", None)
    invoice.pop("modified", None)

    invoice["pos_profile"] = order.pos_profile
    invoice["company"] = order.company
    invoice["is_pos"] = 1
    invoice["items"] = _invoice_items(order)

    customer = payload.get("customer") or order.customer
    if not customer:
        customer = frappe.db.get_value("POS Profile", order.pos_profile, "customer")
    if not customer:
        frappe.throw(_("No customer on the order and no default customer on the POS Profile."))
    invoice["customer"] = customer

    # The money lands in the shift that takes it, not the one the table was
    # opened on — a dinner service crossing a shift boundary is a policy
    # choice, and stamping yesterday's shift is the silent-loss version.
    invoice["posa_pos_opening_shift"] = (
        payload.get("posa_pos_opening_shift")
        or _current_user_shift(order.pos_profile)
        or order.pos_opening_shift
    )

    if client_request_id:
        invoice["posa_client_request_id"] = client_request_id

    # Provenance for reporting / reprint on the accounting document. Unknown
    # keys are ignored by Frappe on insert, so a site that has not migrated
    # the fixture yet simply drops them instead of failing the sale.
    invoice["posa_rt_table"] = order.table
    invoice["posa_rt_table_order"] = order.name
    invoice["posa_rt_waiter"] = order.waiter or order.opened_by
    invoice["posa_rt_tab_name"] = order.tab_name
    invoice["posa_rt_guest_count"] = cint(order.guest_count)
    invoice["posa_rt_service_type"] = order.service_type

    return invoice


def _settled_response(order, invoice_name, invoice_result=None, idempotent=False):
    """The settle contract — FROZEN, the offline wrapper is coded against it.

    `invoice_result` carries what `invoice_processing.creation.submit_invoice`
    returned (name, docstatus, status, doctype), which is what the SPA payment
    path reads to drive print, change-due and navigation.

    On the idempotent-replay branches it is deliberately None: a replay must
    not re-run the submit, and the seam handles that case explicitly by
    fetching the document by `sales_invoice` when it needs one. Do not
    "helpfully" populate it here — the offline layer distinguishes a replay
    from a fresh settle on exactly this.

    The `sales_invoice` KEY is frozen even though the stored field behind it
    is now the `settled_invoice` Dynamic Link. The wire name stays; the
    frontend never learns the column changed.
    """
    return {
        "order": order.name,
        "order_uid": order.order_uid,
        "status": order.status,
        "sales_invoice": invoice_name,
        "invoice_result": invoice_result,
        "idempotent": bool(idempotent),
    }


def _finalise(order, invoice_name, invoice_doctype, source_device=None):
    """Mark the order settled and hand the table to the bussing flow.

    The reference is a Dynamic Link pair: `settled_doctype` comes from what
    the invoice_processing path ACTUALLY created, not from re-reading the
    profile flag, so a register whose flag changed between opening and
    settling still points at the real document.
    """
    frappe.db.set_value(
        "POS Table Order",
        order.name,
        {
            "status": "Settled",
            "settled_doctype": invoice_doctype,
            "settled_invoice": invoice_name,
        },
    )
    order.status = "Settled"
    order.settled_doctype = invoice_doctype
    order.settled_invoice = invoice_name

    if order.table:
        frappe.db.set_value(
            "POS Table",
            order.table,
            {"needs_cleaning": 1, "bill_printed_at": None},
        )

    publish_order_change(order, source_device=source_device)


@frappe.whitelist(methods=["POST"])
def settle_table_order(
    name_or_uid,
    client_request_id=None,
    invoice_payload=None,
    source_device=None,
):
    """Materialise + submit the accounting document for an open ticket."""
    order = get_scoped_order(name_or_uid)

    if order.status == "Settled":
        return _settled_response(order, order.settled_invoice, idempotent=True)
    if order.status == "Cancelled":
        frappe.throw(_("Order {0} was cancelled and cannot be settled.").format(order.name))
    if order.status == SETTLING_STATUS and order.settled_invoice:
        # A prior attempt got its ack lost after the invoice landed.
        return _settled_response(order, order.settled_invoice, idempotent=True)
    if not order.items:
        frappe.throw(_("Order {0} has no lines to settle.").format(order.name))

    payload = _parse_payload(invoice_payload)
    invoice = _build_invoice(order, payload, client_request_id)
    submit_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}

    frappe.db.set_value("POS Table Order", order.name, "status", SETTLING_STATUS)
    order.status = SETTLING_STATUS

    from posawesome.posawesome.api.invoice_processing import creation

    try:
        # TWO steps, and the order matters. `update_invoice` re-derives the
        # payments table from the POS Profile and zeroes it — correct for a
        # draft mid-build, fatal if it were the last word, because the
        # payments-vs-grand-total invariant then rejects the submit. The SPA
        # never hits that: it holds a draft from the cart session and sends
        # `name`, so submit takes the update-the-existing-doc branch and the
        # tendered payments land. Settle creates its document in one shot, so
        # it has to make that same shape itself.
        draft = creation.update_invoice(json.dumps(invoice, default=str))
        invoice["name"] = (draft or {}).get("name")
        result = creation.submit_invoice(json.dumps(invoice, default=str), json.dumps(submit_data, default=str))
    except Exception:
        # Back to Open so the waiter can retry from the same board state.
        # (A whitelisted request would roll this back anyway; the explicit
        # revert is what makes an in-process caller see a usable order.)
        frappe.db.set_value("POS Table Order", order.name, "status", OPEN_STATUS)
        order.status = OPEN_STATUS
        raise

    invoice_name = (result or {}).get("name")
    if not invoice_name:
        frappe.db.set_value("POS Table Order", order.name, "status", OPEN_STATUS)
        order.status = OPEN_STATUS
        frappe.throw(_("Settlement did not return an invoice for order {0}.").format(order.name))

    # The doctype the path actually created, not the profile flag re-read:
    # the flag could have been flipped between opening and settling.
    invoice_doctype = (result or {}).get("doctype") or _target_doctype(order.pos_profile)

    _finalise(order, invoice_name, invoice_doctype, source_device=source_device)
    return _settled_response(order, invoice_name, invoice_result=result)


@frappe.whitelist(methods=["GET", "POST"])
def get_settlement_state(name_or_uid):
    """Where a settle got to — the client's recovery read after a lost ack."""
    order = get_scoped_order(name_or_uid)
    return {
        "order": order.name,
        "status": order.status,
        # Wire name frozen; the stored field behind it is settled_invoice.
        "sales_invoice": order.settled_invoice,
        "settled_doctype": order.settled_doctype,
        "target_doctype": _target_doctype(order.pos_profile),
        "payload": order_payload(order),
    }
