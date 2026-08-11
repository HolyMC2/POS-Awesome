"""Capability-profile resolution (VERTICAL_PROFILES_PLAN.md M3).

Proves: null link → None (frontend uses retail default, zero data change);
a linked preset resolves to the flat frontend payload with a version stamp;
a dangling link degrades to None instead of raising into shift-opening; and a
declared capability opens the matching backend feature gate, not just its UI.
"""

from __future__ import annotations

import os
import re
import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api import charge_requests, vertical
from posawesome.posawesome.api.test_document_flows import PROFILE
from posawesome.posawesome.doctype.pos_capability_profile import pos_capability_profile


class TestCapabilityResolution(IntegrationTestCase):
    PRESET = "test-coffee-quickserve"

    def setUp(self):
        # PROFILE is a REAL profile on this site — capture whatever it links to
        # so tearDown restores it instead of unlinking a live preset.
        self._orig_capability_link = frappe.db.get_value(
            "POS Profile", PROFILE, "posa_capability_profile"
        )

    def tearDown(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", self._orig_capability_link
        )
        if frappe.db.exists("POS Capability Profile", self.PRESET):
            frappe.delete_doc("POS Capability Profile", self.PRESET, force=True)

    def _make_preset(self):
        return frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "items_panel": "standard",
                "cart_style": "table",
                "items_view_default": "card",
                "dock_tabs": "browse, cart, pay",
                "lean_vertical": 1,
                "capabilities": "tab_identity, service_types",
            }
        ).insert()

    def test_null_link_resolves_to_none(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        self.assertIsNone(vertical.resolve_capability_json(PROFILE))

    def test_linked_preset_resolves_to_frontend_payload(self):
        self._make_preset()
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", self.PRESET)
        payload = vertical.resolve_capability_json(PROFILE)

        self.assertIsNotNone(payload)
        self.assertEqual(payload["version"], vertical.CAPABILITY_PAYLOAD_VERSION)
        self.assertEqual(payload["layout"]["items_view"]["default"], "card")
        self.assertTrue(payload["layout"]["lean_vertical"])
        self.assertEqual(payload["layout"]["dock_tabs"], ["browse", "cart", "pay"])
        self.assertIn("tab_identity", payload["capabilities"])

    def test_dangling_link_degrades_to_none(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", "does-not-exist"
        )
        # exists() is False for a deleted preset → None, no raise.
        self.assertIsNone(vertical.resolve_capability_json(PROFILE))

    def test_opening_payload_returns_resolved_dict(self):
        self._make_preset()
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", self.PRESET)
        payload = vertical.opening_capability_payload(PROFILE)

        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["name"], self.PRESET)
        self.assertEqual(payload["version"], vertical.CAPABILITY_PAYLOAD_VERSION)

    def test_opening_payload_none_without_link(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        self.assertIsNone(vertical.opening_capability_payload(PROFILE))

    def test_unknown_dock_tab_rejected_at_validate(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "dock_tabs": "browse, teleport, pay",
                }
            ).insert()

    def test_unknown_capability_rejected_at_validate(self):
        # A typo'd capability nobody asks has() about is a silent no-op at the
        # counter — reject it while the admin is still on the edit screen.
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "capabilities": "tab_identiy",
                }
            ).insert()

    def test_role_gated_capability_accepted_at_validate(self):
        # `capability:Role` is the documented syntax — only the base name is
        # vocabulary, the suffix is a role the frontend resolves.
        doc = frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": "external_document_checkout:Accounts Manager",
            }
        ).insert()
        self.assertEqual(doc.name, self.PRESET)


