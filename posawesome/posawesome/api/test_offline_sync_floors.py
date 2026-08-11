"""Offline catalog pull for POS Floor.

Mirrors the coverage the shipped offline-sync resources carry — delta by
watermark, schema-version gate, deactivation surfacing as a delete, and the
horizontal-IDOR guard — but as a bench IntegrationTestCase rather than the
stub harness the older modules use: the stub tests skip under `bench
run-tests` entirely, and these endpoints only mean anything against real
POS Floor rows.
"""

from __future__ import annotations

import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.offline_sync import common, floors as sync_floors
from posawesome.posawesome.api.test_restaurant_support import RestaurantTestCase


class TestOfflineSyncFloors(RestaurantTestCase):
    def tearDown(self):
        frappe.set_user("Administrator")
        super().tearDown()

    def test_schema_version_matches_the_shared_constant(self):
        self.assertEqual(
            sync_floors.SYNC_SCHEMA_VERSION, common.SYNC_SCHEMA_VERSION,
            "the response carries common's value while this module gates on its own — "
            "a split pair pins every client in permanent full resync",
        )

    def test_stale_schema_version_demands_a_full_resync(self):
        response = sync_floors.sync_floors(
            pos_profile=self.profile, schema_version="1970-01-01"
        )

        self.assertTrue(response["full_resync_required"])
        self.assertEqual(response["changes"], [])

    def test_full_pull_returns_the_registers_floors(self):
        response = sync_floors.sync_floors(pos_profile=self.profile)

        keys = {row["key"] for row in response["changes"]}
        self.assertIn(f"pos_floor::{self.floor}", keys)
        self.assertEqual(response["schema_version"], common.SYNC_SCHEMA_VERSION)
        self.assertTrue(response["next_watermark"])

    def test_the_payload_carries_the_explicit_field_list(self):
        response = sync_floors.sync_floors(pos_profile=self.profile)

        row = next(r for r in response["changes"] if r["key"] == f"pos_floor::{self.floor}")
        self.assertEqual(set(row["data"]), set(sync_floors.FLOOR_FIELDS))

    def test_a_watermark_returns_only_what_moved_since(self):
        first = sync_floors.sync_floors(pos_profile=self.profile)
        watermark = first["next_watermark"]
        moved = self.make_floor("Terraza", sequence=3)

        response = sync_floors.sync_floors(pos_profile=self.profile, watermark=watermark)

        keys = {row["key"] for row in response["changes"]}
        self.assertIn(f"pos_floor::{moved}", keys)

    def test_a_deactivated_floor_arrives_as_a_delete(self):
        frappe.db.set_value("POS Floor", self.floor, "is_active", 0)

        response = sync_floors.sync_floors(pos_profile=self.profile)

        self.assertIn(f"pos_floor::{self.floor}", {row["key"] for row in response["deleted"]})
        self.assertNotIn(f"pos_floor::{self.floor}", {row["key"] for row in response["changes"]})

    def test_a_company_wide_floor_reaches_every_register(self):
        shared = self.make_floor("Compartido", pos_profile=None)

        response = sync_floors.sync_floors(pos_profile=self.profile)

        self.assertIn(
            f"pos_floor::{shared}", {row["key"] for row in response["changes"]},
            "a blank pos_profile is company-wide — an SQL IN would drop it as NULL",
        )

    def test_another_registers_floor_is_not_pulled(self):
        other_profile = frappe.db.get_value(
            "POS Profile", {"name": ["!=", self.profile], "company": self.company}, "name"
        )
        if not other_profile:
            self.skipTest("only one POS Profile on this company")
        foreign = self.make_floor("Ajeno", pos_profile=other_profile)

        response = sync_floors.sync_floors(pos_profile=self.profile)

        self.assertNotIn(f"pos_floor::{foreign}", {row["key"] for row in response["changes"]})

    def test_limit_paginates_and_reports_has_more(self):
        for index in range(3):
            self.make_floor(f"Extra{index}", sequence=10 + index)

        response = sync_floors.sync_floors(pos_profile=self.profile, limit=1)

        self.assertEqual(len(response["changes"]) + len(response["deleted"]), 1)
        self.assertTrue(response["has_more"])

    # -- scope: the horizontal-IDOR guard ----------------------------------

    def test_a_guest_cannot_pull_the_catalog(self):
        frappe.set_user("Guest")

        with self.assertRaises(frappe.PermissionError):
            sync_floors.sync_floors(pos_profile=self.profile)

    def test_a_cashier_cannot_name_another_stores_profile(self):
        rows = frappe.db.sql(
            "SELECT parent, user FROM `tabPOS Profile User` WHERE parent = %s", (self.profile,),
            as_dict=True,
        )
        cashier = next((row["user"] for row in rows if row["user"] != "Administrator"), None)
        if not cashier:
            self.skipTest("no non-admin user assigned to the profile")
        foreign_profile = frappe.db.get_value(
            "POS Profile", {"name": ["!=", self.profile]}, "name"
        )
        if not foreign_profile:
            self.skipTest("only one POS Profile on this site")
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
            sync_floors.sync_floors(pos_profile=foreign_profile)


if __name__ == "__main__":
    unittest.main()
