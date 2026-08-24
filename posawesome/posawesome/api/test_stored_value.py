import contextlib
import datetime
import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]

TODAY = "2026-08-23"


class FakePaymentEntry:
    """Enough Payment Entry to prove what the deposit path writes.

    Nothing here validates accounting — ERPNext does that, and a stub that
    pretended to would only prove itself right. What these tests hold is the
    FIELDS: party, unallocated (no `references` rows) and `reference_no`, the
    three that decide whether the money becomes monedero and whether the corte
    can see it.
    """

    def __init__(self, payload=None):
        for key, value in (payload or {}).items():
            setattr(self, key, value)
        self.name = "ACC-PAY-2026-00001"
        self.references = []
        self.flags = types.SimpleNamespace(ignore_permissions=False)
        self.saved = False
        self.submitted = False

    def append(self, fieldname, value):
        row = dict(value)
        getattr(self, fieldname).append(row)
        return row

    def save(self, ignore_permissions=False):
        self.saved = True
        return self

    def submit(self):
        self.submitted = True
        return self


def _cint(value, default=0):
    """`frappe.utils.cint` truncates — and the accrual depends on that."""
    if value is None:
        return default
    try:
        return int(value)
    except Exception:
        try:
            return int(float(value))
        except Exception:
            return default


def _getdate(value):
    if isinstance(value, datetime.date):
        return value
    return datetime.datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_utils_module = types.ModuleType("frappe.utils")
    payments_module = types.ModuleType("posawesome.posawesome.api.payments")
    employees_module = types.ModuleType("posawesome.posawesome.api.employees")
    scope_module = types.ModuleType("posawesome.posawesome.api._scope")
    perms_module = types.ModuleType("posawesome.posawesome.api._perms")
    erpnext_party_module = types.ModuleType("erpnext.accounts.party")
    erpnext_loyalty_module = types.ModuleType(
        "erpnext.accounts.doctype.loyalty_program.loyalty_program"
    )

    state = {
        "credits": [],
        "session_user": "cashier@example.com",
        "terminal_users": {"Main POS": ["cashier@example.com"]},
        "profiles": {
            "Main POS": types.SimpleNamespace(
                name="Main POS",
                company="Test Company",
                posa_use_customer_cards=1,
                posa_customer_card_program="Puntos Doco",
                payments=[{"mode_of_payment": "Cash"}, {"mode_of_payment": "Tarjeta"}],
            )
        },
        "shifts": [{"name": "SHIFT-0001", "pos_profile": "Main POS"}],
        "mode_accounts": {("Cash", "Test Company"): "1110 - Cash - TC"},
        "customers": {"CUST-0001": {"loyalty_program": ""}},
        "loyalty_programs": {"Puntos Doco": {"company": "Test Company"}},
        "loyalty_details": {},
        "payment_entries": [],
        "rows": {},
        "columns": {},
        "scope_calls": [],
    }

    frappe_module._ = lambda text: text
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user=state["session_user"])

    frappe_utils_module.cint = _cint
    frappe_utils_module.getdate = _getdate
    frappe_utils_module.nowdate = lambda: TODAY
    frappe_utils_module.flt = lambda value, precision=None: float(value or 0)

    def _get_available_credit(customer, company):
        return list(state["credits"])

    payments_module.get_available_credit = _get_available_credit

    def _get_cached_doc(doctype, name):
        if doctype != "POS Profile":
            raise AssertionError(f"Unexpected get_cached_doc: {doctype}")
        if name not in state["profiles"]:
            raise AssertionError(f"Unknown POS Profile: {name}")
        return state["profiles"][name]

    def _get_doc(payload):
        entry = FakePaymentEntry(payload)
        state["payment_entries"].append(entry)
        return entry

    def _get_all(doctype, filters=None, fields=None, **kwargs):
        if doctype == "POS Opening Shift":
            return [dict(row) for row in state["shifts"]]
        return [dict(row) for row in state["rows"].get(doctype, [])]

    def _db_get_value(doctype, name, fieldname=None, **kwargs):
        if doctype == "Mode of Payment Account":
            return state["mode_accounts"].get(
                (name.get("parent"), name.get("company"))
            )
        if doctype == "Customer":
            return state["customers"].get(name, {}).get(fieldname)
        if doctype == "Loyalty Program":
            return state["loyalty_programs"].get(name, {}).get(fieldname)
        raise AssertionError(f"Unexpected db.get_value: {doctype} {fieldname}")

    def _db_set_value(doctype, name, fieldname, value=None, **kwargs):
        if doctype != "Customer":
            raise AssertionError(f"Unexpected db.set_value: {doctype}")
        state["customers"].setdefault(name, {})[fieldname] = value

    def _db_exists(doctype, name=None):
        if doctype == "Customer":
            return name in state["customers"]
        if doctype == "DocType":
            return name in ("Sales Invoice", "POS Invoice")
        return False

    frappe_module.get_cached_doc = _get_cached_doc
    frappe_module.get_doc = _get_doc
    frappe_module.get_all = _get_all
    frappe_module.db = types.SimpleNamespace(
        get_value=_db_get_value,
        set_value=_db_set_value,
        exists=_db_exists,
        has_column=lambda doctype, column: bool(state["columns"].get(doctype)),
    )

    employees_module._resolve_profile_name = lambda pos_profile=None: (
        str(pos_profile.get("name") or "").strip()
        if isinstance(pos_profile, dict)
        else str(pos_profile or "").strip()
    )

    def _ensure_terminal_user(profile_name, user):
        roster = state["terminal_users"].get(profile_name, [])
        if user not in roster:
            frappe_module.throw("Selected cashier is not assigned to this POS profile.")
        return roster

    employees_module._ensure_terminal_user = _ensure_terminal_user
    employees_module._get_user_doc = lambda user: types.SimpleNamespace(name=user, enabled=1)

    def _record_scope(kind):
        def _call(*args, **kwargs):
            state["scope_calls"].append(kind)

        return _call

    scope_module.assert_company = _record_scope("company")
    scope_module.assert_profile = _record_scope("profile")
    scope_module.assert_customer_in_profile = _record_scope("customer")

    @contextlib.contextmanager
    def _account_perm_bypass():
        yield

    perms_module.account_perm_bypass = _account_perm_bypass
    erpnext_party_module.get_party_account = (
        lambda party_type, party=None, company=None, **kwargs: "1310 - Debtors - TC"
    )
    erpnext_loyalty_module.get_loyalty_program_details_with_points = (
        lambda customer, loyalty_program=None, **kwargs: dict(state["loyalty_details"])
    )

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils_module
    sys.modules["posawesome.posawesome.api.payments"] = payments_module
    sys.modules["posawesome.posawesome.api.employees"] = employees_module
    sys.modules["posawesome.posawesome.api._scope"] = scope_module
    sys.modules["posawesome.posawesome.api._perms"] = perms_module
    sys.modules["erpnext.accounts.party"] = erpnext_party_module
    sys.modules["erpnext.accounts.doctype.loyalty_program.loyalty_program"] = (
        erpnext_loyalty_module
    )
    return state


