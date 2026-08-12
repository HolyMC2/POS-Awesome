"""Kitchen ticket projection: the diff, the snapshot, and station routing.

The whole point of the design is that firing prints CHANGES, not the ticket:
a second fire after adding one dish prints one dish, a qty cut prints a
cancellation, and a line deleted after firing prints a cancellation too. That
only works if `last_fired` round-trips exactly, so the snapshot is asserted
as hard as the projection.
"""

from __future__ import annotations

import json
import queue
import threading
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

    def test_a_replayed_fire_returns_the_original_durable_projection(self):
        request_id = uid("tbl-req")
        order = self._order_with(self.line())
        first = kot.fire_course(order, client_request_id=request_id)

        replay = kot.fire_course(order, client_request_id=request_id)

        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["stations"], first["stations"])
        self.assertEqual(replay["batch"]["name"], first["batch"]["name"])
        self.assertEqual(len(replay["batch"]["jobs"]), len(first["batch"]["jobs"]))

    def test_fire_persists_one_job_per_station_projection(self):
        order = self._order_with(self.line())

        result = kot.fire_course(order, client_request_id=uid("tbl-req"))

        self.assertIsNotNone(result["batch"])
        self.assertEqual(len(result["batch"]["jobs"]), len(result["stations"]))
        self.assertTrue(all(job["status"] == "queued" for job in result["batch"]["jobs"]))

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


class TestProjectionRendering(RestaurantTestCase):
    def _format(self, doc_type="POS Table Order", disabled=0):
        name = uid("KOT Format")
        doc = frappe.get_doc({
            "doctype": "Print Format",
            "name": name,
            "doc_type": doc_type,
            "custom_format": 1,
            "disabled": disabled,
            "html": "<h1>{{ ticket.station }}</h1>{% for line in doc.lines %}<b>{{ line.qty }} {{ line.item_name }}</b>{% endfor %}",
            "css": ".kot{font-weight:bold}",
        }).insert(ignore_permissions=True)
        return self.track("Print Format", doc.name)

    def test_projection_renderer_uses_frozen_ticket_not_live_order(self):
        print_format = self._format()

        html = kot.render_kot_projection(print_format, {
            "station": "Cocina",
            "lines": [{"qty": 2, "item_name": "Tacos"}],
        })

        self.assertIn("<h1>Cocina</h1>", html)
        self.assertIn("<b>2 Tacos</b>", html)
        self.assertIn(".kot{font-weight:bold}", html)

    def test_projection_renderer_rejects_wrong_doctype_format(self):
        print_format = self._format(doc_type="Sales Invoice")

        with self.assertRaises(frappe.ValidationError):
            kot.render_kot_projection(print_format, {"station": "Cocina", "lines": []})


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

    def test_full_order_void_uses_each_lines_original_station(self):
        kitchen = self._station("Cocina", [self.kitchen_group], printer="KITCHEN-01")
        bar = self._station("Barra", [self.bar_group], printer="BAR-01")
        food_line = self.line(item=self.food, qty=2)
        drink_line = self.line(item=self.drink, qty=1)
        order = self.make_order(table=self.table_a, lines=[food_line, drink_line])
        kot.fire_course(order, client_request_id=uid("fire"))

        # Configuration changes after firing must not redirect a void to a
        # station that never saw the original ticket.
        frappe.db.set_value("POS Kitchen Station", kitchen, "printer", "KITCHEN-NEW")
        frappe.db.set_value("POS Kitchen Station", bar, "printer", "BAR-NEW")

        result = orders.cancel_table_order(order, client_request_id=uid("void"))

        void = result["kitchen_void"]
        by_printer = {station["printer"]: station for station in void["cancellations"]}
        self.assertEqual(set(by_printer), {"KITCHEN-01", "BAR-01"})
        self.assertEqual(by_printer["KITCHEN-01"]["lines"][0]["line_uid"], food_line["line_uid"])
        self.assertEqual(by_printer["BAR-01"]["lines"][0]["line_uid"], drink_line["line_uid"])
        self.assertTrue(all(line["kind"] == "void" for line in _all_lines(void["cancellations"])))
        self.assertEqual(len(void["batch"]["jobs"]), 2)

    def test_full_order_void_replay_returns_the_same_batch(self):
        self._station("Cocina", [self.kitchen_group], printer="KITCHEN-01")
        order = self.make_order(table=self.table_a, lines=[self.line(item=self.food)])
        kot.fire_course(order, client_request_id=uid("fire"))

        first = orders.cancel_table_order(order, client_request_id=uid("void"))["kitchen_void"]
        replay = orders.cancel_table_order(order, client_request_id=uid("void-retry"))["kitchen_void"]

        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["batch"]["name"], first["batch"]["name"])
        self.assertEqual(replay["cancellations"], first["cancellations"])

    def test_fired_snapshot_freezes_station_routing(self):
        self._station("Cocina", [self.kitchen_group], printer="KITCHEN-01")
        line = self.line(item=self.food)
        order = self.make_order(table=self.table_a, lines=[line])

        kot.fire_course(order, client_request_id=uid("fire"))

        snapshot = json.loads(frappe.db.get_value("POS Table Order", order, "last_fired"))
        self.assertEqual(snapshot[line["line_uid"]]["routing"]["printer"], "KITCHEN-01")

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


