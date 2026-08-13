"""Floor snapshot, layout persistence, occupancy reconcile, delete guards.

The snapshot is the floor screen's hot path, so its correctness is about the
aggregates as much as the rows: `unsent_count` is what the tile badge shows
and `total` is what the waiter reads before settling.

`save_floor_layout` honours the client's `modified` token. The invoice path
deliberately strips `modified`; the floor path must NOT, or the second
concurrent manager silently wipes the first's additions (spec §6.3).
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.restaurant import floors, orders
from posawesome.posawesome.api.restaurant._tickets import (
    _publish_floor_update,
    floor_board_rows,
    open_order_count,
    reconcile_table_occupancy,
)
from posawesome.posawesome.api.test_restaurant_support import RestaurantTestCase, uid


class TestFloorSnapshot(RestaurantTestCase):
    def test_snapshot_returns_floors_tables_and_open_orders(self):
        self.make_order(table=self.table_a, lines=[self.line(qty=2, rate=50)])

        snapshot = floors.get_floor_snapshot(self.profile, self.company)

        self.assertIn(self.floor, {row["name"] for row in snapshot["floors"]})
        self.assertLessEqual(
            {self.table_a, self.table_b}, {row["name"] for row in snapshot["tables"]}
        )
        self.assertTrue(snapshot["server_time"])

    def test_snapshot_aggregates_lines_in_one_pass(self):
        order = self.make_order(
            table=self.table_a,
            lines=[self.line(qty=2, rate=50), self.line(qty=1, rate=30)],
        )
        row = next(r for r in floors.get_floor_snapshot(self.profile, self.company)["orders"] if r["name"] == order)

        self.assertEqual(row["items_count"], 2)
        self.assertEqual(row["unsent_count"], 2, "nothing fired yet — both lines are unsent")
        self.assertEqual(row["total"], 130)

    def test_unsent_count_drops_as_lines_are_fired(self):
        line = self.line(qty=1, rate=10)
        order = self.make_order(table=self.table_a, lines=[line, self.line(qty=1, rate=20)])
        frappe.db.set_value(
            "POS Table Order Item",
            frappe.db.get_value("POS Table Order Item", {"line_uid": line["line_uid"]}, "name"),
            "fired",
            1,
        )

        row = next(r for r in floors.get_floor_snapshot(self.profile, self.company)["orders"] if r["name"] == order)

        self.assertEqual(row["items_count"], 2)
        self.assertEqual(row["unsent_count"], 1)

    def test_an_empty_order_has_nothing_unsent(self):
        """A table nobody has ordered from owes the kitchen nothing.

        The LEFT JOIN hands an order with no lines one all-NULL row, and
        `IFNULL(i.fired, 0) = 0` is true of it — so every freshly opened table
        reported one unsent line and wore a red "1" on the plan and on Send.
        """
        order = self.make_order(table=self.table_a, lines=[])

        row = next(r for r in floors.get_floor_snapshot(self.profile, self.company)["orders"] if r["name"] == order)

        self.assertEqual(row["items_count"], 0)
        self.assertEqual(row["unsent_count"], 0, "an empty table owes the kitchen nothing")
        self.assertEqual(row["total"], 0)

    def test_snapshot_excludes_settled_and_cancelled_orders(self):
        settled = self.make_order(table=self.table_a, lines=[self.line()])
        frappe.db.set_value("POS Table Order", settled, "status", "Settled")
        cancelled = self.make_order(table=self.table_b, lines=[self.line()])
        frappe.db.set_value("POS Table Order", cancelled, "status", "Cancelled")

        names = {row["name"] for row in floors.get_floor_snapshot(self.profile, self.company)["orders"]}

        self.assertNotIn(settled, names)
        self.assertNotIn(cancelled, names)

    def test_snapshot_includes_table_less_named_tabs(self):
        tab = self.make_order(table=None, lines=[self.line()], tab_name="Ana")

        rows = floors.get_floor_snapshot(self.profile, self.company)["orders"]

        row = next((r for r in rows if r["name"] == tab), None)
        self.assertIsNotNone(row, "the tabs rail reads the same snapshot as the plan")
        self.assertIsNone(row["table"])
        self.assertEqual(row["tab_name"], "Ana")

    def test_snapshot_can_be_narrowed_to_one_floor(self):
        other_floor = self.make_floor("Terraza", sequence=2)

        snapshot = floors.get_floor_snapshot(self.profile, self.company, floor=other_floor)

        self.assertEqual({row["name"] for row in snapshot["floors"]}, {other_floor})
        self.assertEqual(snapshot["tables"], [])

    def test_a_floor_with_no_profile_serves_every_register(self):
        shared = self.make_floor("Compartido", pos_profile=None)

        names = {row["name"] for row in floors.get_floor_snapshot(self.profile, self.company)["floors"]}

        self.assertIn(shared, names, "a blank pos_profile means company-wide, not invisible")

    def test_inactive_floors_and_tables_leave_the_board(self):
        frappe.db.set_value("POS Table", self.table_b, "is_active", 0)

        snapshot = floors.get_floor_snapshot(self.profile, self.company)

        self.assertNotIn(self.table_b, {row["name"] for row in snapshot["tables"]})


class TestOccupancyReconcile(RestaurantTestCase):
    def test_occupied_follows_the_open_order_count(self):
        self.assertEqual(reconcile_table_occupancy(self.table_a), 0)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 0)

        order = self.make_order(table=self.table_a, lines=[self.line()])

        self.assertEqual(reconcile_table_occupancy(self.table_a), 1)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 1)

        frappe.db.set_value("POS Table Order", order, "status", "Settled")

        self.assertEqual(reconcile_table_occupancy(self.table_a), 0)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 0)

    def test_two_open_orders_on_one_table_are_both_counted(self):
        """Split bills: "free" means zero open orders, not "no order"."""
        self.make_order(table=self.table_a, lines=[self.line()])
        self.make_order(table=self.table_a, lines=[self.line()])

        self.assertEqual(open_order_count(self.table_a), 2)
        self.assertEqual(reconcile_table_occupancy(self.table_a), 2)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 1)

    def test_board_rows_group_open_orders_per_table(self):
        self.make_order(table=self.table_a, lines=[self.line()])
        reconcile_table_occupancy(self.table_a)

        rows = {row["name"]: row for row in floor_board_rows(self.floor)}

        self.assertEqual(rows[self.table_a]["open_orders"], 1)
        self.assertEqual(rows[self.table_a]["occupied"], 1)
        self.assertEqual(rows[self.table_b]["open_orders"], 0)


class TestRealtimeBroadcast(RestaurantTestCase):
    """Occupancy rides the doc room, never the site-wide "all" room.

    A bare `publish_realtime(event, msg)` lands in `"all"`, which every
    System User auto-joins on connect — so every register of every company on
    the tenant would receive this register's occupancy (spec F4). The doc room
    is permission-gated for free by `frappe.realtime.has_permission`.
    """

    def test_the_event_targets_the_floor_doc_room(self):
        with mock.patch.object(frappe, "publish_realtime") as published:
            _publish_floor_update(self.floor)

        self.assertEqual(published.call_count, 1)
        args, kwargs = published.call_args
        self.assertEqual(args[0], "posa_floor_update")
        self.assertEqual(kwargs["doctype"], "POS Floor")
        self.assertEqual(kwargs["docname"], self.floor)
        self.assertNotIn("user", kwargs, "the user room would miss the other waiters")

    def test_the_payload_carries_the_board_and_the_origin_device(self):
        self.make_order(table=self.table_a, lines=[self.line()])
        reconcile_table_occupancy(self.table_a)

        with mock.patch.object(frappe, "publish_realtime") as published:
            _publish_floor_update(self.floor, source_device="tablet-7")

        message = published.call_args[0][1]
        self.assertEqual(message["floor"], self.floor)
        self.assertEqual(
            message["source_device"], "tablet-7",
            "echoed so the originating device can ignore its own broadcast",
        )
        self.assertTrue(message["ts"])
        row = next(r for r in message["tables"] if r["name"] == self.table_a)
        self.assertEqual(row["open_orders"], 1)
        self.assertEqual(row["occupied"], 1)

    def test_a_dead_socket_server_does_not_fail_the_write(self):
        # log_error inserts a document, and inserting one publishes its own
        # realtime event — so the error sink has to be stubbed too or the
        # patch fires a second time from inside the except block.
        with mock.patch.object(frappe, "publish_realtime", side_effect=OSError("no redis")):
            with mock.patch.object(frappe, "log_error") as logged:
                _publish_floor_update(self.floor)  # must not raise

        logged.assert_called_once()

    def test_every_mutation_broadcasts(self):
        with mock.patch(
            "posawesome.posawesome.api.restaurant._tickets._publish_floor_update"
        ) as published:
            result = orders.open_table_order(
                pos_profile=self.profile,
                company=self.company,
                client_request_id=uid("tbl-req"),
                order_uid=uid("ord"),
                table=self.table_a,
            )
            self.track("POS Table Order", result["name"])

        published.assert_called_once()

    def test_a_transfer_repaints_both_tables(self):
        order = self.make_order(table=self.table_a, lines=[self.line()])

        with mock.patch(
            "posawesome.posawesome.api.restaurant._tickets._publish_floor_update"
        ) as published:
            orders.transfer_table_order(order, to_table=self.table_b)

        # Both tables share this floor, so one broadcast covers the pair —
        # the board rows in it carry the new state of each.
        self.assertGreaterEqual(published.call_count, 1)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 0)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_b, "occupied"), 1)


class TestFloorLayoutSave(RestaurantTestCase):
    def _floor_modified(self):
        return str(frappe.db.get_value("POS Floor", self.floor, "modified"))

    def test_save_persists_the_canvas_and_upserts_tables(self):
        table_uid = uid("tbl")
        result = floors.save_floor_layout(
            pos_profile=self.profile,
            company=self.company,
            floor=self.floor,
            layout=json.dumps({"cols": 24, "rows": 16, "cell": 32}),
            tables=json.dumps(
                [{"table_uid": table_uid, "table_label": "Barra 3", "seats": 2,
                  "layout": {"x": 2, "y": 3, "w": 2, "h": 2}}]
            ),
            modified=self._floor_modified(),
        )

        created = frappe.db.get_value("POS Table", {"table_uid": table_uid}, "name")
        self.assertTrue(created)
        self.track("POS Table", created)
        self.assertIn(created, result["saved_tables"])
        self.assertEqual(json.loads(frappe.db.get_value("POS Floor", self.floor, "layout"))["cols"], 24)
        self.assertEqual(frappe.db.get_value("POS Table", created, "table_label"), "Barra 3")
        self.assertEqual(
            json.loads(frappe.db.get_value("POS Table", created, "layout"))["x"], 2,
            "geometry is stored in grid units against the floor's canvas frame",
        )

    def test_second_save_updates_the_same_table_by_uid(self):
        table_uid = frappe.db.get_value("POS Table", self.table_a, "table_uid")
        floors.save_floor_layout(
            pos_profile=self.profile,
            company=self.company,
            floor=self.floor,
            tables=json.dumps([{"table_uid": table_uid, "seats": 8}]),
            modified=self._floor_modified(),
        )

        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "seats"), 8)
        self.assertEqual(
            frappe.db.count("POS Table", {"table_uid": table_uid}), 1, "upsert, never a twin"
        )

    def test_a_stale_modified_token_is_refused(self):
        stale = "2020-01-01 00:00:00.000000"

        with self.assertRaises(frappe.TimestampMismatchError):
            floors.save_floor_layout(
                pos_profile=self.profile,
                company=self.company,
                floor=self.floor,
                layout=json.dumps({"cols": 1}),
                modified=stale,
            )

    def test_the_saving_device_is_echoed_so_it_can_ignore_its_own_ping(self):
        with mock.patch(
            "posawesome.posawesome.api.restaurant.floors._publish_floor_update"
        ) as published:
            floors.save_floor_layout(
                pos_profile=self.profile,
                company=self.company,
                floor=self.floor,
                layout=json.dumps({"cols": 12}),
                source_device="tablet-7",
            )

        self.assertEqual(published.call_args.kwargs["source_device"], "tablet-7")

    def test_an_editor_save_without_a_device_still_broadcasts(self):
        with mock.patch(
            "posawesome.posawesome.api.restaurant.floors._publish_floor_update"
        ) as published:
            floors.save_floor_layout(
                pos_profile=self.profile,
                company=self.company,
                floor=self.floor,
                layout=json.dumps({"cols": 12}),
            )

        published.assert_called_once()
        self.assertIsNone(published.call_args.kwargs["source_device"])

    def test_no_token_means_the_caller_accepts_last_write_wins(self):
        floors.save_floor_layout(
            pos_profile=self.profile,
            company=self.company,
            floor=self.floor,
            layout=json.dumps({"cols": 9}),
        )
        self.assertEqual(json.loads(frappe.db.get_value("POS Floor", self.floor, "layout"))["cols"], 9)

    def test_save_refuses_a_floor_from_another_company(self):
        with self.assertRaises(frappe.ValidationError):
            floors.save_floor_layout(
                pos_profile=self.profile,
                company="Not A Company",
                floor=self.floor,
                layout=json.dumps({}),
            )

    def test_layout_payload_must_be_json(self):
        with self.assertRaises(frappe.ValidationError):
            floors.save_floor_layout(
                pos_profile=self.profile,
                company=self.company,
                floor=self.floor,
                layout="{not json",
            )


class TestDeleteGuards(RestaurantTestCase):
    def test_a_table_with_an_open_order_refuses_deletion(self):
        self.make_order(table=self.table_a, lines=[self.line()])

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc("POS Table", self.table_a, ignore_permissions=True)

    def test_a_table_referenced_by_a_settled_order_refuses_deletion(self):
        order = self.make_order(table=self.table_a, lines=[self.line()])
        frappe.db.set_value("POS Table Order", order, "status", "Settled")

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc("POS Table", self.table_a, ignore_permissions=True)

    def test_a_floor_with_tables_refuses_deletion(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc("POS Floor", self.floor, ignore_permissions=True)

    def test_an_open_order_refuses_deletion(self):
        order = self.make_order(table=self.table_a, lines=[self.line()])

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc("POS Table Order", order, ignore_permissions=True)

    def test_duplicate_label_on_one_floor_is_rejected(self):
        label = frappe.db.get_value("POS Table", self.table_a, "table_label")

        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Table",
                    "table_uid": uid("tbl"),
                    "table_label": label,
                    "floor": self.floor,
                }
            ).insert(ignore_permissions=True)

    def test_the_same_label_on_a_different_floor_is_fine(self):
        label = frappe.db.get_value("POS Table", self.table_a, "table_label")
        other_floor = self.make_floor("Terraza", sequence=2)

        doc = frappe.get_doc(
            {
                "doctype": "POS Table",
                "table_uid": uid("tbl"),
                "table_label": label,
                "floor": other_floor,
            }
        ).insert(ignore_permissions=True)
        self.track("POS Table", doc.name)

        self.assertEqual(doc.table_label, label)


class TestMarkTableClean(RestaurantTestCase):
    """The bussing latch must be two-way: settle sets it, this clears it.

    Before mark_table_clean existed the flag was one-way — after its first
    settle a table showed the broom forever and the kanban cleaning column
    only ever grew.
    """

    def _dirty(self, table):
        frappe.db.set_value(
            "POS Table",
            table,
            {"needs_cleaning": 1, "bill_printed_at": frappe.utils.now_datetime()},
        )

    def test_clears_the_latch_and_the_proforma_stamp(self):
        self._dirty(self.table_a)

        result = floors.mark_table_clean(self.profile, self.company, self.table_a)

        self.assertEqual(result["needs_cleaning"], 0)
        row = frappe.db.get_value(
            "POS Table", self.table_a, ["needs_cleaning", "bill_printed_at"], as_dict=True
        )
        self.assertEqual(row.needs_cleaning, 0)
        self.assertIsNone(row.bill_printed_at)

    def test_is_idempotent_on_an_already_clean_table(self):
        result = floors.mark_table_clean(self.profile, self.company, self.table_a)
        self.assertEqual(result["needs_cleaning"], 0)

    def test_refuses_a_table_from_another_company(self):
        self._dirty(self.table_a)
        # Capture the ORIGINAL before patching — grabbing it inside the `with`
        # would alias the mock itself, and a cold roles cache (cleared by the
        # capability fixture) would then recurse through get_roles→get_value.
        real = frappe.db.get_value
        with mock.patch(
            "posawesome.posawesome.api.restaurant.floors.frappe.db.get_value",
            wraps=frappe.db.get_value,
        ) as get_value:
            # Redirect only the floor-company lookup so the guard sees a
            # foreign company while everything else stays real.

            def fake(doctype, *args, **kwargs):
                if doctype == "POS Floor" and args[1:2] == ("company",):
                    return "Some Other Company"
                return real(doctype, *args, **kwargs)

            get_value.side_effect = fake
            with self.assertRaises(frappe.exceptions.ValidationError):
                floors.mark_table_clean(self.profile, self.company, self.table_a)
        self.assertEqual(
            frappe.db.get_value("POS Table", self.table_a, "needs_cleaning"), 1
        )

    def test_the_cleaning_device_is_echoed_on_the_broadcast(self):
        self._dirty(self.table_a)
        with mock.patch(
            "posawesome.posawesome.api.restaurant.floors._publish_floor_update"
        ) as published:
            floors.mark_table_clean(
                self.profile, self.company, self.table_a, source_device="busser-1"
            )
        self.assertEqual(published.call_args.kwargs["source_device"], "busser-1")


if __name__ == "__main__":
    unittest.main()
