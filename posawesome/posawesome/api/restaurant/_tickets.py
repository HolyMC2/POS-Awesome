# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""The one open-order predicate, plus occupancy reconcile and the floor room.

Everything that asks "is this table busy?" — the floor render, the delete
guard, re-open-on-tap, the occupancy reconcile — goes through
``open_order_filters``. Two callers with two hand-written predicates is
exactly how a floor starts showing a table free while an order sits on it.

The shift scope is the load-bearing detail (spec §6.6 / F5): POS shifts are
PER-USER (``api/shifts.py`` filters ``{"user": user}``), and a dining room is
shared. A predicate scoped to the caller's own shift cannot see the order
waiter A opened, so waiter B's floor shows the table free and seats a second
party on it. Scope by the REGISTER's set of open shifts instead, bounded by
staleness so a zombie shift (the lab has one open since 2025-07-22) does not
poison the set forever.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, now_datetime, nowdate

OPEN_STATUS = "Open"
SETTLING_STATUS = "Settling"

# How far back a register's open shifts are still considered live. Three days
# covers a service crossing midnight plus a weekend register nobody closed,
# without dragging in a shift left open last July.
DEFAULT_SHIFT_MAX_AGE_DAYS = 3

FLOOR_UPDATE_EVENT = "posa_floor_update"
TABS_UPDATE_EVENT = "posa_tabs_update"

TABLES_CAPABILITY = "tables"


# ---------------------------------------------------------------------------
# capability gate
# ---------------------------------------------------------------------------


def assert_tables_capability(pos_profile):
    """Server-side enforcement of the ``tables`` capability token.

    Floor / table / KOT / settle are table-service features. The SPA hides them
    on a register whose capability preset lacks ``tables``, but hiding is a UI
    convenience, not an authorization boundary — a crafted or stale client can
    call these whitelisted endpoints directly and drive another giro's register
    into table state, fire KOTs, or settle accounting documents it should never
    reach. Enforce the token here, mirroring the tips money-gate precedent
    (Marco 2026-08-12: enforce ``tables`` server-side, not UI-only).

    An entry may carry a ``:Role`` suffix. When present it is a real
    restriction: only a session user holding that role passes (audit r2 —
    the previous ``split(":")[0]`` check ignored the suffix, so any cashier
    on a ``tables:Restaurant Manager`` register could open/settle tables and
    fire KOTs). Mirrors ``_capability_enabled`` in ``charge_requests.py``.
    """
    # Shift-aware (roadmap F1 next-shift activation): while the acting user
    # has an open shift, the token set comes from that shift's immutable
    # stamp, so a preset edit mid-shift neither grants nor strips table
    # service until the next opening; the emergency kill switch still
    # subtracts immediately.
    from posawesome.posawesome.api.vertical import shift_effective_capability_payload

    if not pos_profile:
        frappe.throw(_("POS profile is required."), frappe.PermissionError)
    payload = shift_effective_capability_payload(pos_profile) or {}
    capabilities = payload.get("capabilities") or []
    user_roles = None
    for entry in capabilities:
        capability, separator, required_role = str(entry).partition(":")
        if capability.strip() != TABLES_CAPABILITY:
            continue
        required_role = required_role.strip() if separator else ""
        if not required_role:
            return
        if user_roles is None:
            user_roles = set(frappe.get_roles(frappe.session.user) or [])
        if required_role in user_roles:
            return
    frappe.throw(
        _("This register is not configured for table service."),
        frappe.PermissionError,
    )


# ---------------------------------------------------------------------------
# the predicate
# ---------------------------------------------------------------------------


def open_order_filters(table=None, shifts=None):
    """Filters selecting the OPEN orders that make a table busy.

    ``shifts`` = the set of open shifts for the REGISTER, never the caller's
    own shift. Pass ``None`` to skip the shift dimension entirely (the delete
    guard wants every open order regardless of shift).
    """
    filters = {"status": OPEN_STATUS}
    if table is not None:
        filters["table"] = table
    if shifts is not None:
        filters["pos_opening_shift"] = ["in", list(shifts)]
    return filters


