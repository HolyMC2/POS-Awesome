# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""POS Table Order — the Record-Only open ticket.

Deliberately NOT a draft Sales Invoice. `POS Closing Shift.on_submit()`
force-deletes every un-printed draft on the shift, so a draft-backed table
ticket either vanishes at shift close or blocks the close outright — and
shifts are per-user, so closing one is a routine end-of-turn act (spec §0.1,
F1). This doctype is shift-durable and materialises an accounting document
only at settle.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

OPEN_STATUSES = ("Open", "Settling")

# The only two doctypes a settle can produce — `create_pos_invoice_instead_of_
# sales_invoice` on the POS Profile picks between them. Enforced here as well
# as by the field's link_filters, because link_filters only guide the Desk UI.
SETTLED_DOCTYPES = ("Sales Invoice", "POS Invoice")


class POSTableOrder(Document):
    def before_insert(self):
        if not self.order_uid:
            self.order_uid = frappe.generate_hash(length=22)

    def validate(self):
        if not self.order_uid:
            frappe.throw(_("Order UID is required."))
        if not self.status:
            self.status = "Open"

        if not self.company and self.pos_profile:
            self.company = frappe.db.get_value("POS Profile", self.pos_profile, "company")

        self._validate_table_scope()
        self._validate_settlement_target()
        self._normalise_lines()

    def _validate_settlement_target(self):
        """The Dynamic Link must point at an accounting doctype, and only one
        of the two this app can create."""
        if self.settled_doctype and self.settled_doctype not in SETTLED_DOCTYPES:
            frappe.throw(
                _("Settled Doctype must be one of {0}.").format(", ".join(SETTLED_DOCTYPES))
            )
        if self.settled_invoice and not self.settled_doctype:
            frappe.throw(_("Settled Invoice needs a Settled Doctype to resolve against."))

    def _validate_table_scope(self):
        """A table on another company's floor would settle into the wrong books."""
        if not self.table:
            return
        floor = frappe.db.get_value("POS Table", self.table, "floor")
        if not floor:
            return
        floor_company = frappe.db.get_value("POS Floor", floor, "company")
        if floor_company and self.company and floor_company != self.company:
            frappe.throw(
                _("Table {0} belongs to company {1}, not {2}.").format(
                    self.table, floor_company, self.company
                )
            )

    def _normalise_lines(self):
        """Line ids are mandatory and amounts are always server-computed.

        `amount` arriving from the client is how a discount appears that
        nobody authorised; qty x rate is the only value the settle path may
        carry onto an invoice.
        """
        seen: set[str] = set()
        for row in self.items or []:
            if not row.line_uid:
                row.line_uid = frappe.generate_hash(length=22)
            if row.line_uid in seen:
                frappe.throw(_("Duplicate line uid {0} on this order.").format(row.line_uid))
            seen.add(row.line_uid)
            if row.qty is None:
                row.qty = 1
            row.amount = flt(row.qty) * flt(row.rate)
            if not row.course_idx:
                row.course_idx = 1

    def on_trash(self):
        if self.status in OPEN_STATUSES:
            frappe.throw(
                _("Cannot delete order {0} while it is {1} — cancel it first.").format(
                    self.name, self.status
                )
            )
        if self.settled_invoice:
            frappe.throw(
                _("Cannot delete order {0} — it settled into invoice {1}.").format(
                    self.name, self.settled_invoice
                )
            )
