"""One-sale manager recovery retains request identity and never duplicates an ack."""
import html
import importlib.util
import json
import pathlib
import sys
import types
import unittest

from test_shift_terminal import TerminalTests


class RecoveryTests(unittest.TestCase):
    tearDown = TerminalTests.tearDown
    def setUp(self):
        TerminalTests.setUp(self)
        self.manager = True
        self.existing = None
        self.submissions = []
        self.repairs = []
        integrity = types.ModuleType("posawesome.posawesome.api.payment_processing.integrity")
        integrity.lock_payment_party = lambda *args: None
        sys.modules[integrity.__name__] = integrity
        original_get_doc = self.api.frappe.get_doc
        self.api.frappe.get_doc = lambda *args, **kwargs: self.existing if kwargs.get("for_update") else original_get_doc(*args)
        self.transfers = []
        self.api.frappe.db.set_value = lambda *args: self.transfers.append(args)
        self.api.frappe.utils.escape_html = html.escape
        self.api.frappe.set_user = lambda value: setattr(self.api.frappe.session, "user", value)
        identity = types.ModuleType("posawesome.posawesome.api.idempotency")
        identity.find_invoice_by_client_request_id = lambda *args, **kwargs: self.existing
        sys.modules[identity.__name__] = identity
        creation = types.ModuleType("posawesome.posawesome.api.invoice_processing.creation")
        def submit(invoice, data, **kwargs):
            self.submissions.append((json.loads(invoice), json.loads(data)))
            return {"name": "SINV-RECOVERED", "doctype": "Sales Invoice", "docstatus": 1}
        def repair(*args):
            self.repairs.append(args)
            return {"name": "SINV-EXISTING", "doctype": "Sales Invoice", "docstatus": 1}
        creation.submit_invoice = submit
        creation.repair_invoice_submission = repair
        sys.modules[creation.__name__] = creation
        path = pathlib.Path(__file__).parent / "offline_sync" / "recovery.py"
        spec = importlib.util.spec_from_file_location("posawesome.posawesome.api.offline_sync.recovery", path)
        self.recovery = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.recovery)
        self.invoice = {"company": "Test Co", "pos_profile": "Main POS", "doctype": "Sales Invoice",
                        "customer": "CUST", "posa_client_request_id": "original-id", "posa_pos_opening_shift": "OLD-SHIFT"}
        self.data = {"terminal_id": "old-device", "terminal_generation": 0, "terminal_token": "old-secret"}

    def recover(self):
        return self.recovery.recover_terminal_invoice("OPEN-1", self.invoice, self.data,
            "Compared original collected cash and request ID", 1, self.device, 1, self.secret)

    def test_manager_recovers_one_unsent_sale_retaining_original_request_and_audit(self):
        result = self.recover()
        self.assertEqual(result["client_request_id"], "original-id")
        invoice, data = self.submissions[0]
        self.assertEqual(invoice["posa_client_request_id"], "original-id")
        self.assertEqual(invoice["posa_pos_opening_shift"], "OPEN-1")
        self.assertEqual(data["idempotency_key"], "original-id")
        self.assertTrue(any("OLD-SHIFT" in entry and "old-device" in entry for entry in self.audit))
        self.assertTrue(all("old-secret" not in entry and self.secret not in entry for entry in self.audit))

    def test_submitted_identity_is_repaired_without_creating_another_sale(self):
        self.existing = types.SimpleNamespace(company="Test Co", pos_profile="Main POS", docstatus=1, doctype="Sales Invoice", name="SINV-EXISTING", customer="CUST")
        self.recover()
        self.assertEqual(len(self.repairs), 1)
        self.assertEqual(self.submissions, [])

    def test_submitted_other_customer_is_never_acknowledged(self):
        self.existing = types.SimpleNamespace(company="Test Co", pos_profile="Main POS", docstatus=1,
            doctype="Sales Invoice", name="SINV-EXISTING", customer="OTHER")
        with self.assertRaisesRegex(Exception, "different customer"):
            self.recover()
        self.assertEqual(self.repairs, [])
        self.assertEqual(self.submissions, [])

    def test_old_cashier_draft_is_explicitly_transferred_with_identity_intact(self):
        from test_shift_terminal import Row
        self.existing = Row(company="Test Co", pos_profile="Main POS", docstatus=0, doctype="Sales Invoice",
            name="SINV-OLD", customer="CUST", owner="old-cashier", posa_pos_opening_shift="OLD-SHIFT")
        self.recover()
        self.assertEqual(self.transfers[0][2], {"owner": self.row.user, "posa_pos_opening_shift": "OPEN-1"})
        self.assertEqual(self.submissions[0][0]["name"], "SINV-OLD")
        self.assertTrue(any("old-cashier" in entry and "SINV-OLD" in entry for entry in self.audit))

    def test_historical_ack_without_submitted_server_match_never_posts(self):
        with self.assertRaisesRegex(Exception, "historical acknowledgement"):
            self.recovery.recover_terminal_invoice("OPEN-1", self.invoice, self.data,
                "Reviewed historical ambiguous acknowledgement", 1, self.device, 1, self.secret, verify_only=1)
        self.assertEqual(self.submissions, [])
        self.assertEqual(self.audit, [])

    def test_cashier_cannot_use_manager_recovery(self):
        self.manager = False
        with self.assertRaisesRegex(Exception, "supervisor"):
            self.recover()
        self.assertEqual(self.submissions, [])


if __name__ == "__main__":
    unittest.main()
