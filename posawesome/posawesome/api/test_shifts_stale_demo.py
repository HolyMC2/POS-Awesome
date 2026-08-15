"""Demo-tenant bypass of the stale-shift gate (site_config ``muelle_demo``).

A demo site's golden snapshot can carry an old open shift; without the bypass
every visitor deadlocks (sale blocked by the stale shift, close blocked by
their own unsynced offline sale, sync blocked by the stale shift). These tests
force the profile's ``posa_force_close_stale_shift`` gate ON and prove the
site_config flag alone unblocks selling.
"""

from __future__ import annotations

import unittest

# Bench-only integration test: needs a real frappe + site. Skip the module
# when discovered by the standalone stub-suite runner (python3 -m unittest
# discover), where frappe is not importable.
try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime, today

from posawesome.posawesome.api import _reprice, shifts
from posawesome.posawesome.api.test_document_flows import PROFILE


class _DemoConfPatch:
    """Temporarily mark the site as a Muelle demo (frappe.conf is site_config)."""

    def __init__(self, value):
        self.value = value

    def __enter__(self):
        self.had = "muelle_demo" in frappe.local.conf
        self.before = frappe.local.conf.get("muelle_demo")
        frappe.local.conf["muelle_demo"] = self.value
        return self

    def __exit__(self, *exc):
        if self.had:
            frappe.local.conf["muelle_demo"] = self.before
        else:
            frappe.local.conf.pop("muelle_demo", None)
        return False


