# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.utils import get_base_value
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.data import (
    get_cashiers,
    get_pos_invoices,
    get_payments_entries,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.overview import (
    get_closing_shift_overview,
    get_payment_reconciliation_details,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
    make_closing_shift_from_opening,
    submit_closing_shift,
)
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    submit_printed_invoices,
    delete_draft_invoices,
    _set_closing_entry_invoices,
    _clear_closing_entry_invoices,
    consolidate_closing_shift_invoices,
)


class POSClosingShift(Document):
    def validate(self):
        user = frappe.get_all(
            "POS Closing Shift",
            filters={
                "user": self.user,
                "docstatus": 1,
                "pos_opening_shift": self.pos_opening_shift,
                "name": ["!=", self.name],
            },
        )

        if user:
            frappe.throw(
                _(
                    "POS Closing Shift {} against {} between selected period".format(
                        frappe.bold("already exists"), frappe.bold(self.user)
                    )
                ),
                title=_("Invalid Period"),
            )

        if frappe.db.get_value("POS Opening Shift", self.pos_opening_shift, "status") != "Open":
            frappe.throw(
                _("Selected POS Opening Shift should be open."),
                title=_("Invalid Opening Entry"),
            )
        self.enforce_server_truth()
        self.update_payment_reconciliation()

    def enforce_server_truth(self):
        """Anti-tamper: rebuild every server-derivable table from the DB.

        submit_closing_shift() accepts the whole document from the client
        (with ignore_permissions), so a tampered payload could omit
        invoices from pos_transactions or fabricate expected_amount to
        hide a cash shortage. Re-derive transactions, taxes, expected
        amounts, pos_payments and the header totals from the opening
        shift + submitted invoices; the ONLY operator inputs kept are
        closing_amount (counted money) per mode of payment.
        """
        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
            compute_closing_tables,
        )

        opening = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
        # Header fields must match the opening shift, not the payload.
        self.user = opening.user
        self.pos_profile = opening.pos_profile
        self.company = opening.company

        tables = compute_closing_tables(opening.as_dict())

        counted = {
            d.mode_of_payment: flt(d.closing_amount)
            for d in (self.payment_reconciliation or [])
        }
        for row in tables["payment_reconciliation"]:
            row["closing_amount"] = counted.get(row.get("mode_of_payment"), 0)

        self.grand_total = tables["grand_total"]
        self.net_total = tables["net_total"]
        self.total_quantity = tables["total_quantity"]
        self.set("pos_transactions", tables["pos_transactions"])
        self.set("payment_reconciliation", tables["payment_reconciliation"])
        self.set("taxes", tables["taxes"])
        self.set("pos_payments", tables["pos_payments"])

    def update_payment_reconciliation(self):
        # update the difference values in Payment Reconciliation child table
        # get default precision for site
        precision = frappe.get_cached_value("System Settings", None, "currency_precision") or 3
        for d in self.payment_reconciliation:
            d.difference = +flt(d.closing_amount, precision) - flt(d.expected_amount, precision)

    def on_submit(self):
        opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
        opening_entry.pos_closing_shift = self.name
        opening_entry.set_status()
        self.delete_draft_invoices()
        opening_entry.save()
        # link invoices with this closing shift so ERPNext can block edits
        _set_closing_entry_invoices(self)
        consolidate_closing_shift_invoices(self)

    def on_cancel(self):
        if frappe.db.exists("POS Opening Shift", self.pos_opening_shift):
            opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
            if opening_entry.pos_closing_shift == self.name:
                opening_entry.pos_closing_shift = ""
                opening_entry.set_status()
                opening_entry.save()
        # remove links from invoices so they can be cancelled
        _clear_closing_entry_invoices(self)

    def delete_draft_invoices(self):
        delete_draft_invoices(self.pos_opening_shift, self.pos_profile)

    @frappe.whitelist()
    def get_payment_reconciliation_details(self):
        return get_payment_reconciliation_details(self)
