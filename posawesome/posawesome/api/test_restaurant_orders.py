"""Open / update / transfer / cancel a Record-Only table ticket.

The load-bearing cases, all of them failure modes the spec names:

* opening twice with one request id, or one order_uid, is ONE order (§6.2 —
  update_invoice does no ledger lookup, so this layer dedupes itself);
* tapping a busy table opens the order that is already there, it does not
  seat a second party (§4);
* an update is a PER-LINE UNION — the other waiter's lines survive (§6.1),
  removals must be named, and a fired line refuses removal;
* transfer onto an occupied table throws instead of hiding a second order;
* an order carrying ANOTHER user's shift is visible on this register's floor
  (F5 — the blocker that makes a shift-scoped predicate blind waiters).
"""

from __future__ import annotations

import unittest
from unittest import mock

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.restaurant import floors, orders
from posawesome.posawesome.api.restaurant._tickets import (
    open_order_filters,
    register_open_shifts,
)
from posawesome.posawesome.api.test_restaurant_support import (
    RestaurantTestCase,
    make_shift,
    uid,
)


class TestRestaurantOrders(RestaurantTestCase):
    def _open(self, **kwargs):
        payload = {
            "pos_profile": self.profile,
            "company": self.company,
            "client_request_id": kwargs.pop("client_request_id", uid("tbl-req")),
            "order_uid": kwargs.pop("order_uid", uid("ord")),
        }
        payload.update(kwargs)
        result = orders.open_table_order(**payload)
        self.track("POS Table Order", result["name"])
        return result

    # -- open --------------------------------------------------------------

    def test_open_binds_table_shift_and_session_user(self):
        result = self._open(table=self.table_a, guest_count=3, tab_name="Marco")

        self.assertEqual(result["table"], self.table_a)
        self.assertEqual(result["status"], "Open")
        self.assertEqual(result["pos_opening_shift"], self.shift)
        self.assertEqual(result["opened_by"], frappe.session.user)
        self.assertEqual(result["waiter"], frappe.session.user)
        self.assertEqual(result["guest_count"], 3)
        self.assertFalse(result["existing"])
        self.assertEqual(
            frappe.db.get_value("POS Table", self.table_a, "occupied"), 1,
            "the occupied hint must be reconciled from the open-order count",
        )

    def test_open_is_idempotent_on_client_request_id(self):
        request_id = uid("tbl-req")
        first = self._open(client_request_id=request_id, table=self.table_a)
        second = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=request_id,
            order_uid=uid("ord"),
            table=self.table_b,
        )

        self.assertEqual(second["name"], first["name"], "a retried open must not make a second ticket")
        self.assertTrue(second["existing"])
        self.assertEqual(
            frappe.db.count("POS Table Order", {"posa_client_request_id": request_id}), 1
        )

    def test_open_is_idempotent_on_order_uid(self):
        order_uid = uid("ord")
        first = self._open(order_uid=order_uid, table=self.table_a)
        # A queue replay generates a FRESH request id but keeps the uid it
        # already told the user about.
        second = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=uid("tbl-req"),
            order_uid=order_uid,
            table=self.table_a,
        )

        self.assertEqual(second["name"], first["name"])
        self.assertTrue(second["existing"])

    def test_tapping_a_busy_table_returns_the_order_already_there(self):
        first = self._open(table=self.table_a)
        second = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=uid("tbl-req"),
            order_uid=uid("ord"),
            table=self.table_a,
        )

        self.assertEqual(second["name"], first["name"], "tap must open the order, not seat a second party")
        self.assertTrue(second["existing"])

    def test_new_account_opens_a_second_cuenta_on_a_busy_table(self):
        first = self._open(table=self.table_a, tab_name="Mesa · A")
        second = self._open(table=self.table_a, tab_name="Mesa · B", new_account=1)

        self.assertNotEqual(
            second["name"],
            first["name"],
            "nueva cuenta must seat a SECOND party, not resolve to the first",
        )
        self.assertFalse(second["existing"])
        self.assertEqual(second["table"], self.table_a)
        self.assertEqual(
            frappe.db.count(
                "POS Table Order", {"table": self.table_a, "status": "Open"}
            ),
            2,
            "the table now carries two open cuentas",
        )

    def test_new_account_open_is_still_idempotent_on_request_id(self):
        request_id = uid("tbl-req")
        first = self._open(client_request_id=request_id, table=self.table_a)
        # A retried "nueva cuenta" tap with the same request id must not mint a
        # third order — idempotency runs before the table check either way.
        second = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=request_id,
            order_uid=uid("ord"),
            table=self.table_a,
            new_account=1,
        )
        self.assertEqual(second["name"], first["name"])
        self.assertTrue(second["existing"])

    def test_open_without_table_is_a_named_tab(self):
        result = self._open(tab_name="Ana", table=None)

        self.assertIsNone(result["table"])
        self.assertEqual(result["tab_name"], "Ana")

    def test_open_rejects_unknown_table(self):
        with self.assertRaises(frappe.DoesNotExistError):
            orders.open_table_order(
                pos_profile=self.profile,
                company=self.company,
                client_request_id=uid("tbl-req"),
                order_uid=uid("ord"),
                table="no-such-table",
            )

    # -- update: the per-line union ---------------------------------------

    def test_update_upserts_incoming_lines_and_computes_amount(self):
        order = self._open(table=self.table_a)
        line = self.line(qty=2, rate=30)

        result = orders.update_table_order(
            order["name"], client_request_id=uid("tbl-req"), lines=[line]
        )

        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["qty"], 2)
        self.assertEqual(
            result["items"][0]["amount"], 60,
            "amount is qty x rate server-side — the client does not get a vote",
        )

    def test_server_lines_absent_from_the_payload_survive(self):
        """The multi-waiter case. Waiter B syncs without waiter A's line."""
        order = self._open(table=self.table_a)
        line_a = self.line(qty=1, rate=10)
        line_b = self.line(qty=1, rate=20)
        orders.update_table_order(order["name"], client_request_id=uid("tbl-req"), lines=[line_a])

        result = orders.update_table_order(
            order["name"], client_request_id=uid("tbl-req"), lines=[line_b]
        )

        uids = {row["line_uid"] for row in result["items"]}
        self.assertIn(line_a["line_uid"], uids, "a line missing from the payload must NOT be deleted")
        self.assertIn(line_b["line_uid"], uids)
        self.assertEqual(len(result["items"]), 2)

    def test_update_by_line_uid_replaces_qty_rather_than_appending(self):
        order = self._open(table=self.table_a)
        line = self.line(qty=1, rate=10)
        orders.update_table_order(order["name"], client_request_id=uid("tbl-req"), lines=[line])

        bumped = dict(line, qty=4)
        result = orders.update_table_order(
            order["name"], client_request_id=uid("tbl-req"), lines=[bumped]
        )

        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["qty"], 4)
        self.assertEqual(result["items"][0]["amount"], 40)

    def test_removed_line_uids_is_the_only_way_to_delete(self):
        order = self._open(table=self.table_a)
        keep = self.line(qty=1, rate=10)
        drop = self.line(qty=1, rate=20)
        orders.update_table_order(
            order["name"], client_request_id=uid("tbl-req"), lines=[keep, drop]
        )

        result = orders.update_table_order(
            order["name"],
            client_request_id=uid("tbl-req"),
            removed_line_uids=[drop["line_uid"]],
        )

        uids = {row["line_uid"] for row in result["items"]}
        self.assertEqual(uids, {keep["line_uid"]})
        self.assertEqual(result["rejected_removals"], [])

    def test_a_fired_line_refuses_removal_and_is_reported_back(self):
        order = self._open(table=self.table_a)
        line = self.line(qty=1, rate=10)
        orders.update_table_order(order["name"], client_request_id=uid("tbl-req"), lines=[line])
        frappe.db.set_value(
            "POS Table Order Item",
            frappe.db.get_value("POS Table Order Item", {"line_uid": line["line_uid"]}, "name"),
            "fired",
            1,
        )

        result = orders.update_table_order(
            order["name"],
            client_request_id=uid("tbl-req"),
            removed_line_uids=[line["line_uid"]],
        )

        self.assertEqual(result["rejected_removals"], [line["line_uid"]])
        self.assertEqual(
            len(result["items"]), 1, "food already sent to the kitchen stays on the bill"
        )

    def test_update_replay_with_the_same_request_id_is_a_no_op(self):
        order = self._open(table=self.table_a)
        request_id = uid("tbl-req")
        line = self.line(qty=1, rate=10)
        first = orders.update_table_order(order["name"], client_request_id=request_id, lines=[line])

        replay = orders.update_table_order(
            order["name"], client_request_id=request_id, lines=[self.line(qty=9, rate=99)]
        )

        self.assertTrue(replay["existing"])
        self.assertEqual(len(replay["items"]), len(first["items"]))

    def test_update_refuses_a_settled_order(self):
        order = self._open(table=self.table_a)
        frappe.db.set_value("POS Table Order", order["name"], "status", "Settled")

        with self.assertRaises(frappe.ValidationError):
            orders.update_table_order(
                order["name"], client_request_id=uid("tbl-req"), lines=[self.line()]
            )

    def test_update_resolves_an_order_by_uid(self):
        order = self._open(table=self.table_a)
        result = orders.update_table_order(
            order["order_uid"], client_request_id=uid("tbl-req"), lines=[self.line()]
        )
        self.assertEqual(result["name"], order["name"])

    # -- transfer / cancel -------------------------------------------------

    def test_transfer_to_an_empty_table_reparents_and_repaints_both(self):
        order = self._open(table=self.table_a)

        result = orders.transfer_table_order(order["name"], to_table=self.table_b)

        self.assertEqual(result["table"], self.table_b)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 0)
        self.assertEqual(frappe.db.get_value("POS Table", self.table_b, "occupied"), 1)

    def test_transfer_onto_an_occupied_table_throws(self):
        order = self._open(table=self.table_a)
        self._open(table=self.table_b)

        with self.assertRaises(frappe.ValidationError):
            orders.transfer_table_order(order["name"], to_table=self.table_b)

        self.assertEqual(
            frappe.db.get_value("POS Table Order", order["name"], "table"), self.table_a,
            "a refused transfer must leave the order where it was",
        )

    def test_cancel_releases_the_table(self):
        order = self._open(table=self.table_a)

        result = orders.cancel_table_order(order["name"])

        self.assertEqual(result["status"], "Cancelled")
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "occupied"), 0)
        self.assertEqual(
            frappe.db.get_value("POS Table Order", order["name"], "table"), self.table_a,
            "a cancelled order keeps its FK for reporting",
        )

    def test_cancel_is_idempotent(self):
        order = self._open(table=self.table_a)
        orders.cancel_table_order(order["name"])
        again = orders.cancel_table_order(order["name"])
        self.assertTrue(again["existing"])

    # -- F5: shifts are per-user, the floor is shared ----------------------

    def test_register_open_shifts_spans_users_not_just_the_caller(self):
        other_user = frappe.db.get_value(
            "User", {"enabled": 1, "name": ["not in", ["Administrator", "Guest"]]}, "name"
        )
        if not other_user:
            self.skipTest("no second enabled user on this site")
        other_shift = self.track(
            "POS Opening Shift", make_shift(self.profile, self.company, other_user)
        )

        shifts = register_open_shifts(self.profile)

        self.assertIn(self.shift, shifts)
        self.assertIn(other_shift, shifts, "a per-user predicate would blind this register")

    def test_an_order_on_another_users_shift_is_visible_on_the_floor(self):
        other_user = frappe.db.get_value(
            "User", {"enabled": 1, "name": ["not in", ["Administrator", "Guest"]]}, "name"
        )
        if not other_user:
            self.skipTest("no second enabled user on this site")
        other_shift = self.track(
            "POS Opening Shift", make_shift(self.profile, self.company, other_user)
        )
        order = self.make_order(table=self.table_a, shift=other_shift, lines=[self.line()])

        snapshot = floors.get_floor_snapshot(self.profile, self.company)

        names = {row["name"] for row in snapshot["orders"]}
        self.assertIn(
            order, names,
            "waiter B must see waiter A's table as busy, or B seats a second party on it",
        )

    def test_open_order_filters_is_the_shared_predicate(self):
        self.assertEqual(open_order_filters(), {"status": "Open"})
        self.assertEqual(
            open_order_filters(table="T", shifts=["S1", "S2"]),
            {"status": "Open", "table": "T", "pos_opening_shift": ["in", ["S1", "S2"]]},
        )


