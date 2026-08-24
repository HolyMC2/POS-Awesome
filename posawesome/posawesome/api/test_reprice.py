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
            if doctype == "Item" and fieldname == "posa_skip_rate_band":
                if scenario.get("skip_flag_unreadable"):
                    raise RuntimeError("Unknown column 'posa_skip_rate_band'")
                return scenario.get("item_skip_band", {}).get(filters)
            if doctype == "Item" and fieldname == "item_group":
                return scenario.get("item_group", {}).get(filters)
            if doctype == "Item Group" and fieldname == "posa_skip_rate_band":
                return scenario.get("group_skip_band", {}).get(filters)
            if doctype == "Item Price":
                if isinstance(filters, dict):
                    item_code = filters.get("item_code")
                    price_list = filters.get("price_list")
                    rates = scenario.get("item_prices", {})
                    return rates.get((item_code, price_list))
            return None

    frappe_module.db = _Db()

    def _get_all(doctype, filters=None, fields=None, **kwargs):
        if doctype == "Item":
            return scenario.get("item_meta", [])
        return []

    frappe_module.get_all = _get_all
    frappe_module.log_error = lambda *a, **k: None
    frappe_module.get_traceback = lambda: ""

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


def _install_offers_stub(scenario: dict):
    """Stub posawesome.posawesome.api.offers.get_offers for the free-item
    verification. `offers` in the scenario is the server-authoritative list;
    absent → import raises → helper fails open (client-trust)."""
    name = "posawesome.posawesome.api.offers"
    if "offers" not in scenario:
        sys.modules.pop(name, None)
        return
    module = types.ModuleType(name)
    module.get_offers = lambda profile: list(scenario.get("offers", []))
    sys.modules[name] = module


def _import_reprice(scenario: dict):
    _install_pkg_stubs()
    sys.modules["frappe"] = _build_frappe_module(scenario)
    _install_offers_stub(scenario)
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


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
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

    def test_fixed_discount_within_cap_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "price_list_rate": 100.00,
            "discount_amount": 5.00,
        }]}
        rp.enforce_discount_limit(invoice, profile_doc=None)

    def test_fixed_discount_over_cap_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "price_list_rate": 100.00,
            "discount_amount": 15.00,
        }]}
        with self.assertRaises(_PermissionError):
            rp.enforce_discount_limit(invoice, profile_doc=None)

    def test_fixed_discount_uses_item_price_when_line_base_missing(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "selling_price_list": "Doco",
            "items": [{"idx": 1, "item_code": "IT-1", "discount_amount": 15.00}],
        }
        with self.assertRaises(_PermissionError):
            rp.enforce_discount_limit(invoice, profile_doc=None)


# ---------------------------------------------------------------------------
# payment-vs-total
# ---------------------------------------------------------------------------


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
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

    def test_overpay_with_declared_change_passes(self):
        # Cashier receives 1900 on a 1882 ticket, declares 18 change.
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 1882.00,
            "is_pos": 1,
            "payments": [{"amount": 1900.00}],
        }
        rp.assert_payments_match_grand_total(invoice, declared_change=18.00)

    def test_overpay_without_declared_change_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 1882.00,
            "is_pos": 1,
            "payments": [{"amount": 1900.00}],
        }
        with self.assertRaises(_ValidationError):
            rp.assert_payments_match_grand_total(invoice)

    def test_declared_change_exceeding_overpay_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 1882.00,
            "is_pos": 1,
            "payments": [{"amount": 1900.00}],
        }
        with self.assertRaises(_ValidationError):
            rp.assert_payments_match_grand_total(invoice, declared_change=100.00)

    def test_negative_declared_change_cannot_hide_underpayment(self):
        # paid 50 for a 100 cart must still fail even if the client sends
        # a negative "change" trying to bend the equality.
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "grand_total": 100.00,
            "is_pos": 1,
            "payments": [{"amount": 50.00}],
        }
        with self.assertRaises(_ValidationError):
            rp.assert_payments_match_grand_total(invoice, declared_change=-50.00)


