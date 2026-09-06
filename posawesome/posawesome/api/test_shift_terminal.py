"""Standalone terminal-possession and transfer contract regression tests."""
import hashlib
import html
import importlib.util
import pathlib
import sys
import types
import unittest

from test_shifts_scope import _install_stubs, _load_shifts_module


class Row(dict):
    __getattr__ = dict.__getitem__
    __setattr__ = dict.__setitem__


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.modules = sys.modules.copy()
        _install_stubs()
        sys.modules["frappe"].local = types.SimpleNamespace()
        _load_shifts_module()
        path = pathlib.Path(__file__).with_name("shift_terminal.py")
        spec = importlib.util.spec_from_file_location("posawesome.posawesome.api.shift_terminal", path)
        self.api = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.api
        spec.loader.exec_module(self.api)
        self.secret = "s" * 64
        self.device = "device-A-123456789"
        self.row = Row(name="OPEN-1", user="cashier-a@example.com", pos_profile="Main POS", company="Test Co",
                       status="Open", docstatus=1, posa_terminal_id=self.device, posa_terminal_generation=1,
                       posa_terminal_token_hash=hashlib.sha256(self.secret.encode()).hexdigest(),
                       posa_terminal_recovery_pending=0)
        self.audit = []
        self.manager = False
        self.api._manager = lambda: self.manager
        self.api.frappe.utils.escape_html = html.escape
        self.api.frappe.db.get_value = lambda *args, **kwargs: self.row
        def set_value(doctype, name, values, value=None):
            self.row.update(values if isinstance(values, dict) else {values: value})
        self.api.frappe.db.set_value = set_value
        self.api.frappe.get_doc = lambda *args: types.SimpleNamespace(add_comment=lambda *args, **kwargs: self.audit.append(kwargs["text"]))

    def tearDown(self):
        sys.modules.clear()
        sys.modules.update(self.modules)

    def verify(self, generation=1, secret=None):
        return self.api.assert_terminal_access("OPEN-1", self.device, generation, secret or self.secret)

    def test_same_device_reload_keeps_access_but_copied_public_identity_is_not_proof(self):
        self.verify()
        self.verify()
        with self.assertRaisesRegex(Exception, "another browser"):
            self.verify(secret="x" * 64)

    def test_new_browser_cannot_silently_claim_an_existing_shift(self):
        with self.assertRaisesRegex(Exception, "Another browser"):
            self.api.claim_terminal("OPEN-1", "device-B-123456789", "b" * 64)
        self.assertEqual(self.row.posa_terminal_generation, 1)

    def test_forced_transfer_revokes_old_queue_and_blocks_close_until_explicit_review(self):
        with self.assertRaisesRegex(Exception, "supervisor"):
            self.api.transfer_terminal("OPEN-1", "device-B-123456789", "b" * 64, "Lost old browser", 1)
        self.manager = True
        status = self.api.transfer_terminal("OPEN-1", "device-B-123456789", "b" * 64, "Lost old browser", 1)
        self.assertEqual(status["terminal_generation"], 2)
        self.assertTrue(status["recovery_pending"])
        with self.assertRaisesRegex(Exception, "another browser"):
            self.verify()
        with self.assertRaisesRegex(Exception, "Record how"):
            self.api.resolve_terminal_recovery("OPEN-1", "", 1)
        self.api.resolve_terminal_recovery("OPEN-1", "Compared exported request IDs with server ledger", 1)
        self.assertEqual(self.row.posa_terminal_recovery_pending, 0)
        self.assertFalse(any(self.secret in entry or "b" * 64 in entry for entry in self.audit))

    def test_legacy_claim_is_explicit_and_preserves_recovery_requirement(self):
        self.row.update(posa_terminal_id="", posa_terminal_token_hash="", posa_terminal_generation=0)
        with self.assertRaisesRegex(Exception, "Review saved work"):
            self.api.claim_terminal("OPEN-1", self.device, self.secret)
        status = self.api.claim_terminal("OPEN-1", self.device, self.secret, 1)
        self.assertTrue(status["recovery_pending"])
        with self.assertRaisesRegex(Exception, "Sync and review"):
            self.api.release_terminal("OPEN-1", self.device, 1, self.secret, 1)

    def test_drained_release_and_resume_revoke_delayed_close_generation(self):
        with self.assertRaisesRegex(Exception, "Sync and review"):
            self.api.release_terminal("OPEN-1", self.device, 1, self.secret, 0)
        self.api.resume_terminal("OPEN-1", self.device, 1, self.secret, 1)
        with self.assertRaisesRegex(Exception, "another browser"):
            self.verify(generation=1)
        self.verify(generation=2)
        self.api.release_terminal("OPEN-1", self.device, 2, self.secret, 1)
        self.assertEqual(self.row.posa_terminal_id, "")

    def test_manager_selector_limits_results_to_assigned_profiles(self):
        scope = sys.modules["posawesome.posawesome.api._scope"]
        scope._is_super = lambda user: False
        scope.get_allowed_pos_profiles = lambda user: {"Main POS"}
        captured = []
        self.api.frappe.get_all = lambda *args, **kwargs: captured.append(kwargs) or []
        self.assertFalse(self.api.list_manageable_open_shifts()["can_manage"])
        self.assertEqual(captured, [])
        self.manager = True
        self.api.list_manageable_open_shifts()
        self.assertEqual(captured[0]["filters"]["pos_profile"], ["in", ["Main POS"]])
        self.assertEqual(captured[0]["fields"], ["name", "user", "pos_profile", "company"])

    def test_audit_escapes_manager_reason(self):
        self.api._audit(self.row, "reviewed", "<img src=x onerror=alert(1)>")
        self.assertIn("&lt;img", self.audit[0])
        self.assertNotIn("<img", self.audit[0])

    def test_closed_shift_never_resumes_or_accepts_old_offline_sale(self):
        self.row.status = "Closed"
        with self.assertRaisesRegex(Exception, "no longer open"):
            self.api.resume_terminal("OPEN-1", self.device, 1, self.secret, 1)
        with self.assertRaisesRegex(Exception, "no longer open"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
