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
from posawesome.posawesome.api import sales_orders, quotations, invoices

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

	# ---------- Sales Order: picker filter, conversion, advance payment -----

	def _so_payload(self, rate: float = 10, payments=None):
		p = {
			"doctype": "Sales Order",
			"company": self.company,
			"customer": self.customer,
			"pos_profile": PROFILE,
			"delivery_date": add_days(today(), 1),
			"items": [
				{
					"item_code": self.item,
					"qty": 1,
					"rate": rate,
					"price_list_rate": rate,
					"delivery_date": add_days(today(), 1),
				}
			],
		}
		if payments is not None:
			p["payments"] = payments
		return p

	def _submit_so(self, payload):
		r = sales_orders.submit_sales_order(json.dumps(payload))
		self._created.append(("Sales Order", r["name"]))
		return r["name"]

	def _enable_select_so(self):
		"""Turn on the SO-picker feature flag for the test, then restore it."""
		before = frappe.db.get_value("POS Profile", PROFILE, "custom_allow_select_sales_order")
		frappe.db.set_value("POS Profile", PROFILE, "custom_allow_select_sales_order", 1)
		frappe.clear_cache(doctype="POS Profile")
		self.addCleanup(
			lambda: (
				frappe.db.set_value(
					"POS Profile", PROFILE, "custom_allow_select_sales_order", before or 0
				),
				frappe.clear_cache(doctype="POS Profile"),
			)
		)

	def test_search_orders_excludes_closed_order(self):
		"""Regression: a Closed SO is still docstatus=1 with billing_status
		'Not Billed', so it leaked into the POS 'Select S.O' picker. The
		status filter must drop it while keeping a live Not-Billed SO."""
		self._enable_select_so()
		currency = frappe.db.get_value("Company", self.company, "default_currency")

		live = self._submit_so(self._so_payload())
		closed = self._submit_so(self._so_payload())
		frappe.get_doc("Sales Order", closed).update_status("Closed")

		rows = sales_orders.search_orders(self.company, currency, pos_profile=PROFILE)
		names = {getattr(r, "name", None) or r.get("name") for r in rows}
		self.assertIn(live, names, "live Not-Billed SO must be listed")
		self.assertNotIn(closed, names, "Closed SO must NOT appear in the picker")

		# On Hold (apartado/layaway) SOs must STAY billable from POS — they are
		# deliberately NOT in the status exclusion.
		held = self._submit_so(self._so_payload())
		frappe.get_doc("Sales Order", held).update_status("On Hold")
		held_rows = sales_orders.search_orders(self.company, currency, pos_profile=PROFILE)
		held_names = {getattr(r, "name", None) or r.get("name") for r in held_rows}
		self.assertIn(held, held_names, "On Hold (layaway) SO must remain listed")

	def test_order_to_invoice_backrefs_and_bills_so(self):
		"""SO -> Sales Invoice via the whitelisted facade must copy the
		sales_order/so_detail back-refs, and submitting the invoice must
		flow billing back onto the SO (per_billed, billing_status)."""
		self._enable_select_so()
		so_name = self._submit_so(self._so_payload(rate=10))

		inv = invoices.create_sales_invoice_from_order(so_name, pos_profile=PROFILE)
		self.assertEqual(inv.items[0].sales_order, so_name, "invoice item must back-ref the SO")
		self.assertTrue(inv.items[0].so_detail, "invoice item must carry so_detail row link")

		inv.flags.ignore_permissions = True
		inv.insert(ignore_permissions=True)
		self._created.append(("Sales Invoice", inv.name))
		inv.submit()

		so = frappe.get_doc("Sales Order", so_name)
		self.assertEqual(so.billing_status, "Fully Billed")
		self.assertEqual(float(so.per_billed), 100.0)

	def test_so_with_payments_creates_advance_payment_entry(self):
		"""submit_sales_order with payments enqueues an advance Payment Entry
		against the SO. Run the job body directly (enqueue_after_commit never
		fires in tests) and assert the PE references the SO."""
		payments = [{"mode_of_payment": "Cash", "amount": 10, "base_amount": 10}]
		so_name = self._submit_so(self._so_payload(rate=10, payments=payments))

		sales_orders._payment_entry_job(so_name, payments)

		refs = frappe.get_all(
			"Payment Entry Reference",
			filters={"reference_doctype": "Sales Order", "reference_name": so_name},
			fields=["parent", "allocated_amount"],
		)
		self.assertTrue(refs, "a Payment Entry must reference the SO")
		self.assertEqual(float(refs[0].allocated_amount), 10.0)

	def test_submit_sales_order_enqueues_payment_job(self):
		"""The advance Payment Entry is fire-and-forget: submit_sales_order must
		enqueue _payment_entry_job with the EXACT dotted path + kwargs. A renamed
		path/kwarg would silently drop the cashier's payment (SO submitted, cash
		taken, no PE, no error) — so guard the enqueue wiring directly. The job
		body itself is covered by the test above."""
		from unittest.mock import patch

		payments = [{"mode_of_payment": "Cash", "amount": 10, "base_amount": 10}]
		payload = self._so_payload(rate=10, payments=payments)
		with patch.object(sales_orders.frappe, "enqueue") as enq:
			r = sales_orders.submit_sales_order(json.dumps(payload))
			self._created.append(("Sales Order", r["name"]))
			self.assertEqual(
				frappe.db.get_value("Sales Order", r["name"], "docstatus"), 1,
				"SO must submit even though the PE is enqueued",
			)
		self.assertTrue(enq.called, "submit_sales_order must enqueue the advance PE job")
		method_arg = enq.call_args.args[0] if enq.call_args.args else enq.call_args.kwargs.get("job")
		self.assertEqual(
			method_arg, "posawesome.posawesome.api.sales_orders._payment_entry_job",
			"enqueue must target the current dotted path",
		)
		self.assertEqual(enq.call_args.kwargs.get("order_name"), r["name"])
		self.assertEqual(enq.call_args.kwargs.get("payments"), payments)

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
