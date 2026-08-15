import frappe
from frappe import _
from frappe.utils import flt, json
from posawesome.posawesome.api._scope import assert_company, assert_profile
from posawesome.posawesome.api.cash_movement.flow import drawer_delta
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils import get_base_value
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_pos_invoices,
    get_payments_entries,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    get_pending_draft_invoices,
    is_closing_supervisor,
    submit_printed_invoices,
)


def build_pos_payment_reference(payment_entry):
    party_type = payment_entry.get("party_type")
    party = payment_entry.get("party")
    row = frappe._dict(
        {
            "payment_entry": payment_entry.name,
            "mode_of_payment": payment_entry.mode_of_payment,
            "paid_amount": payment_entry.paid_amount,
            "posting_date": payment_entry.posting_date,
            "party_type": party_type,
            "party": party,
        }
    )

    if party_type == "Customer":
        row.customer = party

    return row


def _get_payment_entry_party(payment_entry):
    if not payment_entry:
        return {}

    return (
        frappe.db.get_value(
            "Payment Entry",
            payment_entry,
            ["party_type", "party"],
            as_dict=True,
        )
        or {}
    )


def _is_legacy_customer_required():
    customer_field = frappe.get_meta("POS Payment Entry Reference").get_field("customer")
    return bool(customer_field and customer_field.reqd)


def normalize_pos_payment_references(closing_shift_doc):
    has_non_customer_payment = False

    for row in closing_shift_doc.get("pos_payments", []):
        party_type = row.get("party_type")
        party = row.get("party")

        if row.get("payment_entry") and (not party_type or not party):
            payment_party = _get_payment_entry_party(row.get("payment_entry"))
            party_type = party_type or payment_party.get("party_type")
            party = party or payment_party.get("party")
            row.party_type = party_type
            row.party = party

        if party_type == "Customer":
            if party and not row.get("customer"):
                row.customer = party
            continue

        has_non_customer_payment = True
        if row.get("customer"):
            row.customer = None

    if has_non_customer_payment and _is_legacy_customer_required():
        closing_shift_doc.flags.ignore_mandatory = True


def compute_closing_tables(opening_shift, doctype=None):
    """Recompute every server-derivable closing-shift table from DB truth.

    `opening_shift` is a dict (POS Opening Shift as_dict or the client's
    copy of it — only name/pos_profile/company/balance_details are read).
    Returns a dict with pos_transactions, payment_reconciliation (expected
    amounts only), taxes, pos_payments and the header totals. Shared by
    make_closing_shift_from_opening (build) and POSClosingShift.validate
    (anti-tamper re-derivation at submit).
    """
    if not doctype:
        use_pos_invoice = frappe.db.get_value(
            "POS Profile",
            opening_shift.get("pos_profile"),
            "create_pos_invoice_instead_of_sales_invoice",
        )
        doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"

    company = opening_shift.get("company")
    grand_total = 0
    net_total = 0
    total_quantity = 0

    company_currency = frappe.get_cached_value("Company", company, "default_currency")
    cash_mode_of_payment = (
        frappe.get_value(
            "POS Profile",
            opening_shift.get("pos_profile"),
            "posa_cash_mode_of_payment",
        )
        or "Cash"
    )

    invoices = get_pos_invoices(opening_shift.get("name"), doctype, submit_printed=0)

    pos_transactions = []
    taxes = []
    payments = []
    pos_payments_table = []
    for detail in opening_shift.get("balance_details"):
        payments.append(
            frappe._dict(
                {
                    "mode_of_payment": detail.get("mode_of_payment"),
                    "opening_amount": detail.get("amount") or 0,
                    "expected_amount": detail.get("amount") or 0,
                }
            )
        )

    invoice_field = "pos_invoice" if doctype == "POS Invoice" else "sales_invoice"

    for d in invoices:
        conversion_rate = d.get("conversion_rate")
        pos_transactions.append(
            frappe._dict(
                {
                    invoice_field: d.name,
                    "posting_date": d.posting_date,
                    "grand_total": get_base_value(d, "grand_total", "base_grand_total", conversion_rate),
                    "transaction_currency": d.get("currency") or company_currency,
                    "transaction_amount": flt(d.get("grand_total")),
                    "customer": d.customer,
                }
            )
        )
        base_grand_total = get_base_value(d, "grand_total", "base_grand_total", conversion_rate)
        base_net_total = get_base_value(d, "net_total", "base_net_total", conversion_rate)
        grand_total += base_grand_total
        net_total += base_net_total
        total_quantity += flt(d.total_qty)

        for t in d.taxes:
            existing_tax = [tx for tx in taxes if tx.account_head == t.account_head and tx.rate == t.rate]
            if existing_tax:
                existing_tax[0].amount += get_base_value(
                    t, "tax_amount", "base_tax_amount", d.get("conversion_rate")
                )
            else:
                taxes.append(
                    frappe._dict(
                        {
                            "account_head": t.account_head,
                            "rate": t.rate,
                            "amount": get_base_value(
                                t, "tax_amount", "base_tax_amount", d.get("conversion_rate")
                            ),
                        }
                    )
                )

        for p in d.payments:
            existing_pay = [pay for pay in payments if pay.mode_of_payment == p.mode_of_payment]
            if existing_pay:
                conversion_rate = d.get("conversion_rate")
                if existing_pay[0].mode_of_payment == cash_mode_of_payment:
                    amount = get_base_value(p, "amount", "base_amount", conversion_rate) - get_base_value(
                        d, "change_amount", "base_change_amount", conversion_rate
                    )
                else:
                    amount = get_base_value(p, "amount", "base_amount", conversion_rate)
                existing_pay[0].expected_amount += flt(amount)
            else:
                payments.append(
                    frappe._dict(
                        {
                            "mode_of_payment": p.mode_of_payment,
                            "opening_amount": 0,
                            "expected_amount": get_base_value(
                                p, "amount", "base_amount", d.get("conversion_rate")
                            ),
                        }
                    )
                )

    pos_payments = get_payments_entries(opening_shift.get("name"))

    for py in pos_payments:
        pos_payments_table.append(build_pos_payment_reference(py))
        existing_pay = [pay for pay in payments if pay.mode_of_payment == py.mode_of_payment]
        multiplier = -1 if py.payment_type == "Pay" else 1
        signed_amount = multiplier * abs(get_base_value(py, "paid_amount", "base_paid_amount"))
        if existing_pay:
            existing_pay[0].expected_amount += signed_amount
        else:
            payments.append(
                frappe._dict(
                    {
                        "mode_of_payment": py.mode_of_payment,
                        "opening_amount": 0,
                        "expected_amount": signed_amount,
                    }
                )
            )

    cash_movements = frappe.get_all(
        "POS Cash Movement",
        filters={"pos_opening_shift": opening_shift.get("name"), "docstatus": 1},
        fields=["movement_type", "amount"],
    )
    # Signed: Expense/Deposit remove drawer cash, Cash In (change fund) adds.
    cash_movement_delta = sum(
        drawer_delta(row.get("movement_type"), row.get("amount")) for row in cash_movements
    )
    if cash_movement_delta:
        existing_cash = [pay for pay in payments if pay.mode_of_payment == cash_mode_of_payment]
        if existing_cash:
            existing_cash[0].expected_amount += cash_movement_delta
        else:
            payments.append(
                frappe._dict(
                    {
                        "mode_of_payment": cash_mode_of_payment,
                        "opening_amount": 0,
                        "expected_amount": cash_movement_delta,
                    }
                )
            )

    return {
        "doctype": doctype,
        "pos_transactions": pos_transactions,
        "payment_reconciliation": payments,
        "taxes": taxes,
        "pos_payments": pos_payments_table,
        "grand_total": grand_total,
        "net_total": net_total,
        "total_quantity": total_quantity,
    }


