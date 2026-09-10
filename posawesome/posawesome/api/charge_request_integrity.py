"""Serialize charge-request claims and complete them with the invoice commit."""

from html import escape

import frappe
from frappe import _


def _contract():
    from doco.docoutils import charge_contract
    return charge_contract


def linked_request(invoice, *, allow_source=False):
    if not frappe.db.exists("DocType", "POS Charge Request"):
        return None
    contract = _contract()
    marker = contract.request_from_remarks(invoice.get("remarks"))
    bound = frappe.db.get_value("POS Charge Request", {
        "invoice_doctype": invoice.doctype, "invoice": invoice.name}, "name") if invoice.name else None
    if not (bound or marker):
        return None
    request = contract.lock_request(bound or marker)
    if bound and request.settle_mode != "Source" and marker != bound:
        frappe.throw(_("The source charge request link cannot be removed from this invoice."))
    if request.settle_mode == "Source" and not allow_source:
        frappe.throw(_("This request must be settled through its source document."))
    return request


def before_submit(invoice, method=None):
    if invoice.get("is_return"):
        return
    request = linked_request(invoice)
    if not request:
        return
    if request.status == "Cancelled":
        _validate_amendment(request, invoice)
        return  # Keep the cancelled claim intact until this native submit succeeds.
    if request.status != "Open":
        frappe.throw(_("This charge request is no longer open."))
    _validate_source_quote(request)
    _contract().validate_invoice(request, invoice, submitted=False)
    # Legacy exact-marker drafts acquire the same durable claim before posting.
    frappe.db.set_value("POS Charge Request", request.name,
                       {"invoice_doctype": invoice.doctype, "invoice": invoice.name})


def on_submit(invoice, method=None):
    if invoice.get("is_return"):
        return
    request = linked_request(invoice)
    if request and request.status == "Cancelled":
        if invoice.docstatus != 1:
            frappe.throw(_("An amendment must be submitted before rebinding its charge request."))
        _validate_amendment(request, invoice)
        old_invoice = request.invoice
        values = {"status": "Charged", "invoice_doctype": invoice.doctype, "invoice": invoice.name,
                  "charged_by": frappe.session.user, "charged_at": frappe.utils.now_datetime(),
                  "callback_status": "Pending", "callback_attempts": 0, "callback_error": "",
                  "callback_next_retry": frappe.utils.now_datetime()}
        # Private native hook path: no client flag or whitelisted rebind operation.
        frappe.db.set_value("POS Charge Request", request.name, values)
        request.add_comment("Info", _("Cancelled invoice {0} was replaced by amendment {1}.").format(escape(old_invoice), escape(invoice.name)))
        from doco.docoutils.charge_callbacks import enqueue_delivery
        enqueue_delivery(request.name)
    elif request:
        request.mark_charged(invoice.doctype, invoice.name)


def _existing_invoice(request):
    if request.invoice:
        doc = frappe.get_doc(request.invoice_doctype, request.invoice) if frappe.db.exists(
            request.invoice_doctype, request.invoice) else None
        if doc and doc.docstatus != 2:
            return doc
        # A deleted/cancelled claim can be rebuilt, but never a submitted bill.
        frappe.db.set_value("POS Charge Request", request.name, {"invoice": None, "invoice_doctype": None})
        request.invoice = request.invoice_doctype = None
    candidates = []
    for doctype in _contract().INVOICE_TYPES:
        rows = frappe.get_all(doctype, filters={"company": request.company,
            "customer": request.customer, "docstatus": ["<", 2],
            "remarks": ["like", f"POS Charge Request: {request.name}%"]},
            fields=["name", "remarks"], limit_page_length=0)
        candidates.extend((doctype, row.name) for row in rows
                          if _contract().request_from_remarks(row.remarks) == request.name)
    if len(candidates) > 1:
        frappe.throw(_("Several invoices reference this request. A supervisor must reconcile them before collecting payment."))
    return frappe.get_doc(*candidates[0]) if candidates else None


