"""The Apertura server read model, as judgements rather than as queries.

Every `describe_*` under test is pure — plain values in, a plain dict out — so
these run with no site, no POS Profile and no clock. That is the point: the
decisions this endpoint makes are the ones that turn nine «no verificado» rows
into answers, and each of them is a way a wrong answer could reach a cashier:

  1. a warehouse that is a group node, disabled or another company's looks
     exactly like a working one from its name, and point 2 is REQUIRED;
  2. «the payload carries no account field» and «this mode has no account»
     were the same shape in JavaScript, and only one of them is a reason not
     to open a till;
  3. `unknown` may never quietly become `pass` — an absent group has to stay
     absent rather than arrive as a confident empty answer.

The two tests that need a site do not get one either: they patch the loaded
module's `frappe` with a fake they control, which is how the scope gate can be
proved to run BEFORE the first read.
"""

from __future__ import annotations

import importlib.util
import pathlib
import types
import unittest
from unittest import mock

# Loaded through `test_support/isolated_module`, which stubs the subject's
# module-level imports and RESTORES `sys.modules` afterwards. Read its header
# before changing this.
_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)

# `vertical` and `employees` are package imports the subject makes for two
# facts — how a capability contract resolves, and what the supervisor role is
# called. Both are stubbed so this suite tests the READ MODEL rather than
# re-testing modules that carry their own suites.
_vertical = types.ModuleType("posawesome.posawesome.api.vertical")
_vertical.opening_capability_payload = lambda name: None
_employees = types.ModuleType("posawesome.posawesome.api.employees")
_employees.POS_SUPERVISOR_ROLE = "POS Awesome Supervisor"

readiness = _isolated.load_api_module(
    "posawesome_opening_readiness",
    "opening_readiness.py",
    extra={
        "posawesome.posawesome.api.vertical": _vertical,
        "posawesome.posawesome.api.employees": _employees,
    },
)


class ContractTests(unittest.TestCase):
    def test_no_preset_is_unconfigured_which_is_a_valid_register(self):
        answer = readiness.describe_contract(None, "Grupo Doco")

        self.assertEqual(answer["status"], "unconfigured")
        self.assertEqual(answer["company"], "Grupo Doco")

    def test_an_unresolvable_preset_is_invalid_and_that_one_stops_the_opening(self):
        answer = readiness.describe_contract(
            {"name": "invalid-configuration", "resolution": {"status": "invalid"}}, "Grupo Doco"
        )

        self.assertEqual(answer["status"], "invalid")

    def test_a_last_known_good_replay_is_resolved_because_that_is_what_would_open(self):
        # `vertical.py` has a fourth status the check has never heard of. It
        # must collapse to `resolved`, not fall through to `invalid`, or a
        # register replaying its last good contract would be walled shut.
        answer = readiness.describe_contract(
            {
                "name": "Venta al mostrador",
                "vertical": "Celulares y accesorios",
                "resolution": {"status": "temporarily_unavailable"},
            },
            "Grupo Doco",
        )

        self.assertEqual(answer["status"], "resolved")
        self.assertEqual(answer["mode"], "Venta al mostrador")
        self.assertEqual(answer["giro"], "Celulares y accesorios")


