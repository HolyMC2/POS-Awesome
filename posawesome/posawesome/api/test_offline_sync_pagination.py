"""Standalone regression for the production paginated handlers; no bench needed."""
import datetime
import importlib.util
import json
import pathlib
import runpy
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).parent


def load(name):
    path = ROOT / "offline_sync" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"pagination_test_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestLosslessPagination(unittest.TestCase):
    def setUp(self):
        harness = runpy.run_path(str(ROOT / "test_offline_sync_items.py"))
        harness["_install_stubs"]()
        self.frappe = sys.modules["frappe"]
        self.now = datetime.datetime(2026, 9, 6, 12)
        utils = types.ModuleType("frappe.utils")
        utils.get_datetime = lambda value: value if isinstance(value, datetime.datetime) else datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        utils.now_datetime = lambda: self.now
        utils.add_to_date = lambda value, seconds=0: value + datetime.timedelta(seconds=seconds)
        sys.modules["frappe.utils"] = utils
        self.frappe.db = types.SimpleNamespace(get_value=lambda *args: 0)
        self.data = {"Item": [], "Item Price": [], "Bin": [], "Customer": []}
        self.frappe.get_all = self.get_all
        self.profile = {"name": "POS-TEST", "modified": "2026-09-01 00:00:00", "warehouse": "WH", "selling_price_list": "Retail"}
        search = types.ModuleType("posawesome.posawesome.api.item_processing.search")
        search._build_search_plan = lambda *args: types.SimpleNamespace(filters={"item_code": ["!=", "PROPINA"]})
        search._run_item_query = lambda profile, price, customer, plan: [
            row for row in self.data["Item"] if row["name"] in plan.filters["name"][1]
            and row["item_code"] != plan.filters["item_code"][1] and not row.get("disabled")
        ]
        sys.modules[search.__name__] = search
        customers = types.ModuleType("posawesome.posawesome.api.customers")
        customers.get_customer_groups = lambda profile: []
        customers.get_customer_names = lambda *args, **kwargs: []
        sys.modules[customers.__name__] = customers
        stock = types.ModuleType("posawesome.posawesome.api.item_processing.stock")
        stock.get_bulk_stock_availability = lambda rows: {(row["item_code"], row["warehouse"], ""): 7 for row in rows}
        sys.modules[stock.__name__] = stock
        self.modules = {name: load(name) for name in ("items", "customers", "stock")}
        for module in self.modules.values():
            module._resolve_profile = lambda value: dict(self.profile)

    def get_all(self, doctype, filters=None, fields=None, group_by=None, order_by=None, limit_page_length=0, **kwargs):
        rows = list(self.data.get(doctype, []))
        if isinstance(filters, dict):
            filters = [[key, *value] if isinstance(value, list) else [key, "=", value] for key, value in filters.items()]
        for field, op, value in filters or []:
            def matches(row):
                current = row.get(field)
                if field == "modified":
                    current = datetime.datetime.fromisoformat(str(current))
                    value_dt = datetime.datetime.fromisoformat(str(value))
                    return current > value_dt if op == ">" else current <= value_dt
                if op == "in": return current in value
                if op == ">": return current.casefold() > value.casefold()
                return current == value
            rows = [row for row in rows if matches(row)]
        if group_by:
            rows = list({row[group_by]: row for row in rows}.values())
        if order_by:
            rows.sort(key=lambda row: str(row[order_by.split()[0]]).casefold())
        return rows[:limit_page_length] if limit_page_length else rows

    def item(self, index, hour=10):
        return {"name": f"ITEM-{index:04}", "item_code": f"ITEM-{index:04}", "modified": f"2026-09-06 {hour:02}:00:00", "disabled": 0}

    def pull(self, resource, watermark=None, after_first=None):
        method = getattr(self.modules[resource], f"sync_{resource}")
        changes, deleted, cursor = [], [], None
        pages = 0
        while True:
            response = method(pos_profile="POS-TEST", watermark=watermark, paginated=1, page_cursor=cursor, limit=200)
            pages += 1
            changes.extend(response["changes"])
            deleted.extend(response["deleted"])
            if pages == 1 and after_first:
                after_first()
            if not response["has_more"]:
                return changes, deleted, response["next_watermark"], pages
            self.assertEqual(response["next_watermark"], watermark)
            self.assertTrue(response["next_cursor"])
            cursor = response["next_cursor"]
            self.assertLess(pages, 10)

    def test_items_over_200_equal_and_out_of_order_timestamps(self):
        self.data["Item"] = [self.item(i, 11 if i < 200 else 9) for i in range(405)]
        changes, _, watermark, pages = self.pull("items", "2026-09-06 08:00:00")
        self.assertEqual(len(changes), 405)
        self.assertEqual(len({row["key"] for row in changes}), 405)
        self.assertEqual(pages, 3)
        self.assertEqual(watermark, "2026-09-06 12:00:00")

    def test_price_only_and_stock_only_edits_are_not_truncated(self):
        self.data["Item"] = [self.item(i, 7) for i in range(405)]
        self.data["Item Price"] = [{**row, "price_list": "Retail", "modified": "2026-09-06 10:00:00"} for row in self.data["Item"][:205]]
        self.data["Bin"] = [{**row, "warehouse": "WH", "modified": "2026-09-06 10:00:00"} for row in self.data["Item"][200:]]
        changes, _, _, _ = self.pull("items", "2026-09-06 08:00:00")
        self.assertEqual(len(changes), 405)

    def test_union_uses_database_collation_instead_of_python_code_order(self):
        self.data["Item"] = [
            {**self.item(i), "item_code": f"{'a' if i < 201 else 'B'}-{i:04}"}
            for i in range(405)
        ]
        changes, _, _, pages = self.pull("items")
        self.assertEqual(len(changes), 405)
        self.assertEqual(len({row["key"] for row in changes}), 405)
        self.assertEqual(pages, 3)

    def test_page_boundary_preserves_tip_exclusion_and_uses_actual_item_names(self):
        self.data["Item"] = [self.item(1), {**self.item(2), "item_code": "PROPINA"}]
        changes, deleted, _, _ = self.pull("items")
        self.assertEqual([row["key"] for row in changes], ["item::ITEM-0001"])
        self.assertEqual(deleted, [{"key": "item::PROPINA"}])

    def test_edit_behind_cursor_during_scan_is_replayed_next_window(self):
        self.data["Item"] = [self.item(i) for i in range(405)]
        def edit():
            self.data["Item"][0]["modified"] = "2026-09-06 12:00:01"
            self.now += datetime.timedelta(seconds=2)
        _, _, watermark, _ = self.pull("items", "2026-09-06 08:00:00", edit)
        changes, _, _, _ = self.pull("items", watermark)
        self.assertEqual([row["key"] for row in changes], ["item::ITEM-0000"])

    def test_customers_include_disabled_tombstones_on_later_pages(self):
        self.data["Customer"] = [{"name": f"C-{i:04}", "modified": "2026-09-06 10:00:00", "disabled": int(i == 404)} for i in range(405)]
        changes, deleted, _, pages = self.pull("customers")
        self.assertEqual(len(changes), 404)
        self.assertEqual(deleted, [{"key": "customer::C-0404"}])
        self.assertEqual(pages, 3)

    def test_stock_groups_duplicate_bins_before_pagination(self):
        self.data["Bin"] = [{**self.item(i), "warehouse": "WH"} for i in range(405) for _ in range(2)]
        changes, _, _, pages = self.pull("stock")
        self.assertEqual(len(changes), 405)
        self.assertEqual(pages, 3)

    def test_cursor_cannot_change_profile_or_watermark_mid_scan(self):
        self.data["Item"] = [self.item(i) for i in range(405)]
        cursor = self.modules["items"].sync_items(pos_profile="POS-TEST", paginated=1)["next_cursor"]
        self.profile["modified"] = "2026-09-02 00:00:00"
        with self.assertRaisesRegex(Exception, "Invalid offline sync page cursor"):
            self.modules["items"].sync_items(pos_profile="POS-TEST", paginated=1, page_cursor=cursor)


if __name__ == "__main__":
    unittest.main()
