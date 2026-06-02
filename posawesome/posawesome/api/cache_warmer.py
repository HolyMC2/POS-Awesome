# Copyright (c) 2026, HolyMC2 fork
# For license information, please see license.txt

"""Keep the POS item cache warm so operators never hit a cold catalog walk.

`get_items()` (item_processing/search.py) caches each catalog *page* in Redis
when a POS Profile has ``posa_use_server_cache`` on. TTL is
``posa_server_cache_duration`` minutes (30 on the doco profiles).

The SPA's non-reset background sync walks the catalog in keyset-paginated pages
(``start_after`` + ``limit``). The FIRST walk after the TTL lapses pays the full
cold cost; every walk after that is served from Redis. Measured on prod
(ventas.docomexico, 6455 items, 7 pages of 1000):

    cold non-reset:  2597 ms   (371 ms/page)
    warm non-reset:   488 ms   ( 70 ms/page)   -> 5.3x

This scheduled job re-walks each cache-enabled profile just under the TTL so the
live cache never goes cold between operator loads.

Scope (deliberate):
  * It pre-warms the SAME normalized cache key the SPA background sync produces:
    ``customer=None``, ``item_group=""``, ``search_value=""``, ``limit=page_size``,
    no images / no description, keyset cursor by ``item_name``. The key is the
    normalized scalar tuple inside ``__get_items``, not the raw profile JSON, so
    matching those args is sufficient.
  * It does NOT touch the reset / force-reload path. The SPA runs that with the
    server cache deliberately disabled (``posa_use_server_cache=0``) for data
    freshness, so there is nothing there to warm.
"""

import time

import frappe
from frappe.utils import cint

from posawesome.posawesome.api.item_processing.search import get_items

# Mirror the frontend BACKGROUND_SYNC_PAGE_SIZE default. resolvePageSize() returns
# this constant unless ``posa_use_limit_search`` is on (then ``posa_search_limit``).
DEFAULT_PAGE_SIZE = 1000

# Backstop against a pathological pagination loop (cursor that never advances).
MAX_PAGES = 200


def _page_size(profile: dict) -> int:
    """Effective page size the SPA would send for this profile."""
    if cint(profile.get("posa_use_limit_search")):
        limit = cint(profile.get("posa_search_limit"))
        if limit > 0:
            return limit
    return DEFAULT_PAGE_SIZE


def _warm_profile(profile: dict) -> dict:
    """Replay the SPA's keyset-paginated catalog walk to populate Redis."""
    price_list = profile.get("selling_price_list")
    page_size = _page_size(profile)
    profile_json = frappe.as_json(profile)

    started = time.perf_counter()
    pages = 0
    total = 0
    last = None
    while True:
        rows = get_items(
            profile_json,
            price_list=price_list,
            item_group="",
            start_after=last,
            limit=page_size,
        )
        pages += 1
        if not rows:
            break
        total += len(rows)
        last = rows[-1].get("item_name")
        if len(rows) < page_size:
            break
        if pages >= MAX_PAGES:
            break

    return {
        "profile": profile.get("name"),
        "pages": pages,
        "items": total,
        "ms": round((time.perf_counter() - started) * 1000),
    }


def prewarm_pos_item_cache():
    """Scheduled: re-walk every cache-enabled POS Profile to keep get_items warm.

    Runs per-site on the scheduler. Each profile is isolated so one bad profile
    never aborts the rest. Returns a per-profile summary (also used by tests).
    """
    profiles = frappe.get_all(
        "POS Profile",
        filters={"posa_use_server_cache": 1, "disabled": 0},
        pluck="name",
    )

    summary = []
    for name in profiles:
        try:
            profile = frappe.get_doc("POS Profile", name).as_dict()
            summary.append(_warm_profile(profile))
        except Exception:
            frappe.log_error(
                title="posawesome prewarm_pos_item_cache failed",
                message=f"profile={name}\n{frappe.get_traceback()}",
            )

    if summary:
        frappe.logger("posawesome").info("[POSA_PREWARM] %s", summary)
    return summary
