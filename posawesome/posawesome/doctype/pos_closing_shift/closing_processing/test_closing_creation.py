"""Standalone authorization tests for closing-shift submission.

Run without bench:
    python3 posawesome/posawesome/doctype/pos_closing_shift/closing_processing/test_closing_creation.py
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import types
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[5]
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


class _PermissionError(Exception):
    pass


class _ClosingShiftDoc:
    def __init__(self):
        self.name = "CLOSE-1"
        self.flags = types.SimpleNamespace()
        self.save_calls = 0
        self.submit_calls = 0

    def get(self, key, default=None):
        return default

    def save(self):
        self.save_calls += 1

    def submit(self):
        self.submit_calls += 1


def _install_package(name, path):
    module = types.ModuleType(name)
    module.__path__ = [str(path)]
    sys.modules[name] = module


def _import_creation(scenario):
    for name, relative in (
        ("posawesome", "posawesome"),
        ("posawesome.posawesome", "posawesome/posawesome"),
        ("posawesome.posawesome.api", "posawesome/posawesome/api"),
        ("posawesome.posawesome.doctype", "posawesome/posawesome/doctype"),
        (
            "posawesome.posawesome.doctype.pos_closing_shift",
            "posawesome/posawesome/doctype/pos_closing_shift",
        ),
        (
            "posawesome.posawesome.doctype.pos_closing_shift.closing_processing",
            "posawesome/posawesome/doctype/pos_closing_shift/closing_processing",
        ),
    ):
        _install_package(name, REPO_ROOT / relative)

    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.PermissionError = _PermissionError
    frappe_module.session = types.SimpleNamespace(user=scenario["session_user"])
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module._dict = lambda value=None, **kwargs: types.SimpleNamespace(**(value or kwargs))

    def _throw(message, exc_type=Exception, **kwargs):
        raise exc_type(message)

    frappe_module.throw = _throw
    frappe_module.db = types.SimpleNamespace()
    closing_doc = _ClosingShiftDoc()

    def _get_doc(doctype_or_values, name=None):
        scenario.setdefault("get_doc_calls", []).append((doctype_or_values, name))
        if isinstance(doctype_or_values, dict):
            return closing_doc
        if doctype_or_values == "POS Opening Shift":
            return types.SimpleNamespace(**scenario["opening_shift"])
        if doctype_or_values == "User":
            return types.SimpleNamespace(name=name)
        raise AssertionError(f"Unexpected get_doc call: {doctype_or_values}, {name}")

    frappe_module.get_doc = _get_doc
    sys.modules["frappe"] = frappe_module

    utils_module = types.ModuleType("frappe.utils")
    utils_module.flt = lambda value: float(value or 0)
    utils_module.json = json
    sys.modules["frappe.utils"] = utils_module

    scope_module = types.ModuleType("posawesome.posawesome.api._scope")

    def _assert_profile(user, profile):
        scenario.setdefault("profile_assertions", []).append((user, profile))
        if profile not in scenario.get("allowed_profiles", set()):
            raise _PermissionError("profile denied")

    def _assert_company(user, company):
        scenario.setdefault("company_assertions", []).append((user, company))
        if company not in scenario.get("allowed_companies", set()):
            raise _PermissionError("company denied")

    scope_module.assert_profile = _assert_profile
    scope_module.assert_company = _assert_company
    sys.modules[scope_module.__name__] = scope_module

    employees_module = types.ModuleType("posawesome.posawesome.api.employees")
    employees_module._is_pos_supervisor = lambda user_doc: (
        "POS Awesome Supervisor" in scenario.get("roles", {}).get(user_doc.name, [])
    )
    sys.modules[employees_module.__name__] = employees_module

    utils_name = (
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils"
    )
    closing_utils = types.ModuleType(utils_name)
    closing_utils.get_base_value = lambda *args, **kwargs: 0
    sys.modules[utils_name] = closing_utils

    data_name = "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data"
    data_module = types.ModuleType(data_name)
    data_module.get_pos_invoices = lambda *args, **kwargs: []
    data_module.get_payments_entries = lambda *args, **kwargs: []
    sys.modules[data_name] = data_module

    invoices_name = (
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices"
    )
    invoices_module = types.ModuleType(invoices_name)
    invoices_module.get_pending_draft_invoices = lambda *args, **kwargs: []
    invoices_module.submit_printed_invoices = lambda *args, **kwargs: []
    sys.modules[invoices_name] = invoices_module

    module_name = (
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation"
    )
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(
        module_name,
        REPO_ROOT
        / "posawesome/posawesome/doctype/pos_closing_shift/closing_processing/creation.py",
    )
    creation = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = creation
    assert spec.loader
    spec.loader.exec_module(creation)
    return creation, closing_doc


def _scenario(session_user, opening_user, roles=None):
    return {
        "session_user": session_user,
        "opening_shift": {
            "name": "OPEN-1",
            "user": opening_user,
            "pos_profile": "Main POS",
            "company": "Doco",
        },
        "allowed_profiles": {"Main POS"},
        "allowed_companies": {"Doco"},
        "roles": roles or {},
    }


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class SubmitClosingShiftAuthorizationTests(unittest.TestCase):
    def test_non_supervisor_cannot_close_another_cashiers_shift(self):
        scenario = _scenario("cashier@doco", "other@doco")
        creation, closing_doc = _import_creation(scenario)

        with self.assertRaises(_PermissionError):
            creation.submit_closing_shift(json.dumps({"pos_opening_shift": "OPEN-1"}))

        self.assertEqual(closing_doc.save_calls, 0)
        self.assertEqual(closing_doc.submit_calls, 0)

    def test_cashier_can_close_own_shift(self):
        scenario = _scenario("cashier@doco", "cashier@doco")
        creation, closing_doc = _import_creation(scenario)

        result = creation.submit_closing_shift(json.dumps({"pos_opening_shift": "OPEN-1"}))

        self.assertEqual(result, "CLOSE-1")
        self.assertEqual(closing_doc.save_calls, 1)
        self.assertEqual(closing_doc.submit_calls, 1)
        self.assertTrue(closing_doc.flags.ignore_permissions)
        self.assertEqual(scenario["profile_assertions"], [("cashier@doco", "Main POS")])
        self.assertEqual(scenario["company_assertions"], [("cashier@doco", "Doco")])

    def test_profile_scoped_supervisor_can_close_cashiers_shift(self):
        supervisor = "supervisor@doco"
        scenario = _scenario(
            supervisor,
            "cashier@doco",
            roles={supervisor: ["POS Awesome Supervisor"]},
        )
        creation, closing_doc = _import_creation(scenario)

        result = creation.submit_closing_shift(json.dumps({"pos_opening_shift": "OPEN-1"}))

        self.assertEqual(result, "CLOSE-1")
        self.assertEqual(closing_doc.save_calls, 1)
        self.assertEqual(closing_doc.submit_calls, 1)
        self.assertEqual(scenario["profile_assertions"], [(supervisor, "Main POS")])
        self.assertEqual(scenario["company_assertions"], [(supervisor, "Doco")])


if __name__ == "__main__":
    unittest.main()