class TestOrderPayloadCarriesLines(RestaurantTestCase):
    """R1 — every order response carries its `items` children.

    The floor UI resumes a ticket straight from these responses. A response
    that omits the lines loads an EMPTY cart over a full table, and the waiter
    re-rings food the kitchen already has. This exact failure class has been
    hit once already in the tabs rail, so every path that can return an
    existing order is pinned here, not just the happy one.
    """

    def _open(self, **kwargs):
        payload = {
            "pos_profile": self.profile,
            "company": self.company,
            "client_request_id": kwargs.pop("client_request_id", uid("tbl-req")),
            "order_uid": kwargs.pop("order_uid", uid("ord")),
        }
        payload.update(kwargs)
        result = orders.open_table_order(**payload)
        self.track("POS Table Order", result["name"])
        return result

    def _with_two_lines(self, order):
        first = self.line(qty=2, rate=25)
        second = self.line(qty=1, rate=40, item=self.item_drink)
        orders.update_table_order(
            order["name"], client_request_id=uid("tbl-req"), lines=[first, second]
        )
        return {first["line_uid"], second["line_uid"]}

    def _assert_carries(self, payload, expected_uids):
        self.assertIn("items", payload, "the response must carry its lines")
        self.assertEqual(
            {row["line_uid"] for row in payload["items"]}, expected_uids,
            "a line-less response loads an empty cart over a full ticket",
        )
        for row in payload["items"]:
            # The cart needs enough to render and re-price, not just an id.
            for field in ("item_code", "qty", "rate", "amount", "course_idx", "fired"):
                self.assertIn(field, row)

    def test_a_fresh_open_returns_an_empty_items_list_not_a_missing_key(self):
        result = self._open(table=self.table_a)

        self.assertIn("items", result)
        self.assertEqual(result["items"], [])

    def test_update_returns_the_lines_it_just_merged(self):
        order = self._open(table=self.table_a)
        line = self.line(qty=3, rate=15)

        result = orders.update_table_order(
            order["name"], client_request_id=uid("tbl-req"), lines=[line]
        )

        self._assert_carries(result, {line["line_uid"]})

    def test_reopen_by_order_uid_returns_the_existing_lines(self):
        order = self._open(table=self.table_a)
        uids = self._with_two_lines(order)

        replay = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=uid("tbl-req"),
            order_uid=order["order_uid"],
            table=self.table_a,
        )

        self.assertTrue(replay["existing"])
        self._assert_carries(replay, uids)

    def test_reopen_by_tapping_the_table_returns_the_existing_lines(self):
        order = self._open(table=self.table_a)
        uids = self._with_two_lines(order)

        tapped = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=uid("tbl-req"),
            order_uid=uid("ord"),
            table=self.table_a,
        )

        self.assertEqual(tapped["name"], order["name"])
        self._assert_carries(tapped, uids)

    def test_reopen_by_client_request_id_returns_the_existing_lines(self):
        request_id = uid("tbl-req")
        order = self._open(client_request_id=request_id, table=self.table_a)
        uids = self._with_two_lines(order)

        # The update above re-stamped posa_client_request_id, so re-open by the
        # ORIGINAL id now resolves through the order_uid branch — either way it
        # must come back with the lines.
        replay = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=request_id,
            order_uid=order["order_uid"],
            table=self.table_a,
        )

        self.assertEqual(replay["name"], order["name"])
        self._assert_carries(replay, uids)

    def test_a_named_tab_reopen_also_carries_its_lines(self):
        order = self._open(table=None, tab_name="Ana")
        uids = self._with_two_lines(order)

        replay = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=uid("tbl-req"),
            order_uid=order["order_uid"],
        )

        self._assert_carries(replay, uids)

    def test_the_dedicated_read_endpoint_carries_lines_too(self):
        order = self._open(table=self.table_a)
        uids = self._with_two_lines(order)

        self._assert_carries(orders.get_table_order(order["order_uid"]), uids)