def _load_stored_value_module():
    module_name = "posawesome.posawesome.api.stored_value"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "stored_value.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _erpnext_points_earned(eligible_amount, collection_factor):
    """The oracle: `SalesInvoice.make_loyalty_point_entry`, copied.

    If the preview ever disagrees with this, the cashier read the customer a
    number the invoice will not honour — which is worse than showing nothing.
    """
    factor = collection_factor if collection_factor else 1.0
    return _cint(eligible_amount / factor)


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class StoredValueTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = _install_stubs()
        cls.module = _load_stored_value_module()

    def setUp(self):
        self.state["credits"] = []
        self.state["shifts"] = [{"name": "SHIFT-0001", "pos_profile": "Main POS"}]
        self.state["terminal_users"] = {"Main POS": ["cashier@example.com"]}
        self.state["customers"] = {"CUST-0001": {"loyalty_program": ""}}
        self.state["loyalty_details"] = {}
        self.state["payment_entries"] = []
        self.state["rows"] = {}
        self.state["columns"] = {}
        self.state["scope_calls"] = []
        self.state["profiles"]["Main POS"].posa_use_customer_cards = 1
        self.state["profiles"]["Main POS"].posa_customer_card_program = "Puntos Doco"
        sys.modules["frappe"].session.user = "cashier@example.com"


