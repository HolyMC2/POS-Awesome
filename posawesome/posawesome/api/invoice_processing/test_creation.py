import importlib.util
import json
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


class AttrDict(dict):
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__

    def update(self, other=None, **kwargs):
        if other:
            super().update(other)
        if kwargs:
            super().update(kwargs)
        return self

    def as_dict(self):
        return dict(self)

    def precision(self, _fieldname):
        return 2

    def set_missing_values(self):
        return None

    def calculate_taxes_and_totals(self):
        return None


class FakeDoc:
    def __init__(self, **kwargs):
        object.__setattr__(self, "_data", dict(kwargs))
        if "flags" not in self._data:
            self._data["flags"] = types.SimpleNamespace()

    def __getattr__(self, name):
        try:
            return self._data[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __setattr__(self, name, value):
        self._data[name] = value

    def get(self, key, default=None):
        return self._data.get(key, default)

    def update(self, other=None, **kwargs):
        if other:
            if isinstance(other, dict):
                self._data.update(other)
            else:
                self._data.update(getattr(other, "_data", {}))
        if kwargs:
            self._data.update(kwargs)
        return self

    def precision(self, _fieldname):
        return 2

    def set_missing_values(self):
        return None

    def calculate_taxes_and_totals(self):
        return None

    def as_dict(self):
        return dict(self._data)


def _install_framework_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_utils = types.ModuleType("frappe.utils")
    frappe_exceptions = types.ModuleType("frappe.exceptions")
    frappe_background_jobs = types.ModuleType("frappe.utils.background_jobs")

    class _FrappeDict(AttrDict):
        pass

    class TimestampMismatchError(Exception):
        pass

    class ValidationError(Exception):
        http_status_code = 417

    class PermissionError(ValidationError):
        http_status_code = 403

    # What frappe.db.sql raises for MariaDB 1020 / 1213 — creation.py subclasses
    # ValidationError off the module at import time, so both must be present.
    class QueryDeadlockError(Exception):
        pass

    class DuplicateEntryError(ValidationError):
        pass

    frappe_module.ValidationError = ValidationError
    frappe_module.PermissionError = PermissionError
    frappe_module.QueryDeadlockError = QueryDeadlockError
    frappe_module.DuplicateEntryError = DuplicateEntryError

    frappe_utils.cint = lambda value: int(value or 0)
    frappe_utils.flt = lambda value, precision=None: round(float(value or 0), precision or 2)
    frappe_utils.getdate = lambda value: value
    frappe_utils.nowdate = lambda: "2026-03-21"
    frappe_utils.money_in_words = lambda value, currency=None: f"{value} {currency or ''}".strip()

    frappe_module._dict = _FrappeDict
    frappe_module._ = lambda text: text

    def _throw(message, title=None, exc=None, **_kwargs):
        raise (exc or ValidationError)(message)

    frappe_module.throw = _throw
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.log_error = lambda *args, **kwargs: None

    # The P0 profile gates (posting date, returns, customer credit) read
    # these flags via get_cached_value; the stub profile has every gated
    # feature enabled so the tests exercise creation logic, not the gates
    # (test_profile_gates covers the gates on a real bench).
    _enabled_profile_flags = {
        "posa_allow_change_posting_date",
        "posa_allow_return",
        "use_customer_credit",
    }

    def _fake_get_cached_value(doctype, name=None, fieldname=None, *args, **kwargs):
        if doctype == "POS Profile" and fieldname in _enabled_profile_flags:
            return 1
        return None

    frappe_module.get_cached_value = _fake_get_cached_value
    frappe_module.get_cached_doc = lambda *args, **kwargs: _FrappeDict()
    # submit-hold gates iterate hooks; none registered in the stub env.
    frappe_module.get_hooks = lambda *args, **kwargs: []
    frappe_module.flags = types.SimpleNamespace(ignore_account_permission=False)
    publish_realtime_calls = []
    # Savepoint traffic is recorded so the draft-conflict tests can assert the
    # failed save was actually rolled back before the retry re-read the row.
    savepoint_calls = []
    frappe_module.db = types.SimpleNamespace(
        get_value=lambda *args, **kwargs: None,
        exists=lambda *args, **kwargs: False,
        rollback=lambda save_point=None: savepoint_calls.append(("rollback", save_point)),
        savepoint=lambda save_point: savepoint_calls.append(("savepoint", save_point)),
        release_savepoint=lambda save_point: savepoint_calls.append(("release", save_point)),
    )
    frappe_module._savepoint_calls = savepoint_calls
    frappe_module.get_doc = lambda *args, **kwargs: None
    frappe_module.publish_realtime = lambda *args, **kwargs: publish_realtime_calls.append(
        {"args": args, "kwargs": kwargs}
    )
    frappe_module.session = types.SimpleNamespace(user="test@example.com")
    # _scope._is_super consults roles; System Manager bypasses scope asserts
    # so these tests exercise creation logic, not scope (test_scope covers that).
    frappe_module.get_roles = lambda user=None: ["System Manager"]

    frappe_exceptions.TimestampMismatchError = TimestampMismatchError
    enqueue_calls = []

    def _enqueue(*args, **kwargs):
        enqueue_calls.append({"args": args, "kwargs": kwargs})
        return None

    frappe_background_jobs.enqueue = _enqueue
    frappe_module._enqueue_calls = enqueue_calls
    frappe_module._publish_realtime_calls = publish_realtime_calls

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils
    sys.modules["frappe.exceptions"] = frappe_exceptions
    sys.modules["frappe.utils.background_jobs"] = frappe_background_jobs

    return frappe_module, enqueue_calls


def _install_dependency_stubs():
    sales_invoice_module = types.ModuleType("erpnext.accounts.doctype.sales_invoice.sales_invoice")
    sales_invoice_module.get_bank_cash_account = lambda *args, **kwargs: None
    sys.modules["erpnext.accounts.doctype.sales_invoice.sales_invoice"] = sales_invoice_module

    processing_utils = types.ModuleType("posawesome.posawesome.api.invoice_processing.utils")
    processing_utils._get_return_validity_settings = lambda *_args, **_kwargs: (False, 0)
    processing_utils._validate_return_window = lambda *_args, **_kwargs: None
    processing_utils._resolve_effective_price_list = lambda *_args, **_kwargs: None
    processing_utils._build_invoice_remarks = lambda *_args, **_kwargs: ""
    processing_utils._set_return_valid_upto = lambda *_args, **_kwargs: None
    processing_utils.get_latest_rate = lambda *_args, **_kwargs: (1, "2026-03-21")
    sys.modules["posawesome.posawesome.api.invoice_processing.utils"] = processing_utils

    stock_module = types.ModuleType("posawesome.posawesome.api.invoice_processing.stock")
    stock_module._strip_client_freebies_from_payload = lambda *_args, **_kwargs: None
    stock_module._validate_stock_on_invoice = lambda *_args, **_kwargs: None
    stock_module._apply_item_name_overrides = lambda *_args, **_kwargs: None
    stock_module._deduplicate_free_items = lambda *_args, **_kwargs: None
    stock_module._merge_duplicate_taxes = lambda *_args, **_kwargs: None
    stock_module._auto_set_return_batches = lambda *_args, **_kwargs: None
    stock_module._collect_stock_errors = lambda *_args, **_kwargs: []
    stock_module._should_block = lambda *_args, **_kwargs: False
    sys.modules["posawesome.posawesome.api.invoice_processing.stock"] = stock_module

    payment_utils_module = types.ModuleType("posawesome.posawesome.api.payment_processing.utils")
    payment_utils_module.get_bank_cash_account = lambda *_args, **_kwargs: None
    sys.modules["posawesome.posawesome.api.payment_processing.utils"] = payment_utils_module

    utilities_module = types.ModuleType("posawesome.posawesome.api.utilities")
    utilities_module.ensure_child_doctype = lambda *_args, **_kwargs: None
    utilities_module.set_batch_nos_for_bundels = lambda *_args, **_kwargs: None
    sys.modules["posawesome.posawesome.api.utilities"] = utilities_module

    # submit_invoice lazily imports shifts.assert_shift_not_stale; the real
    # shifts module drags frappe + utilities.get_version into the harness.
    shifts_module = types.ModuleType("posawesome.posawesome.api.shifts")
    shifts_module.assert_shift_not_stale = lambda *_args, **_kwargs: None
    sys.modules["posawesome.posawesome.api.shifts"] = shifts_module

    payments_module = types.ModuleType("posawesome.posawesome.api.payments")
    payments_module.redeeming_customer_credit = lambda *_args, **_kwargs: None
    sys.modules["posawesome.posawesome.api.payments"] = payments_module


def _install_package_stubs():
    package_paths = {
        "posawesome": REPO_ROOT / "posawesome",
        "posawesome.posawesome": REPO_ROOT / "posawesome" / "posawesome",
        "posawesome.posawesome.api": REPO_ROOT / "posawesome" / "posawesome" / "api",
        "posawesome.posawesome.api.invoice_processing": (
            REPO_ROOT / "posawesome" / "posawesome" / "api" / "invoice_processing"
        ),
    }
    for name, path in package_paths.items():
        module = types.ModuleType(name)
        module.__path__ = [str(path)]
        sys.modules[name] = module


def _load_module():
    module_name = "posawesome.posawesome.api.invoice_processing.creation"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "invoice_processing" / "creation.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

# The setUpClass stubs also poison SIBLING standalone modules when the whole
# api tree runs in one process (`python -m unittest discover`): the thin
# shifts/frappe.utils fakes shadow the real modules for every file that runs
# after this one. Snapshot when this module's run window opens (NOT at import
# — discovery imports all modules first, and an import-time snapshot would
# roll back other files' import-time stubs), restore when it closes.
_SAVED_MODULES = None


def setUpModule():
    global _SAVED_MODULES
    _SAVED_MODULES = sys.modules.copy()


def tearDownModule():
    for name in [k for k in sys.modules if k not in _SAVED_MODULES]:
        del sys.modules[name]
    for name, module in _SAVED_MODULES.items():
        if sys.modules.get(name) is not module:
            sys.modules[name] = module

@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestUpdateInvoiceReturnPayments(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.enqueue_calls.clear()
        self.frappe._publish_realtime_calls.clear()

    def test_return_invoice_derives_missing_base_amount_from_amount(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name=None,
            pos_profile="Main POS",
            company="Test Company",
            currency="USD",
            posting_date="2026-03-21",
            is_return=1,
            return_against=None,
            items=[],
            payments=[
                FakeDoc(
                    amount=125,
                    base_amount=None,
                )
            ],
            taxes=[],
            flags=types.SimpleNamespace(ignore_pricing_rule=False, ignore_permissions=False),
            total=0,
            net_total=0,
            grand_total=0,
            rounded_total=0,
            discount_amount=0,
            paid_amount=0,
            base_paid_amount=0,
            conversion_rate=1,
            plc_conversion_rate=1,
            price_list_currency="USD",
        )

        self.creation.frappe.get_doc = lambda data: invoice_doc
        self.creation.frappe.get_cached_value = lambda *args, **kwargs: 0
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "is_return": 1,
                    "items": [],
                    "payments": [{"amount": 125, "base_amount": None}],
                }
            )
        )

        self.assertEqual(invoice_doc.payments[0].amount, -125)
        self.assertEqual(invoice_doc.payments[0].base_amount, -125)
        self.assertEqual(result["paid_amount"], -125)
        self.assertEqual(result["base_paid_amount"], -125)

    def test_return_invoice_derives_missing_amount_from_base_amount(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name=None,
            pos_profile="Main POS",
            company="Test Company",
            currency="USD",
            posting_date="2026-03-21",
            is_return=1,
            return_against=None,
            items=[],
            payments=[
                FakeDoc(
                    amount=None,
                    base_amount=125,
                )
            ],
            taxes=[],
            flags=types.SimpleNamespace(ignore_pricing_rule=False, ignore_permissions=False),
            total=0,
            net_total=0,
            grand_total=0,
            rounded_total=0,
            discount_amount=0,
            paid_amount=0,
            base_paid_amount=0,
            conversion_rate=1,
            plc_conversion_rate=1,
            price_list_currency="USD",
        )

        self.creation.frappe.get_doc = lambda data: invoice_doc
        self.creation.frappe.get_cached_value = lambda *args, **kwargs: 0
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "is_return": 1,
                    "items": [],
                    "payments": [{"amount": None, "base_amount": 125}],
                }
            )
        )

        self.assertEqual(invoice_doc.payments[0].amount, -125)
        self.assertEqual(invoice_doc.payments[0].base_amount, -125)
        self.assertEqual(result["paid_amount"], -125)
        self.assertEqual(result["base_paid_amount"], -125)

    def test_resolve_payment_amounts_recomputes_base_amount_from_server_rate(self):
        payment = FakeDoc(amount=12.34, base_amount=999)

        amount, base_amount = self.creation._resolve_payment_amounts(payment, conversion_rate=2)

        self.assertEqual(amount, 12.34)
        self.assertEqual(base_amount, 24.68)

    def test_return_outstanding_policy_targets_credit_note_when_original_is_fully_paid(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            is_return=1,
            is_pos=0,
            is_paid=0,
            return_against="ACC-SINV-2026-00005",
            rounded_total=-64,
            grand_total=-64,
            update_outstanding_for_self=0,
        )
        original_get_value = self.creation.frappe.db.get_value
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        try:
            self.creation._apply_return_outstanding_policy(invoice_doc)
        finally:
            self.creation.frappe.db.get_value = original_get_value

        self.assertEqual(invoice_doc.update_outstanding_for_self, 1)

    def test_return_outstanding_policy_targets_original_when_it_has_enough_outstanding(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            is_return=1,
            is_pos=0,
            is_paid=0,
            return_against="ACC-SINV-2026-00006",
            rounded_total=-64,
            grand_total=-64,
            update_outstanding_for_self=1,
        )
        original_get_value = self.creation.frappe.db.get_value
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 100
        try:
            self.creation._apply_return_outstanding_policy(invoice_doc)
        finally:
            self.creation.frappe.db.get_value = original_get_value

        self.assertEqual(invoice_doc.update_outstanding_for_self, 0)

    def test_linked_return_filters_only_erpnext_outstanding_info_messages(self):
        invoice_doc = FakeDoc(
            is_return=1,
            return_against="ACC-SINV-2026-00005",
        )
        original_local = getattr(self.creation.frappe, "local", None)
        self.creation.frappe.local = types.SimpleNamespace(
            message_log=[{"message": "Existing message"}]
        )

        def operation():
            self.creation.frappe.local.message_log.extend(
                [
                    {
                        "message": (
                            "The outstanding amount 0.0 is lesser than 64.0. "
                            "Updating the outstanding to this invoice."
                        )
                    },
                    {"message": "A separate warning that must remain"},
                    {
                        "message": (
                            "If you want the original invoice updated, uncheck "
                            "Update Outstanding for Self."
                        )
                    },
                ]
            )
            return "submitted"

        try:
            result = self.creation._run_without_return_outstanding_prompts(
                invoice_doc,
                operation,
            )
            filtered_messages = list(self.creation.frappe.local.message_log)
        finally:
            if original_local is None:
                del self.creation.frappe.local
            else:
                self.creation.frappe.local = original_local

        self.assertEqual(result, "submitted")
        self.assertEqual(
            filtered_messages,
            [
                {"message": "Existing message"},
                {"message": "A separate warning that must remain"},
            ],
        )


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestUpdateInvoiceDraftAuthorization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.frappe.session.user = "cashier-y@example.com"
        self.scope_calls = []
        self.is_supervisor = False
        self.original_exists = self.frappe.db.exists
        self.original_get_doc = self.frappe.get_doc

        self.scope_module_name = "posawesome.posawesome.api._scope"
        self.employees_module_name = "posawesome.posawesome.api.employees"
        self.original_scope_module = sys.modules.get(self.scope_module_name)
        self.original_employees_module = sys.modules.get(self.employees_module_name)

        def assert_profile(user, profile):
            self.scope_calls.append(("profile", user, profile))
            if user != "cashier-y@example.com" or profile != "Y POS":
                raise self.frappe.PermissionError("profile outside cashier scope")

        def assert_company(user, company):
            self.scope_calls.append(("company", user, company))
            if user != "cashier-y@example.com" or company != "Y Company":
                raise self.frappe.PermissionError("company outside cashier scope")

        scope_module = types.ModuleType(self.scope_module_name)
        scope_module.assert_profile = assert_profile
        scope_module.assert_company = assert_company
        sys.modules[self.scope_module_name] = scope_module

        employees_module = types.ModuleType(self.employees_module_name)
        employees_module._get_user_doc = lambda user: FakeDoc(name=user, enabled=1)
        employees_module._is_pos_supervisor = lambda _user_doc: self.is_supervisor
        sys.modules[self.employees_module_name] = employees_module

    def tearDown(self):
        self.frappe.db.exists = self.original_exists
        self.frappe.get_doc = self.original_get_doc
        if self.original_scope_module is None:
            sys.modules.pop(self.scope_module_name, None)
        else:
            sys.modules[self.scope_module_name] = self.original_scope_module
        if self.original_employees_module is None:
            sys.modules.pop(self.employees_module_name, None)
        else:
            sys.modules[self.employees_module_name] = self.original_employees_module

    def _fetch_draft(self, owner, pos_profile="Y POS", company="Y Company"):
        draft = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-Y-DRAFT",
            docstatus=0,
            owner=owner,
            pos_profile=pos_profile,
            company=company,
            customer="CUST-X",
        )
        self.frappe.db.exists = lambda doctype, name: (
            doctype == "Sales Invoice" and name == "SINV-Y-DRAFT"
        )
        self.frappe.get_doc = lambda doctype, name: draft
        return draft

    def _incoming_payload(self):
        return {
            "doctype": "Sales Invoice",
            "name": "SINV-Y-DRAFT",
            "pos_profile": "Y POS",
            "company": "Y Company",
            "customer": "CUST-Y",
        }

    def test_non_owner_cashier_cannot_mutate_existing_draft_in_own_scope(self):
        draft = self._fetch_draft("cashier-x@example.com")

        with self.assertRaises(self.frappe.PermissionError):
            self.creation._get_mutable_invoice_doc(
                self._incoming_payload(),
                "Sales Invoice",
            )

        self.assertEqual(draft.customer, "CUST-X")
        self.assertEqual(
            self.scope_calls,
            [
                ("profile", "cashier-y@example.com", "Y POS"),
                ("company", "cashier-y@example.com", "Y Company"),
            ],
        )

    def test_incoming_scope_cannot_replace_fetched_draft_scope(self):
        draft = self._fetch_draft(
            "cashier-y@example.com",
            pos_profile="X POS",
            company="X Company",
        )

        with self.assertRaises(self.frappe.PermissionError):
            self.creation._get_mutable_invoice_doc(
                self._incoming_payload(),
                "Sales Invoice",
            )

        self.assertEqual(draft.customer, "CUST-X")
        self.assertEqual(
            self.scope_calls,
            [("profile", "cashier-y@example.com", "X POS")],
        )

    def test_draft_owner_can_mutate_existing_draft(self):
        draft = self._fetch_draft("cashier-y@example.com")

        result = self.creation._get_mutable_invoice_doc(
            self._incoming_payload(),
            "Sales Invoice",
        )

        self.assertIs(result, draft)
        self.assertEqual(result.customer, "CUST-Y")
        self.assertEqual(
            self.scope_calls,
            [
                ("profile", "cashier-y@example.com", "Y POS"),
                ("company", "cashier-y@example.com", "Y Company"),
            ],
        )

    def test_assigned_pos_supervisor_can_mutate_another_owners_draft(self):
        draft = self._fetch_draft("cashier-x@example.com")
        self.is_supervisor = True

        result = self.creation._get_mutable_invoice_doc(
            self._incoming_payload(),
            "Sales Invoice",
        )

        self.assertIs(result, draft)
        self.assertEqual(result.customer, "CUST-Y")


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestReturnPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.original_get_cached_value = self.frappe.get_cached_value

    def tearDown(self):
        self.frappe.get_cached_value = self.original_get_cached_value

    def _set_profile_flags(self, **flags):
        self.frappe.get_cached_value = (
            lambda doctype, profile, fieldname: flags.get(fieldname, 0)
        )

    def test_unlinked_return_is_rejected_when_profile_policy_is_off(self):
        self._set_profile_flags(
            posa_allow_return=1,
            posa_allow_return_without_invoice=0,
        )
        invoice_doc = FakeDoc(
            is_return=1,
            return_against=None,
            pos_profile="Main POS",
        )

        with self.assertRaises(self.frappe.ValidationError):
            self.creation._validate_return_allowed(invoice_doc)

    def test_unlinked_return_is_allowed_when_profile_policy_is_on(self):
        self._set_profile_flags(
            posa_allow_return=1,
            posa_allow_return_without_invoice=1,
        )
        invoice_doc = FakeDoc(
            is_return=1,
            return_against=None,
            pos_profile="Main POS",
        )

        self.creation._validate_return_allowed(invoice_doc)

    def test_linked_return_is_unaffected_when_unlinked_policy_is_off(self):
        self._set_profile_flags(
            posa_allow_return=1,
            posa_allow_return_without_invoice=0,
        )
        invoice_doc = FakeDoc(
            is_return=1,
            return_against="SINV-ORIGINAL",
            pos_profile="Main POS",
        )

        self.creation._validate_return_allowed(invoice_doc)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestStaleNamedInvoiceHandling(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.enqueue_calls.clear()
        self.frappe._publish_realtime_calls.clear()

    def _build_invoice_doc(self, **overrides):
        base = {
            "doctype": "Sales Invoice",
            "name": None,
            "owner": "test@example.com",
            "pos_profile": "Main POS",
            "company": "Test Company",
            "currency": "USD",
            "posting_date": "2026-03-21",
            "is_return": 0,
            "return_against": None,
            "items": [],
            "payments": [],
            "taxes": [],
            "flags": types.SimpleNamespace(ignore_pricing_rule=False, ignore_permissions=False),
            "paid_amount": 0,
            "base_paid_amount": 0,
            "conversion_rate": 1,
            "plc_conversion_rate": 1,
            "price_list_currency": "USD",
            "total": 0,
            "net_total": 0,
            "grand_total": 0,
            "rounded_total": 0,
            "docstatus": 0,
        }
        base.update(overrides)
        return FakeDoc(**base)

    def test_update_invoice_creates_new_draft_when_named_doc_is_submitted(self):
        submitted_doc = self._build_invoice_doc(name="SINV-OLD", docstatus=1)
        fresh_doc = self._build_invoice_doc()
        created_payloads = []

        def fake_get_doc(*args):
            if len(args) == 2:
                return submitted_doc
            payload = dict(args[0])
            created_payloads.append(payload)
            return fresh_doc

        self.creation.frappe.db.exists = lambda doctype, name: name == "SINV-OLD"
        self.creation.frappe.get_doc = fake_get_doc
        # Backdating is gated on posa_allow_change_posting_date since the P0
        # backstop; these tests verify manual-posting preservation, so the
        # flag must be ON (the gate itself is covered by test_profile_gates).
        self.creation.frappe.get_cached_value = (
            lambda doctype=None, name=None, fieldname=None, *args, **kwargs: (
                1 if fieldname == "posa_allow_change_posting_date" else 0
            )
        )
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "SINV-OLD",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "items": [],
                    "payments": [],
                }
            )
        )

        self.assertEqual(len(created_payloads), 1)
        self.assertNotIn("name", created_payloads[0])
        self.assertEqual(result["docstatus"], 0)

    def test_update_invoice_recreated_draft_clears_stale_party_fields_from_submitted_doc(self):
        submitted_doc = self._build_invoice_doc(
            name="SINV-OLD",
            docstatus=1,
            customer="CUST-OLD",
            customer_name="Old Customer",
            customer_address="ADDR-OLD",
            shipping_address_name="SHIP-OLD",
            contact_person="CONT-OLD",
            address_display="Old Address",
            contact_display="Old Contact",
            contact_mobile="0300",
            contact_email="old@example.com",
            territory="Old Territory",
        )
        fresh_doc = self._build_invoice_doc()
        created_payloads = []

        def fake_get_doc(*args):
            if len(args) == 2:
                return submitted_doc
            payload = dict(args[0])
            created_payloads.append(payload)
            fresh_doc.update(payload)
            return fresh_doc

        self.creation.frappe.db.exists = lambda doctype, name: (
            doctype == "Sales Invoice" and name == "SINV-OLD"
        ) or (doctype == "Customer" and name == "CUST-NEW")
        self.creation.frappe.get_doc = fake_get_doc
        self.creation.frappe.get_cached_value = lambda *args, **kwargs: 0
        self.creation.frappe.db.get_value = lambda doctype, name, fieldname=None, **kwargs: (
            "New Customer"
            if doctype == "Customer" and fieldname == "customer_name" and name == "CUST-NEW"
            else None
        )
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "SINV-OLD",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "customer": "CUST-NEW",
                    "customer_name": "Old Customer",
                    "customer_address": "ADDR-OLD",
                    "shipping_address_name": "SHIP-OLD",
                    "contact_person": "CONT-OLD",
                    "address_display": "Old Address",
                    "contact_display": "Old Contact",
                    "contact_mobile": "0300",
                    "contact_email": "old@example.com",
                    "territory": "Old Territory",
                    "items": [],
                    "payments": [],
                }
            )
        )

        self.assertEqual(len(created_payloads), 1)
        self.assertNotIn("name", created_payloads[0])
        self.assertEqual(created_payloads[0].get("customer_address"), None)
        self.assertEqual(created_payloads[0].get("shipping_address_name"), None)
        self.assertEqual(created_payloads[0].get("contact_person"), None)
        self.assertEqual(created_payloads[0].get("address_display"), None)
        self.assertEqual(created_payloads[0].get("contact_display"), None)
        self.assertEqual(created_payloads[0].get("contact_mobile"), None)
        self.assertEqual(created_payloads[0].get("contact_email"), None)
        self.assertEqual(created_payloads[0].get("territory"), None)
        self.assertEqual(result["customer"], "CUST-NEW")
        self.assertEqual(result["customer_name"], "New Customer")

    def test_update_invoice_creates_new_draft_when_named_doc_is_missing(self):
        fresh_doc = self._build_invoice_doc()
        created_payloads = []

        def fake_get_doc(*args):
            payload = dict(args[0])
            created_payloads.append(payload)
            return fresh_doc

        self.creation.frappe.db.exists = lambda doctype, name: False
        self.creation.frappe.get_doc = fake_get_doc
        # Backdating is gated on posa_allow_change_posting_date since the P0
        # backstop; these tests verify manual-posting preservation, so the
        # flag must be ON (the gate itself is covered by test_profile_gates).
        self.creation.frappe.get_cached_value = (
            lambda doctype=None, name=None, fieldname=None, *args, **kwargs: (
                1 if fieldname == "posa_allow_change_posting_date" else 0
            )
        )
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "SINV-MISSING",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "items": [],
                    "payments": [],
                }
            )
        )

        self.assertEqual(len(created_payloads), 1)
        self.assertNotIn("name", created_payloads[0])
        self.assertEqual(result["docstatus"], 0)

    def test_update_invoice_clears_stale_party_fields_when_customer_changes(self):
        existing_doc = self._build_invoice_doc(
            name="SINV-DRAFT",
            docstatus=0,
            customer="CUST-OLD",
            customer_name="Old Customer",
            customer_address="ADDR-OLD",
            shipping_address_name="SHIP-OLD",
            contact_person="CONT-OLD",
            address_display="Old Address",
            contact_display="Old Contact",
            contact_mobile="0300",
            contact_email="old@example.com",
            territory="Old Territory",
        )

        self.creation.frappe.db.exists = lambda doctype, name: True
        self.creation.frappe.get_doc = lambda *args: existing_doc
        self.creation.frappe.get_cached_value = lambda *args, **kwargs: 0
        self.creation.frappe.db.get_value = lambda doctype, name, fieldname=None, **kwargs: (
            "New Customer"
            if doctype == "Customer" and fieldname == "customer_name" and name == "CUST-NEW"
            else None
        )
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "SINV-DRAFT",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "customer": "CUST-NEW",
                    "customer_name": "Old Customer",
                    "customer_address": "ADDR-OLD",
                    "shipping_address_name": "SHIP-OLD",
                    "contact_person": "CONT-OLD",
                    "address_display": "Old Address",
                    "contact_display": "Old Contact",
                    "contact_mobile": "0300",
                    "contact_email": "old@example.com",
                    "territory": "Old Territory",
                    "items": [],
                    "payments": [],
                }
            )
        )

        self.assertEqual(result["customer"], "CUST-NEW")
        self.assertEqual(result["customer_name"], "New Customer")
        self.assertIsNone(result.get("customer_address"))
        self.assertIsNone(result.get("shipping_address_name"))
        self.assertIsNone(result.get("contact_person"))
        self.assertIsNone(result.get("address_display"))
        self.assertIsNone(result.get("contact_display"))
        self.assertIsNone(result.get("contact_mobile"))
        self.assertIsNone(result.get("contact_email"))
        self.assertIsNone(result.get("territory"))

    def test_update_invoice_preserves_explicitly_changed_party_fields_for_new_customer(self):
        existing_doc = self._build_invoice_doc(
            name="SINV-DRAFT",
            docstatus=0,
            customer="CUST-OLD",
            customer_address="ADDR-OLD",
            shipping_address_name="SHIP-OLD",
            contact_person="CONT-OLD",
        )

        self.creation.frappe.db.exists = lambda doctype, name: True
        self.creation.frappe.get_doc = lambda *args: existing_doc
        self.creation.frappe.get_cached_value = lambda *args, **kwargs: 0
        self.creation.frappe.db.get_value = lambda doctype, name, fieldname=None, **kwargs: (
            "New Customer"
            if doctype == "Customer" and fieldname == "customer_name" and name == "CUST-NEW"
            else None
        )
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        result = self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "SINV-DRAFT",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "posting_date": "2026-03-21",
                    "customer": "CUST-NEW",
                    "customer_address": "ADDR-NEW",
                    "shipping_address_name": "SHIP-NEW",
                    "contact_person": "CONT-NEW",
                    "items": [],
                    "payments": [],
                }
            )
        )

        self.assertEqual(result.get("customer_address"), "ADDR-NEW")
        self.assertEqual(result.get("shipping_address_name"), "SHIP-NEW")
        self.assertEqual(result.get("contact_person"), "CONT-NEW")
        self.assertEqual(result.get("customer_name"), "New Customer")


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestPostSubmitPaymentProcessing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.enqueue_calls.clear()
        self.frappe._publish_realtime_calls.clear()

    def test_process_post_submit_payments_runs_inline_when_async_disabled(self):
        calls = []
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0001",
            pos_profile="Main POS",
            company="Test Company",
        )

        original_runner = self.creation._run_post_submit_payments
        self.creation._run_post_submit_payments = lambda *args, **kwargs: calls.append(("run", args))

        try:
            self.creation._process_post_submit_payments(
                invoice_doc,
                {"paid_change": 4},
                is_payment_entry=1,
                total_cash=590,
                cash_account={"account": "Cash"},
                payments=[{"mode_of_payment": "Cash", "amount": 600}],
                run_async=False,
            )
        finally:
            self.creation._run_post_submit_payments = original_runner

        self.assertEqual([call[0] for call in calls], ["run"])
        self.assertEqual(self.enqueue_calls, [])

    def test_process_post_submit_payments_enqueues_when_async_enabled(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0002",
            pos_profile="Main POS",
            company="Test Company",
        )

        self.creation._process_post_submit_payments(
            invoice_doc,
            {"paid_change": 4},
            is_payment_entry=1,
            total_cash=590,
            cash_account={"account": "Cash"},
            payments=[{"mode_of_payment": "Cash", "amount": 600}],
            run_async=True,
            user="cashier@example.com",
        )

        self.assertEqual(len(self.enqueue_calls), 1)
        queued = self.enqueue_calls[0]["kwargs"]
        self.assertEqual(queued["method"], self.creation.process_post_submit_payments_job)
        self.assertTrue(queued["is_async"])
        self.assertEqual(queued["kwargs"]["invoice"], "SINV-0002")
        self.assertEqual(queued["kwargs"]["doctype"], "Sales Invoice")
        self.assertEqual(queued["kwargs"]["data"], {"paid_change": 4})
        self.assertEqual(queued["kwargs"]["payments"], [{"mode_of_payment": "Cash", "amount": 600}])
        self.assertEqual(queued["kwargs"]["user"], "cashier@example.com")
        # _posa_publish_dual: one publish to the user room, one to the doc room
        self.assertEqual(len(self.frappe._publish_realtime_calls), 2)
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["args"][0],
            "pos_post_submit_payments_started",
        )
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["kwargs"]["user"],
            "cashier@example.com",
        )
        self.assertEqual(
            self.frappe._publish_realtime_calls[1]["args"][0],
            "pos_post_submit_payments_started",
        )
        self.assertEqual(
            self.frappe._publish_realtime_calls[1]["kwargs"]["docname"],
            "SINV-0002",
        )
        self.assertTrue(queued["enqueue_after_commit"])

    def test_run_post_submit_payments_passes_created_receive_entries_to_change_entry_creation(self):
        receive_entries = [{"name": "ACC-PAY-0001", "unallocated_amount": 4}]
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0005",
            pos_profile="Main POS",
            company="Test Company",
        )

        payment_module_name = "posawesome.posawesome.api.invoice_processing.payment"
        payment_module = types.ModuleType(payment_module_name)
        captured_calls = []
        payment_module._create_change_payment_entries = lambda *args, **kwargs: captured_calls.append(
            (args, kwargs)
        )
        sys.modules[payment_module_name] = payment_module

        original_redeem = self.creation.redeeming_customer_credit
        self.creation.redeeming_customer_credit = lambda *args, **kwargs: receive_entries

        try:
            self.creation._run_post_submit_payments(
                invoice_doc,
                {"paid_change": 4},
                is_payment_entry=1,
                total_cash=100,
                cash_account={"account": "Cash"},
                payments=[{"mode_of_payment": "Cash", "amount": 100}],
            )
        finally:
            self.creation.redeeming_customer_credit = original_redeem

        self.assertEqual(len(captured_calls), 1)
        self.assertEqual(captured_calls[0][0][4], receive_entries)

    def test_has_post_submit_payment_work_ignores_gift_card_redemptions(self):
        self.assertFalse(
            self.creation._has_post_submit_payment_work(
                {"gift_card_redemptions": [{"gift_card_code": "GC-0001", "amount": 150}]}
            )
        )

    def test_apply_invoice_gift_card_settlement_delegates_before_submit(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0006",
            pos_profile="Main POS",
            company="Test Company",
        )

        payment_module_name = "posawesome.posawesome.api.invoice_processing.payment"
        payment_module = types.ModuleType(payment_module_name)
        payment_module._create_change_payment_entries = lambda *args, **kwargs: None
        sys.modules[payment_module_name] = payment_module

        gift_card_module_name = "posawesome.posawesome.api.gift_cards"
        gift_card_calls = []
        gift_card_module = types.ModuleType(gift_card_module_name)
        gift_card_module.apply_invoice_gift_card_redemptions = (
            lambda invoice_doc, rows: gift_card_calls.append((invoice_doc, rows))
        )
        sys.modules[gift_card_module_name] = gift_card_module

        self.creation._apply_invoice_gift_card_settlement(
            invoice_doc,
            {
                "gift_card_redemptions": [
                    {"gift_card_code": "GC-0001", "amount": 150, "cashier": "cashier@example.com"}
                ]
            },
        )

        self.assertEqual(len(gift_card_calls), 1)
        self.assertIs(gift_card_calls[0][0], invoice_doc)
        self.assertEqual(gift_card_calls[0][1][0]["gift_card_code"], "GC-0001")
        self.assertEqual(gift_card_calls[0][1][0]["amount"], 150)

    def test_run_post_submit_payments_skips_gift_card_redemptions(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0006",
            pos_profile="Main POS",
            company="Test Company",
        )

        payment_module_name = "posawesome.posawesome.api.invoice_processing.payment"
        payment_module = types.ModuleType(payment_module_name)
        payment_module._create_change_payment_entries = lambda *args, **kwargs: None
        sys.modules[payment_module_name] = payment_module

        gift_card_module_name = "posawesome.posawesome.api.gift_cards"
        gift_card_calls = []
        gift_card_module = types.ModuleType(gift_card_module_name)
        gift_card_module.apply_invoice_gift_card_redemptions = lambda *args, **kwargs: gift_card_calls.append(
            (args, kwargs)
        )
        sys.modules[gift_card_module_name] = gift_card_module

        original_redeem = self.creation.redeeming_customer_credit
        self.creation.redeeming_customer_credit = lambda *args, **kwargs: []

        try:
            self.creation._run_post_submit_payments(
                invoice_doc,
                {
                    "gift_card_redemptions": [
                        {"gift_card_code": "GC-0001", "amount": 150, "cashier": "cashier@example.com"}
                    ]
                },
                is_payment_entry=0,
                total_cash=0,
                cash_account={"account": "Cash"},
                payments=[],
            )
        finally:
            self.creation.redeeming_customer_credit = original_redeem

        self.assertEqual(gift_card_calls, [])

    def test_process_post_submit_payments_job_publishes_completion_event(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0003",
            docstatus=1,
            pos_profile="Main POS",
            company="Test Company",
            flags=types.SimpleNamespace(ignore_permissions=False),
        )
        self.creation.frappe.get_doc = lambda doctype, name: invoice_doc

        calls = []
        original_runner = self.creation._run_post_submit_payments
        self.creation._run_post_submit_payments = lambda *args, **kwargs: calls.append(("run", args))

        try:
            self.creation.process_post_submit_payments_job(
                {
                    "invoice": "SINV-0003",
                    "doctype": "Sales Invoice",
                    "data": {"paid_change": 4},
                    "user": "test@example.com",
                }
            )
        finally:
            self.creation._run_post_submit_payments = original_runner

        self.assertEqual([call[0] for call in calls], ["run"])
        # _posa_publish_dual: one publish to the user room, one to the doc room
        self.assertEqual(len(self.frappe._publish_realtime_calls), 2)
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["args"][0],
            "pos_post_submit_payments_completed",
        )
        self.assertEqual(
            self.frappe._publish_realtime_calls[1]["kwargs"]["docname"],
            "SINV-0003",
        )

    def test_submit_in_background_job_uses_captured_user_for_submit_errors(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-ERR-0001",
            docstatus=0,
            pos_profile="Main POS",
            company="Test Company",
            customer="CUST-0001",
            is_return=0,
            redeem_loyalty_points=0,
            loyalty_program=None,
            cost_center=None,
            flags=types.SimpleNamespace(ignore_permissions=False),
        )
        invoice_doc.submit = lambda: (_ for _ in ()).throw(Exception("submit failed"))
        self.creation.frappe.get_doc = lambda doctype, name: invoice_doc
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation.frappe.session.user = "session-user@example.com"

        self.creation.submit_in_background_job(
            {
                "invoice": "SINV-ERR-0001",
                "doctype": "Sales Invoice",
                "data": {"paid_change": 4},
                "payments": [],
                "user": "cashier@example.com",
            }
        )

        self.assertGreaterEqual(len(self.frappe._publish_realtime_calls), 1)
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["args"][0],
            "pos_invoice_submit_error",
        )
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["kwargs"]["user"],
            "cashier@example.com",
        )

    def test_submit_in_background_job_publishes_invoice_processed_before_queueing_post_submit_work(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="SINV-0004",
            docstatus=0,
            pos_profile="Main POS",
            company="Test Company",
            customer="CUST-0001",
            is_return=0,
            redeem_loyalty_points=0,
            loyalty_program=None,
            cost_center=None,
            flags=types.SimpleNamespace(ignore_permissions=False),
        )
        invoice_doc.submit = lambda: setattr(invoice_doc, "docstatus", 1)
        self.creation.frappe.get_doc = lambda doctype, name: invoice_doc
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        self.creation.submit_in_background_job(
            {
                "invoice": "SINV-0004",
                "doctype": "Sales Invoice",
                "data": {"paid_change": 4},
                "payments": [],
                "user": "cashier@example.com",
            }
        )

        self.assertGreaterEqual(len(self.frappe._publish_realtime_calls), 1)
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["args"][0],
            "pos_invoice_processed",
        )
        self.assertEqual(
            self.frappe._publish_realtime_calls[0]["kwargs"]["user"],
            "cashier@example.com",
        )
        self.assertEqual(len(self.enqueue_calls), 1)
        self.assertEqual(
            self.enqueue_calls[0]["kwargs"]["kwargs"]["user"],
            "cashier@example.com",
        )


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestManualPostingDatePreservation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.enqueue_calls.clear()
        self.frappe._publish_realtime_calls.clear()

    def _build_invoice_doc(self, **overrides):
        base = {
            "doctype": "Sales Invoice",
            "name": None,
            "pos_profile": "Main POS",
            "company": "Test Company",
            "currency": "USD",
            "posting_date": "2026-03-21",
            "set_posting_time": 0,
            "customer": "CUST-0001",
            "customer_name": "Customer 1",
            "is_return": 0,
            "return_against": None,
            "items": [],
            "payments": [],
            "taxes": [],
            "flags": types.SimpleNamespace(ignore_pricing_rule=False, ignore_permissions=False),
            "paid_amount": 0,
            "base_paid_amount": 0,
            "conversion_rate": 1,
            "plc_conversion_rate": 1,
            "price_list_currency": "USD",
            "total": 0,
            "net_total": 0,
            "grand_total": 0,
            "rounded_total": 0,
            "docstatus": 0,
            "redeem_loyalty_points": 0,
            "loyalty_program": None,
            "loyalty_redemption_account": None,
            "loyalty_redemption_cost_center": None,
            "remarks": "",
            "update_stock": 1,
        }
        base.update(overrides)
        return FakeDoc(**base)

    def test_update_invoice_marks_backdated_payload_for_manual_posting(self):
        captured_payloads = []
        invoice_doc = self._build_invoice_doc()

        def fake_get_doc(*args):
            if len(args) == 1:
                payload = dict(args[0])
                captured_payloads.append(payload)
                invoice_doc.update(payload)
                return invoice_doc
            return invoice_doc

        self.creation.frappe.get_doc = fake_get_doc
        # Backdating is gated on posa_allow_change_posting_date since the P0
        # backstop; these tests verify manual-posting preservation, so the
        # flag must be ON (the gate itself is covered by test_profile_gates).
        self.creation.frappe.get_cached_value = (
            lambda doctype=None, name=None, fieldname=None, *args, **kwargs: (
                1 if fieldname == "posa_allow_change_posting_date" else 0
            )
        )
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc

        self.creation.update_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "customer": "CUST-0001",
                    "posting_date": "2026-03-19",
                    "items": [],
                    "payments": [],
                }
            )
        )

        self.assertEqual(captured_payloads[0]["posting_date"], "2026-03-19")
        self.assertEqual(captured_payloads[0]["set_posting_time"], 1)

    def test_submit_invoice_keeps_manual_posting_for_existing_backdated_draft(self):
        invoice_doc = self._build_invoice_doc(
            name="ACC-SINV-0001",
            posting_date="2026-03-19",
        )
        invoice_doc.submit = lambda: setattr(invoice_doc, "docstatus", 1)

        self.creation.frappe.db.exists = lambda doctype, name: name == "ACC-SINV-0001"
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = lambda *args: invoice_doc
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: None

        result = self.creation.submit_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "ACC-SINV-0001",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "customer": "CUST-0001",
                    "posting_date": "2026-03-19",
                    "items": [],
                    "payments": [],
                }
            ),
            json.dumps({}),
            submit_in_background=0,
        )

        self.assertEqual(invoice_doc.posting_date, "2026-03-19")
        self.assertEqual(invoice_doc.set_posting_time, 1)
        self.assertEqual(result["status"], 1)

    def test_submit_invoice_fresh_draft_keeps_the_tendered_payments(self):
        # A name-less submit — the offline queue replay — creates its draft
        # through update_invoice, whose set_missing_values rebuilds payments
        # from the POS Profile with NO amounts (ERPNext v16). The settlement
        # invariant then read 0 against 57 and the queued sale drafted for
        # review instead of syncing (live drill 2026-09-04). The tender the
        # register sent has to survive that save.
        draft = self._build_invoice_doc(
            name="ACC-SINV-FRESH-0001",
            total=57,
            net_total=57,
            grand_total=57,
            rounded_total=57,
            payments=[
                FakeDoc(
                    mode_of_payment="Cash",
                    type="Cash",
                    account="Cash - T",
                    default=1,
                    amount=0,
                    base_amount=0,
                )
            ],
        )
        seen_at_submit = {}

        def submit():
            seen_at_submit["amount"] = draft.payments[0].amount
            draft.docstatus = 1

        draft.submit = submit
        update_calls = []

        def fake_update_invoice(payload_json):
            update_calls.append(json.loads(payload_json))
            return {"name": "ACC-SINV-FRESH-0001"}

        self.addCleanup(setattr, self.creation, "update_invoice", self.creation.update_invoice)
        self.creation.update_invoice = fake_update_invoice
        self.creation.frappe.db.exists = lambda doctype, name: name == "ACC-SINV-FRESH-0001"
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = lambda *args: draft
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: None

        result = self.creation.submit_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "customer": "CUST-0001",
                    "posting_date": "2026-03-21",
                    "grand_total": 57,
                    "rounded_total": 57,
                    "items": [],
                    "payments": [
                        {"mode_of_payment": "Cash", "amount": 57, "base_amount": 57, "default": 1}
                    ],
                    "posa_client_request_id": "inv-offline-replay-001",
                }
            ),
            json.dumps({"idempotency_key": "inv-offline-replay-001"}),
            submit_in_background=0,
        )

        self.assertEqual(len(update_calls), 1)
        self.assertNotIn("name", update_calls[0])
        # The server-built row keeps its account/type; only the tender moves.
        self.assertEqual(draft.payments[0].amount, 57)
        self.assertEqual(draft.payments[0].base_amount, 57)
        self.assertEqual(draft.payments[0].account, "Cash - T")
        self.assertEqual(seen_at_submit["amount"], 57)
        self.assertEqual(result["status"], 1)

    def test_submit_invoice_fresh_draft_with_zeroed_payments_is_still_refused(self):
        # The invariant itself is untouched: a payload that really tenders
        # nothing against a 57 total must still die on the fresh path.
        draft = self._build_invoice_doc(
            name="ACC-SINV-FRESH-0002",
            grand_total=57,
            rounded_total=57,
            payments=[FakeDoc(mode_of_payment="Cash", type="Cash", amount=0, base_amount=0)],
        )
        draft.submit = lambda: setattr(draft, "docstatus", 1)
        self.addCleanup(setattr, self.creation, "update_invoice", self.creation.update_invoice)
        self.creation.update_invoice = lambda *_args, **_kwargs: {"name": "ACC-SINV-FRESH-0002"}
        self.creation.frappe.db.exists = lambda doctype, name: name == "ACC-SINV-FRESH-0002"
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = lambda *args: draft
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: None

        with self.assertRaises(Exception) as caught:
            self.creation.submit_invoice(
                json.dumps(
                    {
                        "doctype": "Sales Invoice",
                        "pos_profile": "Main POS",
                        "company": "Test Company",
                        "currency": "USD",
                        "customer": "CUST-0001",
                        "grand_total": 57,
                        "rounded_total": 57,
                        "items": [],
                        "payments": [{"mode_of_payment": "Cash", "amount": 0, "base_amount": 0}],
                    }
                ),
                json.dumps({}),
                submit_in_background=0,
            )
        self.assertIn("does not match grand total", str(caught.exception))
        self.assertEqual(draft.docstatus, 0)

    def test_submit_invoice_normalizes_existing_return_draft_payments_before_save(self):
        invoice_doc = self._build_invoice_doc(
            name="ACC-SINV-RETURN-0001",
            is_return=1,
            return_against="ACC-SINV-BASE-0001",
            additional_discount_percentage=10,
            discount_amount=-10,
            total=-100,
            net_total=-100,
            grand_total=-90,
            rounded_total=-90,
            payments=[
                FakeDoc(
                    mode_of_payment="Cash",
                    type="Cash",
                    amount=90,
                    base_amount=90,
                )
            ],
        )

        def assert_submit_sees_negative_payments():
            self.assertEqual(invoice_doc.payments[0].amount, -90)
            self.assertEqual(invoice_doc.payments[0].base_amount, -90)
            invoice_doc.docstatus = 1

        invoice_doc.submit = assert_submit_sees_negative_payments

        self.creation.frappe.db.exists = lambda doctype, name: name == "ACC-SINV-RETURN-0001"
        self.creation.frappe.db.get_value = (
            lambda doctype, name, fieldname, *args, **kwargs: 90
            if fieldname == "paid_amount"
            else 0
        )
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = lambda *args: invoice_doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: None

        def assert_return_payments_are_negative_before_save(doc):
            self.assertEqual(doc.payments[0].amount, -90)
            self.assertEqual(doc.payments[0].base_amount, -90)
            # Simulate framework-side save logic mutating child rows before submit.
            doc.payments[0].amount = 90
            doc.payments[0].base_amount = 90
            return doc

        self.creation._save_draft_with_latest_timestamp = assert_return_payments_are_negative_before_save

        result = self.creation.submit_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "ACC-SINV-RETURN-0001",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "customer": "CUST-0001",
                    "is_return": 1,
                    "return_against": "ACC-SINV-BASE-0001",
                    "additional_discount_percentage": 10,
                    "discount_amount": -10,
                    "items": [],
                }
            ),
            json.dumps({}),
            submit_in_background=0,
        )

        self.assertEqual(result["status"], 1)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestInvoiceIdempotency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()
        cls.original_process_post_submit_payments = cls.creation._process_post_submit_payments

    def setUp(self):
        self.enqueue_calls.clear()
        self.frappe._publish_realtime_calls.clear()
        self.creation.frappe.db.has_column = lambda doctype, fieldname: True
        self.creation._process_post_submit_payments = type(self).original_process_post_submit_payments

    def test_submit_invoice_returns_existing_submitted_doc_for_same_client_request_id(self):
        existing_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-IDEMP-0001",
            docstatus=1,
            pos_profile="Main POS",
            company="Test Company",
        )
        ledger_doc = FakeDoc(
            doctype="POS Invoice Submission Ledger",
            name="ledger-idemp-001",
            ledger_key="ledger-idemp-001",
            client_request_id="inv-fixed-001",
            state="RECEIVED",
            company="Test Company",
            pos_profile="Main POS",
            document_type="Sales Invoice",
            invoice_name=None,
            request_data=json.dumps({}),
            payment_context=json.dumps({}),
        )
        ledger_doc.save = lambda ignore_permissions=False: ledger_doc
        ledger_doc.insert = lambda ignore_permissions=False: ledger_doc

        def fake_get_value(doctype, filters=None, fieldname=None, **kwargs):
            if doctype == "POS Invoice Submission Ledger":
                return ledger_doc.name
            if (
                doctype == "Sales Invoice"
                and isinstance(filters, dict)
                and filters.get("posa_client_request_id") == "inv-fixed-001"
            ):
                return "ACC-SINV-IDEMP-0001"
            return 0

        self.creation.frappe.db.get_value = fake_get_value
        self.creation.frappe.db.exists = lambda doctype, name: doctype == "Sales Invoice"

        def fake_get_doc(*args, **kwargs):
            if args[0] == "POS Invoice Submission Ledger":
                return ledger_doc
            return existing_doc

        self.creation.frappe.get_doc = fake_get_doc
        self.creation.update_invoice = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("duplicate replay should not build a new invoice")
        )

        result = self.creation.submit_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "items": [],
                    "payments": [],
                    "posa_client_request_id": "inv-fixed-001",
                }
            ),
            json.dumps({"idempotency_key": "inv-fixed-001"}),
            submit_in_background=0,
        )

        self.assertEqual(result["name"], "ACC-SINV-IDEMP-0001")
        self.assertEqual(result["status"], 1)
        self.assertTrue(result["replayed"])

    def test_submit_invoice_skips_idempotency_lookup_when_custom_field_is_missing(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-NEW-0001",
            docstatus=0,
            pos_profile="Main POS",
            company="Test Company",
            currency="USD",
            customer="CUST-0001",
            is_return=0,
            items=[],
            payments=[],
            taxes=[],
            flags=types.SimpleNamespace(ignore_permissions=False),
            redeem_loyalty_points=0,
            loyalty_program=None,
            cost_center=None,
            write_off_amount=0,
            rounded_total=0,
            grand_total=0,
            remarks="",
        )
        invoice_doc.submit = lambda: setattr(invoice_doc, "docstatus", 1)

        self.creation.frappe.db.has_column = lambda doctype, fieldname: False
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.db.exists = lambda doctype, name: name == "ACC-SINV-NEW-0001"
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = lambda *args: invoice_doc
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: None

        result = self.creation.submit_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "ACC-SINV-NEW-0001",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "customer": "CUST-0001",
                    "items": [],
                    "payments": [],
                    "posa_client_request_id": "inv-fixed-002",
                }
            ),
            json.dumps({"idempotency_key": "inv-fixed-002"}),
            submit_in_background=0,
        )

        self.assertEqual(result["status"], 1)
        self.assertEqual(getattr(invoice_doc, "posa_client_request_id", None), None)

    def test_submit_invoice_does_not_query_missing_client_request_column(self):
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-NEW-0002",
            docstatus=0,
            pos_profile="Main POS",
            company="Test Company",
            currency="USD",
            customer="CUST-0001",
            is_return=0,
            items=[],
            payments=[],
            taxes=[],
            flags=types.SimpleNamespace(ignore_permissions=False),
            redeem_loyalty_points=0,
            loyalty_program=None,
            cost_center=None,
            write_off_amount=0,
            rounded_total=0,
            grand_total=0,
            remarks="",
        )
        invoice_doc.submit = lambda: setattr(invoice_doc, "docstatus", 1)

        def explode_if_lookup_runs(*args, **kwargs):
            filters = args[1] if len(args) > 1 else kwargs.get("filters")
            if isinstance(filters, dict) and "posa_client_request_id" in filters:
                raise AssertionError("idempotency lookup should be skipped when the field is missing")
            return 0

        self.creation.frappe.db.has_column = lambda doctype, fieldname: False
        self.creation.frappe.db.get_value = explode_if_lookup_runs
        self.creation.frappe.db.exists = lambda doctype, name: name == "ACC-SINV-NEW-0002"
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = lambda *args: invoice_doc
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: None

        result = self.creation.submit_invoice(
            json.dumps(
                {
                    "doctype": "Sales Invoice",
                    "name": "ACC-SINV-NEW-0002",
                    "pos_profile": "Main POS",
                    "company": "Test Company",
                    "currency": "USD",
                    "customer": "CUST-0001",
                    "items": [],
                    "payments": [],
                    "posa_client_request_id": "inv-fixed-003",
                }
            ),
            json.dumps({"idempotency_key": "inv-fixed-003"}),
            submit_in_background=0,
        )

        self.assertEqual(result["status"], 1)
        self.assertEqual(getattr(invoice_doc, "posa_client_request_id", None), None)

    def test_submit_invoice_replays_from_durable_ledger_without_invoice_custom_field(self):
        ledger_rows = {}
        submitted_docs = {}
        submit_count = {"value": 0}

        def make_invoice_doc(name):
            invoice_doc = FakeDoc(
                doctype="Sales Invoice",
                name=name,
                docstatus=0,
                pos_profile="Main POS",
                company="Test Company",
                currency="USD",
                customer="CUST-0001",
                is_return=0,
                items=[],
                payments=[],
                taxes=[],
                flags=types.SimpleNamespace(ignore_permissions=False),
                redeem_loyalty_points=0,
                loyalty_program=None,
                cost_center=None,
                write_off_amount=0,
                rounded_total=0,
                grand_total=0,
                remarks="",
            )

            def submit():
                submit_count["value"] += 1
                invoice_doc.docstatus = 1

            invoice_doc.submit = submit
            submitted_docs[name] = invoice_doc
            return invoice_doc

        def fake_update_invoice(payload):
            name = f"ACC-SINV-LEDGER-{len(submitted_docs) + 1:04d}"
            make_invoice_doc(name)
            return {"name": name}

        def attach_ledger_methods(ledger_doc):
            def insert(ignore_permissions=False):
                ledger_doc.name = ledger_doc.get("name") or ledger_doc.ledger_key
                ledger_rows[ledger_doc.name] = ledger_doc
                return ledger_doc

            def save(ignore_permissions=False):
                ledger_rows[ledger_doc.name] = ledger_doc
                return ledger_doc

            ledger_doc.insert = insert
            ledger_doc.save = save
            return ledger_doc

        def fake_get_doc(*args):
            if len(args) == 1 and isinstance(args[0], dict):
                payload = dict(args[0])
                if payload.get("doctype") == "POS Invoice Submission Ledger":
                    return attach_ledger_methods(FakeDoc(**payload))
            if len(args) == 2 and args[0] == "Sales Invoice":
                return submitted_docs[args[1]]
            if len(args) == 2 and args[0] == "POS Invoice Submission Ledger":
                return ledger_rows[args[1]]
            raise AssertionError(f"unexpected get_doc call: {args}")

        def fake_get_value(doctype, filters=None, fieldname=None, **kwargs):
            if doctype == "POS Invoice Submission Ledger" and isinstance(filters, dict):
                for row in ledger_rows.values():
                    if all(row.get(key) == value for key, value in filters.items()):
                        return row.name
                return None
            return 0

        self.creation.frappe.db.has_column = lambda doctype, fieldname: not (
            doctype in {"Sales Invoice", "POS Invoice"} and fieldname == "posa_client_request_id"
        )
        self.creation.frappe.db.get_value = fake_get_value
        self.creation.frappe.db.exists = (
            lambda doctype, name: doctype == "Sales Invoice" and name in submitted_docs
        )
        self.creation.frappe.get_value = lambda *args, **kwargs: 0
        self.creation.frappe.get_doc = fake_get_doc
        self.creation.update_invoice = fake_update_invoice
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None

        payload = {
            "doctype": "Sales Invoice",
            "pos_profile": "Main POS",
            "company": "Test Company",
            "currency": "USD",
            "customer": "CUST-0001",
            "items": [],
            "payments": [],
            "posa_client_request_id": "ledger-fixed-001",
        }
        data = {"idempotency_key": "ledger-fixed-001"}

        first = self.creation.submit_invoice(
            json.dumps(payload),
            json.dumps(data),
            submit_in_background=0,
        )
        second = self.creation.submit_invoice(
            json.dumps(payload),
            json.dumps(data),
            submit_in_background=0,
        )

        self.assertEqual(first["name"], "ACC-SINV-LEDGER-0001")
        self.assertEqual(second["name"], "ACC-SINV-LEDGER-0001")
        self.assertEqual(len(ledger_rows), 1)
        self.assertEqual(next(iter(ledger_rows.values())).state, "POST_SUBMIT_DONE")
        self.assertTrue(second["replayed"])
        self.assertTrue(second["idempotent"])
        self.assertEqual(submit_count["value"], 1)
        self.assertEqual(len(submitted_docs), 1)

    def test_save_submission_ledger_inserts_named_new_doc(self):
        calls = {"insert": 0, "save": 0}
        ledger_doc = FakeDoc(
            doctype="POS Invoice Submission Ledger",
            name="ledger-key-001",
            ledger_key="ledger-key-001",
            client_request_id="request-001",
        )
        ledger_doc.is_new = lambda: True

        def insert(ignore_permissions=False):
            calls["insert"] += 1
            return ledger_doc

        def save(ignore_permissions=False):
            calls["save"] += 1
            raise AssertionError("new named ledger docs must be inserted, not saved")

        ledger_doc.insert = insert
        ledger_doc.save = save

        result = self.creation._save_submission_ledger(ledger_doc)

        self.assertIs(result, ledger_doc)
        self.assertEqual(calls["insert"], 1)
        self.assertEqual(calls["save"], 0)

    def test_post_submit_without_payment_work_ignores_missing_ledger(self):
        self.creation.frappe.db.exists = lambda doctype, name: False
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-0001",
            docstatus=1,
        )

        self.creation._process_post_submit_payments(
            invoice_doc,
            {},
            0,
            0,
            None,
            [],
            False,
            None,
            "missing-ledger-name",
        )

    def test_repair_submission_runs_post_submit_money_once_then_replays(self):
        ledger_doc = FakeDoc(
            doctype="POS Invoice Submission Ledger",
            name="ledger-repair-001",
            ledger_key="ledger-repair-001",
            client_request_id="ledger-repair-001",
            company="Test Company",
            pos_profile="Main POS",
            document_type="Sales Invoice",
            invoice_name="ACC-SINV-REPAIR-0001",
            state="SUBMITTED",
            request_data=json.dumps({"credit_change": 25}),
            payment_context=json.dumps(
                {
                    "is_payment_entry": 0,
                    "total_cash": 0,
                    "cash_account": {"account": "Cash - TC"},
                    "payments": [],
                }
            ),
        )
        ledger_doc.save = lambda ignore_permissions=False: ledger_doc
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-REPAIR-0001",
            docstatus=1,
            pos_profile="Main POS",
            company="Test Company",
            customer="CUST-0001",
        )
        lock_calls = []
        payment_runs = []

        def fake_get_value(doctype, filters=None, fieldname=None, **kwargs):
            if doctype == "POS Invoice Submission Ledger":
                return ledger_doc.name
            return None

        def fake_get_doc(doctype, name, **kwargs):
            if doctype == "POS Invoice Submission Ledger":
                if kwargs.get("for_update"):
                    lock_calls.append(name)
                return ledger_doc
            if doctype == "Sales Invoice":
                return invoice_doc
            raise AssertionError(f"unexpected get_doc call: {(doctype, name)}")

        self.creation.frappe.db.get_value = fake_get_value
        self.creation.frappe.db.exists = (
            lambda doctype, name: doctype == "Sales Invoice" and name == "ACC-SINV-REPAIR-0001"
        )
        self.creation.frappe.get_doc = fake_get_doc
        original_run = self.creation._run_post_submit_payments
        self.creation._run_post_submit_payments = (
            lambda *args, **kwargs: payment_runs.append(args[0].name)
        )

        try:
            first = self.creation.repair_invoice_submission(
                client_request_id="ledger-repair-001",
                company="Test Company",
                pos_profile="Main POS",
                document_type="Sales Invoice",
            )
            second = self.creation.repair_invoice_submission(
                client_request_id="ledger-repair-001",
                company="Test Company",
                pos_profile="Main POS",
                document_type="Sales Invoice",
            )
        finally:
            self.creation._run_post_submit_payments = original_run

        self.assertEqual(first["name"], "ACC-SINV-REPAIR-0001")
        self.assertEqual(first["ledger_state"], "POST_SUBMIT_DONE")
        self.assertTrue(first["repaired"])
        self.assertEqual(second["ledger_state"], "POST_SUBMIT_DONE")
        self.assertFalse(second["repaired"])
        self.assertTrue(second["replayed"])
        self.assertEqual(payment_runs, ["ACC-SINV-REPAIR-0001"])
        self.assertEqual(lock_calls, ["ledger-repair-001"])

    def test_background_submit_updates_existing_submission_ledger(self):
        ledger_doc = FakeDoc(
            doctype="POS Invoice Submission Ledger",
            name="ledger-background-001",
            ledger_key="ledger-background-001",
            client_request_id="ledger-background-001",
            company="Test Company",
            pos_profile="Main POS",
            document_type="Sales Invoice",
            invoice_name="ACC-SINV-BG-0001",
            state="DRAFT_CREATED",
            request_data=json.dumps({}),
            payment_context=json.dumps({}),
        )
        ledger_doc.save = lambda ignore_permissions=False: ledger_doc
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-BG-0001",
            docstatus=0,
            pos_profile="Main POS",
            company="Test Company",
            currency="USD",
            customer="CUST-0001",
            is_return=0,
            items=[],
            payments=[],
            taxes=[],
            flags=types.SimpleNamespace(ignore_permissions=False),
            redeem_loyalty_points=0,
            loyalty_program=None,
            cost_center=None,
            write_off_amount=0,
            rounded_total=0,
            grand_total=0,
            remarks="",
        )
        invoice_doc.submit = lambda: setattr(invoice_doc, "docstatus", 1)

        def fake_get_doc(doctype, name):
            if doctype == "POS Invoice Submission Ledger":
                return ledger_doc
            if doctype == "Sales Invoice":
                return invoice_doc
            raise AssertionError(f"unexpected get_doc call: {(doctype, name)}")

        self.creation.frappe.get_doc = fake_get_doc
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None

        self.creation.submit_in_background_job(
            {
                "invoice": "ACC-SINV-BG-0001",
                "doctype": "Sales Invoice",
                "data": {},
                "is_payment_entry": 0,
                "total_cash": 0,
                "cash_account": None,
                "payments": [],
                "ledger_name": "ledger-background-001",
            }
        )

        self.assertEqual(invoice_doc.docstatus, 1)
        self.assertEqual(ledger_doc.state, "POST_SUBMIT_DONE")

    def test_background_submit_marks_ledger_failed_when_post_submit_work_crashes(self):
        ledger_doc = FakeDoc(
            doctype="POS Invoice Submission Ledger",
            name="ledger-background-failed-001",
            ledger_key="ledger-background-failed-001",
            client_request_id="ledger-background-failed-001",
            company="Test Company",
            pos_profile="Main POS",
            document_type="Sales Invoice",
            invoice_name="ACC-SINV-BG-FAIL-0001",
            state="DRAFT_CREATED",
            request_data=json.dumps({}),
            payment_context=json.dumps({}),
            error_message=None,
        )
        ledger_doc.save = lambda ignore_permissions=False: ledger_doc
        invoice_doc = FakeDoc(
            doctype="Sales Invoice",
            name="ACC-SINV-BG-FAIL-0001",
            docstatus=0,
            pos_profile="Main POS",
            company="Test Company",
            currency="USD",
            customer="CUST-0001",
            is_return=0,
            items=[],
            payments=[],
            taxes=[],
            flags=types.SimpleNamespace(ignore_permissions=False),
            redeem_loyalty_points=0,
            loyalty_program=None,
            cost_center=None,
            write_off_amount=0,
            rounded_total=0,
            grand_total=0,
            remarks="",
        )
        invoice_doc.submit = lambda: setattr(invoice_doc, "docstatus", 1)

        def fake_get_doc(doctype, name):
            if doctype == "POS Invoice Submission Ledger":
                return ledger_doc
            if doctype == "Sales Invoice":
                return invoice_doc
            raise AssertionError(f"unexpected get_doc call: {(doctype, name)}")

        self.creation.frappe.get_doc = fake_get_doc
        self.creation.frappe.db.get_value = lambda *args, **kwargs: 0
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation._apply_invoice_gift_card_settlement = lambda *args, **kwargs: None
        self.creation._process_post_submit_payments = lambda *args, **kwargs: (_ for _ in ()).throw(
            Exception("post submit failed")
        )

        self.creation.submit_in_background_job(
            {
                "invoice": "ACC-SINV-BG-FAIL-0001",
                "doctype": "Sales Invoice",
                "data": {},
                "is_payment_entry": 0,
                "total_cash": 0,
                "cash_account": None,
                "payments": [],
                "ledger_name": "ledger-background-failed-001",
                "user": "cashier@example.com",
            }
        )

        self.assertEqual(invoice_doc.docstatus, 1)
        self.assertEqual(ledger_doc.state, "FAILED")
        self.assertIn("post submit failed", ledger_doc.error_message)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestUpdateInvoiceDraftSaveConflicts(unittest.TestCase):
    """Two Pay taps racing one draft (prod incident 2026-08-10).

    MariaDB 1020 "Record has changed since last read" and a tabSeries deadlock
    both reach the app as frappe.QueryDeadlockError; untouched it leaves the
    request as an HTTP 500 toast on the sales lane.

    Name sorts after TestInvoiceIdempotency on purpose. unittest loads classes
    alphabetically and every setUpClass here re-stubs `frappe`, but the real
    `idempotency` module is imported once and stays bound to whichever stub got
    there first — so the idempotency class has to run before any other.
    """

    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.frappe._savepoint_calls.clear()
        self._original_save = self.creation._save_draft_with_latest_timestamp
        self._original_get_doc = self.frappe.get_doc

    def tearDown(self):
        self.creation._save_draft_with_latest_timestamp = self._original_save
        self.frappe.get_doc = self._original_get_doc

    def _draft(self, name="ACC-SINV-2026-00042"):
        return FakeDoc(
            doctype="Sales Invoice",
            name=name,
            is_new=lambda: name is None,
            flags=types.SimpleNamespace(ignore_permissions=True),
            grand_total=250,
        )

    def test_row_conflict_retries_once_against_a_freshly_read_row(self):
        draft = self._draft()
        reread = self._draft()
        reread.customer = "re-read"
        self.frappe.get_doc = lambda *args, **kwargs: reread

        saved_with = []

        def flaky_save(doc):
            saved_with.append(doc)
            if len(saved_with) == 1:
                raise self.frappe.QueryDeadlockError(1020, "Record has changed since last read")
            return doc

        self.creation._save_draft_with_latest_timestamp = flaky_save

        result = self.creation._save_draft_retrying_row_conflicts(draft)

        self.assertEqual(len(saved_with), 2)
        # The retry must not re-submit the doc whose save half-applied — it
        # replays the payload onto the row as it now stands.
        self.assertIs(saved_with[0], draft)
        self.assertIs(saved_with[1], reread)
        self.assertIs(result, reread)
        self.assertIn(("rollback", "posa_draft_save_0"), self.frappe._savepoint_calls)
        self.assertIn(("release", "posa_draft_save_1"), self.frappe._savepoint_calls)

    def test_clean_save_releases_its_savepoint_and_does_not_retry(self):
        draft = self._draft()
        saved_with = []

        def clean_save(doc):
            saved_with.append(doc)
            return doc

        self.creation._save_draft_with_latest_timestamp = clean_save

        result = self.creation._save_draft_retrying_row_conflicts(draft)

        self.assertIs(result, draft)
        self.assertEqual(len(saved_with), 1)
        self.assertEqual(
            self.frappe._savepoint_calls,
            [("savepoint", "posa_draft_save_0"), ("release", "posa_draft_save_0")],
        )

    def test_second_conflict_surfaces_a_retryable_409_not_a_500(self):
        draft = self._draft()
        self.frappe.get_doc = lambda *args, **kwargs: self._draft()

        def always_conflicts(_doc):
            raise self.frappe.QueryDeadlockError(1020, "Record has changed since last read")

        self.creation._save_draft_with_latest_timestamp = always_conflicts

        with self.assertRaises(self.creation.InvoiceSaveConflictError) as caught:
            self.creation._save_draft_retrying_row_conflicts(draft)

        self.assertEqual(caught.exception.http_status_code, 409)
        self.assertIn("try again", str(caught.exception))

    def test_conflict_while_creating_the_invoice_is_not_retried(self):
        # A doc that died mid-insert already burned a naming-series number and
        # has no committed row to re-read, so it goes straight to the friendly
        # error rather than a second insert.
        draft = self._draft(name=None)
        reread_calls = []
        self.frappe.get_doc = lambda *args, **kwargs: reread_calls.append(args)

        def always_conflicts(_doc):
            raise self.frappe.QueryDeadlockError(1213, "Deadlock found on tabSeries")

        self.creation._save_draft_with_latest_timestamp = always_conflicts

        with self.assertRaises(self.creation.InvoiceSaveConflictError):
            self.creation._save_draft_retrying_row_conflicts(draft)

        self.assertEqual(reread_calls, [])
        self.assertEqual(
            self.frappe._savepoint_calls,
            [("savepoint", "posa_draft_save_0"), ("rollback", "posa_draft_save_0")],
        )

    def test_timestamp_mismatch_still_raises_untouched(self):
        # The 1020 wrapper must not swallow the existing TimestampMismatchError
        # contract that _save_draft_with_latest_timestamp already owns.
        draft = self._draft()

        def stale_save(_doc):
            raise self.creation.TimestampMismatchError("stale")

        self.creation._save_draft_with_latest_timestamp = stale_save

        with self.assertRaises(self.creation.TimestampMismatchError):
            self.creation._save_draft_retrying_row_conflicts(draft)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestUpdateInvoiceRequestIdAdoption(unittest.TestCase):
    """A lost update_invoice ACK retries name-less with the same
    posa_client_request_id; the server must adopt the row that request already
    created instead of minting a sibling draft (audit r2 A3)."""

    @classmethod
    def setUpClass(cls):
        cls.frappe, cls.enqueue_calls = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.creation = _load_module()

    def setUp(self):
        self.enqueue_calls.clear()
        self.frappe._publish_realtime_calls.clear()
        self.created_payloads = []
        self.creation._save_draft_with_latest_timestamp = lambda doc: doc
        self.creation.frappe.get_cached_value = lambda *args, **kwargs: 0
        self.creation.frappe.db.get_value = lambda *args, **kwargs: None
        # The cached idempotency module keeps the FIRST class's frappe stub, so
        # another class's has_column patch leaks in under a full-file run. Pin
        # the helpers this class exercises to "custom field exists".
        self.creation.doctype_supports_client_request_id = lambda doctype: True

        def _set_request_id(doc, request_id):
            if request_id:
                doc.posa_client_request_id = request_id
            return doc

        self.creation.set_invoice_client_request_id = _set_request_id

    def _build_invoice_doc(self, **overrides):
        base = {
            "doctype": "Sales Invoice",
            "name": None,
            "owner": "test@example.com",
            "pos_profile": "Main POS",
            "company": "Test Company",
            "currency": "USD",
            "posting_date": "2026-03-21",
            "is_return": 0,
            "return_against": None,
            "items": [],
            "payments": [],
            "taxes": [],
            "flags": types.SimpleNamespace(ignore_pricing_rule=False, ignore_permissions=False),
            "paid_amount": 0,
            "base_paid_amount": 0,
            "conversion_rate": 1,
            "plc_conversion_rate": 1,
            "price_list_currency": "USD",
            "total": 0,
            "net_total": 0,
            "grand_total": 0,
            "rounded_total": 0,
            "docstatus": 0,
        }
        base.update(overrides)
        return FakeDoc(**base)

    def _wire_existing(self, existing_doc):
        lookups = []

        def fake_find(client_request_id, preferred_doctype=None):
            lookups.append(client_request_id)
            return existing_doc

        self.creation.find_invoice_by_client_request_id = fake_find
        existing_name = existing_doc.get("name") if existing_doc else None
        self.creation.frappe.db.exists = (
            lambda doctype, name=None: name == existing_name if existing_name else False
        )

        def fake_get_doc(*args):
            if len(args) == 2:
                return existing_doc
            payload = dict(args[0])
            self.created_payloads.append(payload)
            return self._build_invoice_doc(**{k: v for k, v in payload.items() if k != "flags"})

        self.creation.frappe.get_doc = fake_get_doc
        return lookups

    def _payload(self, **overrides):
        payload = {
            "doctype": "Sales Invoice",
            "pos_profile": "Main POS",
            "company": "Test Company",
            "currency": "USD",
            "posting_date": "2026-03-21",
            "posa_client_request_id": "req-123",
            "items": [],
            "payments": [],
        }
        payload.update(overrides)
        return payload

    def test_nameless_retry_adopts_existing_draft_by_request_id(self):
        existing_draft = self._build_invoice_doc(name="SINV-DRAFT-1")
        lookups = self._wire_existing(existing_draft)

        result = self.creation.update_invoice(json.dumps(self._payload()))

        self.assertEqual(lookups, ["req-123"])
        self.assertEqual(self.created_payloads, [])
        self.assertEqual(result["name"], "SINV-DRAFT-1")
        self.assertEqual(result["docstatus"], 0)

    def test_stale_client_name_yields_to_server_row_for_request(self):
        existing_draft = self._build_invoice_doc(name="SINV-DRAFT-1")
        self._wire_existing(existing_draft)

        result = self.creation.update_invoice(
            json.dumps(self._payload(name="SINV-STALE"))
        )

        self.assertEqual(self.created_payloads, [])
        self.assertEqual(result["name"], "SINV-DRAFT-1")

    def test_retry_refuses_when_request_already_submitted(self):
        submitted = self._build_invoice_doc(name="SINV-DONE", docstatus=1)
        self._wire_existing(submitted)

        with self.assertRaises(self.frappe.DuplicateEntryError):
            self.creation.update_invoice(json.dumps(self._payload()))
        self.assertEqual(self.created_payloads, [])

    def test_retry_refuses_when_request_invoice_was_cancelled(self):
        cancelled = self._build_invoice_doc(name="SINV-GONE", docstatus=2)
        self._wire_existing(cancelled)

        with self.assertRaises(self.frappe.DuplicateEntryError):
            self.creation.update_invoice(json.dumps(self._payload()))
        self.assertEqual(self.created_payloads, [])

    def test_no_existing_row_inserts_fresh_draft_with_request_id(self):
        self._wire_existing(None)

        result = self.creation.update_invoice(json.dumps(self._payload()))

        self.assertEqual(len(self.created_payloads), 1)
        self.assertEqual(result["posa_client_request_id"], "req-123")
        self.assertEqual(result["docstatus"], 0)


if __name__ == "__main__":
    unittest.main()
