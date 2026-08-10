"""Capability-profile resolution (VERTICAL_PROFILES_PLAN.md M3).

Proves: null link → None (frontend uses retail default, zero data change);
a linked preset resolves to the flat frontend payload with a version stamp;
a dangling link degrades to None instead of raising into shift-opening.
"""

from __future__ import annotations

import json
import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api import vertical
from posawesome.posawesome.api.test_document_flows import PROFILE


class TestCapabilityResolution(IntegrationTestCase):
    PRESET = "test-coffee-quickserve"

    def tearDown(self):
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        if frappe.db.exists("POS Capability Profile", self.PRESET):
            frappe.delete_doc("POS Capability Profile", self.PRESET, force=True)
        frappe.db.commit()

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
                "capabilities": "quick_modifiers, offers",
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
        self.assertIn("quick_modifiers", payload["capabilities"])

    def test_dangling_link_degrades_to_none(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", "does-not-exist"
        )
        # exists() is False for a deleted preset → None, no raise.
        self.assertIsNone(vertical.resolve_capability_json(PROFILE))

    def test_stamp_writes_json_string_onto_profile(self):
        self._make_preset()
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", self.PRESET)
        doc = frappe.get_doc("POS Profile", PROFILE)
        vertical.stamp_capability_json(doc)

        self.assertIsInstance(doc.posa_capability_json, str)
        parsed = json.loads(doc.posa_capability_json)
        self.assertEqual(parsed["name"], self.PRESET)

    def test_unknown_dock_tab_rejected_at_validate(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "dock_tabs": "browse, teleport, pay",
                }
            ).insert()
