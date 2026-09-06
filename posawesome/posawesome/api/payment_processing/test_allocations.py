"""Standalone allocation regressions; run directly with Python."""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch

HERE = pathlib.Path(__file__).resolve().parent
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub harness")
class TestPaymentAllocations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("payment_harness", HERE / "test_payment_processing.py")
        harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(harness)
        harness._install_framework_stubs()
        harness._install_package_stubs()
        cls.AttrDict = harness.AttrDict
        cls.Payment = harness.FakePaymentEntry
        cls.allocations = harness._load_module(
            "posawesome.posawesome.api.payment_processing.allocations", HERE / "allocations.py"
        )
        core = types.ModuleType("erpnext.accounts.doctype.payment_entry.payment_entry")
        core.get_reference_details = Mock()
        sys.modules[core.__name__] = core
        cls.core = core
        cls.idempotency = harness._load_module("posawesome.posawesome.api.idempotency", HERE.parent / "idempotency.py")

    def setUp(self):
        self.payment = self.Payment(paid_amount=100)
        self.payment.party = "Party"
        self.payment.paid_from = self.payment.paid_to = "Party account"
        self.document = self.AttrDict(name="INV-1", docstatus=1, outstanding_amount=100)
        self.details = self.AttrDict(total_amount=100, outstanding_amount=100, exchange_rate=1, account="Party account")
        self.core.get_reference_details.reset_mock()
        self.core.get_reference_details.return_value = self.details
        self.invoices = [{"name": "INV-1", "voucher_type": "Sales Invoice"}]

    def allocate(self, party_type="Customer", payment_type="Receive"):
        with patch.object(self.allocations.frappe, "get_doc", return_value=self.document) as read:
            result = self.allocations.allocate_payment_references(
                self.payment, self.invoices, party_type, payment_type, "MXN", 2
            )
            if self.invoices:
                self.assertTrue(read.call_args.kwargs["for_update"])
            return result

    def test_customer_receipt_settles_positive_invoice(self):
        self.assertEqual(self.allocate(), (100, 100))
        self.assertEqual(self.payment.references[0].allocated_amount, 100)

    def test_customer_cash_refund_settles_negative_credit_note(self):
        self.document.outstanding_amount = -100
        self.assertEqual(self.allocate(payment_type="Pay"), (100, 100))
        self.assertEqual(self.payment.references[0].allocated_amount, -100)

    def test_supplier_payment_settles_positive_bill(self):
        self.invoices[0]["voucher_type"] = "Purchase Invoice"
        self.assertEqual(self.allocate("Supplier", "Pay"), (100, 100))
        self.assertEqual(self.payment.references[0].allocated_amount, 100)

    def test_supplier_refund_settles_negative_debit_note(self):
        self.invoices[0]["voucher_type"] = "Purchase Invoice"
        self.document.outstanding_amount = -100
        self.assertEqual(self.allocate("Supplier", "Receive"), (100, 100))
        self.assertEqual(self.payment.references[0].allocated_amount, -100)

    def test_invoice_currency_balance_is_not_converted_twice(self):
        self.document.update(currency="USD", conversion_rate=20, outstanding_amount=2000)
        self.details.total_amount = 2000
        self.payment.paid_amount = self.payment.received_amount = 3000
        self.assertEqual(self.allocate(), (2000, 3000))
        self.assertEqual(self.payment.references[0].outstanding_amount, 2000)

    def test_uses_payment_party_amount_instead_of_second_spot_conversion(self):
        self.payment.paid_amount = 2000
        self.payment.received_amount = 100
        self.document.outstanding_amount = 3000
        self.assertEqual(self.allocate(), (2000, 2000))

    def test_latest_locked_balance_overrides_stale_reference_snapshot(self):
        self.document.outstanding_amount = 20
        self.details.outstanding_amount = 100
        self.assertEqual(self.allocate(), (20, 100))
        self.assertEqual(self.payment.references[0].outstanding_amount, 20)

    def test_refund_cannot_exceed_remaining_credit(self):
        self.document.outstanding_amount = -20
        with self.assertRaisesRegex(Exception, "Refund exceeds"):
            self.allocate(payment_type="Pay")

    def test_refund_cannot_become_an_unallocated_outgoing_advance(self):
        self.invoices = []
        with self.assertRaisesRegex(Exception, "Refund exceeds"):
            self.allocate(payment_type="Pay")

    def test_normal_unallocated_advance_remains_supported(self):
        self.invoices = []
        self.assertEqual(self.allocate(), (0, 100))
        self.assertEqual(self.allocate("Supplier", "Pay"), (0, 100))

    def test_wrong_direction_and_draft_rejected(self):
        with self.assertRaisesRegex(Exception, "payment direction"):
            self.allocate(payment_type="Pay")
        self.document.docstatus = 0
        with self.assertRaisesRegex(Exception, "Only submitted"):
            self.allocate()

    def test_cannot_allocate_across_party_accounts(self):
        self.details["account"] = "Other receivable"
        with self.assertRaisesRegex(Exception, "different party account"):
            self.allocate()

    def test_split_request_keys_fit_unique_column_and_replay_stably(self):
        keys = [self.idempotency.payment_method_request_id("browser-request", n) for n in range(3)]
        self.assertEqual(keys[0], "browser-request")
        self.assertEqual(len(set(keys)), 3)
        self.assertLess(len(keys[1]), 140)
        self.assertEqual(keys[1], self.idempotency.payment_method_request_id("browser-request", 1))
        self.assertNotEqual(keys[1], self.idempotency.payment_method_request_id("other-request", 1))

    def test_lookup_returns_legacy_and_split_siblings_under_current_locks(self):
        rows = [[{"name": "PE-FIRST"}], [{"name": "PE-SECOND"}]]
        with patch.object(self.idempotency.frappe.db, "get_values", side_effect=rows) as read:
            result = self.idempotency.find_payment_entries_by_client_request_id("browser-request", for_update=True)
        self.assertEqual([row["name"] for row in result], ["PE-FIRST", "PE-SECOND"])
        self.assertTrue(all(call.kwargs["for_update"] for call in read.call_args_list))
        self.assertEqual(read.call_args_list[1].kwargs["filters"]["posa_client_request_id"],
                         ["like", self.idempotency.payment_request_prefix("browser-request") + "%"])

    def test_untrusted_request_wildcards_never_enter_prefix_filter(self):
        prefix = self.idempotency.payment_request_prefix("request%_with_wildcards")
        self.assertNotIn("%", prefix)
        self.assertNotIn("_", prefix)


if __name__ == "__main__":
    unittest.main()