def register_open_shifts(pos_profile, max_age_days=DEFAULT_SHIFT_MAX_AGE_DAYS):
    """Every open shift on the register — all users, staleness-bounded.

    Returns a list of POS Opening Shift names. Empty is a legitimate answer
    (nobody has opened the register today); callers must handle it rather
    than treating it as "no filter".
    """
    if not pos_profile:
        return []

    filters = {
        "pos_profile": pos_profile,
        "status": OPEN_STATUS,
        "docstatus": 1,
        "pos_closing_shift": ["is", "not set"],
    }
    if max_age_days:
        filters["period_start_date"] = [">=", add_days(nowdate(), -abs(cint(max_age_days)))]

    return (
        frappe.get_all(
            "POS Opening Shift",
            filters=filters,
            pluck="name",
            order_by="period_start_date desc",
            ignore_permissions=True,
        )
        or []
    )


def open_order_count(table, shifts=None):
    """How many open orders sit on ``table``. The source of truth for busy."""
    if not table:
        return 0
    return frappe.db.count("POS Table Order", open_order_filters(table=table, shifts=shifts))


def reconcile_table_occupancy(table):
    """Sync the cached ``occupied`` Check from the open-order COUNT.

    THE ONLY writer of that field — the doctype marks it ``read_only`` to
    keep it that way. The count stays the truth; the flag is a repaint hint
    so the floor does not run a COUNT per tile per render (spec §0.2).
    Returns the count.
    """
    if not table:
        return 0

    count = open_order_count(table)
    occupied = 1 if count else 0
    current = cint(frappe.db.get_value("POS Table", table, "occupied"))
    if current != occupied:
        # `modified` deliberately advances: the offline table catalog syncs on
        # that watermark, so a silent write would leave every tablet's cached
        # board stale until the table was edited for some other reason.
        frappe.db.set_value("POS Table", table, "occupied", occupied)
    return count


# ---------------------------------------------------------------------------
# lookups shared by the write endpoints
# ---------------------------------------------------------------------------


def resolve_order_name(name_or_uid):
    """Accept either the docname or the client's ``order_uid``.

    They are the same string for every order this app creates
    (``autoname: field:order_uid``), but an offline client may hold a uid it
    generated before the insert landed, so both are honoured.
    """
    if not name_or_uid:
        frappe.throw(_("Order reference is required."))
    if frappe.db.exists("POS Table Order", name_or_uid):
        return name_or_uid
    by_uid = frappe.db.get_value("POS Table Order", {"order_uid": name_or_uid}, "name")
    if not by_uid:
        frappe.throw(_("Table order {0} not found.").format(name_or_uid), frappe.DoesNotExistError)
    return by_uid


def get_scoped_order(name_or_uid):
    """Fetch the order and assert scope off the FETCHED profile/company.

    Never off client input: the caller names an order, and the tenant
    boundary must come from what that order actually says (the pattern at
    ``invoices.py:265-273``).
    """
    from posawesome.posawesome.api._scope import assert_company, assert_profile

    doc = frappe.get_doc("POS Table Order", resolve_order_name(name_or_uid))
    assert_profile(frappe.session.user, doc.pos_profile)
    assert_company(frappe.session.user, doc.company)
    return doc


def table_floor(table):
    return frappe.db.get_value("POS Table", table, "floor") if table else None


def default_floor(pos_profile, company=None):
    """The floor a profile falls back to — lowest sequence, active only.

    Used to give table-less (named tab) orders a room to broadcast on.
    """
    if not pos_profile:
        return None
    rows = frappe.get_all(
        "POS Floor",
        filters={"pos_profile": pos_profile, "is_active": 1},
        fields=["name"],
        order_by="sequence asc, floor_name asc",
        limit_page_length=1,
        ignore_permissions=True,
    )
    if rows:
        return rows[0]["name"]
    if not company:
        return None
    rows = frappe.get_all(
        "POS Floor",
        filters={"company": company, "is_active": 1},
        fields=["name"],
        order_by="sequence asc, floor_name asc",
        limit_page_length=1,
        ignore_permissions=True,
    )
    return rows[0]["name"] if rows else None


