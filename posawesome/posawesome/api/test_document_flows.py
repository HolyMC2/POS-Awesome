"""Integration tests for the three POS document flows — Sales Invoice,
Sales Order, Quotation — through the SAME whitelisted entrypoints the SPA
calls. Bench-runnable (FrappeTestCase); skips when the site lacks fixtures.

Covers per flow:
* SI: create→submit (sync), payments-vs-total invariant, credit-sale server
  gate (allowed + blocked), background-job submit, idempotent replay,
  return invoice, resume guard, ledger prune retention.
* SO: create→submit via sales_orders endpoints.
* QO: create→submit via quotations endpoints.
"""

from __future__ import annotations

import json
import time
import unittest

# Bench-only integration test: needs a real frappe + site. Skip the module
# when discovered by the standalone stub-suite runner (python3 -m unittest
# discover), where frappe is not importable.
try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

# IntegrationTestCase (new-style) loads test records LAZILY — the legacy
# FrappeTestCase preloads records upfront, which explodes on this site
# (erpnext _Test fixtures absent: "_Test Product Bundle Item").
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, today

from posawesome.posawesome.api.invoice_processing import creation
from posawesome.posawesome.api import sales_orders, quotations

TEST_ITEM = "POSA-TEST-SVC"
PROFILE = "Doco Ventas"


def _ensure_test_item() -> str:
	"""Find-or-create the test service item and return its DOCNAME.

	Doco sites name Items by a series (IPN…), NOT by item_code — looking up
	`Item == TEST_ITEM` or referencing the code in invoice rows silently
	fails Link validation. Always resolve through the item_code FIELD.
	"""
	name = frappe.db.get_value("Item", {"item_code": TEST_ITEM}, "name")
	if name:
		return name
	doc = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": TEST_ITEM,
			"item_name": "POSA Test Service",
			"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
			"stock_uom": "Nos",
			"is_stock_item": 0,
			"is_sales_item": 1,
		}
	).insert(ignore_permissions=True)
	return doc.name


