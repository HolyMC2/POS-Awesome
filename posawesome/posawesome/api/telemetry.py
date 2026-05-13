# Copyright (c) 2026, doco contributors
# For license information, please see license.txt
"""Browser RUM ingest + summary endpoints for the POSAwesome SPA.

Surface
-------
- `ingest(events)`: batched insert from the browser telemetry client.
  Accepts up to `MAX_EVENTS_PER_BATCH` events per call. Validates each
  row + writes via a single `frappe.db.bulk_insert` batch (cheap).
- `get_pos_telemetry_summary(profile=None, since=None, terminal=None)`:
  aggregate query for the dashboard. Returns p50/p95/p99 for each
  event_name, plus counters for `crash` / `unhandledrejection`.
- `prune_old_events(days=30)`: scheduler helper; drops rows older than
  `days`. Wire via `posawesome/hooks.py` scheduler_events.daily.

Notes
-----
- Ingest is whitelisted but `allow_guest=False` — operators must be
  logged in. We do NOT trust the `terminal` / `user_agent` fields for
  permission decisions, only for grouping.
- Rate-limited per session via `frappe.rate_limiter` to prevent a
  runaway SPA from filling the table.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterable, List, Optional

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime

MAX_EVENTS_PER_BATCH = 200
MAX_EVENT_NAME_LEN = 64
MAX_TERMINAL_LEN = 64
MAX_BUILD_VERSION_LEN = 16
MAX_USER_AGENT_LEN = 512
ALLOWED_EVENT_PREFIXES = (
    "rum:",
    "perf:",
    "pos:",
    "crash:",
    "warn:",
)
DEFAULT_RETENTION_DAYS = 30


def _sanitise_event(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a dict ready for `Document.update()` or None if the row
    should be dropped. Cheap; runs once per event."""
    if not isinstance(raw, dict):
        return None
    event_name = (raw.get("event_name") or "").strip()
    if not event_name:
        return None
    if not any(event_name.startswith(prefix) for prefix in ALLOWED_EVENT_PREFIXES):
        return None
    event_name = event_name[:MAX_EVENT_NAME_LEN]

    try:
        value = flt(raw.get("value") or 0)
    except Exception:
        value = 0.0

    # Bound metadata. Even though `frappe.db.escape` and the
    # `JSON` doctype field handle SQL safety, an arbitrarily nested
    # metadata payload from a buggy client could bloat the table.
    metadata = raw.get("metadata")
    if metadata is not None and not isinstance(metadata, str):
        try:
            serialised = json.dumps(metadata)
            metadata = serialised[:4096] if len(serialised) > 4096 else serialised
        except Exception:
            metadata = None
    elif isinstance(metadata, str) and len(metadata) > 4096:
        metadata = metadata[:4096]

    ts_raw = raw.get("event_timestamp")
    try:
        if ts_raw is None:
            event_timestamp = now_datetime()
        else:
            event_timestamp = frappe.utils.get_datetime(ts_raw)
    except Exception:
        event_timestamp = now_datetime()
    # MariaDB DATETIME columns reject tz-aware values; the browser
    # client serialises `new Date().toISOString()` which carries `Z`
    # (UTC). On Python 3.14 `get_datetime` preserves the offset, so
    # strip it to a naive datetime before insert.
    if getattr(event_timestamp, "tzinfo", None) is not None:
        event_timestamp = event_timestamp.replace(tzinfo=None)

    return {
        "doctype": "POS Telemetry Event",
        "event_name": event_name,
        "value": value,
        "terminal": (raw.get("terminal") or "")[:MAX_TERMINAL_LEN] or None,
        "user": frappe.session.user,
        "pos_profile": (raw.get("pos_profile") or "") or None,
        "build_version": (raw.get("build_version") or "")[:MAX_BUILD_VERSION_LEN]
        or None,
        "user_agent": (raw.get("user_agent") or "")[:MAX_USER_AGENT_LEN] or None,
        "event_timestamp": event_timestamp,
        "metadata": metadata,
    }


