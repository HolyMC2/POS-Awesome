"""Multi-tenant scope assertions for POSAwesome write endpoints.

Spec: REVIEW2/03_security.md §2.3 — "Required pattern (mandatory before SaaS)".

This module is the canonical scope-validation surface. Every whitelisted
write endpoint that accepts ``company``, ``pos_profile``, or ``customer``
from the client must call the matching ``assert_*`` before doing anything
that touches the DB. Failing the assertion raises
``frappe.PermissionError`` with a translated message.

Callers that need the lighter ``assert_pos_profile_write_allowed`` (action
flag + company match against a profile they already have) should keep
using ``api.utils``. This module is for **session-user vs requested
target** checks, not for profile-internal action flags.

Design notes:

* Per-request cache via ``frappe.local`` — ``get_allowed_*`` may be hit
  several times per request (top of endpoint + per-line in helpers). We
  do NOT use ``functools.cache`` because session user can change inside
  background jobs that re-set the user.
* Guest users always raise — no exception, no fallback.
* System Manager bypasses all assertions (treated as superuser).
"""

from __future__ import annotations

from typing import Iterable

import frappe
from frappe import _


# ---------------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------------

_SUPER_ROLES = ("System Manager",)
_CACHE_NS = "_posa_scope_cache"


def _is_guest(user: str | None) -> bool:
    return not user or user == "Guest"


def _is_super(user: str) -> bool:
    """System Managers bypass scope assertions.

    Note: a Sales Manager / POS Manager DOES NOT bypass — those are
    workflow roles, not security overrides. Only System Manager is
    treated as superuser here because that's Frappe's own escalation
    contract (matches `frappe.has_permission` `ignore_share` behavior).
    """
    if not user:
        return False
    user_roles = frappe.get_roles(user)
    return any(role in user_roles for role in _SUPER_ROLES)


def _cache() -> dict:
    """Per-request memoization bucket.

    ``frappe.local`` is reset on every request, so the bucket vanishes
    between calls without us having to expire entries manually.
    """
    bucket = getattr(frappe.local, _CACHE_NS, None)
    if bucket is None:
        bucket = {}
        setattr(frappe.local, _CACHE_NS, bucket)
    return bucket


def _resolve_user(user: str | None) -> str:
    return user or getattr(frappe.session, "user", None) or "Guest"


# ---------------------------------------------------------------------------
# scope readers
# ---------------------------------------------------------------------------


def get_allowed_pos_profiles(user: str | None = None) -> set[str]:
    """POS Profiles the user is assigned to via the POS Profile User child."""

    user = _resolve_user(user)
    if _is_guest(user):
        return set()

    cache = _cache()
    key = ("profiles", user)
    if key in cache:
        return cache[key]

    rows = frappe.get_all(
        "POS Profile User",
        filters={"user": user},
        fields=["parent"],
        ignore_permissions=True,
    )
    profiles = {row["parent"] for row in rows if row.get("parent")}
    cache[key] = profiles
    return profiles


def get_allowed_companies(user: str | None = None) -> set[str]:
    """Companies derivable from the user's POS Profile assignments.

    We deliberately do NOT consult the Frappe User Permission table here.
    POSAwesome scope is profile-centric; if a user has no POS Profile
    membership granting access to a company, they cannot write POS data
    for that company even if a generic User Permission lets them read
    Customer/Item docs in it.
    """

    user = _resolve_user(user)
    if _is_guest(user):
        return set()

    cache = _cache()
    key = ("companies", user)
    if key in cache:
        return cache[key]

    profiles = get_allowed_profiles_companies_map(user)
    companies = {c for c in profiles.values() if c}
    cache[key] = companies
    return companies


def get_allowed_profiles_companies_map(user: str | None = None) -> dict[str, str]:
    """Return ``{profile_name: company}`` for the user's POS Profile memberships.

    Single round trip via JOIN — faster than calling get_doc on every
    profile when the user has 5+ memberships.
    """

    user = _resolve_user(user)
    if _is_guest(user):
        return {}

    cache = _cache()
    key = ("profile_company_map", user)
    if key in cache:
        return cache[key]

    rows = frappe.db.sql(
        """
        SELECT ppu.parent AS profile, pp.company AS company
        FROM `tabPOS Profile User` ppu
        INNER JOIN `tabPOS Profile` pp ON pp.name = ppu.parent
        WHERE ppu.user = %(user)s AND pp.disabled = 0
        """,
        {"user": user},
        as_dict=True,
    )
    mapping = {row["profile"]: row["company"] for row in rows if row.get("profile")}
    cache[key] = mapping
    return mapping


