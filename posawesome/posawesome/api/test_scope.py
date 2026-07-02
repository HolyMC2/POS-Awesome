"""Unit tests for posawesome.posawesome.api._scope.

Same stub-frappe pattern as test_purchase_orders.py — runs without bench
so the suite stays green in CI containers that don't have Frappe SDK.

Covers PR-1 exit criteria from REVIEW2/03_security.md §2.3:
  - assert_company rejects cross-tenant access
  - assert_profile rejects non-assigned users
  - assert_customer_in_profile rejects out-of-group customers
  - System Manager bypass
  - Guest hard-fail
  - Per-request cache isolation
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


class _PermissionError(Exception):
    """Stub for ``frappe.PermissionError``."""


class _FrappeLocal:
    """Stub ``frappe.local`` — supports getattr/setattr for cache bucket."""

    def reset(self):
        for key in list(self.__dict__.keys()):
            delattr(self, key)


def _build_frappe_module(scenario: dict) -> types.ModuleType:
    """Build a stub ``frappe`` module wired against a scenario dict.

    Scenario shape:
        {
            "session_user": "cashier@doco",
            "roles": {"cashier@doco": ["POS User"]},
            "profile_user_rows": [{"parent": "Doco Reparaciones", "user": "cashier@doco"}],
            "profile_company": {"Doco Reparaciones": "Doco Mexico"},
            "customer_groups": {"WALK-IN": "Public", "BIZ-1": "Wholesale"},
            "pos_customer_groups": {"Doco Reparaciones": ["Public"]},
            "customer_group_descendants": {"Public": []},
        }
    """

    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.PermissionError = _PermissionError

    def _throw(message, exc_type=Exception):
        raise exc_type(message) if isinstance(exc_type, type) else Exception(message)

    frappe_module.throw = _throw
    frappe_module.whitelist = lambda *a, **kw: (lambda fn: fn)
    frappe_module.get_roles = lambda user: list(scenario.get("roles", {}).get(user, []))
    frappe_module.session = types.SimpleNamespace(user=scenario.get("session_user", "Guest"))
    frappe_module.local = _FrappeLocal()

    def _get_all(doctype, filters=None, fields=None, ignore_permissions=False):
        if doctype == "POS Profile User":
            user = (filters or {}).get("user")
            return [
                row
                for row in scenario.get("profile_user_rows", [])
                if row.get("user") == user
            ]
        if doctype == "POS Customer Group":
            parent = (filters or {}).get("parent")
            groups = scenario.get("pos_customer_groups", {}).get(parent, [])
            return [{"customer_group": g} for g in groups]
        return []

    frappe_module.get_all = _get_all

    class _Db:
        def get_value(self, doctype, name, fieldname):
            if doctype == "Customer" and fieldname == "customer_group":
                return scenario.get("customer_groups", {}).get(name)
            return None

        def get_descendants(self, doctype, group):
            if doctype == "Customer Group":
                return scenario.get("customer_group_descendants", {}).get(group, [])
            return []

        def sql(self, query, params=None, as_dict=False):
            user = (params or {}).get("user")
            rows = [
                {"profile": row["parent"], "company": scenario.get("profile_company", {}).get(row["parent"])}
                for row in scenario.get("profile_user_rows", [])
                if row.get("user") == user
            ]
            return rows

    frappe_module.db = _Db()
    return frappe_module


def _install_pkg_stubs():
    """Mirror test_purchase_orders.py path-shim so `from posawesome…` resolves."""
    posawesome_pkg = types.ModuleType("posawesome")
    posawesome_pkg.__path__ = [str(REPO_ROOT / "posawesome")]
    sys.modules.setdefault("posawesome", posawesome_pkg)

    posawesome_inner = types.ModuleType("posawesome.posawesome")
    posawesome_inner.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome")]
    sys.modules.setdefault("posawesome.posawesome", posawesome_inner)

    api_pkg = types.ModuleType("posawesome.posawesome.api")
    api_pkg.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome" / "api")]
    sys.modules.setdefault("posawesome.posawesome.api", api_pkg)


def _import_scope(scenario: dict):
    """Fresh import of _scope with the given frappe scenario stubbed in."""
    _install_pkg_stubs()
    sys.modules["frappe"] = _build_frappe_module(scenario)
    # Force re-import each test so frappe.local cache doesn't leak.
    sys.modules.pop("posawesome.posawesome.api._scope", None)
    spec = importlib.util.spec_from_file_location(
        "posawesome.posawesome.api._scope",
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "_scope.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["posawesome.posawesome.api._scope"] = module
    assert spec.loader  # mypy/pyright appeasement
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# scenarios
# ---------------------------------------------------------------------------


def _doco_scenario(session_user="cashier@doco"):
    return {
        "session_user": session_user,
        "roles": {"cashier@doco": ["POS User"], "admin@doco": ["System Manager"]},
        "profile_user_rows": [
            {"parent": "Doco Reparaciones", "user": "cashier@doco"},
        ],
        "profile_company": {
            "Doco Reparaciones": "Doco Mexico",
            "Doco Ventas": "Doco Mexico",
            "Other Tenant": "Other Tenant Co",
        },
        "customer_groups": {
            "WALK-IN": "Public",
            "BIZ-1": "Wholesale",
        },
        "pos_customer_groups": {
            "Doco Reparaciones": ["Public"],
            "Doco Ventas": [],  # legacy unrestricted profile
        },
        "customer_group_descendants": {"Public": ["VIP"], "Wholesale": []},
    }


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class AssertCompanyTests(unittest.TestCase):
    def test_allowed_company_passes(self):
        scope = _import_scope(_doco_scenario())
        scope.assert_company("cashier@doco", "Doco Mexico")  # no raise

    def test_blocked_company_raises(self):
        scope = _import_scope(_doco_scenario())
        with self.assertRaises(_PermissionError):
            scope.assert_company("cashier@doco", "Other Tenant Co")

    def test_guest_always_rejected(self):
        scope = _import_scope(_doco_scenario(session_user="Guest"))
        with self.assertRaises(_PermissionError):
            scope.assert_company("Guest", "Doco Mexico")

    def test_blank_company_noop(self):
        scope = _import_scope(_doco_scenario())
        # downstream assert_profile handles tenant boundary
        scope.assert_company("cashier@doco", None)

    def test_system_manager_bypass(self):
        scope = _import_scope(_doco_scenario(session_user="admin@doco"))
        scope.assert_company("admin@doco", "Anything")


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class AssertProfileTests(unittest.TestCase):
    def test_assigned_profile_passes(self):
        scope = _import_scope(_doco_scenario())
        scope.assert_profile("cashier@doco", "Doco Reparaciones")

    def test_unassigned_profile_raises(self):
        scope = _import_scope(_doco_scenario())
        with self.assertRaises(_PermissionError):
            scope.assert_profile("cashier@doco", "Doco Ventas")

    def test_blank_profile_raises(self):
        scope = _import_scope(_doco_scenario())
        with self.assertRaises(_PermissionError):
            scope.assert_profile("cashier@doco", None)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class AssertCustomerInProfileTests(unittest.TestCase):
    def test_in_group_passes(self):
        scope = _import_scope(_doco_scenario())
        # WALK-IN is in Public, Public is in profile's resolved set
        scope.assert_customer_in_profile("cashier@doco", "WALK-IN", "Doco Reparaciones")

    def test_out_of_group_raises(self):
        scope = _import_scope(_doco_scenario())
        with self.assertRaises(_PermissionError):
            # BIZ-1 is Wholesale; Doco Reparaciones only allows Public
            scope.assert_customer_in_profile("cashier@doco", "BIZ-1", "Doco Reparaciones")

    def test_blank_customer_noop(self):
        scope = _import_scope(_doco_scenario())
        scope.assert_customer_in_profile("cashier@doco", None, "Doco Reparaciones")

    def test_legacy_empty_groups_unrestricted(self):
        # Doco Ventas has no POS Customer Group rows → unrestricted
        scope = _import_scope(_doco_scenario())
        scope.assert_customer_in_profile("cashier@doco", "BIZ-1", "Doco Ventas")

    def test_descendant_group_allowed(self):
        # VIP is a descendant of Public; profile allows Public's subtree
        scenario = _doco_scenario()
        scenario["customer_groups"]["VIP-CUST"] = "VIP"
        scope = _import_scope(scenario)
        scope.assert_customer_in_profile("cashier@doco", "VIP-CUST", "Doco Reparaciones")


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class BulkAssertTests(unittest.TestCase):
    def test_dedup_and_pass(self):
        scope = _import_scope(_doco_scenario())
        scope.assert_customers_in_profile(
            "cashier@doco", ["WALK-IN", "WALK-IN", None], "Doco Reparaciones"
        )

    def test_first_bad_raises(self):
        scope = _import_scope(_doco_scenario())
        with self.assertRaises(_PermissionError):
            scope.assert_customers_in_profile(
                "cashier@doco", ["WALK-IN", "BIZ-1"], "Doco Reparaciones"
            )


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class CacheTests(unittest.TestCase):
    def test_per_request_cache_isolation(self):
        scope = _import_scope(_doco_scenario())
        # First call warms the cache.
        first = scope.get_allowed_pos_profiles("cashier@doco")
        self.assertEqual(first, {"Doco Reparaciones"})

        # Mutate the scenario: simulate a new request with different roles.
        # Just calling frappe.local.reset() drops the cache bucket.
        import frappe as fake_frappe
        fake_frappe.local.reset()  # type: ignore[attr-defined]

        # Now bump the stub data and recheck — fresh fetch should reflect it.
        sys.modules["frappe"].get_all = lambda *a, **kw: [
            {"parent": "Doco Reparaciones"},
            {"parent": "Doco Ventas"},
        ]
        second = scope.get_allowed_pos_profiles("cashier@doco")
        self.assertEqual(second, {"Doco Reparaciones", "Doco Ventas"})


if __name__ == "__main__":
    unittest.main()
