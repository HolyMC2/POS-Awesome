"""Real public POS reconciliation: native ERPNext books, rollback-only fixtures."""
import json
import unittest
import uuid
from unittest.mock import patch

import frappe
from posawesome.posawesome.api.payment_processing.processor import process_pos_payment


class TestSourceReconciliation(unittest.TestCase):
    def setUp(self):
        from doco.docoutils.test_charge_delivery import TestChargeDelivery
        self.fixture = TestChargeDelivery()
        self.fixture.setUp()
        self.profile = self.fixture.profile
        for field in ("posa_use_pos_awesome_payments", "posa_allow_make_new_payments", "posa_allow_reconcile_payments"):
            self.profile.set(field, 1)
        self.profile.save(ignore_permissions=True)
        self.currency = frappe.get_cached_value("Company", self.profile.company, "default_currency")
        self.supplier = frappe.get_doc(dict(doctype="Supplier", supplier_name=self.fixture.tag,
            supplier_type="Individual", supplier_group=frappe.db.get_value("Supplier Group", {"is_group": 0}, "name"))).insert(ignore_permissions=True)

    def tearDown(self):
        self.fixture.tearDown()

    def debt(self, amount, kind="Customer", credit=False):
        dt = "Purchase Invoice" if kind == "Supplier" else "Sales Invoice"
        party_field = "supplier" if kind == "Supplier" else "customer"
        doc = frappe.get_doc(dict(doctype=dt, company=self.profile.company,
            **{party_field: self.supplier.name if kind == "Supplier" else self.fixture.customer.name},
            currency=self.currency, is_pos=0, update_stock=0, is_return=int(credit), ignore_pricing_rule=1,
            items=[dict(item_code=self.fixture.item.name, qty=-1 if credit else 1, rate=amount)]))
        doc.insert(ignore_permissions=True).submit()
        return doc

    def payload(self, target=None, sources=(), kind="Customer"):
        return dict(self.fixture.proof, party=self.supplier.name if kind == "Supplier" else self.fixture.customer.name,
            party_type=kind, payment_type="Pay" if kind == "Supplier" else "Receive", currency=self.currency,
            pos_profile_name=self.profile.name, pos_opening_shift_name=self.fixture.shift.name,
            selected_invoices=[dict(voucher_type=target.doctype, voucher_no=target.name)] if target else [],
            selected_payments=[dict(name=doc.name, voucher_type=doc.doctype,
                is_credit_note=int(doc.doctype != "Payment Entry"), allocated_amount=amount) for doc, amount in sources],
            selected_mpesa_payments=[], payment_methods=[], total_payment_methods=0,
            total_selected_mpesa_payments=0, total_selected_payments=sum(amount for doc, amount in sources),
            client_request_id="reconcile-test-" + uuid.uuid4().hex)

    def call(self, payload):
        return process_pos_payment(json.dumps(payload))

    def advance(self, amount):
        data = self.payload()
        data.update(payment_methods=[dict(mode_of_payment=self.profile.payments[0].mode_of_payment, amount=amount)],
                    total_payment_methods=amount)
        result = self.call(data)
        self.assertFalse(result["errors"])
        return frappe.get_doc("Payment Entry", result["new_payments_entry"][0]["name"])

    def test_pure_advance_replay_keeps_partial_remainder_and_rejects_changed_intent(self):
        source = self.advance(60)
        target = self.debt(40)
        data = self.payload(target, [(source, 60)])
        first = self.call(data)
        self.assertFalse(first["errors"])
        again = self.call(data)
        self.assertTrue(again["replayed"])
        self.assertEqual(first["reconciled_payments"], again["reconciled_payments"])
        source.reload(); target.reload()
        self.assertEqual((source.unallocated_amount, target.outstanding_amount), (20, 0))
        changed = dict(data, selected_payments=[dict(data["selected_payments"][0], allocated_amount=20)])
        with self.assertRaisesRegex(frappe.ValidationError, "different transaction details"):
            self.call(changed)

    def test_partial_source_failure_retry_preserves_committed_step(self):
        from posawesome.posawesome.api.payment_processing.source_reconciliation import reconcile_source
        first, second = self.advance(30), self.advance(30)
        target = self.debt(50)
        data = self.payload(target, [(first, 30), (second, 30)])
        def fail_second(source, *args):
            if source.name == second.name:
                raise RuntimeError("Injected second source failure")
            return reconcile_source(source, *args)
        with patch("posawesome.posawesome.api.payment_processing.source_reconciliation.reconcile_source", side_effect=fail_second):
            failed = self.call(data)
        self.assertEqual(failed["errors"], ["Injected second source failure"])
        first.reload(); second.reload(); target.reload()
        self.assertEqual((first.unallocated_amount, second.unallocated_amount, target.outstanding_amount), (0, 30, 20))
        retried = self.call(data)
        self.assertFalse(retried["errors"])
        self.assertEqual([row["allocated_amount"] for row in retried["reconciled_payments"]], [30, 20])
        first.reload(); second.reload(); target.reload()
        self.assertEqual((first.unallocated_amount, second.unallocated_amount, target.outstanding_amount), (0, 10, 0))

    def check_note(self, kind):
        from posawesome.posawesome.api.payment_processing.data import get_outstanding_invoices, get_unallocated_payments
        source, target = self.debt(60, kind, True), self.debt(40, kind)
        party = self.supplier.name if kind == "Supplier" else self.fixture.customer.name
        rows = get_outstanding_invoices(party=party, party_type=kind, company=self.profile.company, currency=self.currency)
        self.assertTrue(any(row["voucher_no"] == source.name and row["outstanding_amount"] == -60 for row in rows))
        rows = get_unallocated_payments(customer=party, party_type=kind, company=self.profile.company, currency=self.currency)
        self.assertTrue(any(row["name"] == source.name and row["is_credit_note"] for row in rows))
        data = self.payload(target, [(source, 60)], kind)
        result = self.call(data)
        self.assertFalse(result["errors"])
        self.assertTrue(self.call(data)["replayed"])
        source.reload(); target.reload()
        self.assertEqual((source.outstanding_amount, target.outstanding_amount), (-20, 0))

    def test_customer_credit_note_uses_native_accounting(self):
        self.check_note("Customer")

    def test_supplier_debit_note_uses_native_accounting(self):
        self.check_note("Supplier")

    def test_pos_credit_selector_excludes_desk_journals_but_keeps_payment_and_note(self):
        from posawesome.posawesome.api.payment_processing.data import get_unallocated_payments
        advance, credit = self.advance(60), self.debt(20, credit=True)
        journal = frappe.get_doc(dict(doctype="Journal Entry", company=self.profile.company,
            posting_date=frappe.utils.today(), voucher_type="Journal Entry", accounts=[
                dict(account=advance.paid_to, debit_in_account_currency=30),
                dict(account=advance.paid_from, credit_in_account_currency=30,
                     party_type="Customer", party=self.fixture.customer.name, is_advance="Yes")]))
        journal.insert(ignore_permissions=True).submit()
        rows = get_unallocated_payments(customer=self.fixture.customer.name,
            party_type="Customer", company=self.profile.company, currency=self.currency)
        keys = {(row["voucher_type"], row["name"]) for row in rows}
        self.assertIn(("Payment Entry", advance.name), keys)
        self.assertIn(("Sales Invoice", credit.name), keys)
        self.assertNotIn(("Journal Entry", journal.name), keys)
        self.assertEqual(journal.docstatus, 1)
