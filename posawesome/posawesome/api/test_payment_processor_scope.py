"""Standalone authorization tests for the POS payment processor.

Run without bench:
    python3 posawesome/posawesome/api/test_payment_processor_scope.py
"""

from __future__ import annotations

import ast
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
PROCESSOR_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "payment_processing" / "processor.py"
FACADE_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "payment_entry.py"


class _PermissionError(Exception):
    pass


class _DoesNotExistError(Exception):
    pass


class _AttrDict(dict):
    __getattr__ = dict.get


class _Local:
    pass


class _FakePaymentEntry:
    def __init__(self, amount):
        self.doctype = "Payment Entry"
        self.name = "ACC-PAY-TEST-0001"
        self.paid_amount = amount
        self.received_amount = amount
        self.amount = amount
        self.paid_to_account_currency = "MXN"
        self.company_currency = "MXN"
        self.party_account_currency = "MXN"
        self.target_exchange_rate = None
        self.references = []
        self.saved = False
        self.submitted = False

    def append(self, fieldname, value):
        if fieldname == "references":
            self.references.append(_AttrDict(value))

    def save(self, ignore_permissions=False):
        self.saved = ignore_permissions

    def submit(self):
        self.submitted = True

    def get(self, key, default=None):
        return getattr(self, key, default)


def _scenario():
    profiles = {
        "Allowed POS": _AttrDict(
            name="Allowed POS",
            company="Tenant A",
            cost_center="Trusted CC - A",
            posa_use_pos_awesome_payments=1,
            posa_allow_make_new_payments=1,
            posa_allow_reconcile_payments=1,
            posa_allow_mpesa_reconcile_payments=1,
        ),
        "Make Payments Off": _AttrDict(
            name="Make Payments Off",
            company="Tenant A",
            cost_center="Trusted CC - A",
            posa_use_pos_awesome_payments=1,
            posa_allow_make_new_payments=0,
            posa_allow_reconcile_payments=0,
            posa_allow_mpesa_reconcile_payments=0,
        ),
        "Foreign POS": _AttrDict(
            name="Foreign POS",
            company="Tenant B",
            cost_center="Foreign CC - B",
            posa_use_pos_awesome_payments=1,
            posa_allow_make_new_payments=1,
            posa_allow_reconcile_payments=1,
            posa_allow_mpesa_reconcile_payments=1,
        ),
    }
    return {
        "user": "cashier@example.com",
        "profiles": profiles,
        "assigned_profiles": {"Allowed POS", "Make Payments Off"},
        "documents": {},
        "denied_documents": set(),
    }


def _install_module(name, module):
    sys.modules[name] = module
    parent_name, _, child_name = name.rpartition(".")
    if parent_name in sys.modules:
        setattr(sys.modules[parent_name], child_name, module)


def _install_packages():
    package_paths = {
        "posawesome": REPO_ROOT / "posawesome",
        "posawesome.posawesome": REPO_ROOT / "posawesome" / "posawesome",
        "posawesome.posawesome.api": REPO_ROOT / "posawesome" / "posawesome" / "api",
        "posawesome.posawesome.api.payment_processing": (
            REPO_ROOT / "posawesome" / "posawesome" / "api" / "payment_processing"
        ),
    }
    for name, path in package_paths.items():
        module = types.ModuleType(name)
        module.__path__ = [str(path)]
        _install_module(name, module)


def _install_frappe(scenario):
    frappe = types.ModuleType("frappe")
    frappe._ = lambda text: text
    frappe._dict = lambda value: _AttrDict(value)
    frappe.PermissionError = _PermissionError
    frappe.DoesNotExistError = _DoesNotExistError
    frappe.session = types.SimpleNamespace(user=scenario["user"])
    frappe.local = _Local()
    frappe.flags = types.SimpleNamespace(ignore_permissions=False)
    frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe.get_roles = lambda user: []
    frappe.log_error = lambda *args, **kwargs: None
    frappe.msgprint = lambda *args, **kwargs: None

    def throw(message, exc_type=Exception):
        raise exc_type(message)

    frappe.throw = throw

    def get_all(doctype, filters=None, fields=None, ignore_permissions=False):
        if doctype == "POS Profile User":
            return [
                {"parent": name}
                for name in scenario["assigned_profiles"]
                if (filters or {}).get("user") == scenario["user"]
            ]
        if doctype == "POS Customer Group":
            return []
        return []

    frappe.get_all = get_all

    def get_cached_doc(doctype, name):
        if doctype == "POS Profile":
            document = scenario["profiles"].get(name)
        else:
            document = scenario["documents"].get((doctype, name))
        if document is None:
            raise _DoesNotExistError(f"{doctype} {name} not found")
        return document

    frappe.get_cached_doc = get_cached_doc
    frappe.get_doc = get_cached_doc
    frappe.get_cached_value = lambda doctype, name, fieldname: "MXN" if doctype == "Company" else None

    def has_permission(doctype, permission_type, name=None, throw=False):
        allowed = (doctype, name) not in scenario["denied_documents"]
        if not allowed and throw:
            raise _PermissionError(f"No {permission_type} access to {doctype} {name}")
        return allowed

    frappe.has_permission = has_permission

    class _Db:
        def sql(self, query, params=None, as_dict=False):
            return [
                {"profile": name, "company": scenario["profiles"][name].company}
                for name in scenario["assigned_profiles"]
            ]

        def get_value(self, doctype, name, fieldname=None):
            return None

        def get_descendants(self, doctype, group):
            return []

        def get_default(self, fieldname):
            return 2

    frappe.db = _Db()

    utils = types.ModuleType("frappe.utils")
    utils.nowdate = lambda: "2026-08-12"
    utils.flt = (
        lambda value, precision=None: round(float(value or 0), int(precision))
        if precision
        else float(value or 0)
    )
    utils.fmt_money = lambda value, currency=None: f"{currency or ''} {value}".strip()
    utils.cint = lambda value: int(value or 0)
    frappe.utils = utils

    _install_module("frappe", frappe)
    _install_module("frappe.utils", utils)


