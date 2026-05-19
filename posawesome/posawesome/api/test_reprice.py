"""Unit tests for posawesome.posawesome.api._reprice.

Same stub-frappe pattern as test_scope.py. Run standalone:
    cd posawesome/api && python3 test_reprice.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


class _PermissionError(Exception):
    pass


class _ValidationError(Exception):
    pass


def _build_frappe_module(scenario: dict) -> types.ModuleType:
    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.PermissionError = _PermissionError
    frappe_module.ValidationError = _ValidationError

    def _throw(message, exc_type=Exception):
        if isinstance(exc_type, type) and issubclass(exc_type, Exception):
            raise exc_type(message)
        raise Exception(message)

    frappe_module.throw = _throw
    frappe_module.whitelist = lambda *a, **kw: (lambda fn: fn)

    class _Db:
        def get_value(self, doctype, filters, fieldname=None, order_by=None):
            if doctype == "Item" and fieldname == "max_discount":
                return scenario.get("item_max_discount", {}).get(filters)
            if doctype == "Item Price":
                if isinstance(filters, dict):
                    item_code = filters.get("item_code")
                    price_list = filters.get("price_list")
                    rates = scenario.get("item_prices", {})
                    return rates.get((item_code, price_list))
            return None

    frappe_module.db = _Db()

    utils_module = types.ModuleType("frappe.utils")
    utils_module.flt = lambda v, *a: float(v or 0)
    frappe_module.utils = utils_module
    sys.modules["frappe.utils"] = utils_module

    return frappe_module


def _install_pkg_stubs():
    posawesome_pkg = types.ModuleType("posawesome")
    posawesome_pkg.__path__ = [str(REPO_ROOT / "posawesome")]
    sys.modules.setdefault("posawesome", posawesome_pkg)
    posawesome_inner = types.ModuleType("posawesome.posawesome")
    posawesome_inner.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome")]
    sys.modules.setdefault("posawesome.posawesome", posawesome_inner)
    api_pkg = types.ModuleType("posawesome.posawesome.api")
    api_pkg.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome" / "api")]
    sys.modules.setdefault("posawesome.posawesome.api", api_pkg)


def _import_reprice(scenario: dict):
    _install_pkg_stubs()
    sys.modules["frappe"] = _build_frappe_module(scenario)
    sys.modules.pop("posawesome.posawesome.api._reprice", None)
    spec = importlib.util.spec_from_file_location(
        "posawesome.posawesome.api._reprice",
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "_reprice.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["posawesome.posawesome.api._reprice"] = module
    assert spec.loader
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# scenarios
# ---------------------------------------------------------------------------


def _basic_scenario():
    return {
        "item_max_discount": {"IT-1": 10, "IT-2": 0, "IT-3": None},
        "item_prices": {
            ("IT-1", "Doco"): 100.00,
            ("IT-2", "Doco"): 50.00,
        },
    }


# ---------------------------------------------------------------------------
# discount cap
# ---------------------------------------------------------------------------


class DiscountCapTests(unittest.TestCase):
    def test_under_cap_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "discount_percentage": 5}]}
        rp.enforce_discount_limit(invoice, profile_doc=None)  # no raise

    def test_over_item_cap_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "discount_percentage": 15}]}
        with self.assertRaises(_PermissionError):
            rp.enforce_discount_limit(invoice, profile_doc=None)

    def test_profile_cap_tighter_wins(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "discount_percentage": 8}]}
        # Item cap 10, profile cap 5 → effective 5; 8 should raise.
        with self.assertRaises(_PermissionError):
            rp.enforce_discount_limit(invoice, profile_doc={"posa_max_discount_allowed": 5})

    def test_no_cap_either_side_skips(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-3", "discount_percentage": 90}]}
        rp.enforce_discount_limit(invoice, profile_doc=None)  # no raise

    def test_zero_discount_skips(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "discount_percentage": 0}]}
        rp.enforce_discount_limit(invoice, profile_doc={"posa_max_discount_allowed": 5})


# ---------------------------------------------------------------------------
# payment-vs-total
# ---------------------------------------------------------------------------


class PaymentTotalsTests(unittest.TestCase):
    def test_match_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 100.00,
            "is_pos": 1,
            "payments": [{"amount": 100.00}],
        }
        rp.assert_payments_match_grand_total(invoice)

    def test_mismatch_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 100.00,
            "is_pos": 1,
            "payments": [{"amount": 50.00}],
        }
        with self.assertRaises(_ValidationError):
            rp.assert_payments_match_grand_total(invoice)

    def test_zero_payment_for_pos_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 100.00,
            "is_pos": 1,
            "payments": [{"amount": 0}],
        }
        with self.assertRaises(_ValidationError):
            rp.assert_payments_match_grand_total(invoice)

    def test_split_payments_sum_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 100.00,
            "is_pos": 1,
            "payments": [{"amount": 60.00}, {"amount": 40.00}],
        }
        rp.assert_payments_match_grand_total(invoice)

    def test_non_pos_no_payments_skips(self):
        rp = _import_reprice(_basic_scenario())
        # Non-POS Sales Invoice may have empty payments — outstanding tracks debt.
        invoice = {"grand_total": 100.00, "is_pos": 0, "payments": []}
        rp.assert_payments_match_grand_total(invoice)

    def test_rounded_total_takes_priority(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 99.99,
            "rounded_total": 100.00,
            "is_pos": 1,
            "payments": [{"amount": 100.00}],
        }
        rp.assert_payments_match_grand_total(invoice)


# ---------------------------------------------------------------------------
# rate band
# ---------------------------------------------------------------------------


class RateBandTests(unittest.TestCase):
    def test_no_edit_must_match_price_list(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "items": [{"idx": 1, "item_code": "IT-1", "rate": 100.00}],
        }
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_tamper_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "items": [{"idx": 1, "item_code": "IT-1", "rate": 1.00}],  # tampered $1
        }
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)

    def test_edit_within_band_passes(self):
        rp = _import_reprice(_basic_scenario())
        # Item Price 100; 90 is within ±20% (range 80..120)
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 90.00}]}
        profile = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile)

    def test_edit_outside_band_raises(self):
        rp = _import_reprice(_basic_scenario())
        # Item Price 100; 70 is outside ±20%
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 70.00}]}
        profile = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)

    def test_no_price_list_skips(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 1.00}]}
        rp.assert_rates_within_band(invoice, profile_doc={})  # no list → skip

    def test_unknown_item_skips(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "NEW-ITEM", "rate": 1.00}]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile)  # no master → skip

    def test_custom_band(self):
        rp = _import_reprice(_basic_scenario())
        # Item Price 100; 95 is within ±5% (range 95..105)
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 95.00}]}
        profile = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile, band_pct=5)
        # 90 is outside ±5%
        invoice["items"][0]["rate"] = 90.00
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile, band_pct=5)


if __name__ == "__main__":
    unittest.main()
