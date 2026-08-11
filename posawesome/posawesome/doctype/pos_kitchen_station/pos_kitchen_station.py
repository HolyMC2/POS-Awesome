# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""POS Kitchen Station — Item Group to printer/station routing (spec §5).

Routing is by product category, Odoo's model. There is no KOT doctype: the
kitchen ticket is a print projection diffed against the order's `last_fired`
snapshot, which is what a venue without a kitchen display actually needs.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


class POSKitchenStation(Document):
    def before_insert(self):
        if not self.station_uid:
            self.station_uid = frappe.generate_hash(length=22)

    def validate(self):
        if not self.station_uid:
            frappe.throw(_("Station UID is required."))
        self.station_name = (self.station_name or "").strip()
        if not self.station_name:
            frappe.throw(_("Station Name is required."))

        if self.pos_profile:
            profile_company = frappe.db.get_value("POS Profile", self.pos_profile, "company")
            if profile_company and profile_company != self.company:
                frappe.throw(
                    _("POS Profile {0} belongs to company {1}, not {2}.").format(
                        self.pos_profile, profile_company, self.company
                    )
                )

        # One Item Group routed to two rows of the SAME station is harmless
        # noise; routed twice within a station it doubles the printed line.
        seen: set[str] = set()
        for row in self.item_groups or []:
            if row.item_group in seen:
                frappe.throw(
                    _("Item Group {0} is listed twice on this station.").format(row.item_group)
                )
            seen.add(row.item_group)
