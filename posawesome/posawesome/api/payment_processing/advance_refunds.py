"""Explicit, quoted refunds of one customer's unused advance through ERPNext."""
import hashlib
import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, nowdate

from .integrity import authorize_reconciliation, lock_payment_party, payment_amount, retry_before_financial_writes, run_reconciliation
from .request_ledger import claim_financial_request
from .utils import get_bank_cash_account
from posawesome.posawesome.api.shift_terminal import assert_terminal_access


def _payload(payload, *, posting=False):
    data = json.loads(payload) if isinstance(payload, str) else dict(payload or {})
    if not isinstance(data, dict):
        frappe.throw(_("Invalid advance refund request."))
    for field, alias in (("pos_profile", "pos_profile_name"), ("pos_opening_shift", "pos_opening_shift_name"), ("customer", "party")):
        if not data.get(field):
            data[field] = data.get(alias)
    for field in ("original_payment_entry", "customer", "pos_profile", "pos_opening_shift", "mode_of_payment"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            frappe.throw(_("Original payment, customer, register, shift and refund method are required."))
        data[field] = data[field].strip()
    data["amount"] = payment_amount(data.get("amount"))
    if posting:
        data["expected_paid_amount"] = payment_amount(data.get("expected_paid_amount"))
        data["reason"] = str(data.get("reason") or "").strip()
        if not 8 <= len(data["reason"]) <= 1000:
            frappe.throw(_("Record a refund reason of 8 to 1000 characters."))
        if not isinstance(data.get("client_request_id"), str) or not data["client_request_id"].strip() or len(data["client_request_id"]) > 140:
            frappe.throw(_("A valid original refund request ID is required."))
        data["client_request_id"] = data["client_request_id"].strip()
    return data


def _refund_request_id(data):
    return "advance-refund:" + hashlib.sha256(data["client_request_id"].encode()).hexdigest()


def _assert_manual_method(mode, company):
    method = frappe.get_doc("Mode of Payment", mode)
    blocked = {"mercadopago point", "mercadopago", "m-pesa", "mpesa"}
    if frappe.db.exists("DocType", "MercadoPago Settings"):
        settings = frappe.get_cached_doc("MercadoPago Settings")
        blocked.update(str(settings.get(key) or "").casefold() for key in ("point_mode_of_payment", "online_mode_of_payment"))
    if frappe.db.exists("DocType", "Mpesa C2B Register URL"):
        blocked.update(str(value).casefold() for value in frappe.get_all("Mpesa C2B Register URL", filters={"company": company}, pluck="mode_of_payment"))
    if mode.casefold() in blocked or method.type not in ("Cash", "Bank"):
        frappe.throw(_("This payment method requires provider refund confirmation. Choose a manual cash or bank refund method."))
    if not cint(method.get("enabled")):
        frappe.throw(_("This refund payment method is disabled."))


def _context(data):
    opening = assert_terminal_access(data["pos_opening_shift"], data.get("terminal_id"),
        data.get("terminal_generation"), data.get("terminal_token"))
    if opening.pos_profile != data["pos_profile"]:
        frappe.throw(_("The refund shift must belong to the selected POS Profile."), frappe.PermissionError)
    profile = frappe.get_doc("POS Profile", data["pos_profile"])
    authorize_reconciliation(opening.company, "Customer", data["customer"], profile.name)
    if not cint(profile.get("posa_allow_make_new_payments")):
        frappe.throw(_("Creating new payments is not enabled for this POS Profile"), frappe.PermissionError)
    allowed = {row.mode_of_payment for row in profile.get("payments") or []}
    if data["mode_of_payment"] not in allowed:
        frappe.throw(_("Mode of payment is not available on this POS Profile."), frappe.PermissionError)
    _assert_manual_method(data["mode_of_payment"], opening.company)
    bank = get_bank_cash_account(opening.company, data["mode_of_payment"])
    if not bank or not bank.get("account"):
        frappe.throw(_("Configure a bank or cash account for this refund method."))
    account = frappe.get_doc("Account", bank.account)
    if account.company != opening.company or account.is_group or account.disabled or account.account_type not in ("Cash", "Bank"):
        frappe.throw(_("Payment account must be an active bank or cash account in this company."), frappe.PermissionError)
    frappe.has_permission("Account", "read", account.name, throw=True)
    frappe.has_permission("Payment Entry", "read", data["original_payment_entry"], throw=True)
    lock_payment_party("Customer", data["customer"])
    existing = []
    if data.get("client_request_id"):
        existing = frappe.get_all("Payment Entry", filters={"posa_client_request_id": _refund_request_id(data)}, pluck="name")
    documents = {name: frappe.get_doc("Payment Entry", name, for_update=True)
        for name in sorted(set(existing + [data["original_payment_entry"]]))}
    original = documents[data["original_payment_entry"]]
    if original.docstatus != 1 or original.payment_type != "Receive" or original.party_type != "Customer":
        frappe.throw(_("Only a submitted customer advance received by the company can be refunded."))
    if original.company != opening.company or original.party != data["customer"]:
        frappe.throw(_("The original advance belongs to a different customer or company."), frappe.PermissionError)
    original_account = frappe.get_doc("Account", original.paid_from)
    if original_account.company != opening.company or original_account.account_currency != original.paid_from_account_currency:
        frappe.throw(_("The advance account currency or company no longer matches its original payment."))
    return opening, profile, original, account, documents, existing


def _server_rate(currency, company_currency, date):
    if currency == company_currency:
        return 1.0
    settings = frappe.get_cached_doc("Accounts Settings")
    filters = [["from_currency", "=", currency], ["to_currency", "=", company_currency],
        ["date", "<=", date], ["for_buying", "=", 1]]
    if not settings.get("allow_stale"):
        filters.append(["date", ">", add_days(date, -cint(settings.get("stale_days")))])
    rates = frappe.get_all("Currency Exchange", filters=filters, fields=["exchange_rate"], order_by="date desc", limit_page_length=1)
    if not rates:
        frappe.throw(_("Configure a current buying Currency Exchange rate before refunding this advance."))
    return payment_amount(rates[0].exchange_rate)


def _quote(data, profile, original, account):
    precision = original.precision("unallocated_amount")
    precision = 2 if precision is None else precision
    amount = flt(data["amount"], precision)
    if amount <= 0 or abs(amount - data["amount"]) > 1e-9:
        frappe.throw(_("Refund amount has more decimals than the advance currency allows."))
    available = flt(original.unallocated_amount, precision)
    if amount > available:
        frappe.throw(_("Refund amount exceeds the current unused advance balance."))
    company_currency = frappe.get_cached_value("Company", original.company, "default_currency")
    currency = original.paid_from_account_currency
    paid_currency = account.account_currency
    date = nowdate()
    party_rate = _server_rate(currency, company_currency, date)
    bank_rate = _server_rate(paid_currency, company_currency, date)
    prototype = frappe.new_doc("Payment Entry")
    prototype.paid_from_account_currency = paid_currency
    paid_precision = prototype.precision("paid_amount")
    paid_amount = flt(amount * party_rate / bank_rate, 2 if paid_precision is None else paid_precision)
    if paid_amount <= 0:
        frappe.throw(_("The converted refund amount is below the payout currency's smallest unit."))
    return dict(original_payment_entry=original.name, refunded_amount=amount, remaining_amount=flt(available - amount, precision),
        available_amount=available, currency=currency, paid_amount=paid_amount, paid_currency=paid_currency,
        exchange_rate=party_rate / bank_rate, party_exchange_rate=party_rate, bank_exchange_rate=bank_rate,
        posting_date=date, source_account=account.name, party_account=original.paid_from)


@frappe.whitelist(methods=["POST"])
def preview_customer_advance_refund(payload):
    return retry_before_financial_writes(_preview, payload)


def _preview(payload):
    data = _payload(payload)
    _, profile, original, account, _, _ = _context(data)
    return _quote(data, profile, original, account)


def _reconcile(original, refund, profile, amount):
    reconciliation = frappe.get_doc("Payment Reconciliation")
    reconciliation.company = original.company
    reconciliation.party_type = "Customer"
    reconciliation.party = original.party
    reconciliation.receivable_payable_account = original.paid_from
    if original.get("book_advance_payments_in_separate_party_account"):
        reconciliation.default_advance_account = original.paid_from
    reconciliation.payment_name = original.name
    reconciliation.invoice_name = refund.name
    reconciliation.get_unreconciled_entries()
    invoices = [row.as_dict() for row in reconciliation.invoices if row.invoice_type == "Payment Entry" and row.invoice_number == refund.name]
    payments = [row.as_dict() for row in reconciliation.payments if row.reference_type == "Payment Entry" and row.reference_name == original.name and not row.reference_row]
    if len(invoices) != 1 or len(payments) != 1:
        frappe.throw(_("The original advance and refund could not be matched for reconciliation. Nothing was posted."))
    reconciliation.allocate_entries(frappe._dict(invoices=invoices, payments=payments))
    if len(reconciliation.allocation) != 1 or abs(flt(reconciliation.allocation[0].allocated_amount) - amount) > 1e-9:
        frappe.throw(_("The refund allocation differs from the confirmed amount. Nothing was posted."))
    run_reconciliation(reconciliation.reconcile)


@frappe.whitelist(methods=["POST"])
def refund_customer_advance(payload):
    return retry_before_financial_writes(_refund, payload)


def _refund(payload):
    data = _payload(payload, posting=True)
    context = _context(data)
    frappe.db.savepoint("posa_advance_refund")
    try:
        return _post_refund(data, context)
    except Exception:
        frappe.db.rollback(save_point="posa_advance_refund")
        raise


def _post_refund(data, context):
    opening, profile, original, account, documents, existing = context
    intent = {key: data.get(key) for key in ("original_payment_entry", "customer", "pos_profile", "pos_opening_shift", "amount", "mode_of_payment", "reason", "expected_paid_amount", "expected_paid_currency")}
    receipt = claim_financial_request("advance-refund", data["client_request_id"], opening.company, profile.name, intent)
    if receipt.response:
        result = receipt.response
        # The first request may have committed while this request waited for
        # the party lock. A repeatable-read lookup can miss that new row;
        # the protected receipt supplies its exact identity for a current read.
        saved = documents.get(result.get("refund_payment_entry"))
        if not saved and result.get("refund_payment_entry"):
            saved = frappe.get_doc("Payment Entry", result["refund_payment_entry"], for_update=True)
        if not saved or saved.docstatus != 1 or saved.party != original.party or saved.company != original.company or saved.payment_type != "Pay":
            frappe.throw(_("The recorded refund changed on the server. Review it before retrying."))
        return dict(result, replayed=True)
    if existing:
        frappe.throw(_("A refund with this request ID already exists without a completed receipt. Review it before retrying."))
    quote = _quote(data, profile, original, account)
    if data.get("expected_paid_currency") != quote["paid_currency"] or abs(data["expected_paid_amount"] - quote["paid_amount"]) > 1e-9:
        frappe.throw(_("The refund payout quote changed. Review the new amount before confirming."))
    refund = frappe.get_doc(dict(doctype="Payment Entry", payment_type="Pay", party_type="Customer", party=original.party,
        company=opening.company, posting_date=quote["posting_date"], mode_of_payment=data["mode_of_payment"],
        paid_from=account.name, paid_to=original.paid_from, paid_from_account_currency=quote["paid_currency"],
        paid_to_account_currency=quote["currency"], paid_amount=quote["paid_amount"], received_amount=quote["refunded_amount"],
        source_exchange_rate=quote["bank_exchange_rate"], target_exchange_rate=quote["party_exchange_rate"],
        cost_center=profile.get("cost_center") or frappe.get_cached_value("Company", opening.company, "cost_center"),
        reference_no=opening.name, reference_date=quote["posting_date"], posa_client_request_id=_refund_request_id(data)))
    refund.flags.ignore_permissions = True
    refund.insert()
    if refund.paid_to != original.paid_from or abs(flt(refund.received_amount) - quote["refunded_amount"]) > 1e-9:
        frappe.throw(_("The refund account or amount changed during validation. Nothing was posted."))
    refund.submit()
    _reconcile(original, refund, profile, quote["refunded_amount"])
    original.reload()
    if abs(flt(original.unallocated_amount) - quote["remaining_amount"]) > 1e-9:
        frappe.throw(_("The remaining advance balance was not reconciled exactly. Nothing was posted."))
    audit = _("Unused advance {0}; refund request {1}; cashier {2}. Reason: {3}").format(original.name, data["client_request_id"], frappe.session.user, data["reason"])
    refund.add_comment("Info", text=frappe.utils.escape_html(audit))
    original.add_comment("Info", text=frappe.utils.escape_html(_("Advance refund {0}. {1}").format(refund.name, audit)))
    result = {key: quote[key] for key in ("original_payment_entry", "refunded_amount", "remaining_amount", "currency", "paid_amount", "paid_currency", "exchange_rate")}
    result.update(refund_payment_entry=refund.name, name=refund.name, doctype="Payment Entry", docstatus=1,
        client_request_id=data["client_request_id"], replayed=False)
    receipt.finish(result)
    return result
