"""Real Frappe durable financial receipt and public-write regressions."""
import json
import unittest
import uuid
from unittest.mock import patch

import frappe
from posawesome.posawesome.api.payment_processing.request_ledger import claim_financial_request, DOCTYPE


class TestFinancialRequestLedger(unittest.TestCase):
    def setUp(self):
        self.old_user = frappe.session.user
        frappe.set_user("Administrator")
        frappe.db.savepoint("financial_receipt")
        self.profile = frappe.get_doc("POS Profile", frappe.get_all("POS Profile", pluck="name", limit=1)[0])
        self.key = "receipt-test-" + uuid.uuid4().hex
        self.intent = {"party": "fixture", "amount": 40}
        self.receipt = self.claim()

    def tearDown(self):
        frappe.db.rollback(save_point="financial_receipt")
        frappe.set_user(self.old_user)

    def claim(self, intent=None):
        return claim_financial_request("reconciliation", self.key, self.profile.company,
                                       self.profile.name, intent or self.intent)

    def test_completed_response_and_steps_survive_reload(self):
        self.receipt.complete_step("Payment Entry:fixture", {"allocated_amount": 40})
        self.receipt.finish({"allocated": 40, "remaining": 20})
        again = self.claim()
        self.assertEqual(again.response, {"allocated": 40, "remaining": 20})
        self.assertEqual(again.completed("Payment Entry:fixture"), {"allocated_amount": 40})
        self.assertEqual(frappe.db.count(DOCTYPE, {"client_request_id": self.key}), 1)
        with self.assertRaisesRegex(frappe.ValidationError, "different transaction details"):
            self.claim({"party": "fixture", "amount": 20})

    def test_failed_checkpoint_does_not_become_completed_on_final_error_save(self):
        with patch.object(self.receipt.document, "save", side_effect=RuntimeError("save failure")):
            with self.assertRaises(RuntimeError):
                self.receipt.complete_step("failed", {"allocated_amount": 40})
        self.receipt.finish({"errors": ["save failure"]}, complete=False)
        self.assertIsNone(self.claim().completed("failed"))
        self.assertIsNone(self.claim().response)

    def test_public_insert_save_set_value_bulk_delete_cannot_forge_receipt(self):
        import frappe.client as client
        document = self.receipt.document
        forged = document.as_dict()
        forged.update(name=None, ledger_key="forged-" + self.key,
                      flags={"ignore_validate": True, "ignore_permissions": True,
                             "posa_internal_ledger_writer": True})
        with self.assertRaises(frappe.PermissionError):
            client.insert(forged)
        with self.assertRaises(frappe.PermissionError):
            client.set_value(DOCTYPE, document.name, "payment_context", '{"response":{"ok":true}}')
        forged = document.as_dict()
        forged.update(state="POST_SUBMIT_DONE", flags={"ignore_validate": True, "ignore_permissions": True})
        with self.assertRaises(frappe.PermissionError):
            client.save(forged)
        result = client.bulk_update(json.dumps([dict(doctype=DOCTYPE, docname=document.name,
                                                    state="POST_SUBMIT_DONE", flags={"ignore_validate": True})]))
        self.assertEqual(len(result["failed_docs"]), 1)
        self.assertIn("PermissionError", result["failed_docs"][0]["exc"])
        with self.assertRaises(frappe.PermissionError):
            client.delete(DOCTYPE, document.name)
        document.reload()
        self.assertEqual(document.state, "RECEIVED")
        self.assertEqual(json.loads(document.payment_context), {"steps": {}})
        self.assertFalse(frappe.db.exists(DOCTYPE, "forged-" + self.key))

    def test_internal_authority_expires_and_invoice_cleanup_preserves_payment_receipt(self):
        from posawesome.posawesome.api.ledger_integrity import internal_ledger_write
        from posawesome.posawesome.api.invoice import delete_invoice_submission_ledger_entries_for_invoice
        document = self.receipt.document
        with self.assertRaises(RuntimeError):
            with internal_ledger_write():
                raise RuntimeError("interrupted writer")
        with self.assertRaises(frappe.PermissionError):
            document.db_update()
        delete_invoice_submission_ledger_entries_for_invoice("Sales Invoice", self.key)
        self.assertTrue(frappe.db.exists(DOCTYPE, document.name))
