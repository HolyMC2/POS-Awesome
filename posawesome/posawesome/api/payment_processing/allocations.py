"""Allocate submitted invoice balances using ERPNext's party-currency contract."""

import frappe
from frappe import _
from frappe.utils import flt


def allocate_payment_references(payment, invoices, party_type, payment_type, party_currency, precision):
    direction = 1 if payment_type == ("Pay" if party_type == "Supplier" else "Receive") else -1
    party_amount = flt(payment.get("paid_amount" if payment_type == "Receive" else "received_amount"), precision)
    remaining = party_amount
    if invoices:
        from erpnext.accounts.doctype.payment_entry.payment_entry import get_reference_details
    for invoice in invoices:
        if remaining <= 0:
            break
        doctype = invoice.get("voucher_type") or "Sales Invoice"
        document = frappe.get_doc(doctype, invoice["name"], for_update=True)
        if document.docstatus != 1:
            frappe.throw(_("Only submitted invoices can receive payments."))
        outstanding = flt(document.outstanding_amount, precision)
        if outstanding * direction < 0:
            frappe.throw(_("Selected invoice balance does not match the payment direction."))
        if not outstanding:
            continue
        details = get_reference_details(doctype, document.name, party_currency, party_type, payment.get("party"))
        party_account = payment.get("paid_from" if payment_type == "Receive" else "paid_to")
        if details.get("account") != party_account:
            frappe.throw(_("Selected invoice uses a different party account from this payment."))
        allocated = min(remaining, abs(outstanding))
        payment.append("references", {
            "reference_doctype": doctype,
            "reference_name": document.name,
            "total_amount": details.total_amount,
            # Use the locked current balance, not a repeatable-read snapshot.
            "outstanding_amount": outstanding,
            "allocated_amount": direction * allocated,
            "exchange_rate": details.exchange_rate,
        })
        remaining = flt(remaining - allocated, precision)
    if direction < 0 and remaining > 0:
        frappe.throw(_("Refund exceeds the outstanding credit on the selected invoices."))
    return flt(party_amount - remaining, precision), party_amount
