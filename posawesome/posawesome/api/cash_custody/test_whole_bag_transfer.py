"""Whole sealed bag transfer: safe -> configured off-site cash ledger, amount from the bag.

Runs without a site. The real `service.py`, `documents.py` and `model.py` run
against a small stateful fake: stored bags, custody events, GL balances moved by
each posted journal, and the account/profile/register tables the destination
guard reads. Stubs live in `sys.modules` only for the duration of each test.
Native checks against MariaDB (row locks, real Journal Entry submit) are the
drill in docs/WHOLE-BAG-TRANSFERS.md.
"""
import copy
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

DIR = pathlib.Path(__file__).parent
PKG = "_custody_transfer_under_test"


class _Permission(Exception):
    pass


class _Validation(Exception):
    pass


class _Missing(Exception):
    pass


class _Dict(dict):
    __getattr__ = dict.get


LAB = {}


def _fresh_lab():
    LAB.clear()
    LAB.update(
        user="dueno@example.com",
        supervisors={"dueno@example.com", "gerente@example.com"},
        profiles={"dueno@example.com": {"Tienda"}, "gerente@example.com": {"Tienda"},
                  "othercashier@example.com": {"Tienda"}, "externo@example.com": {"Otra"}},
        safes={
            "CASH-SAFE-00001": dict(name="CASH-SAFE-00001", title="Tienda", company="Doco", pos_profile="Tienda",
                                    currency="MXN", enabled=1, safe_account="SAFE-ACC", transit_account="TRANSIT-ACC",
                                    bank_account="BANK-ACC", variance_account="VAR-ACC",
                                    offsite_cash_account="HOME-SAFE-ACC", float_target=1000, drawer_limit=5000),
            "CASH-SAFE-00002": dict(name="CASH-SAFE-00002", title="Otra", company="Doco", pos_profile="Otra",
                                    currency="MXN", enabled=1, safe_account="SAFE-ACC-2", transit_account="TRANSIT-ACC-2",
                                    bank_account="BANK-ACC-2", variance_account="VAR-ACC-2",
                                    offsite_cash_account=None, float_target=0, drawer_limit=0),
        },
        accounts={name: _Dict(company="Doco", is_group=0, disabled=0, account_currency="MXN", account_type=kind,
                              account_name=name.title())
                  for name, kind in [("SAFE-ACC", "Cash"), ("TRANSIT-ACC", "Cash"), ("BANK-ACC", "Bank"),
                                     ("VAR-ACC", ""), ("DRAWER-ACC", "Cash"), ("HOME-SAFE-ACC", "Cash"),
                                     ("SAFE-ACC-2", "Cash"), ("DRAWER-ACC-2", "Cash"), ("MP-CARD-ACC", "Cash"),
                                     ("REGISTER-DRAWER-ACC", "Cash"), ("ALLOWED-SOURCE-ACC", "Cash"),
                                     ("BANK-TYPE-ACC", "Bank"), ("GROUP-CASH", "Cash"), ("DISABLED-CASH", "Cash"),
                                     ("OTHER-CO-CASH", "Cash"), ("USD-CASH", "Cash")]},
        tables={
            "POS Profile": [_Dict(name="Tienda", company="Doco", posa_back_office_cash_account="SAFE-ACC",
                                  posa_default_source_account="DRAWER-ACC", cost_center="Main - D"),
                            _Dict(name="Otra", company="Doco", posa_back_office_cash_account="SAFE-ACC-2",
                                  posa_default_source_account="DRAWER-ACC-2", cost_center="Main - D")],
            "POS Allowed Source Account": [_Dict(parenttype="POS Profile", account="ALLOWED-SOURCE-ACC")],
            "Mode of Payment Account": [_Dict(company="Doco", default_account="DRAWER-ACC"),
                                        _Dict(company="Doco", default_account="MP-CARD-ACC")],
            "POS Register": [_Dict(company="Doco", drawer_account="REGISTER-DRAWER-ACC")],
        },
        gl={"SAFE-ACC": 5000.0, "HOME-SAFE-ACC": 0.0},
        bags={},
        events={},
        counts=[],
        journals=[],
        locks=[],
    )
    LAB["accounts"]["GROUP-CASH"]["is_group"] = 1
    LAB["accounts"]["DISABLED-CASH"]["disabled"] = 1
    LAB["accounts"]["OTHER-CO-CASH"]["company"] = "Otra Empresa"
    LAB["accounts"]["USD-CASH"]["account_currency"] = "USD"