class TestStoredValueApi(StoredValueTestCase):
    def test_get_stored_value_summary_aggregates_available_sources(self):
        self.state["credits"] = [
            {
                "type": "Invoice",
                "credit_origin": "SINV-RET-0001",
                "total_credit": 50,
                "credit_to_redeem": 0,
                "source_type": "Sales Return",
            },
            {
                "type": "Advance",
                "credit_origin": "ACC-PAY-0001",
                "total_credit": 25,
                "credit_to_redeem": 0,
                "source_type": "Payment Entry",
            },
        ]

        result = self.module.get_stored_value_summary(
            customer="CUST-0001",
            company="Test Company",
        )

        self.assertEqual(result["available_amount"], 75.0)
        self.assertEqual(result["source_count"], 2)
        self.assertEqual(len(result["sources"]), 2)
        self.assertEqual(result["sources"][0]["credit_origin"], "SINV-RET-0001")

    def test_get_available_stored_value_reuses_credit_sources(self):
        self.state["credits"] = [
            {
                "type": "Advance",
                "credit_origin": "ACC-PAY-0002",
                "total_credit": 10,
                "credit_to_redeem": 0,
                "source_type": "Payment Entry",
            }
        ]

        result = self.module.get_available_stored_value(
            customer="CUST-0001",
            company="Test Company",
        )

        self.assertEqual(result[0]["credit_origin"], "ACC-PAY-0002")
        self.assertEqual(result[0]["total_credit"], 10)


class TestDepositGates(StoredValueTestCase):
    """The flag is a gate, not a hint (the gift-cards P0-3 lesson)."""

    def _deposit(self, **overrides):
        args = {
            "pos_profile": "Main POS",
            "customer": "CUST-0001",
            "amount": 200,
            "mode_of_payment": "Cash",
        }
        args.update(overrides)
        return self.module.deposit_stored_value(**args)

    def test_refuses_when_the_profile_flag_is_off(self):
        self.state["profiles"]["Main POS"].posa_use_customer_cards = 0

        with self.assertRaises(Exception) as ctx:
            self._deposit()

        self.assertIn("not enabled", str(ctx.exception))
        self.assertEqual(self.state["payment_entries"], [])

    def test_refuses_a_cashier_who_is_not_on_this_register(self):
        self.state["terminal_users"] = {"Main POS": ["someone-else@example.com"]}

        with self.assertRaises(Exception) as ctx:
            self._deposit()

        self.assertIn("not assigned", str(ctx.exception))
        self.assertEqual(self.state["payment_entries"], [])

    def test_refuses_when_no_shift_is_open(self):
        self.state["shifts"] = []

        with self.assertRaises(Exception) as ctx:
            self._deposit()

        self.assertIn("Open a shift", str(ctx.exception))
        self.assertEqual(self.state["payment_entries"], [])

    def test_refuses_a_shift_opened_on_another_register(self):
        self.state["shifts"] = [{"name": "SHIFT-0009", "pos_profile": "Other POS"}]

        with self.assertRaises(Exception) as ctx:
            self._deposit()

        self.assertIn("Other POS", str(ctx.exception))

    def test_refuses_a_mode_of_payment_the_register_does_not_carry(self):
        with self.assertRaises(Exception) as ctx:
            self._deposit(mode_of_payment="Bitcoin")

        self.assertIn("not a payment method", str(ctx.exception))
        self.assertEqual(self.state["payment_entries"], [])

    def test_refuses_a_configured_mode_with_no_account_for_this_company(self):
        # "Tarjeta" is on the register but has no Mode of Payment Account row.
        with self.assertRaises(Exception) as ctx:
            self._deposit(mode_of_payment="Tarjeta")

        self.assertIn("default account", str(ctx.exception))

    def test_refuses_a_zero_or_negative_amount(self):
        for amount in (0, -50):
            with self.assertRaises(Exception) as ctx:
                self._deposit(amount=amount)
            self.assertIn("greater than zero", str(ctx.exception))
        self.assertEqual(self.state["payment_entries"], [])

    def test_refuses_a_customer_that_does_not_exist(self):
        with self.assertRaises(Exception) as ctx:
            self._deposit(customer="CUST-NOPE")

        self.assertIn("does not exist", str(ctx.exception))


