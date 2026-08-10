"""Integration test for the held-ticket tab-name label (`posa_rt_tab_name`).

`get_draft_invoices` must surface the cafetería "name on the cup" label on a
held (docstatus=0) invoice so the SPA can render it in the parked-orders list.
Bench-runnable (IntegrationTestCase); skips when the site lacks the Doco
profile or has not yet run the add_tab_name_field patch.
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

from posawesome.posawesome.api.invoice_processing import creation
from posawesome.posawesome.api import invoices

TEST_ITEM = "POSA-TEST-SVC"
PROFILE = "Doco Ventas"


def _ensure_test_item() -> str:
	"""Find-or-create the test service item and return its DOCNAME.

	Doco sites name Items by a series (IPN…), NOT by item_code — always
	resolve through the item_code FIELD.
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


class TestTabNameDraft(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("POS Profile", PROFILE):
			self.skipTest("no Doco Ventas profile")
		# The tab-name column only exists after add_tab_name_field runs; the
		# API guards the field read on has_column, so pre-migrate the row simply
		# would not carry it — skip rather than assert a false negative.
		if not frappe.db.has_column("Sales Invoice", "posa_rt_tab_name"):
			self.skipTest("add_tab_name_field patch not yet migrated")
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

	def test_get_draft_invoices_returns_tab_name(self):
		# update_invoice resolves posa_pos_opening_shift against a real POS
		# Opening Shift, and get_draft_invoices filters on it — reuse an open
		# shift for the profile rather than fabricating one. Skip if the site
		# has none (mirrors the sibling flows' "skip when fixtures absent").
		shift = frappe.db.get_value(
			"POS Opening Shift", {"pos_profile": PROFILE, "status": "Open"}, "name"
		)
		if not shift:
			self.skipTest("no open POS Opening Shift for the profile")
		tab_label = f"Mesa {int(time.time() * 1000) % 1000}"
		payload = {
			"doctype": "Sales Invoice",
			"pos_profile": PROFILE,
			"company": self.company,
			"customer": self.customer,
			"is_pos": 1,
			"posa_pos_opening_shift": shift,
			"posa_rt_tab_name": tab_label,
			"items": [
				{
					"item_code": self.item,
					"qty": 1,
					"rate": 10,
					"price_list_rate": 10,
				}
			],
		}
		created = creation.update_invoice(json.dumps(payload))
		name = created.get("name")
		self.assertTrue(name, "update_invoice must return the held draft name")
		self._created.append(("Sales Invoice", name))
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", name, "docstatus"), 0,
			"held ticket must stay a draft",
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", name, "posa_rt_tab_name"), tab_label,
			"tab name must persist on the draft",
		)

		rows = invoices.get_draft_invoices(shift, doctype="Sales Invoice")
		row = next((r for r in rows if r.get("name") == name), None)
		self.assertIsNotNone(row, "the held draft must appear in get_draft_invoices")
		self.assertIn(
			"posa_rt_tab_name", row,
			"get_draft_invoices must return the posa_rt_tab_name field",
		)
		self.assertEqual(row.get("posa_rt_tab_name"), tab_label)


if __name__ == "__main__":
	unittest.main()
