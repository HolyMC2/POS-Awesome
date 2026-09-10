"""Standalone regressions: python3 posawesome/posawesome/api/test_promotion_eligibility.py."""

import importlib.util
import pathlib
import sys
import types
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

    # ---- Give Product with the gift picked from apply_item_group ----

    def group_gift_offer(self, **overrides):
        offer = {"name": "Mica de regalo", "offer": "Give Product",
                 "apply_on": "Item Code", "item": "IT-2", "min_qty": 2,
                 "apply_type": "Item Group", "apply_item_group": "Micas", "given_qty": 1}
        offer.update(overrides)
        self.scenario["offers"] = [offer]
        self.scenario["item_meta"] = [{"item_code": "IT-1", "item_group": "Micas"},
                                      {"item_code": "IT-2", "item_group": "Celulares"}]
        self.line["is_free_item"] = 1
        self.invoice["items"].insert(0, {"item_code": "IT-2", "qty": 2, "rate": 50})
        return offer

    def install_coupon_check(self, coupon_offer):
        module = types.ModuleType("posawesome.posawesome.doctype.pos_coupon.pos_coupon")
        module.check_coupon_code = lambda code, customer=None, company=None: (
            {"coupon": {"pos_offer": coupon_offer}, "msg": "Apply"} if coupon_offer
            else {"coupon": None, "msg": "Sorry, this coupon code's validity has expired"})
        self.addCleanup(sys.modules.pop, module.__name__, None)
        sys.modules[module.__name__] = module

    def test_group_gift_accepts_an_item_from_the_group(self):
        self.group_gift_offer()
        self.check(True)

    def test_group_gift_accepts_a_descendant_group(self):
        self.group_gift_offer(apply_item_group="Accesorios")
        self.scenario["group_descendants"] = {"Accesorios": ["Micas", "Fundas"]}
        self.check(True)

    def test_group_gift_narrows_to_the_exact_group_when_the_tree_is_unreadable(self):
        self.group_gift_offer(apply_item_group="Accesorios")
        self.scenario["group_tree_unreadable"] = True
        self.check(False)

    def test_group_gift_rejects_an_item_outside_the_group(self):
        self.group_gift_offer()
        self.scenario["item_meta"][0]["item_group"] = "Cargadores"
        self.check(False)

    def test_group_gift_ignores_a_client_group_claim(self):
        self.group_gift_offer()
        self.scenario["item_meta"][0]["item_group"] = "Cargadores"
        self.line["item_group"] = "Micas"
        self.check(False)

    def test_group_gift_ignores_a_stale_item_code_on_the_offer(self):
        self.group_gift_offer(apply_item_code="IT-1")
        self.scenario["item_meta"][0]["item_group"] = "Cargadores"
        self.check(False)

    def test_group_gift_respects_the_price_ceiling(self):
        self.group_gift_offer(less_then=150)
        self.check(True)
        self.scenario["offers"][0]["less_then"] = 100
        self.check(False)

    def test_group_gift_under_a_ceiling_needs_a_known_price(self):
        self.group_gift_offer(less_then=150)
        self.scenario["item_prices"][("IT-1", "Doco")] = 0.0
        harness._import_reprice(self.scenario)
        eligibility = importlib.import_module("posawesome.posawesome.api._promotion_eligibility")
        self.assertEqual(eligibility.eligible_free_lines(self.invoice, self.profile, "Doco"), set())
        self.scenario["offers"][0]["less_then"] = 0
        harness._import_reprice(self.scenario)
        eligibility = importlib.import_module("posawesome.posawesome.api._promotion_eligibility")
        self.assertEqual(eligibility.eligible_free_lines(self.invoice, self.profile, "Doco"), {id(self.line)})

    def test_group_gift_respects_given_qty(self):
        self.group_gift_offer()
        self.line["qty"] = 2
        self.check(False)
        self.scenario["offers"][0]["given_qty"] = 2
        self.check(True)

    def test_group_gift_allowance_is_shared_across_picked_items(self):
        self.group_gift_offer()
        self.scenario["item_meta"].append({"item_code": "IT-3", "item_group": "Micas"})
        self.scenario["item_prices"][("IT-3", "Doco")] = 80.0
        self.invoice["items"].append(dict(self.line, item_code="IT-3"))
        self.check(False)
        self.scenario["offers"][0]["given_qty"] = 2
        self.check(True)

    def test_group_gift_requires_the_purchase_threshold(self):
        self.group_gift_offer()
        self.invoice["items"][0]["qty"] = 1
        self.check(False)

    def test_group_gift_must_be_free_under_the_offer_price_rule(self):
        self.group_gift_offer(discount_type="Discount Percentage", discount_percentage=50)
        self.check(False)

    def test_group_gift_needs_a_currently_valid_offer(self):
        # get_offers is the server's validity filter (disabled, dates, company,
        # profile, warehouse): an offer it does not return grants nothing.
        self.group_gift_offer()
        self.scenario["offers"] = []
        self.check(False)

    def test_coupon_group_gift_requires_a_valid_coupon_for_that_offer(self):
        self.group_gift_offer(coupon_based=1)
        self.invoice.update(customer="CUST-1", company="Grupo Doco",
                            posa_coupons=[{"coupon_code": "GC-A", "coupon": "GC-A"}])
        self.install_coupon_check("Mica de regalo")
        self.check(True)
        self.install_coupon_check("Otra oferta")
        self.check(False)
        self.install_coupon_check(None)
        self.check(False)
        self.invoice["posa_coupons"] = []
        self.install_coupon_check("Mica de regalo")
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
