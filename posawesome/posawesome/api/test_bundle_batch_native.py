"""End-to-end proof that a POS sale of a Product Bundle with a batch-tracked
component submits, and that ERPNext allocates the component's batches itself.

POS Awesome writes NO batch hint for packed (Product Bundle) rows. It used to:
`api/utilities.py::set_batch_nos_for_bundels`, called from
`invoice_processing/creation.py` with `throw=True` on every submit, picked a
batch and wrote it into `packed_items.batch_no`. Two measurements on the lab
bench (erpnext 16.32.0, 2026-09-12) retired it:

* submit moves the allocation into a Serial and Batch Bundle, points the packed
  row at that bundle and CLEARS the row's own `batch_no` - the hint is
  discarded, and the allocation was byte-identical with the pick disabled;
* one row can split across batches (3 units out of batches of 1 and 20), which
  a single `batch_no` field cannot express, so the function's `throw` branch
  could only ever refuse sales ERPNext completes correctly.

Before that it had never run at all: it referenced `get_batch_no`,
`get_batch_qty`, `flt` and `_` without importing any of them, so from the 2025
refactor onward this sale died with a NameError on exactly the rarest
configuration and nothing else noticed. So these tests are the standing proof
for the REMOVAL: the configuration that used to crash now submits, allocates,
moves stock, skips expired batches and splits - all of it ERPNext's own work.

Bench-runnable (IntegrationTestCase); skips when the site lacks fixtures. The
standalone guard that the hint stays retired (and that nothing in utilities.py
reads an undefined global) is `test_utilities_global_resolution.py`; this module
is the real-bench half, and it SKIPS in the standalone lane
(`scripts/run_backend_tests.py`), so it has to be invoked on a site explicitly.
It is not yet in the native-suite loop in docs/testing/backend.md; run it with:

	docker compose exec -T backend bench --site <site> run-tests \\
	  --module posawesome.posawesome.api.test_bundle_batch_native
"""

from __future__ import annotations

import json
import time
import unittest
import uuid

# Bench-only integration test: needs a real frappe + site. Skip the module when
# discovered by the standalone stub-suite runner (python3 -m unittest discover),
# where frappe is not importable. Never a bare module-scope `import frappe` in a
# file under api/ — the standalone runner imports every test module before it
# runs anything (reference_posawesome_ci_baseline).
try:
	import frappe
except ImportError:
	raise unittest.SkipTest("bench-only integration test - requires frappe") from None

from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, today

from posawesome.posawesome.api.invoice_processing import creation

PROFILE = "Doco Ventas"
COMPONENT_ITEM = "POSA-TEST-BATCH-COMP"
BUNDLE_ITEM = "POSA-TEST-BUNDLE"
RATE = 25.0


