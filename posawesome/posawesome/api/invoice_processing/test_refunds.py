"""Standalone refund accounting regressions; no Frappe site needed."""

import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


class Row(dict):
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone harness - run directly")
class RefundTests(unittest.TestCase):
    def setUp(self):
        self.accounts = {
            "Cash": Row(company="Co", account_type="Cash", account_currency="MXN"),
            "BankUSD": Row(company="Co", account_type="Bank", account_currency="USD"),
            "Gift": Row(company="Co", account_type="Liability", account_currency="MXN"),
            "Receivable": Row(company="Co", account_type="Receivable", account_currency="MXN"),
        }
        frappe = types.ModuleType("frappe")
        frappe._ = lambda text: text
        frappe.throw = lambda text: self.fail_with(text)
        def cached(doctype, name, field, **kwargs):
            if doctype == "Company":
                return "MXN"
            row = self.accounts.get(name, Row())
            return row if isinstance(field, list) else row.get(field)
        frappe.get_cached_value = cached
        utils = types.ModuleType("frappe.utils")
        utils.flt = lambda val, *args: float(val or 0)
        self.modules = patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": utils})
        self.modules.start()
        spec = importlib.util.spec_from_file_location("refund_under_test", pathlib.Path(__file__).with_name("refunds.py"))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.original = Row(name="Invoice", company="Co", customer="Customer", currency="MXN",
                            debit_to="Receivable", conversion_rate=1)
        self.payment = Row(name="Receipt", docstatus=1, payment_type="Receive", party_type="Customer", party="Customer",
                           company="Co", paid_from="Receivable", paid_to="Cash",
                           paid_from_account_currency="MXN", paid_to_account_currency="MXN",
                           base_received_amount=100, source_exchange_rate=1)
        self.refs = [Row(reference_doctype="Sales Invoice", reference_name="Invoice", allocated_amount=100)]

    def tearDown(self):
        self.modules.stop()

    def fail_with(self, text):
        raise ValueError(text)

    def received(self):
        return self.module._cash_allocation(self.payment, self.refs, {("Sales Invoice", "Invoice")},
                                            self.original, "MXN", True)

    def test_submitted_later_receipt_counts(self):
        self.assertEqual(self.received(), 100)

    def test_unallocated_receipt_does_not_count(self):
        self.refs.clear()
        self.assertEqual(self.received(), 0)

    def test_wrong_scope_cancelled_currency_and_non_cash_do_not_count(self):
        for field, value in [("docstatus", 2), ("party", "Other"), ("company", "Other"),
                             ("paid_from_account_currency", "USD"), ("paid_to", "Gift"),
                             ("paid_from", "Other"), ("payment_type", "Pay")]:
            with self.subTest(field=field), patch.dict(self.payment, {field: value}):
                self.assertEqual(self.received(), 0)

    def test_deduction_is_not_refundable_cash(self):
        self.payment.base_received_amount = 80
        self.assertEqual(self.received(), 80)

    def test_receipt_with_credit_note_or_multiple_invoices_preserves_cash_budget(self):
        self.refs.append(Row(reference_doctype="Sales Invoice", reference_name="Other", allocated_amount=100))
        self.refs.append(Row(reference_doctype="Sales Invoice", reference_name="Credit", allocated_amount=-100))
        self.assertEqual(self.received(), 50)

    def test_mixed_bank_currency_uses_booked_exchange_rates(self):
        self.payment.update(paid_to="BankUSD", paid_to_account_currency="USD", base_received_amount=1000)
        self.refs[0].allocated_amount = 1000
        self.assertEqual(self.received(), 1000)
        self.original.update(currency="USD", conversion_rate=20)
        self.assertEqual(self.module._party_currency_factor(self.original), ("MXN", 0.05))
        self.assertEqual(self.received() * self.module._party_currency_factor(self.original)[1], 50)

    def test_unknown_currency_conversion_is_rejected(self):
        self.accounts["Receivable"].account_currency = "EUR"
        with self.assertRaisesRegex(ValueError, "currency conversion"):
            self.module._party_currency_factor(self.original)

    def test_invalid_payment_exchange_rate_is_rejected(self):
        self.payment.source_exchange_rate = 0
        with self.assertRaisesRegex(ValueError, "currency conversion"):
            self.received()

    def test_embedded_cash_nets_change_and_excludes_gift_liability(self):
        doc = Row(company="Co", is_pos=1, change_amount=20,
                  payments=[Row(account="Cash", amount=100), Row(account="Gift", amount=50)])
        self.assertEqual(self.module._embedded_money(doc), 80)

    def test_credit_display_payment_rows_do_not_double_count_payment_entries(self):
        doc = Row(company="Co", is_pos=0, payments=[Row(account="Cash", amount=100)])
        self.assertEqual(self.module._embedded_money(doc), 0)

    def test_negative_refund_allocation_counts_only_real_payout(self):
        self.payment.update(payment_type="Pay", paid_from="Cash", paid_to="Receivable",
                            target_exchange_rate=1, base_paid_amount=40)
        self.refs[0].allocated_amount = -40
        amount = self.module._cash_allocation(self.payment, self.refs, {("Sales Invoice", "Invoice")},
                                              self.original, "MXN", False)
        self.assertEqual(amount, 40)

    def complete_limit(self, payments, prior_returns=None, embedded=None, request=None):
        self.original.update(docstatus=1, is_return=0, grand_total=100)
        locks = []
        frappe = self.module.frappe
        frappe.db = Row(get_value=lambda *args: "Customer", sql=lambda *args, **kwargs: prior_returns or [])
        def get_doc(doctype, name, **kwargs):
            self.assertTrue(kwargs.get("for_update"))
            locks.append((doctype, name))
            return self.original
        frappe.get_doc = get_doc
        integrity = types.ModuleType("posawesome.posawesome.api.payment_processing.integrity")
        integrity.lock_payment_party = lambda doctype, name: locks.append((doctype, name))
        payload = Row(doctype="Sales Invoice", return_against="Invoice", company="Co", customer="Customer", currency="MXN")
        payload.update(request or {})
        with patch.dict(sys.modules, {integrity.__name__: integrity}), \
             patch.object(self.module, "_payment_rows", return_value=payments), \
             patch.object(self.module, "_current_embedded_money", side_effect=lambda dt, name, co: (embedded or {}).get(name, 0)):
            result = self.module.refundable_cash(payload)
        self.assertEqual(locks[:2], [("Customer", "Customer"), ("Sales Invoice", "Invoice")])
        return result

    def test_reversed_receipt_reduces_money_backing_original_invoice(self):
        payout = Row(self.payment)
        payout.update(name="Reversal", payment_type="Pay", paid_from="Cash", paid_to="Receivable",
                      target_exchange_rate=1, base_paid_amount=40)
        refs = [Row(reference_doctype="Payment Entry", reference_name="Receipt", allocated_amount=40)]
        self.assertEqual(self.complete_limit([(self.payment, self.refs), (payout, refs)]), 60)

    def test_prior_pos_refund_and_pay_entry_are_subtracted_once_each(self):
        payout = Row(self.payment)
        payout.update(name="Payout", payment_type="Pay", paid_from="Cash", paid_to="Receivable",
                      target_exchange_rate=1, base_paid_amount=20)
        refs = [Row(reference_doctype="Sales Invoice", reference_name="Return", allocated_amount=-20)]
        available = self.complete_limit([(self.payment, self.refs), (payout, refs)],
                                        [Row(name="Return", currency="MXN")], {"Return": 30})
        self.assertEqual(available, 50)

    def test_excess_tender_belongs_to_advance_balance(self):
        self.payment.base_received_amount = 200
        self.refs[0].allocated_amount = 200
        self.assertEqual(self.complete_limit([(self.payment, self.refs)]), 100)

    def test_original_customer_company_currency_mismatch_is_rejected(self):
        for field in ("customer", "company", "currency"):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "match this return"):
                self.complete_limit([], request={field: "Other"})

    def test_unproven_prior_refund_currency_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "different currency"):
            self.complete_limit([], [Row(name="Return", currency="EUR")])


if __name__ == "__main__":
    unittest.main()
