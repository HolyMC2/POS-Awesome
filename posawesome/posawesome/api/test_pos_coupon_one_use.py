"""POS Coupon `one_use` limits reuse of that coupon, not coupon use in general.

A customer can hold one Gift Card per offer. Redeeming one of them must not
block the others, and an unapplied row (the register attaches every active
gift card to the customer's sale) is not a use.

Run standalone: python3 posawesome/posawesome/api/test_pos_coupon_one_use.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import types
import unittest
from unittest import mock

_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)


def _utils_stub():
    module = types.ModuleType("frappe.utils")
    module.strip = lambda value: (value or "").strip()
    module.getdate = _isolated._getdate
    module.today = lambda: "2026-09-13"
    return module


def _document_stub():
    module = types.ModuleType("frappe.model.document")
    module.Document = type("Document", (), {})
    return module


coupons = _isolated.load_api_module(
    "posawesome_pos_coupon_one_use",
    "../doctype/pos_coupon/pos_coupon.py",
    extra={
        "frappe.utils": _utils_stub(),
        "frappe.model": types.ModuleType("frappe.model"),
        "frappe.model.document": _document_stub(),
    },
)


def _coupon(name, **values):
    row = {
        "name": name,
        "coupon_code": name,
        "coupon_type": "Gift Card",
        "customer": "CUST-1",
        "company": "Grupo Doco",
        "pos_offer": f"Offer {name}",
        "valid_from": None,
        "valid_upto": None,
        "maximum_use": 1,
        "used": 0,
        "one_use": 1,
    }
    row.update(values)
    return types.SimpleNamespace(**row)


class _FakeFrappe(types.SimpleNamespace):
    """Answers `check_coupon_code`'s reads from an in-memory coupon table."""

    def __init__(self, coupon_rows, detail_rows):
        by_code = {row.coupon_code: row for row in coupon_rows}
        offers = {
            row.pos_offer: types.SimpleNamespace(disable=0, valid_from=None, valid_upto=None)
            for row in coupon_rows
        }

        def count(doctype, filters=None):
            assert doctype == "POS Coupon Detail"
            return sum(
                all(row.get(key) == value for key, value in (filters or {}).items())
                for row in detail_rows
            )

        def get_doc(doctype, name):
            if doctype == "POS Coupon":
                return by_code[name["coupon_code"]]
            return offers[name]

        super().__init__(
            db=types.SimpleNamespace(
                exists=lambda doctype, filters: filters["coupon_code"] in by_code,
                count=count,
            ),
            get_doc=get_doc,
            throw=lambda message: (_ for _ in ()).throw(Exception(message)),
        )


def _submitted_row(coupon, applied, customer="CUST-1"):
    return {
        "parentfield": "posa_coupons",
        "parenttype": "Sales Invoice",
        "docstatus": 1,
        "customer": customer,
        "coupon": coupon,
        "coupon_code": coupon,
        "applied": applied,
    }


class OneUseTests(unittest.TestCase):
    def check(self, code, detail_rows, customer="CUST-1", coupon_rows=None):
        coupon_rows = coupon_rows or [_coupon("GC-A"), _coupon("GC-B")]
        with mock.patch.object(coupons, "frappe", _FakeFrappe(coupon_rows, detail_rows)):
            return coupons.check_coupon_code(code, customer, "Grupo Doco")

    def test_second_gift_card_is_usable_after_the_first_was_redeemed(self):
        # The first sale redeemed GC-A and carried GC-B unapplied.
        history = [_submitted_row("GC-A", applied=1), _submitted_row("GC-B", applied=0)]
        result = self.check("GC-B", history)
        self.assertEqual(result["msg"], "Apply")
        self.assertEqual(result["coupon"].name, "GC-B")

    def test_the_redeemed_coupon_itself_is_still_blocked(self):
        history = [_submitted_row("GC-A", applied=1)]
        result = self.check("GC-A", history)
        self.assertIsNone(result["coupon"])
        self.assertIn("have used this coupon before", result["msg"])

    def test_draft_or_cancelled_sales_are_not_a_use(self):
        draft = dict(_submitted_row("GC-A", applied=1), docstatus=0)
        cancelled = dict(_submitted_row("GC-A", applied=1), docstatus=2)
        self.assertEqual(self.check("GC-A", [draft, cancelled])["msg"], "Apply")

    def test_promotional_one_use_is_per_customer(self):
        promo = _coupon("PROMO", coupon_type="Promotional", customer=None, maximum_use=0)
        history = [_submitted_row("PROMO", applied=1, customer="CUST-1")]
        self.assertEqual(
            self.check("PROMO", history, customer="CUST-2", coupon_rows=[promo])["msg"], "Apply"
        )
        self.assertIsNone(self.check("PROMO", history, customer="CUST-1", coupon_rows=[promo])["coupon"])


