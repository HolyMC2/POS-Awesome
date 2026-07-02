# Copyright (c) 2026, doco contributors
"""Pull-model billing: consume generic doco "POS Charge Request" docs.

External verticals (taller repairs, etc.) create charge requests instead of
pushing invoice drafts into a guessed per-user shift. The cashier lists Open
requests, loads one into the cart (invoice is born in THEIR shift, priced
from the request's current lines), and after submitting calls mark-charged.

Everything is gated twice: the doctype must exist (doco installed) and the
POS Profile must opt in via posa_use_charge_requests — the feature is
invisible otherwise, keeping this fork feature vertical-neutral.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint

from posawesome.posawesome.api._scope import assert_company, assert_profile

CHARGE_REQUEST_DOCTYPE = "POS Charge Request"


def _feature_enabled(pos_profile: str) -> bool:
    if not frappe.db.exists("DocType", CHARGE_REQUEST_DOCTYPE):
        return False
    return bool(
        cint(frappe.db.get_value("POS Profile", pos_profile, "posa_use_charge_requests") or 0)
    )


def _assert_feature(pos_profile: str):
    assert_profile(frappe.session.user, pos_profile)
    if not _feature_enabled(pos_profile):
        frappe.throw(_("Charge requests are not enabled for this POS Profile."))


@frappe.whitelist(methods=["GET", "POST"])
def get_open_charge_requests(pos_profile):
    """Open requests visible to this profile: same company, and either
    unpinned or pinned to this exact profile."""
    _assert_feature(pos_profile)
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    assert_company(frappe.session.user, company)

    rows = frappe.get_all(
        CHARGE_REQUEST_DOCTYPE,
        filters={"status": "Open", "company": company},
        or_filters=[["pos_profile", "is", "not set"], ["pos_profile", "=", pos_profile]],
        fields=[
            "name",
            "customer",
            "source_label",
            "amount_total",
            "reference_doctype",
            "reference_name",
            "creation",
        ],
        order_by="creation asc",
        limit_page_length=100,
    )
    customer_names = {
        row.customer: frappe.db.get_value("Customer", row.customer, "customer_name")
        for row in rows
        if row.customer
    }
    for row in rows:
        row["customer_name"] = customer_names.get(row.customer) or row.customer
    return rows


@frappe.whitelist(methods=["GET", "POST"])
def load_charge_request(name, pos_profile):
    """Full payload for building the cart. Validates the request is still
    Open and inside the caller's company scope."""
    _assert_feature(pos_profile)
    request = frappe.get_doc(CHARGE_REQUEST_DOCTYPE, name)
    assert_company(frappe.session.user, request.company)
    if request.status != "Open":
        frappe.throw(
            _("Charge request {0} is {1} — someone already handled it.").format(
                request.name, _(request.status)
            )
        )
    return {
        "name": request.name,
        "customer": request.customer,
        "company": request.company,
        "source_label": request.source_label,
        "reference_doctype": request.reference_doctype,
        "reference_name": request.reference_name,
        "amount_total": request.amount_total,
        "items": json.loads(request.items_json or "[]"),
    }


def _request_marker(name: str) -> str:
    return f"POS Charge Request: {name}"


