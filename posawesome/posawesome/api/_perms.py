"""Context manager for ``frappe.flags.ignore_account_permission``.

Spec: REVIEW2/06_code_quality.md F2 — "without context manager /
cleanup" — 20 sites repo-wide leave the flag set across the request,
causing privilege bleed into subsequent statements in the same job.

Usage:

    from posawesome.posawesome.api._perms import account_perm_bypass

    with account_perm_bypass():
        pe.save()
        pe.submit()

After the ``with`` exits the flag is restored to its prior value
(typically ``False``) even if the body raised. This kills the bleed.

Why a flag-restorer, not a flag-clearer:
  Nested calls (e.g. submit_invoice → invoice hook → another helper
  with its own bypass block) should restore the OUTER value, not just
  clear. Saving + restoring is the contextmanager idiom.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import frappe


@contextmanager
def account_perm_bypass() -> Iterator[None]:
    """Set ``frappe.flags.ignore_account_permission`` True for the body.

    Restores the prior value on exit (success or exception).
    """
    flags = getattr(frappe, "flags", None)
    if flags is None:
        # Defensive: outside a Frappe request (e.g. unit tests) the
        # global flags namespace may be missing entirely.
        yield
        return

    previous = getattr(flags, "ignore_account_permission", False)
    flags.ignore_account_permission = True
    try:
        yield
    finally:
        flags.ignore_account_permission = previous


@contextmanager
def doc_account_perm_bypass(doc) -> Iterator[None]:
    """Per-doc variant — set ``doc.flags.ignore_account_permission``.

    Some Frappe paths read the flag from the document instance rather
    than the global frappe.flags (notably submit hooks that run in a
    new doc-scope). Use this when the existing code did
    ``doc.flags.ignore_account_permission = True`` directly.
    """
    flags = getattr(doc, "flags", None)
    if flags is None:
        yield
        return
    previous = getattr(flags, "ignore_account_permission", False)
    flags.ignore_account_permission = True
    try:
        yield
    finally:
        flags.ignore_account_permission = previous