class _Row(dict):
    __getattr__ = dict.get


class RedeemedRowsTests(unittest.TestCase):
    """Which coupon rows a sale consumes when it is submitted."""

    def redeemed(self, sale, lookup=None):
        fake = types.SimpleNamespace(
            db=types.SimpleNamespace(get_value=lambda doctype, name, field: (lookup or {}).get(name))
        )
        with mock.patch.object(coupons, "frappe", fake):
            return [row["coupon"] for row in coupons.redeemed_coupon_rows(_Row(sale))]

    def sale(self, coupons_rows, items=None, offers=None):
        return {
            "posa_coupons": [_Row(row) for row in coupons_rows],
            "items": [_Row(item) for item in (items or [])],
            "posa_offers": [_Row(offer) for offer in (offers or [])],
        }

    def test_a_client_flagged_row_is_redeemed(self):
        sale = self.sale([{"coupon": "GC-A", "pos_offer": "Mica", "applied": 1}])
        self.assertEqual(self.redeemed(sale), ["GC-A"])

    def test_a_line_carrying_the_offer_redeems_an_unflagged_row(self):
        # What the lab register saved: applied stayed 0, the purchase line
        # carried the gift offer in its posa_offers JSON.
        sale = self.sale(
            [{"coupon": "GC-B", "pos_offer": "Funda", "applied": 0},
             {"coupon": "GC-A", "pos_offer": "Mica", "applied": 0}],
            items=[{"item_code": "IT-2", "posa_offers": '["Mica"]'}, {"item_code": "IT-1", "posa_offers": None}],
        )
        self.assertEqual(self.redeemed(sale), ["GC-A"])

    def test_an_applied_offer_row_redeems_its_coupon(self):
        sale = self.sale(
            [{"coupon": "GC-A", "pos_offer": "Mica", "applied": 0}],
            offers=[{"offer_name": "Mica", "row_id": "Mica", "offer_applied": 1}],
        )
        self.assertEqual(self.redeemed(sale), ["GC-A"])

    def test_an_offer_row_that_was_not_applied_redeems_nothing(self):
        sale = self.sale(
            [{"coupon": "GC-A", "pos_offer": "Mica", "applied": 0}],
            offers=[{"offer_name": "Mica", "row_id": "Mica", "offer_applied": 0}],
        )
        self.assertEqual(self.redeemed(sale), [])

    def test_attached_gift_cards_without_their_offer_stay_unredeemed(self):
        sale = self.sale(
            [{"coupon": "GC-A", "pos_offer": "Mica", "applied": 0}],
            items=[{"item_code": "IT-2", "posa_offers": "[]"}, {"item_code": "IT-3", "posa_offers": "not json"}],
        )
        self.assertEqual(self.redeemed(sale), [])

    def test_a_row_without_its_offer_reads_it_from_the_coupon(self):
        sale = self.sale(
            [{"coupon": "GC-A", "pos_offer": None, "applied": 0}],
            items=[{"item_code": "IT-2", "posa_offers": ["Mica"]}],
        )
        self.assertEqual(self.redeemed(sale, lookup={"GC-A": "Mica"}), ["GC-A"])


if __name__ == "__main__":
    unittest.main()