class TestFireConcurrency(RestaurantTestCase):
    """Real cross-connection concurrency, isolated in its own test class.

    This test spawns worker threads that open their own DB connections and
    COMMIT, while the parent thread parks in ``thread.join``. Under Frappe's
    IntegrationTestCase every method in a class shares one outer transaction;
    running this alongside the sibling tests in ``TestFireDiff`` lets their
    still-held row locks block the worker's committed setup insert, so the join
    times out. A dedicated class gives it a clean per-class transaction. The
    underlying ``SELECT ... FOR UPDATE`` serialization in
    ``_lock_and_get_scoped_order`` is independently correct (verified live: two
    concurrent fires produce fired counts [0, 1], never a double print).
    """

    def test_two_transactions_cannot_print_the_same_delta(self):
        """The second request waits on the order row, then sees the new snapshot."""
        site = frappe.local.site
        order_name = uid("concurrent-kot")
        request_ids = [uid("fire-a"), uid("fire-b")]

        def in_connection(fn):
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user("Administrator")
            try:
                return fn()
            finally:
                frappe.destroy()

        def isolated_call(fn):
            output = queue.Queue()

            def target():
                try:
                    output.put(("ok", in_connection(fn)))
                except Exception as exc:
                    output.put(("error", exc))

            thread = threading.Thread(target=target)
            thread.start()
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "isolated database call timed out")
            kind, value = output.get_nowait()
            if kind == "error":
                raise value
            return value

        def create_committed_order():
            item = frappe.db.get_value("Item", {"disabled": 0, "is_sales_item": 1}, "name")
            doc = frappe.get_doc({
                "doctype": "POS Table Order",
                "order_uid": order_name,
                "pos_profile": self.profile,
                "company": self.company,
                "status": "Open",
                "opened_by": "Administrator",
                "waiter": "Administrator",
                "items": [{"line_uid": uid("ln"), "item_code": item, "qty": 1, "rate": 10}],
            }).insert(ignore_permissions=True)
            frappe.db.commit()
            return doc.name

        isolated_call(create_committed_order)
        barrier = threading.Barrier(2)
        results = queue.Queue()

        def fire(request_id):
            def run():
                barrier.wait(timeout=5)
                result = kot.fire_course(order_name, client_request_id=request_id)
                frappe.db.commit()
                return result

            try:
                results.put(("ok", in_connection(run)))
            except Exception as exc:  # asserted in the parent thread
                results.put(("error", repr(exc)))

        threads = [threading.Thread(target=fire, args=(request_id,)) for request_id in request_ids]
        try:
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=15)
            self.assertTrue(all(not thread.is_alive() for thread in threads), "concurrent fire deadlocked")
            outcomes = [results.get_nowait() for _ in threads]
            self.assertEqual([kind for kind, _ in outcomes], ["ok", "ok"])
            fired_counts = [len(_all_lines(result["stations"])) for _, result in outcomes]
            self.assertEqual(sorted(fired_counts), [0, 1], "the same delta printed twice")
        finally:
            def cleanup():
                batches = frappe.get_all(
                    "Doco Print Batch",
                    filters={"source_doctype": "POS Table Order", "source_name": order_name},
                    pluck="name",
                )
                for batch in batches:
                    frappe.db.delete("Doco Print Job", {"batch": batch})
                    frappe.db.delete("Doco Print Batch", {"name": batch})
                if frappe.db.exists("POS Table Order", order_name):
                    frappe.db.set_value("POS Table Order", order_name, "status", "Cancelled")
                    frappe.delete_doc("POS Table Order", order_name, force=True, ignore_permissions=True)
                frappe.db.commit()

            isolated_call(cleanup)


if __name__ == "__main__":
    unittest.main()