class TestDeposit(StoredValueTestCase):
    def test_deposit_mints_an_unallocated_receive_entry_the_corte_can_see(self):
        result = self.module.deposit_stored_value(
            pos_profile="Main POS",
            customer="CUST-0001",
            amount=200,
            mode_of_payment="Cash",
        )

        self.assertEqual(len(self.state["payment_entries"]), 1)
        entry = self.state["payment_entries"][0]
        self.assertEqual(entry.payment_type, "Receive")
        self.assertEqual(entry.party_type, "Customer")
        self.assertEqual(entry.party, "CUST-0001")
        self.assertEqual(entry.paid_to, "1110 - Cash - TC")
        self.assertEqual(entry.paid_from, "1310 - Debtors - TC")
        self.assertEqual(entry.paid_amount, 200.0)
        # No references: the whole amount stays unallocated, which is what
        # `get_available_credit` reads back as monedero.
        self.assertEqual(entry.references, [])
        # THE DRAWER. `get_payments_entries` filters Payment Entry on
        # `reference_no == <opening shift>`; without this the cash is in the
        # till and absent from the corte's expected amount.
        self.assertEqual(entry.reference_no, "SHIFT-0001")
        self.assertEqual(entry.reference_date, TODAY)
        self.assertTrue(entry.submitted)
        self.assertEqual(result["pos_opening_shift"], "SHIFT-0001")
        self.assertEqual(result["payment_entry"], "ACC-PAY-2026-00001")

    def test_deposit_reports_the_balance_it_produced(self):
        self.state["credits"] = [{"total_credit": 200, "credit_to_redeem": 0}]

        result = self.module.deposit_stored_value(
            pos_profile="Main POS",
            customer="CUST-0001",
            amount=200,
            mode_of_payment="Cash",
        )

        self.assertEqual(result["balance"], 200.0)
        self.assertEqual(result["amount"], 200.0)

    def test_deposit_asserts_tenant_scope_as_well_as_the_register_gates(self):
        self.module.deposit_stored_value(
            pos_profile="Main POS",
            customer="CUST-0001",
            amount=25,
            mode_of_payment="Cash",
        )

        self.assertEqual(
            sorted(self.state["scope_calls"]), ["company", "customer", "profile"]
        )


class TestCashbackPreview(StoredValueTestCase):
    def _enrol(self, collection_factor=10, conversion_factor=1, **extra):
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        details = {
            "loyalty_program": "Puntos Doco",
            "collection_factor": collection_factor,
            "conversion_factor": conversion_factor,
            "loyalty_points": 0,
            "from_date": "2026-01-01",
            "to_date": None,
        }
        details.update(extra)
        self.state["loyalty_details"] = details

    def test_preview_matches_the_accrual_erpnext_will_post(self):
        # Every one of these has a remainder ERPNext truncates away. A preview
        # that rounded instead would over-promise on the first two.
        cases = [
            (10, 1, 1090.0),
            (10, 1, 1099.99),
            (7.5, 2, 500.0),
            (1, 0.5, 418.4),
            (250, 5, 1249.0),
        ]
        for collection_factor, conversion_factor, amount in cases:
            with self.subTest(amount=amount, collection_factor=collection_factor):
                self._enrol(collection_factor, conversion_factor)
                preview = self.module.get_cashback_preview(
                    customer="CUST-0001",
                    company="Test Company",
                    eligible_amount=amount,
                )
                expected_points = _erpnext_points_earned(amount, collection_factor)
                self.assertEqual(preview["points"], expected_points)
                self.assertEqual(
                    preview["value"], round(expected_points * conversion_factor, 2)
                )

    def test_a_missing_collection_factor_falls_back_to_one_like_erpnext(self):
        self._enrol(collection_factor=0, conversion_factor=1)

        preview = self.module.get_cashback_preview(
            customer="CUST-0001", company="Test Company", eligible_amount=42.9
        )

        self.assertEqual(preview["points"], 42)
        self.assertEqual(preview["collection_factor"], 1.0)

    def test_the_sale_is_folded_into_the_tier_lookup(self):
        # `make_loyalty_point_entry` passes the sale's own amount as
        # `current_transaction_amount`, so a purchase that crosses a tier
        # boundary earns at the NEW tier. The preview must ask the same way.
        seen = {}

        def _details(customer, loyalty_program=None, **kwargs):
            seen.update(kwargs)
            return {
                "collection_factor": 10,
                "conversion_factor": 1,
                "from_date": "2026-01-01",
            }

        sys.modules[
            "erpnext.accounts.doctype.loyalty_program.loyalty_program"
        ].get_loyalty_program_details_with_points = _details
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        try:
            self.module.get_cashback_preview(
                customer="CUST-0001", company="Test Company", eligible_amount=800
            )
        finally:
            sys.modules[
                "erpnext.accounts.doctype.loyalty_program.loyalty_program"
            ].get_loyalty_program_details_with_points = (
                lambda customer, loyalty_program=None, **kwargs: dict(
                    self.state["loyalty_details"]
                )
            )

        self.assertEqual(seen.get("current_transaction_amount"), 800.0)
        self.assertTrue(seen.get("include_expired_entry"))

    def test_an_unenrolled_customer_previews_nothing_rather_than_zero_points(self):
        preview = self.module.get_cashback_preview(
            customer="CUST-0001", company="Test Company", eligible_amount=900
        )

        self.assertFalse(preview["enrolled"])
        self.assertIsNone(preview["program"])
        self.assertEqual(preview["points"], 0)

    def test_a_programme_outside_its_date_window_accrues_nothing(self):
        self._enrol(from_date="2027-01-01")
        self.assertEqual(
            self.module.get_cashback_preview(
                customer="CUST-0001", company="Test Company", eligible_amount=900
            )["points"],
            0,
        )

        self._enrol(from_date="2026-01-01", to_date="2026-06-30")
        self.assertEqual(
            self.module.get_cashback_preview(
                customer="CUST-0001", company="Test Company", eligible_amount=900
            )["points"],
            0,
        )