def _install_dependencies():
    party = types.ModuleType("erpnext.accounts.party")
    party.get_party_account = lambda *args, **kwargs: "Debtors - A"
    _install_module("erpnext", types.ModuleType("erpnext"))
    _install_module("erpnext.accounts", types.ModuleType("erpnext.accounts"))
    _install_module("erpnext.accounts.party", party)

    reconciliation = types.ModuleType(
        "erpnext.accounts.doctype.payment_reconciliation.payment_reconciliation"
    )
    reconciliation.reconcile_dr_cr_note = lambda *args, **kwargs: None
    _install_module("erpnext.accounts.doctype", types.ModuleType("erpnext.accounts.doctype"))
    _install_module(
        "erpnext.accounts.doctype.payment_reconciliation",
        types.ModuleType("erpnext.accounts.doctype.payment_reconciliation"),
    )
    _install_module(
        "erpnext.accounts.doctype.payment_reconciliation.payment_reconciliation",
        reconciliation,
    )

    accounts_utils = types.ModuleType("erpnext.accounts.utils")
    accounts_utils.get_account_currency = lambda account: "MXN"
    accounts_utils.reconcile_against_document = lambda *args, **kwargs: None
    _install_module("erpnext.accounts.utils", accounts_utils)

    setup_utils = types.ModuleType("erpnext.setup.utils")
    setup_utils.get_exchange_rate = lambda *args, **kwargs: 1
    _install_module("erpnext.setup", types.ModuleType("erpnext.setup"))
    _install_module("erpnext.setup.utils", setup_utils)

    mpesa = types.ModuleType("posawesome.posawesome.api.m_pesa")
    mpesa.submit_mpesa_payment = lambda *args, **kwargs: None
    _install_module("posawesome.posawesome.api.m_pesa", mpesa)

    creation = types.ModuleType("posawesome.posawesome.api.payment_processing.creation")
    creation.create_payment_entry = lambda *args, **kwargs: None
    _install_module("posawesome.posawesome.api.payment_processing.creation", creation)

    idempotency = types.ModuleType("posawesome.posawesome.api.idempotency")
    idempotency.normalize_client_request_id = lambda value: (value or "").strip() or None
    idempotency.find_payment_entries_by_client_request_id = lambda value: []
    _install_module("posawesome.posawesome.api.idempotency", idempotency)


