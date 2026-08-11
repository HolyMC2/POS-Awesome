# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""POS Floor — a named plan a register renders tables on.

Naming is `field:floor_uid` over a client-generated UUID, not a series:
boat's vertical-template importer is insert-only and Frappe discards an
explicitly supplied `name` for series-named doctypes, so a series makes a
re-applied template create duplicates (spec §2.0b / F3).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


class POSFloor(Document):
    def before_insert(self):
        if not self.floor_uid:
            self.floor_uid = frappe.generate_hash(length=22)

    def validate(self):
        if not self.floor_uid:
            frappe.throw(_("Floor UID is required."))
        self.floor_name = (self.floor_name or "").strip()
        if not self.floor_name:
            frappe.throw(_("Floor Name is required."))

        # A floor name repeated inside one company makes the floor switcher
        # ambiguous — the tab bar shows the name, not the uid.
        duplicate = frappe.db.exists(
            "POS Floor",
            {
                "company": self.company,
                "floor_name": self.floor_name,
                "name": ["!=", self.name],
            },
        )
        if duplicate:
            frappe.throw(
                _("Floor {0} already exists for company {1}.").format(
                    self.floor_name, self.company
                )
            )

        if self.pos_profile:
            profile_company = frappe.db.get_value("POS Profile", self.pos_profile, "company")
            if profile_company and profile_company != self.company:
                frappe.throw(
                    _("POS Profile {0} belongs to company {1}, not {2}.").format(
                        self.pos_profile, profile_company, self.company
                    )
                )

    def on_trash(self):
        """Refuse a hard delete while anything still points here.

        A floor referenced by a table that a settled invoice stamps is
        reporting history — soft-delete via `is_active` instead (spec §6.4).
        """
        tables = frappe.get_all(
            "POS Table", filters={"floor": self.name}, pluck="name", limit_page_length=1
        )
        if tables:
            frappe.throw(
                _("Cannot delete floor {0} — tables still belong to it. Uncheck Is Active instead.").format(
                    self.name
                )
            )
