"""Real MariaDB terminal lifecycle/review proofs, private fixtures rolled back."""
import json
import unittest
import uuid
from unittest.mock import patch

import frappe

from posawesome.posawesome.api import shift_terminal as terminal


class TestNativeTerminalLifecycle(unittest.TestCase):
    def setUp(self):
        from doco.docoutils.test_charge_delivery import TestChargeDelivery
        self.fixture = TestChargeDelivery()
        self.fixture.setUp()
        self.shift = self.fixture.shift.name
        self.proof = dict(self.fixture.proof)
        self.no_network = patch("requests.sessions.Session.request", side_effect=AssertionError("No providers"))
        self.no_network.start()

    def tearDown(self):
        self.no_network.stop()
        self.fixture.tearDown()
        frappe.local.posa_verified_terminal_generations = {}

    def resume(self, **overrides):
        return terminal.resume_terminal(self.shift, drained=1, **{**self.proof, **overrides})

    def test_lost_resume_reply_is_idempotent_and_old_money_proof_stays_revoked(self):
        first = self.resume()
        for _ in range(3):
            self.assertEqual(self.resume(), first)
        row = frappe.get_doc("POS Opening Shift", self.shift)
        self.assertEqual((row.posa_terminal_generation, row.posa_terminal_resume_from_generation), (2, 1))
        self.assertEqual(frappe.db.count("Comment", {"reference_doctype": "POS Opening Shift",
            "reference_name": self.shift, "content": ["like", "%previous close credentials revoked%"]}), 1)
        with self.assertRaises(frappe.PermissionError):
            terminal.assert_terminal_access(self.shift, **self.proof)
        with self.assertRaises(frappe.ValidationError):
            terminal.assert_verified_terminal_generation(self.shift, 1)
        terminal.assert_terminal_access(self.shift, **{**self.proof, "terminal_generation": 2})

    def test_resume_replay_rejects_bad_secret_other_owner_and_closed_shift(self):
        self.resume()
        with self.assertRaises(frappe.PermissionError):
            self.resume(terminal_token="x" * 64)
        # Same supervisor session must not resume another cashier's binding.
        frappe.db.set_value("POS Opening Shift", self.shift, "user", "Guest")
        with self.assertRaises(frappe.PermissionError):
            self.resume()
        frappe.db.set_value("POS Opening Shift", self.shift, {"user": "Administrator", "status": "Closed"})
        with self.assertRaises(frappe.ValidationError):
            self.resume()
        self.assertEqual(frappe.db.get_value("POS Opening Shift", self.shift, "posa_terminal_generation"), 2)

    def test_transfer_cannot_masquerade_as_resume_even_with_same_credentials(self):
        self.resume()
        terminal.transfer_terminal(self.shift, self.proof["terminal_id"], self.proof["terminal_token"],
                                   "Reviewed the private test terminal", 1)
        with self.assertRaises(frappe.PermissionError):
            self.resume(terminal_generation=2)
        row = frappe.get_doc("POS Opening Shift", self.shift)
        self.assertEqual((row.posa_terminal_generation, row.posa_terminal_resume_from_generation), (3, 0))

    def test_lost_release_reply_status_never_authorizes_releasing_a_new_binding(self):
        self.resume()
        terminal.release_terminal(self.shift, drained=1, **{**self.proof, "terminal_generation": 2})
        status = terminal.get_terminal_status(self.shift, self.proof["terminal_id"], self.proof["terminal_token"])
        self.assertFalse(status["owned"])
        self.assertEqual((status["terminal_id"], status["terminal_generation"]), ("", 3))
        other = "other-terminal-" + uuid.uuid4().hex
        terminal.claim_terminal(self.shift, other, "b" * 64)
        with self.assertRaises(frappe.PermissionError):
            terminal.release_terminal(self.shift, drained=1, **{**self.proof, "terminal_generation": 2})
        row = frappe.get_doc("POS Opening Shift", self.shift)
        self.assertEqual((row.posa_terminal_id, row.posa_terminal_resume_from_generation), (other, 0))

    def test_desk_cannot_forge_resume_provenance_on_existing_or_new_shift(self):
        self.resume()
        row = frappe.get_doc("POS Opening Shift", self.shift)
        row.posa_terminal_resume_from_generation = 99
        with self.assertRaisesRegex(frappe.ValidationError, "direct field changes"):
            row.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value("POS Opening Shift", self.shift,
                                            "posa_terminal_resume_from_generation"), 1)
        copied = frappe.copy_doc(row)
        copied.posa_terminal_id = ""
        copied.posa_terminal_resume_from_generation = 99
        with self.assertRaisesRegex(frappe.ValidationError, "selling browser"):
            copied.insert(ignore_permissions=True)

    def test_parked_sale_requires_review_then_rebinds_same_request_without_duplication(self):
        from posawesome.posawesome.api.invoice_processing import creation
        from posawesome.posawesome.api.offline_sync.recovery import recover_terminal_invoice
        draft = self.fixture.prepare()
        invoice = frappe.get_doc("Sales Invoice", draft["name"])
        request_id = "terminal-held-" + uuid.uuid4().hex
        cash = next(row.mode_of_payment for row in self.fixture.profile.payments
                    if frappe.db.get_value("Mode of Payment", row.mode_of_payment, "type") == "Cash")
        payload = invoice.as_dict()
        payload.update(posa_client_request_id=request_id, is_pos=1, update_stock=0,
                       payments=[{"mode_of_payment": cash, "amount": invoice.rounded_total or invoice.grand_total}])
        payload = json.loads(frappe.as_json(payload))
        data = {**self.proof, "idempotency_key": request_id}
        with patch.object(creation, "_run_submit_hold_gates", return_value={"reason": "Private native hold"}):
            held = creation.submit_invoice(frappe.as_json(payload), json.dumps(data))
        self.assertTrue(held["held"])
        self.assertEqual(held["docstatus"], 0)
        self.resume()
        with self.assertRaises(frappe.PermissionError):
            creation.submit_invoice(frappe.as_json(payload), json.dumps(data))
        ledger = creation._get_submission_ledger(request_id, invoice.company, invoice.pos_profile, "Sales Invoice")
        self.assertEqual(json.loads(ledger.request_data)["_verified_terminal_generation"], 1)
        # The automatic worker remains unable to spend a revoked generation.
        with self.assertRaises(frappe.ValidationError):
            terminal.assert_verified_terminal_generation(self.shift, 1)
        current = {**self.proof, "terminal_generation": 2}
        with patch.object(creation, "_run_submit_hold_gates", return_value=None):
            recovered = recover_terminal_invoice(self.shift, payload, data,
                "Reviewed original collected cash and held sale", 1, **current)
            repeated = recover_terminal_invoice(self.shift, payload, data,
                "Verified the original request after recovery", 1, **current)
        self.assertEqual(recovered["invoice"]["name"], invoice.name)
        self.assertEqual(repeated["invoice"], recovered["invoice"])
        self.assertEqual(recovered["client_request_id"], request_id)
        ledger.reload()
        self.assertEqual(json.loads(ledger.request_data)["_verified_terminal_generation"], 2)
        self.assertNotIn(self.proof["terminal_token"], ledger.request_data)
        self.assertEqual(frappe.db.count("Sales Invoice", {"posa_client_request_id": request_id}), 1)
        invoice.reload()
        self.assertEqual(invoice.docstatus, 1)
        self.assertEqual(invoice.outstanding_amount, 0)
        ledger_rows = frappe.db.sql("select sum(debit),sum(credit) from `tabGL Entry` where voucher_no=%s", invoice.name)[0]
        self.assertGreater(ledger_rows[0], 0)
        self.assertEqual(ledger_rows[0], ledger_rows[1])
