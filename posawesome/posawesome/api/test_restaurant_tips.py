"""Restaurant settle tips: accounting line, provenance and replay safety."""

from __future__ import annotations

import json
import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from posawesome.posawesome.api.restaurant import settle
from posawesome.posawesome.api.restaurant.tips import _tip_item_docname
from posawesome.posawesome.api.test_restaurant_support import RestaurantTestCase, uid


class TestRestaurantTips(RestaurantTestCase):
    def setUp(self):
        super().setUp()
        if not frappe.db.has_column("Sales Invoice", "posa_rt_tip_amount"):
            self.skipTest("posa_rt_tip_amount custom field not migrated yet")
        self.mode_of_payment = (
            frappe.db.get_value("Mode of Payment", {"enabled": 1, "type": "Cash"}, "name")
            or frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name")
        )

    def _order(self):
        return self.make_order(
            table=self.table_a,
            lines=[self.line(qty=2, rate=25)],
            customer=self.customer,
        )

    def _payload(self, amount):
        return json.dumps(
            {
                "customer": self.customer,
                "payments": [{"mode_of_payment": self.mode_of_payment, "amount": amount}],
            }
        )

    def _settle(self, order, tip_amount=0, payment=50, request_id=None):
        result = settle.settle_table_order(
            order,
            client_request_id=request_id or uid("tip-settle"),
            invoice_payload=self._payload(payment),
            tip_amount=tip_amount,
        )
        if result.get("sales_invoice"):
            self._tracked.insert(0, ("Sales Invoice", result["sales_invoice"]))
        return result

    def test_tip_is_an_invoice_line_and_provenance_stamp(self):
        invoice = self._settle(self._order(), tip_amount=10, payment=60)["sales_invoice"]

        # doco names Items by IPN series — the line links the DOCNAME, never
        # the literal item_code (see tips._tip_item_docname).
        line = frappe.db.get_value(
            "Sales Invoice Item",
            {"parent": invoice, "item_code": _tip_item_docname()},
            ["qty", "rate"],
            as_dict=True,
        )
        self.assertEqual(line.qty, 1)
        self.assertEqual(line.rate, 10)
        self.assertEqual(
            frappe.db.get_value("Sales Invoice", invoice, "posa_rt_tip_amount"), 10
        )

    def test_zero_or_absent_tip_adds_no_line_and_keeps_stamp_null(self):
        invoice = self._settle(self._order())["sales_invoice"]

        tip_docname = _tip_item_docname()
        if tip_docname:
            self.assertFalse(
                frappe.db.exists(
                    "Sales Invoice Item", {"parent": invoice, "item_code": tip_docname}
                )
            )
        # Currency custom fields materialise as 0.0, not NULL — "no tip" is
        # falsy, not None.
        self.assertFalse(
            frappe.utils.flt(
                frappe.db.get_value("Sales Invoice", invoice, "posa_rt_tip_amount")
            )
        )

    def test_tip_cap_violation_leaves_order_open(self):
        order = self._order()

        with self.assertRaises(frappe.ValidationError):
            self._settle(order, tip_amount=101, payment=151)

        self.assertEqual(frappe.db.get_value("POS Table Order", order, "status"), "Open")

    def test_payments_must_cover_total_including_tip(self):
        order = self._order()

        with self.assertRaises(frappe.ValidationError):
            self._settle(order, tip_amount=10, payment=50)

        self.assertEqual(frappe.db.get_value("POS Table Order", order, "status"), "Open")

    def test_replay_returns_one_invoice_with_one_tip_line(self):
        order = self._order()
        request_id = uid("tip-replay")
        first = self._settle(order, tip_amount=10, payment=60, request_id=request_id)

        replay = settle.settle_table_order(
            order,
            client_request_id=request_id,
            invoice_payload=self._payload(60),
            tip_amount=99,
        )

        self.assertTrue(replay["idempotent"])
        self.assertEqual(replay["sales_invoice"], first["sales_invoice"])
        self.assertEqual(
            frappe.db.count(
                "Sales Invoice Item",
                {"parent": first["sales_invoice"], "item_code": _tip_item_docname()},
            ),
            1,
        )


if __name__ == "__main__":
    unittest.main()