class CatalogueTests(unittest.TestCase):
    """Point 2's «sirve para vender» — the judgement the client deferred here."""

    SELLS = {"is_group": 0, "disabled": 0, "company": "Grupo Doco"}

    def test_a_working_warehouse_sells(self):
        answer = readiness.describe_catalogue(
            "Mostrador", "Standard Selling", self.SELLS, "Grupo Doco", 1482
        )

        self.assertTrue(answer["warehouse_sells"])
        self.assertEqual(answer["priced_items"], 1482)

    def test_a_group_node_does_not_sell(self):
        row = dict(self.SELLS, is_group=1)

        self.assertFalse(
            readiness.describe_catalogue("Almacenes", "L", row, "Grupo Doco", 0)["warehouse_sells"]
        )

    def test_a_disabled_warehouse_does_not_sell(self):
        row = dict(self.SELLS, disabled=1)

        self.assertFalse(
            readiness.describe_catalogue("Bodega", "L", row, "Grupo Doco", 0)["warehouse_sells"]
        )

    def test_another_company_s_warehouse_does_not_sell(self):
        row = dict(self.SELLS, company="Mumulencería")

        self.assertFalse(
            readiness.describe_catalogue("Mostrador", "L", row, "Grupo Doco", 0)["warehouse_sells"]
        )

    def test_a_named_warehouse_that_does_not_exist_does_not_sell(self):
        self.assertFalse(
            readiness.describe_catalogue("Fantasma", "L", None, "Grupo Doco", 0)["warehouse_sells"]
        )

    def test_no_warehouse_leaves_the_judgement_unknown_rather_than_false(self):
        # Presence already fails the check and says which field is missing. A
        # `false` here would put a second, wronger reason on the same row.
        answer = readiness.describe_catalogue(None, "Standard Selling", None, "Grupo Doco", None)

        self.assertIsNone(answer["warehouse_sells"])
        self.assertIsNone(answer["warehouse"])


class FiscalTests(unittest.TestCase):
    def test_the_highest_rate_on_the_template_wins(self):
        answer = readiness.describe_fiscal(
            1, "IVA 16%", [{"rate": 0}, {"rate": 16}, {"rate": 8}]
        )

        self.assertEqual(answer["tax_rate"], 16)
        self.assertTrue(answer["stamping_enabled"])

    def test_a_rate_that_is_not_a_number_is_skipped_not_fatal(self):
        answer = readiness.describe_fiscal(0, "IVA 16%", [{"rate": None}, {"rate": "16"}])

        self.assertEqual(answer["tax_rate"], 16)
        self.assertFalse(answer["stamping_enabled"])

    def test_a_template_with_no_rows_reports_no_rate_rather_than_zero(self):
        # Zero is a rate. "Nobody read one" is not, and the check renders a
        # different line for each.
        self.assertIsNone(readiness.describe_fiscal(1, "IVA 16%", [])["tax_rate"])

    def test_emc_s_facts_are_absent_rather_than_guessed(self):
        answer = readiness.describe_fiscal(1, "IVA 16%", [{"rate": 16}])

        for guess in ("cfdi_version", "regime", "stamps_remaining"):
            self.assertNotIn(guess, answer)


class TenderTests(unittest.TestCase):
    """Point 4 — the one point on the list with a money consequence."""

    def test_every_mode_carries_the_account_it_posts_to(self):
        answer = readiness.describe_tenders(
            ["Cash", "Wire Transfer"],
            {"Cash": "Caja Tienda - GD", "Wire Transfer": "BBVA Debito - GD"},
        )

        self.assertEqual(
            answer["rows"],
            [
                {"mode": "Cash", "account": "Caja Tienda - GD"},
                {"mode": "Wire Transfer", "account": "BBVA Debito - GD"},
            ],
        )

    def test_a_mode_with_no_account_for_this_company_reports_an_empty_one(self):
        # Not omitted, not null-with-a-shrug: reported and empty, which is what
        # makes the check FAIL instead of going unknown.
        answer = readiness.describe_tenders(["Cash", "Monedero"], {"Cash": "Caja Tienda - GD"})

        self.assertEqual(answer["rows"][1], {"mode": "Monedero", "account": ""})

    def test_accounts_are_always_reported_because_this_function_looked(self):
        self.assertTrue(readiness.describe_tenders(["Cash"], {})["accounts_reported"])
        self.assertTrue(readiness.describe_tenders([], None)["accounts_reported"])

    def test_a_blank_mode_row_is_dropped_rather_than_reported_as_nameless(self):
        answer = readiness.describe_tenders(["Cash", None, "  "], {"Cash": "Caja - GD"})

        self.assertEqual([row["mode"] for row in answer["rows"]], ["Cash"])


class FormatTests(unittest.TestCase):
    def test_a_format_that_no_longer_exists_is_reported_as_missing(self):
        answer = readiness.describe_formats("Ticket 58 mm", False, None, 1)

        self.assertEqual(answer["ticket_format"], "Ticket 58 mm")
        self.assertFalse(answer["ticket_format_exists"])
        self.assertTrue(answer["cfdi_pdf"])

    def test_no_format_configured_leaves_existence_unasked(self):
        answer = readiness.describe_formats(None, None, None, 0)

        self.assertIsNone(answer["ticket_format"])
        self.assertIsNone(answer["ticket_format_exists"])
        self.assertFalse(answer["cfdi_pdf"])


