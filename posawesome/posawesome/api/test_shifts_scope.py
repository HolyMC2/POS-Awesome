"""Standalone scope tests for POS Opening Shift sale validation.

Run directly with ``python3 test_shifts_scope.py``. The stubbed Frappe module
would poison a bench test process, so this suite skips under bench discovery.
"""

from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


class _PermissionError(Exception):
    pass


class _Row(dict):
    __getattr__ = dict.__getitem__


class _Db:
    def __init__(self):
        self.shift_user = "cashier-a@example.com"

    def get_value(self, doctype, name, fields, as_dict=False):
        if doctype != "POS Opening Shift":
            return None
        return _Row(
            period_start_date=datetime.date.today(),
            pos_profile="Main POS",
            status="Open",
            docstatus=1,
            user=self.shift_user,
        )


def _install_stubs():
    posawesome_pkg = types.ModuleType("posawesome")
    posawesome_pkg.__path__ = [str(REPO_ROOT / "posawesome")]
    sys.modules["posawesome"] = posawesome_pkg

    posawesome_inner_pkg = types.ModuleType("posawesome.posawesome")
    posawesome_inner_pkg.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome")]
    sys.modules["posawesome.posawesome"] = posawesome_inner_pkg

    api_pkg = types.ModuleType("posawesome.posawesome.api")
    api_pkg.__path__ = [str(REPO_ROOT / "posawesome" / "posawesome" / "api")]
    sys.modules["posawesome.posawesome.api"] = api_pkg

    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.PermissionError = _PermissionError
    frappe_module.throw = lambda message, exc_type=Exception: (_ for _ in ()).throw(
        exc_type(message)
    )
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="cashier-a@example.com")
    frappe_module.conf = {}
    frappe_module.db = _Db()
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.nowdate = lambda: datetime.date.today().isoformat()
    frappe_utils.getdate = lambda value=None: (
        datetime.date.fromisoformat(value) if isinstance(value, str) else value
    )
    frappe_module.utils = frappe_utils
    sys.modules["frappe.utils"] = frappe_utils

    utilities = types.ModuleType("posawesome.posawesome.api.utilities")
    utilities.get_version = lambda: 16
    sys.modules["posawesome.posawesome.api.utilities"] = utilities

    scope = types.ModuleType("posawesome.posawesome.api._scope")
    scope.assert_company = lambda *args, **kwargs: None
    scope.assert_profile = lambda *args, **kwargs: None
    sys.modules["posawesome.posawesome.api._scope"] = scope


def _load_shifts_module():
    module_name = "posawesome.posawesome.api.shifts"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "shifts.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class ShiftOwnerScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_modules = sys.modules.copy()
        _install_stubs()
        cls.shifts = _load_shifts_module()

    @classmethod
    def tearDownClass(cls):
        cls.shifts = None
        sys.modules.clear()
        sys.modules.update(cls.original_modules)

    def test_other_cashiers_shift_is_rejected(self):
        self.shifts.frappe.db.shift_user = "cashier-b@example.com"

        with self.assertRaises(_PermissionError):
            self.shifts.assert_shift_not_stale("SHIFT-B")

    def test_own_shift_is_allowed(self):
        self.shifts.frappe.db.shift_user = "cashier-a@example.com"

        self.shifts.assert_shift_not_stale("SHIFT-A")


if __name__ == "__main__":
    unittest.main()
