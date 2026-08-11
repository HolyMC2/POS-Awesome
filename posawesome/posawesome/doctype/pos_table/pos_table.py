# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""POS Table — a standalone doctype, deliberately NOT a child of POS Floor.

Orders Link a table, and Frappe child rows are poor Link targets. Board
colour stays DERIVED from the open-order count (spec §0.2); the only stored
board state is `needs_cleaning`, `bill_printed_at`, and the reconciled
`occupied` hint, which is read_only here because
``restaurant._tickets.reconcile_table_occupancy`` is its only writer.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


class POSTable(Document):
    def before_insert(self):
        if not self.table_uid:
            self.table_uid = frappe.generate_hash(length=22)

    def validate(self):
        if not self.table_uid:
            frappe.throw(_("Table UID is required."))
        self.table_label = (self.table_label or "").strip()
        if not self.table_label:
            frappe.throw(_("Table Label is required."))

        # `field:table_uid` naming means the label stays renameable, so the
        # (floor, label) pair is enforced here rather than by the PK.
        duplicate = frappe.db.exists(
            "POS Table",
            {
                "floor": self.floor,
                "table_label": self.table_label,
                "name": ["!=", self.name],
            },
        )
        if duplicate:
            frappe.throw(
                _("Table {0} already exists on floor {1}.").format(
                    self.table_label, self.floor
                )
            )

    def on_trash(self):
        """Refuse a hard delete while an open order still references the table.

        Deactivating (`is_active = 0`) is the supported removal; a table
        stamped on a settled invoice must survive for reporting (spec §6.4).
        """
        from posawesome.posawesome.api.restaurant._tickets import open_order_filters

        blocking = frappe.get_all(
            "POS Table Order",
            filters=open_order_filters(table=self.name),
            pluck="name",
            limit_page_length=1,
        )
        if blocking:
            frappe.throw(
                _("Cannot delete table {0} — order {1} is still open on it.").format(
                    self.table_label or self.name, blocking[0]
                )
            )

        settled = frappe.get_all(
            "POS Table Order",
            filters={"table": self.name},
            pluck="name",
            limit_page_length=1,
        )
        if settled:
            frappe.throw(
                _("Cannot delete table {0} — orders reference it. Uncheck Is Active instead.").format(
                    self.table_label or self.name
                )
            )