class TestChargeRequestCapabilityGate(IntegrationTestCase):
    """The SPA opens Pending Charges on EITHER the legacy
    posa_use_charge_requests flag or the external_document_checkout capability
    (verticalStore's additive gate). A capability-only preset used to render the
    menu while every endpoint threw "not enabled" — this pins the backend gate
    to the same rule.
    """

    PRESET = "test-charge-request-preset"

    def setUp(self):
        if not frappe.db.exists("POS Profile", PROFILE):
            self.skipTest("no Doco Ventas profile")
        if not frappe.db.exists("DocType", charge_requests.CHARGE_REQUEST_DOCTYPE):
            self.skipTest("doco not installed — no POS Charge Request doctype")
        if not frappe.db.has_column("POS Profile", "posa_capability_profile"):
            self.skipTest("add_capability_profile_link patch not yet migrated")
        if not frappe.db.has_column("POS Profile", "posa_use_charge_requests"):
            self.skipTest("add_use_charge_requests_flag patch not yet migrated")
        self._orig_link = frappe.db.get_value("POS Profile", PROFILE, "posa_capability_profile")
        self._orig_flag = frappe.db.get_value("POS Profile", PROFILE, "posa_use_charge_requests")
        # The legacy flag stays OFF throughout: the capability is what is on trial.
        frappe.db.set_value("POS Profile", PROFILE, "posa_use_charge_requests", 0)

    def tearDown(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_use_charge_requests", self._orig_flag)
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", self._orig_link)
        if frappe.db.exists("POS Capability Profile", self.PRESET):
            frappe.delete_doc("POS Capability Profile", self.PRESET, force=True)

    def _link_preset(self, capabilities):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": capabilities,
            }
        ).insert()
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", self.PRESET)

    def test_disabled_with_flag_off_and_no_preset(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        self.assertFalse(charge_requests._feature_enabled(PROFILE))

    def test_enabled_by_capability_with_flag_off(self):
        self._link_preset("external_document_checkout")
        self.assertTrue(charge_requests._feature_enabled(PROFILE))

    def test_enabled_by_role_gated_capability(self):
        self._link_preset("external_document_checkout:Accounts Manager")
        self.assertTrue(charge_requests._feature_enabled(PROFILE))

    def test_unrelated_capability_leaves_feature_off(self):
        self._link_preset("tab_identity, service_types")
        self.assertFalse(charge_requests._feature_enabled(PROFILE))


class TestDockTabCrossStackParity(unittest.TestCase):
    """The dock-tab vocabulary lives in two hand-maintained places: backend
    `VALID_DOCK_TABS` (pos_capability_profile.py) and the frontend
    `DOCK_TAB_IDS` tuple (viewContracts.ts). They are unbound — a backend
    change the frontend build hasn't followed makes a validated preset render
    a silent blank tab. This is the only machine check that keeps them equal.
    """

    def _view_contracts_path(self):
        return os.path.join(
            frappe.get_app_path("posawesome"),
            "..",
            "frontend",
            "src",
            "posapp",
            "vertical",
            "viewContracts.ts",
        )

    def test_frontend_dock_tab_ids_match_backend(self):
        path = self._view_contracts_path()
        if not os.path.exists(path):
            self.skipTest(f"frontend source not checked out at {path}")

        with open(path, encoding="utf-8") as handle:
            source = handle.read()

        # Grab the array literal:  DOCK_TAB_IDS = [ "browse", "offers", ... ]
        match = re.search(r"DOCK_TAB_IDS\s*=\s*\[(.*?)\]", source, re.DOTALL)
        self.assertIsNotNone(
            match,
            f"could not find `DOCK_TAB_IDS = [...]` in {path}",
        )

        # Pull the quoted tokens in source order (single or double quotes).
        frontend_ids = tuple(re.findall(r"""['"]([^'"]+)['"]""", match.group(1)))
        backend_ids = tuple(pos_capability_profile.VALID_DOCK_TABS)

        self.assertEqual(
            frontend_ids,
            backend_ids,
            "dock-tab vocabulary drift: frontend DOCK_TAB_IDS "
            f"({list(frontend_ids)}) in viewContracts.ts must equal backend "
            f"VALID_DOCK_TABS ({list(backend_ids)}) in pos_capability_profile.py "
            "(same ids, same order) — a mismatch renders a silent blank dock tab.",
        )
