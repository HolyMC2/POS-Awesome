"""Offline catalog pull for POS Table.

Scoped through the floors the register can see, so a tablet never caches
another company's board. `occupied` rides along as the reconciled hint — the
open-order count is still the truth, and the client re-derives it from the
floor snapshot the moment it is back online (spec §0.2, §6.8).
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

TABLE_FIELDS = [
    "name",
    "table_uid",
    "table_label",
    "floor",
    "seats",
    "is_active",
    "layout",
    "occupied",
    "needs_cleaning",
    "bill_printed_at",
    "modified",
]


def _coerce_limit(value, default=200, maximum=2000):
    try:
        resolved = int(value or default)
    except (TypeError, ValueError):
        resolved = default
    return max(1, min(resolved, maximum))


def _scoped_floors(profile):
    """Active floor names this register renders (company-wide floors included)."""
    rows = (
        frappe.get_all(
            "POS Floor",
            filters={"company": profile.get("company")},
            fields=["name", "pos_profile", "is_active"],
        )
        or []
    )
    profile_name = profile.get("name")
    return [
        row["name"]
        for row in rows
        if row.get("is_active") and (not row.get("pos_profile") or row["pos_profile"] == profile_name)
    ]


@frappe.whitelist(methods=["GET", "POST"])
def sync_tables(pos_profile=None, watermark=None, start_after=None, limit=200, schema_version=None):
    if schema_version and schema_version != SYNC_SCHEMA_VERSION:
        return _build_response(full_resync_required=True)

    profile = _resolve_profile(pos_profile)
    if not profile:
        frappe.throw("pos_profile is required")

    assert_tables_capability(profile.get("name"))
    floors = _scoped_floors(profile)
    if not floors:
        return _build_response(next_watermark=watermark)

    resolved_limit = _coerce_limit(limit)
    fetch_limit = resolved_limit + 1

    filters = {"floor": ["in", floors]}
    query_watermark = _watermark_floor(watermark)
    if query_watermark:
        filters["modified"] = [">", query_watermark]
    if start_after:
        filters["name"] = [">", start_after]

    rows = (
        frappe.get_all(
            "POS Table",
            filters=filters,
            fields=TABLE_FIELDS,
            order_by="name asc",
            limit_page_length=fetch_limit,
        )
        or []
    )

    has_more = len(rows) > resolved_limit
    rows = rows[:resolved_limit]

    changes = [
        {"key": f"pos_table::{row['name']}", "modified": row.get("modified"), "data": row}
        for row in rows
        if row.get("is_active")
    ]
    deleted = [{"key": f"pos_table::{row['name']}"} for row in rows if not row.get("is_active")]

    next_watermark = _max_timestamp(watermark, [row.get("modified") for row in rows])
    return _build_response(
        changes=changes,
        deleted=deleted,
        next_watermark=next_watermark,
        has_more=has_more,
    )
