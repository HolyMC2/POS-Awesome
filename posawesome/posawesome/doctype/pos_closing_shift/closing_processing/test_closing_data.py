"""Standalone security tests for closing-shift invoice reads/submission.

Run without bench:
    python3 posawesome/posawesome/doctype/pos_closing_shift/closing_processing/test_closing_data.py
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import types
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[5]

# Standalone stub test: it swaps a fake `frappe` into sys.modules from inside its
# scenarios, which would pollute the real module under `bench run-tests`. Skip in
# that context (same guard as test_reprice.py / test_scope.py); run directly with
# `python3 test_closing_data.py`.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


class _PermissionError(Exception):
    pass


class _ValidationError(Exception):
    pass


class _DoesNotExistError(Exception):
    pass


class _AttrDict(dict):
    def __getattr__(self, key):
        try:
            return self[key]
        except KeyError as exc:
            raise AttributeError(key) from exc

    def __setattr__(self, key, value):
        self[key] = value


class _InvoiceDoc:
    def __init__(self, name="SINV-0001"):
        self.name = name
        self.direct_submit_calls = 0
        self._values = {
            "doctype": "Sales Invoice",
            "name": name,
            "docstatus": 0,
            "pos_profile": "Main POS",
            "company": "Doco",
            "customer": "Walk-in",
            "posa_pos_opening_shift": "OPEN-1",
            "posa_is_printed": 1,
            "is_return": 0,
            "items": [],
        }

    def get(self, key, default=None):
        return self._values.get(key, default)

    def as_dict(self):
        return dict(self._values)

    def submit(self):
        self.direct_submit_calls += 1


def _install_package(name, path):
    module = types.ModuleType(name)
    module.__path__ = [str(path)]
    sys.modules[name] = module


def _import_modules(scenario):
    for name, relative in (
        ("posawesome", "posawesome"),
        ("posawesome.posawesome", "posawesome/posawesome"),
        ("posawesome.posawesome.api", "posawesome/posawesome/api"),
        (
            "posawesome.posawesome.api.invoice_processing",
            "posawesome/posawesome/api/invoice_processing",
        ),
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
    frappe_module.ValidationError = _ValidationError
    frappe_module.DoesNotExistError = _DoesNotExistError
    frappe_module.session = types.SimpleNamespace(user=scenario.get("session_user", "cashier@doco"))
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module._dict = lambda value=None, **kwargs: _AttrDict(value or kwargs)
    frappe_module.get_roles = lambda user=None: scenario.get("roles", [])
    frappe_module.flags = _AttrDict()

    def _throw(message, exc_type=Exception, **kwargs):
        raise exc_type(message)

    frappe_module.throw = _throw

    class _Db:
        def __init__(self):
            self.get_value_calls = []
            self.sql_calls = []

        def get_value(self, doctype, name, fieldname=None, as_dict=False, **kwargs):
            self.get_value_calls.append((doctype, name, fieldname, as_dict))
            if doctype == "POS Opening Shift":
                shift = scenario.get(
                    "opening_shift",
                    {
                        "name": "OPEN-1",
                        "pos_profile": "Main POS",
                        "company": "Doco",
                        "user": "cashier@doco",
                    },
                )
                return _AttrDict(shift) if shift else None
            if doctype == "POS Profile" and fieldname == "create_pos_invoice_instead_of_sales_invoice":
                return scenario.get("use_pos_invoice", 0)
            if doctype == "Saldo Transaction":
                return "Success"
            return None

        def sql(self, query, params=None, as_dict=False):
            self.sql_calls.append((query, params, as_dict))
            return []

        def has_column(self, doctype, fieldname):
            return False

    frappe_module.db = _Db()

    def _get_all(doctype, **kwargs):
        scenario.setdefault("get_all_calls", []).append((doctype, kwargs))
        if doctype == "POS Invoice Submission Ledger":
            return [_AttrDict(row) for row in scenario.get("ledger_rows", [])]
        if doctype in {"Sales Invoice", "POS Invoice"}:
            return [_AttrDict(row) for row in scenario.get("invoice_rows", [])]
        return []

    frappe_module.get_all = _get_all

    def _get_doc(doctype, name):
        # is_closing_supervisor falls back to the employees supervisor-flag
        # read (frappe.get_doc("User", ...)) when the session user holds no
        # closing role; return a plain enabled user with no supervisor flag.
        if doctype == "User":
            return _AttrDict({"name": name, "enabled": 1})
        return scenario["invoice_docs"][name]

    frappe_module.get_doc = _get_doc
    sys.modules["frappe"] = frappe_module

    utils_module = types.ModuleType("frappe.utils")
    utils_module.cint = lambda value: int(value or 0)
    sys.modules["frappe.utils"] = utils_module

    scope_module = types.ModuleType("posawesome.posawesome.api._scope")

    def _assert_profile(user, profile):
        scenario.setdefault("profile_assertions", []).append((user, profile))

    def _assert_company(user, company):
        scenario.setdefault("company_assertions", []).append((user, company))

    scope_module.assert_profile = _assert_profile
    scope_module.assert_company = _assert_company
    sys.modules[scope_module.__name__] = scope_module

    creation_module = types.ModuleType("posawesome.posawesome.api.invoice_processing.creation")

    def _submit_invoice(invoice, data, submit_in_background=False):
        scenario.setdefault("hardened_submissions", []).append(
            {
                "invoice": json.loads(invoice),
                "data": json.loads(data),
                "submit_in_background": submit_in_background,
            }
        )
        if scenario.get("hardened_error"):
            raise scenario["hardened_error"]
        return scenario.get("submit_result", {"docstatus": 1})

    creation_module.submit_invoice = _submit_invoice
    sys.modules[creation_module.__name__] = creation_module

    merge_module_name = "erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log"
    for package in (
        "erpnext",
        "erpnext.accounts",
        "erpnext.accounts.doctype",
        "erpnext.accounts.doctype.pos_invoice_merge_log",
    ):
        _install_package(package, REPO_ROOT)
    merge_module = types.ModuleType(merge_module_name)
    merge_module.consolidate_pos_invoices = lambda **kwargs: None
    sys.modules[merge_module_name] = merge_module

    invoices_name = (
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices"
    )
    data_name = "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data"
    sys.modules.pop(invoices_name, None)
    sys.modules.pop(data_name, None)

    invoices_spec = importlib.util.spec_from_file_location(
        invoices_name,
        REPO_ROOT
        / "posawesome/posawesome/doctype/pos_closing_shift/closing_processing/invoices.py",
    )
    invoices = importlib.util.module_from_spec(invoices_spec)
    sys.modules[invoices_name] = invoices
    assert invoices_spec.loader
    invoices_spec.loader.exec_module(invoices)

    data_spec = importlib.util.spec_from_file_location(
        data_name,
        REPO_ROOT / "posawesome/posawesome/doctype/pos_closing_shift/closing_processing/data.py",
    )
    data = importlib.util.module_from_spec(data_spec)
    sys.modules[data_name] = data
    assert data_spec.loader
    data_spec.loader.exec_module(data)
    return frappe_module, invoices, data


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class ClosingShiftSecurityTests(unittest.TestCase):
    def test_malicious_doctype_is_rejected_before_database_access(self):
        scenario = {}
        frappe, _, data = _import_modules(scenario)

        with self.assertRaises(_ValidationError):
            data.get_pos_invoices(
                "OPEN-1",
                "Sales Invoice` WHERE 1=1--",
                submit_printed=0,
            )

        self.assertEqual(frappe.db.get_value_calls, [])
        self.assertEqual(frappe.db.sql_calls, [])

    def test_both_valid_doctypes_are_accepted_and_server_derived(self):
        for requested_doctype, use_pos_invoice, expected_table in (
            ("Sales Invoice", 0, "`tabSales Invoice`"),
            ("POS Invoice", 1, "`tabPOS Invoice`"),
        ):
            with self.subTest(doctype=requested_doctype):
                scenario = {"use_pos_invoice": use_pos_invoice}
                frappe, _, data = _import_modules(scenario)

                self.assertEqual(
                    data.get_pos_invoices("OPEN-1", requested_doctype, submit_printed=0),
                    [],
                )
                self.assertIn(expected_table, frappe.db.sql_calls[0][0])

    def test_read_endpoint_does_not_submit_printed_drafts(self):
        scenario = {}
        _, _, data = _import_modules(scenario)

        data.get_pos_invoices("OPEN-1", "Sales Invoice", submit_printed=1)

        self.assertNotIn("hardened_submissions", scenario)

    def test_foreign_shift_is_rejected_after_profile_and_company_scope(self):
        scenario = {
            "opening_shift": {
                "name": "OPEN-OTHER",
                "pos_profile": "Main POS",
                "company": "Doco",
                "user": "other@doco",
            }
        }
        _, invoices, _ = _import_modules(scenario)

        with self.assertRaises(_PermissionError):
            invoices.submit_printed_invoices("OPEN-OTHER", "Sales Invoice")

        self.assertEqual(scenario["profile_assertions"], [("cashier@doco", "Main POS")])
        self.assertEqual(scenario["company_assertions"], [("cashier@doco", "Doco")])
        self.assertNotIn("hardened_submissions", scenario)

    def test_owner_draft_uses_hardened_submit_and_preserves_ledger_context(self):
        invoice_doc = _InvoiceDoc()
        scenario = {
            "invoice_rows": [{"name": invoice_doc.name}],
            "invoice_docs": {invoice_doc.name: invoice_doc},
            "ledger_rows": [{"request_data": '{"is_credit_sale": 1}'}],
        }
        _, invoices, _ = _import_modules(scenario)

        result = invoices.submit_printed_invoices("OPEN-1", "Sales Invoice")

        self.assertEqual(result, [])
        self.assertEqual(invoice_doc.direct_submit_calls, 0)
        self.assertEqual(len(scenario["hardened_submissions"]), 1)
        submission = scenario["hardened_submissions"][0]
        self.assertEqual(submission["invoice"]["name"], invoice_doc.name)
        self.assertTrue(submission["invoice"]["posa_client_request_id"].startswith("closing-shift:"))
        self.assertEqual(submission["data"], {"is_credit_sale": 1})
        self.assertFalse(submission["submit_in_background"])

    def test_doctored_draft_is_blocked_by_hardened_submit(self):
        invoice_doc = _InvoiceDoc()
        scenario = {
            "invoice_rows": [{"name": invoice_doc.name}],
            "invoice_docs": {invoice_doc.name: invoice_doc},
            "hardened_error": _ValidationError("Payment total does not match grand total"),
        }
        _, invoices, _ = _import_modules(scenario)

        with self.assertRaisesRegex(_ValidationError, "Payment total"):
            invoices.submit_printed_invoices("OPEN-1", "Sales Invoice")

        self.assertEqual(invoice_doc.direct_submit_calls, 0)
        self.assertEqual(len(scenario["hardened_submissions"]), 1)


if __name__ == "__main__":
    unittest.main()
