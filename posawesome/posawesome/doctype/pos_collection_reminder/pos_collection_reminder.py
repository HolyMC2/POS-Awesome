# Copyright (c) 2026, Youssef Restom and contributors
# For license information, please see license.txt

"""One row per reminder actually filed against an outstanding invoice.

The escalation STATE is derived from these rows — count and max(level) per
invoice — never stored anywhere else, so the log and the chips can never
disagree. Writes go through `api.receivables.file_reminder`, which owns the
level arithmetic (next = min(count + 1, 3)) and the one-step-per-day rule;
this class only refuses rows that would corrupt the derivation.
"""

import frappe
from frappe import _
from frappe.model.document import Document

MAX_REMINDER_LEVEL = 3


class POSCollectionReminder(Document):
    def validate(self):
        level = frappe.utils.cint(self.level)
        if level < 1 or level > MAX_REMINDER_LEVEL:
            frappe.throw(
                _("Reminder level must be between 1 and {0}.").format(MAX_REMINDER_LEVEL)
            )
