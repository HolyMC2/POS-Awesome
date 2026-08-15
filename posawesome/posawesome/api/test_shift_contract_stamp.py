"""Immutable effective-contract stamp on POS Opening Shift (roadmap F1).

The shift row must record exactly which resolved capability contract it opened
under — server-durable, not just the client's copy of the opening response.
An unconfigured legacy register stamps an explicit marker so "opened with no
contract" and "predates stamping" stay distinguishable.
"""

from __future__ import annotations

import hashlib
import json
import unittest

# Bench-only integration test: needs a real frappe + site. Skip the module
# when discovered by the standalone stub-suite runner.
try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api import shifts
from posawesome.posawesome.api.restaurant import _tickets
from posawesome.posawesome.api.vertical import (
    CAPABILITY_PAYLOAD_VERSION,
    shift_effective_capability_payload,
)
from posawesome.posawesome.api.test_document_flows import PROFILE

PRESET = "POSA-TEST-STAMP-PRESET"


class _ConfPatch:
    """Temporarily set a site_config key (frappe.conf is site_config)."""

    def __init__(self, key, value):
        self.key = key
        self.value = value

    def __enter__(self):
        self.had = self.key in frappe.local.conf
        self.before = frappe.local.conf.get(self.key)
        frappe.local.conf[self.key] = self.value
        return self

    def __exit__(self, *exc):
        if self.had:
            frappe.local.conf[self.key] = self.before
        else:
            frappe.local.conf.pop(self.key, None)
        return False


