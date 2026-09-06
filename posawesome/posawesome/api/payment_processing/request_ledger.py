"""Durable receipts for financial requests that need not create a new payment."""

import hashlib
import json

import frappe
from frappe import _

from posawesome.posawesome.api.ledger_integrity import internal_ledger_write

DOCTYPE = "POS Invoice Submission Ledger"
PAYMENT_DOCUMENT_TYPE = "POS Payment Request"


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False)


class FinancialRequest:
    def __init__(self, document):
        self.document = document
        self.context = json.loads(document.payment_context or "{}")
        self.context.setdefault("steps", {})

    @property
    def response(self):
        return self.context.get("response") if self.document.state == "POST_SUBMIT_DONE" else None

    def completed(self, step_key):
        return self.context["steps"].get(step_key)

    def complete_step(self, step_key, result):
        """Call within the SAME savepoint/transaction as the financial write."""
        previous = dict(self.context["steps"])
        self.context["steps"][step_key] = result
        try:
            self._save("SUBMITTED")
        except Exception:
            self.context["steps"] = previous
            raise

    def finish(self, response, complete=True):
        self.context["response" if complete else "last_response"] = response
        self._save("POST_SUBMIT_DONE" if complete else "FAILED")

    def _save(self, state):
        self.document.state = state
        self.document.payment_context = _json(self.context)
        with internal_ledger_write():
            self.document.save(ignore_permissions=True)


def claim_financial_request(kind, client_request_id, company, pos_profile, intent):
    """Authorize and lock all source documents BEFORE calling this writer.

    The caller holds opening shift -> party -> sorted invoice/payment locks.
    These receipts are retained independently of invoice-ledger pruning.
    `intent` contains explicit business inputs, never browser secrets/flags.
    """
    if (
        not isinstance(client_request_id, str)
        or not client_request_id.strip()
        or len(client_request_id) > 140
    ):
        frappe.throw(_("A valid request ID is required to reconcile or refund an existing payment."))
    client_request_id = client_request_id.strip()
    identity = _json([kind, client_request_id, company, pos_profile])
    key = "payment:" + hashlib.sha256(identity.encode()).hexdigest()
    request_data = _json({"kind": kind, "intent": intent})
    name = frappe.db.get_value(DOCTYPE, key, "name", for_update=True)
    if name:
        document = frappe.get_doc(DOCTYPE, name, for_update=True)
    else:
        document = frappe.get_doc(
            dict(
                doctype=DOCTYPE,
                ledger_key=key,
                client_request_id=client_request_id,
                company=company,
                pos_profile=pos_profile,
                document_type=PAYMENT_DOCUMENT_TYPE,
                state="RECEIVED",
                request_data=request_data,
                payment_context=_json({"steps": {}}),
            )
        )
        try:
            with internal_ledger_write():
                document.insert(ignore_permissions=True)
        except frappe.DuplicateEntryError:
            document = frappe.get_doc(DOCTYPE, key, for_update=True)
    if (
        document.document_type != PAYMENT_DOCUMENT_TYPE
        or document.request_data != request_data
        or document.company != company
        or document.pos_profile != pos_profile
    ):
        frappe.throw(_("This financial request ID was already used for different transaction details."))
    return FinancialRequest(document)