def _get_profile_customer_groups(pos_profile: str) -> set[str]:
    """Return the resolved customer-group set for a POS Profile.

    Includes the descendants of any 'group' (parent) entries — POSAwesome
    UI lets you assign a parent Customer Group and treats every descendant
    as in-scope.
    """

    cache = _cache()
    key = ("profile_customer_groups", pos_profile)
    if key in cache:
        return cache[key]

    rows = frappe.get_all(
        "POS Customer Group",
        filters={"parent": pos_profile},
        fields=["customer_group"],
        ignore_permissions=True,
    )
    direct = {row["customer_group"] for row in rows if row.get("customer_group")}
    if not direct:
        # Empty configuration means "all customer groups" by POSAwesome
        # convention — same behavior as `get_all_customer_groups` callers.
        cache[key] = set()
        return set()

    resolved: set[str] = set()
    for group in direct:
        resolved.add(group)
        try:
            descendants = frappe.db.get_descendants("Customer Group", group) or []
        except Exception:
            descendants = []
        resolved.update(descendants)

    cache[key] = resolved
    return resolved


# ---------------------------------------------------------------------------
# public asserts — call these at the top of write endpoints
# ---------------------------------------------------------------------------


def assert_company(user: str | None, company: str | None) -> None:
    """Raise PermissionError if ``user`` cannot write for ``company``."""

    user = _resolve_user(user)
    if _is_guest(user):
        frappe.throw(_("Guest users are not allowed to perform POS write actions."), frappe.PermissionError)

    if not company:
        # No company supplied = caller will derive from profile downstream.
        # The matching assert_profile call enforces tenant boundary.
        return

    if _is_super(user):
        return

    if company not in get_allowed_companies(user):
        frappe.throw(_("Not permitted for company {0}.").format(company), frappe.PermissionError)


def assert_profile(user: str | None, pos_profile: str | None) -> None:
    """Raise PermissionError if ``user`` is not assigned to ``pos_profile``."""

    user = _resolve_user(user)
    if _is_guest(user):
        frappe.throw(_("Guest users are not allowed to perform POS write actions."), frappe.PermissionError)

    if not pos_profile:
        frappe.throw(_("POS Profile is required for this action."), frappe.PermissionError)

    if _is_super(user):
        return

    if pos_profile not in get_allowed_pos_profiles(user):
        frappe.throw(
            _("Not permitted for POS profile {0}.").format(pos_profile),
            frappe.PermissionError,
        )


def assert_customer_in_profile(
    user: str | None,
    customer: str | None,
    pos_profile: str | None,
) -> None:
    """Raise PermissionError when ``customer`` is outside ``pos_profile``'s scope.

    Resolution rules:
      * ``customer`` falsy → no-op (downstream walk-in / blank flow)
      * Profile with no Customer Group rows → unrestricted (legacy)
      * Customer's ``customer_group`` (or any ancestor) in profile's
        resolved group set → allowed
      * else → PermissionError
    """

    user = _resolve_user(user)
    if _is_guest(user):
        frappe.throw(_("Guest users are not allowed to perform POS write actions."), frappe.PermissionError)

    if not customer:
        return

    if _is_super(user):
        return

    if not pos_profile:
        frappe.throw(_("POS Profile is required to scope customer {0}.").format(customer), frappe.PermissionError)
        return  # frappe.throw doesn't narrow; satisfy static analysis.

    allowed_groups = _get_profile_customer_groups(pos_profile)
    if not allowed_groups:
        # Legacy profile with no group restriction — treat as unrestricted.
        # (Matches existing `get_customers_groups` callers which fall back
        # to all groups when the child table is empty.)
        return

    customer_group = frappe.db.get_value("Customer", customer, "customer_group")
    if not customer_group:
        frappe.throw(
            _("Customer {0} has no customer group; cannot validate POS scope.").format(customer),
            frappe.PermissionError,
        )

    if customer_group in allowed_groups:
        return

    frappe.throw(
        _("Customer {0} is not within POS Profile {1}'s customer group scope.").format(
            customer, pos_profile
        ),
        frappe.PermissionError,
    )


# ---------------------------------------------------------------------------
# bulk variants — small endpoints calling N-times benefit from one pass
# ---------------------------------------------------------------------------


def assert_customers_in_profile(
    user: str | None,
    customers: Iterable[str],
    pos_profile: str | None,
) -> None:
    """Validate a sequence of customer names in one cache-warm pass."""

    seen: set[str] = set()
    for customer in customers or []:
        if not customer or customer in seen:
            continue
        seen.add(customer)
        assert_customer_in_profile(user, customer, pos_profile)