class TestShiftContractStamp(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("POS Profile", PROFILE):
            self.skipTest("no Doco Ventas profile")
        self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
        self._link_before = frappe.db.get_value(
            "POS Profile", PROFILE, "posa_capability_profile"
        )
        self._shifts = []
        # create_opening_voucher enforces one open shift per user; park any
        # real open shifts for the test session user and restore them after.
        self._parked_open = [
            row.name
            for row in frappe.db.get_all(
                "POS Opening Shift",
                filters={
                    "user": frappe.session.user,
                    "pos_closing_shift": ["is", "not set"],
                    "docstatus": 1,
                    "status": "Open",
                },
                fields=["name"],
            )
        ]
        for name in self._parked_open:
            frappe.db.set_value(
                "POS Opening Shift", name, "status", "Closed", update_modified=False
            )

    def tearDown(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", self._link_before
        )
        for name in self._shifts:
            frappe.db.set_value(
                "POS Opening Shift", name, "docstatus", 2, update_modified=False
            )
            frappe.delete_doc(
                "POS Opening Shift", name, force=True, ignore_permissions=True
            )
        for name in self._parked_open:
            frappe.db.set_value(
                "POS Opening Shift", name, "status", "Open", update_modified=False
            )
        if frappe.db.exists("POS Capability Profile", PRESET):
            frappe.delete_doc(
                "POS Capability Profile", PRESET, force=True, ignore_permissions=True
            )
        frappe.clear_cache()

    def _open_shift(self):
        mode = frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name") or "Cash"
        data = shifts.create_opening_voucher(
            PROFILE,
            self.company,
            json.dumps([{"mode_of_payment": mode, "amount": 0}]),
        )
        name = data["pos_opening_shift"]["name"]
        self._shifts.append(name)
        return frappe.get_doc("POS Opening Shift", name)

    def test_unconfigured_register_stamps_explicit_marker(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        frappe.clear_cache()

        shift = self._open_shift()

        snapshot = json.loads(shift.posa_effective_contract)
        self.assertEqual(snapshot["resolution"]["status"], "unconfigured")
        self.assertEqual(shift.posa_contract_version, CAPABILITY_PAYLOAD_VERSION)
        self.assertEqual(
            shift.posa_contract_fingerprint,
            hashlib.sha256(shift.posa_effective_contract.encode("utf-8")).hexdigest(),
        )

    def test_linked_register_stamps_resolved_contract(self):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "name": PRESET,
                "profile_name": PRESET,
                "capabilities": "tab_identity",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", PRESET)
        frappe.clear_cache()

        shift = self._open_shift()

        snapshot = json.loads(shift.posa_effective_contract)
        self.assertEqual(snapshot["name"], PRESET)
        self.assertEqual(snapshot["resolution"]["status"], "resolved")
        self.assertIn("tab_identity", snapshot["capabilities"])
        self.assertEqual(shift.posa_contract_version, CAPABILITY_PAYLOAD_VERSION)
        self.assertEqual(
            shift.posa_contract_fingerprint,
            hashlib.sha256(shift.posa_effective_contract.encode("utf-8")).hexdigest(),
        )

    def test_mid_shift_preset_edit_does_not_strip_a_stamped_capability(self):
        # Next-shift activation: the gate follows the shift's stamp, so
        # removing `tables` from the preset mid-shift must not wedge the
        # floor until the next opening.
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "name": PRESET,
                "profile_name": PRESET,
                "capabilities": "tables",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", PRESET)
        frappe.clear_cache()
        self._open_shift()

        frappe.db.set_value("POS Capability Profile", PRESET, "capabilities", "")
        frappe.clear_cache()

        _tickets.assert_tables_capability(PROFILE)  # must not raise

    def test_mid_shift_preset_edit_does_not_grant_a_capability(self):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "name": PRESET,
                "profile_name": PRESET,
                "capabilities": "tab_identity",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", PRESET)
        frappe.clear_cache()
        self._open_shift()

        frappe.db.set_value(
            "POS Capability Profile", PRESET, "capabilities", "tab_identity, tables"
        )
        frappe.clear_cache()

        with self.assertRaises(frappe.PermissionError):
            _tickets.assert_tables_capability(PROFILE)

    def test_kill_switch_removes_capability_even_from_an_open_shift(self):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "name": PRESET,
                "profile_name": PRESET,
                "capabilities": "tables",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", PRESET)
        frappe.clear_cache()
        self._open_shift()

        _tickets.assert_tables_capability(PROFILE)  # sanity: granted by stamp
        with _ConfPatch("posa_disabled_capabilities", "tables"):
            with self.assertRaises(frappe.PermissionError):
                _tickets.assert_tables_capability(PROFILE)
            payload = shift_effective_capability_payload(PROFILE)
            self.assertNotIn("tables", payload.get("capabilities") or [])
        _tickets.assert_tables_capability(PROFILE)  # restored after the patch

    def test_resume_serves_the_stamped_contract(self):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "name": PRESET,
                "profile_name": PRESET,
                "capabilities": "tab_identity",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", PRESET)
        frappe.clear_cache()
        self._open_shift()

        frappe.db.set_value(
            "POS Capability Profile", PRESET, "capabilities", "tab_identity, service_types"
        )
        frappe.clear_cache()

        data = shifts.check_opening_shift(frappe.session.user)
        capabilities = (data["capability_profile"] or {}).get("capabilities") or []
        self.assertIn("tab_identity", capabilities)
        self.assertNotIn("service_types", capabilities)

    def test_stamp_survives_a_mid_shift_preset_edit(self):
        # The stamp is what the shift OPENED under; a later preset edit must
        # not rewrite history (mid-shift changes wait for the next shift).
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "name": PRESET,
                "profile_name": PRESET,
                "capabilities": "tab_identity",
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", PRESET)
        frappe.clear_cache()

        shift = self._open_shift()
        fingerprint_at_open = shift.posa_contract_fingerprint

        frappe.db.set_value(
            "POS Capability Profile", PRESET, "capabilities", "tab_identity, service_types"
        )
        frappe.clear_cache()

        shift.reload()
        self.assertEqual(shift.posa_contract_fingerprint, fingerprint_at_open)
        snapshot = json.loads(shift.posa_effective_contract)
        self.assertNotIn("service_types", snapshot["capabilities"])
