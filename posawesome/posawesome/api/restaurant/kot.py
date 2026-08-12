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
    resolve_order_name,
)

GENERAL_STATION = "General"
VOID_EVENT_PREFIX = "posa-kot-void"


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


def _lock_and_get_scoped_order(name_or_uid):
    """Serialize kitchen diffs for one order inside the caller transaction.

    Resolve the stable document name, lock before reading any mutable order
    state, then authorize from the locked row. Reading first under MariaDB's
    repeatable-read isolation can raise error 1020 after a competing commit.
    """
    if not name_or_uid:
        frappe.throw(_("Order reference is required."))
    rows = frappe.db.sql(
        """SELECT name FROM `tabPOS Table Order`
        WHERE name=%s OR order_uid=%s LIMIT 1 FOR UPDATE""",
        (name_or_uid, name_or_uid), as_dict=True,
    )
    if not rows:
        frappe.throw(_("Table order {0} not found.").format(name_or_uid), frappe.DoesNotExistError)
    name = rows[0].name
    order = frappe.get_doc("POS Table Order", name)
    from posawesome.posawesome.api._scope import assert_company, assert_profile

    assert_profile(frappe.session.user, order.pos_profile)
    assert_company(frappe.session.user, order.company)
    return order


def _station_index(company, pos_profile):
    """``item_group -> {station, printer}`` for the register's active stations.

    A station bound to this profile wins over a company-wide one, so a venue
    can override a shared route on one register.
    """
    rows = frappe.db.sql(
        """
        SELECT s.station_name AS station, s.printer AS printer,
               s.terminal_group AS terminal_group, s.print_format AS print_format,
               IFNULL(s.paper_width_mm, 80) AS paper_width_mm,
               g.item_group AS item_group,
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
        index.setdefault(row["item_group"], {
            "station": row["station"], "printer": row["printer"],
            "terminal_group": row["terminal_group"], "print_format": row["print_format"],
            "paper_width_mm": row["paper_width_mm"],
        })
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
        # Once a line has been fired its station is part of the kitchen's
        # history.  A later station edit must not send its void somewhere that
        # never received the original ticket.  Legacy snapshots have no
        # routing field and deliberately fall back to the current index.
        target = entry.get("routing") or (station_index.get(group) if group else None)
        station = target["station"] if target else GENERAL_STATION
        printer = target["printer"] if target else None
        bucket = stations.setdefault(station, {
            "station": station,
            "printer": printer,
            "terminal_group": target.get("terminal_group") if target else None,
            "print_format": target.get("print_format") if target else None,
            "paper_width_mm": target.get("paper_width_mm", 80) if target else 80,
            "lines": [],
        })
        public_entry = dict(entry)
        public_entry.pop("routing", None)
        bucket["lines"].append(public_entry)
    return [stations[key] for key in sorted(stations)]


def _entry(row_or_snapshot, qty, kind, line_uid):
    entry = {
        "line_uid": line_uid,
        "item_code": row_or_snapshot.get("item_code"),
        "item_name": row_or_snapshot.get("item_name"),
        "qty": flt(qty),
        "notes": row_or_snapshot.get("notes"),
        "course_idx": cint(row_or_snapshot.get("course_idx") or 1),
        "kind": kind,
    }
    if row_or_snapshot.get("routing"):
        entry["routing"] = dict(row_or_snapshot["routing"])
    return entry


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


def _routing_by_line(stations):
    routed = {}
    for station in stations:
        routing = {
            "station": station["station"],
            "printer": station.get("printer"),
            "terminal_group": station.get("terminal_group"),
            "print_format": station.get("print_format"),
            "paper_width_mm": station.get("paper_width_mm") or 80,
        }
        for line in station.get("lines") or []:
            routed[line["line_uid"]] = routing
    return routed


def _next_snapshot(order, snapshot, course_idx, newly_routed=None):
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
        routing = (newly_routed or {}).get(line_uid) or (snapshot.get(line_uid) or {}).get("routing")
        if routing:
            updated[line_uid]["routing"] = dict(routing)
    return updated


def _create_batch(order, event_key, source_event, projection, station_groups):
    if not frappe.db.exists("DocType", "Doco Print Batch"):
        return None

    destinations = []
    for kind, station_rows in station_groups:
        for station in station_rows:
            destinations.append({
                "destination_key": f"{kind}:{station['station']}",
                "channel": "kitchen",
                "terminal_group": station.get("terminal_group"),
                "printer_name": station.get("printer"),
                "print_format": station.get("print_format"),
                "backend": "browser_qz",
                "width_mm": station.get("paper_width_mm") or 80,
                "projection": {"kind": kind, **station},
            })
    if not destinations:
        return None

    from doco.docoutils.printing.jobs import create_batch

    return create_batch(
        event_key=event_key,
        source_doctype="POS Table Order",
        source_name=order.name,
        source_event=source_event,
        projection=projection,
        destinations=destinations,
    )


def render_kot_projection(print_format, projection):
    """Render a frozen station projection without rereading mutable order lines.

    This is an internal adapter for Doco's claimed-job renderer.  Kitchen
    formats are ordinary Print Format records bound to POS Table Order, but
    their `doc` is the immutable event/station projection rather than today's
    POS Table Order document.
    """
    row = frappe.db.get_value(
        "Print Format",
        print_format,
        ["disabled", "doc_type", "html", "css"],
        as_dict=True,
    )
    if not row or row.disabled or row.doc_type != "POS Table Order":
        frappe.throw(_("Kitchen Print Format {0} is unavailable.").format(print_format))
    if not isinstance(projection, dict):
        frappe.throw(_("Kitchen projection must be an object."))

    # frappe.render_template uses Frappe's sandboxed Jinja environment.  Keep
    # both names during migration: new formats use `ticket`; conventional
    # Print Formats can continue to address the projection as `doc`.
    ticket = frappe._dict(projection)
    html = frappe.render_template(row.html or "", {"doc": ticket, "ticket": ticket})
    css = row.css or ""
    return f"{html}<style>{css}</style>" if css else html


@frappe.whitelist(methods=["POST"])
def fire_course(name_or_uid, course_idx=None, client_request_id=None, source_device=None):
    """Send the changes since the last fire to the kitchen.

    First "Send" fires course 1 with no ceremony; a venue that ignores
    coursing never learns the feature exists. Returns
    ``{stations: [{station, printer, lines}], cancellations: [...]}`` — the
    projection the print path renders. Nothing is persisted as a KOT.
    """
    order = _lock_and_get_scoped_order(name_or_uid)

    event_key = f"posa-kot:{order.name}:{client_request_id}" if client_request_id else None

    if order.status != OPEN_STATUS:
        frappe.throw(_("Order {0} is {1} — nothing more can be fired.").format(order.name, order.status))

    if client_request_id and order.posa_client_request_id == client_request_id:
        batch_name = frappe.db.get_value("Doco Print Batch", {"event_key": event_key}, "name")
        if batch_name:
            from doco.docoutils.printing.jobs import get_batch

            persisted = get_batch(batch_name)
            return {**persisted["projection"], "batch": persisted, "replayed": True}
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

    station_index = _station_index(order.company, order.pos_profile)
    group_by_item = _item_groups({entry["item_code"] for entry in fires + cancellations if entry["item_code"]})

    station_fires = _route(fires, station_index, group_by_item)
    station_cancellations = _route(cancellations, station_index, group_by_item)
    projection = {
        "order": order.name,
        "order_uid": order.order_uid,
        "table": order.table,
        "tab_name": order.tab_name,
        "course_idx": course,
        "stations": station_fires,
        "cancellations": station_cancellations,
        "fired_at": str(fired_at),
        "replayed": False,
    }

    order.last_fired = json.dumps(
        _next_snapshot(order, snapshot, course, _routing_by_line(station_fires)),
        separators=(",", ":"),
    )
    if client_request_id:
        order.posa_client_request_id = client_request_id
    order.save(ignore_permissions=True)

    event_key = event_key or f"posa-kot:{order.name}:{frappe.generate_hash(length=16)}"
    batch = _create_batch(
        order,
        event_key,
        "course_fired",
        projection,
        (("fire", station_fires), ("cancel", station_cancellations)),
    )

    publish_order_change(order, source_device=source_device)

    return {**projection, "batch": batch}


def void_order(order):
    """Persist a full-order void ticket using every line's fired routing.

    The event key is intentionally one-per-order.  Cancelling is a terminal
    transition, so request retries must return the original frozen batch
    rather than create a second kitchen void.
    """
    event_key = f"{VOID_EVENT_PREFIX}:{order.name}"
    if frappe.db.exists("DocType", "Doco Print Batch"):
        batch_name = frappe.db.get_value("Doco Print Batch", {"event_key": event_key}, "name")
        if batch_name:
            from doco.docoutils.printing.jobs import get_batch

            persisted = get_batch(batch_name)
            return {**persisted["projection"], "batch": persisted, "replayed": True}

    snapshot = _load_snapshot(order)
    entries = [
        _entry(previous, flt(previous.get("qty")), "void", line_uid)
        for line_uid, previous in snapshot.items()
        if flt(previous.get("qty")) > 0
    ]
    group_by_item = _item_groups({entry["item_code"] for entry in entries if entry["item_code"]})
    stations = _route(entries, _station_index(order.company, order.pos_profile), group_by_item)
    projection = {
        "order": order.name,
        "order_uid": order.order_uid,
        "table": order.table,
        "tab_name": order.tab_name,
        "stations": [],
        "cancellations": stations,
        "voided_at": str(now_datetime()),
        "replayed": False,
    }
    batch = _create_batch(
        order,
        event_key,
        "order_voided",
        projection,
        (("void", stations),),
    )
    return {**projection, "batch": batch}


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
