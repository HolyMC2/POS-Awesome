"""Cash custody read model: no unfinished bag or count may fall out of the window.

Runs without a site. The framework and the service's sibling modules are stubbed
only while `service.py` is loaded, then restored, so native Frappe discovery keeps
the real modules. The stub query engine honours filters, ordering and page length,
so what is asserted is the service's own partitioning, not a convenient fake.
"""
import importlib.util
import pathlib
import sys
import types
import unittest

DIR = pathlib.Path(__file__).parent
PKG = "_custody_service_under_test"


class _Permission(Exception):
    pass


class _Validation(Exception):
    pass


# Mutable lab state. The service binds the stub callables at import time, so the
# tests steer behaviour through this dict rather than by rebinding functions.
LAB = {
    "user": "ana@example.com",
    "supervisors": set(),
    "profiles": {"ana@example.com": {"Custody QA"}, "beto@example.com": {"Custody QA"}},
    "safes": {},
    "rows": {"POS Cash Bag": [], "POS Cash Count": []},
    "calls": [],
    "balances": {},
    "reserved": 0.0,
}


def _throw(message, exc=_Validation, **kwargs):
    raise exc(message)


def _assert_profile(user, profile):
    if profile not in LAB["profiles"].get(user, set()):
        _throw("Register out of scope", _Permission)


def _assert_company(user, company):
    return True


def _is_closing_supervisor(user):
    return user in LAB["supervisors"]


def _get_safe_gl_balance(account, company):
    return LAB["balances"].get(account, 0.0)


# Query engine -------------------------------------------------------------
_OPERATORS = {
    "=": lambda value, operand: value == operand,
    "!=": lambda value, operand: value != operand,
    "in": lambda value, operand: value in operand,
    "not in": lambda value, operand: value not in operand,
    "<": lambda value, operand: str(value) < str(operand),
    "<=": lambda value, operand: str(value) <= str(operand),
    ">": lambda value, operand: str(value) > str(operand),
    ">=": lambda value, operand: str(value) >= str(operand),
}


def _matches(row, filters):
    for field, condition in (filters or {}).items():
        value = row.get(field)
        if isinstance(condition, (list, tuple)) and len(condition) == 2 and condition[0] in _OPERATORS:
            if not _OPERATORS[condition[0]](value, condition[1]):
                return False
        elif value != condition:
            return False
    return True


def _sorted(rows, order_by):
    """Stable multi-key ordering, least significant term applied first."""
    for term in reversed([part.strip() for part in (order_by or "").split(",") if part.strip()]):
        field, _, direction = term.partition(" ")
        rows.sort(key=lambda row, name=field: str(row.get(name) or ""),
                  reverse=direction.strip().lower() == "desc")
    return rows


def _get_all(doctype, filters=None, fields=None, order_by=None, limit_page_length=None, **kwargs):
    LAB["calls"].append({"doctype": doctype, "filters": dict(filters or {}), "limit": limit_page_length,
                         "order_by": order_by})
    rows = _sorted([row for row in LAB["rows"].get(doctype, []) if _matches(row, filters)], order_by)
    # frappe.get_all applies no LIMIT unless limit_page_length is truthy.
    if limit_page_length:
        rows = rows[:limit_page_length]
    return [{field: row.get(field) for field in (fields or row)} for row in rows]


class _Safe:
    def __init__(self, **values):
        self.__dict__.update(values)
        self.flags = types.SimpleNamespace(custody_locked=False)

    def get(self, key, default=None):
        return getattr(self, key, default)


