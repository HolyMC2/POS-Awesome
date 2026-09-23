"""Canonical route and retired POS Profile preference regression tests."""

import json
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURES_PATH = REPO_ROOT / "posawesome" / "fixtures" / "custom_field.json"
PATCH_PATH = REPO_ROOT / "posawesome" / "patches" / "set_web_route_default_on.py"
WEB_ROUTE_PATH = REPO_ROOT / "posawesome" / "www" / "posapp.py"


class TestWebRouteFixtureAndRedirect(unittest.TestCase):
    def test_retired_field_is_absent_from_fixture_and_hooks(self):
        fields = json.loads(FIXTURES_PATH.read_text())
        self.assertFalse(any(f.get("fieldname") == "posa_use_web_route" for f in fields))
        self.assertFalse(any(f.get("insert_after") == "posa_use_web_route" for f in fields))
        self.assertNotIn('"POS Profile-posa_use_web_route"', (REPO_ROOT / "posawesome/hooks.py").read_text())

    def test_historical_patch_cannot_recreate_field(self):
        import runpy
        runpy.run_path(str(PATCH_PATH))["execute"]()


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *a, **k: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="cashier@example.com")
    frappe_module.db = types.SimpleNamespace(sql=lambda *a, **k: [])
    frappe_module.local = types.SimpleNamespace(site="test", lang="en")
    frappe_module.get_all = lambda *a, **k: []
    frappe_module.log_error = lambda *a, **k: None
    frappe_module.get_traceback = lambda *a, **k: ""
    frappe_module._ = lambda value, *a, **k: value
    frappe_module._dict = dict
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cstr = lambda v="": "" if v is None else str(v)
    frappe_utils.add_to_date = lambda *a, **k: None
    frappe_utils.get_datetime = lambda *a, **k: None
    frappe_utils.cint = lambda v=0: int(v) if str(v).strip() not in ("", "None") else 0
    frappe_utils.flt = lambda v=0, *a, **k: float(v or 0)
    sys.modules["frappe.utils"] = frappe_utils
    frappe_module.utils = frappe_utils

    # Synthetic package chain so `utilities.py`'s relative imports resolve
    # without executing `api/__init__.py` (which eagerly pulls dashboard →
    # the whole app). Child modules are also bound as parent attributes:
    # py<3.12 attribute-walks dotted targets, sys.modules alone isn't enough.
    def _pkg(name):
        module = types.ModuleType(name)
        module.__path__ = []
        sys.modules[name] = module
        return module

    root = _pkg("posawesome")
    root.__version__ = "0.0.0-test"
    root_utils = types.ModuleType("posawesome.utils")
    root_utils.get_build_version = lambda *a, **k: "test"
    sys.modules["posawesome.utils"] = root_utils
    root.utils = root_utils

    inner = _pkg("posawesome.posawesome")
    root.posawesome = inner
    api = _pkg("posawesome.posawesome.api")
    inner.api = api
    api_utils = types.ModuleType("posawesome.posawesome.api.utils")
    api_utils.get_item_groups = lambda *a, **k: []
    api_utils.fetch_sales_person_names = lambda *a, **k: {}
    sys.modules["posawesome.posawesome.api.utils"] = api_utils
    api.utils = api_utils


def _load_utilities():
    import importlib.util  # noqa: PLC0415

    name = "posawesome.posawesome.api.utilities"
    spec = importlib.util.spec_from_file_location(
        name, REPO_ROOT / "posawesome" / "posawesome" / "api" / "utilities.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Standalone stub harness: fakes `frappe` in sys.modules, which would poison a
# real bench process. Skip under `bench run-tests`; run directly with python3.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestWebRouteDecision(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.utilities = _load_utilities()
        cls.frappe = sys.modules["frappe"]

    def _decide(self, user, rows):
        def _sql(*_a, **_k):
            if isinstance(rows, Exception):
                raise rows
            return rows

        self.frappe.session.user = user
        self.frappe.db.sql = _sql
        return self.utilities.posa_user_opted_into_web_route()

    def test_user_with_no_profile_rows_gets_spa(self):
        # The old opt-in read returned False here → the redirect loop.
        self.assertTrue(self._decide("cashier@example.com", []))

    def test_old_optout_values_no_longer_change_route(self):
        self.assertTrue(self._decide("cashier@example.com", [(0,), (0,)]))

    def test_any_profile_on_gets_spa(self):
        self.assertTrue(self._decide("cashier@example.com", [(0,), (1,)]))

    def test_db_error_fails_open_to_spa(self):
        self.assertTrue(self._decide("cashier@example.com", RuntimeError("db down")))

    def test_guest_never_gets_spa(self):
        self.assertFalse(self._decide("Guest", [(1,)]))

    def test_administrator_always_gets_spa(self):
        self.assertTrue(self._decide("Administrator", [(0,)]))


    def test_web_controller_renders_for_authenticated_user_without_profile_lookup(self):
        import importlib.util
        from unittest.mock import Mock
        spec = importlib.util.spec_from_file_location("canonical_pos_web", WEB_ROUTE_PATH)
        route = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(route)
        self.frappe.session.user = "cashier@example.com"
        self.frappe.db.sql = Mock(side_effect=AssertionError("must not query route preferences"))
        self.frappe.sessions = types.SimpleNamespace(get_csrf_token=lambda: "test-token")
        self.frappe.local.flags = types.SimpleNamespace()
        self.frappe.Redirect = type("Redirect", (Exception,), {})
        route._build_boot_payload = lambda: {"user": "cashier@example.com"}
        route._read_asset_manifest = lambda: {}
        result = route.get_context({})
        self.assertEqual(result["user"], "cashier@example.com")
        self.assertFalse(hasattr(self.frappe.local.flags, "redirect_location"))
        self.frappe.session.user = "Guest"
        with self.assertRaises(self.frappe.Redirect):
            route.get_context({})
        self.assertEqual(self.frappe.local.flags.redirect_location, "/login?redirect-to=/posapp")

    def test_retirement_is_repeatable_and_reconnects_following_fields(self):
        import runpy
        from unittest.mock import Mock
        field = "POS Profile-posa_use_web_route"
        remaining = {field}
        self.frappe.get_all = Mock(side_effect=lambda dt, **kw: ["following-field"] if dt == "Custom Field" else [])
        self.frappe.db.exists = lambda dt, name: name in remaining
        self.frappe.db.set_value = Mock()
        self.frappe.delete_doc = Mock(side_effect=lambda dt, name, **kw: remaining.discard(name))
        self.frappe.clear_cache = Mock()
        execute = runpy.run_path(str(REPO_ROOT / "posawesome/patches/remove_web_route_setting.py"))["execute"]
        execute()
        execute()
        self.frappe.delete_doc.assert_called_once_with("Custom Field", field, force=True, ignore_permissions=True)
        self.frappe.db.set_value.assert_called_with("Custom Field", "following-field", "insert_after", "posa_use_server_cache")
        self.assertEqual(self.frappe.clear_cache.call_count, 2)


if __name__ == "__main__":
    unittest.main()
