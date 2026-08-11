"""Offline catalog pull for POS Table.

Same coverage as the floors resource, plus the one thing specific to tables:
they are scoped THROUGH the floors the register can see, so a table on
another register's floor must never reach this tablet's cache.
"""

from __future__ import annotations

import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.offline_sync import common, tables as sync_tables
from posawesome.posawesome.api.test_restaurant_support import RestaurantTestCase


class TestOfflineSyncTables(RestaurantTestCase):
    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def test_schema_version_matches_the_shared_constant(self):
        self.assertEqual(sync_tables.SYNC_SCHEMA_VERSION, common.SYNC_SCHEMA_VERSION)

    def test_stale_schema_version_demands_a_full_resync(self):
        response = sync_tables.sync_tables(pos_profile=self.profile, schema_version="1970-01-01")

        self.assertTrue(response["full_resync_required"])

    def test_full_pull_returns_the_registers_tables(self):
        response = sync_tables.sync_tables(pos_profile=self.profile)

        keys = {row["key"] for row in response["changes"]}
        self.assertIn(f"pos_table::{self.table_a}", keys)
        self.assertIn(f"pos_table::{self.table_b}", keys)

    def test_the_payload_carries_the_explicit_field_list(self):
        response = sync_tables.sync_tables(pos_profile=self.profile)

        row = next(r for r in response["changes"] if r["key"] == f"pos_table::{self.table_a}")
        self.assertEqual(set(row["data"]), set(sync_tables.TABLE_FIELDS))

    def test_the_occupied_hint_rides_along(self):
        self.make_order(table=self.table_a, lines=[self.line()])
        from posawesome.posawesome.api.restaurant._tickets import reconcile_table_occupancy

        reconcile_table_occupancy(self.table_a)

        response = sync_tables.sync_tables(pos_profile=self.profile)

        row = next(r for r in response["changes"] if r["key"] == f"pos_table::{self.table_a}")
        self.assertEqual(
            row["data"]["occupied"], 1,
            "the cached board survives the trip offline; the count is still the truth online",
        )

    def test_a_watermark_returns_only_what_moved_since(self):
        watermark = sync_tables.sync_tables(pos_profile=self.profile)["next_watermark"]
        moved = self.make_table(self.floor, "A3")

        response = sync_tables.sync_tables(pos_profile=self.profile, watermark=watermark)

        self.assertIn(f"pos_table::{moved}", {row["key"] for row in response["changes"]})

    def test_a_deactivated_table_arrives_as_a_delete(self):
        frappe.db.set_value("POS Table", self.table_b, "is_active", 0)

        response = sync_tables.sync_tables(pos_profile=self.profile)

        self.assertIn(f"pos_table::{self.table_b}", {row["key"] for row in response["deleted"]})
        self.assertNotIn(f"pos_table::{self.table_b}", {row["key"] for row in response["changes"]})

    def test_tables_on_another_registers_floor_are_not_pulled(self):
        other_profile = frappe.db.get_value(
            "POS Profile", {"name": ["!=", self.profile], "company": self.company}, "name"
        )
        if not other_profile:
            self.skipTest("only one POS Profile on this company")
        foreign_floor = self.make_floor("Ajeno", pos_profile=other_profile)
        foreign_table = self.make_table(foreign_floor, "X1")

        response = sync_tables.sync_tables(pos_profile=self.profile)

        self.assertNotIn(f"pos_table::{foreign_table}", {row["key"] for row in response["changes"]})

    def test_a_register_with_no_floors_pulls_nothing(self):
        frappe.db.set_value("POS Floor", self.floor, "is_active", 0)

        response = sync_tables.sync_tables(pos_profile=self.profile)

        self.assertEqual(response["changes"], [])
        self.assertEqual(response["deleted"], [])

    def test_limit_paginates_and_reports_has_more(self):
        response = sync_tables.sync_tables(pos_profile=self.profile, limit=1)

        self.assertEqual(len(response["changes"]) + len(response["deleted"]), 1)
        self.assertTrue(response["has_more"])

    # -- scope -------------------------------------------------------------

    def test_a_guest_cannot_pull_the_catalog(self):
        frappe.set_user("Guest")

        with self.assertRaises(frappe.PermissionError):
            sync_tables.sync_tables(pos_profile=self.profile)

    def test_a_cashier_cannot_name_another_stores_profile(self):
        rows = frappe.db.sql(
            "SELECT user FROM `tabPOS Profile User` WHERE parent = %s", (self.profile,), as_dict=True
        )
        cashier = next((row["user"] for row in rows if row["user"] != "Administrator"), None)
        foreign_profile = frappe.db.get_value("POS Profile", {"name": ["!=", self.profile]}, "name")
        if not cashier or not foreign_profile:
            self.skipTest("site lacks a scoped-out cashier / second profile pair")
        assigned = {
            row["parent"]
            for row in frappe.db.sql(
                "SELECT parent FROM `tabPOS Profile User` WHERE user = %s", (cashier,), as_dict=True
            )
        }
        if foreign_profile in assigned or "System Manager" in frappe.get_roles(cashier):
            self.skipTest("the available cashier is not scoped out of the foreign profile")

        frappe.set_user(cashier)

        with self.assertRaises(frappe.PermissionError):
            sync_tables.sync_tables(pos_profile=foreign_profile)


if __name__ == "__main__":
    unittest.main()
