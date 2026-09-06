# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import cint
from frappe.model.document import Document
from posawesome.posawesome.api.status_updater import StatusUpdater


class POSOpeningShift(StatusUpdater):
    def validate(self):
        self._validate_terminal_fields()
        self.validate_pos_profile_and_cashier()
        self.set_status()

    def before_update_after_submit(self):
        # Frappe bypasses validate() for submitted-document edits. The normal
        # Desk save path must not become a second terminal-management API.
        self._validate_terminal_fields()

    def _validate_terminal_fields(self):
        terminal_fields = ("posa_terminal_id", "posa_terminal_generation", "posa_terminal_token_hash",
                           "posa_terminal_recovery_pending", "posa_terminal_resume_from_generation")
        previous = self.get_doc_before_save()
        if previous and any(self.get(field) != previous.get(field) for field in terminal_fields):
            frappe.throw(_("Manage terminal registration through Offline Status; direct field changes are not allowed."))
        if self.is_new() and any(self.get(field) for field in terminal_fields) and not self.flags.get("posa_binding_new_terminal"):
            frappe.throw(_("Open this shift from its selling browser to register the terminal."))

    def validate_pos_profile_and_cashier(self):
        if self.company != frappe.db.get_value("POS Profile", self.pos_profile, "company"):
            frappe.throw(
                _("POS Profile {} does not belongs to company {}".format(self.pos_profile, self.company))
            )

        if not cint(frappe.db.get_value("User", self.user, "enabled")):
            frappe.throw(_("User {} has been disabled. Please select valid user/cashier".format(self.user)))

    def on_submit(self):
        self.set_status(update=True)
