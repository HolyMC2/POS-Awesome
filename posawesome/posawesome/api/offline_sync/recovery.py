"""Explicit, audited recovery of one saved sale after terminal transfer."""
import json

import frappe
from frappe import _
from frappe.utils import cint

from posawesome.posawesome.api.shift_terminal import _load, _manager, assert_terminal_access


@frappe.whitelist(methods=["POST"])
def recover_terminal_invoice(opening_shift, invoice, data, reason, acknowledge_saved_work=0,
                             terminal_id=None, terminal_generation=None, terminal_token=None, verify_only=0):
    if not _manager():
        frappe.throw(_("A POS supervisor must authorize saved-sale recovery."), frappe.PermissionError)
    reason = str(reason or "").strip()
    if not cint(acknowledge_saved_work) or not 8 <= len(reason) <= 1000:
        frappe.throw(_("Review this individual sale and record its recovery reason before posting it."))
    invoice = json.loads(invoice) if isinstance(invoice, str) else dict(invoice or {})
    data = json.loads(data) if isinstance(data, str) else dict(data or {})
    request_id = str(invoice.get("posa_client_request_id") or data.get("idempotency_key") or "").strip()
    if not request_id or len(request_id) > 140:
        frappe.throw(_("Saved sale has no valid original request ID; export it for manual reconciliation."))
    target = _load(opening_shift)
    assert_terminal_access(opening_shift, terminal_id, terminal_generation, terminal_token, acting_user=target.user)
    if invoice.get("company") != target.company or invoice.get("pos_profile") != target.pos_profile:
        frappe.throw(_("Recover this sale on an open shift of its original company and POS profile."), frappe.PermissionError)

    from posawesome.posawesome.api.idempotency import find_invoice_by_client_request_id
    from posawesome.posawesome.api.invoice_processing.creation import repair_invoice_submission, submit_invoice
    from posawesome.posawesome.api.payment_processing.integrity import lock_payment_party
    lock_payment_party("Customer", invoice.get("customer"))
    existing = find_invoice_by_client_request_id(request_id, preferred_doctype=invoice.get("doctype") or "Sales Invoice")
    if existing:
        existing = frappe.get_doc(existing.doctype, existing.name, for_update=True)
    if existing and (existing.company != target.company or existing.pos_profile != target.pos_profile):
        frappe.throw(_("This request ID already belongs to a different register."), frappe.PermissionError)
    if existing and existing.customer != invoice.get("customer"):
        frappe.throw(_("This request ID belongs to a different customer. Saved work remains pending."), frappe.PermissionError)
    if cint(verify_only) and (not existing or cint(existing.docstatus) != 1):
        frappe.throw(_("This historical acknowledgement has no submitted server match. Export it for manual reconciliation."))
    if existing and cint(existing.docstatus) == 2:
        frappe.throw(_("This saved sale was cancelled on the server. Review the cancellation instead of posting it again."))

    manager = frappe.session.user
    old_shift = invoice.get("posa_pos_opening_shift") or "unassigned"
    old_terminal = str(data.get("terminal_id") or "unassigned")[:80]
    old_generation = cint(data.get("terminal_generation"))
    # The saved secret is never copied into an audit or server document.
    data.pop("terminal_token", None)
    for key in ("terminal_id", "terminal_generation", "terminal_token"):
        invoice.pop(key, None)
    audit = _("Manager {0} reviewed request {1}; original shift {2}, terminal {3}, generation {4}. {5}").format(
        manager, request_id, old_shift, old_terminal, old_generation, reason)
    if existing and cint(existing.docstatus) == 0:
        # Explicit manager delegation of this exact draft, after opening ->
        # customer -> invoice locks. Retain the same document and request ID.
        audit += _(" Original draft {0}, owner {1}, shift {2}; assigned to cashier {3}.").format(
            existing.name, existing.owner, existing.get("posa_pos_opening_shift") or "unassigned", target.user)
        frappe.db.set_value(existing.doctype, existing.name, {
            "owner": target.user, "posa_pos_opening_shift": opening_shift,
        })
        invoice["name"] = existing.name
        invoice["owner"] = target.user
    elif not existing:
        # A client name is not proof that an unrelated saved draft belongs to
        # this request. Let normal idempotency create/recover by request ID.
        invoice.pop("name", None)
    frappe.get_doc("POS Opening Shift", opening_shift).add_comment("Info", text=frappe.utils.escape_html(audit))
    try:
        # This is an explicit supervisor delegation to the selected cashier's
        # drawer; normal profile, stock, tax, credit and ledger gates still run.
        frappe.set_user(target.user)
        if existing and cint(existing.docstatus) == 1:
            result = repair_invoice_submission(request_id, target.company, target.pos_profile, existing.doctype)
        else:
            invoice["owner"] = target.user
            invoice["posa_client_request_id"] = request_id
            invoice["posa_pos_opening_shift"] = opening_shift
            data.update(idempotency_key=request_id, client_request_id=request_id, terminal_id=terminal_id,
                        terminal_generation=terminal_generation, terminal_token=terminal_token)
            result = submit_invoice(json.dumps(invoice), json.dumps(data), submit_in_background=0)
    finally:
        frappe.set_user(manager)
    if cint((result or {}).get("docstatus", (result or {}).get("status"))) != 1 or not (result or {}).get("name"):
        frappe.throw(_("Recovered sale is not submitted yet. Saved work remains pending for review."))
    return {"acknowledged": True, "client_request_id": request_id,
            "invoice": {"name": result["name"], "doctype": result.get("doctype") or "Sales Invoice", "docstatus": 1}}