class PeopleTests(unittest.TestCase):
    def test_nobody_authorising_is_an_empty_list_never_a_null(self):
        # `null` means "the roster was never loaded" and renders unverified;
        # `[]` means "nobody on this register can authorise", which is a
        # finding. Collapsing the two would hide the finding.
        answer = readiness.describe_people("Jenni Robledo", ["Jenni Robledo"], [])

        self.assertEqual(answer["authorisers"], [])
        self.assertEqual(answer["seller_count"], 1)

    def test_the_authorisers_are_named_so_the_cashier_knows_who_to_call(self):
        answer = readiness.describe_people("Jenni", ["Jenni", "Rosa"], ["Rosa"])

        self.assertEqual(answer["authorisers"], ["Rosa"])
        self.assertEqual(answer["seller_count"], 2)


class TestSaleTests(unittest.TestCase):
    def test_no_reversal_on_record_answers_false_rather_than_unknown(self):
        answer = readiness.describe_test_sale(None)

        self.assertFalse(answer["performed"])
        self.assertIsNone(answer["reverted_on"])

    def test_a_submitted_return_is_the_evidence_and_it_names_itself(self):
        answer = readiness.describe_test_sale(
            {
                "name": "ACC-SINV-2026-02467",
                "posting_date": "2026-07-15",
                "return_against": "ACC-SINV-2026-02267",
            }
        )

        self.assertTrue(answer["performed"])
        self.assertEqual(answer["reverted_on"], "2026-07-15")
        self.assertEqual(answer["reversal"], "ACC-SINV-2026-02467")


class _Doc:
    """Just enough POS Profile: `.get()` on fields that may not exist."""

    def __init__(self, data):
        self._data = data

    def get(self, key, default=None):
        return self._data.get(key, default)


PROFILE = _Doc(
    {
        "company": "Grupo Doco",
        "warehouse": "Mostrador - GD",
        "selling_price_list": "Standard Selling",
        "taxes_and_charges": "IVA 16% - GD",
        "posa_cfdi_enable_stamping": 1,
        "print_format": "Ticket 80mm",
        "payments": [{"mode_of_payment": "Cash"}, {"mode_of_payment": "Monedero"}],
        "applicable_for_users": [{"user": "jenni@doco.mx"}, {"user": "rosa@doco.mx"}],
    }
)


def _fake_frappe(**overrides):
    """A frappe the test owns entirely. Every read answers, so a group that
    comes back `None` is a defect in the subject rather than a gap here."""

    def get_all(doctype, **kwargs):
        if doctype == "Sales Taxes and Charges":
            return [{"rate": 16}]
        if doctype == "Mode of Payment Account":
            return [{"parent": "Cash", "default_account": "Caja Tienda - GD"}]
        if doctype == "User":
            return [
                {"name": "jenni@doco.mx", "full_name": "Jenni Robledo"},
                {"name": "rosa@doco.mx", "full_name": "Rosa Elena"},
            ]
        if doctype == "Has Role":
            return [{"parent": "rosa@doco.mx"}]
        return []

    def get_value(doctype, name, field, **kwargs):
        if doctype == "Warehouse":
            return {"is_group": 0, "disabled": 0, "company": "Grupo Doco"}
        return "Jenni Robledo"

    fake = types.SimpleNamespace(
        session=types.SimpleNamespace(user="jenni@doco.mx"),
        get_cached_doc=lambda doctype, name: PROFILE,
        get_all=get_all,
        log_error=mock.Mock(),
        get_traceback=lambda: "",
        db=types.SimpleNamespace(
            get_value=get_value,
            count=lambda doctype, filters=None: 1482,
            exists=lambda doctype, name=None: bool(name),
            has_column=lambda doctype, column: False,
        ),
    )
    for key, value in overrides.items():
        setattr(fake, key, value)
    return fake


