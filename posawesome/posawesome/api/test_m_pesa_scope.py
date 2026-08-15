"""Standalone authorization tests for the M-Pesa endpoints.

Run without bench:
    python3 posawesome/posawesome/api/test_m_pesa_scope.py

Audit r2 P0: draft-payment listing leaked cross-company rows and
submit_mpesa_payment captured other companies' deposits. These tests pin
the kill-switch (silent-empty reads, loud mutation refusal) and the
company/docstatus/customer bindings.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
M_PESA_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "m_pesa.py"

_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


class _PermissionError(Exception):
    pass


class _ValidationError(Exception):
    pass


class _Register:
    def __init__(self, name, company, docstatus=0):
        self.name = name
        self.company = company
        self.docstatus = docstatus
        self.customer = None
        self.submit_payment = 0
        self.payment_entry = "ACC-PAY-MPESA-0001"
        self.submitted = False

    def submit(self):
        self.submitted = True

    def reload(self):
        pass


def _load_m_pesa(conf=None, registers=None, customers=None, allowed_companies=None):
    """Import m_pesa.py against a stub frappe; return (module, state)."""

    state = types.SimpleNamespace(
        get_all_calls=[],
        assert_company_calls=[],
        registers=registers or {},
        customers=set(customers or []),
        allowed=set(allowed_companies or []),
    )

    frappe_mod = types.ModuleType("frappe")
    frappe_mod.conf = conf or {}
    frappe_mod.session = types.SimpleNamespace(user="cashier@test")
    frappe_mod.PermissionError = _PermissionError
    frappe_mod.ValidationError = _ValidationError
    frappe_mod._ = lambda s: s

    def _whitelist(*args, **kwargs):
        def deco(fn):
            return fn

        return deco

    frappe_mod.whitelist = _whitelist

    def _throw(msg, exc=None):
        raise (exc or _ValidationError)(msg)

    frappe_mod.throw = _throw

    def _get_all(doctype, filters=None, fields=None, order_by=None):
        state.get_all_calls.append((doctype, filters))
        return []

    frappe_mod.get_all = _get_all

    def _get_doc(doctype, name=None):
        if doctype == "Mpesa Payment Register":
            return state.registers[name]
        if doctype == "Payment Entry":
            return {"doctype": "Payment Entry", "name": name}
        raise KeyError(doctype)

    frappe_mod.get_doc = _get_doc
    frappe_mod.db = types.SimpleNamespace(
        exists=lambda doctype, name: doctype == "Customer" and name in state.customers,
        commit=lambda: None,
    )
    frappe_mod.new_doc = lambda doctype: _Register("new", "X")
    frappe_mod.log_error = lambda *a, **k: None
    frappe_mod.get_traceback = lambda: ""

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda v: int(v or 0)
    frappe_mod.utils = frappe_utils

    requests_mod = types.ModuleType("requests")
    requests_auth = types.ModuleType("requests.auth")
    requests_auth.HTTPBasicAuth = object
    requests_mod.auth = requests_auth

    scope_mod = types.ModuleType("posawesome.posawesome.api._scope")

    def _assert_company(user, company):
        state.assert_company_calls.append((user, company))
        if company not in state.allowed:
            raise _PermissionError(f"Not permitted for company {company}.")

    scope_mod.assert_company = _assert_company

    # Stubs stay installed for the process: m_pesa imports _scope lazily
    # at CALL time, so restoring sys.modules after exec_module would hand
    # those imports the real (absent) frappe stack. Parent packages must
    # exist for `from posawesome...._scope import ...` to resolve.
    sys.modules["frappe"] = frappe_mod
    sys.modules["frappe.utils"] = frappe_utils
    sys.modules["requests"] = requests_mod
    sys.modules["requests.auth"] = requests_auth
    for pkg in ("posawesome", "posawesome.posawesome", "posawesome.posawesome.api"):
        if pkg not in sys.modules or not isinstance(sys.modules[pkg], types.ModuleType):
            stub_pkg = types.ModuleType(pkg)
            stub_pkg.__path__ = []
            sys.modules[pkg] = stub_pkg
    sys.modules["posawesome.posawesome.api._scope"] = scope_mod

    spec = importlib.util.spec_from_file_location("m_pesa_under_test", M_PESA_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module, state


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestMpesaScope(unittest.TestCase):
    # ---------- reads ----------

    def test_draft_listing_silent_empty_when_mpesa_disabled(self):
        mod, state = _load_m_pesa(conf={})
        self.assertEqual(mod.get_mpesa_draft_payments("Other Co"), [])
        self.assertEqual(state.get_all_calls, [])

    def test_mode_listing_silent_empty_when_mpesa_disabled(self):
        mod, state = _load_m_pesa(conf={})
        self.assertEqual(mod.get_mpesa_mode_of_payment("Other Co"), [])
        self.assertEqual(state.get_all_calls, [])

    def test_draft_listing_rejects_foreign_company_when_enabled(self):
        mod, state = _load_m_pesa(
            conf={"posa_mpesa_enabled": 1}, allowed_companies={"Mine"}
        )
        with self.assertRaises(_PermissionError):
            mod.get_mpesa_draft_payments("Other Co")
        self.assertEqual(state.get_all_calls, [])

    def test_draft_listing_scoped_query_for_own_company(self):
        mod, state = _load_m_pesa(
            conf={"posa_mpesa_enabled": 1}, allowed_companies={"Mine"}
        )
        mod.get_mpesa_draft_payments("Mine")
        self.assertEqual(len(state.get_all_calls), 1)
        doctype, filters = state.get_all_calls[0]
        self.assertEqual(doctype, "Mpesa Payment Register")
        self.assertEqual(filters["company"], "Mine")
        self.assertEqual(filters["docstatus"], 0)

    # ---------- mutation ----------

    def _submit_fixture(self, **overrides):
        registers = {"REG-1": _Register("REG-1", overrides.pop("company", "Mine"))}
        registers["REG-1"].docstatus = overrides.pop("docstatus", 0)
        return _load_m_pesa(
            conf=overrides.pop("conf", {"posa_mpesa_enabled": 1}),
            registers=registers,
            customers=overrides.pop("customers", {"CUST-1"}),
            allowed_companies=overrides.pop("allowed_companies", {"Mine"}),
        )

    def test_submit_refuses_when_mpesa_disabled(self):
        mod, state = self._submit_fixture(conf={})
        with self.assertRaises(_PermissionError):
            mod.submit_mpesa_payment("REG-1", "CUST-1")
        self.assertFalse(state.registers["REG-1"].submitted)

    def test_submit_refuses_foreign_company_register(self):
        mod, state = self._submit_fixture(company="Other Co")
        with self.assertRaises(_PermissionError):
            mod.submit_mpesa_payment("REG-1", "CUST-1")
        self.assertFalse(state.registers["REG-1"].submitted)

    def test_submit_refuses_non_draft_register(self):
        mod, state = self._submit_fixture(docstatus=1)
        with self.assertRaises(_ValidationError):
            mod.submit_mpesa_payment("REG-1", "CUST-1")
        self.assertFalse(state.registers["REG-1"].submitted)

    def test_submit_refuses_expected_company_mismatch(self):
        mod, state = self._submit_fixture()
        with self.assertRaises(_PermissionError):
            mod.submit_mpesa_payment("REG-1", "CUST-1", expected_company="Other Co")
        self.assertFalse(state.registers["REG-1"].submitted)

    def test_submit_refuses_unknown_customer(self):
        mod, state = self._submit_fixture()
        with self.assertRaises(_ValidationError):
            mod.submit_mpesa_payment("REG-1", "GHOST")
        self.assertFalse(state.registers["REG-1"].submitted)

    def test_submit_happy_path_binds_customer_and_submits(self):
        mod, state = self._submit_fixture()
        result = mod.submit_mpesa_payment("REG-1", "CUST-1", expected_company="Mine")
        reg = state.registers["REG-1"]
        self.assertTrue(reg.submitted)
        self.assertEqual(reg.customer, "CUST-1")
        self.assertEqual(result["doctype"], "Payment Entry")


if __name__ == "__main__":
    unittest.main()
