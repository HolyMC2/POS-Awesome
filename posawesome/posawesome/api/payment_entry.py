# Copyright (c) 2021, Youssef Restom and contributors
# For license information, please see license.txt

"""Compatibility facade for payment-entry APIs.

This module intentionally re-exports functions from `payment_processing/*`
to preserve stable dotted paths used by existing clients and hooks.
"""

import frappe
from posawesome.posawesome.api.payment_processing.creation import create_payment_entry
from posawesome.posawesome.api.payment_processing.utils import (
    get_bank_cash_account,
    set_paid_amount_and_received_amount,
    get_party_account,
)
from posawesome.posawesome.api.payment_processing.data import (
    get_outstanding_invoices,
    get_unallocated_payments,
    get_available_pos_profiles,
    get_unreconciled_entries,
)
from posawesome.posawesome.api.payment_processing.reconciliation import auto_reconcile_customer_invoices
from posawesome.posawesome.api.payment_processing.processor import process_pos_payment
from posawesome.posawesome.api.payment_processing.journal_entry import create_direct_journal_entry


# ----------------------------------------------------------------------
# Backward-compat path aliases. Some POSAwesome frontend chunks call
# `posawesome.posawesome.api.<old_module>.<func>` whose impl moved into
# subpackages. Direct `from ... import` aliases fail Frappe's whitelist
# check because the function's `__module__` no longer matches the URL
# path → 404. Local wrappers below carry their own @whitelist and
# delegate, filtering Frappe-injected kwargs (e.g. `cmd`) so impls
# without **kwargs don't TypeError.
# ----------------------------------------------------------------------


# methods=["POST"] only: this alias forwards to a MUTATING impl, and Frappe
# skips CSRF on GET (auth.py UNSAFE_HTTP_METHODS) — a GET door on a money write
# is an <img>/fetch CSRF vector with the operator's session (audit MONEY-F2).
@frappe.whitelist(methods=["POST"])
def auto_reconcile_customer_invoices(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.payment_processing.reconciliation.auto_reconcile_customer_invoices.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.payment_processing.reconciliation import auto_reconcile_customer_invoices as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_outstanding_invoices(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.payment_processing.data.get_outstanding_invoices.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.payment_processing.data import get_outstanding_invoices as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_unallocated_payments(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.payment_processing.data.get_unallocated_payments.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.payment_processing.data import get_unallocated_payments as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["POST"])
def process_pos_payment(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.payment_processing.processor.process_pos_payment.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.payment_processing.processor import process_pos_payment as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)
