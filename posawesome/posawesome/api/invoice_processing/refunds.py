"""Cash-backed refund limits, using ERPNext's submitted payment allocations."""

import frappe
from frappe import _
from frappe.utils import flt


INVOICE_TYPES = ("Sales Invoice", "POS Invoice")


def _bank_cash_account(name, company, currency=None):
    if not name:
        return False
    account = frappe.get_cached_value(
        "Account", name, ["company", "account_type", "account_currency"], as_dict=True
    )
    return bool(account and account.company == company and account.account_type in ("Cash", "Bank")
                and (not currency or account.account_currency == currency))


def _embedded_money(doc):
    """Payment rows are in invoice currency; gift liabilities are not cash."""
    if not doc.get("is_pos"):
        # Credit/advance settlement can leave display-only payment rows. Its
        # actual money is booked by Payment Entries and must be counted once.
        return 0.0
    paid = sum(flt(row.get("amount")) for row in doc.get("payments", [])
               if _bank_cash_account(row.get("account"), doc.company))
    if doc.get("is_return"):
        return max(-paid, 0)
    return max(paid - max(flt(doc.get("change_amount")), 0), 0)


def _current_embedded_money(doctype, name, company):
    # Frappe loads child tables with ordinary snapshot reads, even when the
    # parent was locked. Read tender rows explicitly so a just-finished refund
    # cannot disappear behind an older transaction snapshot.
    rows = frappe.db.sql(
        f"select company, is_pos, is_return, change_amount from `tab{doctype}` where name = %s for update",
        (name,), as_dict=True,
    )
    if not rows:
        frappe.throw(_("An invoice changed while calculating the refund. Please retry."))
    child_type = frappe.get_meta(doctype).get_field("payments").options
    if child_type not in ("Sales Invoice Payment", "POS Invoice Payment"):
        frappe.throw(_("Unsupported invoice payment table for a cash refund."))
    rows[0].payments = frappe.db.sql(
        f"select account, amount from `tab{child_type}` where parent = %s and parenttype = %s for update",
        (name, doctype), as_dict=True,
    )
    return _embedded_money(rows[0])


def _party_currency_factor(original):
    """ERPNext references use receivable-account currency, not invoice currency."""
    currency = frappe.get_cached_value("Account", original.debit_to, "account_currency")
    if currency == original.currency:
        return currency, 1.0
    company_currency = frappe.get_cached_value("Company", original.company, "default_currency")
    conversion = flt(original.get("conversion_rate"))
    if currency == company_currency and conversion > 0:
        return currency, 1.0 / conversion
    frappe.throw(_("Cannot determine the original invoice currency conversion for this refund."))


def _cash_allocation(payment, references, target_names, original, party_currency, incoming):
    """Attribute only money-backed principal, in receivable-account currency.

    ERPNext does not assign a Payment Entry deduction to an individual reference.
    When receipts mix cash with write-offs/credit notes, distribute the actual
    cash proportionally across positive allocations. This preserves the cash
    budget across invoices rather than allowing each to refund the same funds.
    """
    expected_type = "Receive" if incoming else "Pay"
    party_side = "paid_from" if incoming else "paid_to"
    bank_side = "paid_to" if incoming else "paid_from"
    if (payment.get("docstatus") != 1 or payment.get("payment_type") != expected_type
            or payment.get("party_type") != "Customer" or payment.get("party") != original.customer
            or payment.get("company") != original.company or payment.get(party_side) != original.debit_to
            or payment.get(party_side + "_account_currency") != party_currency
            or not _bank_cash_account(payment.get(bank_side), original.company,
                                      payment.get(bank_side + "_account_currency"))):
        return 0.0
    exchange = flt(payment.get("source_exchange_rate" if incoming else "target_exchange_rate"))
    if exchange <= 0:
        frappe.throw(_("Cannot determine the payment currency conversion for this refund."))
    cash = max(flt(payment.get("base_received_amount" if incoming else "base_paid_amount")), 0) / exchange
    eligible = [row for row in references if (flt(row.get("allocated_amount")) > 0 if incoming
                                             else flt(row.get("allocated_amount")) != 0)]
    allocated = sum(abs(flt(row.get("allocated_amount"))) for row in eligible)
    selected = sum(abs(flt(row.get("allocated_amount"))) for row in eligible
                   if (row.get("reference_doctype"), row.get("reference_name")) in target_names)
    if allocated <= 0:
        return 0.0
    return selected * min(cash / allocated, 1.0)