class TestStaleShiftDemoBypass(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("POS Profile", PROFILE):
            self.skipTest("no Doco Ventas profile")
        self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
        self._flag_before = frappe.db.get_value(
            "POS Profile", PROFILE, "posa_force_close_stale_shift"
        )
        frappe.db.set_value("POS Profile", PROFILE, "posa_force_close_stale_shift", 1)
        self._shifts = []

    def tearDown(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_force_close_stale_shift", self._flag_before or 0
        )
        for name in self._shifts:
            frappe.db.set_value("POS Opening Shift", name, "docstatus", 2, update_modified=False)
            frappe.delete_doc("POS Opening Shift", name, force=True, ignore_permissions=True)

    def _make_shift(self, days_old: int = 3, status: str = "Open") -> str:
        mode = frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name") or "Cash"
        shift = frappe.get_doc(
            {
                "doctype": "POS Opening Shift",
                "period_start_date": add_days(now_datetime(), -days_old),
                "posting_date": add_days(today(), -days_old),
                "user": frappe.session.user,
                "pos_profile": PROFILE,
                "company": self.company,
                "docstatus": 1,
                "balance_details": [{"mode_of_payment": mode, "amount": 0}],
            }
        )
        shift.insert(ignore_permissions=True)
        self._shifts.append(shift.name)
        if shift.status != status:
            frappe.db.set_value("POS Opening Shift", shift.name, "status", status)
        return shift.name

    def test_is_demo_pos_site_reads_site_config(self):
        with _DemoConfPatch(None):
            frappe.local.conf.pop("muelle_demo", None)
            self.assertFalse(shifts.is_demo_pos_site())
        with _DemoConfPatch(1):
            self.assertTrue(shifts.is_demo_pos_site())
        with _DemoConfPatch("1"):
            self.assertTrue(shifts.is_demo_pos_site())
        with _DemoConfPatch(0):
            self.assertFalse(shifts.is_demo_pos_site())

    def test_stale_shift_blocks_normal_site(self):
        name = self._make_shift()
        with _DemoConfPatch(0):
            self.assertRaises(
                frappe.ValidationError, shifts.assert_shift_not_stale, name
            )

    def test_stale_shift_allowed_on_demo_site(self):
        name = self._make_shift()
        with _DemoConfPatch(1):
            shifts.assert_shift_not_stale(name)  # must not throw

    def test_closed_shift_reject_also_skipped_on_demo(self):
        name = self._make_shift(status="Closed")
        with _DemoConfPatch(0):
            self.assertRaises(
                frappe.ValidationError, shifts.assert_shift_not_stale, name
            )
        with _DemoConfPatch(1):
            shifts.assert_shift_not_stale(name)  # must not throw

    def test_closed_shift_rejected_for_held_resume_acting_user(self):
        """Audit r2 P0: a held/resumed background submit reaches the real
        submit under a worker session, not the cashier. Binding ownership to
        the parked sale's owner (acting_user) must still reject a shift that
        closed while the sale sat parked — a corte the sale would corrupt."""
        name = self._make_shift(status="Closed")
        with _DemoConfPatch(0):
            self.assertRaises(
                frappe.ValidationError,
                lambda: shifts.assert_shift_not_stale(
                    name, acting_user=frappe.session.user
                ),
            )

    def test_foreign_shift_rejected_for_worker_but_bound_to_acting_owner(self):
        """The worker session differs from the cashier; the ownership bind
        must compare against acting_user, not the session. A same-day open
        shift owned by the acting user passes; a stub foreign owner fails."""
        name = self._make_shift(days_old=0, status="Open")
        with _DemoConfPatch(0):
            # acting user IS the owner → passes even though a worker session
            # would differ in production.
            shifts.assert_shift_not_stale(name, acting_user=frappe.session.user)
            self.assertRaises(
                frappe.PermissionError,
                lambda: shifts.assert_shift_not_stale(
                    name, acting_user="not-the-owner@example.com"
                ),
            )

    def test_closing_replay_flag_bypasses_gate_for_this_shift_only(self):
        """The delegated-close printed-draft replay marks the shift being
        closed so assert_shift_not_stale skips the owner/stale/closed gates
        for that server-only flush — bound to the shift name, so an unrelated
        stale shift is still gated."""
        closing = self._make_shift(status="Closed")
        other = self._make_shift(status="Closed")
        prev = frappe.flags.get("posa_closing_replay_shift")
        frappe.flags.posa_closing_replay_shift = closing
        try:
            with _DemoConfPatch(0):
                shifts.assert_shift_not_stale(closing)  # flagged shift: skipped
                self.assertRaises(
                    frappe.ValidationError,
                    shifts.assert_shift_not_stale,
                    other,  # different shift: still gated
                )
        finally:
            frappe.flags.posa_closing_replay_shift = prev

    def test_rate_band_gate_skipped_on_demo_site(self):
        # An offer-discounted line (rate < Item Price) on a no-rate-edit
        # profile: blocked for real tenants, allowed on a demo.
        row = frappe.db.get_value(
            "Item Price",
            {"price_list": "Standard Selling", "price_list_rate": [">", 1]},
            ["item_code", "price_list_rate"],
            as_dict=True,
        )
        if not row:
            self.skipTest("no Item Price on Standard Selling")
        invoice = {
            "selling_price_list": "Standard Selling",
            "items": [
                {
                    "idx": 1,
                    "item_code": row.item_code,
                    "rate": float(row.price_list_rate) * 0.9,
                    "price_list_rate": float(row.price_list_rate),
                }
            ],
        }
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Standard Selling"}
        with _DemoConfPatch(0):
            self.assertRaises(
                frappe.PermissionError,
                _reprice.assert_rates_within_band,
                invoice,
                profile,
            )
        with _DemoConfPatch(1):
            _reprice.assert_rates_within_band(invoice, profile)  # must not throw

    def test_rate_band_gate_allows_offer_discount_for_real_tenants(self):
        # Offer-aware gate: declared price_list_rate matches master and the
        # rate reflects the declared discount → passes WITHOUT demo mode.
        row = frappe.db.get_value(
            "Item Price",
            {"price_list": "Standard Selling", "price_list_rate": [">", 1]},
            ["item_code", "price_list_rate"],
            as_dict=True,
        )
        if not row:
            self.skipTest("no Item Price on Standard Selling")
        plr = float(row.price_list_rate)
        invoice = {
            "selling_price_list": "Standard Selling",
            "items": [
                {
                    "idx": 1,
                    "item_code": row.item_code,
                    "rate": plr * 0.9,
                    "price_list_rate": plr,
                    "discount_percentage": 10,
                }
            ],
        }
        profile = {"posa_allow_user_to_edit_rate": 0, "selling_price_list": "Standard Selling"}
        with _DemoConfPatch(0):
            _reprice.assert_rates_within_band(invoice, profile)  # must not throw

    def test_check_opening_shift_reports_never_stale_on_demo(self):
        name = self._make_shift()
        with _DemoConfPatch(1):
            data = shifts.check_opening_shift(frappe.session.user)
        self.assertTrue(data, "expected the open shift to be returned")
        self.assertFalse(data["stale_shift"])
        self.assertFalse(data["force_close_stale_shift"])
        with _DemoConfPatch(0):
            data = shifts.check_opening_shift(frappe.session.user)
        # Only meaningful when OUR stale shift is the newest open one for this
        # user — a pre-existing fresher shift on the site would mask it.
        if data and data["pos_opening_shift"].name == name:
            self.assertTrue(data["stale_shift"])
            self.assertTrue(data["force_close_stale_shift"])