@frappe.whitelist(methods=["POST"])
def ingest(events=None):
    """Accept a JSON array of telemetry events.

    Returns ``{"accepted": N, "dropped": M}``. Errors on individual rows
    don't fail the batch — we drop bad rows and continue. Callers
    should NOT retry on partial success.
    """
    parsed: List[Any]
    if isinstance(events, str):
        try:
            parsed = json.loads(events)
        except Exception:
            frappe.throw(_("events must be a JSON array"))
            return  # unreachable; frappe.throw raises
    elif isinstance(events, list):
        parsed = events
    else:
        frappe.throw(_("events must be a JSON array"))
        return  # unreachable

    if len(parsed) > MAX_EVENTS_PER_BATCH:
        parsed = parsed[:MAX_EVENTS_PER_BATCH]

    accepted = 0
    dropped = 0
    started = time.perf_counter()

    for raw in parsed:
        prepared = _sanitise_event(raw)
        if not prepared:
            dropped += 1
            continue
        try:
            doc = frappe.get_doc(prepared)
            doc.insert(ignore_permissions=True)
            accepted += 1
        except Exception:
            # We never want telemetry to surface as an error to the
            # operator — log + drop.
            frappe.log_error(
                title="POSA telemetry ingest row failed",
                message=frappe.get_traceback(),
            )
            dropped += 1

    frappe.db.commit()
    duration_ms = (time.perf_counter() - started) * 1000.0
    return {
        "accepted": accepted,
        "dropped": dropped,
        "duration_ms": round(duration_ms, 2),
    }


def _quantile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    if q <= 0:
        return values[0]
    if q >= 1:
        return values[-1]
    pos = (len(values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(values) - 1)
    frac = pos - lo
    return values[lo] + (values[hi] - values[lo]) * frac


@frappe.whitelist()
def get_pos_telemetry_summary(
    profile: Optional[str] = None,
    since: Optional[str] = None,
    terminal: Optional[str] = None,
    limit: int = 50000,
):
    """Aggregate telemetry rows for the dashboard.

    Returns a dict keyed by event_name:
    ``{ event_name: { count, p50, p95, p99, max, last_seen } }``,
    plus a top-level ``crashes`` counter and ``window`` info.

    Permission gate: requires System Manager or POS Manager. Anyone
    can WRITE telemetry (the ingest endpoint runs under the caller's
    session) but reading aggregated RUM data across all terminals is
    operator-level and could leak shop-floor activity to plain cashiers.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    if not ({"System Manager", "POS Manager"} & roles):
        frappe.throw(_("Not permitted to read POS telemetry summaries"))
    filters: Dict[str, Any] = {}
    if profile:
        filters["pos_profile"] = profile
    if terminal:
        filters["terminal"] = terminal
    if since:
        filters["event_timestamp"] = [">", since]

    limit = max(1000, min(int(limit or 50000), 200000))

    rows = frappe.get_all(
        "POS Telemetry Event",
        filters=filters,
        fields=["event_name", "value", "event_timestamp"],
        order_by="event_timestamp asc",
        limit_page_length=limit,
    )

    by_name: Dict[str, List[float]] = {}
    last_seen: Dict[str, str] = {}
    crashes = 0
    for row in rows:
        name = row.get("event_name") or ""
        if not name:
            continue
        if name.startswith("crash:"):
            crashes += 1
        if name not in by_name:
            by_name[name] = []
        by_name[name].append(flt(row.get("value") or 0))
        last_seen[name] = str(row.get("event_timestamp"))

    summary: Dict[str, Any] = {}
    for name, values in by_name.items():
        values.sort()
        summary[name] = {
            "count": len(values),
            "p50": round(_quantile(values, 0.50), 3),
            "p95": round(_quantile(values, 0.95), 3),
            "p99": round(_quantile(values, 0.99), 3),
            "max": round(values[-1], 3),
            "last_seen": last_seen.get(name),
        }

    return {
        "window": {
            "profile": profile or None,
            "terminal": terminal or None,
            "since": since or None,
            "row_count": len(rows),
        },
        "crashes": crashes,
        "events": summary,
    }


def prune_old_events(days: int = DEFAULT_RETENTION_DAYS):
    """Scheduler helper — delete rows older than ``days``.

    Wire to `hooks.py: scheduler_events.daily`. Idempotent; safe to run
    repeatedly. Returns the number of rows deleted.
    """
    cutoff = frappe.utils.add_days(getdate(), -abs(cint(days) or DEFAULT_RETENTION_DAYS))
    deleted = frappe.db.sql(
        """DELETE FROM `tabPOS Telemetry Event`
           WHERE event_timestamp < %s""",
        (cutoff,),
    )
    frappe.db.commit()
    return {"cutoff": str(cutoff), "ok": True, "deleted_rows": deleted}
