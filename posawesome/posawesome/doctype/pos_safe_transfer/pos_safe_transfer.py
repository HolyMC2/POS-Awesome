import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from posawesome.posawesome.api.cash_movement.posting import (
    cancel_journal_entry,
    create_journal_entry,
)


def get_safe_gl_balance(account, company=None):
    """Current GL balance of the safe (back-office cash) account."""
    row = frappe.db.sql(
        """
        SELECT COALESCE(SUM(debit) - SUM(credit), 0)
        FROM `tabGL Entry`
        WHERE account = %(account)s AND is_cancelled = 0
        """,
        {"account": account},
    )
    return flt(row[0][0]) if row else 0.0


class POSSafeTransfer(Document):
    """Safe → bank cash transfer, outside any POS shift.

    Deliberately NOT a POS Cash Movement type: that doctype is
    shift-scoped and the closing-shift expected-cash math subtracts ALL
    of a shift's movements with no type filter — stapling a safe→bank
    row to a shift would corrupt its reconciliation. This doc has zero
    interaction surface with shift code; it reuses the same atomic-JE
    posting helpers.
    """

    def validate(self):
        self._validate_amount()
        self._validate_accounts()

    def on_submit(self):
        if not self.journal_entry:
            cost_center = frappe.db.get_value(
                "POS Profile", self.pos_profile, "cost_center"
            ) or frappe.db.get_value("Company", self.company, "cost_center")
            journal_entry = create_journal_entry(
                company=self.company,
                posting_date=self.posting_date,
                movement_type="Transfer",
                amount=self.amount,
                source_account=self.source_account,
                target_account=self.target_account,
                remarks=self.remarks or _("POS Safe Transfer"),
                cost_center=cost_center,
            )
            self.db_set("journal_entry", journal_entry, update_modified=False)

    def on_cancel(self):
        if self.journal_entry:
            cancel_journal_entry(self.journal_entry)

    def on_trash(self):
        if self.docstatus != 2:
            frappe.throw(_("Only cancelled POS Safe Transfer records can be deleted."))

    def _validate_amount(self):
        if flt(self.amount) <= 0:
            frappe.throw(_("Amount must be greater than zero."))
        # Anti-overdraw: never move more than the safe holds in GL.
        # Skipped on cancel/amend revalidation of already-posted docs.
        if self.docstatus == 0:
            balance = get_safe_gl_balance(self.source_account, self.company)
            if flt(self.amount) > balance + 0.005:
                frappe.throw(
                    _("Amount {0} exceeds the safe's GL balance {1}.").format(
                        frappe.format_value(self.amount, {"fieldtype": "Currency"}),
                        frappe.format_value(balance, {"fieldtype": "Currency"}),
                    )
                )

    def _validate_accounts(self):
        if not self.source_account or not self.target_account:
            frappe.throw(_("Source and target accounts are required."))
        if self.source_account == self.target_account:
            frappe.throw(_("Source and target accounts cannot be the same."))

        profile = frappe.db.get_value(
            "POS Profile",
            self.pos_profile,
            ["company", "posa_back_office_cash_account"],
            as_dict=1,
        )
        if not profile:
            frappe.throw(_("POS Profile is required."))
        if profile.company and self.company != profile.company:
            frappe.throw(_("Company must match the selected POS Profile company."))
        if (
            profile.posa_back_office_cash_account
            and self.source_account != profile.posa_back_office_cash_account
        ):
            frappe.throw(
                _("Source account must be the profile's Back Office Cash Account.")
            )

        for account_field, label, expected_type in (
            ("source_account", _("Source account"), "Cash"),
            ("target_account", _("Target account"), "Bank"),
        ):
            account = frappe.db.get_value(
                "Account",
                getattr(self, account_field),
                ["company", "account_type", "is_group"],
                as_dict=1,
            )
            if not account:
                frappe.throw(_("{0} does not exist.").format(label))
            if account.company and account.company != self.company:
                frappe.throw(_("{0} must belong to the selected company.").format(label))
            if account.is_group:
                frappe.throw(_("{0} cannot be a group account.").format(label))
            if (account.account_type or "") != expected_type:
                frappe.throw(
                    _("{0} must be of type {1}.").format(label, expected_type)
                )
