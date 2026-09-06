import frappe

from posawesome.posawesome.api.customers import (
    get_customer_groups,
    get_customer_names,
)
from posawesome.posawesome.api.offline_sync.common import (
    _build_response,
    _max_timestamp,
    _normalize_timestamp,
    _resolve_profile,
    _watermark_floor,
    _page_window, _page_scope, _changed_keys, _paged_response,
)

SYNC_SCHEMA_VERSION = "2026-08-12"


def _coerce_limit(value, default=200, maximum=2000):
    try:
        resolved = int(value or default)
    except (TypeError, ValueError):
        resolved = default
    return max(1, min(resolved, maximum))


def _collect_deleted_customers(profile, watermark, limit):
    if not watermark:
        return []

    rows = (
        frappe.get_all(
            "Customer",
            filters={"modified": [">", watermark]},
            fields=["name", "modified", "disabled", "customer_group"],
            order_by="name asc",
            limit_page_length=limit,
        )
        or []
    )
    allowed_groups = set(get_customer_groups(profile) or [])

    return [
        {
            "key": f"customer::{row.get('name')}",
            "modified": row.get("modified"),
        }
        for row in rows
        if row.get("name")
        and (row.get("disabled") or (allowed_groups and row.get("customer_group") not in allowed_groups))
    ]


@frappe.whitelist(methods=["GET", "POST"])
def sync_customers(
    pos_profile=None,
    watermark=None,
    start_after=None,
    limit=200,
    schema_version=None,
    paginated=0,
    page_cursor=None,
):
    if schema_version and schema_version != SYNC_SCHEMA_VERSION:
        return _build_response(full_resync_required=True)

    profile = _resolve_profile(pos_profile)
    if not profile:
        frappe.throw("pos_profile is required")

    if str(paginated) == "1" or page_cursor:
        return _sync_customers_page(profile, watermark, page_cursor, limit)

    resolved_limit = _coerce_limit(limit)
    fetch_limit = resolved_limit + 1
    # frappe.as_json, not json.dumps: the server-resolved profile is a
    # doc.as_dict() carrying raw datetime objects (json.dumps raises).
    serialized_profile = frappe.as_json(profile)
    # Overlap window on the query watermark (boundary-commit safety);
    # next_watermark still advances from the original watermark.
    query_watermark = _watermark_floor(watermark)
    rows = (
        get_customer_names(
            serialized_profile,
            limit=fetch_limit,
            start_after=start_after,
            modified_after=query_watermark,
        )
        or []
    )

    has_more = len(rows) > resolved_limit
    rows = rows[:resolved_limit]

    changes = [
        {
            "key": f"customer::{row.get('name')}",
            "modified": row.get("modified"),
            "data": row,
        }
        for row in rows
        if row.get("name")
    ]

    deleted_rows = _collect_deleted_customers(profile, query_watermark, fetch_limit)
    deleted = [{"key": row["key"]} for row in deleted_rows]
    next_watermark = _max_timestamp(
        watermark,
        [row.get("modified") for row in rows],
        [row.get("modified") for row in deleted_rows],
    )
    return _build_response(
        changes=changes,
        deleted=deleted,
        next_watermark=next_watermark,
        has_more=has_more,
    )


def _sync_customers_page(profile, watermark, cursor, limit):
    limit = _coerce_limit(limit)
    window = _page_window(watermark, cursor, _page_scope("customers", profile))
    candidates = _changed_keys("Customer", "name", window, limit + 1)
    keys = [row["name"] for row in candidates]
    page_keys = keys[:limit]
    filters = {"name": ["in", page_keys], "disabled": 0}
    groups = get_customer_groups(profile)
    if groups:
        filters["customer_group"] = ["in", groups]
    rows = frappe.get_all(
        "Customer", filters=filters,
        fields=["name", "modified", "mobile_no", "email_id", "tax_id", "customer_name", "primary_address"],
        limit_page_length=limit,
    ) if page_keys else []
    found = {row["name"] for row in rows}
    return _paged_response(
        window, keys, limit,
        [{"key": f"customer::{row['name']}", "modified": row.get("modified"), "data": row} for row in rows],
        [{"key": f"customer::{key}"} for key in page_keys if key not in found],
    )
