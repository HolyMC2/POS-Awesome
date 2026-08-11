"""Kitchen ticket projection: the diff, the snapshot, and station routing.

The whole point of the design is that firing prints CHANGES, not the ticket:
a second fire after adding one dish prints one dish, a qty cut prints a
cancellation, and a line deleted after firing prints a cancellation too. That
only works if `last_fired` round-trips exactly, so the snapshot is asserted
as hard as the projection.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.restaurant import kot, orders
from posawesome.posawesome.api.test_restaurant_support import (
    RestaurantTestCase,
    ensure_item,
    ensure_item_group,
    uid,
)


def _all_lines(projection_key):
    return [line for station in projection_key for line in station["lines"]]


class TestFireDiff(RestaurantTestCase):
    def _order_with(self, *lines):
        order = self.make_order(table=self.table_a, lines=list(lines))
        return order

    def test_first_fire_sends_every_line(self):
        line = self.line(qty=2, rate=10)
        order = self._order_with(line, self.line(qty=1, rate=20))

        result = kot.fire_course(order)

        fired = _all_lines(result["stations"])
        self.assertEqual(len(fired), 2)
        self.assertEqual({entry["kind"] for entry in fired}, {"new"})
        self.assertEqual(next(e for e in fired if e["line_uid"] == line["line_uid"])["qty"], 2)
        self.assertEqual(result["cancellations"], [])

    def test_first_fire_marks_lines_fired(self):
        order = self._order_with(self.line())
        kot.fire_course(order)

        rows = frappe.get_all(
            "POS Table Order Item", filters={"parent": order}, fields=["fired", "fired_at"]
        )
        self.assertTrue(all(row["fired"] for row in rows))
        self.assertTrue(all(row["fired_at"] for row in rows))

    def test_second_fire_sends_only_what_changed(self):
        line = self.line(qty=1, rate=10)
        order = self._order_with(line)
        kot.fire_course(order)
        added = self.line(qty=3, rate=15)
        orders.update_table_order(order, client_request_id=uid("tbl-req"), lines=[added])

        result = kot.fire_course(order)

        fired = _all_lines(result["stations"])
        self.assertEqual(len(fired), 1, "an unchanged line must not print twice")
        self.assertEqual(fired[0]["line_uid"], added["line_uid"])
        self.assertEqual(fired[0]["kind"], "new")

    def test_a_qty_increase_prints_only_the_delta(self):
        line = self.line(qty=2, rate=10)
        order = self._order_with(line)
        kot.fire_course(order)
        orders.update_table_order(
            order, client_request_id=uid("tbl-req"), lines=[dict(line, qty=5)]
        )

        result = kot.fire_course(order)

        fired = _all_lines(result["stations"])
        self.assertEqual(len(fired), 1)
        self.assertEqual(fired[0]["qty"], 3, "the kitchen already cooked the first two")
        self.assertEqual(fired[0]["kind"], "increase")

    def test_a_qty_cut_prints_a_cancellation(self):
        line = self.line(qty=5, rate=10)
        order = self._order_with(line)
        kot.fire_course(order)
        orders.update_table_order(
            order, client_request_id=uid("tbl-req"), lines=[dict(line, qty=2)]
        )

        result = kot.fire_course(order)

        self.assertEqual(_all_lines(result["stations"]), [])
        cancelled = _all_lines(result["cancellations"])
        self.assertEqual(len(cancelled), 1)
        self.assertEqual(cancelled[0]["qty"], 3)
        self.assertEqual(cancelled[0]["kind"], "reduce")

    def test_a_line_removed_after_firing_prints_a_cancellation(self):
        line = self.line(qty=1, rate=10)
        order = self._order_with(line)
        kot.fire_course(order)
        # A fired line cannot leave through the API, so this is the manager
        # override path — the projection must still tell the kitchen.
        doc = frappe.get_doc("POS Table Order", order)
        doc.set("items", [])
        doc.save(ignore_permissions=True)

        result = kot.fire_course(order)

        cancelled = _all_lines(result["cancellations"])
        self.assertEqual(len(cancelled), 1)
        self.assertEqual(cancelled[0]["line_uid"], line["line_uid"])
        self.assertEqual(cancelled[0]["kind"], "cancel")

    def test_nothing_changed_means_nothing_prints(self):
        order = self._order_with(self.line())
        kot.fire_course(order)

        result = kot.fire_course(order)

        self.assertEqual(_all_lines(result["stations"]), [])
        self.assertEqual(_all_lines(result["cancellations"]), [])

    def test_a_replayed_fire_prints_nothing_and_says_so(self):
        request_id = uid("tbl-req")
        order = self._order_with(self.line())
        kot.fire_course(order, client_request_id=request_id)

        replay = kot.fire_course(order, client_request_id=request_id)

        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["stations"], [])

    def test_firing_a_settled_order_throws(self):
        order = self._order_with(self.line())
        frappe.db.set_value("POS Table Order", order, "status", "Settled")

        with self.assertRaises(frappe.ValidationError):
            kot.fire_course(order)

    def test_fire_echoes_the_source_device(self):
        order = self._order_with(self.line())

        with mock.patch(
            "posawesome.posawesome.api.restaurant._tickets._publish_floor_update"
        ) as published:
            kot.fire_course(order, source_device="tablet-7")

        published.assert_called()
        self.assertEqual(published.call_args.kwargs.get("source_device"), "tablet-7")

    def test_preview_shows_the_diff_without_firing(self):
        order = self._order_with(self.line(qty=1, rate=10))

        preview = kot.get_fire_preview(order)

        self.assertEqual(len(_all_lines(preview["stations"])), 1)
        self.assertFalse(
            frappe.db.get_value("POS Table Order", order, "last_fired"),
            "a preview must not move the snapshot",
        )


class TestFiredSnapshot(RestaurantTestCase):
    def test_snapshot_round_trips_qty_and_identity(self):
        line = self.line(qty=3, rate=10, notes="sin cebolla")
        order = self.make_order(table=self.table_a, lines=[line])

        kot.fire_course(order)

        snapshot = json.loads(frappe.db.get_value("POS Table Order", order, "last_fired"))
        entry = snapshot[line["line_uid"]]
        self.assertEqual(entry["qty"], 3)
        self.assertEqual(entry["item_code"], self.item)
        self.assertEqual(entry["notes"], "sin cebolla")
        self.assertEqual(entry["course_idx"], 1)

    def test_a_removed_line_leaves_the_snapshot(self):
        line = self.line(qty=1, rate=10)
        order = self.make_order(table=self.table_a, lines=[line])
        kot.fire_course(order)
        doc = frappe.get_doc("POS Table Order", order)
        doc.set("items", [])
        doc.save(ignore_permissions=True)

        kot.fire_course(order)

        snapshot = json.loads(frappe.db.get_value("POS Table Order", order, "last_fired"))
        self.assertNotIn(line["line_uid"], snapshot, "or its cancellation would reprint forever")

    def test_a_snapshot_of_the_wrong_shape_reprints_rather_than_wedging(self):
        """MariaDB's JSON CHECK constraint makes a NON-json snapshot
        impossible, but a valid JSON array is still not the map we expect.
        Refusing to fire would strand the kitchen; reprinting is recoverable.
        """
        order = self.make_order(table=self.table_a, lines=[self.line(qty=1, rate=10)])
        frappe.db.set_value("POS Table Order", order, "last_fired", "[]")

        result = kot.fire_course(order)

        self.assertEqual(len(_all_lines(result["stations"])), 1)


class TestCoursing(RestaurantTestCase):
    def test_firing_one_course_leaves_the_others_alone(self):
        starter = self.line(qty=1, rate=10, course_idx=1)
        main = self.line(qty=1, rate=40, course_idx=2)
        order = self.make_order(table=self.table_a, lines=[starter, main])

        result = kot.fire_course(order, course_idx=1)

        fired = _all_lines(result["stations"])
        self.assertEqual([entry["line_uid"] for entry in fired], [starter["line_uid"]])
        snapshot = json.loads(frappe.db.get_value("POS Table Order", order, "last_fired"))
        self.assertIn(starter["line_uid"], snapshot)
        self.assertNotIn(main["line_uid"], snapshot, "course 2 has not been sent")

    def test_firing_course_two_does_not_unfire_course_one(self):
        starter = self.line(qty=1, rate=10, course_idx=1)
        main = self.line(qty=1, rate=40, course_idx=2)
        order = self.make_order(table=self.table_a, lines=[starter, main])
        kot.fire_course(order, course_idx=1)

        result = kot.fire_course(order, course_idx=2)

        self.assertEqual(
            [entry["line_uid"] for entry in _all_lines(result["stations"])], [main["line_uid"]]
        )
        snapshot = json.loads(frappe.db.get_value("POS Table Order", order, "last_fired"))
        self.assertEqual(set(snapshot), {starter["line_uid"], main["line_uid"]})


class TestStationRouting(RestaurantTestCase):
    def setUp(self):
        super().setUp()
        self.kitchen_group = ensure_item_group("POSA Test Cocina")
        self.bar_group = ensure_item_group("POSA Test Barra")
        self.food = ensure_item("POSA-TEST-RT-TACO", self.kitchen_group)
        self.drink = ensure_item("POSA-TEST-RT-AGUA", self.bar_group)

    def _station(self, name, groups, printer=None, pos_profile=None):
        doc = frappe.get_doc(
            {
                "doctype": "POS Kitchen Station",
                "station_uid": uid("stn"),
                "station_name": f"{name}-{uid('n')[-6:]}",
                "company": self.company,
                "pos_profile": pos_profile,
                "printer": printer,
                "is_active": 1,
                "item_groups": [{"item_group": group} for group in groups],
            }
        ).insert(ignore_permissions=True)
        return self.track("POS Kitchen Station", doc.name)

    def test_lines_route_to_the_station_owning_their_item_group(self):
        self._station("Cocina", [self.kitchen_group], printer="KITCHEN-01")
        self._station("Barra", [self.bar_group], printer="BAR-01")
        order = self.make_order(
            table=self.table_a,
            lines=[self.line(item=self.food), self.line(item=self.drink)],
        )

        result = kot.fire_course(order)

        by_printer = {station["printer"]: station for station in result["stations"]}
        self.assertEqual(set(by_printer), {"KITCHEN-01", "BAR-01"})
        self.assertEqual(by_printer["KITCHEN-01"]["lines"][0]["item_code"], self.food)
        self.assertEqual(by_printer["BAR-01"]["lines"][0]["item_code"], self.drink)

    def test_an_unrouted_item_group_falls_back_to_general(self):
        self._station("Cocina", [self.kitchen_group], printer="KITCHEN-01")
        order = self.make_order(table=self.table_a, lines=[self.line(item=self.drink)])

        result = kot.fire_course(order)

        self.assertEqual([s["station"] for s in result["stations"]], [kot.GENERAL_STATION])
        self.assertIsNone(result["stations"][0]["printer"])

    def test_a_profile_bound_station_overrides_the_company_wide_one(self):
        self._station("Cocina General", [self.kitchen_group], printer="SHARED")
        self._station(
            "Cocina Registro", [self.kitchen_group], printer="MINE", pos_profile=self.profile
        )
        order = self.make_order(table=self.table_a, lines=[self.line(item=self.food)])

        result = kot.fire_course(order)

        self.assertEqual([s["printer"] for s in result["stations"]], ["MINE"])

    def test_an_inactive_station_stops_routing(self):
        station = self._station("Cocina", [self.kitchen_group], printer="KITCHEN-01")
        frappe.db.set_value("POS Kitchen Station", station, "is_active", 0)
        order = self.make_order(table=self.table_a, lines=[self.line(item=self.food)])

        result = kot.fire_course(order)

        self.assertEqual([s["station"] for s in result["stations"]], [kot.GENERAL_STATION])

    def test_a_station_rejects_the_same_item_group_twice(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Kitchen Station",
                    "station_uid": uid("stn"),
                    "station_name": f"Dup-{uid('n')[-6:]}",
                    "company": self.company,
                    "item_groups": [
                        {"item_group": self.kitchen_group},
                        {"item_group": self.kitchen_group},
                    ],
                }
            ).insert(ignore_permissions=True)


if __name__ == "__main__":
    unittest.main()
