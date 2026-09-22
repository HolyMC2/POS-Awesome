"""Drawer-limit guidance: what it refuses to say, and to whom.

Runs without a site. It reuses the stub framework `test_context` already
installs around `service.py`, so the module under test is the real one and only
its two seams are replaced per test: `_expected_drawer_cash` (the canonical
closing computation, which needs invoices and a site) and `_now`.

The rules pinned here are privacy and scope rules, not arithmetic:
a hidden figure must be hidden in the PAYLOAD, not merely unrendered; a drawer
exactly at its limit is within it; and guidance never answers for a shift the
caller does not own.
"""
import pathlib
import unittest

try:
    # Native Frappe discovery imports this as part of the app package.
    from . import test_context as harness
except ImportError:  # `python -m unittest test_drawer_guidance` from this folder
    import test_context as harness

service = harness.service
FRAPPE = harness.FRAPPE
LAB = harness.LAB

SHIFT = "POS-OPEN-0009"
CASHIER = "ana@example.com"
OTHER = "beto@example.com"
SUPERVISOR = "carla@example.com"


class _Row(dict):
    """frappe._dict as the service reads it: attribute access over a row."""

    def __getattr__(self, key):
        return self.get(key)


class _Opening:
    def __init__(self, name):
        self.name = name

    def as_dict(self):
        return {"name": self.name}


