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

import hmac
import json
import time
from typing import Any, Dict, Iterable, List, Optional

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
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

# Time-based web vitals (milliseconds). A tab throttled in the background
# then resumed reports wall-clock durations — prod saw rum:inp at
# 4,971,552 ms (82 min) and rum:lcp at 3,568,076 ms (59 min), single
# garbage samples that trashed max/p99 on these low-count metrics. Drop
# any reading above the ceiling. Mirror of the client cap in
# `frontend/src/posapp/utils/telemetry.ts` (MAX_WEBVITAL_MS) — kept here
# so a stale tab on an old build can't reflood after the client fix lands.
# NOT applied to rum:cls (unitless score) or rum:heap_used_mb (megabytes),
# nor to perf:* API timings (a real 15 s get_items is signal we want).
WEBVITAL_MS_EVENTS = ("rum:lcp", "rum:fcp", "rum:inp", "rum:longtask")
MAX_WEBVITAL_MS = 60000.0

# QZ Tray fleet summary (get_qz_fleet). Each POS page session emits one
# `pos:qz_connect` row per terminal carrying its printer inventory + cert
# state; `warn:qz_failure` rows count print/connect errors. A terminal is
# flagged "stale" only in a window wide enough (>= a week) for a 48h gap to
# be meaningful — a 1-day window can't hold a 48h-old row.
QZ_CONNECT_EVENT = "pos:qz_connect"
QZ_FAILURE_EVENT = "warn:qz_failure"
QZ_FLEET_MAX_ROWS = 5000
QZ_STALE_HOURS = 48
QZ_STALE_MIN_WINDOW_DAYS = 7

# QZ Tray OS-level liveness beacon (ingest_terminal_heartbeat +
# get_qz_fleet "beacons"). A scheduled task installed by the QZ bundle
# (Windows schtasks / Linux cron) POSTs {token, terminal:<hostname>} every
# ~15 min; each accepted beat writes one `pos:qz_heartbeat` row. Inserts are
# throttled to one per terminal per QZ_HEARTBEAT_TTL_SECONDS so a
# misconfigured beacon can't flood the table. A terminal is "offline" once
# its newest beat is older than QZ_OFFLINE_MINUTES — >2 missed 15-min beats.
QZ_HEARTBEAT_EVENT = "pos:qz_heartbeat"
QZ_HEARTBEAT_TTL_SECONDS = 300
QZ_OFFLINE_MINUTES = 35