class EndpointTests(unittest.TestCase):
    """The wiring: the gate, and what happens when one group cannot answer."""

    def test_the_scope_gate_runs_before_the_register_is_read(self):
        # The risk this guards is forgetting the assertion, not the assertion
        # itself — `_scope` has its own suites. A refusal must reach the caller
        # as a refusal, and nothing may have been read on the way there.
        fake = _fake_frappe()
        opened = []
        fake.get_cached_doc = lambda doctype, name: opened.append(name) or PROFILE

        def refuse(user, profile):
            raise PermissionError(profile)

        with mock.patch.object(readiness, "frappe", fake), mock.patch.object(
            readiness, "assert_profile", refuse
        ):
            with self.assertRaises(PermissionError):
                readiness.get_opening_readiness("Doco Ventas")

        self.assertEqual(opened, [])

    def test_a_configured_register_answers_all_seven_server_side_points(self):
        fake = _fake_frappe()
        with mock.patch.object(readiness, "frappe", fake), mock.patch.object(
            readiness, "assert_profile", lambda *a: None
        ), mock.patch.object(readiness, "assert_company", lambda *a: None):
            payload = readiness.get_opening_readiness("Doco Ventas")

        for group in ("contract", "catalogue", "fiscal", "tenders", "formats", "people", "test_sale"):
            self.assertIsNotNone(payload[group], f"{group} could not be answered")
        # An answered group that quietly logged is an answer nobody should
        # trust; this is what keeps the assertions above from passing vacuously.
        fake.log_error.assert_not_called()
        self.assertEqual(payload["company"], "Grupo Doco")
        self.assertEqual(payload["tenders"]["rows"][1], {"mode": "Monedero", "account": ""})
        self.assertEqual(payload["people"]["authorisers"], ["Rosa Elena"])
        # Devices, the offline cache and the floor are the browser's facts.
        for browser_only in ("devices", "offline", "floor"):
            self.assertNotIn(browser_only, payload)

    def test_a_group_that_cannot_be_computed_is_omitted_and_logged(self):
        # Omitted renders «no verificado», which is the same degradation as a
        # server that never answered. A partial answer must never look like a
        # pass — and it must never look like silence either.
        def explode(price_list):
            raise RuntimeError("Item Price is gone")

        fake = _fake_frappe()
        with mock.patch.object(readiness, "frappe", fake), mock.patch.object(
            readiness, "assert_profile", lambda *a: None
        ), mock.patch.object(readiness, "assert_company", lambda *a: None), mock.patch.object(
            readiness, "_fetch_priced_item_count", explode
        ):
            payload = readiness.get_opening_readiness("Doco Ventas")

        self.assertIsNone(payload["catalogue"])
        self.assertIsNotNone(payload["tenders"])
        fake.log_error.assert_called_once()

    def test_only_enabled_users_count_as_people_who_sell(self):
        fake = _fake_frappe()
        fake.get_all = lambda doctype, **kwargs: (
            [{"name": "jenni@doco.mx", "full_name": "Jenni Robledo"}]
            if doctype == "User"
            else ([{"parent": "rosa@doco.mx"}] if doctype == "Has Role" else [])
        )
        with mock.patch.object(readiness, "frappe", fake):
            sellers, authorisers = readiness._fetch_roster(["jenni@doco.mx", "rosa@doco.mx"])

        # Rosa carries the supervisor role and is still not an authoriser: a
        # disabled user cannot open anything, so the roster is who CAN sell.
        self.assertEqual(sellers, ["Jenni Robledo"])
        self.assertEqual(authorisers, [])

    def test_the_legacy_supervisor_checkbox_still_authorises(self):
        fake = _fake_frappe()
        fake.db.has_column = lambda doctype, column: True
        fake.get_all = lambda doctype, **kwargs: (
            [{"name": "rosa@doco.mx", "full_name": "Rosa Elena", "posa_is_pos_supervisor": 1}]
            if doctype == "User"
            else []
        )
        with mock.patch.object(readiness, "frappe", fake):
            _, authorisers = readiness._fetch_roster(["rosa@doco.mx"])

        self.assertEqual(authorisers, ["Rosa Elena"])


if __name__ == "__main__":
    unittest.main()
