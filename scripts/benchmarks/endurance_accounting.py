"""Exact accounting checks for the bounded MXN cash endurance fixture."""
from collections import defaultdict
from decimal import Decimal, InvalidOperation


def money(value):
    try:
        if isinstance(value, bool):
            raise ValueError("Boolean amount")
        result = Decimal(str(value))
        if not result.is_finite():
            raise ValueError("Non-finite amount")
        return result
    except (InvalidOperation, TypeError) as error:
        raise ValueError("Invalid amount") from error


def validate_cash_invoice(fixture, doc, ledger):
    expected = fixture["expected_financial"]
    if (doc.get("company") != fixture["company"] or doc.get("customer") != fixture["customer"]
        or doc.get("pos_profile") != fixture["profile"] or doc.get("currency") != "MXN"
        or fixture["currency"] != "MXN" or money(doc.get("conversion_rate")) != 1
        or money(doc.get("is_pos")) != 1 or doc.get("debit_to") != expected["receivable_account"]):
        raise ValueError("Invoice escaped the MXN cash fixture")
    for field in ("grand_total", "rounded_total", "base_grand_total", "paid_amount", "base_paid_amount"):
        if money(doc.get(field)) != 10:
            raise ValueError("Fixture invoice amount must be exactly 10 MXN")
    for field in ("outstanding_amount", "discount_amount", "write_off_amount", "change_amount"):
        if money(doc.get(field)) != 0:
            raise ValueError("Fixture invoice contains an unexpected adjustment")
    items = doc.get("items", [])
    if len(items) != 1 or items[0].get("item_code") != fixture["item"]:
        raise ValueError("Unexpected fixture item")
    item = items[0]
    if (money(item.get("qty")) != 1 or money(item.get("rate")) != 10 or money(item.get("amount")) != 10
        or money(item.get("net_amount")) != money(expected["net_amount"])
        or item.get("income_account") != expected["income_account"]):
        raise ValueError("Unexpected fixture item rate or income account")
    payments = doc.get("payments", [])
    if len(payments) != 1:
        raise ValueError("Fixture requires exactly one cash tender")
    payment = payments[0]
    if (payment.get("mode_of_payment") != fixture["mode_of_payment"]
        or payment.get("account") != fixture["cash_account"] or payment.get("type") != "Cash"
        or money(payment.get("amount")) != 10 or money(payment.get("base_amount")) != 10):
        raise ValueError("Unexpected fixture cash tender or account")
    taxes = doc.get("taxes", [])
    if (len(taxes) != 1 or taxes[0].get("account_head") != expected["tax_account"]
        or money(taxes[0].get("tax_amount")) != money(expected["tax_amount"])
        or money(taxes[0].get("base_tax_amount")) != money(expected["tax_amount"])):
        raise ValueError("Unexpected fixture tax")
    actual = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for row in ledger:
        debit, credit = money(row.get("debit")), money(row.get("credit"))
        if (debit < 0 or credit < 0 or row.get("account_currency") != "MXN"
            or money(row.get("debit_in_account_currency")) != debit
            or money(row.get("credit_in_account_currency")) != credit):
            raise ValueError("Unexpected GL currency or amount")
        key = (row.get("account"), row.get("party_type") or "", row.get("party") or "")
        actual[key][0] += debit
        actual[key][1] += credit
    wanted = {
        (fixture["cash_account"], "", ""): [Decimal(10), Decimal(0)],
        (expected["receivable_account"], "Customer", fixture["customer"]): [Decimal(10), Decimal(10)],
        (expected["income_account"], "", ""): [Decimal(0), money(expected["net_amount"])],
        (expected["tax_account"], "", ""): [Decimal(0), money(expected["tax_amount"])],
    }
    if dict(actual) != wanted:
        raise ValueError("GL differs from the fixture's exact cash, receivable, income and tax entries")
    # Only accounting fields enter the evidence; never serialize a complete
    # invoice, which may contain terminal credentials or unrelated personal data.
    snapshot = {key: doc.get(key) for key in ("name", "docstatus", "posa_client_request_id", "company", "customer", "pos_profile", "currency",
        "conversion_rate", "is_pos", "debit_to", "grand_total", "rounded_total", "base_grand_total", "paid_amount",
        "base_paid_amount", "outstanding_amount", "discount_amount", "write_off_amount", "change_amount")}
    for table, keys in {
        "items": ("item_code", "qty", "rate", "amount", "net_amount", "income_account"),
        "payments": ("mode_of_payment", "account", "type", "amount", "base_amount"),
        "taxes": ("account_head", "tax_amount", "base_tax_amount"),
    }.items():
        snapshot[table] = [{key: row.get(key) for key in keys} for row in doc.get(table, [])]
    entries = []
    for row in ledger:
        entry = {key: row.get(key) or "" for key in ("account", "party_type", "party", "account_currency")}
        entry.update({key: float(money(row.get(key))) for key in (
            "debit", "credit", "debit_in_account_currency", "credit_in_account_currency")})
        entries.append(entry)
    entries.sort(key=lambda row: (row["account"], row["party_type"], row["party"], row["debit"], row["credit"]))
    return {"expected_total": 10, "currency": "MXN", "cash_account": fixture["cash_account"],
        "cash_debit": 10, "income_account": expected["income_account"], "income_credit": expected["net_amount"],
        "tax_account": expected["tax_account"], "tax_credit": expected["tax_amount"], "exact_accounts_verified": True,
        "invoice_snapshot": snapshot, "gl_entries": entries}
