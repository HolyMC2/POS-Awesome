"""Settle: the one place the table world touches the ledger.

Three things have to hold. The invoice must carry the provenance stamps
(`posa_rt_*`) so a settled sale can be traced back to the table. A second
settle must return the first invoice rather than sell the food twice — the
durable submission ledger inside `creation.submit_invoice` is what makes that
true, which is exactly why settle routes through it instead of building its
own submit. And a failed settle must leave the ticket OPEN, or the waiter is
staring at a table nobody can bill.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.invoice_processing import creation
from posawesome.posawesome.api.restaurant import settle
from posawesome.posawesome.api.test_restaurant_support import RestaurantTestCase, uid


class TestSettleTableOrder(RestaurantTestCase):
    def setUp(self):
        super().setUp()
        if not frappe.db.has_column("Sales Invoice", "posa_rt_table"):
            self.skipTest("posa_rt_table custom field not migrated yet")
        self.mode_of_payment = (
            frappe.db.get_value("Mode of Payment", {"enabled": 1, "type": "Cash"}, "name")
            or frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name")
        )

    def _order(self, qty=2, rate=25, **kwargs):
        return self.make_order(
            table=self.table_a,
            lines=[self.line(qty=qty, rate=rate)],
            tab_name="Marco",
            guest_count=2,
            service_type="Dine In",
            customer=self.customer,
            **kwargs,
        )

    def _payload(self, amount):
        return json.dumps(
            {
                "customer": self.customer,
                "payments": [{"mode_of_payment": self.mode_of_payment, "amount": amount}],
            }
        )

    def _settle(self, order, amount=50, request_id=None):
        result = settle.settle_table_order(
            order,
            client_request_id=request_id or uid("tbl-req"),
            invoice_payload=self._payload(amount),
        )
        if result.get("sales_invoice"):
            self._tracked.insert(0, ("Sales Invoice", result["sales_invoice"]))
        return result

    # -- happy path --------------------------------------------------------

    def test_settle_creates_and_submits_an_invoice(self):
        order = self._order()

        result = self._settle(order)

        self.assertTrue(result["sales_invoice"])
        self.assertEqual(result["status"], "Settled")
        self.assertFalse(result["idempotent"])
        self.assertEqual(
            frappe.db.get_value("Sales Invoice", result["sales_invoice"], "docstatus"), 1
        )

    def test_settle_returns_the_submit_result_under_invoice_result(self):
        """The SPA payment path reads docstatus/status off this to drive print,
        change-due and navigation. FROZEN key name — the offline wrapper is
        coded against `invoice_result`."""
        order = self._order()

        result = self._settle(order)

        invoice = result["invoice_result"]
        self.assertIsNotNone(invoice, "a fresh settle must return the submit result")
        self.assertEqual(invoice["name"], result["sales_invoice"])
        self.assertEqual(invoice["docstatus"], 1)
        self.assertEqual(invoice["status"], 1)
        self.assertIn(invoice["doctype"], ("Sales Invoice", "POS Invoice"))

    def test_the_settle_response_keys_are_frozen(self):
        order = self._order()

        result = self._settle(order)

        self.assertEqual(
            set(result),
            {"order", "order_uid", "status", "sales_invoice", "invoice_result", "idempotent"},
            "the offline wrapper is coded against this exact key set — additive only, "
            "and only after telling the offline agent",
        )
        self.assertIsInstance(result["order"], str)

    def test_a_replay_returns_the_name_with_no_invoice_result(self):
        """Deliberate: a replay must not re-run the submit just to repopulate
        a document, and the offline seam handles the None explicitly by
        fetching by `sales_invoice` when it needs one."""
        order = self._order()
        first = self._settle(order)

        replay = settle.settle_table_order(
            order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(50)
        )

        self.assertTrue(replay["idempotent"])
        self.assertEqual(replay["sales_invoice"], first["sales_invoice"])
        self.assertIsNone(
            replay["invoice_result"],
            "populating this on replay would hide the replay from the offline seam",
        )

    def test_a_replay_does_not_re_run_the_submit(self):
        order = self._order()
        self._settle(order)

        with mock.patch.object(creation, "submit_invoice") as submitted:
            replay = settle.settle_table_order(
                order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(50)
            )

        submitted.assert_not_called()
        self.assertTrue(replay["idempotent"])

    def test_settle_echoes_the_source_device(self):
        order = self._order()

        with mock.patch(
            "posawesome.posawesome.api.restaurant._tickets._publish_floor_update"
        ) as published:
            result = settle.settle_table_order(
                order,
                client_request_id=uid("tbl-req"),
                invoice_payload=self._payload(50),
                source_device="tablet-7",
            )
        if result.get("sales_invoice"):
            self._tracked.insert(0, ("Sales Invoice", result["sales_invoice"]))

        published.assert_called()
        self.assertEqual(published.call_args.kwargs.get("source_device"), "tablet-7")

    def test_settle_stamps_the_table_provenance_on_the_invoice(self):
        order = self._order()

        invoice = self._settle(order)["sales_invoice"]

        stamps = frappe.db.get_value(
            "Sales Invoice",
            invoice,
            [
                "posa_rt_table",
                "posa_rt_table_order",
                "posa_rt_waiter",
                "posa_rt_tab_name",
                "posa_rt_guest_count",
                "posa_rt_service_type",
            ],
            as_dict=True,
        )
        self.assertEqual(stamps["posa_rt_table"], self.table_a)
        self.assertEqual(stamps["posa_rt_table_order"], order)
        self.assertEqual(stamps["posa_rt_waiter"], frappe.session.user)
        self.assertEqual(stamps["posa_rt_tab_name"], "Marco")
        self.assertEqual(stamps["posa_rt_guest_count"], 2)
        self.assertEqual(stamps["posa_rt_service_type"], "Dine In")

    def test_settle_takes_its_lines_from_the_order_not_the_payload(self):
        order = self._order(qty=2, rate=25)

        invoice = settle.settle_table_order(
            order,
            client_request_id=uid("tbl-req"),
            invoice_payload=json.dumps(
                {
                    "customer": self.customer,
                    # A crafted payload trying to bill one cheap line instead.
                    "items": [{"item_code": self.item, "qty": 1, "rate": 1}],
                    "payments": [{"mode_of_payment": self.mode_of_payment, "amount": 50}],
                }
            ),
        )["sales_invoice"]
        self._tracked.insert(0, ("Sales Invoice", invoice))

        lines = frappe.get_all(
            "Sales Invoice Item", filters={"parent": invoice}, fields=["item_code", "qty", "rate"]
        )
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["qty"], 2)
        self.assertEqual(lines[0]["rate"], 25)

    def test_settle_links_the_invoice_and_frees_the_table_for_bussing(self):
        order = self._order()

        result = self._settle(order)

        self.assertEqual(
            frappe.db.get_value("POS Table Order", order, "settled_invoice"),
            result["sales_invoice"],
        )
        self.assertEqual(frappe.db.get_value("POS Table Order", order, "status"), "Settled")
        self.assertEqual(
            frappe.db.get_value("POS Table", self.table_a, "occupied"), 0,
            "a settled order no longer counts, so the table is free",
        )
        self.assertEqual(frappe.db.get_value("POS Table", self.table_a, "needs_cleaning"), 1)

    # -- the Dynamic Link pair --------------------------------------------

    def test_settle_records_the_doctype_the_path_actually_created(self):
        """A plain Link to Sales Invoice would be a dangling reference on a
        register running create_pos_invoice_instead_of_sales_invoice."""
        order = self._order()

        result = self._settle(order)

        stored = frappe.db.get_value(
            "POS Table Order", order, ["settled_doctype", "settled_invoice"], as_dict=True
        )
        self.assertIn(stored["settled_doctype"], ("Sales Invoice", "POS Invoice"))
        self.assertEqual(stored["settled_invoice"], result["sales_invoice"])
        self.assertEqual(
            stored["settled_doctype"],
            result["invoice_result"]["doctype"],
            "the stored doctype comes from what the submit path built, not a profile re-read",
        )
        self.assertTrue(
            frappe.db.exists(stored["settled_doctype"], stored["settled_invoice"]),
            "the Dynamic Link must resolve to a real document",
        )

    def test_a_settled_order_survives_a_desk_re_save(self):
        """The whole point of the Dynamic Link: link validation runs on save,
        and a POS-Invoice name in a Sales-Invoice Link field would fail it."""
        order = self._order()
        self._settle(order)

        doc = frappe.get_doc("POS Table Order", order)
        doc.save(ignore_permissions=True)  # must not raise LinkValidationError

        self.assertEqual(doc.status, "Settled")
        self.assertTrue(doc.settled_invoice)

    def test_an_unknown_settled_doctype_is_rejected(self):
        order = self._order()

        doc = frappe.get_doc("POS Table Order", order)
        doc.settled_doctype = "Purchase Invoice"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_a_settled_invoice_without_its_doctype_is_rejected(self):
        order = self._order()

        doc = frappe.get_doc("POS Table Order", order)
        doc.settled_invoice = "ACC-SINV-9999"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_the_wire_name_stays_sales_invoice_on_the_order_payload(self):
        """orders.order_payload is FROZEN too — the frontend never learns the
        stored column changed."""
        from posawesome.posawesome.api.restaurant import orders

        order = self._order()
        result = self._settle(order)

        payload = orders.get_table_order(order)
        self.assertEqual(payload["sales_invoice"], result["sales_invoice"])

    # -- idempotency -------------------------------------------------------

    def test_double_settle_returns_the_first_invoice(self):
        order = self._order()
        first = self._settle(order)

        second = settle.settle_table_order(
            order,
            client_request_id=uid("tbl-req"),
            invoice_payload=self._payload(50),
        )

        self.assertEqual(second["sales_invoice"], first["sales_invoice"], "never sell the food twice")
        self.assertTrue(second["idempotent"])

    def test_a_settling_order_with_an_invoice_resolves_to_it(self):
        """The lost-ack case: the invoice landed, the response did not."""
        order = self._order()
        invoice = self._settle(order)["sales_invoice"]
        frappe.db.set_value("POS Table Order", order, "status", "Settling")

        result = settle.settle_table_order(
            order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(50)
        )

        self.assertTrue(result["idempotent"])
        self.assertEqual(result["sales_invoice"], invoice)

    def test_settlement_state_is_readable_for_recovery(self):
        order = self._order()
        invoice = self._settle(order)["sales_invoice"]

        state = settle.get_settlement_state(order)

        self.assertEqual(state["status"], "Settled")
        self.assertEqual(state["sales_invoice"], invoice)
        self.assertIn(state["target_doctype"], ("Sales Invoice", "POS Invoice"))

    # -- failure -----------------------------------------------------------

    def test_a_failed_settle_reverts_the_order_to_open(self):
        order = self._order()

        with mock.patch.object(
            creation, "submit_invoice", side_effect=frappe.ValidationError("boom")
        ):
            with self.assertRaises(frappe.ValidationError):
                settle.settle_table_order(
                    order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(50)
                )

        self.assertEqual(
            frappe.db.get_value("POS Table Order", order, "status"), "Open",
            "a stuck Settling ticket is a table nobody can bill",
        )
        self.assertFalse(frappe.db.get_value("POS Table Order", order, "settled_invoice"))

    def test_a_submit_returning_no_invoice_reverts_too(self):
        order = self._order()

        with mock.patch.object(creation, "submit_invoice", return_value={}):
            with self.assertRaises(frappe.ValidationError):
                settle.settle_table_order(
                    order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(50)
                )

        self.assertEqual(frappe.db.get_value("POS Table Order", order, "status"), "Open")

    def test_settling_an_empty_order_throws(self):
        order = self.make_order(table=self.table_a, lines=[])

        with self.assertRaises(frappe.ValidationError):
            settle.settle_table_order(
                order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(0)
            )

    def test_settling_a_cancelled_order_throws(self):
        order = self._order()
        frappe.db.set_value("POS Table Order", order, "status", "Cancelled")

        with self.assertRaises(frappe.ValidationError):
            settle.settle_table_order(
                order, client_request_id=uid("tbl-req"), invoice_payload=self._payload(50)
            )

    def test_a_malformed_payload_throws_before_the_ledger_is_touched(self):
        order = self._order()

        with self.assertRaises(frappe.ValidationError):
            settle.settle_table_order(
                order, client_request_id=uid("tbl-req"), invoice_payload="{not json"
            )

        self.assertEqual(frappe.db.get_value("POS Table Order", order, "status"), "Open")


if __name__ == "__main__":
    unittest.main()