def _load_processor(scenario):
    _install_packages()
    _install_frappe(scenario)
    _install_dependencies()
    sys.modules.pop("posawesome.posawesome.api._scope", None)
    sys.modules.pop("posawesome.posawesome.api.payment_processing.processor", None)
    spec = importlib.util.spec_from_file_location(
        "posawesome.posawesome.api.payment_processing.processor",
        PROCESSOR_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    _install_module(spec.name, module)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def _payload(profile_name="Allowed POS"):
    return {
        "customer": "CUST-001",
        "party": "CUST-001",
        "party_type": "Customer",
        "payment_type": "Receive",
        "company": "Forged Company",
        "currency": "MXN",
        "pos_profile_name": profile_name,
        "pos_opening_shift_name": "OPEN-001",
        "selected_invoices": [],
        "selected_payments": [],
        "selected_mpesa_payments": [],
        "payment_methods": [],
        "total_selected_invoices": 0,
        "total_selected_payments": 0,
        "total_selected_mpesa_payments": 0,
        "total_payment_methods": 0,
        "pos_profile": {
            "posa_use_pos_awesome_payments": 1,
            "posa_allow_make_new_payments": 1,
            "posa_allow_reconcile_payments": 1,
            "posa_allow_mpesa_reconcile_payments": 1,
            "cost_center": "Forged CC",
        },
    }


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class PaymentProcessorScopeTests(unittest.TestCase):
    def test_unassigned_profile_is_rejected(self):
        scenario = _scenario()
        processor = _load_processor(scenario)

        with self.assertRaises(_PermissionError):
            processor.process_pos_payment(json.dumps(_payload("Foreign POS")))

    def test_fabricated_client_flags_cannot_override_server_profile(self):
        scenario = _scenario()
        processor = _load_processor(scenario)
        payload = _payload("Make Payments Off")
        payload["payment_methods"] = [{"mode_of_payment": "Cash", "amount": 25}]
        payload["total_payment_methods"] = 25

        with self.assertRaisesRegex(_PermissionError, "Creating new payments is not enabled"):
            processor.process_pos_payment(json.dumps(payload))

    def test_legit_profile_uses_server_company_and_cost_center(self):
        scenario = _scenario()
        processor = _load_processor(scenario)
        payload = _payload()
        payload["payment_methods"] = [{"mode_of_payment": "Cash", "amount": 25}]
        payload["total_payment_methods"] = 25
        payment_entry = _FakePaymentEntry(25)

        with patch.object(processor, "create_payment_entry", return_value=payment_entry) as create:
            result = processor.process_pos_payment(json.dumps(payload))

        self.assertEqual(create.call_args.kwargs["company"], "Tenant A")
        self.assertEqual(create.call_args.kwargs["cost_center"], "Trusted CC - A")
        self.assertTrue(payment_entry.saved)
        self.assertTrue(payment_entry.submitted)
        self.assertEqual(result["new_payments_entry"][0]["name"], payment_entry.name)

    def test_selected_accounting_documents_require_read_permission(self):
        cases = (
            (
                "target invoice",
                "Sales Invoice",
                "SINV-DENIED",
                {"selected_invoices": [{"voucher_no": "SINV-DENIED", "voucher_type": "Sales Invoice"}]},
            ),
            (
                "credit note",
                "Sales Invoice",
                "SINV-CREDIT-DENIED",
                {
                    "selected_payments": [
                        {"name": "SINV-CREDIT-DENIED", "voucher_type": "Sales Invoice", "is_credit_note": 1}
                    ],
                    "total_selected_payments": 10,
                },
            ),
            (
                "payment entry",
                "Payment Entry",
                "ACC-PAY-DENIED",
                {
                    "selected_payments": [
                        {"name": "ACC-PAY-DENIED", "voucher_type": "Payment Entry"}
                    ],
                    "total_selected_payments": 10,
                },
            ),
        )

        for label, doctype, name, changes in cases:
            with self.subTest(label=label):
                scenario = _scenario()
                scenario["denied_documents"].add((doctype, name))
                processor = _load_processor(scenario)
                payload = _payload()
                payload.update(changes)

                with self.assertRaises(_PermissionError):
                    processor.process_pos_payment(json.dumps(payload))

    def test_cross_company_invoice_is_rejected_but_legit_invoice_passes(self):
        scenario = _scenario()
        scenario["documents"][("Sales Invoice", "SINV-FOREIGN")] = _AttrDict(
            name="SINV-FOREIGN",
            company="Tenant B",
            customer="CUST-001",
            outstanding_amount=10,
            conversion_rate=1,
        )
        processor = _load_processor(scenario)
        payload = _payload()
        payload["selected_invoices"] = [
            {"voucher_no": "SINV-FOREIGN", "voucher_type": "Sales Invoice", "outstanding_amount": 10}
        ]

        with self.assertRaises(_PermissionError):
            processor.process_pos_payment(json.dumps(payload))

        scenario = _scenario()
        scenario["documents"][("Sales Invoice", "SINV-OWN")] = _AttrDict(
            name="SINV-OWN",
            company="Tenant A",
            customer="CUST-001",
            outstanding_amount=0,
            conversion_rate=1,
        )
        processor = _load_processor(scenario)
        payload = _payload()
        payload["selected_invoices"] = [
            {"voucher_no": "SINV-OWN", "voucher_type": "Sales Invoice", "outstanding_amount": 0}
        ]

        result = processor.process_pos_payment(json.dumps(payload))
        self.assertEqual(result["errors"], [])

    def test_compatibility_facade_is_post_only(self):
        tree = ast.parse(FACADE_PATH.read_text())
        function = next(
            node
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "process_pos_payment"
        )
        whitelist = next(
            decorator
            for decorator in function.decorator_list
            if isinstance(decorator, ast.Call) and ast.unparse(decorator.func) == "frappe.whitelist"
        )
        methods = next(keyword.value for keyword in whitelist.keywords if keyword.arg == "methods")
        self.assertEqual(ast.literal_eval(methods), ["POST"])


if __name__ == "__main__":
    unittest.main()
