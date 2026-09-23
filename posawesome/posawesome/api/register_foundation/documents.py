"""DocType controllers for spec 01 records.

Desk forms and ``/posapp`` commands share these validators, so a generic
form cannot create what the business command would refuse. Runtime pointers,
bindings, devices, challenges, receipts and events are service-only: generic
Desk/REST writes are refused, and history cannot be deleted.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.model.document import Document

from .errors import fail, rules
from .model import (MODES, SCOPE_TYPES, STORE_STATES, BUNDLES, normalize_code, normalize_label,
                    normalize_reason, parse_cutoff, validate_timezone)

ROUTING_FIELDS = ("pos_profile", "mode", "drawer_account", "default_safe")


def _service() -> bool:
    return bool(getattr(frappe.local, "posa_register_service", False))


class ServiceRecord(Document):
    def validate(self):
        if not _service():
            frappe.throw(_("This record is maintained by POS register actions and cannot be edited directly."),
                         frappe.PermissionError)

    def on_trash(self):
        frappe.throw(_("Register history cannot be deleted."), frappe.PermissionError)


class StoreDocument(Document):
    def validate(self):
        previous = self.get_doc_before_save()
        with rules():
            self.store_code = normalize_code(self.store_code)
            self.store_name = normalize_label(self.store_name, "store name")
            self.timezone = validate_timezone(self.timezone)
            parse_cutoff(self.business_day_cutoff)
        if self.status not in STORE_STATES:
            fail("validation_failed", "Unknown store status.")
        if not frappe.db.exists("Company", self.company):
            fail("validation_failed", "Choose an existing company.")
        if previous:
            if previous.status != self.status and not _service():
                fail("invalid_state", "Suspend, reactivate or retire the store from the Cajas workspace.")
            if (previous.company != self.company or previous.store_code != self.store_code) and (
                    previous.has_activity or self.has_activity):
                fail("invalid_state", "Company and store code cannot change after the store has activity.")
            if previous.has_activity and not self.has_activity:
                self.has_activity = 1
            self.revision = int(previous.revision or 1) + 1
        elif not _service():
            # A Desk-created store starts without activity at revision 1.
            self.has_activity = 0
            self.revision = 1
        self.store_key = f"{self.company}::{self.store_code}"
        seen = set()
        for row in self.get("warehouses") or []:
            company = frappe.db.get_value("Warehouse", row.warehouse, "company")
            if not company or company != self.company:
                fail("validation_failed", "Every permitted warehouse must belong to the store company.")
            if row.warehouse in seen:
                fail("validation_failed", "A warehouse is listed twice.")
            seen.add(row.warehouse)
        seen = set()
        for row in self.get("profiles") or []:
            company = frappe.db.get_value("POS Profile", row.pos_profile, "company")
            if not company or company != self.company:
                fail("validation_failed", "Every permitted POS Profile must belong to the store company.")
            if row.pos_profile in seen:
                fail("validation_failed", "A POS Profile is listed twice.")
            seen.add(row.pos_profile)
        if self.storefront_sucursal:
            # Optional explicit channel link; Doco is not a POS requirement.
            if not frappe.db.table_exists("Storefront Sucursal") or not frappe.db.exists(
                    "Storefront Sucursal", self.storefront_sucursal):
                fail("validation_failed", "The linked storefront branch does not exist on this site.")

    def on_trash(self):
        if self.has_activity or frappe.db.exists("POS Register", {"store": self.name}):
            frappe.throw(_("Stores with registers or activity are retired, not deleted."))


def drawer_conflicts(account, company, register_name=None) -> list[str]:
    """Why ``account`` cannot be an exclusive drawer route (empty = free).

    Refuses sharing with another register, any safe/transit/bank/variance
    account, the company default cash account, any Mode of Payment default
    account (legacy profile drawers post there) and any profile back-office
    or default-source account.
    """
    reasons = []
    other = frappe.db.get_value("POS Register", {"drawer_route_key": f"{company}::{account}",
                                                "name": ["!=", register_name or ""]}, "name")
    if other:
        reasons.append("another_register")
    for field in ("safe_account", "transit_account", "bank_account", "variance_account"):
        if frappe.db.exists("POS Cash Safe", {field: account}):
            reasons.append("safe")
            break
    if frappe.db.get_value("Company", company, "default_cash_account") == account:
        reasons.append("company_default_cash")
    if frappe.db.exists("Mode of Payment Account", {"default_account": account, "company": company}):
        reasons.append("mode_of_payment_default")
    for field in ("posa_back_office_cash_account", "posa_default_source_account"):
        if frappe.db.has_column("POS Profile", field) and frappe.db.exists("POS Profile", {field: account}):
            reasons.append("profile_route")
            break
    return reasons


def drawer_valid(account, company) -> bool:
    row = frappe.db.get_value("Account", account, ["company", "is_group", "disabled", "account_type",
                                                    "account_currency"], as_dict=True)
    currency = frappe.get_cached_value("Company", company, "default_currency")
    return bool(row and row.company == company and not row.is_group and not row.disabled
                and row.account_type == "Cash" and row.account_currency == currency)


def register_is_open(name) -> bool:
    if not name or not frappe.db.exists("POS Register Runtime", name):
        return False
    return bool(frappe.db.get_value("POS Register Runtime", name, "active_opening_shift"))


class RegisterDocument(Document):
    def validate(self):
        previous = self.get_doc_before_save()
        with rules():
            self.register_code = normalize_code(self.register_code)
            self.label = normalize_label(self.label)
        if self.mode not in MODES:
            fail("validation_failed", "Choose Cash or Cashless.")
        store = frappe.db.get_value("POS Store", self.store, ["name", "company", "status"], as_dict=True)
        if not store:
            fail("validation_failed", "Choose an existing store.")
        if previous and (previous.store != self.store or previous.register_code != self.register_code) and (
                previous.has_activity or self.has_activity):
            fail("invalid_state", "Store and register code cannot change after financial activity.")
        self.company = store.company
        profile_company = frappe.db.get_value("POS Profile", self.pos_profile, "company")
        if profile_company != self.company:
            fail("validation_failed", "The POS Profile must belong to the store company.")
        if previous and previous.lifecycle != self.lifecycle and not _service():
            fail("invalid_state", "Change the register lifecycle from the Cajas workspace.")
        if not previous and not _service():
            self.lifecycle = "Draft"
            self.has_activity = 0
            self.legacy_profile_route = 0
            self.pending_configuration = None
        if previous and not _service():
            for field in ("legacy_profile_route", "route_change_approved_by", "route_change_reason",
                          "pending_configuration", "has_activity", "configuration_revision",
                          "hardware_profile_revision"):
                if previous.get(field) != self.get(field):
                    fail("invalid_state", "This field is maintained by register actions.")
        if self.mode == "Cashless":
            self.drawer_account = None
            self.default_safe = None
        if previous and any(previous.get(f) != self.get(f) for f in ROUTING_FIELDS) and register_is_open(self.name):
            # FND-05: an open shift keeps its stamped route. Stage the edit as
            # the pending configuration, effective at the next opening.
            pending = {f: self.get(f) for f in ROUTING_FIELDS}
            self.pending_configuration = json.dumps(pending, sort_keys=True)
            for field in ROUTING_FIELDS:
                self.set(field, previous.get(field))
            frappe.msgprint(_("This caja has an open shift. The routing change applies at its next opening."))
        elif previous and any(previous.get(f) != self.get(f) for f in ROUTING_FIELDS):
            self.configuration_revision = int(previous.configuration_revision or 1) + 1
        self._validate_routing()
        if previous:
            self.revision = int(previous.revision or 1) + 1
        else:
            self.revision = 1
        self.register_key = f"{self.store}::{self.register_code}"
        self.drawer_route_key = (f"{self.company}::{self.drawer_account}"
                                 if self.mode == "Cash" and self.drawer_account and self.lifecycle != "Retired"
                                 else None)

    def _validate_routing(self):
        if self.mode != "Cash" or not self.drawer_account:
            return
        if not drawer_valid(self.drawer_account, self.company):
            fail("validation_failed", "The drawer account must be an active, non-group cash ledger in the company currency.")
        conflicts = drawer_conflicts(self.drawer_account, self.company, self.name)
        if conflicts and not (self.legacy_profile_route and conflicts == ["mode_of_payment_default"]):
            fail("validation_failed", "This cash account is already used by another drawer, safe or payment method ({0}). Each caja needs its own drawer account.",
                 args=(", ".join(conflicts),))
        if self.default_safe:
            safe_company = frappe.db.get_value("POS Cash Safe", self.default_safe, "company")
            if safe_company != self.company:
                fail("validation_failed", "The default safe belongs to another company.")

    def on_trash(self):
        if self.has_activity or frappe.db.exists("POS Opening Shift", {"posa_register": self.name}):
            frappe.throw(_("Registers with history are retired, not deleted."))
        if not _service() and "System Manager" not in frappe.get_roles():
            frappe.throw(_("Only an administrator can delete an unused draft register."), frappe.PermissionError)


GRANTABLE_BY_SUPERVISOR = {"Cashier", "Order taker", "Safe custodian"}


class AssignmentDocument(Document):
    def validate(self):
        from .scope import is_admin, store_capabilities

        previous = self.get_doc_before_save()
        if self.bundle not in BUNDLES:
            fail("validation_failed", "Choose a capability bundle.")
        if self.scope_type not in SCOPE_TYPES:
            fail("validation_failed", "Choose store or company scope.")
        if self.scope_type == "Store":
            company = frappe.db.get_value("POS Store", self.store, "company")
            if not company:
                fail("validation_failed", "Choose an existing store.")
            self.company = company
        else:
            self.store = None
            if not frappe.db.exists("Company", self.company):
                fail("validation_failed", "Choose an existing company.")
        if self.valid_from and self.valid_to and str(self.valid_to) <= str(self.valid_from):
            fail("validation_failed", "The grant must end after it starts.")
        with rules():
            self.reason = normalize_reason(self.reason, required=False)
        actor = frappe.session.user
        if not is_admin(actor):
            if self.scope_type != "Store" or self.bundle not in GRANTABLE_BY_SUPERVISOR:
                fail("scope_denied", "Only an administrator can grant this capability.")
            if "assign" not in store_capabilities(actor, self.store, self.company):
                fail("scope_denied", "You cannot assign people to this store.")
            if self.user == actor:
                fail("scope_denied", "Ask another supervisor to change your own access.")
        if not previous:
            self.granted_by = actor
            self.revision = 1
        else:
            for field in ("user", "bundle", "scope_type", "store", "company"):
                if previous.get(field) != self.get(field):
                    fail("invalid_state", "Revoke this grant and create a new one instead of changing its scope.")
            self.revision = int(previous.revision or 1) + 1
        target = self.store if self.scope_type == "Store" else self.company
        self.assignment_key = (f"{self.user}::{self.scope_type}::{target}::{self.bundle}"
                               if int(self.enabled or 0) else None)

    def on_update(self):
        from .scope import clear_cache
        clear_cache()

    def on_trash(self):
        frappe.throw(_("Disable the grant instead; grant history is retained."), frappe.PermissionError)
