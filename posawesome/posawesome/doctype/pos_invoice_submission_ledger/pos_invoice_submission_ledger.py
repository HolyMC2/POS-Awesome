import frappe
from frappe.model.document import Document
from posawesome.posawesome.api.ledger_integrity import assert_internal_ledger_write


class POSInvoiceSubmissionLedger(Document):
    def db_insert(self, *args, **kwargs):
        assert_internal_ledger_write()
        return super().db_insert(*args, **kwargs)

    def db_update(self, *args, **kwargs):
        assert_internal_ledger_write()
        return super().db_update(*args, **kwargs)

    def on_trash(self):
        assert_internal_ledger_write()

    def before_rename(self, *args, **kwargs):
        assert_internal_ledger_write()

    def validate(self):
        assert_internal_ledger_write()
        if not self.client_request_id:
            frappe.throw("Client Request ID is required")
        if not self.company:
            frappe.throw("Company is required")
        if not self.pos_profile:
            frappe.throw("POS Profile is required")
        if not self.document_type:
            frappe.throw("Document Type is required")
        if not self.ledger_key:
            frappe.throw("Ledger Key is required")
