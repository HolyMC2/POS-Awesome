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

    fields = [
        "name",
        "customer",
        "source_label",
        "amount_total",
        "reference_doctype",
        "reference_name",
        "creation",
    ]
    # settle_mode (order hub, critique D3): "Source" rows are settled by
    # their reference's own spine — the SPA offers that trigger instead of
    # the cart load. The column ships with doco; a doco mid-rollout must
    # keep its queue rather than 500 on a column migrate has not created.
    has_settle_mode = frappe.db.has_column(CHARGE_REQUEST_DOCTYPE, "settle_mode")
    if has_settle_mode:
        fields.append("settle_mode")
    rows = frappe.get_all(
        CHARGE_REQUEST_DOCTYPE,
        filters={"status": "Open", "company": company},
        or_filters=[["pos_profile", "is", "not set"], ["pos_profile", "=", pos_profile]],
        fields=fields,
        order_by="creation asc",
        limit_page_length=100,
    )
    if not has_settle_mode:
        for row in rows:
            row["settle_mode"] = "Register"
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
    if str(getattr(request, "settle_mode", "") or "") == "Source":
        # Order hub (critique D3): a Source-mode request settles through its
        # reference's own spine (a storefront apartado's stock recheck +
        # autobill). Building a SECOND invoice from its lines here would bill
        # the same goods twice — refuse, and point at the right verb. Server
        # side, so a stale SPA cannot cart-load one either.
        frappe.throw(
            _(
                "Request {0} ({1}) is settled through its source document — "
                "use «Registrar pago» on the request instead of loading it "
                "into the cart."
            ).format(request.name, request.source_label or request.reference_name)
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


_MARKER_PREFIX = "POS Charge Request: "


def reassert_request_line_warehouses(invoice_doc) -> None:
    """Re-stamp producer-owned warehouses on a pulled charge-request invoice.

    The request's items_json is a server-priced contract — rate AND warehouse
    (taller's consume-first WIP flow bills transferred parts FROM "Taller
    WIP"; billing them from the sellable warehouse deducts stock a SECOND
    time and strands the WIP qty — live 2026-08-29, RO-01090..95). The
    contract does not survive on its own: ERPNext's set_missing_values →
    set_pos_fields(update_data=True) rewrites EVERY row warehouse to the POS
    profile default on each update_invoice, and the client's cart rebuilds
    drop it too. So update_invoice calls this right after set_missing_values,
    the one authority the whole pipeline funnels through.

    Only rows whose item_code carries an UNAMBIGUOUS warehouse in items_json
    are touched: lines without one keep the profile default (partially
    transferred parts bill from the sellable warehouse on purpose), and an
    item_code that appears with two different warehouses is skipped
    (fail-open to the old behavior rather than guessing). Cashier-added
    extra items are never in the map, so they are untouched. Fail-soft: a
    missing/renamed request must never block the sale."""
    remarks = invoice_doc.get("remarks") or ""
    if not remarks.startswith(_MARKER_PREFIX):
        return
    request_name = remarks[len(_MARKER_PREFIX):].split(" ·", 1)[0].strip()
    if not request_name:
        return
    try:
        request = frappe.get_doc(CHARGE_REQUEST_DOCTYPE, request_name)
        warehouses = {}
        ambiguous = set()
        for line in request.get_items():
            code = line.get("item_code")
            wh = line.get("warehouse")
            if not code or not wh:
                continue
            if code in warehouses and warehouses[code] != wh:
                ambiguous.add(code)
            warehouses[code] = wh
        for code in ambiguous:
            warehouses.pop(code, None)
        if not warehouses:
            return
        for row in invoice_doc.get("items") or []:
            wh = warehouses.get(row.item_code)
            if wh:
                row.warehouse = wh
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"charge_requests: warehouse reassert failed for invoice {invoice_doc.get('name')}",
        )


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
    # The marker leads (both dedup queries above match on its prefix); the
    # source label rides behind a middle dot so the ledger panel can NAME the
    # workshop order («RO-08699 — TWIP DEV») without a lookup per selection.
    doc.remarks = f"{marker} · {request.source_label}" if request.source_label else marker
    if use_pos_invoice:
        doc.is_pos = 1
        doc.update_stock = 1
    for line in request.get_items():
        row = {
            "item_code": line.get("item_code"),
            "qty": float(line.get("qty") or 0),
            "uom": line.get("uom"),
            "rate": float(line.get("rate") or 0),
            "description": line.get("description"),
        }
        # Honor the producer's per-line warehouse. Taller's consume-first WIP
        # flow stamps fully-transferred parts with the WIP warehouse — losing
        # it here made update_stock deduct from the sellable warehouse a
        # SECOND time (the transfer already took the part), stranding the WIP
        # qty forever (caught live 2026-08-29, RO-01090). Absent → ERPNext
        # fills the POS profile warehouse at validate, as always.
        if line.get("warehouse"):
            row["warehouse"] = line.get("warehouse")
        doc.append("items", row)
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
def get_status_board_context():
    """A status-board screen's boot (critique D4, the KDS/kiosk pattern).

    The board itself reads the SAME scoped queue endpoints the Orden surface
    uses — this only answers "which registers may this login project?": the
    profiles the user is assigned to whose charge-request feature is on. An
    account with none is told so instead of shown an empty wall.
    """
    frappe.has_permission("POS Profile", "read", throw=True)
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
        row = frappe.db.get_value("POS Profile", name, ["name", "disabled"], as_dict=True)
        if not row or cint(row.disabled):
            continue
        if not _feature_enabled(name):
            continue
        profiles.append({"pos_profile": name})
    return {"profiles": profiles}


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
        # Dict syntax, not "count(name) as total": the HTTP API path runs
        # get_all with string-SQL-function validation ON and 417s the whole
        # probe (bench console does not, which is how this shipped green).
        # The alias frappe mints for a dict COUNT is version-detail — read
        # the row's single value instead of naming it.
        rows = frappe.get_all(
            CHARGE_REQUEST_DOCTYPE,
            filters={"status": status, "company": company},
            or_filters=_profile_or_filters(pos_profile),
            fields=[{"COUNT": "name"}],
        )
        return cint(next(iter(rows[0].values()))) if rows else 0

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
    queue_fields = [
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
    ]
    # Order hub (critique D3): guarded like the list read — a doco mid-rollout
    # keeps its queue, and every row simply reads "Register".
    has_settle_mode = frappe.db.has_column(CHARGE_REQUEST_DOCTYPE, "settle_mode")
    if has_settle_mode:
        queue_fields.append("settle_mode")
    rows = frappe.get_all(
        CHARGE_REQUEST_DOCTYPE,
        filters={"status": status, "company": company},
        or_filters=_profile_or_filters(pos_profile),
        fields=queue_fields,
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