class TestDocumentFlows(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("POS Profile", PROFILE):
			self.skipTest("no Doco Ventas profile")
		# Per-test (not setUpClass): the runner's per-test rollback discipline
		# would drop a class-level insert before the first test body runs.
		self.item = _ensure_test_item()
		self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
		self.customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		if not self.customer:
			self.skipTest("no customer on site")
		self._created = []

	def tearDown(self):
		for doctype, name in self._created:
			try:
				doc = frappe.get_doc(doctype, name)
				if doc.docstatus == 0:
					frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			except Exception:
				pass

	# ---------- payload builders ----------

	def _crid(self, tag: str) -> str:
		return f"test-{tag}-{int(time.time() * 1000)}"

	def _si_payload(self, crid: str, rate: float = 10, pay: float | None = None):
		return {
			"doctype": "Sales Invoice",
			"pos_profile": PROFILE,
			"company": self.company,
			"customer": self.customer,
			"is_pos": 1,
			"posa_client_request_id": crid,
			"items": [
				{
					"item_code": self.item,
					"qty": 1,
					"rate": rate,
					"price_list_rate": rate,
				}
			],
			"payments": [
				{
					"mode_of_payment": "Cash",
					"type": "Cash",
					"amount": rate if pay is None else pay,
					"base_amount": rate if pay is None else pay,
				}
			],
		}

	def _data(self, **kw):
		base = {
			"total_change": 0,
			"paid_change": 0,
			"credit_change": 0,
			"redeemed_customer_credit": 0,
			"customer_credit_dict": [],
			"gift_card_redemptions": [],
			"is_cashback": 1,
		}
		base.update(kw)
		return base

	def _submit_si(self, payload, data=None, background=0):
		created = creation.update_invoice(json.dumps(payload))
		payload = dict(payload)
		payload["name"] = created.get("name")
		self._created.append(("Sales Invoice", created.get("name")))
		return creation.submit_invoice(
			json.dumps(payload),
			json.dumps(data or self._data()),
			submit_in_background=background,
		)

	# ---------- Sales Invoice ----------

	def test_si_sync_submit_happy_path(self):
		r = self._submit_si(self._si_payload(self._crid("si-sync")))
		self.assertEqual(r["docstatus"], 1)
		self.assertTrue(r["name"].startswith("ACC-SINV"))
		outstanding = frappe.db.get_value("Sales Invoice", r["name"], "outstanding_amount")
		self.assertEqual(float(outstanding or 0), 0.0)

	def test_si_payments_mismatch_rejected(self):
		payload = self._si_payload(self._crid("si-mismatch"), rate=10, pay=4)
		with self.assertRaises(frappe.ValidationError):
			self._submit_si(payload)

	def test_si_credit_sale_blocked_without_profile_flag(self):
		before = frappe.db.get_value("POS Profile", PROFILE, "posa_allow_credit_sale")
		frappe.db.set_value("POS Profile", PROFILE, "posa_allow_credit_sale", 0)
		frappe.clear_cache(doctype="POS Profile")
		try:
			payload = self._si_payload(self._crid("si-credit-block"), rate=10, pay=4)
			with self.assertRaises(frappe.ValidationError) as ctx:
				self._submit_si(payload, data=self._data(is_credit_sale=1))
			self.assertIn("Credit Sale", str(ctx.exception))
		finally:
			frappe.db.set_value("POS Profile", PROFILE, "posa_allow_credit_sale", before or 0)
			frappe.clear_cache(doctype="POS Profile")

	def test_si_credit_sale_allowed_with_profile_flag(self):
		before = frappe.db.get_value("POS Profile", PROFILE, "posa_allow_credit_sale")
		frappe.db.set_value("POS Profile", PROFILE, "posa_allow_credit_sale", 1)
		frappe.clear_cache(doctype="POS Profile")
		try:
			payload = self._si_payload(self._crid("si-credit-ok"), rate=10, pay=4)
			r = self._submit_si(payload, data=self._data(is_credit_sale=1))
			self.assertEqual(r["docstatus"], 1)
			outstanding = frappe.db.get_value("Sales Invoice", r["name"], "outstanding_amount")
			self.assertGreater(float(outstanding), 0)
		finally:
			frappe.db.set_value("POS Profile", PROFILE, "posa_allow_credit_sale", before or 0)
			frappe.clear_cache(doctype="POS Profile")

	def test_si_background_job_submits_draft(self):
		"""Full background sequence: submit_invoice parks the draft (with
		payments applied + ledger context) and enqueues; we run the job
		body directly since enqueue_after_commit never fires in tests."""
		before = frappe.db.get_value(
			"POS Profile", PROFILE, "posa_allow_submissions_in_background_job"
		)
		frappe.db.set_value(
			"POS Profile", PROFILE, "posa_allow_submissions_in_background_job", 1
		)
		frappe.clear_cache(doctype="POS Profile")
		try:
			r = self._submit_si(self._si_payload(self._crid("si-bg")), background=1)
			name = r["name"]
			self.assertEqual(r["docstatus"], 0, "background mode must return the parked draft")
			creation.submit_in_background_job(
				{
					"invoice": name,
					"doctype": "Sales Invoice",
					"data": self._data(),
					"is_payment_entry": 0,
					"total_cash": 0,
					"cash_account": {},
					"payments": [],
					"user": "Administrator",
					"ledger_name": None,
				}
			)
			self.assertEqual(
				frappe.db.get_value("Sales Invoice", name, "docstatus"), 1
			)
		finally:
			frappe.db.set_value(
				"POS Profile",
				PROFILE,
				"posa_allow_submissions_in_background_job",
				before or 0,
			)
			frappe.clear_cache(doctype="POS Profile")

	def test_si_idempotent_replay_same_request_id(self):
		crid = self._crid("si-replay")
		payload = self._si_payload(crid)
		first = self._submit_si(payload)
		self.assertEqual(first["docstatus"], 1)
		# same client_request_id again — must replay, not double-bill
		replay = creation.submit_invoice(
			json.dumps(self._si_payload(crid)),
			json.dumps(self._data()),
			submit_in_background=0,
		)
		self.assertEqual(replay["name"], first["name"])
		self.assertTrue(replay.get("idempotent"))

	def test_si_return_invoice(self):
		# posa_allow_return is server-gated now — force ON for portability.
		self._return_flag_before = frappe.db.get_value(
			"POS Profile", PROFILE, "posa_allow_return"
		)
		frappe.db.set_value("POS Profile", PROFILE, "posa_allow_return", 1)
		frappe.clear_cache(doctype="POS Profile")
		self.addCleanup(
			lambda: (
				frappe.db.set_value(
					"POS Profile", PROFILE, "posa_allow_return", self._return_flag_before or 0
				),
				frappe.clear_cache(doctype="POS Profile"),
			)
		)
		sale = self._submit_si(self._si_payload(self._crid("si-ret-src")))
		ret = self._si_payload(self._crid("si-ret"), rate=10, pay=-10)
		ret["is_return"] = 1
		ret["return_against"] = sale["name"]
		ret["items"][0]["qty"] = -1
		r = self._submit_si(ret)
		self.assertEqual(r["docstatus"], 1)
		grand = frappe.db.get_value("Sales Invoice", r["name"], "grand_total")
		self.assertLess(float(grand), 0)

	def test_resume_guard_noop_on_submitted(self):
		r = self._submit_si(self._si_payload(self._crid("si-resume-guard")))
		out = creation.resume_held_submission(r["name"], "Sales Invoice")
		self.assertFalse(out["resumed"])
		self.assertEqual(out["docstatus"], 1)

	def test_ledger_prune_keeps_non_final(self):
		ledger = frappe.get_doc(
			{
				"doctype": "POS Invoice Submission Ledger",
				"ledger_key": f"test-prune-{int(time.time() * 1000)}",
				"client_request_id": "test-prune",
				"company": self.company,
				"pos_profile": PROFILE,
				"document_type": "Sales Invoice",
				"state": "POST_SUBMIT_DONE",
			}
		).insert(ignore_permissions=True)
		stale = frappe.get_doc(
			{
				"doctype": "POS Invoice Submission Ledger",
				"ledger_key": f"test-prune-failed-{int(time.time() * 1000)}",
				"client_request_id": "test-prune-failed",
				"company": self.company,
				"pos_profile": PROFILE,
				"document_type": "Sales Invoice",
				"state": "FAILED",
			}
		).insert(ignore_permissions=True)
		old = add_days(today(), -90)
		frappe.db.sql(
			"UPDATE `tabPOS Invoice Submission Ledger` SET modified = %s WHERE name IN (%s, %s)",
			(old, ledger.name, stale.name),
		)
		creation.prune_submission_ledger(days=45)
		self.assertFalse(frappe.db.exists("POS Invoice Submission Ledger", ledger.name))
		self.assertTrue(frappe.db.exists("POS Invoice Submission Ledger", stale.name))
		frappe.delete_doc("POS Invoice Submission Ledger", stale.name, force=True, ignore_permissions=True)

	# ---------- Sales Order ----------

	def test_so_create_and_submit(self):
		payload = {
			"doctype": "Sales Order",
			"company": self.company,
			"customer": self.customer,
			"pos_profile": PROFILE,
			"delivery_date": add_days(today(), 1),
			"items": [
				{
					"item_code": self.item,
					"qty": 1,
					"rate": 10,
					"price_list_rate": 10,
					"delivery_date": add_days(today(), 1),
				}
			],
		}
		draft = sales_orders.update_sales_order(json.dumps(payload))
		self._created.append(("Sales Order", draft.name))
		self.assertEqual(draft.docstatus, 0)
		payload["name"] = draft.name
		r = sales_orders.submit_sales_order(json.dumps(payload))
		self.assertEqual(r["status"], 1)
		self.assertEqual(
			frappe.db.get_value("Sales Order", r["name"], "docstatus"), 1
		)

	# ---------- Quotation ----------

	def test_qo_create_and_submit(self):
		payload = {
			"doctype": "Quotation",
			"company": self.company,
			"quotation_to": "Customer",
			"party_name": self.customer,
			"customer": self.customer,
			"items": [
				{
					"item_code": self.item,
					"qty": 1,
					"rate": 10,
					"price_list_rate": 10,
				}
			],
		}
		draft = quotations.update_quotation(json.dumps(payload))
		self._created.append(("Quotation", draft.name))
		self.assertEqual(draft.docstatus, 0)
		payload["name"] = draft.name
		r = quotations.submit_quotation(json.dumps(payload))
		self.assertEqual(r["status"], 1)
		self.assertEqual(frappe.db.get_value("Quotation", r["name"], "docstatus"), 1)