@frappe.whitelist()
def make_closing_shift_from_opening(opening_shift):
    opening_shift = json.loads(opening_shift)
    use_pos_invoice = frappe.db.get_value(
        "POS Profile",
        opening_shift.get("pos_profile"),
        "create_pos_invoice_instead_of_sales_invoice",
    )
    doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"
    skipped_printed_invoices = submit_printed_invoices(opening_shift.get("name"), doctype)
    # Unprinted drafts were historically invisible here — silently deleted
    # (posa_allow_delete) or stranded on the closed shift. Return them so the
    # SPA can tell the closer exactly what will happen before committing.
    pending_drafts = get_pending_draft_invoices(opening_shift.get("name"), doctype)
    drafts_will_be_deleted = bool(
        frappe.db.get_value("POS Profile", opening_shift.get("pos_profile"), "posa_allow_delete")
    )

    tables = compute_closing_tables(opening_shift, doctype)

    closing_shift = frappe.new_doc("POS Closing Shift")
    closing_shift.pos_opening_shift = opening_shift.get("name")
    closing_shift.period_start_date = opening_shift.get("period_start_date")
    closing_shift.period_end_date = frappe.utils.get_datetime()
    closing_shift.pos_profile = opening_shift.get("pos_profile")
    closing_shift.user = opening_shift.get("user")
    closing_shift.company = opening_shift.get("company")
    closing_shift.grand_total = tables["grand_total"]
    closing_shift.net_total = tables["net_total"]
    closing_shift.total_quantity = tables["total_quantity"]
    closing_shift.set("pos_transactions", tables["pos_transactions"])
    closing_shift.set("payment_reconciliation", tables["payment_reconciliation"])
    closing_shift.set("taxes", tables["taxes"])
    closing_shift.set("pos_payments", tables["pos_payments"])

    return {
        "closing_shift": closing_shift,
        "skipped_printed_invoices": skipped_printed_invoices,
        "pending_drafts": pending_drafts,
        "drafts_will_be_deleted": drafts_will_be_deleted,
    }


@frappe.whitelist()
def submit_closing_shift(closing_shift):
    closing_shift = json.loads(closing_shift)
    opening_shift = frappe.get_doc(
        "POS Opening Shift", closing_shift.get("pos_opening_shift")
    )
    session_user = frappe.session.user
    assert_profile(session_user, opening_shift.pos_profile)
    assert_company(session_user, opening_shift.company)

    if opening_shift.user != session_user and not is_closing_supervisor(session_user):
        frappe.throw(
            _("Only the shift owner or a POS supervisor can close this shift."),
            frappe.PermissionError,
        )

    closing_shift_doc = frappe.get_doc(closing_shift)
    closing_shift_doc.flags.ignore_permissions = True
    normalize_pos_payment_references(closing_shift_doc)
    closing_shift_doc.save()
    closing_shift_doc.submit()
    return closing_shift_doc.name
