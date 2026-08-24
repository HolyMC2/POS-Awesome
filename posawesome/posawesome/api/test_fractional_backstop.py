"""The server's refusal of a fractional qty on a whole-number UOM.

Venta fraccionada's client-side affordances (the decimal pad, «$ Importe»,
scale labels) are gated on `UOM.must_be_whole_number` reaching the SPA. That
gate is a convenience: it puts the refusal where the cashier can still fix it.
The refusal ITSELF is ERPNext's, at `Sales Invoice.validate` via
`validate_uom_is_integer`, and it is what a raw payload — a replayed offline
invoice, a hand-rolled call, a bug in the pad — actually runs into.

The golden flow (§5.4) asks for that to be proven rather than assumed, and for
the fork to be checked for a path around it. It is proven here.
"""

import unittest

# Bench-only integration test: needs a real frappe + site. Skip the module
# when discovered by the standalone stub-suite runner, where frappe is not
# importable.
try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from erpnext.utilities.transaction_base import UOMMustBeIntegerError
from frappe.tests import IntegrationTestCase

TEST_GROUP = "POSA Fraccionada Tests"
WHOLE_UOM = "_POSA Whole Test UOM"
FRACTIONAL_UOM = "_POSA Fractional Test UOM"
WHOLE_ITEM = "_POSA-FRACC-PIEZA"
FRACTIONAL_ITEM = "_POSA-FRACC-GRANEL"


def _ensure_uom(name, must_be_whole_number):
    if not frappe.db.exists("UOM", name):
        frappe.get_doc(
            {
                "doctype": "UOM",
                "uom_name": name,
                "must_be_whole_number": must_be_whole_number,
            }
        ).insert(ignore_permissions=True)
    else:
        frappe.db.set_value("UOM", name, "must_be_whole_number", must_be_whole_number)


def _ensure_item(item_code, stock_uom):
    if frappe.db.exists("Item", item_code):
        return
    frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_code,
            "item_group": TEST_GROUP,
            "stock_uom": stock_uom,
            "is_stock_item": 0,
            "is_sales_item": 1,
        }
    ).insert(ignore_permissions=True)


class TestFractionalQtyBackstop(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not frappe.db.exists("Item Group", TEST_GROUP):
            frappe.get_doc(
                {
                    "doctype": "Item Group",
                    "item_group_name": TEST_GROUP,
                    "parent_item_group": "All Item Groups",
                    "is_group": 0,
                }
            ).insert(ignore_permissions=True)
        # Own UOMs rather than borrowing Nos/Kg: a mirror's UOM flags are shop
        # data and a test that flips them would change how that shop sells.
        _ensure_uom(WHOLE_UOM, 1)
        _ensure_uom(FRACTIONAL_UOM, 0)
        _ensure_item(WHOLE_ITEM, WHOLE_UOM)
        _ensure_item(FRACTIONAL_ITEM, FRACTIONAL_UOM)
        frappe.db.commit()

    def _invoice(self, item_code, qty, uom):
        doc = frappe.new_doc("Sales Invoice")
        doc.customer = frappe.get_all("Customer", limit=1, pluck="name")[0]
        doc.company = frappe.get_all("Company", limit=1, pluck="name")[0]
        doc.append(
            "items",
            {
                "item_code": item_code,
                "qty": qty,
                "rate": 160,
                "uom": uom,
                "conversion_factor": 1,
            },
        )
        return doc

    def tearDown(self):
        frappe.db.rollback()

    def test_whole_number_uom_refuses_a_fraction(self):
        doc = self._invoice(WHOLE_ITEM, 0.5, WHOLE_UOM)

        with self.assertRaises(UOMMustBeIntegerError):
            doc.insert(ignore_permissions=True)

    def test_the_refusal_lands_at_save_not_only_at_submit(self):
        """A held draft can never carry a fraction it will fail on at Pay.

        `insert` — not `submit` — is what raises above, because
        `validate_uom_is_integer` runs in `Sales Invoice.validate`. That is
        what makes it a backstop worth relying on: a hold-until-confirm draft,
        an offline invoice replayed hours later and a Desk edit all pass
        through the same door.
        """
        doc = self._invoice(WHOLE_ITEM, 0.25, WHOLE_UOM)

        with self.assertRaises(UOMMustBeIntegerError):
            doc.insert(ignore_permissions=True)
        self.assertIsNone(doc.get("name") and frappe.db.exists("Sales Invoice", doc.name))

    def test_a_fraction_below_the_site_precision_rounds_away_before_the_check(self):
        """1.001 pieces is accepted as 1 on a precision-2 site — silently.

        The stored Float is rounded to `float_precision` first, so the integer
        check sees a whole number and passes. Nobody is mis-charged (the qty
        really is 1), but it means the server's refusal has the site's
        granularity, not infinite resolution — one more reason the register
        quantizes a measured qty to the precision it is going to keep instead
        of forwarding whatever the scale or the label said.
        """
        precision = int(frappe.db.get_single_value("System Settings", "float_precision") or 3)
        below = 1 + (10 ** -(precision + 1))

        doc = self._invoice(WHOLE_ITEM, below, WHOLE_UOM)
        doc.insert(ignore_permissions=True)

        self.assertEqual(doc.items[0].qty, 1)

    def test_whole_number_uom_still_takes_whole_quantities(self):
        doc = self._invoice(WHOLE_ITEM, 3, WHOLE_UOM)
        doc.insert(ignore_permissions=True)

        self.assertEqual(doc.items[0].qty, 3)

    def test_fractional_uom_accepts_a_decimal_qty(self):
        doc = self._invoice(FRACTIONAL_ITEM, 0.5, FRACTIONAL_UOM)
        doc.insert(ignore_permissions=True)

        self.assertEqual(doc.items[0].qty, 0.5)
        self.assertEqual(doc.items[0].amount, 80)

    def test_the_site_keeps_only_float_precision_decimals_of_qty(self):
        """The precision the register may promise is the site's, not three.

        `qty` is a plain Float with no field-level precision, so it is stored
        at System Settings' `float_precision`. On a site set to 2 — which the
        doco mirror is — a line saved as 0.312 kg comes back 0.31 kg and
        charges $49.60, not the $49.92 the golden flow quotes.

        This is why `qtyPrecisionForUom` takes the register's precision rather
        than defaulting to 3: a register that offered a third decimal here
        would print a weight and a total on the customer's ticket that the
        invoice does not contain. Venta fraccionada to the gram needs the site
        set to 3 (or the profile's `posa_decimal_precision`), and where it is
        not, the pad and the «se cobran» sentence must both say 0.31.
        """
        precision = int(frappe.db.get_single_value("System Settings", "float_precision") or 3)

        doc = self._invoice(FRACTIONAL_ITEM, 0.312, FRACTIONAL_UOM)
        doc.insert(ignore_permissions=True)

        self.assertEqual(doc.items[0].qty, round(0.312, precision))
        self.assertEqual(doc.items[0].amount, round(round(0.312, precision) * 160, 2))

    def test_the_fork_adds_no_way_around_it(self):
        # The refusal lives in Sales Invoice.validate. The fork submits through
        # `invoice_doc.submit()` (invoice_processing/creation.py) with no
        # `ignore_validate` anywhere in the app, so there is no second door —
        # asserted here so that adding one fails a test rather than a shift.
        import pathlib

        app_root = pathlib.Path(frappe.get_app_path("posawesome"))
        offenders = [
            str(path.relative_to(app_root))
            for path in app_root.rglob("*.py")
            if "ignore_validate" in path.read_text(errors="ignore")
            and not path.name.startswith("test_")
        ]

        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