class TestBundleBatchAllocation(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("POS Profile", PROFILE):
			self.skipTest(f"no {PROFILE} profile on this site")
		self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
		self.warehouse = frappe.db.get_value("POS Profile", PROFILE, "warehouse")
		if not self.warehouse:
			self.skipTest("POS Profile has no warehouse")
		self.customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		if not self.customer:
			self.skipTest("no customer on site")

		# Newest first: the cleanup order is the reverse of creation.
		self._stock_entries = []
		self._invoices = []
		self._batches = []
		self._shift = None

		self.component = self._ensure_component_item()
		self.bundle_parent = self._ensure_bundle_parent_item()
		self.bundle = self._ensure_bundle()
		self.proof = self._open_shift()

	def tearDown(self):
		for name in self._invoices:
			self._discard("Sales Invoice", name)
		for name in self._stock_entries:
			self._discard("Stock Entry", name)
		for batch in self._batches:
			self._discard("Batch", batch)
		if self._shift:
			frappe.db.set_value("POS Opening Shift", self._shift, "status", "Closed")
			self._discard("POS Opening Shift", self._shift)
		frappe.local.posa_verified_terminal_generations = {}

	# ---------- fixtures ----------

	def _discard(self, doctype, name):
		"""Cancel if submitted, then delete. Never fails the test itself."""
		try:
			if not frappe.db.exists(doctype, name):
				return
			doc = frappe.get_doc(doctype, name)
			if getattr(doc, "docstatus", 0) == 1:
				doc.flags.ignore_permissions = True
				doc.cancel()
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
		except Exception:
			# A left-over lab row is noise, a failed teardown masking the real
			# assertion is not.
			pass

	def _ensure_component_item(self) -> str:
		"""Batch-tracked STOCK item — the component whose batch must be picked.

		Doco sites name Items by a series (IPN…), not by item_code, so always
		resolve through the item_code FIELD (test_document_flows carries the
		same warning).
		"""
		name = frappe.db.get_value("Item", {"item_code": COMPONENT_ITEM}, "name")
		if name:
			return name
		doc = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": COMPONENT_ITEM,
				"item_name": "POSA Test Batch Component",
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": "Nos",
				"is_stock_item": 1,
				"is_sales_item": 1,
				"has_batch_no": 1,
				"create_new_batch": 1,
				"batch_number_series": "POSA-TB-.####",
			}
		).insert(ignore_permissions=True)
		return doc.name

	def _ensure_bundle_parent_item(self) -> str:
		"""The sold item. ERPNext requires a Product Bundle parent to be non-stock."""
		name = frappe.db.get_value("Item", {"item_code": BUNDLE_ITEM}, "name")
		if name:
			return name
		doc = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": BUNDLE_ITEM,
				"item_name": "POSA Test Bundle",
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 1,
			}
		).insert(ignore_permissions=True)
		return doc.name

	def _open_shift(self) -> dict:
		"""An open shift bound to this "browser".

		`creation._verify_invoice_terminal` refuses to save or submit without
		one, and `assert_terminal_access` wants the matching terminal id,
		generation and token, so the possession proof has to travel in the
		submit `data` the same way the SPA sends it. Any shift this cashier
		already has open would make `create_opening_voucher` throw, so reuse it.
		"""
		from posawesome.posawesome.api import shifts

		terminal_id = f"posa-test-terminal-{uuid.uuid4().hex}"
		terminal_token = uuid.uuid4().hex * 2  # 64 chars, as the SPA mints them

		existing = frappe.db.get_all(
			"POS Opening Shift",
			filters={
				"user": frappe.session.user,
				"pos_closing_shift": ["is", "not set"],
				"docstatus": 1,
				"status": "Open",
			},
			fields=["name", "pos_profile"],
			limit=1,
		)
		if existing:
			if existing[0].pos_profile != PROFILE:
				self.skipTest(f"cashier has an open shift on {existing[0].pos_profile}")
			from posawesome.posawesome.api import shift_terminal

			status = shift_terminal.claim_terminal(
				existing[0].name, terminal_id, terminal_token, acknowledge_legacy=1
			)
			return {
				"opening_shift": existing[0].name,
				"terminal_id": terminal_id,
				"terminal_generation": status["terminal_generation"],
				"terminal_token": terminal_token,
			}

		opened = shifts.create_opening_voucher(
			PROFILE,
			self.company,
			json.dumps([{"mode_of_payment": "Cash", "opening_amount": 0}]),
			terminal_id=terminal_id,
			terminal_token=terminal_token,
		)
		self._shift = opened["pos_opening_shift"]["name"]
		return {
			"opening_shift": self._shift,
			"terminal_id": terminal_id,
			"terminal_generation": opened["terminal_status"]["terminal_generation"],
			"terminal_token": terminal_token,
		}

	def _ensure_bundle(self) -> str:
		existing = frappe.db.get_value("Product Bundle", {"new_item_code": self.bundle_parent}, "name")
		if existing:
			return existing
		doc = frappe.get_doc(
			{
				"doctype": "Product Bundle",
				"new_item_code": self.bundle_parent,
				"description": "POSA bundle+batch regression fixture",
				"items": [{"item_code": self.component, "qty": 1}],
			}
		).insert(ignore_permissions=True)
		return doc.name

	def _receive_stock(self, qty: float, expiry_date=None) -> str:
		"""Material Receipt of one new batch into the profile warehouse.

		`use_serial_batch_fields = 1` is what makes v15+ honour a plain
		`batch_no` on the row instead of demanding a Serial and Batch Bundle.
		An `expiry_date` is stamped AFTER the receipt: ERPNext refuses to
		receive stock into an already-expired batch (BatchExpiredError).
		"""
		batch = frappe.get_doc(
			{
				"doctype": "Batch",
				"item": self.component,
				"batch_id": f"POSA-TB-{uuid.uuid4().hex[:12]}",
			}
		).insert(ignore_permissions=True)
		self._batches.append(batch.name)

		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Receipt",
				"purpose": "Material Receipt",
				"company": self.company,
				"items": [
					{
						"item_code": self.component,
						"qty": qty,
						"t_warehouse": self.warehouse,
						"basic_rate": 5,
						"use_serial_batch_fields": 1,
						"batch_no": batch.name,
					}
				],
			}
		)
		entry.flags.ignore_permissions = True
		entry.insert(ignore_permissions=True)
		entry.submit()
		self._stock_entries.append(entry.name)
		if expiry_date:
			frappe.db.set_value("Batch", batch.name, "expiry_date", expiry_date)
		return batch.name

	# ---------- the sale ----------

	def _payload(self, tag: str):
		return {
			"doctype": "Sales Invoice",
			"pos_profile": PROFILE,
			"company": self.company,
			"customer": self.customer,
			"is_pos": 1,
			"posa_pos_opening_shift": self.proof["opening_shift"],
			"posa_client_request_id": f"test-{tag}-{int(time.time() * 1000)}",
			"items": [
				{
					"item_code": self.bundle_parent,
					"qty": 1,
					"rate": RATE,
					"price_list_rate": RATE,
					"warehouse": self.warehouse,
				}
			],
			"payments": [
				{
					"mode_of_payment": "Cash",
					"type": "Cash",
					"amount": RATE,
					"base_amount": RATE,
				}
			],
		}

	def _data(self):
		return {
			"total_change": 0,
			"paid_change": 0,
			"credit_change": 0,
			"redeemed_customer_credit": 0,
			"customer_credit_dict": [],
			"gift_card_redemptions": [],
			"is_cashback": 1,
			"terminal_id": self.proof["terminal_id"],
			"terminal_generation": self.proof["terminal_generation"],
			"terminal_token": self.proof["terminal_token"],
		}

	def _autosave(self, payload):
		"""The SPA's draft save; the possession proof rides along here too."""
		return creation.update_invoice(json.dumps({**payload, **self._terminal_proof()}))

	def _terminal_proof(self):
		return {
			"terminal_id": self.proof["terminal_id"],
			"terminal_generation": self.proof["terminal_generation"],
			"terminal_token": self.proof["terminal_token"],
		}

	def _sell_bundle(self, tag: str):
		payload = self._payload(tag)
		created = self._autosave(payload)
		name = created.get("name")
		self._invoices.append(name)
		payload = dict(payload)
		payload["name"] = name
		return creation.submit_invoice(json.dumps(payload), json.dumps(self._data()))

	def _allocated_batches(self, invoice_name):
		"""(batch_no, qty) the submitted invoice actually consumed.

		Never assert on `packed_items.batch_no`: on submit v16 moves the
		allocation into a Serial and Batch Bundle, points the row at that bundle
		and CLEARS the row's own `batch_no` - it is empty afterwards whether or
		not anything wrote it first, which is exactly why the hint was pointless.
		The bundle (and the Stock Ledger Entry beside it) is where the truth
		lives, so that is what these tests assert on.
		"""
		allocated = []
		for row in frappe.get_doc("Sales Invoice", invoice_name).packed_items:
			bundle = row.get("serial_and_batch_bundle")
			if bundle:
				allocated += [
					(entry.batch_no, entry.qty)
					for entry in frappe.get_doc("Serial and Batch Bundle", bundle).entries
				]
		return allocated

	# ---------- tests ----------

	def test_selling_a_bundle_with_a_batch_tracked_component_submits(self):
		"""The configuration that used to crash, now with no hint on the path.

		`set_batch_nos_for_bundels` used to run here with `throw=True`,
		referencing four names its module never imported; the loop body was
		reached by exactly this configuration and nothing else. Both the call and
		the function are gone, so this asserts what is left: ERPNext allocates
		the batch on its own.
		"""
		batch = self._receive_stock(qty=10)

		result = self._sell_bundle("bundle-batch")

		self.assertEqual(result["docstatus"], 1)
		self.assertEqual(self._allocated_batches(result["name"]), [(batch, -1.0)])

	def test_no_batch_hint_is_written_before_submit_and_the_sale_still_allocates(self):
		"""The removal itself: the draft's packed row is untouched by POS Awesome.

		This is the assertion the hint would break. While
		`set_batch_nos_for_bundels` existed, the draft that came back from
		`update_invoice` carried `batch_no` = the batch it picked. It must be
		empty now, and the submit that follows must still allocate that same
		batch - which is the whole argument for deleting the hint rather than
		repairing it.

		`use_serial_batch_fields` is deliberately NOT asserted: ERPNext's own
		`make_packing_list` already sets it to 1 on every packed row (measured on
		the lab, 2026-09-12, on a draft built with no hint on the path), so it
		says nothing about who wrote what. `batch_no` is the only field the hint
		owned.
		"""
		batch = self._receive_stock(qty=10)

		payload = self._payload("bundle-batch-no-hint")
		created = self._autosave(payload)
		name = created.get("name")
		self._invoices.append(name)

		draft = frappe.get_doc("Sales Invoice", name)
		self.assertEqual(len(draft.packed_items), 1, "ERPNext did not pack the bundle")
		packed = draft.packed_items[0]
		self.assertEqual(packed.item_code, self.component)
		self.assertFalse(packed.batch_no, f"a server-side batch hint is back: {packed.batch_no}")
		self.assertIsNone(packed.serial_and_batch_bundle)

		payload["name"] = name
		result = creation.submit_invoice(json.dumps(payload), json.dumps(self._data()))

		self.assertEqual(result["docstatus"], 1)
		self.assertEqual(self._allocated_batches(result["name"]), [(batch, -1.0)])

	def test_the_component_leaves_the_profile_warehouse(self):
		"""A bundle that packs but never moves stock is a silent inventory hole."""
		batch = self._receive_stock(qty=10)

		result = self._sell_bundle("bundle-batch-wh")

		ledger = frappe.get_all(
			"Stock Ledger Entry",
			filters={"voucher_no": result["name"], "item_code": self.component},
			fields=["warehouse", "actual_qty", "serial_and_batch_bundle"],
		)
		self.assertEqual(len(ledger), 1)
		self.assertEqual(ledger[0].warehouse, self.warehouse)
		self.assertEqual(ledger[0].actual_qty, -1.0)
		self.assertEqual(frappe.db.get_value("Batch", batch, "item"), self.component)

	def test_an_expired_batch_is_not_sold(self):
		"""FIFO reaches the expired batch first; nothing may allocate from it."""
		expired = self._receive_stock(qty=10, expiry_date=add_days(today(), -1))
		fresh = self._receive_stock(qty=10)

		result = self._sell_bundle("bundle-batch-expiry")

		allocated = self._allocated_batches(result["name"])
		self.assertEqual(allocated, [(fresh, -1.0)])
		self.assertNotIn(expired, [batch for batch, _qty in allocated])

	def test_a_line_larger_than_any_single_batch_still_sells(self):
		"""Split across batches - the shape no single `batch_no` can express.

		No single batch covers 3 units, so the retired hint would have found
		nothing to write, and its pre-rewrite `throw` behaviour would have
		refused this sale outright. ERPNext's own bundle allocation splits the
		line instead. This is the leg that decided the removal.
		"""
		small = self._receive_stock(qty=1)
		big = self._receive_stock(qty=20)

		payload = self._payload("bundle-batch-split")
		payload["items"][0]["qty"] = 3
		payload["payments"][0]["amount"] = RATE * 3
		payload["payments"][0]["base_amount"] = RATE * 3
		created = self._autosave(payload)
		self._invoices.append(created.get("name"))
		payload["name"] = created.get("name")
		result = creation.submit_invoice(json.dumps(payload), json.dumps(self._data()))

		self.assertEqual(result["docstatus"], 1)
		allocated = dict(self._allocated_batches(result["name"]))
		self.assertEqual(allocated, {small: -1.0, big: -2.0})

	def test_a_short_batch_named_on_the_packed_row_is_still_refused(self):
		"""The one branch the removal dropped is covered by the stock guard.

		`set_batch_nos_for_bundels` had a second branch: when a packed row
		ALREADY carried a `batch_no`, it compared `get_batch_qty` against the row
		and `frappe.throw`-ed if the named batch could not cover it. That branch
		was reachable - the SPA sends `packed_items[].batch_no`
		(`invoice_utils/document.ts`), and ERPNext's `make_packing_list` keeps an
		existing packed row's `batch_no` across a save (it never writes that field
		itself: see the TODO in erpnext's `update_packed_item_stock_data`). So the
		first half of this test proves the value survives, and the second half
		proves what refuses it now.

		`_validate_stock_on_invoice`, which runs where the hint used to sit,
		already walks `packed_items` as well as `items` and refuses per batch and
		warehouse. Its refusal is strictly better than the deleted one: a JSON
		body with item, warehouse, batch, requested and available qty, instead of
		a prose message.
		"""
		batch = self._receive_stock(qty=1)

		payload = self._payload("bundle-batch-short-preset")
		payload["items"][0]["qty"] = 3
		payload["payments"][0]["amount"] = RATE * 3
		payload["payments"][0]["base_amount"] = RATE * 3
		created = self._autosave(payload)
		name = created.get("name")
		self._invoices.append(name)

		draft = frappe.get_doc("Sales Invoice", name)
		draft.packed_items[0].batch_no = batch
		draft.flags.ignore_permissions = True
		draft.save()

		reloaded = frappe.get_doc("Sales Invoice", name)
		self.assertEqual(reloaded.packed_items[0].batch_no, batch, "preset batch did not survive the save")
		self.assertEqual(reloaded.packed_items[0].qty, 3.0)

		payload["name"] = name
		with self.assertRaises(frappe.ValidationError) as refusal:
			creation.submit_invoice(json.dumps(payload), json.dumps(self._data()))

		reported = json.loads(str(refusal.exception))["errors"]
		self.assertEqual(len(reported), 1)
		self.assertEqual(reported[0]["batch_no"], batch)
		self.assertEqual(reported[0]["item_code"], self.component)
		self.assertEqual(reported[0]["warehouse"], self.warehouse)
		self.assertEqual(reported[0]["requested_qty"], 3.0)
		self.assertEqual(reported[0]["available_qty"], 1.0)
		self.assertEqual(reported[0]["policy"], "block")
		self.assertEqual(frappe.db.get_value("Sales Invoice", name, "docstatus"), 0)
