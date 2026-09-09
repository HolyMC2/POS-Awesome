import unittest
from types import SimpleNamespace
from unittest.mock import patch

try:
    from posawesome.posawesome.api.cash_movement import posting
except ImportError:
    raise unittest.SkipTest("bench-only test module - requires frappe") from None


class TestCashInBalanceMessage(unittest.TestCase):
    def setUp(self):
        self.frappe = self.enterContext(patch.object(posting, "frappe"))
        self.enterContext(patch.object(posting, "_", side_effect=lambda text: text))
        self.enterContext(patch.object(
            posting, "fmt_money", side_effect=lambda value, currency: f"{currency} {value:.2f}"
        ))
        self.frappe.get_cached_value.side_effect = lambda dt, name, field: (
            "Debit" if dt == "Account" else "MXN"
        )
        self.frappe.db.sql.return_value = [(130,)]
        self.frappe.throw.side_effect = ValueError
        self.je = SimpleNamespace(company="Grupo Doco", accounts=[
            SimpleNamespace(account="Caja Tienda - GD", debit=1000, credit=0),
            SimpleNamespace(account="Caja Chica Hidalgo 1 - GD", debit=0, credit=1000),
        ])

    def test_insufficient_balance_names_source_amounts_and_external_cash_guidance(self):
        with self.assertRaises(ValueError):
            posting._validate_cash_in_balance(self.je, "Caja Chica Hidalgo 1 - GD")
        args, kwargs = self.frappe.throw.call_args
        for text in ("Caja Chica Hidalgo 1 - GD", "MXN 130.00", "MXN 1000.00", "home or another source"):
            self.assertIn(text, args[0])
        self.assertEqual(kwargs["title"], "Insufficient safe balance")

    def test_empty_ledger_reports_zero_balance(self):
        self.frappe.db.sql.return_value = [(None,)]
        with self.assertRaises(ValueError):
            posting._validate_cash_in_balance(self.je, "Caja Chica Hidalgo 1 - GD")
        self.assertIn("MXN 0.00", self.frappe.throw.call_args.args[0])

    def test_exact_balance_and_smaller_withdrawal_are_allowed(self):
        for amount in (130, 129.99):
            with self.subTest(amount=amount):
                self.je.accounts[1].credit = amount
                posting._validate_cash_in_balance(self.je, "Caja Chica Hidalgo 1 - GD")
        self.frappe.throw.assert_not_called()

    def test_unrestricted_and_credit_balance_accounts_keep_existing_behavior(self):
        for balance_type in ("", None, "Credit"):
            with self.subTest(balance_type=balance_type):
                self.frappe.get_cached_value.side_effect = None
                self.frappe.get_cached_value.return_value = balance_type
                posting._validate_cash_in_balance(self.je, "Caja Chica Hidalgo 1 - GD")
        self.frappe.db.sql.assert_not_called()
        self.frappe.throw.assert_not_called()

    def test_compares_company_currency_after_exchange_conversion(self):
        self.je.accounts[1].credit_in_account_currency = 100
        self.je.accounts[1].credit = 2000
        self.frappe.db.sql.return_value = [(1500,)]
        with self.assertRaises(ValueError):
            posting._validate_cash_in_balance(self.je, "Caja Chica Hidalgo 1 - GD")
        message = self.frappe.throw.call_args.args[0]
        self.assertIn("MXN 1500.00", message)
        self.assertIn("MXN 2000.00", message)

    def test_account_name_is_escaped_for_frappe_dialog(self):
        self.je.accounts[1].account = "Safe <img> - GD"
        with self.assertRaises(ValueError):
            posting._validate_cash_in_balance(self.je, "Safe <img> - GD")
        message = self.frappe.throw.call_args.args[0]
        self.assertNotIn("<img>", message)
        self.assertIn("&lt;img&gt;", message)

    @patch("posawesome.posawesome.api._perms.account_perm_bypass")
    def test_posting_checks_saved_cash_in_before_submit_and_preserves_other_types(self, bypass):
        je = self.frappe.new_doc.return_value
        events = []
        je.save.side_effect = lambda: events.append("save")
        je.submit.side_effect = lambda: events.append("submit")
        with patch.object(posting, "_validate_cash_in_balance", side_effect=lambda *args: events.append("check")):
            for movement_type in ("Cash In", "Expense", "Deposit", "Transfer"):
                with self.subTest(movement_type=movement_type):
                    events.clear()
                    posting.create_journal_entry(
                        "Grupo Doco", "2026-09-08", movement_type, 1000,
                        "Caja Chica Hidalgo 1 - GD", "Caja Tienda - GD",
                    )
                    self.assertEqual(events, ["save", "check", "submit"] if movement_type == "Cash In" else ["save", "submit"])

    @patch("posawesome.posawesome.api._perms.account_perm_bypass")
    def test_insufficient_cash_in_never_submits_journal(self, bypass):
        with patch.object(posting, "_validate_cash_in_balance", side_effect=ValueError):
            with self.assertRaises(ValueError):
                posting.create_journal_entry(
                    "Grupo Doco", "2026-09-08", "Cash In", 1000,
                    "Caja Chica Hidalgo 1 - GD", "Caja Tienda - GD",
                )
        self.frappe.new_doc.return_value.submit.assert_not_called()