@frappe.whitelist(methods=["POST"])
def prepare_charge_request_invoice(name, pos_profile, pos_opening_shift):
    """Build (insert) the draft invoice for a charge request in the CALLING
    cashier's own shift and return the full doc for the cart.

    This is the pull-model core: the invoice is born where it will be paid —
    owner = the cashier, shift = the cashier's — so it behaves like any other
    draft (visible, closable, purgeable). Re-loading the same request returns
    the existing draft instead of stacking duplicates (remarks marker)."""
    _assert_feature(pos_profile)
    request = frappe.get_doc(CHARGE_REQUEST_DOCTYPE, name)
    assert_company(frappe.session.user, request.company)
    if request.status != "Open":
        frappe.throw(
            _("Charge request {0} is {1} — someone already handled it.").format(
                request.name, _(request.status)
            )
        )
    if not pos_opening_shift or not frappe.db.exists(
        "POS Opening Shift",
        {"name": pos_opening_shift, "status": "Open", "docstatus": 1, "user": frappe.session.user},
    ):
        frappe.throw(_("You need your own open POS shift to load a charge request."))

    use_pos_invoice = cint(
        frappe.db.get_value("POS Profile", pos_profile, "create_pos_invoice_instead_of_sales_invoice")
        or 0
    )
    doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"

    marker = _request_marker(request.name)

    # Money guard 1: if a SUBMITTED invoice already carries this request's
    # marker (browser died between submit and mark-charged), reconcile the
    # request instead of minting a second bill.
    submitted = frappe.db.get_value(
        doctype, {"docstatus": 1, "remarks": ["like", f"%{marker}%"]}, "name"
    )
    if submitted:
        request.mark_charged(doctype, submitted)
        frappe.throw(
            _(
                "This request was already charged with invoice {0} — it has now "
                "been marked as completed. Do not charge it again."
            ).format(submitted)
        )

    # Money guard 2: a live draft for this request in ANOTHER cashier's shift
    # means someone else is mid-charge — don't create a competing bill.
    existing = frappe.db.get_value(
        doctype,
        {"docstatus": 0, "remarks": ["like", f"%{marker}%"]},
        ["name", "posa_pos_opening_shift", "owner"],
        as_dict=True,
    )
    if existing:
        if existing.posa_pos_opening_shift == pos_opening_shift:
            return frappe.get_doc(doctype, existing.name).as_dict()
        frappe.throw(
            _(
                "Charge request {0} is already being charged by {1} (draft {2}). "
                "Coordinate before charging it twice."
            ).format(request.name, existing.owner, existing.name)
        )

    doc = frappe.new_doc(doctype)
    doc.customer = request.customer
    doc.company = request.company
    doc.pos_profile = pos_profile
    doc.posa_pos_opening_shift = pos_opening_shift
    doc.remarks = marker
    if use_pos_invoice:
        doc.is_pos = 1
        doc.update_stock = 1
    for line in request.get_items():
        doc.append(
            "items",
            {
                "item_code": line.get("item_code"),
                "qty": float(line.get("qty") or 0),
                "uom": line.get("uom"),
                "rate": float(line.get("rate") or 0),
                "description": line.get("description"),
            },
        )
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def mark_charge_request_charged(name, pos_profile, invoice_doctype, invoice_name):
    """Flip Open → Charged after the POS submitted the invoice.

    Validates hard before writing: the invoice must exist, be SUBMITTED and
    belong to the request's customer — a wrong/failed submit must never
    consume the request. Failures here are surfaced by the SPA as loud
    errors (the sale itself already stands)."""
    _assert_feature(pos_profile)
    request = frappe.get_doc(CHARGE_REQUEST_DOCTYPE, name)
    assert_company(frappe.session.user, request.company)

    if invoice_doctype not in ("Sales Invoice", "POS Invoice"):
        frappe.throw(_("Unsupported invoice doctype {0}.").format(invoice_doctype))
    row = frappe.db.get_value(
        invoice_doctype, invoice_name, ["docstatus", "customer", "company"], as_dict=True
    )
    if not row:
        frappe.throw(_("Invoice {0} not found.").format(invoice_name))
    if cint(row.docstatus) != 1:
        frappe.throw(_("Invoice {0} is not submitted yet.").format(invoice_name))
    if row.customer != request.customer:
        frappe.throw(
            _("Invoice {0} belongs to {1}, not to the request's customer {2}.").format(
                invoice_name, row.customer, request.customer
            )
        )
    assert_company(frappe.session.user, row.company)

    request.mark_charged(invoice_doctype, invoice_name)
    return {"name": request.name, "status": request.status, "invoice": invoice_name}
