"""Serialize charge-request claims and complete them with the invoice commit."""

import frappe
from frappe import _


def _contract():
    from doco.docoutils import charge_contract
    return charge_contract


def linked_request(invoice):
    if not frappe.db.exists("DocType", "POS Charge Request"):
        return None
    contract = _contract()
    marker = contract.request_from_remarks(invoice.get("remarks"))
    bound = frappe.db.get_value("POS Charge Request", {
        "invoice_doctype": invoice.doctype, "invoice": invoice.name}, "name") if invoice.name else None
    if bound and marker != bound:
        frappe.throw(_("The source charge request link cannot be removed from this invoice."))
    if not (bound or marker):
        return None
    request = frappe.get_doc("POS Charge Request", bound or marker, for_update=True)
    if request.settle_mode == "Source":
        frappe.throw(_("This request must be settled through its source document."))
    return request


def before_submit(invoice, method=None):
    if invoice.get("is_return"):
        return
    request = linked_request(invoice)
    if not request:
        return
    if request.status != "Open":
        frappe.throw(_("This charge request is no longer open."))
    _contract().validate_invoice(request, invoice, submitted=False)
    # Legacy exact-marker drafts acquire the same durable claim before posting.
    frappe.db.set_value("POS Charge Request", request.name,
                       {"invoice_doctype": invoice.doctype, "invoice": invoice.name})


def on_submit(invoice, method=None):
    if invoice.get("is_return"):
        return
    request = linked_request(invoice)
    if request:
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
    request = frappe.get_doc("POS Charge Request", name, for_update=True)
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
        _contract().validate_invoice(request, existing, submitted=False)
        frappe.db.set_value("POS Charge Request", request.name,
                           {"invoice_doctype": existing.doctype, "invoice": existing.name})
        return existing.as_dict()
    if request.status != "Open":
        frappe.throw(_("This charge request has already been completed."))
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
    doc.insert(ignore_permissions=True)
    _contract().validate_invoice(request, doc, submitted=False)
    frappe.db.set_value("POS Charge Request", request.name,
                       {"invoice_doctype": doc.doctype, "invoice": doc.name})
    return doc.as_dict()