def _payment_rows(doctype, invoice_names, original):
    """Current reads, including complete allocations for each relevant payment.

    The original-invoice lock serializes POS refunds. FOR UPDATE here avoids an
    older repeatable-read snapshot after waiting on another refund transaction.
    ERPNext cancellations/reconciliation must also finish before these locked
    payment and reference rows can change.
    """
    names = tuple(invoice_names)
    payments = frappe.db.sql(
        """select distinct pe.* from `tabPayment Entry` pe
        inner join `tabPayment Entry Reference` ref on ref.parent = pe.name
        where pe.docstatus = 1 and pe.company = %(company)s
          and pe.party_type = 'Customer' and pe.party = %(customer)s
          and ref.reference_doctype = %(doctype)s and ref.reference_name in %(names)s
        order by pe.name for update""",
        {"doctype": doctype, "names": names, "company": original.company, "customer": original.customer},
        as_dict=True,
    )
    if not payments:
        return []
    receipt_names = tuple(row.name for row in payments if row.payment_type == "Receive")
    if receipt_names:
        # ERPNext also refunds an advance by making a reverse Payment Entry
        # against the receipt itself rather than against its invoice.
        reversed_payments = frappe.db.sql(
            """select distinct pe.* from `tabPayment Entry` pe
            inner join `tabPayment Entry Reference` ref on ref.parent = pe.name
            where pe.docstatus = 1 and pe.payment_type = 'Pay' and pe.company = %(company)s
              and pe.party_type = 'Customer' and pe.party = %(customer)s
              and ref.reference_doctype = 'Payment Entry' and ref.reference_name in %(names)s
            order by pe.name for update""",
            {"names": receipt_names, "company": original.company, "customer": original.customer}, as_dict=True,
        )
        seen = {row.name for row in payments}
        payments.extend(row for row in reversed_payments if row.name not in seen)
    references = frappe.db.sql(
        """select parent, reference_doctype, reference_name, allocated_amount
        from `tabPayment Entry Reference` where parent in %(names)s order by parent, idx for update""",
        {"names": tuple(row.name for row in payments)}, as_dict=True,
    )
    return [(payment, [row for row in references if row.parent == payment.name]) for payment in payments]


def refundable_cash(invoice_doc):
    """Remaining paid funds; original row stays locked until submit/rollback."""
    doctype = invoice_doc.doctype
    if doctype not in INVOICE_TYPES:
        frappe.throw(_("Unsupported invoice type for a cash refund."))
    from posawesome.posawesome.api.payment_processing.integrity import lock_payment_party

    original_customer = frappe.db.get_value(doctype, invoice_doc.return_against, "customer")
    lock_payment_party("Customer", original_customer)
    original = frappe.get_doc(doctype, invoice_doc.return_against, for_update=True)
    if (original.docstatus != 1 or original.get("is_return")
            or original.company != invoice_doc.company or original.customer != invoice_doc.customer
            or original.currency != invoice_doc.currency or original.customer != original_customer):
        frappe.throw(_("The original invoice must be submitted and match this return's customer, company and currency."))
    party_currency, factor = _party_currency_factor(original)
    # The interpolated table name is restricted by INVOICE_TYPES above.
    returns = frappe.db.sql(
        f"""select name, currency from `tab{doctype}`
        where return_against = %s and is_return = 1 and docstatus = 1
          and company = %s and customer = %s and name != %s order by name for update""",
        (original.name, original.company, original.customer, invoice_doc.get("name") or ""), as_dict=True,
    )
    if any(row.currency != original.currency for row in returns):
        frappe.throw(_("A previous return has a different currency; reconcile it before issuing another cash refund."))
    refunded = sum(_current_embedded_money(doctype, row.name, original.company) for row in returns)
    original_target = {(doctype, original.name)}
    refund_targets = original_target | {(doctype, row.name) for row in returns}
    received = _current_embedded_money(doctype, original.name, original.company)
    payment_rows = _payment_rows(doctype, [name for _, name in refund_targets], original)
    for payment, references in payment_rows:
        receipt = payment.copy()
        if payment.payment_type == "Receive":
            reversed_amount = sum(
                _cash_allocation(payout, refs, {("Payment Entry", payment.name)}, original, party_currency, False)
                for payout, refs in payment_rows if payout.payment_type == "Pay"
            )
            receipt["base_received_amount"] = max(
                flt(receipt.get("base_received_amount")) - reversed_amount * flt(receipt.get("source_exchange_rate")), 0
            )
        received += _cash_allocation(receipt, references, original_target, original, party_currency, True) * factor
        refunded += _cash_allocation(payment, references, refund_targets, original, party_currency, False) * factor
    # Tender/receipts above the ticket belong to the customer's advance balance.
    total = max(flt(original.get("rounded_total") or original.get("grand_total")), 0)
    return max(min(received, total) - refunded, 0)