# ---------------------------------------------------------------------------
# rate band
# ---------------------------------------------------------------------------


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
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

    def test_no_edit_bare_zero_rate_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {
            "items": [{"idx": 1, "item_code": "IT-1", "rate": 0}],
        }
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)

    def test_edit_allowed_bare_zero_rate_passes(self):
        # Regression: on a rate-edit-ENABLED profile a zero/comp rate is the
        # operator's prerogative and must NOT be blocked by the zero-rate
        # guard (which exists only to stop free-invoice fraud on rate-edit-OFF
        # registers). Was thrown when the guard ran before the allow_edit gate.
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 0}]}
        profile = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_genuine_free_item_zero_rate_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "rate": 0, "is_free_item": 1,
            "price_list_rate": 100.00, "discount_percentage": 100,
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.enforce_discount_limit(invoice, profile)
        rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_pricing_rule_zero_rate_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-2", "rate": 0,
            "price_list_rate": 50.00, "discount_percentage": 100,
            "pricing_rules": "FREE-RULE",
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.enforce_discount_limit(invoice, profile)
        rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_pricing_rule_zero_with_tampered_base_raises(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-2", "rate": 0,
            "price_list_rate": 100.00, "discount_percentage": 100,
            "pricing_rules": "FREE-RULE",
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)

    # ---- audit r2: client free marker is verified against server offers ----

    def test_forged_free_item_rejected_when_no_offer_grants_it(self):
        """A crafted is_free_item on a normally-priced item, on a profile with
        a KNOWN offer set that does not grant it, must be rejected — the
        client marker no longer buys the exemption."""
        scenario = _basic_scenario()
        scenario["offers"] = [
            {"offer": "Give Product", "give_item": "IT-OTHER"}
        ]
        rp = _import_reprice(scenario)
        invoice = {
            "pos_profile": "Doco POS",
            "items": [{
                "idx": 1, "item_code": "IT-1", "rate": 0, "is_free_item": 1,
                "posa_is_offer": 1, "price_list_rate": 100.00,
                "discount_percentage": 100,
            }],
        }
        profile = {
            "name": "Doco POS",
            "posa_allow_user_to_edit_rate": 0,
            "selling_price_list": "Doco",
        }
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)
        with self.assertRaises(_PermissionError):
            rp.enforce_discount_limit(invoice, profile)

    def test_server_granted_free_item_still_passes(self):
        """The same zero line passes once the server offer set actually grants
        this item — the legitimate give-product flow is preserved."""
        scenario = _basic_scenario()
        scenario["offers"] = [
            {"offer": "Give Product", "give_item": "IT-1"}
        ]
        rp = _import_reprice(scenario)
        invoice = {
            "pos_profile": "Doco POS",
            "items": [{
                "idx": 1, "item_code": "IT-1", "rate": 0, "is_free_item": 1,
                "posa_is_offer": 1, "price_list_rate": 100.00,
                "discount_percentage": 100,
            }],
        }
        profile = {
            "name": "Doco POS",
            "posa_allow_user_to_edit_rate": 0,
            "selling_price_list": "Doco",
        }
        rp.assert_rates_within_band(invoice, profile)
        rp.enforce_discount_limit(invoice, profile)

    def test_same_item_offer_grants_cart_item(self):
        """A 'buy X get X free' (replace_item) offer grants the free line only
        when the item is in the cart and matches the apply scope."""
        scenario = _basic_scenario()
        scenario["offers"] = [{
            "offer": "Give Product",
            "replace_item": 1,
            "apply_type": "Item Code",
            "apply_item_code": "IT-1",
        }]
        rp = _import_reprice(scenario)
        invoice = {
            "pos_profile": "Doco POS",
            "items": [{
                "idx": 1, "item_code": "IT-1", "rate": 0, "is_free_item": 1,
                "posa_is_offer": 1, "price_list_rate": 100.00,
                "discount_percentage": 100,
            }],
        }
        profile = {
            "name": "Doco POS",
            "posa_allow_user_to_edit_rate": 0,
            "selling_price_list": "Doco",
        }
        rp.assert_rates_within_band(invoice, profile)

    def test_free_marker_fails_open_when_offer_set_unavailable(self):
        """No server offer context (indeterminate) → preserve prior
        client-trust so an offers-infra hiccup cannot block the counter."""
        rp = _import_reprice(_basic_scenario())  # no "offers" key, no name
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "rate": 0, "is_free_item": 1,
            "price_list_rate": 100.00, "discount_percentage": 100,
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile)
        rp.enforce_discount_limit(invoice, profile)

    def test_no_edit_offer_discount_passes(self):
        # Offer/pricing-rule discount is not a rate edit: declared
        # pre-discount price matches master, rate = price minus discount.
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "rate": 90.00,
            "price_list_rate": 100.00, "discount_percentage": 10,
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.enforce_discount_limit(invoice, profile)
        rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_discount_amount_within_cap_passes(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "rate": 95.00,
            "price_list_rate": 100.00, "discount_amount": 5.00,
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        rp.enforce_discount_limit(invoice, profile)
        rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_declared_price_tamper_raises(self):
        # Inflated price_list_rate with a fake discount must not pass.
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "rate": 180.00,
            "price_list_rate": 200.00, "discount_percentage": 10,
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)

    def test_no_edit_rate_beyond_declared_discount_raises(self):
        # Declared 10% but rate hand-typed lower — still a rate edit.
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{
            "idx": 1, "item_code": "IT-1", "rate": 50.00,
            "price_list_rate": 100.00, "discount_percentage": 10,
        }]}
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)

    def test_edit_within_band_passes(self):
        rp = _import_reprice(_basic_scenario())
        # Item Price 100; 90 is within ±20% (range 80..120)
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 90.00}]}
        profile = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}
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

    def test_custom_band_argument_is_honoured(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 95.00}]}
        profile = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}
        rp.assert_rates_within_band(invoice, profile, band_pct=5)  # 95 ∈ 95..105
        invoice["items"][0]["rate"] = 90.00  # outside ±5%
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile, band_pct=5)

    def test_band_argument_beats_profile_field(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 140.00}]}
        profile = {
            "posa_allow_user_to_edit_rate": 1,
            "selling_price_list": "Doco",
            "posa_max_rate_change_pct": 5,
        }
        rp.assert_rates_within_band(invoice, profile, band_pct=50)  # 140 ∈ 50..150


