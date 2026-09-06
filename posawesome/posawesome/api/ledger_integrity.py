"""Server-only authority for durable financial request records."""

from contextlib import contextmanager
from contextvars import ContextVar

import frappe
from frappe import _

_ledger_writer = ContextVar("posa_internal_ledger_writer", default=False)


@contextmanager
def internal_ledger_write():
    """Called only around internal writers, never inferred from document flags."""
    token = _ledger_writer.set(True)
    try:
        yield
    finally:
        _ledger_writer.reset(token)


def assert_internal_ledger_write():
    if not _ledger_writer.get():
        frappe.throw(
            _("Financial request records can only be changed by the POS transaction processor."),
            frappe.PermissionError,
        )
