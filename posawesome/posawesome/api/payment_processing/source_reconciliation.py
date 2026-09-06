"""Allocate existing receipts and credit/debit notes through ERPNext's engine."""

import frappe
from frappe import _
from frappe.utils import flt

from posawesome.posawesome.api.payment_processing.integrity import payment_amount, run_reconciliation


def reconcile_source(source, invoices, company, party_type, party, requested_amount=None):
    """Sources and targets are locked by the caller; recheck current documents."""
    invoice_type = "Purchase Invoice" if party_type == "Supplier" else "Sales Invoice"
    party_field = "supplier" if party_type == "Supplier" else "customer"
    account_field = "credit_to" if party_type == "Supplier" else "debit_to"
    if source.docstatus != 1 or source.company != company:
        frappe.throw(_("Only submitted payments and credit notes from this company can be reconciled."))
    if source.doctype == "Payment Entry":
        if (
            source.party_type != party_type
            or source.party != party
            or source.payment_type != ("Pay" if party_type == "Supplier" else "Receive")
        ):
            frappe.throw(_("Selected payment has the wrong payment direction for reconciliation."))
        account = source.paid_to if party_type == "Supplier" else source.paid_from
        available = flt(source.unallocated_amount)
        exchange = source.target_exchange_rate if party_type == "Supplier" else source.source_exchange_rate
    elif source.doctype == invoice_type and source.get(party_field) == party and source.is_return:
        account = source.get(account_field)
        available = -flt(source.outstanding_amount)
        exchange = source.conversion_rate
    else:
        frappe.throw(_("Selected credit note does not belong to this party."))
    if available <= 0:
        frappe.throw(_("Selected payment or credit note has no available balance."))
    budget = min(available, payment_amount(requested_amount)) if requested_amount is not None else available
    account_currency = frappe.get_cached_value("Account", account, "account_currency")
    targets = []
    for row in invoices:
        if row["voucher_type"] != invoice_type:
            frappe.throw(_("Selected invoice does not match the reconciliation party type."))
        target = frappe.get_doc(invoice_type, row["name"], for_update=True)
        if (
            target.docstatus != 1
            or target.company != company
            or target.get(party_field) != party
            or target.get(account_field) != account
        ):
            frappe.throw(_("Reconciliation requires submitted invoices using the same party account."))
        outstanding = flt(target.outstanding_amount)
        if outstanding > 0:
            targets.append(
                dict(
                    invoice_type=invoice_type,
                    invoice_number=target.name,
                    invoice_date=target.posting_date,
                    amount=target.grand_total,
                    outstanding_amount=outstanding,
                    currency=account_currency,
                )
            )
    if not targets:
        frappe.throw(_("No outstanding invoices are available for this reconciliation."))
    payment = dict(
        reference_type=source.doctype,
        reference_name=source.name,
        posting_date=source.posting_date,
        amount=budget,
        exchange_rate=exchange,
        currency=account_currency,
        cost_center=source.get("cost_center"),
    )
    reconciliation = frappe.new_doc("Payment Reconciliation")
    reconciliation.update(
        dict(
            company=company,
            party_type=party_type,
            party=party,
            receivable_payable_account=account,
            invoices=targets,
            payments=[payment],
        )
    )
    for dimension in reconciliation.dimensions:
        if source.get(dimension.fieldname):
            reconciliation.set(dimension.fieldname, source.get(dimension.fieldname))
    reconciliation.allocate_entries({"invoices": targets, "payments": [payment]})
    reconciliation.validate_allocation()
    allocated = sum(flt(row.allocated_amount) for row in reconciliation.allocation)
    run_reconciliation(reconciliation.reconcile_allocations)
    current = frappe.get_doc(source.doctype, source.name, for_update=True)
    remaining = (
        flt(current.unallocated_amount)
        if source.doctype == "Payment Entry"
        else -flt(current.outstanding_amount)
    )
    if abs((available - remaining) - allocated) > 0.009:
        frappe.throw(_("The reconciled balance did not match the requested allocation."))
    for row in invoices:
        row["outstanding_amount"] = flt(
            frappe.get_doc(row["voucher_type"], row["name"], for_update=True).outstanding_amount
        )
    return current, allocated
