# Copyright (c) 2026, doco contributors
"""Pull-model billing: consume generic doco "POS Charge Request" docs.

External verticals (taller repairs, etc.) create charge requests instead of
pushing invoice drafts into a guessed per-user shift. The cashier lists Open
requests, loads one into the cart (invoice is born in THEIR shift, priced
from the request's current lines), and after submitting calls mark-charged.

Everything is gated twice: the doctype must exist (doco installed) and the
POS Profile must opt in — either via the legacy posa_use_charge_requests flag
or by declaring the external_document_checkout capability on its linked
capability preset (the same additive gate the SPA uses). The feature is
invisible otherwise, keeping this fork feature vertical-neutral.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint

from posawesome.posawesome.api import charge_request_read_model as read_model
from posawesome.posawesome.api._scope import assert_company, assert_profile
from posawesome.posawesome.api.vertical import shift_effective_capability_payload

CHARGE_REQUEST_DOCTYPE = "POS Charge Request"
CHARGE_REQUEST_CAPABILITY = "external_document_checkout"


def _capability_enabled(pos_profile: str) -> bool:
    """True when the profile's capability preset declares
    external_document_checkout.

    Mirrors verticalStore's additive gate: a preset that declares the
    capability shows the Pending Charges UI, so the endpoints behind it must
    agree or every click throws "not enabled". A role-gated entry
    (``capability:Some Role``) counts only when the authenticated session user
    holds that role, matching the frontend gate. Never raises: an unresolvable
    preset or role lookup just means "not enabled".
    """
    try:
        # Shift-aware (roadmap F1): an open shift resolves from its stamped
        # contract (next-shift activation); the kill switch subtracts live.
        payload = shift_effective_capability_payload(pos_profile) or {}
        capabilities = payload.get("capabilities") or []
        user_roles = None
        for entry in capabilities:
            capability, separator, required_role = str(entry).partition(":")
            if capability.strip() != CHARGE_REQUEST_CAPABILITY:
                continue
            required_role = required_role.strip() if separator else ""
            if not required_role:
                return True
            if user_roles is None:
                user_roles = set(frappe.get_roles(frappe.session.user) or [])
            if required_role in user_roles:
                return True
        return False
    except Exception:
        return False


def _feature_enabled(pos_profile: str) -> bool:
    if not frappe.db.exists("DocType", CHARGE_REQUEST_DOCTYPE):
        return False
    if cint(frappe.db.get_value("POS Profile", pos_profile, "posa_use_charge_requests") or 0):
        return True
    return _capability_enabled(pos_profile)


def _assert_feature(pos_profile: str):
    assert_profile(frappe.session.user, pos_profile)
    if not _feature_enabled(pos_profile):
        frappe.throw(_("Charge requests are not enabled for this POS Profile."))


def _assert_request_profile(request, pos_profile: str):
    """Reject a fetched request pinned to a different POS Profile."""
    pinned_profile = str(getattr(request, "pos_profile", None) or "").strip()
    if pinned_profile and pinned_profile != str(pos_profile or "").strip():
        frappe.throw(
            _("Charge request {0} is assigned to POS Profile {1}.").format(
                request.name, pinned_profile
            ),
            frappe.PermissionError,
        )


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
    _assert_request_profile(request, pos_profile)
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
    _assert_request_profile(request, pos_profile)
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
    _assert_request_profile(request, pos_profile)

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


# --------------------------------------------------------------------------
# Read model for the Orden de servicio surface (artboard `Orden.dc.html`).
#
# Shaping lives in `charge_request_read_model`; these three stay thin, and
# every one of them re-asks `_assert_feature` — a read is still a read of
# another tenant's repair queue if the gate is skipped.
# --------------------------------------------------------------------------

# How many requests one bucket may return. A register's open queue is small by
# nature (a charged request leaves the list), and the surface narrows by search
# over what it has been given rather than round-tripping per keystroke.
QUEUE_PAGE_LENGTH = 120


def _profile_or_filters(pos_profile: str) -> list:
    """Unpinned requests, or ones pinned to exactly this profile.

    The same rule `get_open_charge_requests` has always applied, written once
    now that three readers need it.
    """
    return [["pos_profile", "is", "not set"], ["pos_profile", "=", pos_profile]]


@frappe.whitelist(methods=["GET", "POST"])
def get_service_order_counts(pos_profile):
    """The three numbers over the queue column, and the rail's badge.

    Deliberately cheap: two COUNTs and (with taller installed) a third. The
    shell probes this once per session for `serviceOrderOpenCount`, so it sits
    on the hottest path in the product and must never grow a join.

    `working` is None on a tenant without taller and the chip is not drawn —
    see `working_repair_count` for why that is not zero.
    """
    _assert_feature(pos_profile)
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    assert_company(frappe.session.user, company)

    def _count(status: str) -> int:
        rows = frappe.get_all(
            CHARGE_REQUEST_DOCTYPE,
            filters={"status": status, "company": company},
            or_filters=_profile_or_filters(pos_profile),
            fields=["count(name) as total"],
        )
        return cint(rows[0].get("total")) if rows else 0

    return {
        "ready": _count("Open"),
        "working": read_model.working_repair_count(),
        "delivered": _count("Charged"),
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_service_order_queue(pos_profile, bucket="ready"):
    """One bucket of the queue column, as cards.

    `working` is not served here on purpose. Those orders are not billable —
    the workshop still has them — and returning them would put a card on a
    surface whose only verb is COBRAR Y ENTREGAR. The chip shows the count;
    the work itself lives in Taller, which is where it is done.
    """
    _assert_feature(pos_profile)
    bucket = str(bucket or "ready")
    if bucket not in ("ready", "delivered"):
        frappe.throw(_("Unknown service order bucket {0}.").format(bucket))
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    assert_company(frappe.session.user, company)

    status = "Open" if bucket == "ready" else "Charged"
    rows = frappe.get_all(
        CHARGE_REQUEST_DOCTYPE,
        filters={"status": status, "company": company},
        or_filters=_profile_or_filters(pos_profile),
        fields=[
            "name",
            "customer",
            "source_label",
            "amount_total",
            "status",
            "reference_doctype",
            "reference_name",
            "invoice",
            "creation",
            "charged_at",
        ],
        # Ready oldest-first (the customer has been waiting); delivered
        # newest-first (the cashier is looking for what just left).
        order_by="creation asc" if bucket == "ready" else "charged_at desc",
        limit_page_length=QUEUE_PAGE_LENGTH,
    )

    customers = {
        row.customer: frappe.db.get_value(
            "Customer", row.customer, ["customer_name", "mobile_no"], as_dict=True
        )
        for row in rows
        if row.customer
    }
    repair_names = [
        row.reference_name
        for row in rows
        if row.reference_name and row.reference_doctype == read_model.REPAIR_ORDER_DOCTYPE
    ]
    repairs = read_model.fetch_repair_cards(repair_names)
    serials = read_model.fetch_repair_serials(repair_names)

    cards = []
    for row in rows:
        contact = customers.get(row.customer) or {}
        row["customer_name"] = contact.get("customer_name") or row.customer
        row["customer_phone"] = contact.get("mobile_no")
        cards.append(
            read_model.describe_order_card(
                row,
                repairs.get(row.reference_name),
                serials.get(row.reference_name),
            )
        )
    return cards


@frappe.whitelist(methods=["GET", "POST"])
def get_service_order_detail(pos_profile, name):
    """Everything the detail panel and the band need for ONE order.

    Money is echoed, never recomputed: `amount_total` is the charge request's
    own figure — the same one `prepare_charge_request_invoice` prices the
    invoice from — and `advance` is taller's persisted `advance_amount`. A
    read model that added its own arithmetic would be a second opinion about
    what the customer owes, and the band would show whichever one loaded last.
    """
    _assert_feature(pos_profile)
    request = frappe.get_doc(CHARGE_REQUEST_DOCTYPE, name)
    assert_company(frappe.session.user, request.company)
    _assert_request_profile(request, pos_profile)

    row = request.as_dict()
    contact = (
        frappe.db.get_value(
            "Customer", request.customer, ["customer_name", "mobile_no"], as_dict=True
        )
        or {}
    )
    row["customer_name"] = contact.get("customer_name") or request.customer
    row["customer_phone"] = contact.get("mobile_no")
    repair = None
    serials: list[str] = []
    if request.reference_doctype == read_model.REPAIR_ORDER_DOCTYPE and request.reference_name:
        repair = read_model.fetch_repair_cards([request.reference_name]).get(
            request.reference_name
        )
        serials = read_model.fetch_repair_serials([request.reference_name]).get(
            request.reference_name, []
        )

    card = read_model.describe_order_card(row, repair, serials)
    parts = read_model.fetch_repair_parts((repair or {}).get("name") or "")
    card.update(
        {
            "technician": (repair or {}).get("technician") or (repair or {}).get("received_by"),
            "received_on": (repair or {}).get("work_started_on"),
            "finished_on": (repair or {}).get("work_finished_on"),
            "worked_minutes": read_model.worked_minutes(
                (repair or {}).get("work_started_on"), (repair or {}).get("work_finished_on")
            ),
            "warranty_expires_on": (repair or {}).get("warranty_expires_on"),
            "lines": read_model.describe_order_lines(
                request.get_items(), parts, read_model.resolve_labor_item()
            ),
        }
    )
    return card