def bag(name, state="Unverified", safe="CASH-SAFE-00001", **overrides):
    owner = LAB["safes"][safe]
    row = dict(name=name, seal="SEAL-" + name[-5:], purpose="Takings", state=state, amount=2211.0,
               count_json=json.dumps({"total_minor": 221100, "source": "denominations"}),
               prepared_by="othercashier@example.com", verified_by=None, received_by=None,
               safe=safe, company=owner["company"], pos_profile=owner["pos_profile"], currency="MXN",
               note="Takings from closing", transfer_account=None, transfer_journal=None,
               transferred_by=None, transferred_on=None)
    row.update(overrides)
    LAB["bags"][name] = row
    return row


# Framework fake -------------------------------------------------------------
def _throw(message, exc=_Validation, **kwargs):
    raise exc(message)


class _Doc:
    def __init__(self, doctype, values):
        self.__dict__.update(values)
        self.doctype = doctype
        self.flags = types.SimpleNamespace(custody_locked=False)

    def get(self, key, default=None):
        return getattr(self, key, default)

    def save(self, ignore_permissions=False):
        if not getattr(FRAPPE.local, "cash_custody_write", False):
            _throw("Use the cash custody actions to change this record.", _Permission)
        values = {k: v for k, v in self.__dict__.items() if k not in {"flags", "doctype"}}
        if self.doctype == "POS Cash Bag":
            LAB["bags"][self.name] = values
        elif self.doctype == "POS Cash Custody Event":
            self.name = values["name"] = "EVT-%05d" % (len(LAB["events"]) + 1)
            LAB["events"][values["request_id"]] = values
        elif self.doctype == "POS Cash Count":
            LAB["counts"].append(values)
        return self


def _get_doc(doctype, name=None, for_update=False, **kwargs):
    if isinstance(doctype, dict):
        values = dict(doctype)
        return _Doc(values.pop("doctype"), values)
    LAB["locks"].append((doctype, name, bool(for_update)))
    if doctype == "POS Cash Safe":
        return _Doc(doctype, copy.deepcopy(LAB["safes"][name]))
    if doctype == "POS Cash Bag":
        if name not in LAB["bags"]:
            _throw("POS Cash Bag %s not found" % name, _Missing)
        return _Doc(doctype, copy.deepcopy(LAB["bags"][name]))
    if doctype == "POS Profile":
        return next(row for row in LAB["tables"]["POS Profile"] if row.name == name)
    raise AssertionError("unexpected get_doc " + doctype)


def _matches(row, filters):
    for field, condition in (filters or {}).items():
        value = row.get(field)
        if isinstance(condition, list):
            operator, operand = condition
            if (operator == "!=" and value == operand) or (operator == "in" and value not in operand):
                return False
        elif value != condition:
            return False
    return True


def _get_all(doctype, filters=None, fields=None, pluck=None, **kwargs):
    rows = list(LAB["safes"].values()) if doctype == "POS Cash Safe" else LAB["tables"].get(doctype, [])
    rows = [row for row in rows if _matches(row, filters)]
    if pluck:
        return [row.get(pluck) for row in rows]
    return [{field: row.get(field) for field in fields} for row in rows]


def _exists(doctype, filters=None):
    if doctype == "POS Cash Safe":
        return any(_matches(safe, filters) for safe in LAB["safes"].values())
    raise AssertionError("unexpected exists " + doctype)


def _get_value(doctype, filters=None, fieldname=None, as_dict=False, **kwargs):
    if doctype == "POS Cash Safe":
        return next((safe["name"] for safe in LAB["safes"].values() if _matches(safe, filters)), None)
    if doctype == "POS Cash Custody Event":
        row = LAB["events"].get(filters["request_id"])
        return _Dict(row) if row else None
    if doctype == "POS Profile":
        return next(row for row in LAB["tables"]["POS Profile"] if row.name == filters).get(fieldname)
    if doctype == "Account":
        row = LAB["accounts"].get(filters)
        if not row:
            return None
        return _Dict({field: row[field] for field in fieldname}) if as_dict else row.get(fieldname)
    raise AssertionError("unexpected get_value " + doctype)


