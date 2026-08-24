"""Load one API module by path, with stubs, and leave `sys.modules` as found.

WHY THIS EXISTS. Two facts about `posawesome/posawesome/api/` collide:

1. `api/__init__.py` imports the whole API surface (customers, items,
   invoices), so importing ANY module through the package needs an initialised
   site. `unittest discover` has none, and a test that only exercises pure
   functions should not need one.
2. Several sibling suites replace `sys.modules["frappe"]` and
   `sys.modules["frappe.utils"]` with stubs of their own and never put them
   back. Whatever runs after one of them sees that stub — and fails on the
   first helper the stub happened to lack.

Earlier attempts at (2) tried to REPAIR the real modules before loading. That
worked and then quietly disabled 238 tests: the stub suites gate themselves on
`callable(sys.modules["frappe"].init)` and skip when the real frappe is back.
Fixing one suite by silencing five others is worse than the problem.

So this does neither. It installs exactly the stubs the subject's module-level
imports need, loads the subject from its FILE, and restores `sys.modules` byte
for byte — including entries that did not exist, which are removed again. The
loaded module keeps references to the stubs it was given, which is what makes
it deterministic: no clock, no site, no collection order.

The stubs are deliberately minimal. Anything a test actually exercises should
be patched onto the loaded module by that test (`mock.patch.object(module,
"frappe", fake)`), not smuggled in here — a stub rich enough to run the code is
a second implementation nobody reads.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
from typing import Any

API_DIR = pathlib.Path(__file__).resolve().parent.parent

# Every `sys.modules` key this helper may touch. Listed rather than diffed so
# the restore is exact: a diff would also revert imports the SUBJECT made,
# which is not this function's business.
_TOUCHED = (
    "frappe",
    "frappe.utils",
    "frappe.model",
    "frappe.model.document",
    "posawesome",
    "posawesome.posawesome",
    "posawesome.posawesome.api",
    "posawesome.posawesome.api._scope",
)


class _PermissionError(Exception):
    pass


def _frappe_stub() -> types.ModuleType:
    """Enough `frappe` to satisfy a module-level `import frappe`.

    Nothing here does real work. A test that needs behaviour patches the
    loaded module's `frappe` attribute with a fake it controls.
    """
    module = types.ModuleType("frappe")
    module.__file__ = "<stub>"
    module._ = lambda text, *args, **kwargs: text
    module.PermissionError = _PermissionError
    module.session = types.SimpleNamespace(user="tester@example.com")
    module.whitelist = lambda *args, **kwargs: (lambda function: function)
    module.get_installed_apps = lambda: []
    module.get_roles = lambda user=None: []
    module.get_all = lambda *args, **kwargs: []
    module.get_doc = lambda *args, **kwargs: None
    module.enqueue = lambda *args, **kwargs: None
    module.log_error = lambda *args, **kwargs: None
    module.get_traceback = lambda: ""
    module.msgprint = lambda *args, **kwargs: None
    module.has_permission = lambda *args, **kwargs: True
    module.utils = types.SimpleNamespace(fmt_money=lambda value, currency=None: str(value))

    def _throw(message, exc_type=Exception):
        raise exc_type(message)

    module.throw = _throw
    module.db = types.SimpleNamespace(
        exists=lambda *args, **kwargs: False,
        get_value=lambda *args, **kwargs: None,
        get_single_value=lambda *args, **kwargs: None,
        set_value=lambda *args, **kwargs: None,
        has_column=lambda *args, **kwargs: False,
        count=lambda *args, **kwargs: 0,
    )
    return module


def _frappe_utils_stub() -> types.ModuleType:
    module = types.ModuleType("frappe.utils")
    module.__file__ = "<stub>"
    module.cint = lambda value=0: int(value or 0)
    module.flt = lambda value=0, *args, **kwargs: float(value or 0)
    module.cstr = lambda value="": str(value or "")
    # Fixed, not `date.today()`: a test that reads the clock is a test that
    # fails on the wrong afternoon.
    module.nowdate = lambda: "2026-08-23"
    module.add_days = lambda date, days: f"{date}+{days}"
    module.get_datetime = lambda value: value
    return module


def _scope_stub() -> types.ModuleType:
    """`_scope`'s asserts, as no-ops.

    Scope enforcement has its own suites (`test_scope`, `test_charge_requests_
    scope`); a module loaded here is being tested for what it COMPUTES, and a
    stub that threw would only prove the stub throws.
    """
    module = types.ModuleType("posawesome.posawesome.api._scope")
    module.__file__ = "<stub>"
    module.assert_company = lambda *args, **kwargs: None
    module.assert_profile = lambda *args, **kwargs: None
    module.assert_customer_in_profile = lambda *args, **kwargs: None
    module.assert_customers_in_profile = lambda *args, **kwargs: None
    module.get_allowed_companies = lambda *args, **kwargs: set()
    return module


def load_api_module(module_name: str, filename: str, extra: dict[str, Any] | None = None):
    """Load `api/<filename>` in isolation and restore `sys.modules` afterwards.

    `extra` adds or overrides `sys.modules` entries for a subject with an
    import this helper does not already cover — keep it small, and prefer
    patching the loaded module in the test over widening a stub here.
    """
    saved = {key: sys.modules.get(key) for key in _TOUCHED}
    saved.update({key: sys.modules.get(key) for key in (extra or {})})
    try:
        sys.modules["frappe"] = _frappe_stub()
        sys.modules["frappe.utils"] = _frappe_utils_stub()
        sys.modules["posawesome.posawesome.api._scope"] = _scope_stub()
        for key, value in (extra or {}).items():
            sys.modules[key] = value

        path = API_DIR / filename
        spec = importlib.util.spec_from_file_location(module_name, path)
        if not (spec and spec.loader):  # pragma: no cover - a typo in `filename`
            raise ImportError(f"cannot load {path}")
        module = importlib.util.module_from_spec(spec)
        # Registered before execution so a subject importing itself (or being
        # re-entered by a decorator) sees the same object.
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.modules.pop(module_name, None)
        for key, value in saved.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value