class DrawerGuidanceTest(unittest.TestCase):
    profile = "Custody QA"

    def setUp(self):
        LAB["user"] = CASHIER
        LAB["supervisors"] = set()
        LAB["profiles"] = {CASHIER: {self.profile}, OTHER: {self.profile}, SUPERVISOR: {self.profile}}
        LAB["safes"] = {"CASH-SAFE-QA": harness._Safe(
            name="CASH-SAFE-QA", title="Caja Doco", company="Grupo Doco", pos_profile=self.profile,
            currency="MXN", enabled=1, safe_account="SAFE-ACC", transit_account="TRANSIT-ACC",
            bank_account="BANK-ACC", variance_account="VAR-ACC", float_target=1000, drawer_limit=5000)}
        FRAPPE.session.user = CASHIER

        self.shift = _Row(name=SHIFT, user=CASHIER, pos_profile=self.profile, status="Open", docstatus=1)
        self.profile_values = {"hide_expected_amount": 0}
        self.expected = 5200.0

        self._get_value = FRAPPE.db.get_value
        self._get_doc = FRAPPE.get_doc
        self._expected_reader = service._expected_drawer_cash
        self._now = service._now
        FRAPPE.db.get_value = self.get_value
        FRAPPE.get_doc = self.get_doc
        service._expected_drawer_cash = lambda safe, opening_shift: self.expected
        service._now = lambda: "2026-09-15 14:35:00"

    def tearDown(self):
        FRAPPE.db.get_value = self._get_value
        FRAPPE.get_doc = self._get_doc
        service._expected_drawer_cash = self._expected_reader
        service._now = self._now

    # Seams -------------------------------------------------------------------
    def get_value(self, doctype, filters=None, fieldname=None, **kwargs):
        if doctype == "POS Opening Shift":
            return self.shift if self.shift and self.shift["name"] == filters else None
        if doctype == "POS Profile":
            return self.profile_values.get(fieldname)
        return self._get_value(doctype, filters, fieldname, **kwargs)

    def get_doc(self, doctype, name=None, **kwargs):
        if doctype == "POS Opening Shift":
            return _Opening(name)
        return self._get_doc(doctype, name, **kwargs)

    def act(self, user, supervisor=False):
        LAB["user"] = user
        FRAPPE.session.user = user
        LAB["supervisors"] = {user} if supervisor else set()

    def guidance(self, **kwargs):
        return service.drawer_guidance(kwargs.pop("pos_profile", self.profile),
                                       kwargs.pop("opening_shift", SHIFT))

    def assert_hidden(self, result, reason):
        """Hidden means hidden: no amount may ride along in the payload."""
        self.assertEqual(result, {"show": False, "reason": reason})

    # What it says ------------------------------------------------------------
    def test_over_limit_suggests_returning_down_to_the_float(self):
        result = self.guidance()
        self.assertTrue(result["over_limit"])
        self.assertEqual(result["expected_amount"], 5200.0)
        self.assertEqual(result["drawer_limit"], 5000.0)
        # Keep the configured working float, return the rest.
        self.assertEqual(result["keep_amount"], 1000.0)
        self.assertEqual(result["suggested_return"], 4200.0)
        self.assertEqual(result["currency"], "MXN")
        self.assertEqual(result["safe_title"], "Caja Doco")
        self.assertEqual(result["as_of"], "2026-09-15 14:35:00")

    def test_without_a_float_target_it_suggests_returning_down_to_the_limit(self):
        LAB["safes"]["CASH-SAFE-QA"].float_target = 0
        result = self.guidance()
        self.assertEqual(result["keep_amount"], 5000.0)
        self.assertEqual(result["suggested_return"], 200.0)

    # Boundary ----------------------------------------------------------------
    def test_exactly_at_the_limit_is_within_it(self):
        self.expected = 5000.0
        result = self.guidance()
        self.assertTrue(result["show"])
        self.assertFalse(result["over_limit"])
        self.assertEqual(result["suggested_return"], 0)

    def test_one_cent_over_the_limit_asks(self):
        self.expected = 5000.01
        self.assertTrue(self.guidance()["over_limit"])

    def test_a_drawer_below_zero_never_asks_for_a_return(self):
        # More dropped than taken in is a real, legitimate shift. Cent
        # arithmetic must not raise on it the way the count parser would.
        self.expected = -40.0
        result = self.guidance()
        self.assertFalse(result["over_limit"])
        self.assertEqual(result["suggested_return"], 0)

    # Hidden ------------------------------------------------------------------
    def test_blind_count_profile_gets_no_amounts_at_all(self):
        self.profile_values["hide_expected_amount"] = 1
        self.assert_hidden(self.guidance(), "expected_cash_hidden")

    def test_no_configured_limit_is_no_guidance(self):
        LAB["safes"]["CASH-SAFE-QA"].drawer_limit = 0
        self.assert_hidden(self.guidance(), "no_limit")

    def test_register_without_custody_is_no_guidance(self):
        LAB["safes"]["CASH-SAFE-QA"].enabled = 0
        self.assert_hidden(self.guidance(), "not_configured")

    def test_no_shift_and_a_closed_or_draft_shift_are_no_guidance(self):
        self.assert_hidden(self.guidance(opening_shift=None), "no_open_shift")
        self.shift = None
        self.assert_hidden(self.guidance(), "no_open_shift")
        self.shift = _Row(name=SHIFT, user=CASHIER, pos_profile=self.profile, status="Closed", docstatus=1)
        self.assert_hidden(self.guidance(), "no_open_shift")
        self.shift = _Row(name=SHIFT, user=CASHIER, pos_profile=self.profile, status="Open", docstatus=0)
        self.assert_hidden(self.guidance(), "no_open_shift")

    def test_a_register_with_no_cash_method_is_no_guidance(self):
        service._expected_drawer_cash = lambda safe, opening_shift: None
        self.assert_hidden(self.guidance(), "no_cash_method")

    # Scope -------------------------------------------------------------------
    def test_another_persons_drawer_is_refused_not_answered(self):
        self.act(OTHER)
        with self.assertRaises(harness._Permission):
            self.guidance()

    def test_a_supervisor_may_read_the_registers_open_drawer(self):
        self.act(SUPERVISOR, supervisor=True)
        self.assertTrue(self.guidance()["show"])

    def test_a_shift_from_another_register_is_refused(self):
        self.shift = _Row(name=SHIFT, user=CASHIER, pos_profile="Doco Ventas", status="Open", docstatus=1)
        with self.assertRaises(harness._Permission):
            self.guidance()

    def test_a_register_out_of_scope_is_refused_before_anything_is_read(self):
        with self.assertRaises(harness._Permission):
            self.guidance(pos_profile="Someone Else")

    # Source contract ---------------------------------------------------------
    def test_expected_cash_comes_from_the_closing_computation(self):
        """The one figure this surface shows must be the corte's own.

        A profile-agnostic safe/GL balance answers a different question, and the
        two disagreeing on the same screen is exactly the defect to avoid.
        """
        source = pathlib.Path(service.__file__).read_text()
        body = source.split("def _expected_drawer_cash")[1].split("\ndef ")[0]
        self.assertIn("compute_closing_tables", body)
        self.assertIn("payment_reconciliation", body)
        self.assertIn("posa_cash_mode_of_payment", body)
        self.assertNotIn("get_safe_gl_balance", body)
