"""Trusted boundaries shared by POS collection and reconciliation."""

import math

import frappe
from frappe import _
from frappe.utils import cint

from posawesome.posawesome.api._scope import (
    assert_company,
    assert_customer_in_profile,
    assert_profile,
    get_allowed_pos_profiles,
)


def payment_amount(value, *, allow_zero=False):
    """Reject malformed money instead of coercing it to zero or using abs()."""
    try:
        amount = float(value)
    except (ValueError, TypeError, OverflowError):
        amount = float("nan")
    if isinstance(value, bool) or not math.isfinite(amount) or amount < 0 or (amount == 0 and not allow_zero):
        frappe.throw(_("Payment amount must be a finite positive number."))
    return amount


def lock_payment_party(party_type, party):
    """Hold the shared collection/refund lock until the request commits."""
    if party_type not in ("Customer", "Supplier"):
        frappe.throw(_("Only customer and supplier payments are supported."))
    frappe.has_permission(party_type, "read", party, throw=True)
    if not frappe.db.get_value(party_type, party, "name", for_update=True):
        frappe.throw(_("Payment party was not found."))


def authorize_payment_access(company, party_type, party, pos_profile=None, *, reconcile=False):
    """Legacy callers may omit a filter, but must have an eligible register."""
    if party_type not in ("Customer", "Supplier"):
        frappe.throw(_("Only customer and supplier payments are supported."))
    user = frappe.session.user
    assert_company(user, company)
    # System Managers can reconcile across the company without a POS filter.
    if not pos_profile and "System Manager" in frappe.get_roles(user):
        frappe.has_permission(party_type, "read", party, throw=True)
        return
    candidates = [pos_profile] if pos_profile else sorted(get_allowed_pos_profiles(user))
    for name in candidates:
        assert_profile(user, name)
        profile = frappe.get_cached_doc("POS Profile", name)
        if profile.company != company or cint(profile.get("disabled")):
            continue
        if reconcile and not (cint(profile.get("posa_use_pos_awesome_payments")) and cint(profile.get("posa_allow_reconcile_payments"))):
            continue
        if party_type == "Customer":
            try:
                assert_customer_in_profile(user, party, name)
            except frappe.PermissionError:
                if pos_profile:
                    raise
                continue
        frappe.has_permission(party_type, "read", party, throw=True)
        return
    message = _("Payment reconciliation is not enabled for an authorized POS Profile.") if reconcile else _("Not permitted to access payments for this party and company.")
    frappe.throw(message, frappe.PermissionError)


def authorize_reconciliation(company, party_type, party, pos_profile=None):
    authorize_payment_access(company, party_type, party, pos_profile, reconcile=True)


def run_reconciliation(callback, *args):
    """ERPNext sets this flag before ledger work and may raise before clearing it."""
    previous = getattr(frappe.flags, "ignore_party_validation", False)
    try:
        return callback(*args)
    finally:
        frappe.flags.ignore_party_validation = previous


def retry_before_financial_writes(callback, *args):
    """Refresh only a read-only snapshot rejected while waiting for a row lock.

    MariaDB snapshot isolation can raise 1020 on a current read after another
    cashier commits. Never discard a caller's writes or restart a payment that
    already ran a mutation or an external operation.
    """
    can_retry = getattr(frappe.db, "transaction_writes", None) == 0
    for attempt in range(3):
        try:
            return callback(*args)
        except Exception as error:
            retry_type = getattr(frappe, "QueryDeadlockError", ())
            if not (
                can_retry and attempt < 2 and isinstance(error, retry_type)
                and getattr(frappe.db, "transaction_writes", None) == 0
            ):
                raise
            frappe.db.rollback()