def _install_framework_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.PermissionError = _Permission
    frappe_module.ValidationError = _Validation
    frappe_module.throw = _throw
    frappe_module._ = lambda message, *args, **kwargs: message
    frappe_module.session = types.SimpleNamespace(user=LAB["user"])
    frappe_module.local = types.SimpleNamespace(site="lab")
    frappe_module.get_all = _get_all
    frappe_module.get_doc = lambda doctype, name=None, **kwargs: LAB["safes"][name]
    frappe_module.db = types.SimpleNamespace(
        table_exists=lambda doctype: True,
        exists=lambda doctype, filters=None: bool(
            [safe for safe in LAB["safes"].values() if safe.pos_profile == (filters or {}).get("pos_profile") and safe.enabled]
        ),
        get_value=lambda doctype, filters=None, fieldname=None, **kwargs: next(
            (safe.name for safe in LAB["safes"].values()
             if doctype == "POS Cash Safe" and safe.pos_profile == (filters or {}).get("pos_profile") and safe.enabled),
            None),
        sql=lambda query, values=None, **kwargs: [[LAB["reserved"]]],
    )
    modules = {"frappe": frappe_module}

    utils = types.ModuleType("frappe.utils")
    utils.nowdate = lambda: "2026-09-15"
    modules["frappe.utils"] = utils

    def module(path, **attributes):
        stub = types.ModuleType(path)
        for key, value in attributes.items():
            setattr(stub, key, value)
        modules[path] = stub

    module("posawesome.posawesome.api._scope", assert_profile=_assert_profile, assert_company=_assert_company)
    module("posawesome.posawesome.api.cash_movement.posting", create_journal_entry=lambda **kwargs: "ACC-JV-STUB")
    module("posawesome.posawesome.api.cash_movement.service", _create_cash_movement=lambda *args: {"name": "CM-STUB"})
    module("posawesome.posawesome.api.shift_terminal", assert_terminal_access=lambda *args: True)
    module("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices",
           is_closing_supervisor=_is_closing_supervisor)
    module("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer",
           get_safe_gl_balance=_get_safe_gl_balance)
    return modules


