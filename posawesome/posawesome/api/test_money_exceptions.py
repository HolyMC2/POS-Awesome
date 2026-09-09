"""Real Frappe exception-feed permissions, states, and redaction. Rollback-only."""
import json
import unittest
import uuid
from unittest.mock import patch

# Standalone CI has no Frappe; native bench runs must retain every assertion.
try:
    import frappe
except ModuleNotFoundError as error:
    if error.name != "frappe":
        raise
    raise unittest.SkipTest("native Frappe suite - run in an initialized test bench") from None

from posawesome.posawesome.api.money_exceptions import get_money_exceptions, Scope
from posawesome.posawesome.api.ledger_integrity import internal_ledger_write
from posawesome.posawesome.api.payment_processing.request_ledger import claim_financial_request


class TestMoneyExceptions(unittest.TestCase):
    def setUp(self):
        from doco.docoutils.test_charge_delivery import TestChargeDelivery
        self.fixture = TestChargeDelivery()
        self.fixture.setUp()
        self.profile = self.fixture.profile
        self.invoice = self.fixture.submit()
        self.secret = "PRIVATE-TOKEN-AND-PROVIDER-TRACE-" + uuid.uuid4().hex
        frappe.db.set_value("POS Charge Request", self.fixture.request.name,
                            {"callback_status": "Failed", "callback_error": self.secret})
        with internal_ledger_write():
            self.ledger = frappe.get_doc(dict(doctype="POS Invoice Submission Ledger",
                ledger_key="exception-test-" + uuid.uuid4().hex, client_request_id="exception-request-" + uuid.uuid4().hex,
                company=self.profile.company, pos_profile=self.profile.name, document_type="Sales Invoice",
                invoice_name=self.invoice.name, state="SUBMITTED", error_message=self.secret,
                request_data=json.dumps({"terminal_token": self.secret}))).insert(ignore_permissions=True)
        self.receipt = claim_financial_request("reconciliation", "exception-payment-" + uuid.uuid4().hex,
            self.profile.company, self.profile.name, dict(party_type="Customer", party=self.fixture.customer.name,
                shift=self.fixture.shift.name, terminal_token=self.secret))
        self.receipt.finish({"errors": [self.secret]}, complete=False)

    def tearDown(self):
        self.fixture.tearDown()

    def feed(self, **kwargs):
        return get_money_exceptions(self.profile.name, self.fixture.shift.name, **kwargs)

    def test_native_states_safe_navigation_and_read_only(self):
        writes = frappe.db.transaction_writes
        response = self.feed()
        self.assertEqual(frappe.db.transaction_writes, writes)
        kinds = {row["kind"] for row in response["rows"]}
        self.assertEqual(kinds, {"charge_callback", "invoice_submission", "financial_request"})
        self.assertNotIn(self.secret, json.dumps(response))
        self.assertNotIn("request_data", json.dumps(response))
        for row in response["rows"]:
            self.assertTrue(row["message_key"])
            self.assertTrue(row["modified"])
            self.assertIn(row["next_action_key"], ("open_document", "open_offline_status"))
            self.assertFalse(any("method" in action or "payload" in action for action in row["actions"]))
        self.assertEqual(response["sources"]["financial_receipts"]["status"], "supported")

    def test_completed_outcomes_disappear_and_pending_is_not_failed(self):
        self.receipt.finish({"ok": True})
        with internal_ledger_write():
            self.ledger.state = "POST_SUBMIT_DONE"
            self.ledger.save(ignore_permissions=True)
        frappe.db.set_value("POS Charge Request", self.fixture.request.name, "callback_status", "Pending")
        response = self.feed()
        self.assertEqual(len(response["rows"]), 1)
        self.assertEqual((response["rows"][0]["status"], response["rows"][0]["severity"]), ("Pending", "info"))
        frappe.db.set_value("POS Charge Request", self.fixture.request.name, "callback_status", "Complete")
        self.assertEqual(self.feed()["rows"], [])

    def test_mismatched_profile_or_company_shift_is_rejected(self):
        other = frappe.copy_doc(self.profile)
        other.name = "Exception other " + uuid.uuid4().hex[:8]
        other.insert(ignore_permissions=True)
        with self.assertRaises(frappe.PermissionError):
            get_money_exceptions(other.name, self.fixture.shift.name)
        original = self.fixture.shift.company
        frappe.db.set_value("POS Opening Shift", self.fixture.shift.name, "company", "Different company")
        with self.assertRaises(frappe.PermissionError):
            self.feed()
        frappe.db.set_value("POS Opening Shift", self.fixture.shift.name, "company", original)

    def test_other_shift_records_are_excluded_and_supervisor_profile_view_is_explicit(self):
        other = "UNRELATED-OPENING"
        frappe.db.set_value("Sales Invoice", self.invoice.name, "posa_pos_opening_shift", other)
        request = json.loads(self.receipt.document.request_data)
        request["intent"]["shift"] = other
        with internal_ledger_write():
            self.receipt.document.request_data = json.dumps(request)
            self.receipt.document.save(ignore_permissions=True)
        self.assertEqual(self.feed()["rows"], [])
        self.assertEqual(len(get_money_exceptions(self.profile.name)["rows"]), 3)

    def test_guest_denied_before_source_read(self):
        frappe.set_user("Guest")
        with patch("posawesome.posawesome.api.money_exceptions.invoice_submissions") as adapter:
            with self.assertRaises(frappe.PermissionError):
                self.feed()
            adapter.assert_not_called()

    def test_ordinary_cashier_needs_own_shift_and_profile_membership(self):
        user = frappe.get_doc(dict(doctype="User", email="exception-" + uuid.uuid4().hex + "@example.invalid",
            first_name="Exception cashier", enabled=1, send_welcome_email=0,
            roles=[dict(role=role) for role in ("Sales User", "Accounts User")])).insert(ignore_permissions=True)
        self.profile.append("applicable_for_users", dict(user=user.name, default=1))
        self.profile.save(ignore_permissions=True)
        frappe.set_user(user.name)
        with self.assertRaises(frappe.PermissionError):
            self.feed()
        with self.assertRaises(frappe.PermissionError):
            get_money_exceptions(self.profile.name)
        frappe.set_user("Administrator")
        frappe.db.set_value("POS Opening Shift", self.fixture.shift.name, "user", user.name)
        frappe.set_user(user.name)
        response = self.feed()
        self.assertTrue(any(row["kind"] == "invoice_submission" for row in response["rows"]))
        # Membership is independently enforced, even for a same-company profile.
        frappe.set_user("Administrator")
        self.profile.set("applicable_for_users", [])
        self.profile.save(ignore_permissions=True)
        frappe.set_user(user.name)
        frappe.local._posa_scope_cache = {}
        with self.assertRaises(frappe.PermissionError):
            self.feed()

    def test_limit_and_source_failure_are_visible_without_error_leak(self):
        with patch("posawesome.posawesome.api.money_exception_sources.processor", side_effect=RuntimeError(self.secret)):
            result = self.feed(limit=1)
        self.assertEqual(len(result["rows"]), 1)
        self.assertTrue(result["has_more"])
        self.assertEqual(result["sources"]["processor"]["status"], "error")
        self.assertNotIn(self.secret, json.dumps(result))
        self.assertEqual(Scope(self.profile.name, self.fixture.shift.name, 100000).limit, 50)
        with self.assertRaises(frappe.ValidationError):
            self.feed(limit="not-a-number")

    def test_uninstalled_optional_sources_are_explicitly_unavailable(self):
        with patch("posawesome.posawesome.api.money_exception_sources._installed", return_value=False):
            response = self.feed()
        for source in ("charge_callbacks", "processor", "fiscal"):
            self.assertEqual(response["sources"][source]["status"], "unavailable")

    def test_installed_fiscal_and_provider_snapshots_are_scoped_without_external_calls(self):
        self.profile.posa_cfdi_enable_stamping = 1
        self.profile.save(ignore_permissions=True)
        frappe.clear_document_cache("POS Profile", self.profile.name)
        frappe.db.set_value("Sales Invoice", self.invoice.name, "mx_stamp_error", self.secret)
        payment = frappe.get_doc(dict(doctype="MercadoPago Payment", status="Manual Review", flow="Point",
            company=self.profile.company, pos_profile=self.profile.name, sales_invoice=self.invoice.name,
            customer=self.fixture.customer.name, error_message=self.secret, response_payload=self.secret)).insert(ignore_permissions=True)
        order = frappe.get_doc(dict(doctype="MercadoPago Order", order_status="error", flow="Point",
            invoice_doctype="Sales Invoice", pos_invoice=self.invoice.name, error_message=self.secret)).insert(ignore_permissions=True)
        conekta = frappe.get_doc(dict(doctype="Conekta Order", conekta_order_id="exception-" + uuid.uuid4().hex,
            payment_status="pending_payment", reference_doctype="Sales Invoice", reference_name=self.invoice.name,
            raw_json=self.secret)).insert(ignore_permissions=True)
        writes = frappe.db.transaction_writes
        with patch("requests.sessions.Session.request", side_effect=AssertionError("Feed attempted external request")):
            response = self.feed()
        self.assertEqual(frappe.db.transaction_writes, writes)
        self.assertEqual(response["sources"]["fiscal"]["status"], "supported")
        self.assertEqual(response["sources"]["processor"]["status"], "supported")
        references = {(row["document"]["doctype"], row["document"]["name"]) for row in response["rows"] if row["document"]}
        for doc in (payment, order, conekta):
            self.assertIn((doc.doctype, doc.name), references)
        self.assertTrue(any(row["kind"] == "fiscal" for row in response["rows"]))
        self.assertNotIn(self.secret, json.dumps(response))
        self.assertTrue(any(row["kind"] == "charge_callback" and row["document"]["doctype"] == "POS Charge Request"
                            for row in response["rows"]))
        frappe.db.set_value("Sales Invoice", self.invoice.name, "posa_pos_opening_shift", "OTHER-SHIFT")
        self.assertFalse(any(row["kind"] in ("fiscal", "processor") for row in self.feed()["rows"]))

    def test_saldo_pending_snapshot_never_dispatches_or_retries(self):
        self.profile.saldo_enabled = 1
        self.profile.save(ignore_permissions=True)
        frappe.clear_document_cache("POS Profile", self.profile.name)
        transaction = frappe.get_doc(dict(doctype="Saldo Transaction", status="Pending",
            item_code=self.fixture.item.name, referencia="1234567890", monto=10,
            sales_invoice=self.invoice.name, customer=self.fixture.customer.name,
            request_payload=self.secret)).insert(ignore_permissions=True)
        writes = frappe.db.transaction_writes
        with patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected provider call")), \
                patch("frappe.enqueue", side_effect=AssertionError("Read endpoint enqueued work")):
            response = self.feed()
        self.assertEqual(frappe.db.transaction_writes, writes)
        entries = [row for row in response["rows"] if row["id"] == "processor:" + transaction.name]
        self.assertEqual(len(entries), 1)
        self.assertEqual((entries[0]["status"], entries[0]["next_action_key"]), ("Pending", "open_recargas"))
        self.assertNotIn(self.secret, json.dumps(response))

    def test_foreign_company_records_never_enter_scoped_feed(self):
        # Inconsistent imported rows cannot use matching profile/shift names to
        # override the authoritative company boundary.
        frappe.db.set_value("Sales Invoice", self.invoice.name, "company", "FOREIGN-COMPANY")
        frappe.db.set_value("POS Invoice Submission Ledger", self.receipt.document.name, "company", "FOREIGN-COMPANY")
        self.assertEqual(self.feed()["rows"], [])

    def test_terminal_callback_failure_stays_visible_without_automatic_action(self):
        frappe.db.set_value("POS Charge Request", self.fixture.request.name,
                            {"callback_status": "Needs Review", "callback_next_retry": None})
        rows = [row for row in self.feed()["rows"] if row["kind"] == "charge_callback"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "Needs Review")
        self.assertIn("failed", rows[0]["message_key"])
        self.assertEqual(rows[0]["actions"], [{"type": "open_document", "doctype": "POS Charge Request", "name": self.fixture.request.name}])