class TestEnrolment(StoredValueTestCase):
    def test_enrols_the_customer_in_the_registers_programme(self):
        result = self.module.enroll_customer_card(
            pos_profile="Main POS", customer="CUST-0001"
        )

        self.assertEqual(result["program"], "Puntos Doco")
        self.assertTrue(result["enrolled"])
        self.assertFalse(result["already_enrolled"])
        self.assertEqual(
            self.state["customers"]["CUST-0001"]["loyalty_program"], "Puntos Doco"
        )

    def test_re_enrolling_the_same_programme_is_not_an_error(self):
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"

        result = self.module.enroll_customer_card(
            pos_profile="Main POS", customer="CUST-0001"
        )

        self.assertTrue(result["already_enrolled"])

    def test_refuses_when_the_flag_is_off(self):
        self.state["profiles"]["Main POS"].posa_use_customer_cards = 0

        with self.assertRaises(Exception) as ctx:
            self.module.enroll_customer_card(pos_profile="Main POS", customer="CUST-0001")

        self.assertIn("not enabled", str(ctx.exception))

    def test_refuses_when_the_register_names_no_programme(self):
        self.state["profiles"]["Main POS"].posa_customer_card_program = ""

        with self.assertRaises(Exception) as ctx:
            self.module.enroll_customer_card(pos_profile="Main POS", customer="CUST-0001")

        self.assertIn("No cashback program", str(ctx.exception))

    def test_refuses_a_customer_already_on_a_different_programme_and_says_which(self):
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Mumu"

        with self.assertRaises(Exception) as ctx:
            self.module.enroll_customer_card(pos_profile="Main POS", customer="CUST-0001")

        message = str(ctx.exception)
        self.assertIn("Puntos Mumu", message)
        self.assertIn("Puntos Doco", message)
        # And it did NOT overwrite.
        self.assertEqual(
            self.state["customers"]["CUST-0001"]["loyalty_program"], "Puntos Mumu"
        )

    def test_refuses_a_programme_belonging_to_another_company(self):
        # ERPNext would throw at submit; refusing here means the cashier finds
        # out while activating, not while the customer is paying.
        self.state["loyalty_programs"]["Puntos Doco"] = {"company": "Otra SA"}
        try:
            with self.assertRaises(Exception) as ctx:
                self.module.enroll_customer_card(
                    pos_profile="Main POS", customer="CUST-0001"
                )
        finally:
            self.state["loyalty_programs"]["Puntos Doco"] = {"company": "Test Company"}

        self.assertIn("Otra SA", str(ctx.exception))


