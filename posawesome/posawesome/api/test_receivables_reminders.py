"""The reminder log's write endpoint, against a real site (bench lane).

The pure half (cap arithmetic, absence) lives in `test_receivables.py`'s
standalone lane; what needs a site is the part the stubs cannot prove:

* the ladder steps off the LOG, one step per day, cap included;
* a settled invoice refuses a reminder;
* the read model hands the same state back on the worklist row and the
  detail, log included — the chip and the history come from one derivation.
"""

from __future__ import annotations

import json
import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, today

from posawesome.posawesome.api import receivables, receivables_reminders
from posawesome.posawesome.api.invoice_processing import creation
from posawesome.posawesome.api.test_document_flows import PROFILE, _ensure_test_item
from posawesome.posawesome.api.test_profile_gates import _FlagPatch


class TestReceivablesReminders(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("POS Profile", PROFILE):
			self.skipTest("no Doco Ventas profile")
		self.item = _ensure_test_item()
		self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
		self.customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		self._created = []
		self._reminders = []

	def tearDown(self):
		for name in self._reminders:
			try:
				frappe.delete_doc(
					"POS Collection Reminder", name, force=True, ignore_permissions=True
				)
			except Exception:
				pass
		for doctype, name in self._created:
			try:
				doc = frappe.get_doc(doctype, name)
				if doc.docstatus == 1:
					doc.flags.ignore_permissions = True
					doc.cancel()
				frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			except Exception:
				pass

	def _credit_invoice(self, tag: str):
		"""A submitted invoice with its whole total outstanding."""
		import time

		payload = {
			"doctype": "Sales Invoice",
			"pos_profile": PROFILE,
			"company": self.company,
			"customer": self.customer,
			"is_pos": 1,
			"posa_client_request_id": f"rem-{tag}-{int(time.time() * 1000)}",
			"items": [
				{"item_code": self.item, "qty": 1, "rate": 10, "price_list_rate": 10}
			],
			"payments": [
				{"mode_of_payment": "Cash", "type": "Cash", "amount": 0, "base_amount": 0}
			],
		}
		data = {
			"total_change": 0,
			"paid_change": 0,
			"credit_change": 0,
			"redeemed_customer_credit": 0,
			"customer_credit_dict": [],
			"gift_card_redemptions": [],
			"is_cashback": 1,
			"is_credit_sale": 1,
			"due_date": today(),
		}
		with _FlagPatch("posa_allow_credit_sale", 1):
			created = creation.update_invoice(json.dumps(payload))
			payload = dict(payload)
			payload["name"] = created.get("name")
			self._created.append(("Sales Invoice", created.get("name")))
			r = creation.submit_invoice(
				json.dumps(payload), json.dumps(data), submit_in_background=0
			)
		self.assertEqual(r["docstatus"], 1)
		return r["name"]

	def _backdate(self, reminder_name: str, days: int):
		# Simulate the calendar passing between presses — the one-step-per-day
		# rule reads `creation`, so the test moves it rather than sleeping.
		frappe.db.set_value(
			"POS Collection Reminder",
			reminder_name,
			"creation",
			f"{add_days(today(), -days)} 10:00:00",
			update_modified=False,
		)

	def _file(self, invoice: str, **kwargs):
		result = receivables_reminders.file_reminder(PROFILE, invoice, **kwargs)
		if result.get("reminder") and not result.get("already_today"):
			self._reminders.append(result["reminder"])
		return result

	def test_the_ladder_steps_daily_and_caps_at_three(self):
		invoice = self._credit_invoice("ladder")

		first = self._file(invoice)
		self.assertFalse(first["already_today"])
		self.assertEqual(first["level"], 1)

		# The same afternoon: no second step, no new row.
		again = self._file(invoice)
		self.assertTrue(again["already_today"])
		self.assertEqual(again["level"], 1)
		self.assertEqual(again["count"], 1)

		self._backdate(first["reminder"], 1)
		second = self._file(invoice)
		self.assertEqual(second["level"], 2)

		self._backdate(second["reminder"], 1)
		third = self._file(invoice)
		self.assertEqual(third["level"], 3)

		# The cap repeats the final notice rather than inventing level 4.
		self._backdate(third["reminder"], 1)
		fourth = self._file(invoice)
		self.assertEqual(fourth["level"], 3)
		self.assertEqual(fourth["count"], 4)

	def test_a_settled_invoice_refuses_a_reminder(self):
		invoice = self._credit_invoice("settled")
		frappe.db.set_value(
			"Sales Invoice", invoice, "outstanding_amount", 0, update_modified=False
		)
		with self.assertRaises(frappe.ValidationError):
			receivables_reminders.file_reminder(PROFILE, invoice)

	def test_the_worklist_and_the_detail_read_the_same_ladder(self):
		invoice = self._credit_invoice("readback")
		filed = self._file(invoice, channel="whatsapp", note="promised Friday")
		self.assertEqual(filed["level"], 1)

		detail = receivables.get_receivable_detail(PROFILE, invoice)
		self.assertEqual(detail["row"]["reminders"]["count"], 1)
		self.assertEqual(detail["row"]["reminders"]["last_level"], 1)
		self.assertEqual(detail["row"]["reminders"]["next_level"], 2)
		self.assertEqual(len(detail["reminders"]), 1)
		entry = detail["reminders"][0]
		# Channel normalisation: a lowercased client string lands cased.
		self.assertEqual(entry["channel"], "WhatsApp")
		self.assertEqual(entry["note"], "promised Friday")
		self.assertEqual(entry["outstanding_at_send"], 10)

		# The worklist read is capped (search refines the capped page, it does
		# not widen it — module header). On a register drowning in open
		# invoices the fresh test row may fall outside the page; the detail
		# assertions above already prove the shared derivation, so here we
		# only require that IF the row is on the page it wears the same state.
		worklist = receivables.get_receivables(
			PROFILE, bucket="all", search=invoice, limit=receivables.MAX_LIMIT
		)
		rows = [row for row in worklist["rows"] if row["name"] == invoice]
		if rows:
			self.assertEqual(rows[0]["reminders"]["count"], 1)
			self.assertEqual(rows[0]["reminders"]["next_level"], 2)
		else:
			self.assertTrue(worklist["capped"])


if __name__ == "__main__":
	unittest.main()