class TestSourceDeviceEcho(RestaurantTestCase):
    """Every mutation echoes the originating device on its broadcast.

    Without it the device that made the change reacts to its own occupancy
    ping and repaints for nothing. The echo is what lets it tell its own
    change apart from another waiter's.
    """

    PUBLISH = "posawesome.posawesome.api.restaurant._tickets._publish_floor_update"
    PUBLISH_TABS = "posawesome.posawesome.api.restaurant._tickets._publish_tabs_update"

    def _open(self, **kwargs):
        result = orders.open_table_order(
            pos_profile=self.profile,
            company=self.company,
            client_request_id=uid("tbl-req"),
            order_uid=uid("ord"),
            **kwargs,
        )
        self.track("POS Table Order", result["name"])
        return result

    def _assert_echoed(self, published, device="tablet-7"):
        published.assert_called()
        self.assertEqual(published.call_args.kwargs.get("source_device"), device)

    def test_open_echoes(self):
        with mock.patch(self.PUBLISH) as published:
            self._open(table=self.table_a, source_device="tablet-7")
        self._assert_echoed(published)

    def test_update_echoes(self):
        order = self._open(table=self.table_a)
        with mock.patch(self.PUBLISH) as published:
            orders.update_table_order(
                order["name"],
                client_request_id=uid("tbl-req"),
                lines=[self.line()],
                source_device="tablet-7",
            )
        self._assert_echoed(published)

    def test_transfer_echoes(self):
        order = self._open(table=self.table_a)
        with mock.patch(self.PUBLISH) as published:
            orders.transfer_table_order(
                order["name"], to_table=self.table_b, source_device="tablet-7"
            )
        self._assert_echoed(published)

    def test_cancel_echoes(self):
        order = self._open(table=self.table_a)
        with mock.patch(self.PUBLISH) as published:
            orders.cancel_table_order(order["name"], source_device="tablet-7")
        self._assert_echoed(published)

    def test_a_table_less_tab_echoes_on_the_tabs_event(self):
        order = self._open(table=None, tab_name="Ana")
        with mock.patch(self.PUBLISH_TABS) as published:
            orders.cancel_table_order(order["name"], source_device="tablet-7")

        published.assert_called_once()
        # _publish_tabs_update takes it positionally: (profile, company, device)
        self.assertEqual(published.call_args[0][2], "tablet-7")

    def test_omitting_the_device_is_still_a_valid_broadcast(self):
        with mock.patch(self.PUBLISH) as published:
            self._open(table=self.table_a)

        published.assert_called()
        self.assertIsNone(published.call_args.kwargs.get("source_device"))


if __name__ == "__main__":
    unittest.main()