def prepare(name, pos_profile, pos_opening_shift, terminal_id=None,
            terminal_generation=None, terminal_token=None):
    from posawesome.posawesome.api.charge_requests import _assert_feature, _assert_request_profile
    from posawesome.posawesome.api.shift_terminal import assert_terminal_access
    from posawesome.posawesome.api._scope import assert_company, assert_customer_in_profile

    shift = assert_terminal_access(pos_opening_shift, terminal_id, terminal_generation, terminal_token)
    _assert_feature(pos_profile)
    if shift.pos_profile != pos_profile:
        frappe.throw(_("The opening shift belongs to a different POS Profile."))
    request = _contract().lock_request(name)
    assert_company(frappe.session.user, request.company)
    assert_customer_in_profile(frappe.session.user, request.customer, pos_profile)
    _assert_request_profile(request, pos_profile)
    if request.company != shift.company:
        frappe.throw(_("The charge request belongs to a different company."))
    if request.settle_mode == "Source":
        frappe.throw(_("This request must be settled through its source document."))
    if request.status == "Cancelled":
        frappe.throw(_("This charge request was cancelled."))
    existing = _existing_invoice(request)
    if existing:
        if existing.docstatus == 1:
            request.mark_charged(existing.doctype, existing.name)
            return {"name": existing.name, "doctype": existing.doctype, "already_charged": True,
                    "callback_status": request.callback_status}
        if existing.get("posa_pos_opening_shift") != shift.name or existing.owner != frappe.session.user:
            frappe.throw(_("Another cashier or shift is already collecting this request."))
        _validate_source_quote(request)
        _contract().validate_invoice(request, existing, submitted=False)
        frappe.db.set_value("POS Charge Request", request.name,
                           {"invoice_doctype": existing.doctype, "invoice": existing.name})
        return existing.as_dict()
    if request.status != "Open":
        frappe.throw(_("This charge request has already been completed."))
    _validate_source_quote(request)
    use_pos = frappe.utils.cint(frappe.db.get_value("POS Profile", pos_profile,
                               "create_pos_invoice_instead_of_sales_invoice"))
    doc = frappe.new_doc("POS Invoice" if use_pos else "Sales Invoice")
    doc.update({"customer": request.customer, "company": request.company,
                "currency": request.currency or frappe.get_cached_value("Company", request.company, "default_currency"),
                "pos_profile": pos_profile, "posa_pos_opening_shift": shift.name,
                "remarks": f"POS Charge Request: {request.name}" +
                (f" · {request.source_label}" if request.source_label else "")})
    if use_pos:
        doc.is_pos = doc.update_stock = 1
    for line in _contract().validated_items(request.items_json):
        doc.append("items", {key: line[key] for key in
                   ("item_code", "qty", "rate", "uom", "warehouse", "description") if line.get(key) is not None})
    # Source controllers own their privileged identity/billing references.
    # Never forward those fields from caller-controlled items_json.
    source = frappe.get_doc(request.reference_doctype, request.reference_name, for_update=True)
    prepare_source = getattr(source, "prepare_pos_charge_request_invoice", None)
    if callable(prepare_source):
        prepare_source(request, doc)
    from posawesome.posawesome.api.pricing_context import apply_invoice_exchange_rates
    profile = frappe.get_doc("POS Profile", pos_profile)
    apply_invoice_exchange_rates(doc, profile)
    if use_pos:
        from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
        for mode in profile.payments:
            doc.append("payments", {"mode_of_payment": mode.mode_of_payment, "amount": 0,
                "account": get_bank_cash_account(mode.mode_of_payment, doc.company).get("account"),
                "type": frappe.get_cached_value("Mode of Payment", mode.mode_of_payment, "type")})
    doc.insert(ignore_permissions=True)
    _contract().validate_invoice(request, doc, submitted=False)
    frappe.db.set_value("POS Charge Request", request.name,
                       {"invoice_doctype": doc.doctype, "invoice": doc.name})
    return doc.as_dict()


def _validate_source_quote(request):
    source = frappe.get_doc(request.reference_doctype, request.reference_name, for_update=True)
    validate = getattr(source, "validate_pos_charge_request_quote", None)
    if callable(validate):
        validate(request)


def _validate_amendment(request, invoice):
    if (request.settle_mode != "Register" or not request.invoice
            or invoice.get("amended_from") != request.invoice
            or invoice.doctype != request.invoice_doctype
            or frappe.db.get_value(request.invoice_doctype, request.invoice, "docstatus", for_update=True) != 2):
        frappe.throw(_("This retired request can only be collected through an amendment of its cancelled invoice."))
    other = frappe.db.get_value("POS Charge Request", {
        "reference_doctype": request.reference_doctype, "reference_name": request.reference_name,
        "name": ["!=", request.name], "status": ["in", ["Open", "Charged"]]}, "name", for_update=True)
    if other:
        frappe.throw(_("Another charge already exists for this source. Review it before amending the cancelled invoice."))
    # Compare every original source constraint without changing its historical claim.
    contract = frappe._dict(request.as_dict())
    contract.invoice = contract.invoice_doctype = None
    _contract().validate_invoice(contract, invoice, submitted=False)
    _validate_source_quote(request)


