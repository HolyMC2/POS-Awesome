"""Exact cash proof must reject an arbitrary balanced ledger."""
import copy
import unittest

from endurance_accounting import validate_cash_invoice


class TestEnduranceAccounting(unittest.TestCase):
    def setUp(self):
        self.fixture = {"company": "Demo", "customer": "Private customer", "profile": "Private profile",
            "currency": "MXN", "item": "Private item", "mode_of_payment": "Private cash", "cash_account": "Cash",
            "expected_financial": {"receivable_account": "Debtors", "income_account": "Sales",
                "tax_account": "IVA", "net_amount": 8.62, "tax_amount": 1.38}}
        self.doc = {"company": "Demo", "customer": "Private customer", "pos_profile": "Private profile",
            "currency": "MXN", "conversion_rate": 1, "is_pos": 1, "debit_to": "Debtors",
            "grand_total": 10, "rounded_total": 10, "base_grand_total": 10, "paid_amount": 10, "base_paid_amount": 10,
            "outstanding_amount": 0, "discount_amount": 0, "write_off_amount": 0, "change_amount": 0,
            "items": [{"item_code": "Private item", "qty": 1, "rate": 10, "amount": 10,
                "net_amount": 8.62, "income_account": "Sales"}],
            "payments": [{"mode_of_payment": "Private cash", "account": "Cash", "type": "Cash", "amount": 10, "base_amount": 10}],
            "taxes": [{"account_head": "IVA", "tax_amount": 1.38, "base_tax_amount": 1.38}]}
        self.ledger = []
        for account, debit, credit, party in [("Cash", 10, 0, None), ("Debtors", 10, 0, "Private customer"),
            ("Debtors", 0, 10, "Private customer"), ("Sales", 0, 8.62, None), ("IVA", 0, 1.38, None)]:
            self.ledger.append({"account": account, "debit": debit, "credit": credit,
                "party_type": "Customer" if party else None, "party": party, "account_currency": "MXN",
                "debit_in_account_currency": debit, "credit_in_account_currency": credit})

    def verify(self):
        return validate_cash_invoice(self.fixture, self.doc, self.ledger)

    def test_exact_native_cash_shape_passes(self):
        self.doc["terminal_token"] = "must-not-export"
        self.doc["items"][0]["unrelated_private_field"] = "must-not-export"
        proof = self.verify()
        self.assertTrue(proof["exact_accounts_verified"])
        self.assertEqual(len(proof["gl_entries"]), 5)
        self.assertNotIn("terminal_token", proof["invoice_snapshot"])
        self.assertNotIn("unrelated_private_field", proof["invoice_snapshot"]["items"][0])
        self.assertEqual(validate_cash_invoice(self.fixture, proof["invoice_snapshot"], proof["gl_entries"]), proof)

    def test_balanced_ledger_using_wrong_cash_account_fails(self):
        self.ledger[0]["account"] = "Unrelated bank"
        with self.assertRaisesRegex(ValueError, "GL differs"):
            self.verify()

    def test_balanced_ledger_with_wrong_income_tax_split_fails(self):
        self.ledger[3].update(credit=9, credit_in_account_currency=9)
        self.ledger[4].update(credit=1, credit_in_account_currency=1)
        with self.assertRaisesRegex(ValueError, "GL differs"):
            self.verify()

    def test_wrong_party_on_balanced_receivable_fails(self):
        self.ledger[1]["party"] = "Other customer"
        with self.assertRaisesRegex(ValueError, "GL differs"):
            self.verify()

    def test_rate_tender_and_currency_corruption_fail(self):
        original = copy.deepcopy(self.doc)
        for change in (lambda d: d["items"][0].update(rate=9), lambda d: d["payments"][0].update(account="Bank"),
            lambda d: d["payments"][0].update(mode_of_payment="Card"), lambda d: d.update(currency="USD"),
            lambda d: d.update(change_amount=1), lambda d: d.update(paid_amount=9)):
            with self.subTest(change=change):
                self.doc = copy.deepcopy(original)
                change(self.doc)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_unknown_nonfinite_or_boolean_amounts_fail(self):
        for value in (None, True, float("nan"), float("inf"), "unknown"):
            with self.subTest(value=value):
                self.doc["paid_amount"] = value
                with self.assertRaises(ValueError):
                    self.verify()

    def test_equal_debit_credit_extra_entries_fail(self):
        self.ledger.append({**self.ledger[0], "debit": 1, "credit": 1,
            "debit_in_account_currency": 1, "credit_in_account_currency": 1})
        with self.assertRaisesRegex(ValueError, "GL differs"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
