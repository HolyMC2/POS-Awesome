import frappe
from frappe import _
from frappe.utils import escape_html, fmt_money, nowdate, flt


def _validate_cash_in_balance(je, source_account):
    """Explain an insufficient safe balance before ERPNext's generic GL error."""
    if frappe.get_cached_value("Account", source_account, "balance_must_be") != "Debit":
        return

    # Match ERPNext's all-date, non-cancelled GL balance in company currency.
    # je.save() has calculated exchange rates and rounded the debit/credit rows.
    balance = flt(frappe.db.sql(
        """SELECT COALESCE(SUM(debit) - SUM(credit), 0)
        FROM `tabGL Entry` WHERE account = %s AND is_cancelled = 0""",
        (source_account,),
    )[0][0])
    requested = sum(
        flt(row.credit) - flt(row.debit)
        for row in je.accounts if row.account == source_account
    )
    if balance - requested < 0:
        currency = frappe.get_cached_value("Company", je.company, "default_currency")
        frappe.throw(
            _("Insufficient balance in {0}. Recorded balance: {1}. Requested: {2}.").format(
                escape_html(source_account),
                fmt_money(balance, currency=currency),
                fmt_money(requested, currency=currency),
            ) + " " + _(
                "Cash In takes money from the configured safe. If the cash came from home or "
                "another source, ask a manager to record that source and the cash received "
                "in the drawer. Otherwise, check for a missing safe deposit before retrying."
            ),
            title=_("Insufficient safe balance"),
        )


def create_journal_entry(
    company,
    posting_date,
    movement_type,
    amount,
    source_account,
    target_account,
    remarks=None,
    cost_center=None,
):
    amount = flt(amount)
    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero."))

    movement_type = (movement_type or "").strip()
    # "Transfer" = POS Safe Transfer (safe -> bank), same debit/credit shape.
    # "Cash In" reuses the same shape with the drawer as TARGET
    # (back-office cash -> drawer), so no direction special-case is needed.
    if movement_type not in {"Expense", "Deposit", "Cash In", "Transfer"}:
        frappe.throw(_("Invalid movement type for journal entry."))

    company_cost_center = cost_center or frappe.get_cached_value("Company", company, "cost_center")

    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.company = company
    je.posting_date = posting_date or nowdate()
    je.user_remark = remarks or _("POS Cash Movement")

    # Debit target account (expense or back-office cash)
    je.append(
        "accounts",
        {
            "account": target_account,
            "debit_in_account_currency": amount,
            "credit_in_account_currency": 0,
            "cost_center": company_cost_center,
        },
    )

    # Credit source account (POS cash)
    je.append(
        "accounts",
        {
            "account": source_account,
            "debit_in_account_currency": 0,
            "credit_in_account_currency": amount,
            "cost_center": company_cost_center,
        },
    )

    je.flags.ignore_permissions = True
    from posawesome.posawesome.api._perms import account_perm_bypass
    with account_perm_bypass():
        je.save()
        if movement_type == "Cash In":
            _validate_cash_in_balance(je, source_account)
        # ERPNext's submission validations remain authoritative, including any
        # balance changes after the explanatory check above.
        je.submit()
    return je.name


def cancel_journal_entry(journal_entry_name):
    if not journal_entry_name:
        return

    if not frappe.db.exists("Journal Entry", journal_entry_name):
        return

    je = frappe.get_doc("Journal Entry", journal_entry_name)
    if je.docstatus == 1:
        je.flags.ignore_permissions = True
        # Cash movement keeps a hard link to JE for audit trail; allow JE cancel from this controlled path.
        je.flags.ignore_links = True
        from posawesome.posawesome.api._perms import account_perm_bypass
        with account_perm_bypass():
            je.cancel()
