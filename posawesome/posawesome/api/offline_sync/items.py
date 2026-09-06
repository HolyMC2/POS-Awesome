import json

import frappe

from posawesome.posawesome.api.items import get_delta_items, get_items
from posawesome.posawesome.api.offline_sync.common import (
    _build_response,
    _max_timestamp,
    _normalize_timestamp,
    _resolve_profile,
    _watermark_floor,
    _page_window, _page_scope, _changed_keys, _paged_response, _profile_warehouses,
)
from posawesome.posawesome.api.utils import (
    expand_item_groups,
    get_item_groups,
)

SYNC_SCHEMA_VERSION = "2026-08-12"


def _coerce_limit(value, default=200, maximum=2000):
    try:
        resolved = int(value or default)
    except (TypeError, ValueError):
        resolved = default
    return max(1, min(resolved, maximum))


def _get_allowed_item_groups(profile):
    try:
        return expand_item_groups(get_item_groups(profile.get("name")) or [])
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"POS Awesome: failed to resolve offline-sync item groups for profile {profile.get('name') if isinstance(profile, dict) else ''}",
        )
        return []


def _is_item_allowed(item_row, allowed_groups):
    if item_row.get("disabled"):
        return False
    if not item_row.get("is_sales_item", 0):
        return False
    if item_row.get("is_fixed_asset"):
        return False
    if allowed_groups and item_row.get("item_group") not in allowed_groups:
        return False
    return True


def _collect_deleted_items(profile, watermark, limit):
    if not watermark:
        return []

    rows = (
        frappe.get_all(
            "Item",
            filters={"modified": [">", watermark]},
            fields=[
                "item_code",
                "modified",
                "disabled",
                "is_sales_item",
                "is_fixed_asset",
                "item_group",
                "variant_of",
            ],
            order_by="item_code asc",
            limit_page_length=limit,
        )
        or []
    )

    allowed_groups = _get_allowed_item_groups(profile)
    return [
        {
            "key": f"item::{row.get('item_code')}",
            "modified": row.get("modified"),
        }
        for row in rows
        if row.get("item_code") and not _is_item_allowed(row, allowed_groups)
    ]


@frappe.whitelist(methods=["GET", "POST"])
def sync_items(
    pos_profile=None,
    watermark=None,
    price_list=None,
    customer=None,
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
        return _sync_items_page(profile, watermark, page_cursor, limit, price_list, customer)

    resolved_limit = _coerce_limit(limit)
    fetch_limit = resolved_limit + 1
    # frappe.as_json, not json.dumps: the server-resolved profile is a
    # doc.as_dict() carrying raw datetime objects (json.dumps raises).
    serialized_profile = frappe.as_json(profile)
    effective_price_list = price_list or profile.get("selling_price_list")

    # Overlap window on the query watermark (boundary-commit safety);
    # next_watermark still advances from the original watermark.
    query_watermark = _watermark_floor(watermark)
    if watermark:
        rows = (
            get_delta_items(
                serialized_profile,
                modified_after=query_watermark,
                price_list=effective_price_list,
                customer=customer,
                limit=fetch_limit,
            )
            or []
        )
    else:
        rows = (
            get_items(
                serialized_profile,
                price_list=effective_price_list,
                item_group="",
                search_value="",
                customer=customer,
                start_after=start_after,
                limit=fetch_limit,
            )
            or []
        )

    has_more = len(rows) > resolved_limit
    rows = rows[:resolved_limit]

    changes = [
        {
            "key": f"item::{row.get('item_code')}",
            "modified": row.get("modified"),
            "data": row,
        }
        for row in rows
        if row.get("item_code")
    ]

    deleted_rows = _collect_deleted_items(profile, query_watermark, fetch_limit)
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


def _sync_items_page(profile, watermark, cursor, limit, price_list, customer):
    from posawesome.posawesome.api.item_processing.search import _build_search_plan, _run_item_query

    limit = _coerce_limit(limit)
    price_list = price_list or profile.get("selling_price_list")
    window = _page_window(watermark, cursor, _page_scope("items", profile, price_list=price_list, customer=customer))
    # Union the next keys from EACH source. Limiting each source to N+1 is
    # sufficient to find the next N unique keys of the union, including price-
    # and stock-only edits whose Item.modified never changes.
    candidates = _changed_keys("Item", "item_code", window, limit + 1)
    if watermark:
        if price_list:
            candidates += _changed_keys("Item Price", "item_code", window, limit + 1, {"price_list": price_list})
        warehouses = _profile_warehouses(profile)
        if warehouses:
            candidates += _changed_keys("Bin", "item_code", window, limit + 1, {"warehouse": ["in", warehouses]})
    candidate_keys = list({row["item_code"] for row in candidates if row.get("item_code")})
    # Use the SAME database collation as each keyset predicate. Python's
    # Unicode sort can disagree on case/accents and skip codes at a boundary.
    ordered = frappe.get_all(
        "Item", filters={"item_code": ["in", candidate_keys]}, fields=["item_code", "name"],
        order_by="item_code asc", limit_page_length=limit + 1,
    ) if candidate_keys else []
    keys = [row["item_code"] for row in ordered]
    page_keys = keys[:limit]
    rows = []
    if page_keys:
        # Reuse the catalog's authority for profile filtering and row shaping
        # (barcodes, UOMs, tax, variants, price bands, stock and cost visibility).
        groups = expand_item_groups(get_item_groups(profile.get("name")) or [])
        # The shared shaper serializes its profile with json.dumps; a real
        # cached Frappe document contains datetime objects, unlike a client
        # JSON profile. Normalize through Frappe's serializer first.
        query_profile = json.loads(frappe.as_json(profile))
        plan = _build_search_plan(query_profile, "", "", limit, None, None, None, False, False, groups)
        # Add the page boundary independently. Replacing `item_code` would
        # discard the catalog's != PROPINA accounting-line exclusion.
        plan.filters["name"] = ["in", [row["name"] for row in ordered[:limit]]]
        rows = _run_item_query(query_profile, price_list, customer, plan)
    found = {row["item_code"] for row in rows}
    return _paged_response(
        window, keys, limit,
        [{"key": f"item::{row['item_code']}", "modified": row.get("modified"), "data": row} for row in rows],
        [{"key": f"item::{key}"} for key in page_keys if key not in found],
    )
