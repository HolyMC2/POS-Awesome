"""Standalone authorization tests for ``api.charge_requests``.

Run directly with ``python3 test_charge_requests_scope.py``.  The harness
stubs Frappe and skips under bench so it cannot poison the integration suite's
real ``frappe`` module.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
MODULE_NAME = "posawesome.posawesome.api.charge_requests"
MODULE_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "charge_requests.py"


class _PermissionError(Exception):
    pass


class _Request(types.SimpleNamespace):
    # prepare_charge_request_invoice reads this even when a test doesn't set
    # it (round-2 pull flow stamps it into the invoice remarks).
    source_label = None

    def get_items(self):
        return []

    def mark_charged(self, _doctype, _name):
        self.status = "Charged"


class _Invoice(types.SimpleNamespace):
    def __init__(self, doctype):
        super().__init__(doctype=doctype, flags=types.SimpleNamespace(), items=[])

    def append(self, _fieldname, value):
        self.items.append(value)

    def insert(self, **_kwargs):
        self.inserted = True

    def as_dict(self):
        return dict(self.__dict__)


def _install_package_stubs():
    posawesome_pkg = types.ModuleType("posawesome")
    posawesome_pkg.__path__ = [str(REPO_ROOT / "posawesome")]
    sys.modules["posawesome"] = posawesome_pkg

    inner_pkg = types.ModuleType("posawesome.posawesome")
    inner_pkg.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome")]
    sys.modules["posawesome.posawesome"] = inner_pkg

    api_pkg = types.ModuleType("posawesome.posawesome.api")
    api_pkg.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome" / "api")]
    sys.modules["posawesome.posawesome.api"] = api_pkg


def _import_charge_requests(scenario=None):
    scenario = {
        "session_user": "cashier@example.com",
        "roles": [],
        "capabilities": [],
        "legacy_enabled": 0,
        "request_profile": "Profile A",
        **(scenario or {}),
    }
    _install_package_stubs()

    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.PermissionError = _PermissionError
    frappe_module.session = types.SimpleNamespace(user=scenario["session_user"])
    frappe_module.whitelist = lambda *args, **kwargs: lambda function: function
    frappe_module.get_roles = lambda user=None: list(scenario["roles"])

    def _throw(message, exc_type=Exception):
        raise exc_type(message)

    frappe_module.throw = _throw

    request = _Request(
        name="CHARGE-1",
        status="Open",
        company="Company A",
        customer="Customer A",
        pos_profile=scenario["request_profile"],
        items_json="[]",
    )
    frappe_module.get_doc = lambda doctype, name: request
    frappe_module.new_doc = _Invoice

    class _Db:
        def exists(self, doctype, filters=None):
            if doctype == "DocType":
                return filters == "POS Charge Request"
            if doctype == "POS Opening Shift":
                return True
            return False

        def get_value(self, doctype, name, fieldname=None, as_dict=False):
            if doctype == "POS Profile" and fieldname == "posa_use_charge_requests":
                return scenario["legacy_enabled"]
            if (
                doctype == "POS Profile"
                and fieldname == "create_pos_invoice_instead_of_sales_invoice"
            ):
                return 0
            if doctype in ("Sales Invoice", "POS Invoice"):
                return None
            return None

    frappe_module.db = _Db()
    sys.modules["frappe"] = frappe_module

    utils_module = types.ModuleType("frappe.utils")
    utils_module.cint = lambda value: int(value or 0)
    sys.modules["frappe.utils"] = utils_module

    scope_module = types.ModuleType("posawesome.posawesome.api._scope")
    scope_module.assert_company = lambda user, company: None
    scope_module.assert_profile = lambda user, profile: None
    sys.modules["posawesome.posawesome.api._scope"] = scope_module

    vertical_module = types.ModuleType("posawesome.posawesome.api.vertical")
    # charge_requests consumes the shift-aware resolver (F1 next-shift
    # activation); the stub stays flat — these tests are about role/scope.
    vertical_module.shift_effective_capability_payload = lambda _profile, user=None: {
        "capabilities": scenario["capabilities"]
    }
    sys.modules["posawesome.posawesome.api.vertical"] = vertical_module

    sys.modules.pop(MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(MODULE_NAME, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    assert spec.loader
    spec.loader.exec_module(module)
    return module


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class ChargeRequestCapabilityScopeTests(unittest.TestCase):
    def test_role_qualified_capability_rejects_user_without_role(self):
        module = _import_charge_requests(
            {"capabilities": ["external_document_checkout:Accounts Manager"]}
        )

        self.assertFalse(module._feature_enabled("Profile A"))
        with self.assertRaisesRegex(Exception, "not enabled"):
            module._assert_feature("Profile A")

    def test_role_qualified_capability_allows_user_with_role(self):
        module = _import_charge_requests(
            {
                "capabilities": ["external_document_checkout:Accounts Manager"],
                "roles": ["Sales User", "Accounts Manager"],
            }
        )

        self.assertTrue(module._feature_enabled("Profile A"))

    def test_bare_capability_is_role_agnostic(self):
        module = _import_charge_requests(
            {"capabilities": ["external_document_checkout"], "roles": []}
        )

        self.assertTrue(module._feature_enabled("Profile A"))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class ChargeRequestProfilePinTests(unittest.TestCase):
    def test_prepare_rejects_request_pinned_to_another_profile(self):
        module = _import_charge_requests(
            {"legacy_enabled": 1, "request_profile": "Profile A"}
        )

        with self.assertRaises(_PermissionError):
            module.prepare_charge_request_invoice("CHARGE-1", "Profile B", "SHIFT-1")

    def test_prepare_allows_request_pinned_to_same_profile(self):
        module = _import_charge_requests(
            {"legacy_enabled": 1, "request_profile": "Profile A"}
        )

        invoice = module.prepare_charge_request_invoice("CHARGE-1", "Profile A", "SHIFT-1")

        self.assertTrue(invoice["inserted"])
        self.assertEqual(invoice["pos_profile"], "Profile A")


if __name__ == "__main__":
    unittest.main()