# ---------------------------------------------------------------------------
# realtime — the doc room, never the site room
# ---------------------------------------------------------------------------


def floor_board_rows(floor):
    """Board state for every active table on ``floor``, in one grouped query.

    One LEFT JOIN + GROUP BY, not a COUNT per tile: this runs on every
    mutation of every table in the room.
    """
    if not floor:
        return []

    rows = frappe.db.sql(
        """
        SELECT t.name              AS name,
               t.table_label       AS table_label,
               t.occupied          AS occupied,
               t.needs_cleaning    AS needs_cleaning,
               COUNT(o.name)       AS open_orders
        FROM `tabPOS Table` t
        LEFT JOIN `tabPOS Table Order` o
               ON o.`table` = t.name AND o.status = %(open_status)s
        WHERE t.floor = %(floor)s AND t.is_active = 1
        GROUP BY t.name, t.table_label, t.occupied, t.needs_cleaning
        """,
        {"floor": floor, "open_status": OPEN_STATUS},
        as_dict=True,
    )
    return [
        {
            "name": row["name"],
            "table_label": row["table_label"],
            "occupied": cint(row["occupied"]),
            "needs_cleaning": cint(row["needs_cleaning"]),
            "open_orders": cint(row["open_orders"]),
        }
        for row in rows or []
    ]


def _publish_floor_update(floor, payload=None, source_device=None):
    """Broadcast occupancy on the ``doc:POS Floor/<floor>`` room.

    NOT a bare ``publish_realtime`` — that lands in the site-wide ``"all"``
    room every System User auto-joins, so every register of every company on
    the tenant would receive it (spec F4). The doc room is permission-gated
    for free by ``frappe.realtime.has_permission``, and a floor is the
    natural fan-out unit since a device shows one floor at a time.

    Socket delivery has no reconnect replay, so this is a latency hint only:
    the client must still pull ``get_floor_snapshot`` on reconnect and on
    ``visibilitychange`` (spec §6.7). ``source_device`` is echoed so the
    originating device can ignore its own broadcast.
    """
    if not floor:
        return

    message = {
        "floor": floor,
        "tables": payload if payload is not None else floor_board_rows(floor),
        "ts": str(now_datetime()),
        "source_device": source_device or None,
    }
    try:
        frappe.publish_realtime(
            FLOOR_UPDATE_EVENT,
            message,
            doctype="POS Floor",
            docname=floor,
            after_commit=True,
        )
    except Exception:
        # A dead socket server must never fail the write that triggered it —
        # the authoritative pull covers the gap.
        frappe.log_error(frappe.get_traceback(), "posawesome.restaurant.publish_floor")


def _publish_tabs_update(pos_profile, company=None, source_device=None):
    """Broadcast a named-tab (table-less order) change.

    There is no generic room-join handler in Frappe, so an invented
    ``posa_tabs:<profile>`` room could be published to but never subscribed
    to. Ride the profile's default floor room instead; with no floor
    configured (a counter-only cafetería) simply skip — the tabs rail
    refreshes on pull.
    """
    floor = default_floor(pos_profile, company)
    if not floor:
        return
    try:
        frappe.publish_realtime(
            TABS_UPDATE_EVENT,
            {
                "pos_profile": pos_profile,
                "floor": floor,
                "ts": str(now_datetime()),
                "source_device": source_device or None,
            },
            doctype="POS Floor",
            docname=floor,
            after_commit=True,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "posawesome.restaurant.publish_tabs")


def publish_order_change(order, previous_table=None, source_device=None):
    """Reconcile + broadcast every table an order touched.

    Called at the end of every mutation. A transfer touches two tables (and
    possibly two floors); a table-less order touches the tabs rail.
    """
    touched = {t for t in (order.get("table"), previous_table) if t}
    if not touched:
        _publish_tabs_update(order.get("pos_profile"), order.get("company"), source_device)
        return

    floors = set()
    for table in touched:
        reconcile_table_occupancy(table)
        floor = table_floor(table)
        if floor:
            floors.add(floor)
    for floor in floors:
        _publish_floor_update(floor, source_device=source_device)
