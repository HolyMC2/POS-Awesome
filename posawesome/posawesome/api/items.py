# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

"""Public item API facade.

Keep whitelisted paths in this module stable for clients and route heavy
implementation work to `posawesome.posawesome.api.item_processing` modules.
"""

import json
from frappe import _, as_json
import frappe
from frappe.utils import cint, get_datetime

from posawesome.posawesome.api.utils import get_active_pos_profile
from posawesome.posawesome.api.utils import (
    HAS_VARIANTS_EXCLUSION,
    expand_item_groups,
    get_item_groups,
    _ensure_pos_profile,
)
from posawesome.posawesome.api.item_processing.stock import (
    get_stock_availability,
    get_bulk_stock_availability,
    get_available_qty,
)
from posawesome.posawesome.api.item_processing.barcode import (
    parse_scale_barcode,
    get_items_from_barcode,
    build_scale_barcode,
    search_serial_or_batch_or_barcode_number,
)
from posawesome.posawesome.api.item_processing.details import (
    get_items_details,
    get_item_detail,
    get_item_variants,
    get_item_attributes,
    get_item_optional_attributes,
)
from posawesome.posawesome.api.item_processing.price import update_price_list_rate, get_price_for_uom
from posawesome.posawesome.api.item_processing.search import (
    get_items,
    get_items_groups,
    get_items_count,
    normalize_brand,
)


def _collect_delta_item_codes(pos_profile, modified_after, price_list, limit):
    """Collect changed item codes from Item Price and Bin updates."""
    changed_codes = set()
    timestamp = modified_after.isoformat()

    if price_list:
        price_codes = frappe.get_all(
            "Item Price",
            filters={
                "price_list": price_list,
                "modified": [">", timestamp],
            },
            pluck="item_code",
            limit_page_length=limit,
        )
        changed_codes.update([code for code in price_codes if code])

    warehouse = pos_profile.get("warehouse")
    if warehouse:
        warehouses = [warehouse]
        if frappe.db.get_value("Warehouse", warehouse, "is_group"):
            warehouses = frappe.db.get_descendants("Warehouse", warehouse) or []

        if warehouses:
            stock_codes = frappe.get_all(
                "Bin",
                filters={
                    "warehouse": ["in", warehouses],
                    "modified": [">", timestamp],
                },
                pluck="item_code",
                limit_page_length=limit,
            )
            changed_codes.update([code for code in stock_codes if code])

    return changed_codes


@frappe.whitelist(methods=["GET", "POST"])
def get_delta_items(
    pos_profile,
    modified_after=None,
    price_list=None,
    customer=None,
    limit=500,
):
    """Return only items changed since ``modified_after`` for price/stock updates."""
    profile, profile_json = _ensure_pos_profile(pos_profile)

    if not modified_after:
        return []

    try:
        parsed_modified_after = get_datetime(modified_after)
    except Exception:
        frappe.throw(_("modified_after must be a valid ISO datetime"))

    resolved_limit = cint(limit) or 500
    resolved_limit = max(1, min(resolved_limit, 2000))

    effective_price_list = price_list or profile.get("selling_price_list")
    base_items = (
        get_items(
            profile_json,
            price_list=effective_price_list,
            item_group="",
            search_value="",
            customer=customer,
            limit=resolved_limit,
            modified_after=parsed_modified_after.isoformat(),
        )
        or []
    )

    if len(base_items) >= resolved_limit:
        return base_items[:resolved_limit]

    existing_codes = {row.get("item_code") for row in base_items if row and row.get("item_code")}

    delta_codes = _collect_delta_item_codes(
        profile,
        parsed_modified_after,
        effective_price_list,
        resolved_limit,
    )
    extra_codes = [code for code in delta_codes if code not in existing_codes]

    if not extra_codes:
        return base_items

    allowed_groups = expand_item_groups(get_item_groups(profile.get("name")) or [])
    filters = {
        "item_code": ["in", extra_codes],
        "disabled": 0,
        "is_sales_item": 1,
        "is_fixed_asset": 0,
    }

    if allowed_groups:
        filters["item_group"] = ["in", allowed_groups]

    if not profile.get("posa_show_template_items"):
        filters.update(HAS_VARIANTS_EXCLUSION)

    if profile.get("posa_hide_variants_items"):
        filters["variant_of"] = ["is", "not set"]

    remaining = max(0, resolved_limit - len(base_items))
    if remaining <= 0:
        return base_items[:resolved_limit]

    fields = [
        "name",
        "item_code",
        "item_name",
        "stock_uom",
        "is_stock_item",
        "has_variants",
        "variant_of",
        "item_group",
        "idx",
        "has_batch_no",
        "has_serial_no",
        "max_discount",
        "brand",
        "allow_negative_stock",
    ]
    # saldo_enabled rides the catalog payload so the SPA can skip the
    # per-item saldo-meta HTTP round-trip on first add (audit: ~100-300ms
    # added to the first add of every distinct item). Custom field exists
    # only on doco tenants — guard for mumu/muelle installs.
    if frappe.db.has_column("Item", "saldo_enabled"):
        fields.append("saldo_enabled")

    item_rows = frappe.get_all(
        "Item",
        filters=filters,
        fields=fields,
        limit_page_length=remaining,
        order_by="item_name asc",
    )

    if not item_rows:
        return base_items[:resolved_limit]

    details = get_items_details(
        profile_json,
        as_json(item_rows),
        price_list=effective_price_list,
        customer=customer,
    )
    detail_map = {row.get("item_code"): row for row in (details or []) if row and row.get("item_code")}

    for item in item_rows:
        item_code = item.get("item_code")
        detail = detail_map.get(item_code, {})
        merged = {}
        merged.update(item)
        merged.update(detail)

        if (
            profile.get("posa_display_items_in_stock")
            and (not merged.get("actual_qty") or merged.get("actual_qty") < 0)
            and not merged.get("has_variants")
        ):
            continue

        base_items.append(merged)

    return base_items[:resolved_limit]