def on_cancel(invoice, method=None):
    if invoice.get("is_return"):
        return
    request = linked_request(invoice, allow_source=True)
    if not request or (request.invoice_doctype, request.invoice) != (invoice.doctype, invoice.name):
        return
    if invoice.docstatus != 2:
        frappe.throw(_("The invoice must be cancelled before retiring its charge request."))
    frappe.db.set_value("POS Charge Request", request.name, {
        "status": "Cancelled", "callback_status": "Cancelled", "callback_next_retry": None,
        "callback_error": "The linked invoice was cancelled. Review its reversal before creating another charge.",
    })
    request.add_comment("Info", _("Invoice {0} was cancelled. Its source history is retained; review any delivery or payment outside this invoice.").format(escape(invoice.name)))


def release(name, pos_profile, pos_opening_shift, invoice_name, terminal_id=None,
            terminal_generation=None, terminal_token=None):
    """Retire an untouched cashier draft; preserve it so stale retries fail closed."""
    from posawesome.posawesome.api.charge_requests import _assert_feature, _assert_request_profile
    from posawesome.posawesome.api.shift_terminal import assert_terminal_access
    shift = assert_terminal_access(pos_opening_shift, terminal_id, terminal_generation, terminal_token)
    _assert_feature(pos_profile)
    request = _contract().lock_request(name)
    _assert_request_profile(request, pos_profile)
    if shift.pos_profile != pos_profile or shift.company != request.company:
        frappe.throw(_("The charge request belongs to a different register or company."), frappe.PermissionError)
    if request.settle_mode != "Register" or not request.invoice or request.invoice != invoice_name:
        frappe.throw(_("The pinned draft changed. Refresh pending charges before releasing it."))
    invoice = frappe.get_doc(request.invoice_doctype, request.invoice, for_update=True)
    if (invoice.docstatus != 0 or invoice.owner != frappe.session.user
            or invoice.pos_profile != pos_profile or invoice.get("posa_pos_opening_shift") != shift.name
            or invoice.company != request.company or invoice.customer != request.customer):
        frappe.throw(_("Only the owning cashier can release this register's unsubmitted draft."), frappe.PermissionError)
    if request.status == "Cancelled":
        return {"released": True, "name": request.name, "invoice": invoice.name}
    if request.status != "Open":
        frappe.throw(_("A completed charge cannot be released."))
    if (any(frappe.utils.flt(invoice.get(key)) for key in
            ("paid_amount", "base_paid_amount", "write_off_amount", "loyalty_amount", "redeem_loyalty_points"))
            or any(frappe.utils.flt(row.amount) for row in invoice.get("payments") or [])
            or invoice.get("advances")):
        frappe.throw(_("This draft contains a payment intent. Review saved payments before releasing it."))
    ledgers = frappe.get_all("POS Invoice Submission Ledger", filters={
        "document_type": invoice.doctype, "invoice_name": invoice.name}, pluck="name", limit=1)
    request_id = invoice.get("posa_client_request_id")
    if request_id:
        ledgers += frappe.get_all("POS Invoice Submission Ledger", filters={
            "client_request_id": request_id}, pluck="name", limit=1)
    if ledgers or frappe.db.exists("Payment Entry Reference", {
            "reference_doctype": invoice.doctype, "reference_name": invoice.name, "docstatus": 1}):
        frappe.throw(_("Submission or payment processing has started. Review the original transaction before releasing it."))
    frappe.db.set_value("POS Charge Request", request.name, {
        "status": "Cancelled", "callback_status": "Cancelled", "callback_next_retry": None,
    })
    request.add_comment("Info", _("Cashier released unsubmitted draft {0}; the draft is retained and cannot collect this retired request.").format(escape(invoice.name)))
    source = frappe.get_doc(request.reference_doctype, request.reference_name, for_update=True)
    refresh = getattr(source, "on_pos_charge_request_released", None)
    replacement = refresh(request) if callable(refresh) else None
    return {"released": True, "name": request.name, "invoice": invoice.name,
            "replacement": replacement.get("name") if isinstance(replacement, dict) else None}


@frappe.whitelist(methods=["POST"])
def release_charge_request_draft(name, pos_profile, pos_opening_shift, invoice_name,
                                 terminal_id=None, terminal_generation=None, terminal_token=None):
    from posawesome.posawesome.api.charge_request_integrity import release
    from posawesome.posawesome.api.payment_processing.integrity import retry_before_financial_writes
    return retry_before_financial_writes(release, name, pos_profile, pos_opening_shift, invoice_name,
                                        terminal_id, terminal_generation, terminal_token)


def can_release(request, profile):
    if not request.get("invoice") or request.get("invoice_doctype") not in _contract().INVOICE_TYPES:
        return False
    draft = frappe.db.get_value(request.invoice_doctype, request.invoice,
        ["docstatus", "owner", "pos_profile", "posa_pos_opening_shift"], as_dict=True)
    return bool(draft and draft.docstatus == 0 and draft.owner == frappe.session.user
                and draft.pos_profile == profile and draft.posa_pos_opening_shift)
