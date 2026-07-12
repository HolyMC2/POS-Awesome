import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(
    0,
    str(REPO_ROOT / "posawesome" / "posawesome" / "api" / "test_support"),
)

from offline_sync_harness import (  # noqa: E402
    install_offline_sync_package_stubs,
    load_offline_sync_common,
)


class PermissionError_(Exception):
    """Stand-in for frappe.PermissionError in the standalone stub env."""


class AttrDict(dict):
    __getattr__ = dict.get

    def as_dict(self):
        return dict(self)


# The one profile the fake session user is assigned to.
ALLOWED_PROFILE = "POS-MINE"
ACTIVE_PROFILE = "POS-MINE"


def _install_stubs():
    install_offline_sync_package_stubs()

    # STRICT scope stub — raise for any profile the user does not own. This
    # is the whole point of the security fix, so the test asserts against
    # the real assert semantics, not the permissive harness default.
    scope_module = types.ModuleType("posawesome.posawesome.api._scope")

    def assert_profile(user, name):
        if name != ALLOWED_PROFILE:
            raise PermissionError_(f"Not permitted for POS profile {name}.")

    scope_module.assert_profile = assert_profile
    scope_module.assert_company = lambda user, company: None
    sys.modules["posawesome.posawesome.api._scope"] = scope_module

    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.DoesNotExistError = Exception
    frappe_module.PermissionError = PermissionError_
    frappe_module.session = types.SimpleNamespace(user="cashier@example.com")

    # get_cached_doc returns the REAL server-side profile keyed by name — the
    # scope fields here (customer_groups) are what downstream queries use,
    # NOT anything the client sent.
    def get_cached_doc(doctype, name):
        return AttrDict(
            {
                "name": name,
                "customer_groups": [{"customer_group": "Retail"}],
                "modified": "2026-04-09T10:02:00",
            }
        )

    frappe_module.get_cached_doc = get_cached_doc
    frappe_module.get_all = lambda doctype, **kwargs: []
    sys.modules["frappe"] = frappe_module

    api_utils_module = types.ModuleType("posawesome.posawesome.api.utils")
    api_utils_module.get_active_pos_profile = lambda user=None: {
        "name": ACTIVE_PROFILE,
        "customer_groups": [{"customer_group": "Retail"}],
        "modified": "2026-04-09T10:02:00",
    }
    sys.modules["posawesome.posawesome.api.utils"] = api_utils_module

    common = load_offline_sync_common()
    sys.modules["posawesome.posawesome.api.offline_sync.common"] = common

    customers_module = types.ModuleType("posawesome.posawesome.api.customers")
    customers_module.get_customer_groups = lambda pos_profile: ["Retail"]

    def fake_get_customer_names(pos_profile, limit=None, offset=None, start_after=None, modified_after=None):
        import json

        decoded = json.loads(pos_profile)
        return [
            {
                "name": "CUST-001",
                "customer_name": "Alpha",
                "modified": "2026-04-09T10:04:00",
                "pos_profile_id": decoded.get("name"),
            }
        ][: (limit or 1)]

    customers_module.get_customer_names = fake_get_customer_names
    sys.modules["posawesome.posawesome.api.customers"] = customers_module


def _load_customers_module():
    module_name = "test_offline_sync_scope_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "offline_sync" / "customers.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestOfflineSyncScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_customers_module()

    def test_foreign_profile_name_raises(self):
        # A cashier assigned only to POS-MINE cannot pull another store's
        # customer book by naming that store's profile.
        with self.assertRaises(PermissionError_):
            self.module.sync_customers(pos_profile="POS-OTHER-STORE", limit=5)

    def test_empty_dict_resolves_to_own_profile_not_all(self):
        # The pre-fix exploit: pos_profile="{}" produced an empty scope →
        # whole customer book. Now it falls back to the session user's OWN
        # server-derived profile.
        response = self.module.sync_customers(pos_profile="{}", limit=1)
        self.assertEqual(response["changes"][0]["data"]["pos_profile_id"], ACTIVE_PROFILE)

    def test_crafted_dict_scope_fields_are_ignored(self):
        # A dict whose name is the user's own profile but which tries to
        # smuggle a foreign warehouse: only .name is honored, scope comes
        # from the server doc.
        import json

        payload = json.dumps({"name": ALLOWED_PROFILE, "warehouse": "Other Branch - X"})
        response = self.module.sync_customers(pos_profile=payload, limit=1)
        self.assertEqual(response["changes"][0]["data"]["pos_profile_id"], ALLOWED_PROFILE)

    def test_own_profile_name_succeeds(self):
        response = self.module.sync_customers(pos_profile=ALLOWED_PROFILE, limit=1)
        self.assertEqual(response["changes"][0]["key"], "customer::CUST-001")


if __name__ == "__main__":
    unittest.main()
