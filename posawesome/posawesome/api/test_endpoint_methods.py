"""MONEY-F2: money-mutating whitelisted endpoints must not be GET-able.

Frappe skips CSRF for GET (auth.py UNSAFE_HTTP_METHODS), so a GET door on a
write is an <img>/fetch CSRF vector that rides the logged-in operator's session.
Several back-compat aliases carried `methods=["GET","POST"]` while the impls
they forward to were POST-only — this pins the aliases POST-only and scans for
any mutating name that reopens the class (there are ~40 such wrappers).
"""

import importlib
import unittest

import frappe
# introspection only — no DB fixtures needed, so a plain TestCase (frappe is
# already connected under bench run-tests).


# The aliases that were GET-able over a mutating impl (audit 2026-08-31).
POST_ONLY = [
    ("posawesome.posawesome.api.invoices", "submit_invoice"),
    ("posawesome.posawesome.api.invoices", "update_invoice"),
    ("posawesome.posawesome.api.items", "update_price_list_rate"),
    ("posawesome.posawesome.api.gift_cards", "top_up_gift_card"),
    ("posawesome.posawesome.api.payment_entry", "auto_reconcile_customer_invoices"),
]

# Modules scanned for the general guard, and the verbs that mark a mutation.
SCANNED_MODULES = [
    "posawesome.posawesome.api.invoices",
    "posawesome.posawesome.api.items",
    "posawesome.posawesome.api.gift_cards",
    "posawesome.posawesome.api.payment_entry",
    "posawesome.posawesome.api.sales_orders",
    "posawesome.posawesome.api.stored_value",
]
MUTATING_PREFIXES = (
    "submit_", "update_", "create_", "delete_", "cancel_", "amend_",
    "top_up_", "issue_", "deposit_", "reconcile_", "auto_reconcile_",
)


class TestEndpointMethods(unittest.TestCase):
    def _allowed(self, mod, fn):
        m = importlib.import_module(mod)
        f = getattr(m, fn)
        return frappe.allowed_http_methods_for_whitelisted_func.get(f)

    def test_the_known_money_aliases_are_post_only(self):
        for mod, fn in POST_ONLY:
            methods = self._allowed(mod, fn)
            self.assertIsNotNone(methods, f"{mod}.{fn} is not whitelisted?")
            self.assertNotIn(
                "GET", methods,
                f"{mod}.{fn} allows GET — a CSRF-exempt door on a money write",
            )
            self.assertIn("POST", methods)

    def test_no_mutating_endpoint_in_the_scanned_modules_allows_get(self):
        allowed = frappe.allowed_http_methods_for_whitelisted_func
        offenders = []
        for mod in SCANNED_MODULES:
            m = importlib.import_module(mod)
            for name in dir(m):
                if not name.startswith(MUTATING_PREFIXES):
                    continue
                fn = getattr(m, name)
                methods = allowed.get(fn)
                # Only whitelisted callables defined in THIS module.
                if methods is None or getattr(fn, "__module__", None) != mod:
                    continue
                if "GET" in methods:
                    offenders.append(f"{mod}.{name} -> {methods}")
        self.assertEqual(
            offenders, [],
            "mutating endpoints must not allow GET (CSRF-exempt):\n" + "\n".join(offenders),
        )


class TestPriceListRateScope(unittest.TestCase):
    """MONEY-F3: update_price_list_rate is scoped to the register's feature flag.

    It rewrites the price master with ignore_permissions and moves the exact row
    `assert_rates_within_band` trusts, so an unguarded call defeated the rate
    band. It now goes through `assert_profile_feature`; a profile whose
    `posa_allow_price_list_rate_change` is OFF is refused before any write —
    even for a super user, so the check is the register capability, not a
    permission. (Only the refuse path is exercised; the pass path would write an
    Item Price.)
    """

    PROFILE = "Doco Reparaciones"

    def test_a_flag_off_profile_is_refused_before_any_write(self):
        from posawesome.posawesome.api.item_processing.price import update_price_list_rate

        if not frappe.db.exists("POS Profile", self.PROFILE):
            self.skipTest(f"no {self.PROFILE} profile on this site")
        if frappe.db.get_value("POS Profile", self.PROFILE, "posa_allow_price_list_rate_change"):
            self.skipTest(f"{self.PROFILE} has the flag ON here")
        with self.assertRaises(frappe.ValidationError):
            update_price_list_rate(
                "__nonexistent_item__", "Standard Selling", 1, pos_profile=self.PROFILE
            )


if __name__ == "__main__":
    unittest.main()