def _sql(query, values=None, **kwargs):
    if "tabGL Entry" in query:
        return [[LAB["gl"].get(values[0], 0.0)]]
    if "tabPOS Cash Bag" in query:
        held = sum(row["amount"] for row in LAB["bags"].values()
                   if row["safe"] == values[0] and row["state"] in {"Available", "Unverified", "Disputed"})
        return [[held]]
    raise AssertionError("unexpected sql")


def _create_journal_entry(company, posting_date, movement_type, amount, source_account, target_account,
                          remarks=None, cost_center=None):
    name = "ACC-JV-%05d" % (len(LAB["journals"]) + 1)
    LAB["journals"].append(dict(name=name, company=company, movement_type=movement_type, amount=amount,
                                source=source_account, target=target_account, remarks=remarks,
                                cost_center=cost_center))
    LAB["gl"][source_account] = LAB["gl"].get(source_account, 0.0) - amount
    LAB["gl"][target_account] = LAB["gl"].get(target_account, 0.0) + amount
    return name


def _assert_profile(user, profile):
    if profile not in LAB["profiles"].get(user, set()):
        _throw("Register out of scope", _Permission)


def _stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.PermissionError = _Permission
    frappe_module.ValidationError = _Validation
    frappe_module.DoesNotExistError = _Missing
    frappe_module.throw = _throw
    frappe_module._ = lambda message, *args, **kwargs: message
    frappe_module.session = types.SimpleNamespace(user=None)
    frappe_module.local = types.SimpleNamespace(site="lab")
    frappe_module.get_doc = _get_doc
    frappe_module.get_all = _get_all
    frappe_module.get_cached_value = lambda doctype, name, field: "MXN"
    frappe_module.db = types.SimpleNamespace(table_exists=lambda doctype: True, exists=_exists,
                                             get_value=_get_value, sql=_sql)

    def module(path, **attributes):
        stub = types.ModuleType(path)
        for key, value in attributes.items():
            setattr(stub, key, value)
        return stub

    package = module(PKG)
    package.__path__ = [str(DIR)]
    return frappe_module, {
        "frappe": frappe_module,
        "frappe.utils": module("frappe.utils", nowdate=lambda: "2026-09-23",
                               now_datetime=lambda: "2026-09-23 18:30:00"),
        "frappe.model": module("frappe.model"),
        "frappe.model.document": module("frappe.model.document", Document=object),
        "posawesome.posawesome.api._scope": module("posawesome.posawesome.api._scope",
                                                   assert_profile=_assert_profile,
                                                   assert_company=lambda user, company: True),
        "posawesome.posawesome.api.cash_movement.posting": module(
            "posawesome.posawesome.api.cash_movement.posting", create_journal_entry=_create_journal_entry),
        "posawesome.posawesome.api.cash_movement.service": module(
            "posawesome.posawesome.api.cash_movement.service",
            _create_cash_movement=lambda *args: _throw("transfer must not create a drawer movement")),
        "posawesome.posawesome.api.cash_movement.validation": module(
            "posawesome.posawesome.api.cash_movement.validation",
            resolve_source_cash_account=lambda payload, profile: profile.posa_default_source_account),
        "posawesome.posawesome.api.shift_terminal": module("posawesome.posawesome.api.shift_terminal",
                                                           assert_terminal_access=lambda *args: True),
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices": module(
            "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices",
            is_closing_supervisor=lambda user: user in LAB["supervisors"]),
        "posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer": module(
            "posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer",
            get_safe_gl_balance=lambda account, company=None: LAB["gl"].get(account, 0.0)),
        PKG: package,
    }


FRAPPE, STUBS = _stubs()