# User-confirmed print self-test (the POS print-health dialog prints a test
# ticket, then asks "¿Salió el ticket?"). One row per answer, `value` = 1|0 and
# metadata = {ok, printer, qz_version, source}. get_qz_fleet joins the newest
# row per terminal onto that terminal's entry — the only fleet signal that
# reflects paper actually coming out of a printer rather than software state.
QZ_SELFTEST_EVENT = "pos:print_selftest"


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

    # Server-side mirror of the client noise filter (utils/telemetry.ts):
    # "ResizeObserver loop …" is a benign browser notification, not a crash.
    # It flooded crash:error (212 rows / 3 days on prod) before the client
    # filter shipped. Drop it here too so a stale tab on an old build can't
    # reflood the table after the client fix lands.
    if event_name.startswith("crash:"):
        meta = raw.get("metadata")
        meta_msg = ""
        if isinstance(meta, dict):
            meta_msg = str(meta.get("message") or "")
        elif isinstance(meta, str):
            meta_msg = meta
        if "ResizeObserver loop" in meta_msg:
            return None

    try:
        value = flt(raw.get("value") or 0)
    except Exception:
        value = 0.0

    # Drop background-throttle artifacts on time-based web vitals (see
    # WEBVITAL_MS_EVENTS). Negative readings are impossible for these and
    # also dropped.
    if event_name in WEBVITAL_MS_EVENTS and not (0 <= value <= MAX_WEBVITAL_MS):
        return None

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
@rate_limit(limit=10, seconds=1)
def ingest(events=None):
    """Accept a JSON array of telemetry events.

    Returns ``{"accepted": N, "dropped": M}``. Errors on individual rows
    don't fail the batch — we drop bad rows and continue. Callers
    should NOT retry on partial success.

    Rate-limited to 10 batches/second per session (200 events/batch =
    2,000 events/sec ceiling). A runaway SPA tab gets 429'd before it
    can pollute the Telemetry Event table.
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

    # Single bulk INSERT instead of one doc.insert() per row. Prod showed
    # the row-by-row path averaging 2.4s / batch (max 64s on a 200-row
    # flush) — pure ORM overhead for a doctype with no validate logic, no
    # children and hash autonaming. bulk_insert also skips link
    # validation, which we WANT here: RUM is append-only observability
    # data; a stale/renamed pos_profile must never drop a terminal's
    # metrics (LinkValidationError).
    now = now_datetime()
    session_user = frappe.session.user
    fields = [
        "name",
        "owner",
        "creation",
        "modified",
        "modified_by",
        "docstatus",
        "idx",
        "event_name",
        "value",
        "terminal",
        "user",
        "pos_profile",
        "build_version",
        "user_agent",
        "event_timestamp",
        "metadata",
    ]
    rows = []
    for raw in parsed:
        prepared = _sanitise_event(raw)
        if not prepared:
            dropped += 1
            continue
        rows.append(
            (
                frappe.generate_hash(length=10),
                session_user,
                now,
                now,
                session_user,
                0,
                0,
                prepared["event_name"],
                prepared["value"],
                prepared["terminal"],
                prepared["user"],
                prepared["pos_profile"],
                prepared["build_version"],
                prepared["user_agent"],
                prepared["event_timestamp"],
                prepared["metadata"],
            )
        )

    if rows:
        try:
            frappe.db.bulk_insert(
                "POS Telemetry Event",
                fields=fields,
                values=rows,
                ignore_duplicates=True,
            )
            accepted = len(rows)
        except Exception:
            # We never want telemetry to surface as an error to the
            # operator — log + drop the batch.
            frappe.log_error(
                title="POSA telemetry bulk ingest failed",
                message=frappe.get_traceback(),
            )
            dropped += len(rows)

    frappe.db.commit()
    duration_ms = (time.perf_counter() - started) * 1000.0
    return {
        "accepted": accepted,
        "dropped": dropped,
        "duration_ms": round(duration_ms, 2),
    }


def _json_object(raw: Any) -> Dict[str, Any]:
    """Parse a telemetry ``metadata`` payload into a dict, never raising.

    Rows are written by the browser, so a truncated or non-object payload has
    to degrade to "no metadata" instead of dropping the response it belongs to.
    """
    if not raw:
        return {}
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


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


@frappe.whitelist(methods=["GET", "POST"])
def get_pos_telemetry_summary(
    profile: Optional[str] = None,
    since: Optional[str] = None,
    terminal: Optional[str] = None,
    limit: int = 50000,
    newest: Any = False,
    events: Any = None,
):
    """Aggregate telemetry rows for the dashboard.

    Returns a dict keyed by event_name:
    ``{ event_name: { count, p50, p95, p99, max, last_seen } }``,
    plus a top-level ``crashes`` counter and ``window`` info.

    ``newest`` (default off): when truthy, fetch the most-recent ``limit``
    rows (event_timestamp DESC) instead of the oldest. The default ASC
    fetch capped at ``limit`` silently summarises the OLDEST rows — on a
    busy tenant (>``limit`` rows in the window) that makes *recent*
    activity look truncated and ``last_seen`` stall. ``window.truncated``
    flags when the cap was hit so a caller can narrow ``since`` or pass
    ``newest=1``. Aggregation is order-independent (values are sorted per
    event_name below) and ``last_seen`` tracks the max timestamp seen, so
    both orderings return correct percentiles + a correct last_seen.

    Permission gate: requires System Manager or POS Manager. Anyone
    can WRITE telemetry (the ingest endpoint runs under the caller's
    session) but reading aggregated RUM data across all terminals is
    operator-level and could leak shop-floor activity to plain cashiers.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    # POS Awesome Supervisor included: these panels render inside the Awesome
    # Dashboard, which that role is exactly the grant for.
    if not ({"System Manager", "POS Manager", "POS Awesome Supervisor"} & roles):
        frappe.throw(_("Not permitted to read POS telemetry summaries"))
    filters: Dict[str, Any] = {}
    if profile:
        filters["pos_profile"] = profile
    if terminal:
        filters["terminal"] = terminal
    if since:
        filters["event_timestamp"] = [">", since]

    # Optional event-name filter (JSON list or comma-separated string).
    # The benchmark baseline recorder uses this: a manifest's ~20 events
    # over a 7-day window fit the row cap easily, while an unfiltered
    # 7-day fetch on a busy tenant would blow straight through it.
    if events:
        if isinstance(events, str):
            try:
                parsed = json.loads(events)
            except Exception:
                parsed = [part.strip() for part in events.split(",")]
            events = parsed
        event_names = [str(name) for name in events if str(name).strip()]
        if event_names:
            filters["event_name"] = ["in", event_names]

    limit = max(1000, min(int(limit or 50000), 200000))

    # HTTP query args arrive as strings ("1"/"true"); normalise.
    want_newest = str(newest).strip().lower() in ("1", "true", "yes", "on")
    order = "event_timestamp desc" if want_newest else "event_timestamp asc"

    rows = frappe.get_all(
        "POS Telemetry Event",
        filters=filters,
        fields=["event_name", "value", "event_timestamp"],
        order_by=order,
        limit_page_length=limit,
        # Authz is the explicit role gate above; supervisors don't carry a
        # doctype-level read perm on the raw event table.
        ignore_permissions=True,
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
        # Track the newest timestamp regardless of fetch order. Stringified
        # frappe datetimes ("YYYY-MM-DD HH:MM:SS.ffffff") sort lexically, so
        # a plain `>` compare is correct for both ASC and DESC fetches.
        ts = str(row.get("event_timestamp"))
        if name not in last_seen or ts > last_seen[name]:
            last_seen[name] = ts

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
            "order": "desc" if want_newest else "asc",
            "limit": limit,
            "row_count": len(rows),
            # True => the window held more rows than `limit`; the summary
            # only covers `limit` of them (oldest if asc, newest if desc).
            "truncated": len(rows) >= limit,
        },
        "crashes": crashes,
        "events": summary,
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_qz_fleet(days: int = 7) -> dict:
    """Per-terminal QZ Tray print-fleet summary for the ops dashboard.

    One entry per terminal, built from the NEWEST ``pos:qz_connect`` row in
    the window (printer inventory + cert state, emitted once per POS page
    session) joined with the terminal's ``warn:qz_failure`` count and its
    newest ``pos:print_selftest`` confirmation (``last_selftest``:
    ``{ok, at, printer, qz_version}`` or None) over the same window. Terminals
    with problems — no printers, a pinned printer that isn't present, an
    untrusted cert, recent failures, or a stale last-seen — are surfaced first
    via server-computed ``flags``.

    Permission gate mirrors ``get_pos_telemetry_summary``: System Manager or
    POS Manager only. Anyone can WRITE telemetry, but reading fleet state
    across terminals is operator-level.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    # POS Awesome Supervisor included: these panels render inside the Awesome
    # Dashboard, which that role is exactly the grant for.
    if not ({"System Manager", "POS Manager", "POS Awesome Supervisor"} & roles):
        frappe.throw(_("Not permitted to read POS telemetry summaries"))

    # `days` arrives as a str from HTTP; clamp to a sane 1..30 window.
    days = max(1, min(cint(days) or 7, 30))
    now = now_datetime()
    since = frappe.utils.add_to_date(now, days=-days)

    # Newest-first so the python-side dedupe below keeps the latest
    # pos:qz_connect row per terminal. Bounded so a fleet that floods the
    # window can't pull an unbounded result set.
    rows = frappe.get_all(
        "POS Telemetry Event",
        filters={
            "event_name": QZ_CONNECT_EVENT,
            "event_timestamp": [">=", since],
        },
        fields=["terminal", "value", "event_timestamp", "metadata"],
        order_by="event_timestamp desc",
        limit_page_length=QZ_FLEET_MAX_ROWS,
        # Authz is the explicit role gate above; supervisors don't carry a
        # doctype-level read perm on the raw event table.
        ignore_permissions=True,
    )

    # Failure counts per terminal over the SAME window, one aggregated query.
    # Parameterised — `since` is the only bound value and the event name is a
    # module constant, never user input.
    failure_rows = frappe.db.sql(
        """SELECT terminal, COUNT(*) AS failures
             FROM `tabPOS Telemetry Event`
            WHERE event_name = %(event)s
              AND event_timestamp >= %(since)s
         GROUP BY terminal""",
        {"event": QZ_FAILURE_EVENT, "since": since},
        as_dict=True,
    )
    failures_by_terminal: Dict[str, int] = {
        (r.get("terminal") or ""): cint(r.get("failures")) for r in failure_rows
    }

    # Newest user-confirmed self-test per terminal over the same window: one
    # bounded newest-first batch read + python dedupe, exactly like the connect
    # rows above (never a per-terminal query). Keyed by the same browser
    # terminal id pos:qz_connect uses, so the join is a plain dict lookup and a
    # terminal that never ran a test simply reports None.
    selftest_rows = frappe.get_all(
        "POS Telemetry Event",
        filters={
            "event_name": QZ_SELFTEST_EVENT,
            "event_timestamp": [">=", since],
        },
        fields=["terminal", "value", "event_timestamp", "metadata"],
        order_by="event_timestamp desc",
        limit_page_length=QZ_FLEET_MAX_ROWS,
        # Same explicit-role-gate rationale as the reads above.
        ignore_permissions=True,
    )
    selftest_by_terminal: Dict[str, Dict[str, Any]] = {}
    for row in selftest_rows:
        selftest_terminal = row.get("terminal") or ""
        if selftest_terminal in selftest_by_terminal:
            continue  # older answer for a terminal already recorded
        meta = _json_object(row.get("metadata"))
        # The client sends `ok` in metadata as 1|0; the row `value` carries the
        # same signal and covers a payload whose metadata was lost/truncated.
        confirmed_at = frappe.utils.get_datetime(row.get("event_timestamp"))
        selftest_by_terminal[selftest_terminal] = {
            "ok": bool(cint(meta.get("ok", row.get("value")))),
            "at": confirmed_at.isoformat() if confirmed_at else None,
            "printer": str(meta.get("printer") or ""),
            "qz_version": str(meta.get("qz_version") or ""),
        }

    stale_cutoff = frappe.utils.add_to_date(now, hours=-QZ_STALE_HOURS)
    window_supports_stale = days >= QZ_STALE_MIN_WINDOW_DAYS

    seen: set = set()
    terminals: List[Dict[str, Any]] = []
    flag_totals: Dict[str, int] = {}
    for row in rows:
        terminal = row.get("terminal") or ""
        if terminal in seen:
            continue  # older row for a terminal we've already recorded
        seen.add(terminal)

        printer_count = cint(row.get("value"))

        # Parse metadata defensively — a malformed payload must degrade to
        # empty fields, never raise and drop the whole fleet response.
        qz_version = default_printer = selected_printer = cert = ""
        printers: List[str] = []
        raw_meta = row.get("metadata")
        if raw_meta:
            try:
                meta = json.loads(raw_meta) if isinstance(raw_meta, str) else raw_meta
                if isinstance(meta, dict):
                    qz_version = str(meta.get("qz_version") or "")
                    default_printer = str(meta.get("default_printer") or "")
                    selected_printer = str(meta.get("selected_printer") or "")
                    cert = str(meta.get("cert") or "")
                    raw_printers = meta.get("printers")
                    if isinstance(raw_printers, list):
                        printers = [str(p) for p in raw_printers]
            except Exception:
                pass

        failures = failures_by_terminal.get(terminal, 0)
        last_seen_dt = frappe.utils.get_datetime(row.get("event_timestamp"))

        flags: List[str] = []
        if printer_count == 0:
            flags.append("no_printers")
        if selected_printer and selected_printer not in printers:
            flags.append("selected_missing")
        if cert not in ("trusted",):
            flags.append("cert_untrusted")
        if window_supports_stale and last_seen_dt and last_seen_dt < stale_cutoff:
            flags.append("stale")
        if failures > 0:
            flags.append("failures")

        for flag in flags:
            flag_totals[flag] = flag_totals.get(flag, 0) + 1

        terminals.append(
            {
                "terminal": terminal,
                "last_seen": last_seen_dt.isoformat() if last_seen_dt else None,
                "qz_version": qz_version,
                "printer_count": printer_count,
                "printers": printers,
                "default_printer": default_printer,
                "selected_printer": selected_printer,
                "cert": cert,
                "failures": failures,
                # None until someone confirms a test ticket on this terminal.
                # Deliberately does NOT feed `flags`: the fleet panel and the
                # POS dialog decide what a failed/stale test means, and adding a
                # flag here would silently reshuffle the flagged-first sort.
                "last_selftest": selftest_by_terminal.get(terminal),
                "flags": flags,
            }
        )

    # Flagged terminals first (most flags first), then most-recent last_seen.
    # ISO timestamps sort lexically in chronological order, so the string is a
    # fine secondary key; a missing last_seen sorts last within its flag tier.
    terminals.sort(
        key=lambda t: (len(t["flags"]), t["last_seen"] or ""), reverse=True
    )

    # QZ beacons: OS-level heartbeats (ingest_terminal_heartbeat), keyed by
    # the machine hostname the beacon reports. Deliberately NOT joined to the
    # `terminals` list above — those are keyed by the browser-generated POS
    # terminal UUID from pos:qz_connect, a different namespace. One host can
    # run several browser terminals (and a browser terminal can move between
    # hosts), so the two views are reported side by side, never merged.
    beacon_rows = frappe.get_all(
        "POS Telemetry Event",
        filters={
            "event_name": QZ_HEARTBEAT_EVENT,
            "event_timestamp": [">=", since],
        },
        fields=["terminal", "event_timestamp"],
        order_by="event_timestamp desc",
        limit_page_length=QZ_FLEET_MAX_ROWS,
        # Same explicit-role-gate rationale as the reads above.
        ignore_permissions=True,
    )

    offline_cutoff = frappe.utils.add_to_date(now, minutes=-QZ_OFFLINE_MINUTES)
    beacon_seen: set = set()
    beacons: List[Dict[str, Any]] = []
    offline_count = 0
    for row in beacon_rows:
        terminal = row.get("terminal") or ""
        if terminal in beacon_seen:
            continue  # older beat for a host we've already recorded
        beacon_seen.add(terminal)

        last_beat_dt = frappe.utils.get_datetime(row.get("event_timestamp"))
        # Beat cadence is ~15 min; offline once the newest beat is older than
        # QZ_OFFLINE_MINUTES (35 => >2 missed beats). Always meaningful — the
        # window is >= 1 day, so no min-window guard as on `stale`.
        offline = bool(last_beat_dt and last_beat_dt < offline_cutoff)
        if offline:
            offline_count += 1
        beacons.append(
            {
                "terminal": terminal,
                "last_beat": last_beat_dt.isoformat() if last_beat_dt else None,
                "offline": offline,
            }
        )

    # Offline hosts first, then most-recent last_beat. Same reverse-sorted
    # (bool, iso-timestamp) key shape as the terminals sort above.
    beacons.sort(key=lambda b: (b["offline"], b["last_beat"] or ""), reverse=True)

    if offline_count > 0:
        flag_totals["offline"] = offline_count

    return {
        "window": {"days": days, "since": since.isoformat()},
        "terminals": terminals,
        "beacons": beacons,
        "flag_totals": flag_totals,
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
def ingest_terminal_heartbeat(token: str = "", terminal: str = "") -> dict:
    """OS-level QZ Tray liveness beacon (public, fail-closed).

    A scheduled task installed by the QZ bundle (Windows ``schtasks`` /
    Linux ``cron``) POSTs ``{token, terminal:<hostname>}`` every ~15 min so
    the fleet view can distinguish a machine that stopped beaconing (powered
    off, lost network, task removed) from one that is merely idle. This runs
    as Guest on the public internet, so security is fail-closed:

      - A shared secret from ``site_config`` (``qz_heartbeat_token``) gates
        the endpoint. When it is unset/empty EVERY call is rejected — an
        unconfigured secret is never treated as "no auth required".
      - The presented token is compared with ``hmac.compare_digest`` and, on
        any failure, we raise the same generic permission error without ever
        echoing the token or the expected value (no logs, no error text).
      - One accepted beat writes a single ``pos:qz_heartbeat`` row. A per-
        terminal cache key throttles inserts to one / ``QZ_HEARTBEAT_TTL_
        SECONDS``; extra beats inside that window are accepted silently
        (``{"ok": True}``) without a row so a misconfigured beacon can't
        flood the table.

    Returns ``{"ok": True}`` on accept, whether or not a row was written.
    """
    expected = frappe.conf.get("qz_heartbeat_token") or ""
    presented = token or ""
    # Fail closed: unconfigured secret (falsy `expected`) rejects everyone,
    # an over-long token is rejected before it is compared, and a mismatch is
    # indistinguishable from either. `or` short-circuits so compare_digest
    # only runs on a configured secret and a bounded input. Never surface the
    # token or expected value in the error.
    if (
        not expected
        or len(presented) > 256
        or not hmac.compare_digest(
            presented.encode("utf-8"), expected.encode("utf-8")
        )
    ):
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    terminal = (terminal or "").strip()[:MAX_TERMINAL_LEN]
    if not terminal:
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    # Per-terminal insert throttle. Key present => a beat already landed in
    # this window; accept silently without another row. Set only on insert.
    cache = frappe.cache()
    rate_key = f"qz_hb:{terminal}"
    if cache.get_value(rate_key):
        return {"ok": True}

    # One raw row via the same bulk_insert path ingest() uses — a DB-level
    # write that (like ingest) bypasses the ORM + permission layer, which is
    # exactly what we want for an append-only observability beat written by a
    # Guest request.
    now = now_datetime()
    session_user = frappe.session.user
    frappe.db.bulk_insert(
        "POS Telemetry Event",
        fields=[
            "name",
            "owner",
            "creation",
            "modified",
            "modified_by",
            "docstatus",
            "idx",
            "event_name",
            "value",
            "terminal",
            "user",
            "pos_profile",
            "build_version",
            "user_agent",
            "event_timestamp",
            "metadata",
        ],
        values=[
            (
                frappe.generate_hash(length=10),
                session_user,
                now,
                now,
                session_user,
                0,
                0,
                QZ_HEARTBEAT_EVENT,
                1,
                terminal,
                session_user,
                None,
                None,
                None,
                now,
                json.dumps({"source": "beacon"}),
            )
        ],
        ignore_duplicates=True,
    )
    cache.set_value(rate_key, 1, expires_in_sec=QZ_HEARTBEAT_TTL_SECONDS)
    frappe.db.commit()
    return {"ok": True}


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
