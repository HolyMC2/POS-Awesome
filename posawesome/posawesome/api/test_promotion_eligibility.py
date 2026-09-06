"""Standalone regressions: python3 posawesome/posawesome/api/test_promotion_eligibility.py."""

import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))
_spec = importlib.util.spec_from_file_location(
    "promotion_test_harness", pathlib.Path(__file__).with_name("test_reprice.py")
)
harness = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(harness)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run directly")
class PromotionEligibilityTests(unittest.TestCase):
    def setUp(self):
        self.scenario = harness._basic_scenario()
        self.scenario["item_max_discount"] = {}
        self.scenario["offers"] = []
        self.profile = {"name": "Doco POS", "selling_price_list": "Doco",
                        "posa_allow_user_to_edit_rate": 0, "posa_max_discount_allowed": 10}
        self.line = {"item_code": "IT-1", "qty": 1, "rate": 0,
                     "price_list_rate": 100, "discount_percentage": 100, "posa_offer_applied": 1}
        self.invoice = {"pos_profile": "Doco POS", "items": [self.line]}

    def check(self, accepted):
        guards = harness._import_reprice(self.scenario)
        for guard in (guards.enforce_discount_limit, guards.assert_rates_within_band):
            if accepted:
                guard(self.invoice, self.profile)
            else:
                with self.assertRaises(harness._PermissionError):
                    guard(self.invoice, self.profile)

    def gift_offer(self):
        self.scenario["offers"] = [{"name": "Buy Two", "offer": "Give Product",
            "apply_on": "Item Code", "item": "IT-2", "give_item": "IT-1",
            "min_qty": 2, "given_qty": 1}]
        self.line["is_free_item"] = 1
        self.invoice["items"].insert(0, {"item_code": "IT-2", "qty": 2, "rate": 50})

    def test_unverified_offer_marker_does_not_override_profile_cap(self):
        self.check(False)

    def test_unverified_pricing_rule_marker_does_not_override_profile_cap(self):
        self.line.pop("posa_offer_applied")
        self.line["pricing_rules"] = "Unverified Rule"
        self.check(False)

    def test_purchase_threshold_is_required(self):
        self.gift_offer()
        self.invoice["items"][0]["qty"] = 1
        self.check(False)

    def test_amount_threshold_uses_server_price(self):
        self.gift_offer()
        self.scenario["offers"][0]["min_amt"] = 150
        self.invoice["items"][0]["price_list_rate"] = 500
        self.check(False)

    def test_qualifying_purchase_grants_configured_quantity(self):
        self.gift_offer()
        self.check(True)

    def test_discounted_product_offer_does_not_authorize_a_free_product(self):
        self.gift_offer()
        self.scenario["offers"][0].update(discount_type="Discount Percentage", discount_percentage=50)
        self.check(False)

    def test_flattened_scheme_requires_authoritative_rule_evaluation(self):
        self.gift_offer()
        self.scenario["offers"][0]["promo_source"] = "Promotional Scheme"
        self.check(False)

    def test_each_guard_evaluates_the_cart_once(self):
        self.gift_offer()
        self.line["qty"] = 0.5
        self.invoice["items"].append(dict(self.line))
        guards = harness._import_reprice(self.scenario)
        eligibility = importlib.import_module("posawesome.posawesome.api._promotion_eligibility")
        with patch.object(eligibility, "eligible_free_lines", wraps=eligibility.eligible_free_lines) as evaluate:
            guards.enforce_discount_limit(self.invoice, self.profile)
            self.assertEqual(evaluate.call_count, 1)
            guards.assert_rates_within_band(self.invoice, self.profile)
            self.assertEqual(evaluate.call_count, 2)

    def test_splitting_gift_rows_does_not_multiply_allowance(self):
        self.gift_offer()
        self.invoice["items"].append(dict(self.line))
        self.check(False)

    def test_recursive_quantity_uses_server_offer(self):
        self.gift_offer()
        self.scenario["offers"][0].update(is_recursive=1, recurse_for=2, round_free_qty=1)
        self.invoice["items"][0]["qty"] = 4
        self.line["qty"] = 2
        self.check(True)
        self.line["qty"] = 3
        self.check(False)

    def test_coupon_offer_requires_validated_coupon(self):
        self.gift_offer()
        self.scenario["offers"][0]["coupon_based"] = 1
        self.check(False)

    def test_item_price_offer_must_match_server_discount(self):
        self.scenario["offers"] = [{"offer": "Item Price", "apply_on": "Item Code",
            "item": "IT-1", "discount_type": "Discount Percentage", "discount_percentage": 10}]
        self.check(False)
        self.scenario["offers"][0]["discount_percentage"] = 100
        self.check(True)

    def test_item_group_eligibility_uses_server_metadata(self):
        self.line["item_group"] = "Promo"
        self.scenario["item_meta"] = [{"item_code": "IT-1", "item_group": "Ordinary"}]
        self.scenario["offers"] = [{"offer": "Item Price", "apply_on": "Item Group",
            "item_group": "Promo", "discount_type": "Discount Percentage", "discount_percentage": 100}]
        self.check(False)

    def test_verified_pricing_rule_preserves_zero_price(self):
        self.scenario["pricing_result"] = {"updates": [
            {"row_id": "0", "rate": 0, "pricing_rules": ["Free Rule"]}]}
        self.check(True)
        evaluated = self.scenario["pricing_payload"]["lines"][0]
        self.assertEqual(evaluated["rate"], 100)
        self.assertNotIn("posa_offer_applied", evaluated)
        self.assertNotIn("discount_percentage", evaluated)

    def test_verified_product_pricing_rule_preserves_giveaway(self):
        self.line["is_free_item"] = 1
        self.invoice["items"].insert(0, {"item_code": "IT-2", "qty": 2, "rate": 50})
        self.scenario["pricing_result"] = {"free_lines": [
            {"item_code": "IT-1", "rate": 0, "qty": 1, "pricing_rules": "Free Rule"}]}
        self.check(True)
        self.line["qty"] = 2
        self.check(False)

    def test_offer_lookup_failure_never_grants_exemption(self):
        self.scenario.pop("offers")
        self.check(False)

    def test_stale_document_cache_cannot_grant_exemption(self):
        self.invoice["_posa_grantable_free"] = ["IT-1"]
        self.check(False)

    def test_return_keeps_original_gift_price_after_offer_expires(self):
        self.invoice.update(doctype="Sales Invoice", is_return=1, return_against="Original",
                            company="Company", customer="Customer")
        self.line["qty"] = -1
        self.scenario["original_invoice"] = {"docstatus": 1, "company": "Company", "customer": "Customer",
            "items": [{"item_code": "IT-1", "rate": 0, "qty": 1}]}
        self.check(True)
        self.scenario["original_invoice"]["items"][0]["rate"] = 100
        self.check(False)


if __name__ == "__main__":
    unittest.main()
