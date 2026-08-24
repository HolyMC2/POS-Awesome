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
        # Same rule for `serviceOrder`: a counter that has never taken a repair
        # in must not grow a Service Orders tab just because the id became valid.
        self.assertNotIn("serviceOrder", doc.as_frontend_payload()["layout"]["dock_tabs"])

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


class TestCapabilityProfileValidate(IntegrationTestCase):
    """`validate()` on POS Capability Profile — the throws and the one warning.

    Deliberately its own class with no `POS Profile` in it. The resolution
    tests above bind to a real profile on the site; these are about the
    doctype's own validation, so they need nothing but the doctype and run on
    any site the app is installed on.
    """

    PRESET = "test-capability-validate"

    def tearDown(self):
        if frappe.db.exists("POS Capability Profile", self.PRESET):
            frappe.delete_doc("POS Capability Profile", self.PRESET, force=True)

    # ---- Label Overrides JSON -------------------------------------------
    #
    # These three exist because that block was ONCE lost: extracting the
    # tables/Record-Only warning below into its own method left the labels
    # check indented inside it, behind an early `return` taken by every preset
    # without the `tables` capability. Nothing failed — `validate()` simply
    # stopped validating, a malformed blob saved clean, and the SPA's label map
    # stranded at boot with raw keys on screen. A silent loss of validation is
    # exactly what a test has to hold down, so each branch is named.

    def test_malformed_labels_rejected_on_a_preset_with_no_tables(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "capabilities": "tab_identity",
                    "labels": "{not json",
                }
            ).insert()

    def test_malformed_labels_rejected_on_a_correct_table_preset(self):
        # The other early return: `tables` WITH Record Only.
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "capabilities": "tables",
                    "invoice_mode": "Record Only",
                    "labels": "{not json",
                }
            ).insert()

    def test_labels_must_be_an_object_not_an_array(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "labels": '["Comensales"]',
                }
            ).insert()

    def test_well_formed_labels_still_reach_the_payload(self):
        doc = frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "labels": '{"Guests": "Comensales"}',
            }
        ).insert()

        self.assertEqual(doc.as_frontend_payload()["labels"]["Guests"], "Comensales")

    # ---- tables without Record Only (CAFETERIA_GOLDEN_FLOW.md §1) --------

    def _messages(self):
        """Whatever this Frappe spells the msgprint buffer."""
        log = getattr(frappe, "get_message_log", None)
        return log() if callable(log) else (frappe.local.message_log or [])

    def _warned_about_record_only(self):
        return any("Record Only" in str(entry) for entry in self._messages())

    def test_tables_without_record_only_warns_but_still_saves(self):
        # A WARNING, never a throw: registers already saved in this shape have
        # to keep opening, and the manager fixing it needs the record editable
        # while they read the reason.
        frappe.clear_messages()
        doc = frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": "tables",
                "invoice_mode": "Sales Invoice",
            }
        ).insert()

        self.assertEqual(doc.name, self.PRESET)
        self.assertTrue(self._warned_about_record_only())

    def test_a_blank_invoice_mode_with_tables_is_warned_about_too(self):
        # Blank is the common misconfiguration — the field simply never set.
        frappe.clear_messages()
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": "tables",
            }
        ).insert()

        self.assertTrue(self._warned_about_record_only())

    def test_tables_with_record_only_says_nothing(self):
        frappe.clear_messages()
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": "tables",
                "invoice_mode": "Record Only",
            }
        ).insert()

        self.assertFalse(self._warned_about_record_only())

    def test_a_register_without_tables_is_never_warned_about_invoice_mode(self):
        # Sales Invoice is CORRECT for a counter cafetería; the warning is
        # about table service specifically and must not nag every retail preset.
        frappe.clear_messages()
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "capabilities": "tab_identity",
                "invoice_mode": "Sales Invoice",
            }
        ).insert()

        self.assertFalse(self._warned_about_record_only())


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

    def test_service_order_is_declared_on_both_stacks(self):
        """Orden de servicio moved from dialog to dock destination (§17.6).

        Named explicitly rather than left to the equality assertion above: that
        one proves the two lists AGREE, which a shared omission would also
        satisfy. This one proves the tab actually shipped.

        The id is `serviceOrder`, not «orden» as §17.6's prose writes it: dock
        ids share a namespace with the rail's destination ids and every one of
        them is English.
        """
        path = self._view_contracts_path()
        if not os.path.exists(path):
            self.skipTest(f"frontend source not checked out at {path}")

        with open(path, encoding="utf-8") as handle:
            source = handle.read()

        match = re.search(r"DOCK_TAB_IDS\s*=\s*\[(.*?)\]", source, re.DOTALL)
        frontend_ids = tuple(re.findall(r"""['"]([^'"]+)['"]""", match.group(1)))

        self.assertIn(
            "serviceOrder", frontend_ids, "frontend DOCK_TAB_IDS is missing `serviceOrder`"
        )
        self.assertIn(
            "serviceOrder",
            pos_capability_profile.VALID_DOCK_TABS,
            "backend VALID_DOCK_TABS is missing `serviceOrder`",
        )

    def test_dock_tab_ids_stay_in_one_language(self):
        """Ids are identifiers, not operator wording.

        Operator-facing labels are Spanish through `verticalStore.t()`; the ids
        underneath them are English on both stacks. A lone Spanish id in a tuple
        this parity test spans would be the odd one out forever.
        """
        for tab_id in pos_capability_profile.VALID_DOCK_TABS:
            self.assertRegex(
                tab_id,
                r"^[a-z][a-zA-Z]*$",
                f"dock tab id «{tab_id}» must be English lowerCamelCase",
            )

    def test_the_vocabulary_only_ever_grows_at_the_end(self):
        """A preset stores its tabs as a CSV of these ids.

        Inserting a new id mid-tuple therefore reorders every dock already
        configured in the field, silently, on the next deploy. Pin the prefix
        so an insertion fails here instead of at somebody's counter.
        """
        self.assertEqual(
            tuple(pos_capability_profile.VALID_DOCK_TABS)[:6],
            ("browse", "offers", "cart", "coupons", "pay", "floor"),
            "dock tab ids must be APPENDED — inserting one reorders every "
            "preset's saved dock_tabs CSV.",
        )

    def test_drift_in_either_direction_is_caught(self):
        """Guard the guard.

        The parity assertion is only worth having if it actually fails on
        drift; a regex that silently stopped matching would pass forever. Prove
        both directions against doctored copies of the two tuples.
        """
        backend = tuple(pos_capability_profile.VALID_DOCK_TABS)

        # Backend gained an id the frontend build never followed — the blank
        # tab case named in viewContracts.ts's own comment.
        self.assertNotEqual(backend, backend + ("kitchen",))
        # Frontend gained one the backend would reject at preset-edit time.
        self.assertNotEqual(backend, backend[:-1])
        # Same members, different order — a preset's CSV would reshuffle.
        self.assertNotEqual(backend, tuple(reversed(backend)))


