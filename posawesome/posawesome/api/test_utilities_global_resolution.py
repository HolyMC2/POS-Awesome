"""Every global a function in `api/utilities.py` reads must exist after import.

This pins a BUG CLASS, not one bug. The backend CI ruff gate is
`--select E9,F63,F7` (`.github/workflows/ci-backend.yml`), which does NOT
include F821 (undefined name), so a refactor can drop an import and leave a
function that raises NameError the first time its branch is reached. Two live
ones survived in this module for over a year:

* `set_batch_nos_for_bundels` read `get_batch_no`, `get_batch_qty`, `flt` and
  `_` without importing any of them. `742e831dc` (Api refactor #469,
  2025-06-26) copied the function out of `api/posapp.py` and left its
  `from erpnext.stock.doctype.batch.batch import ...` behind; `5dc4a4819`
  then deleted `posapp.py`, taking the only working copy. The call site was on
  every POS submit, reached only by an invoice carrying packed (Product Bundle)
  rows whose component Item `has_batch_no`, so the sale died on exactly the
  rarest configuration. That function and its helper are GONE now: ERPNext v16
  allocates packed batches itself through a Serial and Batch Bundle and ignores
  the field they wrote (see `test_bundle_batch_native.py`, which is the standing
  proof that the sale works without them).
* `get_language_info` called a `_validate_language_code` that was never written
  at all, so that whitelisted endpoint answered its own generic failure for
  every request ever made and wrote one `tabError Log` row per call.

LOAD_GLOBAL is the exact opcode for these reads. Function-local imports compile
to STORE_FAST/LOAD_FAST, so this test stays quiet about the lazy `erpnext` /
`frappe.utils` imports the module legitimately uses inside functions.

Standalone stub harness - fakes `frappe` and the package chain in sys.modules,
so it skips under `bench run-tests` and runs directly with python3
(`scripts/run_backend_tests.py` gives every api test file its own interpreter).
"""

import builtins
import dis
import importlib.util
import logging
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
UTILITIES_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "utilities.py"

TODAY = "2026-09-12"


class FakeLogger:
    """Records what `_posa_warn` emits, at the level Frappe hands out (ERROR)."""

    def __init__(self):
        self.warnings = []
        self.level = logging.ERROR

    def setLevel(self, level):  # noqa: N802 - logging.Logger's own spelling
        self.level = level

    def warning(self, message, *args):
        self.warnings.append(message % args if args else message)


def _install_stubs():
    """Fake framework + package chain so utilities.py imports standalone.

    Only what module IMPORT touches: the `@frappe.whitelist(...)` decorators run
    at import time, and so do the module-level `from .utils import ...` /
    `from posawesome.utils import ...` reads. Deliberately NO `erpnext` stub -
    nothing in this module imports erpnext at module scope, and if that ever
    changes this test should fail loudly rather than paper over it.
    """
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *a, **k: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="cajero@example.com")
    frappe_module.local = types.SimpleNamespace(site="doco-mirror.lab.xoloitzcuintles.com")
    frappe_module.get_all = lambda *a, **k: []
    frappe_module.get_installed_apps = lambda *a, **k: []
    frappe_module.get_traceback = lambda *a, **k: ""
    frappe_module._ = lambda value, *a, **k: value
    frappe_module._dict = dict
    frappe_module.log_error = lambda *a, **k: types.SimpleNamespace(name="ERRLOG-0001")
    frappe_module.cache = lambda: types.SimpleNamespace(
        get_value=lambda *a, **k: None, set_value=lambda *a, **k: None
    )
    logger = FakeLogger()
    frappe_module.logger = lambda *a, **k: logger
    frappe_module._fake_logger = logger

    def _throw(message, exc=None, **_kwargs):
        raise AssertionError(f"unexpected frappe.throw at import: {message}")

    frappe_module.throw = _throw
    frappe_module.db = types.SimpleNamespace(
        get_value=lambda *a, **k: None,
        sql=lambda *a, **k: [],
        has_column=lambda *a, **k: False,
        set_value=lambda *a, **k: None,
        table_exists=lambda *a, **k: False,
    )
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cstr = lambda v="": "" if v is None else str(v)
    frappe_utils.add_to_date = lambda *a, **k: None
    frappe_utils.get_datetime = lambda *a, **k: None
    frappe_utils.cint = lambda v=0: int(v) if str(v).strip() not in ("", "None") else 0
    frappe_utils.flt = lambda v=0, *a, **k: float(v or 0)
    frappe_utils.nowdate = lambda: TODAY
    frappe_utils.getdate = lambda v=None: v or TODAY
    sys.modules["frappe.utils"] = frappe_utils
    frappe_module.utils = frappe_utils

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

    return frappe_module


def _load_utilities():
    name = "posawesome.posawesome.api.utilities"
    spec = importlib.util.spec_from_file_location(name, UTILITIES_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

_SAVED_MODULES = None


def setUpModule():
    global _SAVED_MODULES
    _SAVED_MODULES = sys.modules.copy()


def tearDownModule():
    for name in [key for key in sys.modules if key not in _SAVED_MODULES]:
        del sys.modules[name]
    for name, module in _SAVED_MODULES.items():
        if sys.modules.get(name) is not module:
            sys.modules[name] = module


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class UtilitiesGlobalResolutionCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe = _install_stubs()
        cls.utilities = _load_utilities()

    def test_no_function_reads_a_global_that_does_not_exist(self):
        module_names = set(vars(self.utilities)) | set(dir(builtins))
        missing = []

        for name, value in sorted(vars(self.utilities).items()):
            for func in self._functions_of(value):
                for instruction in dis.get_instructions(func):
                    if instruction.opname != "LOAD_GLOBAL":
                        continue
                    loaded = instruction.argval
                    if loaded not in module_names:
                        missing.append(f"{name} -> {loaded}")

        self.assertEqual(missing, [], f"undefined global names in utilities.py: {missing}")

    def test_the_retired_bundle_batch_hint_is_gone(self):
        """It must not come back by copy-paste: ERPNext v16 owns this allocation.

        Both names were removed with the call at
        `invoice_processing/creation.py`. A reintroduced hint would write a
        `packed_items.batch_no` that submit discards, and its `throw` branch
        would refuse sales ERPNext completes by splitting across batches.
        """
        for retired in ("set_batch_nos_for_bundels", "pick_batch_for_packed_item"):
            with self.subTest(name=retired):
                self.assertFalse(
                    hasattr(self.utilities, retired),
                    f"{retired} is back in utilities.py; see test_bundle_batch_native.py",
                )

    def _functions_of(self, value):
        """The function objects reachable from a module attribute."""
        code = getattr(value, "__code__", None)
        if code is not None:
            yield value
        wrapped = getattr(value, "__wrapped__", None)
        if wrapped is not None and getattr(wrapped, "__code__", None) is not None:
            yield wrapped


if __name__ == "__main__":
    unittest.main()
