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

    def test_dangling_link_fails_closed(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", "does-not-exist"
        )
        payload = vertical.resolve_capability_json(PROFILE)

        self.assertEqual(payload["resolution"]["status"], vertical.RESOLUTION_INVALID)
        self.assertEqual(payload["capabilities"], [])
        self.assertNotIn("pay", payload["layout"]["dock_tabs"])

    def test_dangling_link_blocks_submission_contract(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", "does-not-exist"
        )

        with self.assertRaises(frappe.ValidationError):
            vertical.assert_capability_configuration(PROFILE)

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

    def test_transient_failure_uses_stamped_last_known_good(self):
        self._make_preset()
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", self.PRESET)
        resolved = vertical.resolve_capability_json(PROFILE)
        self.assertEqual(resolved["resolution"]["status"], vertical.RESOLUTION_RESOLVED)

        original = vertical.resolve_capability_json
        try:
            vertical.resolve_capability_json = lambda _profile: (_ for _ in ()).throw(
                RuntimeError("temporary resolver outage")
            )
            fallback = vertical.opening_capability_payload(PROFILE)
        finally:
            vertical.resolve_capability_json = original

        self.assertEqual(
            fallback["resolution"]["status"],
            vertical.RESOLUTION_TEMPORARILY_UNAVAILABLE,
        )
        self.assertEqual(fallback["resolution"]["source"], "last_known_good")
        self.assertIn("tab_identity", fallback["capabilities"])

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

    def test_floor_is_an_accepted_dock_tab(self):
        doc = frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "dock_tabs": "browse, cart, pay, floor",
                "capabilities": "tables",
            }
        ).insert()

        self.assertEqual(
            doc.as_frontend_payload()["layout"]["dock_tabs"],
            ["browse", "cart", "pay", "floor"],
        )
        self.assertIn("tables", doc.as_frontend_payload()["capabilities"])

    def test_tips_is_an_accepted_capability(self):
        doc = frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": "tables, tips",
            }
        ).insert()

        self.assertEqual(doc.as_frontend_payload()["capabilities"], ["tables", "tips"])

    def test_a_blank_dock_tab_list_does_not_grow_a_floor_tab(self):
        # Adding "floor" to VALID_DOCK_TABS must not hand it to every preset
        # that named no tabs — a retail register has no tables to render.
        doc = frappe.get_doc(
            {"doctype": "POS Capability Profile", "profile_name": self.PRESET}
        ).insert()

        self.assertEqual(
            doc.as_frontend_payload()["layout"]["dock_tabs"],
            list(pos_capability_profile.DEFAULT_DOCK_TABS),
        )
        self.assertNotIn("floor", doc.as_frontend_payload()["layout"]["dock_tabs"])

    def test_invoice_mode_rides_the_payload_at_top_level(self):
        doc = frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "invoice_mode": "Record Only",
            }
        ).insert()

        payload = doc.as_frontend_payload()
        self.assertEqual(
            payload["invoice_mode"], "Record Only",
            "the offline write queue branches on this, so it is not a layout key",
        )

    def test_a_blank_invoice_mode_resolves_to_none(self):
        doc = frappe.get_doc(
            {"doctype": "POS Capability Profile", "profile_name": self.PRESET}
        ).insert()

        self.assertIsNone(doc.as_frontend_payload()["invoice_mode"])

    def test_unknown_invoice_mode_rejected_at_validate(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "invoice_mode": "Vale de papel",
                }
            ).insert()

    def test_payload_version_moved_with_the_shape(self):
        # invoice_mode is a NEW top-level key: a sale queued under the old
        # shape must be routed to draft-for-review, not blind-submitted.
        self.assertGreaterEqual(vertical.CAPABILITY_PAYLOAD_VERSION, 2)

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


class TestOverrideAllowlistAndProvenance(IntegrationTestCase):
    """Typed per-register override layer + provenance (roadmap F1)."""

    PRESET = "test-override-allowlist"
    FLAGS = ("posa_lean_vertical_layout", "posa_hide_items_until_search")

    def setUp(self):
        self._orig_link = frappe.db.get_value(
            "POS Profile", PROFILE, "posa_capability_profile"
        )
        self._orig_flags = {
            flag: frappe.db.get_value("POS Profile", PROFILE, flag)
            for flag in self.FLAGS
        }
        for flag in self.FLAGS:
            frappe.db.set_value("POS Profile", PROFILE, flag, 0)
        frappe.clear_cache()

    def tearDown(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", self._orig_link
        )
        for flag, value in self._orig_flags.items():
            frappe.db.set_value("POS Profile", PROFILE, flag, value or 0)
        if frappe.db.exists("POS Capability Profile", self.PRESET):
            frappe.delete_doc("POS Capability Profile", self.PRESET, force=True)
        frappe.clear_cache()

    def _link_preset(self, lean_vertical=0):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "lean_vertical": lean_vertical,
                "capabilities": "tab_identity",
            }
        ).insert()
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", self.PRESET
        )
        frappe.clear_cache()

    def test_register_flag_enables_what_the_mode_left_off(self):
        self._link_preset(lean_vertical=0)
        frappe.db.set_value("POS Profile", PROFILE, "posa_lean_vertical_layout", 1)

        payload = vertical.resolve_capability_json(PROFILE)

        self.assertTrue(payload["layout"]["lean_vertical"])

    def test_register_flag_cannot_disable_a_mode_pin(self):
        self._link_preset(lean_vertical=1)
        frappe.db.set_value("POS Profile", PROFILE, "posa_lean_vertical_layout", 0)

        payload = vertical.resolve_capability_json(PROFILE)

        self.assertTrue(payload["layout"]["lean_vertical"])

    def test_allowlist_key_absent_from_preset_rides_the_payload(self):
        self._link_preset()
        frappe.db.set_value("POS Profile", PROFILE, "posa_hide_items_until_search", 1)

        payload = vertical.resolve_capability_json(PROFILE)

        self.assertTrue(payload["layout"]["hide_items_until_search"])

    def test_provenance_reports_value_default_override_and_lock(self):
        self._link_preset(lean_vertical=1)
        frappe.db.set_value("POS Profile", PROFILE, "posa_lean_vertical_layout", 0)

        provenance = vertical.get_contract_provenance(PROFILE)

        row = next(
            r for r in provenance["overrides"] if r["key"] == "layout.lean_vertical"
        )
        self.assertTrue(row["value"])
        self.assertTrue(row["mode_default"])
        self.assertFalse(row["override"])
        self.assertIsNotNone(row["why_locked"])
        self.assertFalse(row["pending_next_shift"])
        self.assertEqual(provenance["preset"], self.PRESET)
        self.assertEqual(provenance["resolution"]["status"], "resolved")
        locked_keys = {r["key"] for r in provenance["locked"]}
        self.assertIn("capabilities", locked_keys)
        self.assertIn("invoice_mode", locked_keys)

    def test_provenance_for_an_unconfigured_register(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        frappe.db.set_value("POS Profile", PROFILE, "posa_hide_items_until_search", 1)
        frappe.clear_cache()

        provenance = vertical.get_contract_provenance(PROFILE)

        self.assertIsNone(provenance["preset"])
        self.assertEqual(provenance["resolution"]["status"], "unconfigured")
        row = next(
            r
            for r in provenance["overrides"]
            if r["key"] == "layout.hide_items_until_search"
        )
        self.assertTrue(row["value"])
        self.assertTrue(row["override"])
        self.assertIsNone(row["why_locked"])


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