class TestKeymapOverride(IntegrationTestCase):
    """Keymap plumbing: preset names a pack, register may replace it (§17.3).

    A keymap moves KEYS, never what an action does — so the risk being tested
    here is not a wrong sale but a dead keyboard: an untouched Data field
    blanking the mode's pack, or an unknown pack saved at a manager's desk
    and discovered by a cashier mid-shift.
    """

    PRESET = "test-keymap-override"
    FIELD = "posa_ux_keymap_id"

    def setUp(self):
        self._orig_link = frappe.db.get_value(
            "POS Profile", PROFILE, "posa_capability_profile"
        )
        self._orig_keymap = frappe.db.get_value("POS Profile", PROFILE, self.FIELD)
        frappe.db.set_value("POS Profile", PROFILE, self.FIELD, "")
        frappe.clear_cache()

    def tearDown(self):
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", self._orig_link
        )
        frappe.db.set_value("POS Profile", PROFILE, self.FIELD, self._orig_keymap or "")
        if frappe.db.exists("POS Capability Profile", self.PRESET):
            frappe.delete_doc("POS Capability Profile", self.PRESET, force=True)
        frappe.clear_cache()

    def _link_preset(self, keymap_id=""):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": self.PRESET,
                "keymap_id": keymap_id,
                "capabilities": "tab_identity",
            }
        ).insert()
        frappe.db.set_value(
            "POS Profile", PROFILE, "posa_capability_profile", self.PRESET
        )
        frappe.clear_cache()

    def test_preset_keymap_reaches_the_payload(self):
        self._link_preset(keymap_id="muelle-default")
        payload = vertical.resolve_capability_json(PROFILE)
        self.assertEqual(payload["shortcuts"]["keymap_id"], "muelle-default")

    def test_unset_everywhere_is_null_not_empty_string(self):
        # null is "use the SPA default"; "" would be a pack id that does not
        # exist, and the resolver would have to guess what was meant.
        self._link_preset(keymap_id="")
        payload = vertical.resolve_capability_json(PROFILE)
        self.assertIsNone(payload["shortcuts"]["keymap_id"])

    def test_register_override_replaces_the_mode_pack(self):
        self._link_preset(keymap_id="")
        frappe.db.set_value("POS Profile", PROFILE, self.FIELD, "muelle-default")
        payload = vertical.resolve_capability_json(PROFILE)
        self.assertEqual(payload["shortcuts"]["keymap_id"], "muelle-default")

    def test_blank_register_field_does_not_blank_the_mode_pack(self):
        # The whole point of kind="data" normalising "" and whitespace to
        # None: every register that never touched the field would otherwise
        # strip the pack its mode teaches.
        self._link_preset(keymap_id="muelle-default")
        for blank in ("", "   "):
            frappe.db.set_value("POS Profile", PROFILE, self.FIELD, blank)
            frappe.clear_cache()
            payload = vertical.resolve_capability_json(PROFILE)
            self.assertEqual(
                payload["shortcuts"]["keymap_id"],
                "muelle-default",
                f"blank register value {blank!r} stripped the mode's pack",
            )

    def test_unknown_pack_is_refused_at_edit_time(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "POS Capability Profile",
                    "profile_name": self.PRESET,
                    "keymap_id": "sicar-classic",
                }
            ).insert()
