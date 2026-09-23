"""Typed command errors (spec 01 §6): code, retryability, correlation, next actions."""

from __future__ import annotations

import uuid
from contextlib import contextmanager

import frappe
from frappe import _

from .model import RuleError

RETRYABLE = {"revision_conflict", "dependency_unavailable", "rate_limited", "outcome_unknown"}
_EXC = {
    "scope_denied": frappe.PermissionError,
    "ownership_changed": frappe.PermissionError,
}


def correlation_id() -> str:
    value = getattr(frappe.local, "posa_correlation_id", None)
    if not value:
        value = uuid.uuid4().hex
        frappe.local.posa_correlation_id = value
    return value


def fail(code: str, message: str, next_actions=None):
    """Raise with a machine-readable envelope the SPA can act on."""
    try:
        frappe.local.response["posa_error"] = {
            "code": code, "retryable": code in RETRYABLE,
            "correlation_id": correlation_id(), "next_actions": list(next_actions or []),
        }
    except Exception:
        pass
    frappe.throw(_(message), _EXC.get(code, frappe.ValidationError), title=code)


def denied(message="This record is unavailable or outside your access."):
    # One message for missing and forbidden records: no existence leak.
    fail("scope_denied", message)


@contextmanager
def rules():
    """Translate pure-rule failures into the command envelope."""
    try:
        yield
    except RuleError as exc:
        fail(exc.code, str(exc))