def _load_service():
    stubs = _install_framework_stubs()
    package = types.ModuleType(PKG)
    package.__path__ = [str(DIR)]
    stubs[PKG] = package
    previous = {key: sys.modules.get(key) for key in stubs}
    sys.modules.update(stubs)
    try:
        spec = importlib.util.spec_from_file_location(PKG + ".service", DIR / "service.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module, stubs["frappe"]
    finally:
        # Native Frappe test discovery must keep the real framework and app modules.
        for key in list(sys.modules):
            if key == PKG or key.startswith(PKG + "."):
                sys.modules.pop(key, None)
        for key, original in previous.items():
            if original is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = original


service, FRAPPE = _load_service()


# Fixtures -----------------------------------------------------------------
def moment(day, hour=8, minute=0):
    return f"2026-09-{day:02d} {hour:02d}:{minute:02d}:00.000000"


def bag(name, state, modified, safe="CASH-SAFE-QA", prepared_by="beto@example.com", **overrides):
    row = dict(name=name, seal=name.replace("CASH-BAG", "QA-SEAL"), purpose="Float", state=state,
               amount=1000, prepared_by=prepared_by, verified_by=None, received_by=None,
               opening_shift="OS-1", receiving_shift=None, deposit_reference=None,
               modified=modified, safe=safe)
    row.update(overrides)
    return row


def cash_count(name, state, modified, counted_by="ana@example.com", safe="CASH-SAFE-QA", **overrides):
    row = dict(name=name, scope="Drawer", state=state, opening_shift="OS-1", bag=None, amount=1000,
               expected_amount=1000, difference=0, counted_by=counted_by, note="", modified=modified,
               count_json="{}", closing_shift=None, safe=safe)
    row.update(overrides)
    return row


class CustodyReadModelTest(unittest.TestCase):
    profile = "Custody QA"

    def setUp(self):
        LAB["user"] = "ana@example.com"
        LAB["supervisors"] = set()
        LAB["profiles"] = {"ana@example.com": {"Custody QA"}, "beto@example.com": {"Custody QA"},
                           "carla@example.com": {"Custody QA"}}
        LAB["rows"] = {"POS Cash Bag": [], "POS Cash Count": []}
        LAB["calls"] = []
        LAB["balances"] = {"SAFE-ACC": 5000.0, "TRANSIT-ACC": 0.0}
        LAB["reserved"] = 1000.0
        LAB["safes"] = {"CASH-SAFE-QA": _Safe(name="CASH-SAFE-QA", company="Grupo Doco", pos_profile="Custody QA",
                                              currency="MXN", enabled=1, safe_account="SAFE-ACC",
                                              transit_account="TRANSIT-ACC", bank_account="BANK-ACC",
                                              variance_account="VAR-ACC", float_target=1000, drawer_limit=5000),
                        "CASH-SAFE-OTHER": _Safe(name="CASH-SAFE-OTHER", company="Grupo Doco",
                                                 pos_profile="Doco Ventas", currency="MXN", enabled=1,
                                                 safe_account="SAFE-ACC-2", transit_account="TRANSIT-ACC-2",
                                                 bank_account="BANK-ACC-2", variance_account="VAR-ACC-2",
                                                 float_target=0, drawer_limit=0)}
        FRAPPE.session.user = LAB["user"]

    def act(self, user, supervisor=False):
        LAB["user"] = user
        FRAPPE.session.user = user
        if supervisor:
            LAB["supervisors"].add(user)
        else:
            LAB["supervisors"].discard(user)

    def context(self, **kwargs):
        return service.context(self.profile, **kwargs)

    def queries(self, doctype, unresolved=True):
        """The recorded read for one half of one queue."""
        wanted = "not in" if unresolved else "in"
        return [call for call in LAB["calls"]
                if call["doctype"] == doctype and call["filters"].get("state", [None])[0] == wanted]

    def busy_history(self, rows=300):
        """Newer completed evidence, far more than one history page."""
        LAB["rows"]["POS Cash Bag"] += [
            bag(f"CASH-BAG-{index:05d}", "Deposited", moment(14, 8, index % 60)) for index in range(rows)]
        LAB["rows"]["POS Cash Count"] += [
            cash_count(f"CASH-COUNT-{index:05d}", "Final", moment(14, 8, index % 60)) for index in range(rows)]

    # Unresolved work survives a busy register --------------------------------
    def test_older_unresolved_bags_survive_newer_completed_history(self):
        self.act("carla@example.com", supervisor=True)
        self.busy_history()
        LAB["rows"]["POS Cash Bag"] += [
            bag("CASH-BAG-OLD-DISPUTED", "Disputed", moment(1)),
            bag("CASH-BAG-OLD-TRANSIT", "In Transit", moment(2)),
            bag("CASH-BAG-OLD-UNVERIFIED", "Unverified", moment(3)),
            bag("CASH-BAG-OLD-AVAILABLE", "Available", moment(4)),
        ]
        result = self.context()
        names = {row["name"] for row in result["bags"]}
        self.assertLessEqual({"CASH-BAG-OLD-DISPUTED", "CASH-BAG-OLD-TRANSIT",
                              "CASH-BAG-OLD-UNVERIFIED", "CASH-BAG-OLD-AVAILABLE"}, names)
        meta = result["queues"]["bags"]
        self.assertEqual(meta["unresolved"], 4)
        self.assertEqual(meta["history"], service.HISTORY_PAGE_LENGTH)
        self.assertTrue(meta["history_has_more"])
        self.assertEqual(len(result["bags"]), 4 + service.HISTORY_PAGE_LENGTH)

    def test_older_draft_and_exception_counts_survive_newer_completed_history(self):
        self.act("carla@example.com", supervisor=True)
        self.busy_history()
        LAB["rows"]["POS Cash Count"] += [
            cash_count("CASH-COUNT-OLD-DRAFT", "Draft", moment(1), counted_by="carla@example.com"),
            cash_count("CASH-COUNT-OLD-EXCEPTION", "Exception", moment(2), counted_by="ana@example.com",
                       amount=990, expected_amount=1000, difference=-10),
        ]
        result = self.context()
        names = {row["name"] for row in result["counts"]}
        self.assertIn("CASH-COUNT-OLD-DRAFT", names)
        self.assertIn("CASH-COUNT-OLD-EXCEPTION", names)
        self.assertEqual(result["queues"]["counts"]["unresolved"], 2)
        self.assertTrue(result["queues"]["counts"]["history_has_more"])

    def test_the_old_flat_window_would_have_hidden_them(self):
        """Guards the regression itself: 300 newer completed rows bury the old work."""
        self.act("carla@example.com", supervisor=True)
        self.busy_history()
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-OLD-DISPUTED", "Disputed", moment(1)))
        flat = _get_all("POS Cash Bag", filters={"safe": "CASH-SAFE-QA"}, fields=["name"],
                        order_by="modified desc", limit_page_length=200)
        self.assertNotIn("CASH-BAG-OLD-DISPUTED", {row["name"] for row in flat})
        self.assertIn("CASH-BAG-OLD-DISPUTED", {row["name"] for row in self.context()["bags"]})

    def test_unresolved_rows_are_read_without_any_page_length(self):
        self.act("carla@example.com", supervisor=True)
        self.busy_history()
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-OPEN", "Disputed", moment(1)))
        self.context()
        for doctype in ["POS Cash Bag", "POS Cash Count"]:
            query = self.queries(doctype)[0]
            # frappe.get_all with no limit_page_length reads every matching row.
            self.assertIsNone(query["limit"])
            self.assertEqual(query["order_by"], service._ORDER)

    def test_more_than_five_hundred_unresolved_rows_are_all_returned(self):
        self.act("carla@example.com", supervisor=True)
        self.busy_history()
        states = ["Unverified", "Available", "Disputed", "In Transit"]
        LAB["rows"]["POS Cash Bag"] += [
            bag(f"CASH-BAG-OPEN-{index:05d}", states[index % 4], moment(1 + index % 9, 8, index % 60))
            for index in range(750)]
        LAB["rows"]["POS Cash Count"] += [
            cash_count(f"CASH-COUNT-OPEN-{index:05d}", "Draft" if index % 2 else "Exception",
                       moment(1 + index % 9, 8, index % 60), counted_by="carla@example.com")
            for index in range(750)]
        result = self.context()
        bags = {row["name"] for row in result["bags"]}
        counts = {row["name"] for row in result["counts"]}
        self.assertEqual(result["queues"]["bags"]["unresolved"], 750)
        self.assertEqual(result["queues"]["counts"]["unresolved"], 750)
        for index in range(750):
            self.assertIn(f"CASH-BAG-OPEN-{index:05d}", bags)
            self.assertIn(f"CASH-COUNT-OPEN-{index:05d}", counts)
        self.assertEqual(len(result["bags"]), 750 + service.HISTORY_PAGE_LENGTH)
        self.assertEqual(len(result["counts"]), 750 + service.HISTORY_PAGE_LENGTH)
        # No cap is reported because none is applied.
        self.assertNotIn("unresolved_has_more", result["queues"]["bags"])

    def test_unknown_state_stays_unresolved(self):
        self.act("carla@example.com", supervisor=True)
        self.busy_history()
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-FUTURE", "Quarantined", moment(1)))
        LAB["rows"]["POS Cash Count"].append(cash_count("CASH-COUNT-FUTURE", "Escalated", moment(1)))
        result = self.context()
        self.assertIn("CASH-BAG-FUTURE", {row["name"] for row in result["bags"]})
        self.assertIn("CASH-COUNT-FUTURE", {row["name"] for row in result["counts"]})

    def test_completed_states_are_the_documented_terminal_ones(self):
        self.assertEqual(service.COMPLETED_BAG_STATES, ["Issued", "Deposited", "Unpacked"])
        self.assertEqual(service.COMPLETED_COUNT_STATES, ["Final", "Reviewed"])
        self.act("carla@example.com", supervisor=True)
        for index, state in enumerate(["Issued", "Deposited", "Unpacked"]):
            LAB["rows"]["POS Cash Bag"].append(bag(f"CASH-BAG-DONE-{index}", state, moment(5)))
        for index, state in enumerate(["Final", "Reviewed"]):
            LAB["rows"]["POS Cash Count"].append(cash_count(f"CASH-COUNT-DONE-{index}", state, moment(5)))
        result = self.context()
        self.assertEqual(result["queues"]["bags"]["unresolved"], 0)
        self.assertEqual(result["queues"]["bags"]["history"], 3)
        self.assertEqual(result["queues"]["counts"]["unresolved"], 0)
        self.assertEqual(result["queues"]["counts"]["history"], 2)
        self.assertEqual(result["queues"]["bags"]["completed_states"], service.COMPLETED_BAG_STATES)

    # Ordering and payload compatibility --------------------------------------
    def test_rows_keep_the_existing_fields_and_modified_desc_order(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [bag("CASH-BAG-A", "Deposited", moment(12)),
                                        bag("CASH-BAG-B", "Disputed", moment(9)),
                                        bag("CASH-BAG-C", "Available", moment(13))]
        LAB["rows"]["POS Cash Count"] += [cash_count("CASH-COUNT-A", "Final", moment(12)),
                                          cash_count("CASH-COUNT-B", "Exception", moment(9)),
                                          cash_count("CASH-COUNT-C", "Draft", moment(13))]
        result = self.context()
        self.assertEqual([row["name"] for row in result["bags"]], ["CASH-BAG-C", "CASH-BAG-A", "CASH-BAG-B"])
        self.assertEqual([row["name"] for row in result["counts"]],
                         ["CASH-COUNT-C", "CASH-COUNT-A", "CASH-COUNT-B"])
        self.assertEqual(set(result["bags"][0]), set(service.BAG_FIELDS))
        self.assertEqual(set(result["counts"][0]), set(service.COUNT_FIELDS))
        for key in ["safe", "currency", "float_target", "drawer_limit", "can_manage", "balance",
                    "loose_balance", "in_transit", "bags", "counts"]:
            self.assertIn(key, result)

    def test_bag_rows_carry_the_handover_trail(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [
            bag("CASH-BAG-ISSUED", "Issued", moment(12), received_by="ana@example.com",
                receiving_shift="OS-2"),
            bag("CASH-BAG-DEPOSITED", "Deposited", moment(11), deposit_reference="LAB-BANK-99"),
        ]
        rows = {row["name"]: row for row in self.context()["bags"]}
        for field in ["received_by", "receiving_shift", "deposit_reference"]:
            self.assertIn(field, service.BAG_FIELDS)
            self.assertIn(field, rows["CASH-BAG-ISSUED"])
        self.assertEqual(rows["CASH-BAG-ISSUED"]["received_by"], "ana@example.com")
        self.assertEqual(rows["CASH-BAG-ISSUED"]["receiving_shift"], "OS-2")
        self.assertEqual(rows["CASH-BAG-DEPOSITED"]["deposit_reference"], "LAB-BANK-99")

    def test_tied_timestamps_order_and_page_deterministically(self):
        """Every completed row shares one modified value; the page must not flap."""
        self.act("carla@example.com", supervisor=True)
        tie = moment(14)
        LAB["rows"]["POS Cash Bag"] += [bag(f"CASH-BAG-{index:05d}", "Deposited", tie) for index in range(40)]
        LAB["rows"]["POS Cash Count"] += [cash_count(f"CASH-COUNT-{index:05d}", "Final", tie)
                                          for index in range(40)]
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-OPEN", "Disputed", tie))
        first = self.context(history_limit=10)
        second = self.context(history_limit=10)
        self.assertEqual([row["name"] for row in first["bags"]], [row["name"] for row in second["bags"]])
        self.assertEqual([row["name"] for row in first["counts"]], [row["name"] for row in second["counts"]])
        history = [row["name"] for row in first["bags"] if row["state"] == "Deposited"]
        self.assertEqual(history, sorted(history, reverse=True))
        self.assertEqual(len(history), 10)
        # The unresolved row shares the tie and is still returned, ordered by name.
        self.assertIn("CASH-BAG-OPEN", {row["name"] for row in first["bags"]})
        self.assertEqual(first["queues"]["bags"]["unresolved"], 1)

    # Cashier scoping ---------------------------------------------------------
    def test_cashier_sees_only_their_own_counts_but_the_registers_bags(self):
        self.act("ana@example.com")
        LAB["rows"]["POS Cash Count"] += [
            cash_count("CASH-COUNT-MINE-DRAFT", "Draft", moment(3), counted_by="ana@example.com"),
            cash_count("CASH-COUNT-MINE-FINAL", "Final", moment(12), counted_by="ana@example.com"),
            cash_count("CASH-COUNT-THEIRS-DRAFT", "Draft", moment(4), counted_by="beto@example.com"),
            cash_count("CASH-COUNT-THEIRS-FINAL", "Final", moment(13), counted_by="beto@example.com"),
        ]
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-THEIRS", "Unverified", moment(4),
                                               prepared_by="beto@example.com"))
        result = self.context()
        self.assertEqual({row["name"] for row in result["counts"]},
                         {"CASH-COUNT-MINE-DRAFT", "CASH-COUNT-MINE-FINAL"})
        self.assertFalse(result["can_manage"])
        self.assertIn("CASH-BAG-THEIRS", {row["name"] for row in result["bags"]})
        for call in LAB["calls"]:
            if call["doctype"] == "POS Cash Count":
                self.assertEqual(call["filters"]["counted_by"], "ana@example.com")
        self.assertEqual(result["queues"]["counts"]["desk"]["filters"]["counted_by"], "ana@example.com")

    def test_supervisor_sees_every_count_for_the_register(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Count"] += [
            cash_count("CASH-COUNT-MINE", "Draft", moment(3), counted_by="carla@example.com"),
            cash_count("CASH-COUNT-THEIRS", "Exception", moment(4), counted_by="ana@example.com"),
        ]
        result = self.context()
        self.assertEqual({row["name"] for row in result["counts"]}, {"CASH-COUNT-MINE", "CASH-COUNT-THEIRS"})
        self.assertTrue(result["can_manage"])
        for call in LAB["calls"]:
            if call["doctype"] == "POS Cash Count":
                self.assertNotIn("counted_by", call["filters"])
        self.assertNotIn("counted_by", result["queues"]["counts"]["desk"]["filters"])

    # Profile and safe isolation ---------------------------------------------
    def test_another_register_is_refused(self):
        self.act("ana@example.com", supervisor=True)
        with self.assertRaises(_Permission):
            service.context("Doco Ventas")

    def test_another_safes_records_never_appear(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [bag("CASH-BAG-OTHER-ACTIVE", "Disputed", moment(1), safe="CASH-SAFE-OTHER"),
                                        bag("CASH-BAG-OTHER-DONE", "Deposited", moment(14), safe="CASH-SAFE-OTHER"),
                                        bag("CASH-BAG-MINE", "Disputed", moment(2))]
        LAB["rows"]["POS Cash Count"] += [
            cash_count("CASH-COUNT-OTHER", "Exception", moment(1), safe="CASH-SAFE-OTHER"),
            cash_count("CASH-COUNT-MINE", "Exception", moment(2))]
        result = self.context()
        self.assertEqual({row["name"] for row in result["bags"]}, {"CASH-BAG-MINE"})
        self.assertEqual({row["name"] for row in result["counts"]}, {"CASH-COUNT-MINE"})
        for call in LAB["calls"]:
            self.assertEqual(call["filters"]["safe"], "CASH-SAFE-QA")
        self.assertEqual(result["queues"]["bags"]["desk"],
                         {"doctype": "POS Cash Bag", "filters": {"safe": "CASH-SAFE-QA"}})

    # Bounded completed history ----------------------------------------------
    def test_history_metadata_describes_its_own_boundary(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [bag(f"CASH-BAG-{index:05d}", "Deposited", moment(10 + index // 10, 8, index % 60))
                                        for index in range(30)]
        meta = self.context(history_limit=10)["queues"]["bags"]
        self.assertEqual(meta["history"], 10)
        self.assertEqual(meta["history_limit"], 10)
        self.assertTrue(meta["history_has_more"])
        # Newest ten are day 12, minutes 29 down to 20.
        self.assertEqual(meta["history_oldest"], moment(12, 8, 20))
        self.assertEqual(meta["desk"], {"doctype": "POS Cash Bag", "filters": {"safe": "CASH-SAFE-QA"}})

    def test_complete_history_reports_no_more(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [bag(f"CASH-BAG-{index:05d}", "Deposited", moment(10, 8, index))
                                        for index in range(4)]
        meta = self.context(history_limit=10)["queues"]["bags"]
        self.assertFalse(meta["history_has_more"])
        self.assertEqual(meta["history"], 4)
        self.assertEqual(meta["history_oldest"], moment(10, 8, 0))

    def test_empty_history_has_no_boundary(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-OPEN", "Disputed", moment(1)))
        meta = self.context()["queues"]["bags"]
        self.assertEqual(meta["history"], 0)
        self.assertFalse(meta["history_has_more"])
        self.assertIsNone(meta["history_oldest"])

    def test_history_limit_is_clamped_and_validated(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [bag(f"CASH-BAG-{index:05d}", "Deposited", moment(10, 8, index % 60))
                                        for index in range(5)]
        self.assertEqual(self.context()["queues"]["bags"]["history_limit"], service.HISTORY_PAGE_LENGTH)
        self.assertEqual(self.context(history_limit="3")["queues"]["bags"]["history"], 3)
        self.assertEqual(self.context(history_limit=9999)["queues"]["bags"]["history_limit"],
                         service.MAX_HISTORY_PAGE_LENGTH)
        self.assertEqual(self.context(history_limit=-5)["queues"]["bags"]["history_limit"], 0)
        with self.assertRaises(_Validation):
            self.context(history_limit="soon")

    def test_zero_history_still_returns_every_unresolved_record(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"] += [bag("CASH-BAG-DONE", "Deposited", moment(14)),
                                        bag("CASH-BAG-OPEN", "Disputed", moment(1))]
        result = self.context(history_limit=0)
        meta = result["queues"]["bags"]
        self.assertEqual([row["name"] for row in result["bags"]], ["CASH-BAG-OPEN"])
        self.assertEqual(meta["history"], 0)
        self.assertTrue(meta["history_has_more"])
        self.assertIsNone(meta["history_oldest"])

    def test_zero_history_reports_no_more_when_nothing_is_completed(self):
        self.act("carla@example.com", supervisor=True)
        LAB["rows"]["POS Cash Bag"].append(bag("CASH-BAG-OPEN", "Disputed", moment(1)))
        self.assertFalse(self.context(history_limit=0)["queues"]["bags"]["history_has_more"])


if __name__ == "__main__":
    unittest.main()
