"""Pure spec-01 rules: codes, reasons, revisions, business day, readiness."""
import datetime as dt
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("register_model", pathlib.Path(__file__).with_name("model.py"))
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class CodeAndTextRules(unittest.TestCase):
    def test_codes_are_normalized_case_insensitive_and_bounded(self):
        self.assertEqual(model.normalize_code(" caja-1 "), "CAJA-1")
        self.assertEqual(model.normalize_code("ｃａｊａ２"), "CAJA2")  # NFKC folds full-width input
        for bad in ("", "-A", "x" * 33, "caja 1", "caja/1"):
            with self.assertRaises(model.RuleError):
                model.normalize_code(bad)

    def test_labels_keep_unicode_and_collapse_whitespace(self):
        self.assertEqual(model.normalize_label("  Caja   Mostrador  "), "Caja Mostrador")
        self.assertEqual(model.normalize_label("Café Ñandú"), "Café Ñandú")
        with self.assertRaises(model.RuleError):
            model.normalize_label("   ")
        with self.assertRaises(model.RuleError):
            model.normalize_label("x" * 121)

    def test_mandatory_reasons_refuse_whitespace_and_punctuation(self):
        with self.assertRaises(model.RuleError):
            model.normalize_reason("        ")
        with self.assertRaises(model.RuleError):
            model.normalize_reason("........!!")
        with self.assertRaises(model.RuleError):
            model.normalize_reason("x" * 2001)
        self.assertEqual(model.normalize_reason("Tablet dropped"), "Tablet dropped")
        self.assertEqual(model.normalize_reason("", required=False), "")

    def test_request_ids_and_revisions(self):
        self.assertEqual(model.request_id("a" * 16), "a" * 16)
        for bad in ("short", "a" * 81, "a b" * 8):
            with self.assertRaises(model.RuleError):
                model.request_id(bad)
        self.assertEqual(model.positive_revision("12"), 12)
        self.assertIsNone(model.positive_revision(None))
        for bad in ("0", "-1", "1.5", True, "9" * 16):
            with self.assertRaises(model.RuleError):
                model.positive_revision(bad)

    def test_revision_conflict_is_distinct_from_missing_revision(self):
        with self.assertRaises(model.RuleError) as missing:
            model.assert_revision(3, None)
        self.assertEqual(missing.exception.code, "validation_failed")
        with self.assertRaises(model.RuleError) as stale:
            model.assert_revision(3, "2")
        self.assertEqual(stale.exception.code, "revision_conflict")
        model.assert_revision(3, "3")


class LifecycleAndTime(unittest.TestCase):
    def test_register_lifecycle_transitions(self):
        model.check_transition("Draft", "Ready")
        model.check_transition("Ready", "Suspended")
        model.check_transition("Suspended", "Ready")
        for current, target in (("Retired", "Ready"), ("Draft", "Suspended"), ("Ready", "Draft")):
            with self.assertRaises(model.RuleError):
                model.check_transition(current, target)

    def test_business_date_respects_timezone_and_cutoff(self):
        # 2026-09-22 09:30 UTC = 03:30 in Mazatlán (UTC-7): before a 04:00 cutoff.
        instant = dt.datetime(2026, 9, 22, 10, 30, tzinfo=dt.timezone.utc)
        self.assertEqual(model.business_date(instant, "America/Mazatlan", "04:00"), dt.date(2026, 9, 21))
        self.assertEqual(model.business_date(instant, "America/Mazatlan", "00:00"), dt.date(2026, 9, 22))
        self.assertEqual(model.business_date(instant, "UTC", dt.timedelta(hours=11)), dt.date(2026, 9, 21))
        with self.assertRaises(model.RuleError):
            model.validate_timezone("Mars/Base")
        with self.assertRaises(model.RuleError):
            model.parse_cutoff("25:00")

    def test_connectivity_never_reads_absence_as_fresh(self):
        now = dt.datetime(2026, 9, 22, 12)
        self.assertEqual(model.connectivity(None, now), "Unknown")
        self.assertEqual(model.connectivity(now - dt.timedelta(seconds=90), now), "Fresh")
        self.assertEqual(model.connectivity(now - dt.timedelta(seconds=91), now), "Stale")

    def test_page_length_is_bounded(self):
        self.assertEqual(model.page_length(None), 50)
        self.assertEqual(model.page_length(500), 100)
        self.assertEqual(model.page_length("x"), 50)
        self.assertEqual(model.page_length(0), 50)


class Hashing(unittest.TestCase):
    def test_payload_hash_excludes_secrets_but_binds_actor(self):
        a = model.payload_hash("registers.open", "ana", {"register": "R1", "terminal_token": "one"})
        b = model.payload_hash("registers.open", "ana", {"register": "R1", "terminal_token": "two"})
        c = model.payload_hash("registers.open", "beto", {"register": "R1", "terminal_token": "one"})
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_challenge_codes(self):
        self.assertEqual(model.normalize_challenge("abcd-2345"), "ABCD2345")
        for bad in ("ABCD-234", "ABCD-1234", "ABCD-O0I1"):
            with self.assertRaises(model.RuleError):
                model.normalize_challenge(bad)

    def test_bundles_separate_cashier_from_configuration(self):
        self.assertEqual(model.capabilities("Cashier"), {"sell"})
        self.assertNotIn("configure", model.capabilities("Store supervisor"))
        self.assertNotIn("sell", model.capabilities("Auditor"))


class Readiness(unittest.TestCase):
    good = {"store_status": "Active", "profile_enabled": True, "profile_company": "C", "profile_in_store": True,
            "drawer_valid": True, "drawer_conflict": False, "active_binding": True}
    reg = {"company": "C", "mode": "Cash", "drawer_account": "Caja 1 - C", "requires_enrolled_device": 1}

    def keys(self, register, facts):
        return [item["key"] for item in model.readiness(register, facts)]

    def test_ready_register_has_no_blockers(self):
        self.assertEqual(self.keys(self.reg, self.good), [])

    def test_each_unmet_requirement_names_its_owner(self):
        items = model.readiness(dict(self.reg, drawer_account=None), dict(self.good, active_binding=False,
                                                                           store_status="Suspended"))
        self.assertEqual({i["key"]: i["owner"] for i in items},
                         {"store_active": "store", "drawer_account": "register", "device": "device"})

    def test_shared_drawer_custody_and_unapproved_route_block(self):
        self.assertIn("drawer_exclusive", self.keys(self.reg, dict(self.good, drawer_conflict=True)))
        self.assertIn("custody", self.keys(self.reg, dict(self.good, custody_enabled=True)))
        self.assertIn("route_change", self.keys(self.reg, dict(self.good, route_difference=True)))
        self.assertNotIn("route_change", self.keys(self.reg, dict(self.good, route_difference=True, route_approved=True)))

    def test_cashless_needs_no_drawer(self):
        self.assertEqual(self.keys(dict(self.reg, mode="Cashless", drawer_account=None), self.good), [])


if __name__ == "__main__":
    unittest.main()
