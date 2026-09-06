"""Real Frappe accounting regressions; all fixture changes roll back."""
import json
import unittest
import uuid
from unittest.mock import patch

try:
    import frappe
    from frappe.utils import nowdate
    from posawesome.posawesome.api.payment_processing import advance_refunds as api
    from posawesome.posawesome.api.payment_processing.creation import create_payment_entry
except ImportError:
    raise unittest.SkipTest("bench-only advance refund accounting suite") from None


class TestAdvanceRefunds(unittest.TestCase):
    def setUp(self):
        from doco.docoutils.test_charge_delivery import TestChargeDelivery
        self.fixture = TestChargeDelivery()
        self.fixture.setUp()
        profile = self.fixture.profile
        for field in ("posa_use_pos_awesome_payments", "posa_allow_make_new_payments", "posa_allow_reconcile_payments"):
            profile.set(field, 1)
        profile.save(ignore_permissions=True)
        self.mode = profile.payments[0].mode_of_payment
        self.currency = frappe.get_cached_value("Company", profile.company, "default_currency")
        self.original = create_payment_entry(company=profile.company, amount=100, currency=self.currency,
            mode_of_payment=self.mode, party=self.fixture.customer.name, reference_date=nowdate(),
            reference_no=self.fixture.shift.name)
        self.original.flags.ignore_permissions = True
        self.original.insert().submit()
        self.original.reload()
        self.payload = dict(operation="refund_customer_advance", original_payment_entry=self.original.name,
            customer=self.fixture.customer.name, pos_profile=profile.name, pos_opening_shift=self.fixture.shift.name,
            amount=25, mode_of_payment=self.mode, reason="Customer requested unused advance cash refund",
            client_request_id="refund-test-" + uuid.uuid4().hex, **self.fixture.proof)

    def tearDown(self):
        self.fixture.tearDown()

    def confirm(self, payload=None):
        data = dict(payload or self.payload)
        quote = api.preview_customer_advance_refund(data)
        data.update(expected_paid_amount=quote["paid_amount"], expected_paid_currency=quote["paid_currency"])
        return data

    def test_partial_refund_posts_native_pay_and_reconciles_exact_original(self):
        data = self.confirm()
        result = api.refund_customer_advance(data)
        self.original.reload()
        refund = frappe.get_doc("Payment Entry", result["refund_payment_entry"])
        self.assertEqual((refund.docstatus, refund.payment_type, refund.party_type), (1, "Pay", "Customer"))
        self.assertEqual(result["client_request_id"], data["client_request_id"])
        self.assertEqual(self.original.unallocated_amount, 75)
        self.assertEqual(result["remaining_amount"], 75)
        links = [row for row in self.original.references if row.reference_doctype == "Payment Entry" and row.reference_name == refund.name]
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].allocated_amount, 25)
        entries = frappe.get_all("GL Entry", filters={"voucher_type": "Payment Entry", "voucher_no": refund.name, "is_cancelled": 0}, fields=["account", "debit", "credit"])
        self.assertGreaterEqual(len(entries), 2)
        self.assertAlmostEqual(sum(row.debit - row.credit for row in entries), 0)
        cash = sum(row.credit - row.debit for row in entries if row.account == refund.paid_from)
        self.assertEqual(cash, 25)

    def test_completed_repeat_reuses_receipt_even_after_balance_is_zero(self):
        data = self.confirm(dict(self.payload, amount=100))
        first = api.refund_customer_advance(data)
        repeated = api.refund_customer_advance(json.dumps(data))
        self.assertEqual(first["refund_payment_entry"], repeated["refund_payment_entry"])
        self.assertTrue(repeated["replayed"])
        self.assertEqual(frappe.db.count("Payment Entry", {"posa_client_request_id": api._refund_request_id(data)}), 1)
        self.original.reload()
        self.assertEqual(self.original.unallocated_amount, 0)

    def test_changed_request_and_changed_quote_are_rejected(self):
        data = self.confirm()
        api.refund_customer_advance(data)
        with self.assertRaisesRegex(frappe.ValidationError, "different transaction details"):
            api.refund_customer_advance(dict(data, amount=26, expected_paid_amount=26))
        other = self.confirm(dict(self.payload, client_request_id="changed-quote-" + uuid.uuid4().hex))
        other["expected_paid_amount"] += 1
        with self.assertRaisesRegex(frappe.ValidationError, "quote changed"):
            api.refund_customer_advance(other)
        self.assertEqual(frappe.db.count("Payment Entry", {"posa_client_request_id": api._refund_request_id(other)}), 0)
        self.original.reload()
        self.assertEqual(self.original.unallocated_amount, 75)

    def test_invalid_amount_current_balance_and_wrong_terminal_cannot_refund(self):
        for amount in (-1, 0, True, float("nan"), float("inf")):
            with self.subTest(amount=amount), self.assertRaises(frappe.ValidationError):
                api.preview_customer_advance_refund(dict(self.payload, amount=amount))
        with self.assertRaisesRegex(frappe.ValidationError, "current unused"):
            api.preview_customer_advance_refund(dict(self.payload, amount=101))
        with self.assertRaises(frappe.PermissionError):
            api.preview_customer_advance_refund(dict(self.payload, terminal_token="x" * 64))
        self.original.reload()
        self.assertEqual(self.original.unallocated_amount, 100)

    def test_foreign_customer_and_unconfigured_mode_are_rejected(self):
        other = frappe.copy_doc(self.fixture.customer)
        other.customer_name = self.fixture.tag + " other"
        other.insert(ignore_permissions=True)
        with self.assertRaises(frappe.PermissionError):
            api.preview_customer_advance_refund(dict(self.payload, customer=other.name))
        with self.assertRaises(frappe.PermissionError):
            api.preview_customer_advance_refund(dict(self.payload, mode_of_payment="NOT-CONFIGURED"))
        with self.assertRaises(frappe.PermissionError):
            api.preview_customer_advance_refund(dict(self.payload, pos_profile="NOT-THIS-REGISTER"))

    def test_reconciliation_failure_rolls_back_refund_gl_and_receipt(self):
        data = self.confirm()
        before = frappe.db.count("Payment Entry")
        with patch.object(api, "_reconcile", side_effect=RuntimeError("injected native reconciliation failure")):
            with self.assertRaisesRegex(RuntimeError, "injected native"):
                api.refund_customer_advance(data)
        self.assertEqual(frappe.db.count("Payment Entry"), before)
        self.assertEqual(frappe.db.count("POS Invoice Submission Ledger", {"client_request_id": data["client_request_id"]}), 0)
        self.original.reload()
        self.assertEqual(self.original.unallocated_amount, 100)
        recovered = api.refund_customer_advance(data)
        self.assertEqual(recovered["remaining_amount"], 75)

    def make_foreign_advance(self, rate=20):
        foreign = "USD" if self.currency != "USD" else "EUR"
        parent = frappe.db.get_value("Account", self.original.paid_from, "parent_account")
        account = frappe.get_doc(dict(doctype="Account", account_name=self.fixture.tag + " FX", company=self.original.company,
            parent_account=parent, account_type="Receivable", account_currency=foreign)).insert(ignore_permissions=True)
        customer = frappe.copy_doc(self.fixture.customer)
        customer.customer_name = self.fixture.tag + " FX customer"
        customer.default_currency = foreign
        customer.set("accounts", [dict(company=self.original.company, account=account.name)])
        customer.insert(ignore_permissions=True)
        self.payload["customer"] = customer.name
        existing = frappe.db.get_value("Currency Exchange", {"date": nowdate(), "from_currency": foreign, "to_currency": self.currency})
        if existing:
            exchange = frappe.get_doc("Currency Exchange", existing)
            exchange.exchange_rate = rate
            exchange.for_buying = exchange.for_selling = 1
            exchange.save(ignore_permissions=True)
        else:
            exchange = frappe.get_doc(dict(doctype="Currency Exchange", date=nowdate(), from_currency=foreign,
                to_currency=self.currency, exchange_rate=rate, for_buying=1, for_selling=1)).insert(ignore_permissions=True)
        original = frappe.get_doc(dict(doctype="Payment Entry", payment_type="Receive", company=self.original.company,
            party_type="Customer", party=customer.name, posting_date=nowdate(), mode_of_payment=self.mode,
            paid_from=account.name, paid_to=self.original.paid_to, paid_from_account_currency=foreign,
            paid_to_account_currency=self.currency, paid_amount=100, received_amount=100 * rate,
            source_exchange_rate=rate, target_exchange_rate=1, reference_no=self.fixture.shift.name,
            reference_date=nowdate()))
        original.flags.ignore_permissions = True
        original.insert().submit()
        self.original = original
        self.payload["original_payment_entry"] = original.name
        return exchange, foreign

    def test_database_fx_quote_controls_cash_payout_and_native_reconciliation(self):
        exchange, foreign = self.make_foreign_advance()
        with patch("requests.get", side_effect=AssertionError("No external provider is permitted")):
            quote = api.preview_customer_advance_refund(self.payload)
            self.assertEqual((quote["refunded_amount"], quote["currency"]), (25, foreign))
            self.assertEqual((quote["paid_amount"], quote["paid_currency"]), (500, self.currency))
            data = self.confirm()
            result = api.refund_customer_advance(data)
        self.assertEqual(result["paid_amount"], 500)
        self.original.reload()
        self.assertEqual(self.original.unallocated_amount, 75)
        refund = frappe.get_doc("Payment Entry", result["refund_payment_entry"])
        self.assertEqual((refund.paid_amount, refund.received_amount), (500, 25))
        exchange.exchange_rate = 21
        exchange.save(ignore_permissions=True)
        repeated = api.refund_customer_advance(data)
        self.assertEqual(repeated["paid_amount"], 500)
        stale = self.confirm(dict(self.payload, client_request_id="fx-stale-" + uuid.uuid4().hex))
        exchange.exchange_rate = 22
        exchange.save(ignore_permissions=True)
        with self.assertRaisesRegex(frappe.ValidationError, "quote changed"):
            api.refund_customer_advance(stale)
        self.original.reload()
        self.assertEqual(self.original.unallocated_amount, 75)

    def test_provider_method_and_disabled_cash_account_are_rejected(self):
        method = frappe.copy_doc(frappe.get_doc("Mode of Payment", self.mode))
        method.mode_of_payment = "MercadoPago Point"
        if not frappe.db.exists("Mode of Payment", method.mode_of_payment):
            method.insert(ignore_permissions=True)
        self.fixture.profile.append("payments", dict(mode_of_payment=method.mode_of_payment))
        self.fixture.profile.save(ignore_permissions=True)
        with self.assertRaisesRegex(frappe.ValidationError, "provider refund confirmation"):
            api.preview_customer_advance_refund(dict(self.payload, mode_of_payment=method.mode_of_payment))
        frappe.db.set_value("Account", self.original.paid_to, "disabled", 1)
        with self.assertRaises(frappe.PermissionError):
            api.preview_customer_advance_refund(self.payload)

    def test_closed_shift_and_stale_generation_are_rejected(self):
        with self.assertRaises(frappe.PermissionError):
            api.preview_customer_advance_refund(dict(self.payload, terminal_generation=0))
        frappe.db.set_value("POS Opening Shift", self.fixture.shift.name, "status", "Closed")
        with self.assertRaises(frappe.ValidationError):
            api.preview_customer_advance_refund(self.payload)