def build_item_cache(item_code):
    """Build item cache for faster access."""
    # Implementation for building item cache
    pass


@frappe.whitelist(methods=["GET", "POST"])
def get_item_brand(item_code):
    """Return normalized brand for an item, falling back to its template's brand."""
    if not item_code:
        return ""
    data = frappe.db.get_value("Item", item_code, ["brand", "variant_of"], as_dict=True)
    if not data:
        return ""
    brand = data.get("brand")
    if not brand and data.get("variant_of"):
        brand = frappe.db.get_value("Item", data.get("variant_of"), "brand")
    return normalize_brand(brand) if brand else ""


# ----------------------------------------------------------------------
# Backward-compat path aliases. Some POSAwesome frontend chunks call
# `posawesome.posawesome.api.<old_module>.<func>` whose impl moved into
# subpackages. Direct `from ... import` aliases fail Frappe's whitelist
# check because the function's `__module__` no longer matches the URL
# path → 404. Local wrappers below carry their own @whitelist and
# delegate, filtering Frappe-injected kwargs (e.g. `cmd`) so impls
# without **kwargs don't TypeError.
# ----------------------------------------------------------------------


@frappe.whitelist(methods=["GET", "POST"])
def build_scale_barcode(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.barcode.build_scale_barcode.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.barcode import build_scale_barcode as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_items_from_barcode(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.barcode.get_items_from_barcode.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.barcode import get_items_from_barcode as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def parse_scale_barcode(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.barcode.parse_scale_barcode.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.barcode import parse_scale_barcode as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def search_serial_or_batch_or_barcode_number(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.barcode.search_serial_or_batch_or_barcode_number.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.barcode import search_serial_or_batch_or_barcode_number as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_available_qty(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.stock.get_available_qty.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.stock import get_available_qty as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_item_detail(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.details.get_item_detail.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.details import get_item_detail as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_items_details(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.details.get_items_details.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.details import get_items_details as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_item_variants(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.details.get_item_variants.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.details import get_item_variants as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_items(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.search.get_items.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.search import get_items as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_items_groups(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.search.get_items_groups.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.search import get_items_groups as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_price_for_uom(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.price.get_price_for_uom.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.price import get_price_for_uom as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


# methods=["POST"] only: this alias forwards to a MUTATING impl, and Frappe
# skips CSRF on GET (auth.py UNSAFE_HTTP_METHODS) — a GET door on a money write
# is an <img>/fetch CSRF vector with the operator's session (audit MONEY-F2).
@frappe.whitelist(methods=["POST"])
def update_price_list_rate(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.item_processing.price.update_price_list_rate.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.item_processing.price import update_price_list_rate as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def search_items(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.purchase_orders.search_items.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.purchase_orders import search_items as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


def on_item_price_change(doc, method=None):
    """Touch the parent Item when one of its prices changes (live find 08-30).

    The register's offline catalog syncs by DELTA: it asks for items with
    `modified` after its high-water mark. An Item Price row is its own
    doctype — editing one never touches the Item — so a price change made
    after an item's last save reached NO register that already held the item
    cached. The demo cafetería surfaced the worst shape of this: rows cached
    with a broken rate could never heal, because the item itself never
    changed again. Bumping `modified` here folds every price edit into the
    delta stream the clients already poll; the ~60s sync then repairs any
    cached rate, stale or broken, with no rebuild.

    `update_modified=False` because the value IS the update — set_value
    would otherwise stamp its own now() twice. Best-effort: a price save
    must never fail on the cache-heal side effect.
    """
    item_code = getattr(doc, "item_code", None)
    if not item_code:
        return
    try:
        frappe.db.set_value(
            "Item", item_code, "modified", frappe.utils.now(), update_modified=False
        )
    except Exception:
        frappe.log_error(
            f"Failed to touch Item {item_code} after Item Price change",
            "Item Price cache heal",
        )
