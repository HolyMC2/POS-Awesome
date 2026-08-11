# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""Kitchen ticket as a PRINT PROJECTION, not a doctype.

A KOT doctype earns its keep only once a kitchen display exists; until then
the useful artefact is the diff. Firing compares the order's lines against
the `last_fired` snapshot stored on the order itself, so only CHANGES print
and a cancellation ticket comes out for free — and because the snapshot rides
the order, the diff survives an offline round trip (spec §5).

Routing is by product category (Odoo's model): POS Kitchen Station maps Item
Groups to a printer. An item whose group matches no station prints on the
"General" fallback rather than vanishing.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from posawesome.posawesome.api.restaurant._tickets import (
    OPEN_STATUS,
    get_scoped_order,
    publish_order_change,
)

GENERAL_STATION = "General"


def _load_snapshot(order):
    raw = order.last_fired
    if not raw:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        # A corrupt snapshot must not wedge the kitchen — treat it as "nothing
        # fired yet" and reprint, which is recoverable; refusing to fire is not.
        frappe.log_error(
            f"Unreadable last_fired snapshot on {order.name}", "posawesome.restaurant.kot"
        )
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _station_index(company, pos_profile):
    """``item_group -> {station, printer}`` for the register's active stations.

    A station bound to this profile wins over a company-wide one, so a venue
    can override a shared route on one register.
    """
    rows = frappe.db.sql(
        """
        SELECT s.station_name AS station, s.printer AS printer, g.item_group AS item_group,
               IFNULL(s.pos_profile, '') AS pos_profile
        FROM `tabPOS Kitchen Station` s
        INNER JOIN `tabPOS Kitchen Station Item Group` g
                ON g.parent = s.name AND g.parenttype = 'POS Kitchen Station'
        WHERE s.is_active = 1
          AND s.company = %(company)s
          AND (IFNULL(s.pos_profile, '') = '' OR s.pos_profile = %(pos_profile)s)
        ORDER BY IFNULL(s.pos_profile, '') DESC, s.station_name ASC
        """,
        {"company": company, "pos_profile": pos_profile},
        as_dict=True,
    )
    index = {}
    for row in rows or []:
        index.setdefault(row["item_group"], {"station": row["station"], "printer": row["printer"]})
    return index


def _item_groups(item_codes):
    if not item_codes:
        return {}
    rows = frappe.get_all(
        "Item",
        filters={"name": ["in", list(item_codes)]},
        fields=["name", "item_group"],
        ignore_permissions=True,
    )
    return {row["name"]: row["item_group"] for row in rows or []}


def _route(entries, station_index, group_by_item):
    """Group ticket entries into stations, preserving line order."""
    stations = {}
    for entry in entries:
        group = group_by_item.get(entry["item_code"])
        target = station_index.get(group) if group else None
        station = target["station"] if target else GENERAL_STATION
        printer = target["printer"] if target else None
        bucket = stations.setdefault(station, {"station": station, "printer": printer, "lines": []})
        bucket["lines"].append(entry)
    return [stations[key] for key in sorted(stations)]


def _entry(row_or_snapshot, qty, kind, line_uid):
    return {
        "line_uid": line_uid,
        "item_code": row_or_snapshot.get("item_code"),
        "item_name": row_or_snapshot.get("item_name"),
        "qty": flt(qty),
        "notes": row_or_snapshot.get("notes"),
        "course_idx": cint(row_or_snapshot.get("course_idx") or 1),
        "kind": kind,
    }


def _diff(order, snapshot, course_idx):
    """New lines, qty increases, qty reductions and outright cancellations.

    A reduction and a removal are the same thing to a cook — both print on
    the cancellation ticket — so they share a list, distinguished by `kind`.
    """
    fires = []
    cancellations = []
    current = {}

    for row in order.items or []:
        if not row.line_uid:
            continue
        current[row.line_uid] = row
        if course_idx is not None and cint(row.course_idx) != cint(course_idx):
            continue

        as_dict = {
            "item_code": row.item_code,
            "item_name": row.item_name,
            "notes": row.notes,
            "course_idx": row.course_idx,
        }
        previous = flt((snapshot.get(row.line_uid) or {}).get("qty"))
        delta = flt(row.qty) - previous
        if delta > 0:
            fires.append(_entry(as_dict, delta, "new" if not previous else "increase", row.line_uid))
        elif delta < 0:
            cancellations.append(_entry(as_dict, -delta, "reduce", row.line_uid))

    for line_uid, previous in (snapshot or {}).items():
        if line_uid in current:
            continue
        if course_idx is not None and cint(previous.get("course_idx") or 1) != cint(course_idx):
            continue
        cancellations.append(_entry(previous, flt(previous.get("qty")), "cancel", line_uid))

    return fires, cancellations


def _next_snapshot(order, snapshot, course_idx):
    """Snapshot after this fire: target lines refreshed, everything else kept.

    Lines that no longer exist drop out (their cancellation just printed);
    lines of another course keep their previous entry so firing course 2 does
    not make course 1 look unfired.
    """
    live = {row.line_uid: row for row in order.items or [] if row.line_uid}
    updated = {uid: entry for uid, entry in (snapshot or {}).items() if uid in live}

    for line_uid, row in live.items():
        if course_idx is not None and cint(row.course_idx) != cint(course_idx):
            continue
        updated[line_uid] = {
            "qty": flt(row.qty),
            "item_code": row.item_code,
            "item_name": row.item_name,
            "notes": row.notes,
            "course_idx": cint(row.course_idx or 1),
        }
    return updated


@frappe.whitelist(methods=["POST"])
def fire_course(name_or_uid, course_idx=None, client_request_id=None, source_device=None):
    """Send the changes since the last fire to the kitchen.

    First "Send" fires course 1 with no ceremony; a venue that ignores
    coursing never learns the feature exists. Returns
    ``{stations: [{station, printer, lines}], cancellations: [...]}`` — the
    projection the print path renders. Nothing is persisted as a KOT.
    """
    order = get_scoped_order(name_or_uid)

    if order.status != OPEN_STATUS:
        frappe.throw(_("Order {0} is {1} — nothing more can be fired.").format(order.name, order.status))

    if client_request_id and order.posa_client_request_id == client_request_id:
        # Replay of a fire whose ack was lost: the snapshot already absorbed
        # it, so there is genuinely nothing new to print.
        return {
            "order": order.name,
            "stations": [],
            "cancellations": [],
            "replayed": True,
            "fired_at": None,
        }

    course = cint(course_idx) if course_idx not in (None, "") else None
    snapshot = _load_snapshot(order)
    fires, cancellations = _diff(order, snapshot, course)

    fired_at = now_datetime()
    fired_uids = {entry["line_uid"] for entry in fires}
    for row in order.items or []:
        if row.line_uid in fired_uids:
            row.fired = 1
            row.fired_at = fired_at

    order.last_fired = json.dumps(_next_snapshot(order, snapshot, course), separators=(",", ":"))
    if client_request_id:
        order.posa_client_request_id = client_request_id
    order.save(ignore_permissions=True)

    station_index = _station_index(order.company, order.pos_profile)
    group_by_item = _item_groups({entry["item_code"] for entry in fires + cancellations if entry["item_code"]})

    publish_order_change(order, source_device=source_device)

    return {
        "order": order.name,
        "order_uid": order.order_uid,
        "table": order.table,
        "tab_name": order.tab_name,
        "course_idx": course,
        "stations": _route(fires, station_index, group_by_item),
        "cancellations": _route(cancellations, station_index, group_by_item),
        "fired_at": str(fired_at),
        "replayed": False,
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_fire_preview(name_or_uid, course_idx=None):
    """What WOULD print, without firing. Read-only, no snapshot write."""
    frappe.has_permission("POS Table Order", "read", throw=True)
    order = get_scoped_order(name_or_uid)

    course = cint(course_idx) if course_idx not in (None, "") else None
    fires, cancellations = _diff(order, _load_snapshot(order), course)
    station_index = _station_index(order.company, order.pos_profile)
    group_by_item = _item_groups({entry["item_code"] for entry in fires + cancellations if entry["item_code"]})

    return {
        "order": order.name,
        "stations": _route(fires, station_index, group_by_item),
        "cancellations": _route(cancellations, station_index, group_by_item),
    }
