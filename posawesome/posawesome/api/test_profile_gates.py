"""Server backstops for POS Profile client-only flags (POS-PROFILE-SPEC P0).

Each gate mirrors `_validate_credit_sale_allowed`: the SPA hides the UI,
the server enforces the policy. Tests force the flag both ways and restore.
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

from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, today

from posawesome.posawesome.api.invoice_processing import creation
from posawesome.posawesome.api import gift_cards, invoices
from posawesome.posawesome.api.test_document_flows import PROFILE, _ensure_test_item


class _FlagPatch:
	def __init__(self, field: str, value):
		self.field = field
		self.value = value

	def __enter__(self):
		self.before = frappe.db.get_value("POS Profile", PROFILE, self.field)
		frappe.db.set_value("POS Profile", PROFILE, self.field, self.value)
		frappe.clear_cache(doctype="POS Profile")
		return self

	def __exit__(self, *exc):
		frappe.db.set_value("POS Profile", PROFILE, self.field, self.before or 0)
		frappe.clear_cache(doctype="POS Profile")
		return False


class TestProfileGates(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("POS Profile", PROFILE):
			self.skipTest("no Doco Ventas profile")
		self.item = _ensure_test_item()
		self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
		self.customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
		self._created = []

	def tearDown(self):
		for doctype, name in self._created:
			try:
				doc = frappe.get_doc(doctype, name)
				if doc.docstatus == 0:
					frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			except Exception:
				pass

	def _payload(self, tag: str, **extra):
		payload = {
			"doctype": "Sales Invoice",
			"pos_profile": PROFILE,
			"company": self.company,
			"customer": self.customer,
			"is_pos": 1,
			"posa_client_request_id": f"gate-{tag}-{int(time.time() * 1000)}",
			"items": [
				{"item_code": self.item, "qty": 1, "rate": 10, "price_list_rate": 10}
			],
			"payments": [
				{"mode_of_payment": "Cash", "type": "Cash", "amount": 10, "base_amount": 10}
			],
		}
		payload.update(extra)
		return payload

	def _data(self):
		return {
			"total_change": 0,
			"paid_change": 0,
			"credit_change": 0,
			"redeemed_customer_credit": 0,
			"customer_credit_dict": [],
			"gift_card_redemptions": [],
			"is_cashback": 1,
		}

	def _submit(self, payload):
		created = creation.update_invoice(json.dumps(payload))
		payload = dict(payload)
		payload["name"] = created.get("name")
		self._created.append(("Sales Invoice", created.get("name")))
		return creation.submit_invoice(
			json.dumps(payload), json.dumps(self._data()), submit_in_background=0
		)

	# ---------- posting date ----------

	def test_backdated_posting_rejected_when_flag_off(self):
		with _FlagPatch("posa_allow_change_posting_date", 0):
			payload = self._payload("pd-off", posting_date=add_days(today(), -30))
			with self.assertRaises(frappe.ValidationError) as ctx:
				self._submit(payload)
			self.assertIn("posting date", str(ctx.exception).lower())

	def test_backdated_posting_allowed_when_flag_on(self):
		with _FlagPatch("posa_allow_change_posting_date", 1):
			target = add_days(today(), -3)
			r = self._submit(self._payload("pd-on", posting_date=target))
			self.assertEqual(r["docstatus"], 1)
			self.assertEqual(
				str(frappe.db.get_value("Sales Invoice", r["name"], "posting_date")),
				str(target),
			)

	def test_today_posting_unaffected_by_flag(self):
		with _FlagPatch("posa_allow_change_posting_date", 0):
			r = self._submit(self._payload("pd-today", posting_date=today()))
			self.assertEqual(r["docstatus"], 1)

	# ---------- returns ----------

	def test_return_rejected_when_flag_off(self):
		with _FlagPatch("posa_allow_return", 1):
			sale = self._submit(self._payload("ret-src"))
		with _FlagPatch("posa_allow_return", 0):
			ret = self._payload("ret-off", is_return=1, return_against=sale["name"])
			ret["items"][0]["qty"] = -1
			ret["payments"][0]["amount"] = -10
			ret["payments"][0]["base_amount"] = -10
			with self.assertRaises(frappe.ValidationError) as ctx:
				self._submit(ret)
			self.assertIn("return", str(ctx.exception).lower())

	def test_return_allowed_when_flag_on(self):
		with _FlagPatch("posa_allow_return", 1):
			sale = self._submit(self._payload("ret-on-src"))
			ret = self._payload("ret-on", is_return=1, return_against=sale["name"])
			ret["items"][0]["qty"] = -1
			ret["payments"][0]["amount"] = -10
			ret["payments"][0]["base_amount"] = -10
			r = self._submit(ret)
			self.assertEqual(r["docstatus"], 1)

	# ---------- delete ----------

	def test_delete_rejected_when_flag_off(self):
		created = creation.update_invoice(json.dumps(self._payload("del-off")))
		self._created.append(("Sales Invoice", created.get("name")))
		frappe.db.set_value(
			"Sales Invoice", created.get("name"), "posa_is_printed", 0, update_modified=False
		)
		with _FlagPatch("posa_allow_delete", 0):
			with self.assertRaises(frappe.ValidationError):
				invoices.delete_invoice(created.get("name"))
		self.assertTrue(frappe.db.exists("Sales Invoice", created.get("name")))

	def test_delete_allowed_when_flag_on(self):
		created = creation.update_invoice(json.dumps(self._payload("del-on")))
		frappe.db.set_value(
			"Sales Invoice", created.get("name"), "posa_is_printed", 0, update_modified=False
		)
		with _FlagPatch("posa_allow_delete", 1):
			invoices.delete_invoice(created.get("name"))
		self.assertFalse(frappe.db.exists("Sales Invoice", created.get("name")))

	# ---------- gift cards ----------

	def _ensure_admin_on_profile(self):
		"""The supervisor gate checks profile membership before our feature
		gate — put Administrator on the profile so the FEATURE gate is the
		one under test. Row insert rolls back with the test."""
		profile = frappe.get_doc("POS Profile", PROFILE)
		users = {row.user for row in (profile.applicable_for_users or [])}
		if "Administrator" not in users:
			profile.append("applicable_for_users", {"user": "Administrator"})
			profile.flags.ignore_validate = True
			profile.save(ignore_permissions=True)
			frappe.clear_cache(doctype="POS Profile")

	def test_gift_card_issue_rejected_when_feature_off(self):
		self._ensure_admin_on_profile()
		with _FlagPatch("posa_use_gift_cards", 0):
			with self.assertRaises(frappe.ValidationError) as ctx:
				gift_cards.issue_gift_card(
					pos_profile=PROFILE,
					cashier="Administrator",
					company=self.company,
					initial_amount=100,
					gift_card_code=f"GATE-{int(time.time())}",
				)
			self.assertIn("not enabled", str(ctx.exception))

	def test_gift_card_topup_rejected_when_feature_off(self):
		self._ensure_admin_on_profile()
		with _FlagPatch("posa_use_gift_cards", 0):
			with self.assertRaises(frappe.ValidationError):
				gift_cards.top_up_gift_card(
					pos_profile=PROFILE,
					cashier="Administrator",
					gift_card_code="GATE-NONEXISTENT",
					amount=50,
				)

	# ---------- customer credit ----------

	def test_customer_credit_rejected_when_flag_off(self):
		with _FlagPatch("use_customer_credit", 0):
			payload = self._payload("cc-off")
			data = self._data()
			data["redeemed_customer_credit"] = 5
			created = creation.update_invoice(json.dumps(payload))
			payload = dict(payload)
			payload["name"] = created.get("name")
			self._created.append(("Sales Invoice", created.get("name")))
			with self.assertRaises(frappe.ValidationError) as ctx:
				creation.submit_invoice(
					json.dumps(payload), json.dumps(data), submit_in_background=0
				)
			self.assertIn("Customer credit", str(ctx.exception))

	# ---------- item name override ----------

	def test_name_override_dropped_when_flag_off(self):
		with _FlagPatch("posa_allow_line_item_name_override", 0):
			payload = self._payload("name-off")
			payload["items"][0]["item_name"] = "Nombre Trucho"
			r = self._submit(payload)
			self.assertEqual(r["docstatus"], 1)
			row_name = frappe.db.get_value(
				"Sales Invoice Item", {"parent": r["name"]}, ["item_name", "name_overridden"], as_dict=True
			)
			self.assertEqual(row_name.item_name, "POSA Test Service")
			self.assertEqual(int(row_name.name_overridden or 0), 0)

	def test_name_override_applied_when_flag_on(self):
		with _FlagPatch("posa_allow_line_item_name_override", 1):
			payload = self._payload("name-on")
			payload["items"][0]["item_name"] = "Nombre Personalizado"
			r = self._submit(payload)
			row = frappe.db.get_value(
				"Sales Invoice Item", {"parent": r["name"]}, ["item_name", "name_overridden"], as_dict=True
			)
			self.assertEqual(row.item_name, "Nombre Personalizado")
			self.assertEqual(int(row.name_overridden), 1)

	# ---------- delivery charges ----------

	def test_delivery_charge_rejected_when_flag_off(self):
		charge = frappe.db.get_value("Delivery Charges", {}, "name")
		if not charge:
			self.skipTest("no Delivery Charges doc on site")
		with _FlagPatch("posa_use_delivery_charges", 0):
			payload = self._payload("dc-off", posa_delivery_charges=charge)
			with self.assertRaises(frappe.ValidationError) as ctx:
				creation.update_invoice(json.dumps(payload))
			self.assertIn("Delivery charges", str(ctx.exception))

	# ---------- quotation / SO-select flow gates (P2) ----------

	def _quotation_payload(self, tag: str):
		return {
			"doctype": "Quotation",
			"company": self.company,
			"customer": self.customer,
			"transaction_date": today(),
			"items": [{"item_code": self.item, "qty": 1, "rate": 10}],
			"posa_notes": f"gate-{tag}",
		}

	def test_quotation_flow_rejected_when_flag_off(self):
		from posawesome.posawesome.api import quotations

		with _FlagPatch("custom_allow_create_quotation", 0):
			with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
				quotations.update_quotation(
					json.dumps(self._quotation_payload("q-off")), pos_profile=PROFILE
				)

	def test_quotation_flow_allowed_when_flag_on(self):
		from posawesome.posawesome.api import quotations

		with _FlagPatch("custom_allow_create_quotation", 1):
			doc = quotations.update_quotation(
				json.dumps(self._quotation_payload("q-on")), pos_profile=PROFILE
			)
			self._created.append(("Quotation", doc.name))
			self.assertEqual(doc.docstatus, 0)

	def test_search_orders_rejected_when_flag_off(self):
		from posawesome.posawesome.api import sales_orders

		currency = frappe.db.get_value("Company", self.company, "default_currency")
		with _FlagPatch("custom_allow_select_sales_order", 0):
			with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
				sales_orders.search_orders(self.company, currency, pos_profile=PROFILE)

	def test_search_orders_allowed_when_flag_on(self):
		from posawesome.posawesome.api import sales_orders

		currency = frappe.db.get_value("Company", self.company, "default_currency")
		with _FlagPatch("custom_allow_select_sales_order", 1):
			rows = sales_orders.search_orders(self.company, currency, pos_profile=PROFILE)
			self.assertIsInstance(rows, list)
