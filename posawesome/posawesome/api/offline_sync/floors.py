"""Offline catalog pull for POS Floor.

Floors and tables are catalog, not ledger: a tablet that loses the network
mid-service must still render the board. Follows the shipped resource shape —
explicit field list (never ``["*"]``), server-resolved profile scope, delta by
the ``modified`` watermark with an overlap window, and a schema-version gate
that forces a full resync when the field list changes (spec §6.8).
"""

import frappe

from posawesome.posawesome.api.restaurant._tickets import assert_tables_capability
from posawesome.posawesome.api.offline_sync.common import (
    _build_response,
    _max_timestamp,
    _resolve_profile,
    _watermark_floor,
)

SYNC_SCHEMA_VERSION = "2026-08-12"

FLOOR_FIELDS = [
    "name",
    "floor_uid",
    "floor_name",
    "company",
    "pos_profile",
    "sequence",
    "is_active",
    "layout",
    "modified",
]


def _coerce_limit(value, default=200, maximum=2000):
    try:
        resolved = int(value or default)
    except (TypeError, ValueError):
        resolved = default
    return max(1, min(resolved, maximum))


def _visible(row, pos_profile):
    """A floor with a blank pos_profile serves every register of the company.

    Filtered in Python because a SQL ``IN ('profile', '')`` never matches
    NULL, which would silently hide exactly those shared floors.
    """
    return not row.get("pos_profile") or row.get("pos_profile") == pos_profile


@frappe.whitelist(methods=["GET", "POST"])
def sync_floors(pos_profile=None, watermark=None, start_after=None, limit=200, schema_version=None):
    if schema_version and schema_version != SYNC_SCHEMA_VERSION:
        return _build_response(full_resync_required=True)

    profile = _resolve_profile(pos_profile)
    if not profile:
        frappe.throw("pos_profile is required")

    profile_name = profile.get("name")
    assert_tables_capability(profile_name)
    company = profile.get("company")
    resolved_limit = _coerce_limit(limit)
    fetch_limit = resolved_limit + 1

    filters = {"company": company}
    query_watermark = _watermark_floor(watermark)
    if query_watermark:
        filters["modified"] = [">", query_watermark]
    if start_after:
        filters["name"] = [">", start_after]

    rows = (
        frappe.get_all(
            "POS Floor",
            filters=filters,
            fields=FLOOR_FIELDS,
            order_by="name asc",
            limit_page_length=fetch_limit,
        )
        or []
    )
    rows = [row for row in rows if _visible(row, profile_name)]

    has_more = len(rows) > resolved_limit
    rows = rows[:resolved_limit]

    # A deactivated floor is a delete to the client cache — the record stays
    # on the server for reporting (spec §6.4), it just leaves the board.
    changes = [
        {"key": f"pos_floor::{row['name']}", "modified": row.get("modified"), "data": row}
        for row in rows
        if row.get("is_active")
    ]
    deleted = [{"key": f"pos_floor::{row['name']}"} for row in rows if not row.get("is_active")]

    next_watermark = _max_timestamp(watermark, [row.get("modified") for row in rows])
    return _build_response(
        changes=changes,
        deleted=deleted,
        next_watermark=next_watermark,
        has_more=has_more,
    )