class TestCustomerWallet(StoredValueTestCase):
    def setUp(self):
        super().setUp()
        self.state["credits"] = [{"total_credit": 200, "credit_to_redeem": 0}]
        self.state["columns"] = {"Sales Invoice": True, "POS Invoice": True}
        self.state["rows"] = {
            "Payment Entry": [
                {
                    "name": "ACC-PAY-0001",
                    "posting_date": "2026-08-20",
                    "creation": "2026-08-20 10:00:00",
                    "paid_amount": 200,
                    "unallocated_amount": 200,
                    "mode_of_payment": "Cash",
                    "owner": "cashier@example.com",
                },
                {
                    "name": "ACC-PAY-0002",
                    "posting_date": "2026-08-21",
                    "creation": "2026-08-21 10:00:00",
                    "paid_amount": 500,
                    "unallocated_amount": 0,
                    "mode_of_payment": "Cash",
                    "owner": "cashier@example.com",
                },
            ],
            "Payment Entry Reference": [{"parent": "ACC-PAY-0002"}],
            "Sales Invoice": [
                {
                    "name": "ACC-SINV-0007",
                    "posting_date": "2026-08-22",
                    "creation": "2026-08-22 10:00:00",
                    "grand_total": -80,
                    "posa_redeemed_customer_credit": 60,
                    "owner": "cashier@example.com",
                }
            ],
            "POS Invoice": [],
            "Loyalty Point Entry": [
                {
                    "name": "LPE-0001",
                    "posting_date": "2026-08-22",
                    "creation": "2026-08-22 11:00:00",
                    "loyalty_points": 12,
                    "purchase_amount": 1200,
                    "invoice": "ACC-SINV-0007",
                    "invoice_type": "Sales Invoice",
                    "redeem_against": None,
                    "owner": "cashier@example.com",
                },
                {
                    "name": "LPE-0002",
                    "posting_date": "2026-08-23",
                    "creation": "2026-08-23 09:00:00",
                    "loyalty_points": -5,
                    "purchase_amount": 0,
                    "invoice": "ACC-SINV-0008",
                    "invoice_type": "Sales Invoice",
                    "redeem_against": "LPE-0001",
                    "owner": "cashier@example.com",
                },
            ],
        }

    def _wallet(self):
        return self.module.get_customer_wallet(
            customer="CUST-0001", company="Test Company"
        )

    def test_the_two_wallets_are_reported_apart(self):
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        self.state["loyalty_details"] = {"loyalty_points": 7, "conversion_factor": 2}

        wallet = self._wallet()

        self.assertEqual(wallet["stored_value"]["balance"], 200.0)
        self.assertEqual(wallet["cashback"]["points"], 7)
        self.assertEqual(wallet["cashback"]["value"], 14.0)
        self.assertTrue(wallet["cashback"]["enrolled"])
        # Nothing anywhere adds 200 and 14 into one figure.
        self.assertNotIn("total", wallet)

    def test_the_headline_balance_is_the_monedero_and_never_a_sum(self):
        # The contact view reads top-level `balance` and hides the whole card
        # without it. It must be the spendable-at-the-till figure, NOT
        # monedero + cashback: they are different promises, and a customer
        # told 214 cannot hand over 214.
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        self.state["loyalty_details"] = {"loyalty_points": 7, "conversion_factor": 2}

        wallet = self._wallet()

        self.assertEqual(wallet["balance"], 200.0)
        self.assertEqual(wallet["deposited"], 200.0)
        self.assertEqual(wallet["cashback_value"], 14.0)
        self.assertNotEqual(wallet["balance"], 214.0)

    def test_the_cashback_rate_is_a_percent_not_a_fraction(self):
        # A programme paying 1 peso for every 10 spent is 10 %. Sending a
        # fraction would be ambiguous at exactly 1, where 1 % and 100 % look
        # identical.
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        self.state["loyalty_details"] = {
            "loyalty_points": 7,
            "conversion_factor": 1,
            "collection_factor": 10,
            "loyalty_program_name": "Cashback Doco",
        }

        wallet = self._wallet()

        self.assertEqual(wallet["cashback_percent"], 10.0)
        self.assertEqual(wallet["program"], "Puntos Doco")
        self.assertEqual(wallet["program_name"], "Cashback Doco")

    def test_the_rate_is_absent_rather_than_zero_when_it_cannot_be_computed(self):
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        self.state["loyalty_details"] = {"loyalty_points": 7, "conversion_factor": 1}

        self.assertIsNone(self._wallet()["cashback_percent"])

    def test_an_unenrolled_customer_has_a_monedero_and_no_cashback(self):
        wallet = self._wallet()

        self.assertEqual(wallet["stored_value"]["balance"], 200.0)
        self.assertEqual(wallet["balance"], 200.0)
        self.assertFalse(wallet["enrolled"])
        self.assertFalse(wallet["cashback"]["enrolled"])
        self.assertIsNone(wallet["cashback"]["program"])
        self.assertIsNone(wallet["cashback_percent"])
        self.assertEqual(wallet["cashback"]["points"], 0)

    def test_movements_carry_every_source_signed_and_newest_first(self):
        self.state["customers"]["CUST-0001"]["loyalty_program"] = "Puntos Doco"
        self.state["loyalty_details"] = {"loyalty_points": 7, "conversion_factor": 2}

        movements = self._wallet()["movements"]
        by_kind = {row["kind"]: row for row in movements}

        # The vocabulary the contact view maps. Anything outside this set
        # renders degraded on that screen, so it is pinned here.
        self.assertEqual(
            set(by_kind),
            {"deposit", "credit_note", "redemption", "cashback", "cashback_spent"},
        )
        # One value, two key names, so the two screens cannot drift.
        for row in movements:
            self.assertEqual(row["kind"], row["type"])

        self.assertEqual(by_kind["deposit"]["amount"], 200.0)
        self.assertEqual(by_kind["deposit"]["reference"], "ACC-PAY-0001")
        self.assertEqual(by_kind["deposit"]["reference_name"], "ACC-PAY-0001")
        self.assertEqual(by_kind["deposit"]["ts"], "2026-08-20 10:00:00")
        # `detail` is the SECONDARY fact, never a copy of `label` — a reader
        # that printed both would render «Depósito · Depósito».
        self.assertEqual(by_kind["deposit"]["label"], "Deposit")
        self.assertEqual(by_kind["deposit"]["detail"], "Cash")
        self.assertEqual(by_kind["cashback"]["detail"], "Puntos Doco")
        self.assertIsNone(by_kind["credit_note"]["detail"])
        self.assertEqual(by_kind["credit_note"]["amount"], 80.0)
        # Spending is negative so one column can carry the whole ledger, and
        # the sign convention is never mixed within a payload.
        self.assertEqual(by_kind["redemption"]["amount"], -60.0)
        self.assertEqual(by_kind["cashback"]["amount"], 24.0)
        self.assertEqual(by_kind["cashback"]["points"], 12)
        self.assertEqual(by_kind["cashback_spent"]["amount"], -10.0)

        dates = [row["posting_date"] for row in movements]
        self.assertEqual(dates, sorted(dates, reverse=True))

    def test_a_fully_allocated_payment_entry_is_not_a_deposit(self):
        # ACC-PAY-0002 paid an invoice; none of it ever reached the monedero.
        names = [
            row["reference_name"]
            for row in self._wallet()["movements"]
            if row["kind"] == "deposit"
        ]
        self.assertEqual(names, ["ACC-PAY-0001"])

    def test_the_cap_is_stated_in_the_payload(self):
        wallet = self.module.get_customer_wallet(
            customer="CUST-0001", company="Test Company", limit=2
        )

        self.assertEqual(wallet["cap"], 2)
        self.assertEqual(wallet["movements_limit"], 2)
        self.assertEqual(len(wallet["movements"]), 2)
        self.assertTrue(wallet["truncated"])
        self.assertTrue(wallet["movements_truncated"])

    def test_a_site_without_the_credit_columns_contributes_no_redemption_rows(self):
        self.state["columns"] = {}

        kinds_seen = {row["kind"] for row in self._wallet()["movements"]}

        self.assertNotIn("redemption", kinds_seen)
        self.assertIn("deposit", kinds_seen)


if __name__ == "__main__":
    unittest.main()