# ---------------------------------------------------------------------------
# rate band on rate-edit-ENABLED registers (restored 2026-08-23)
# ---------------------------------------------------------------------------


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class RateBandOnEditableProfileTests(unittest.TestCase):
    """The band is back for editable registers: `posa_allow_user_to_edit_rate`
    says WHETHER an operator may retype a price, `posa_skip_rate_band` says
    which SKUs may land anywhere, and `posa_max_rate_change_pct` says how wide
    the band is for the rest. See docs/TODO.md → "Rate-band cap"."""

    EDIT_PROFILE = {"posa_allow_user_to_edit_rate": 1, "selling_price_list": "Doco"}

    def _line(self, rate, **kw):
        return {"items": [dict({"idx": 1, "item_code": "IT-1", "rate": rate}, **kw)]}

    # ---- the guard is back ------------------------------------------------

    def test_double_price_raises_on_unflagged_item(self):
        rp = _import_reprice(_basic_scenario())
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(200.00), self.EDIT_PROFILE)

    def test_refusal_names_item_typed_rate_list_rate_and_band(self):
        """The operator reads this at a till, so it has to carry all four
        numbers they need to act on."""
        rp = _import_reprice(_basic_scenario())
        with self.assertRaises(_PermissionError) as ctx:
            rp.assert_rates_within_band(self._line(200.00), self.EDIT_PROFILE)
        message = str(ctx.exception)
        for fragment in ("IT-1", "200", "80", "120", "100", "20"):
            self.assertIn(fragment, message, f"missing {fragment!r} in {message!r}")

    def test_half_price_raises(self):
        # The cap is two-sided: under-charging is as much a typo as over.
        rp = _import_reprice(_basic_scenario())
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(50.00), self.EDIT_PROFILE)

    # ---- the per-SKU opt-out ---------------------------------------------

    def test_flagged_item_accepts_any_rate(self):
        # Tere's flow: "cambiar pantalla" listed at 100, quoted at 400.
        scenario = _basic_scenario()
        scenario["item_skip_band"] = {"IT-1": 1}
        rp = _import_reprice(scenario)
        rp.assert_rates_within_band(self._line(400.00), self.EDIT_PROFILE)
        rp.assert_rates_within_band(self._line(4.00), self.EDIT_PROFILE)

    def test_flagged_item_group_accepts_any_rate(self):
        # Flagging "Servicio Técnico" once covers every labour SKU in it.
        scenario = _basic_scenario()
        scenario["item_group"] = {"IT-1": "Servicio Tecnico"}
        scenario["group_skip_band"] = {"Servicio Tecnico": 1}
        rp = _import_reprice(scenario)
        rp.assert_rates_within_band(self._line(400.00), self.EDIT_PROFILE)

    def test_unflagged_group_does_not_exempt(self):
        scenario = _basic_scenario()
        scenario["item_group"] = {"IT-1": "Retail"}
        scenario["group_skip_band"] = {"Servicio Tecnico": 1}
        rp = _import_reprice(scenario)
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(400.00), self.EDIT_PROFILE)

    def test_unreadable_flag_fails_open(self):
        """A site with this code but without the patch cannot read the
        opt-out. Enforcing anyway would re-block the counter flow the flag
        exists to unblock, so an unreadable flag counts as flagged."""
        scenario = _basic_scenario()
        scenario["skip_flag_unreadable"] = True
        rp = _import_reprice(scenario)
        rp.assert_rates_within_band(self._line(400.00), self.EDIT_PROFILE)

    # ---- per-register width ----------------------------------------------

    def test_profile_pct_narrows_the_band(self):
        rp = _import_reprice(_basic_scenario())
        profile = dict(self.EDIT_PROFILE, posa_max_rate_change_pct=5)
        rp.assert_rates_within_band(self._line(104.00), profile)  # ∈ 95..105
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(110.00), profile)

    def test_profile_pct_widens_the_band(self):
        rp = _import_reprice(_basic_scenario())
        profile = dict(self.EDIT_PROFILE, posa_max_rate_change_pct=200)
        rp.assert_rates_within_band(self._line(290.00), profile)  # ∈ -100..300
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(310.00), profile)

    def test_zero_pct_means_unconfigured_not_zero_width(self):
        """Frappe's Float column is NOT NULL DEFAULT 0, so every POS Profile
        that predates the field reads 0. Reading that as "no deviation
        allowed" would refuse every rate edit the morning after a migrate —
        0 therefore falls back to the 20% default."""
        rp = _import_reprice(_basic_scenario())
        profile = dict(self.EDIT_PROFILE, posa_max_rate_change_pct=0)
        rp.assert_rates_within_band(self._line(110.00), profile)  # 20% default
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(200.00), profile)

    def test_missing_pct_field_falls_back_to_default(self):
        rp = _import_reprice(_basic_scenario())
        rp.assert_rates_within_band(self._line(115.00), self.EDIT_PROFILE)
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(self._line(125.00), self.EDIT_PROFILE)

    def test_negative_pct_is_the_per_register_kill_switch(self):
        # The escape hatch a column default cannot reach by accident.
        rp = _import_reprice(_basic_scenario())
        profile = dict(self.EDIT_PROFILE, posa_max_rate_change_pct=-1)
        rp.assert_rates_within_band(self._line(4000.00), profile)

    # ---- discounts and comps are other gates' business --------------------

    def test_offer_discount_is_not_double_gated(self):
        """A 40%-off offer line sits far below the band, but its pre-discount
        price is the price list. Discount SIZE is enforce_discount_limit's
        job; gating it here too would 403 every offer on a rate-edit
        register."""
        rp = _import_reprice(_basic_scenario())
        invoice = self._line(60.00, price_list_rate=100.00, discount_percentage=40)
        rp.assert_rates_within_band(invoice, self.EDIT_PROFILE)

    def test_discount_on_a_tampered_base_price_still_raises(self):
        # The discount exemption keys on the DECLARED pre-discount price, so
        # inflating that to smuggle a rate edit through fails the band.
        rp = _import_reprice(_basic_scenario())
        invoice = self._line(300.00, price_list_rate=500.00, discount_percentage=40)
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, self.EDIT_PROFILE)

    def test_zero_rate_stays_the_operators_prerogative(self):
        # Unchanged since 23ca94e6: comp / warranty lines on an editable
        # register are not the band's business.
        rp = _import_reprice(_basic_scenario())
        rp.assert_rates_within_band(self._line(0), self.EDIT_PROFILE)

    def test_item_without_price_master_skips(self):
        rp = _import_reprice(_basic_scenario())
        invoice = {"items": [{"idx": 1, "item_code": "NEW-ITEM", "rate": 9999.00}]}
        rp.assert_rates_within_band(invoice, self.EDIT_PROFILE)

    # ---- the rate-edit-OFF branch is untouched ---------------------------

    def test_profile_pct_does_not_leak_into_the_no_edit_branch(self):
        """A register that forbids rate edits still demands an exact match —
        a wide band on it must not become a licence to retype prices."""
        rp = _import_reprice(_basic_scenario())
        profile = {
            "posa_allow_user_to_edit_rate": 0,
            "selling_price_list": "Doco",
            "posa_max_rate_change_pct": 200,
        }
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 110.00}]}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)
        invoice["items"][0]["rate"] = 100.00
        rp.assert_rates_within_band(invoice, profile)

    def test_skip_flag_does_not_open_the_no_edit_branch(self):
        """posa_skip_rate_band widens a band; it does not grant rate editing
        on a register whose profile forbids it."""
        scenario = _basic_scenario()
        scenario["item_skip_band"] = {"IT-1": 1}
        rp = _import_reprice(scenario)
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Doco"}
        invoice = {"items": [{"idx": 1, "item_code": "IT-1", "rate": 400.00}]}
        with self.assertRaises(_PermissionError):
            rp.assert_rates_within_band(invoice, profile)


if __name__ == "__main__":
    unittest.main()
