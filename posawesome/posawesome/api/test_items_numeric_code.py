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


# Dedicated group so the tests hold on any site, including mirrors whose
# catalogs hold thousands of real items (paging blind through those made
# the old assertions data-dependent and flaky).
TEST_GROUP = "POSA Numeric Code Tests"
# Long enough that a real catalog barcode collision is implausible.
TEST_BARCODE = "4200696942013377"


class TestNumericItemCodes(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("Item Group", TEST_GROUP):
            frappe.get_doc(
                {
                    "doctype": "Item Group",
                    "item_group_name": TEST_GROUP,
                    "parent_item_group": "All Item Groups",
                    "is_group": 0,
                }
            ).insert(ignore_permissions=True)

        items = [
            ("ALPHA-TEST", "Alpha"),
            ("BETA-TEST", "Beta"),
            ("002", "Gamma"),
        ]
        expected = {code for code, _ in items} | {"TEST-ITEM-123"}
        # Sites that name Items by naming series (item_naming_by=Naming
        # Series) ignore the supplied item_code on insert — earlier runs
        # left series-named orphans in the group; prune them.
        for stray in frappe.get_all(
            "Item", filters={"item_group": TEST_GROUP, "name": ["not in", list(expected)]}
        ):
            frappe.delete_doc("Item", stray.name, force=True, ignore_permissions=True)

        for code, name in items:
            if frappe.db.exists("Item", code):
                item = frappe.get_doc("Item", code)
                item.item_name = name
                item.item_group = TEST_GROUP
                item.is_sales_item = 1
                item.is_fixed_asset = 0
                item.disabled = 0
                item.save(ignore_permissions=True)
            else:
                doc = frappe.get_doc(
                    {
                        "doctype": "Item",
                        "item_code": code,
                        "item_name": name,
                        "stock_uom": "Nos",
                        "is_stock_item": 0,
                        "item_group": TEST_GROUP,
                        "is_sales_item": 1,
                        "is_fixed_asset": 0,
                    }
                ).insert(ignore_permissions=True, ignore_mandatory=True)
                if doc.name != code:
                    # Series naming overrode the code — force it back; the
                    # numeric-code regression needs the literal code "002".
                    frappe.rename_doc("Item", doc.name, code, force=True)

    def test_numeric_code_appears_without_search(self):
        # Regression: numeric item codes used to be filtered out of the
        # non-search listing. Scope the listing to the dedicated test group
        # so the assertion is independent of whatever else the site's
        # catalog holds.
        pos_profile = json.dumps({"name": "TestProfile"})
        with patch("posawesome.posawesome.api.items.get_items_details", return_value=[]):
            page = get_items(pos_profile, item_group=TEST_GROUP, limit=100)
        codes = [i["item_code"] for i in page]
        self.assertIn("002", codes)

    def test_item_search_with_whitespace(self):
        # An item whose barcode is unique to this test; ensure the barcode
        # row exists even when the item survives from an earlier run.
        item_code = "TEST-ITEM-123"

        if not frappe.db.exists("Item", item_code):
            doc = frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": item_code,
                    "item_name": "Test Item Whitespace",
                    "stock_uom": "Nos",
                    "item_group": TEST_GROUP,
                    "is_sales_item": 1,
                    "barcodes": [{"barcode": TEST_BARCODE}],
                }
            ).insert(ignore_permissions=True)
            if doc.name != item_code:
                frappe.rename_doc("Item", doc.name, item_code, force=True)
        elif not frappe.db.exists("Item Barcode", {"parent": item_code, "barcode": TEST_BARCODE}):
            item = frappe.get_doc("Item", item_code)
            item.append("barcodes", {"barcode": TEST_BARCODE})
            item.save(ignore_permissions=True)

        pos_profile = json.dumps({"name": "TestProfile"})

        # Search with leading/trailing whitespace
        items = get_items(pos_profile, search_value=f"  {TEST_BARCODE}  ")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["item_code"], item_code)
