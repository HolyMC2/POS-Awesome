"""Submitting a sale redeems the coupons whose offer it carries.

`invoice.update_coupon` runs before submit and before cancel. On submit it
redeems the rows `redeemed_coupon_rows` selects, persists their `applied` flag
(one_use and cancellation read it) and counts the use; on cancel it releases
only rows that were saved as applied.

Run standalone: python3 posawesome/posawesome/api/test_invoice_coupon_redemption.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

_HERE = pathlib.Path(__file__).resolve().parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hooks_harness = _load("posawesome_invoice_hooks_harness", _HERE / "test_invoice_cancel_hooks.py")
_isolated = _load("posawesome_isolated_module", _HERE / "test_support" / "isolated_module.py")


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


real_coupons = _isolated.load_api_module(
    "posawesome_pos_coupon_redemption",
    "../doctype/pos_coupon/pos_coupon.py",
    extra={
        "frappe.utils": _utils_stub(),
        "frappe.model": types.ModuleType("frappe.model"),
        "frappe.model.document": _document_stub(),
    },
)


class _Record(dict):
    """A document or child row: attribute reads and writes share the dict."""

    __getattr__ = dict.get

    def __setattr__(self, key, value):
        self[key] = value


@unittest.skipIf(hooks_harness._UNDER_BENCH, "standalone stub test - run with python3 directly")
class UpdateCouponTests(unittest.TestCase):
    def setUp(self):
        hooks_harness._install_invoice_api_stubs()
        self.counted = []
        stub = sys.modules["posawesome.posawesome.doctype.pos_coupon.pos_coupon"]
        stub.update_coupon_code_count = lambda name, kind: self.counted.append((name, kind))
        stub.redeemed_coupon_rows = real_coupons.redeemed_coupon_rows
        self.invoice = hooks_harness._load_invoice_api_module()

    def sale(self, rows, carried):
        return _Record(
            posa_coupons=[_Record(row) for row in rows],
            items=[_Record(item_code="IT-2", posa_offers=carried), _Record(item_code="IT-1", posa_offers=None)],
            posa_offers=[],
        )

    def test_submit_redeems_the_coupon_whose_offer_the_sale_carries(self):
        sale = self.sale(
            [{"coupon": "GC-Funda", "pos_offer": "Funda", "applied": 0},
             {"coupon": "GC-Mica", "pos_offer": "Mica", "applied": 0}],
            carried='["Mica"]',
        )
        self.invoice.update_coupon(sale, "used")
        self.assertEqual(self.counted, [("GC-Mica", "used")])
        self.assertEqual([row.applied for row in sale.posa_coupons], [0, 1])

    def test_cancel_releases_only_rows_saved_as_applied(self):
        sale = self.sale(
            [{"coupon": "GC-Funda", "pos_offer": "Funda", "applied": 0},
             {"coupon": "GC-Mica", "pos_offer": "Mica", "applied": 1}],
            carried='["Funda", "Mica"]',
        )
        self.invoice.update_coupon(sale, "cancelled")
        self.assertEqual(self.counted, [("GC-Mica", "cancelled")])
        self.assertEqual([row.applied for row in sale.posa_coupons], [0, 1])


@unittest.skipIf(hooks_harness._UNDER_BENCH, "standalone stub test - run with python3 directly")
class ReturnCouponTests(unittest.TestCase):
    """A return copies the sale's coupon rows; it is never a use of the coupon."""

    def setUp(self):
        hooks_harness._install_invoice_api_stubs()
        self.counted = []
        stub = sys.modules["posawesome.posawesome.doctype.pos_coupon.pos_coupon"]
        stub.update_coupon_code_count = lambda name, kind: self.counted.append((name, kind))
        stub.redeemed_coupon_rows = real_coupons.redeemed_coupon_rows
        self.invoice = hooks_harness._load_invoice_api_module()

    def pos_return(self):
        # What the POS return builder and make_sales_return both copy from a
        # gift-card sale: the coupon row as applied and the offer on the line.
        return _Record(
            is_return=1,
            return_against="ACC-SINV-GIFT",
            posa_coupons=[_Record(coupon="GC-Mica", pos_offer="Mica", applied=1)],
            items=[_Record(item_code="IT-2", qty=-1, posa_offers='["Mica"]'),
                   _Record(item_code="IT-1", qty=-1, posa_offers=None)],
            posa_offers=[],
        )

    def desk_credit_note(self):
        note = self.pos_return()
        note.posa_offers = [_Record(offer_name="Mica", row_id="Mica", offer_applied=1)]
        return note

    def test_submitting_a_pos_return_counts_no_use_and_clears_the_copied_flag(self):
        note = self.pos_return()
        self.invoice.update_coupon(note, "used")
        self.assertEqual(self.counted, [])
        self.assertEqual([row.applied for row in note.posa_coupons], [0])

    def test_submitting_a_desk_credit_note_counts_no_use(self):
        note = self.desk_credit_note()
        self.invoice.update_coupon(note, "used")
        self.assertEqual(self.counted, [])
        self.assertEqual([row.applied for row in note.posa_coupons], [0])

    def test_cancelling_a_return_releases_no_use(self):
        note = self.desk_credit_note()
        self.invoice.update_coupon(note, "cancelled")
        self.assertEqual(self.counted, [])

    def test_cancelling_the_original_sale_still_releases_its_use(self):
        sale = _Record(is_return=0, posa_coupons=[_Record(coupon="GC-Mica", pos_offer="Mica", applied=1)],
                       items=[_Record(item_code="IT-2", posa_offers='["Mica"]')], posa_offers=[])
        self.invoice.update_coupon(sale, "cancelled")
        self.assertEqual(self.counted, [("GC-Mica", "cancelled")])


if __name__ == "__main__":
    unittest.main()
