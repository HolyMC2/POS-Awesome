"""Standalone payment-boundary regressions; no bench or database writes."""

import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location("payment_scope_harness", Path(__file__).with_name("test_payment_processor_scope.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


@unittest.skipIf(harness._UNDER_BENCH, "standalone framework fixture")
class PaymentIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.scenario = harness._scenario()
        self.processor = harness._load_processor(self.scenario)
        self.integrity = sys.modules["posawesome.posawesome.api.payment_processing.integrity"]
        self.receipt = Mock(response=None)
        self.receipt.completed.return_value = None
        receipt_patch = patch("posawesome.posawesome.api.payment_processing.request_ledger.claim_financial_request",
                              return_value=self.receipt)
        receipt_patch.start()
        self.addCleanup(receipt_patch.stop)

    def payload(self, amount=25):
        payload = harness._payload()
        payload["payment_methods"] = [{"mode_of_payment": "Cash", "amount": amount}]
        payload["total_payment_methods"] = 25
        return payload

    def invoice(self, outstanding=60):
        invoice = harness._AttrDict(
            doctype="Sales Invoice", name="SINV-001", company="Tenant A", customer="CUST-001", docstatus=1,
            currency="MXN", conversion_rate=1, outstanding_amount=outstanding,
            rounded_total=60, grand_total=60, is_return=0,
        )
        self.scenario["documents"][("Sales Invoice", invoice.name)] = invoice
        return invoice

    def test_invalid_tender_rejected_before_creation(self):
        for amount in (-1, True, False, float("nan"), float("inf"), "NaN", "Infinity", "bad", None, {}, []):
            with self.subTest(amount=amount), patch.object(self.processor, "create_payment_entry") as create:
                with self.assertRaisesRegex(Exception, "finite positive"):
                    self.processor.process_pos_payment(json.dumps(self.payload(amount)))
                create.assert_not_called()
        self.assertEqual(self.integrity.payment_amount("12.50"), 12.5)
        self.assertEqual(self.integrity.payment_amount(0, allow_zero=True), 0)
        with self.assertRaisesRegex(Exception, "finite positive"):
            self.integrity.payment_amount(0)

    def test_invalid_exchange_rate_and_party_direction_rejected(self):
        for field, value in (("exchange_rate", -1), ("exchange_rate", True), ("party_type", "Employee"), ("payment_type", "Internal Transfer")):
            with self.subTest(field=field, value=value), patch.object(self.processor, "create_payment_entry") as create:
                payload = self.payload()
                payload[field] = value
                with self.assertRaises(Exception):
                    self.processor.process_pos_payment(json.dumps(payload))
                create.assert_not_called()

    def test_mode_must_be_configured_on_register(self):
        self.scenario["profiles"]["Allowed POS"]["payments"] = [{"mode_of_payment": "Card"}]
        with self.assertRaisesRegex(harness._PermissionError, "Mode of payment"):
            self.processor.process_pos_payment(json.dumps(self.payload()))

    def test_split_tenders_use_fresh_balances_and_ignore_forged_values(self):
        invoice = self.invoice()
        payload = self.payload(40)
        payload["payment_methods"] *= 2
        payload["total_payment_methods"] = 80
        payload["selected_invoices"] = [{"voucher_no": invoice.name, "outstanding_amount": 1000, "conversion_rate": 99}] * 2
        entries = []

        def create(**kwargs):
            entry = harness._FakePaymentEntry(kwargs["amount"])
            entry.name = f"PE-{len(entries)}"
            original_submit = entry.submit

            def submit():
                original_submit()
                invoice["outstanding_amount"] -= sum(row.allocated_amount for row in entry.references)

            entry.submit = submit
            entries.append(entry)
            return entry

        with patch.object(self.processor, "create_payment_entry", side_effect=create):
            result = self.processor.process_pos_payment(json.dumps(payload))
        self.assertEqual(result["errors"], [])
        self.assertEqual([sum(row.allocated_amount for row in entry.references) for entry in entries], [40, 20])
        self.assertEqual(invoice.outstanding_amount, 0)
        self.assertEqual(entries[-1].unallocated_amount, 20)
        self.assertEqual([len(entry.references) for entry in entries], [1, 1])

    def test_failed_submit_rolls_back_draft_before_next_tender(self):
        payload = self.payload()
        payload["payment_methods"].append({"mode_of_payment": "Card", "amount": 25})
        payload["total_payment_methods"] = 50
        database_rows = []
        savepoints = {}
        entries = [harness._FakePaymentEntry(25), harness._FakePaymentEntry(25)]
        entries[0].name, entries[1].name = "FAILED-PE", "GOOD-PE"
        for entry in entries:
            entry.save = lambda ignore_permissions=False, entry=entry: database_rows.append(entry.name)
        entries[0].submit = lambda: (_ for _ in ()).throw(RuntimeError("ledger failure"))
        db = self.processor.frappe.db
        with patch.object(db, "savepoint", side_effect=lambda name: savepoints.update({name: list(database_rows)})), patch.object(db, "rollback", side_effect=lambda save_point: database_rows.__setitem__(slice(None), savepoints[save_point])), patch.object(self.processor, "create_payment_entry", side_effect=entries):
            result = self.processor.process_pos_payment(json.dumps(payload))
        self.assertEqual(database_rows, ["GOOD-PE"])
        self.assertEqual(result["errors"], ["ledger failure"])
        self.assertEqual([row["name"] for row in result["new_payments_entry"]], ["GOOD-PE"])

    def test_sale_cannot_be_forged_as_credit_note(self):
        invoice = self.invoice()
        payload = harness._payload()
        payload["selected_payments"] = [{"name": invoice.name, "is_credit_note": 1}]
        payload["total_selected_payments"] = 60
        with patch.object(self.processor, "reconcile_dr_cr_note") as reconcile:
            result = self.processor.process_pos_payment(json.dumps(payload))
        reconcile.assert_not_called()
        self.assertIn("Selected credit note does not belong to this party.", result["errors"])

    def test_reconciliation_requires_company_profile_flag_and_party_access(self):
        authorize = self.integrity.authorize_reconciliation
        for company, profile in (("Tenant B", None), ("Tenant A", "Foreign POS"), ("Tenant A", "Make Payments Off")):
            with self.subTest(company=company, profile=profile), self.assertRaises(harness._PermissionError):
                authorize(company, "Customer", "CUST-001", profile)
        # Old clients' null invoice filter still resolves an authorized register.
        authorize("Tenant A", "Customer", "CUST-001")
        self.scenario["denied_documents"].add(("Customer", "CUST-001"))
        with self.assertRaises(harness._PermissionError):
            authorize("Tenant A", "Customer", "CUST-001", "Allowed POS")

    def test_changed_retry_amount_rejected_and_current_lookup_requested(self):
        entry = harness._AttrDict(name="PE-1", company="Tenant A", party="CUST-001", party_type="Customer", payment_type="Receive", docstatus=1, mode_of_payment="Cash", paid_amount=25, received_amount=25)
        self.scenario["documents"][("Payment Entry", "PE-1")] = entry
        payload = self.payload(30)
        payload["client_request_id"] = "request-1"
        with patch.object(self.processor, "find_payment_entries_by_client_request_id", return_value=[entry]) as lookup, patch.object(self.processor, "create_payment_entry") as create:
            with self.assertRaisesRegex(Exception, "different payment methods or amounts"):
                self.processor.process_pos_payment(json.dumps(payload))
        lookup.assert_called_once_with("request-1", for_update=True)
        create.assert_not_called()

    def test_retry_compares_bank_currency_amount(self):
        matched, missing, extra = self.processor._partition_payment_methods(
            [{"mode_of_payment": "Cash", "docstatus": 1, "payment_type": "Receive", "paid_amount": 400, "received_amount": 20}],
            [{"mode_of_payment": "Cash", "amount": 20}],
        )
        self.assertEqual(len(matched), 1)
        self.assertEqual((missing, extra), ([], []))

    def test_reconciliation_failure_restores_party_validation(self):
        self.processor.frappe.flags.ignore_party_validation = False

        def fail_after_flag():
            self.processor.frappe.flags.ignore_party_validation = True
            raise RuntimeError("reconciliation failed")

        with self.assertRaisesRegex(RuntimeError, "reconciliation failed"):
            self.integrity.run_reconciliation(fail_after_flag)
        self.assertFalse(self.processor.frappe.flags.ignore_party_validation)

    def test_customer_refund_payment_cannot_be_reconciled_as_received_credit(self):
        self.scenario["documents"][("Payment Entry", "REFUND-1")] = harness._AttrDict(
            name="REFUND-1", company="Tenant A", party_type="Customer", party="CUST-001", payment_type="Pay",
        )
        payload = harness._payload()
        payload["selected_payments"] = [{"name": "REFUND-1"}]
        with self.assertRaisesRegex(harness._PermissionError, "wrong payment direction"):
            self.processor.process_pos_payment(json.dumps(payload))

    def test_supplier_reconciliation_uses_payable_account_and_debit(self):
        invoice = harness._AttrDict(name="PINV-001", company="Tenant A", supplier="SUPP-1", outstanding_amount=25, conversion_rate=1)
        payment = harness._AttrDict(name="PAY-SUPP-1", company="Tenant A", party_type="Supplier", party="SUPP-1", payment_type="Pay", unallocated_amount=25, paid_to="Creditors - A", paid_from="Cash - A", cost_center="Trusted CC - A")
        payment.reload = lambda: payment.update(unallocated_amount=0)
        self.scenario["documents"][("Purchase Invoice", invoice.name)] = invoice
        self.scenario["documents"][("Payment Entry", payment.name)] = payment
        payload = harness._payload()
        payload.update(party="SUPP-1", party_type="Supplier", payment_type="Pay", selected_invoices=[{"voucher_type": "Purchase Invoice", "voucher_no": invoice.name}], selected_payments=[{"name": payment.name}], total_selected_payments=25)
        with patch("posawesome.posawesome.api.payment_processing.source_reconciliation.reconcile_source",
                   return_value=(payment, 25)) as reconcile:
            result = self.processor.process_pos_payment(json.dumps(payload))
        self.assertEqual(result["errors"], [])
        self.assertEqual(reconcile.call_args.args[0], payment)
        self.assertEqual(reconcile.call_args.args[2:5], ("Tenant A", "Supplier", "SUPP-1"))

    def test_advance_can_partially_settle_a_smaller_invoice(self):
        invoice = self.invoice(outstanding=20)
        payment = harness._AttrDict(name="ADVANCE-1", company="Tenant A", party_type="Customer", party="CUST-001", payment_type="Receive", unallocated_amount=60, paid_from="Debtors - A", cost_center="Trusted CC - A")
        payment.reload = lambda: payment.update(unallocated_amount=40)
        self.scenario["documents"][("Payment Entry", payment.name)] = payment
        payload = harness._payload()
        payload.update(selected_invoices=[{"voucher_no": invoice.name}], selected_payments=[{"name": payment.name}], total_selected_payments=60)
        def allocate(*args):
            payment.unallocated_amount = 40
            return payment, 20
        with patch("posawesome.posawesome.api.payment_processing.source_reconciliation.reconcile_source",
                   side_effect=allocate) as reconcile:
            result = self.processor.process_pos_payment(json.dumps(payload))
        self.assertEqual(result["errors"], [])
        self.assertEqual(reconcile.call_args.args[1][0]["outstanding_amount"], 20)
        self.assertEqual(result["reconciled_payments"][0]["allocated_amount"], 20)
        self.assertEqual(payment.unallocated_amount, 40)

    def test_replay_cannot_change_payment_direction(self):
        entry = harness._AttrDict(name="PE-1", company="Tenant A", party="CUST-001", party_type="Customer", payment_type="Receive", docstatus=1, mode_of_payment="Cash", paid_amount=25, received_amount=25)
        self.scenario["documents"][("Payment Entry", "PE-1")] = entry
        payload = self.payload()
        payload.update(client_request_id="request-1", payment_type="Pay")
        with patch.object(self.processor, "find_payment_entries_by_client_request_id", return_value=[entry]), patch.object(self.processor, "create_payment_entry") as create:
            with self.assertRaisesRegex(Exception, "different payment direction"):
                self.processor.process_pos_payment(json.dumps(payload))
        create.assert_not_called()

    def test_read_only_lock_conflict_retries_entire_callback(self):
        class Conflict(Exception):
            pass
        db = self.processor.frappe.db
        db.transaction_writes = 0
        self.processor.frappe.QueryDeadlockError = Conflict
        calls = []
        def callback(value):
            calls.append(value)
            if len(calls) == 1:
                raise Conflict("snapshot changed")
            return "settled"
        self.assertEqual(self.integrity.retry_before_financial_writes(callback, 42), "settled")
        self.assertEqual(calls, [42, 42])
        self.assertEqual(self.scenario["rollbacks"], [None])

    def test_lock_retry_never_discards_caller_or_payment_writes(self):
        class Conflict(Exception):
            pass
        db = self.processor.frappe.db
        self.processor.frappe.QueryDeadlockError = Conflict
        for initial_writes in (0, 1):
            with self.subTest(initial_writes=initial_writes):
                db.transaction_writes = initial_writes
                def callback():
                    db.transaction_writes = 1
                    raise Conflict("snapshot changed")
                with self.assertRaises(Conflict):
                    self.integrity.retry_before_financial_writes(callback)
        self.assertEqual(self.scenario.get("rollbacks", []), [])

    def test_read_only_retry_is_bounded(self):
        class Conflict(Exception):
            pass
        self.processor.frappe.QueryDeadlockError = Conflict
        self.processor.frappe.db.transaction_writes = 0
        calls = []
        def callback():
            calls.append(1)
            raise Conflict("snapshot changed")
        with self.assertRaises(Conflict):
            self.integrity.retry_before_financial_writes(callback)
        self.assertEqual(len(calls), 3)
        self.assertEqual(self.scenario["rollbacks"], [None, None])


if __name__ == "__main__":
    unittest.main()
