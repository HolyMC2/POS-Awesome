import json
import unittest
from unittest.mock import patch

# Bench-only integration test: needs a real frappe + site. Skip the module
# when discovered by the standalone stub-suite runner (python3 -m unittest
# discover), where frappe is not importable.
try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

# IntegrationTestCase, not the legacy frappe.tests.utils.FrappeTestCase: one
# legacy import flips frappe's runner into compat mode that preloads EVERY
# app doctype's test records upfront — the dependency walk then dies on link
# targets from apps that aren't installed (e.g. Payment Gateway from the
# `payments` app via erpnext's Payment Gateway Account).
from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.items import get_items


class TestNumericItemCodes(IntegrationTestCase):
    def setUp(self):
        items = [
            ("ALPHA-TEST", "Alpha"),
            ("BETA-TEST", "Beta"),
            ("002", "Gamma"),
        ]
        for code, name in items:
            if frappe.db.exists("Item", code):
                item = frappe.get_doc("Item", code)
                item.item_name = name
                item.is_sales_item = 1
                item.is_fixed_asset = 0
                item.save(ignore_permissions=True)
            else:
                frappe.get_doc(
                    {
                        "doctype": "Item",
                        "item_code": code,
                        "item_name": name,
                        "stock_uom": "Nos",
                        "is_stock_item": 0,
                        "item_group": "All Item Groups",
                        "is_sales_item": 1,
                        "is_fixed_asset": 0,
                    }
                ).insert(ignore_permissions=True, ignore_mandatory=True)

    def test_numeric_code_appears_without_search(self):
        # Regression: numeric item codes used to be filtered out of the
        # non-search listing. Walk the keyset pages until 002 shows up —
        # the catalog also contains erpnext _Test fixture items, so no
        # assumption about which page it lands on.
        pos_profile = json.dumps({"name": "TestProfile"})
        codes = []
        with patch("posawesome.posawesome.api.items.get_items_details", return_value=[]):
            start_after = None
            for _page in range(50):
                page = get_items(pos_profile, limit=100, start_after=start_after)
                if not page:
                    break
                codes.extend(i["item_code"] for i in page)
                if "002" in codes:
                    break
                start_after = page[-1]["item_name"]
        self.assertIn("002", codes)

    def test_item_search_with_whitespace(self):
        # Create an item with a barcode
        item_code = "TEST-ITEM-123"
        barcode = "123456789"

        if not frappe.db.exists("Item", item_code):
            frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": item_code,
                    "item_name": "Test Item Whitespace",
                    "stock_uom": "Nos",
                    "item_group": "All Item Groups",
                    "is_sales_item": 1,
                    "barcodes": [{"barcode": barcode}],
                }
            ).insert(ignore_permissions=True)

        pos_profile = json.dumps({"name": "TestProfile"})

        # Search with leading/trailing whitespace
        items = get_items(pos_profile, search_value=f"  {barcode}  ")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["item_code"], item_code)