def _load(name):
    with patch.dict(sys.modules, STUBS):
        spec = importlib.util.spec_from_file_location(f"{PKG}.{name}", DIR / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return module


MODEL = _load("model")
STUBS[PKG + ".model"] = MODEL
DOCUMENTS = _load("documents")
STUBS[PKG + ".documents"] = DOCUMENTS
SERVICE = _load("service")


# Tests ----------------------------------------------------------------------
class WholeBagTransferTest(unittest.TestCase):
    profile = "Tienda"

    def setUp(self):
        _fresh_lab()
        modules = patch.dict(sys.modules, STUBS)
        modules.start()
        self.addCleanup(modules.stop)
        self.request = 0
        self.act("dueno@example.com")

    def act(self, user):
        LAB["user"] = user
        FRAPPE.session.user = user

    def payload(self, name="CASH-BAG-00004", **extra):
        self.request += 1
        data = dict(pos_profile=self.profile, bag=name, request_id="bot-transfer-%012d" % self.request,
                    note="Physically moved sealed bag to the home safe")
        data.update(extra)
        return data

    def transfer(self, data):
        return SERVICE._command("transfer_safe", data)

    def assert_refused(self, data, exc=_Validation, message=None):
        before = copy.deepcopy((LAB["bags"], LAB["gl"], LAB["events"], LAB["journals"]))
        with self.assertRaises(exc) as caught:
            self.transfer(data)
        if message:
            self.assertIn(message, str(caught.exception))
        self.assertEqual((LAB["bags"], LAB["gl"], LAB["events"], LAB["journals"]), before)

    def loose(self):
        return SERVICE.loose_balance(SERVICE.safe_for(self.profile))

    # Whole amount, no forged verification ------------------------------------
    def test_unverified_sealed_bag_moves_whole_without_forging_a_count(self):
        original = bag("CASH-BAG-00004", seal="SOBRANTE23")
        loose_before = self.loose()
        result = self.transfer(self.payload())
        self.assertEqual(result, {"bag": "CASH-BAG-00004", "amount": 2211.0, "state": "Transferred",
                                  "transfer_account": "HOME-SAFE-ACC", "journal_entry": "ACC-JV-00001"})
        stored = LAB["bags"]["CASH-BAG-00004"]
        for field in ["prepared_by", "verified_by", "received_by", "count_json", "amount", "seal", "purpose"]:
            self.assertEqual(stored[field], original[field], field)
        self.assertIsNone(stored["verified_by"])
        self.assertEqual((stored["transfer_account"], stored["transfer_journal"], stored["transferred_by"]),
                         ("HOME-SAFE-ACC", "ACC-JV-00001", "dueno@example.com"))
        self.assertTrue(stored["transferred_on"])
        self.assertEqual(LAB["counts"], [], "a transfer is not a count")
        [journal] = LAB["journals"]
        self.assertEqual((journal["movement_type"], journal["source"], journal["target"], journal["amount"]),
                         ("Transfer", "SAFE-ACC", "HOME-SAFE-ACC", 2211.0))
        self.assertIn("SOBRANTE23", journal["remarks"])
        self.assertEqual(LAB["gl"], {"SAFE-ACC": 2789.0, "HOME-SAFE-ACC": 2211.0})
        # The bag was reserved safe cash; it leaves with its ledger amount, so loose cash is unchanged.
        self.assertEqual(self.loose(), loose_before)
        event = LAB["events"]["bot-transfer-000000000001"]
        self.assertEqual((event["action"], event["bag"], event["amount"], event["actor"]),
                         ("transfer_safe", "CASH-BAG-00004", 2211.0, "dueno@example.com"))

    def test_available_bag_keeps_its_verifier(self):
        bag("CASH-BAG-00007", state="Available", verified_by="gerente@example.com", amount=1500.0)
        result = self.transfer(self.payload("CASH-BAG-00007"))
        self.assertEqual((result["state"], result["amount"]), ("Transferred", 1500.0))
        self.assertEqual(LAB["bags"]["CASH-BAG-00007"]["verified_by"], "gerente@example.com")

    def test_preparer_who_is_a_supervisor_may_move_their_own_sealed_bag(self):
        bag("CASH-BAG-00004", prepared_by="dueno@example.com")
        self.assertEqual(self.transfer(self.payload())["state"], "Transferred")
        self.assertIsNone(LAB["bags"]["CASH-BAG-00004"]["verified_by"])

    def test_caller_cannot_choose_amount_or_destination(self):
        bag("CASH-BAG-00004")
        for key, value in [("amount", 1), ("count", {"denominations": []}), ("account", "HOME-SAFE-ACC"),
                           ("target_account", "BANK-ACC"), ("transfer_account", "X"),
                           ("offsite_cash_account", "X")]:
            with self.subTest(key=key):
                self.assert_refused(self.payload(**{key: value}), message=key)

    # Authorization and scope -------------------------------------------------
    def test_cashier_cannot_transfer(self):
        bag("CASH-BAG-00004")
        self.act("othercashier@example.com")
        self.assert_refused(self.payload(), _Permission)

    def test_user_outside_the_register_cannot_transfer(self):
        bag("CASH-BAG-00004")
        self.act("externo@example.com")
        LAB["supervisors"].add("externo@example.com")
        self.assert_refused(self.payload(), _Permission)

    def test_bag_of_another_safe_is_refused(self):
        bag("CASH-BAG-00009", safe="CASH-SAFE-00002")
        self.assert_refused(self.payload("CASH-BAG-00009"), _Permission)

    def test_known_request_id_does_not_grant_access(self):
        bag("CASH-BAG-00004")
        data = self.payload()
        self.transfer(data)
        self.act("externo@example.com")
        with self.assertRaises(_Permission):
            self.transfer(dict(data))

    # State machine -----------------------------------------------------------
    def test_only_available_or_unverified_bags_leave(self):
        for index, state in enumerate(["Disputed", "Issued", "In Transit", "Deposited", "Unpacked", "Transferred"]):
            with self.subTest(state=state):
                name = "CASH-BAG-%05d" % (100 + index)
                bag(name, state=state)
                self.assert_refused(self.payload(name), message="available or awaiting verification")

    def test_reason_is_required(self):
        bag("CASH-BAG-00004")
        self.assert_refused(self.payload(note="moved"), message="8 to 1000")

    def test_safe_ledger_must_cover_the_bag(self):
        bag("CASH-BAG-00004")
        LAB["gl"]["SAFE-ACC"] = 2211.0 - 0.01
        self.assert_refused(self.payload(), message="holds less than this bag")
        LAB["gl"]["SAFE-ACC"] = 2211.0
        self.assertEqual(self.transfer(self.payload())["state"], "Transferred")
        self.assertEqual(LAB["gl"]["SAFE-ACC"], 0.0)

    # Destination -------------------------------------------------------------
    def test_unconfigured_destination_keeps_the_action_unavailable(self):
        bag("CASH-BAG-00004")
        LAB["safes"]["CASH-SAFE-00001"]["offsite_cash_account"] = None
        self.assert_refused(self.payload(), message="Configure an off-site cash account")
        context = SERVICE.context(self.profile)
        self.assertFalse(context["can_transfer"])
        self.assertIsNone(context["offsite_cash_account"])
        self.assertIn("Configure", context["transfer_blocker"])

    def test_destination_is_revalidated_on_every_write(self):
        cases = {
            "BANK-TYPE-ACC": "active Cash ledger", "GROUP-CASH": "active Cash ledger",
            "DISABLED-CASH": "active Cash ledger", "OTHER-CO-CASH": "active Cash ledger",
            "USD-CASH": "active Cash ledger", "MISSING-ACC": "active Cash ledger",
            "SAFE-ACC": "must differ", "DRAWER-ACC": "must differ", "TRANSIT-ACC": "must differ",
            "SAFE-ACC-2": "already belongs", "DRAWER-ACC-2": "already belongs",
            "MP-CARD-ACC": "already belongs", "REGISTER-DRAWER-ACC": "already belongs",
            "ALLOWED-SOURCE-ACC": "already belongs",
        }
        bag("CASH-BAG-00004")
        for account, message in cases.items():
            with self.subTest(account=account):
                LAB["safes"]["CASH-SAFE-00001"]["offsite_cash_account"] = account
                self.assert_refused(self.payload(), message=message)

    def test_destination_change_later_does_not_rewrite_history(self):
        bag("CASH-BAG-00004")
        self.transfer(self.payload())
        LAB["accounts"]["OWNER-SAFE-2"] = _Dict(LAB["accounts"]["HOME-SAFE-ACC"])
        LAB["safes"]["CASH-SAFE-00001"]["offsite_cash_account"] = "OWNER-SAFE-2"
        bag("CASH-BAG-00005")
        self.assertEqual(self.transfer(self.payload("CASH-BAG-00005"))["transfer_account"], "OWNER-SAFE-2")
        self.assertEqual(LAB["bags"]["CASH-BAG-00004"]["transfer_account"], "HOME-SAFE-ACC")

    def test_two_safes_may_share_one_owner_safe(self):
        LAB["safes"]["CASH-SAFE-00002"]["offsite_cash_account"] = "HOME-SAFE-ACC"
        bag("CASH-BAG-00004")
        self.assertEqual(self.transfer(self.payload())["transfer_account"], "HOME-SAFE-ACC")

    # Idempotency and double transfer ----------------------------------------
    def test_replay_returns_the_original_result_and_posts_once(self):
        bag("CASH-BAG-00004")
        data = self.payload()
        first = self.transfer(dict(data))
        self.assertEqual(self.transfer(dict(data)), first)
        self.assertEqual(len(LAB["journals"]), 1)
        self.assertEqual(len(LAB["events"]), 1)

    def test_reused_request_id_with_other_instructions_is_refused(self):
        bag("CASH-BAG-00004")
        bag("CASH-BAG-00005")
        data = self.payload()
        self.transfer(dict(data))
        with self.assertRaisesRegex(_Validation, "already used"):
            self.transfer(dict(data, bag="CASH-BAG-00005"))
        self.assertEqual(LAB["bags"]["CASH-BAG-00005"]["state"], "Unverified")
        self.assertEqual(len(LAB["journals"]), 1)

    def test_second_request_for_the_same_bag_cannot_move_it_twice(self):
        bag("CASH-BAG-00004")
        self.transfer(self.payload())
        self.act("gerente@example.com")
        self.assert_refused(self.payload(), message="available or awaiting verification")
        self.assertEqual(LAB["gl"], {"SAFE-ACC": 2789.0, "HOME-SAFE-ACC": 2211.0})

    def test_transfer_runs_under_the_safe_and_bag_row_locks(self):
        bag("CASH-BAG-00004")
        self.transfer(self.payload())
        self.assertIn(("POS Cash Safe", "CASH-SAFE-00001", True), LAB["locks"])
        self.assertIn(("POS Cash Bag", "CASH-BAG-00004", True), LAB["locks"])
        safe_lock = LAB["locks"].index(("POS Cash Safe", "CASH-SAFE-00001", True))
        self.assertLess(safe_lock, LAB["locks"].index(("POS Cash Bag", "CASH-BAG-00004", True)))

    # Read model --------------------------------------------------------------
    def test_context_exposes_destination_and_availability(self):
        context = SERVICE.context(self.profile)
        self.assertEqual((context["offsite_cash_account"], context["offsite_cash_account_name"]),
                         ("HOME-SAFE-ACC", "Home-Safe-Acc"))
        self.assertTrue(context["can_transfer"])
        self.assertIsNone(context["transfer_blocker"])
        self.act("othercashier@example.com")
        self.assertFalse(SERVICE.context(self.profile)["can_transfer"])

    def test_transferred_bags_are_finished_history(self):
        self.assertIn("Transferred", SERVICE.COMPLETED_BAG_STATES)
        self.assertNotIn("Transferred", SERVICE.TRANSFERABLE_BAG_STATES)
        for field in ["transfer_account", "transferred_by", "transferred_on"]:
            self.assertIn(field, SERVICE.BAG_FIELDS)


class DestinationConfigurationTest(unittest.TestCase):
    """The Desk safe form runs the same guard the write path does."""

    def setUp(self):
        _fresh_lab()
        modules = patch.dict(sys.modules, STUBS)
        modules.start()
        self.addCleanup(modules.stop)

    def problem(self, account):
        safe = _Doc("POS Cash Safe", copy.deepcopy(LAB["safes"]["CASH-SAFE-00001"]))
        return DOCUMENTS.offsite_problem(safe, account, "DRAWER-ACC")

    def test_separate_cash_ledger_is_accepted(self):
        self.assertIsNone(self.problem("HOME-SAFE-ACC"))

    def test_blank_means_unavailable(self):
        self.assertIn("Configure", self.problem(None))

    def test_bank_and_variance_are_never_destinations(self):
        self.assertIn("active Cash ledger", self.problem("BANK-ACC"))
        self.assertIn("active Cash ledger", self.problem("VAR-ACC"))


if __name__ == "__main__":
    unittest.main()
