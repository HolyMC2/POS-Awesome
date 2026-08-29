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
from frappe.utils import add_to_date, cint, flt, now_datetime

from posawesome.posawesome.api.restaurant._tickets import (
    OPEN_STATUS,
    assert_tables_capability,
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
        prior = snapshot.get(row.line_uid) or {}
        # A fired line's station is kitchen history (see _route). The live row
        # carries no routing, so increases and reductions built from it were
        # re-routed by the CURRENT station index — a station edit between
        # fires sent the delta (or its void) to a station that never received
        # the original ticket. Carry the frozen routing forward explicitly;
        # never-fired lines have none and route fresh.
        if prior.get("routing"):
            as_dict["routing"] = prior["routing"]
        previous = flt(prior.get("qty"))
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
    assert_tables_capability(order.pos_profile)

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
def get_fire_batch_status(name_or_uid, batch_name):
    """Durable delivery verdict for one kitchen batch (audit r2 A6).

    "Send" must not silently advance ``last_fired`` while the ticket dies in
    the print queue — the POS polls this after firing and tells the operator
    whether the kitchen actually got paper. Read-only; scoped exactly like
    ``get_fire_preview`` and pinned to the batch's own source order so a
    register cannot read another order's print traffic.
    """
    frappe.has_permission("POS Table Order", "read", throw=True)
    order = get_scoped_order(name_or_uid)
    assert_tables_capability(order.pos_profile)

    if not batch_name or not frappe.db.exists("DocType", "Doco Print Batch"):
        return {"batch": batch_name, "status": "unavailable", "jobs": []}

    row = frappe.db.get_value(
        "Doco Print Batch",
        batch_name,
        ["name", "status", "source_doctype", "source_name"],
        as_dict=True,
    )
    if not row or row.source_doctype != "POS Table Order" or row.source_name != order.name:
        frappe.throw(
            _("Print batch {0} does not belong to order {1}.").format(batch_name, order.name),
            frappe.PermissionError,
        )

    jobs = frappe.get_all(
        "Doco Print Job",
        filters={"batch": row.name},
        fields=["destination_key", "status"],
        order_by="creation asc",
        ignore_permissions=True,
    )
    return {"batch": row.name, "status": row.status, "jobs": [dict(job) for job in jobs]}


@frappe.whitelist(methods=["GET", "POST"])
def get_fire_preview(name_or_uid, course_idx=None):
    """What WOULD print, without firing. Read-only, no snapshot write."""
    frappe.has_permission("POS Table Order", "read", throw=True)
    order = get_scoped_order(name_or_uid)
    assert_tables_capability(order.pos_profile)

    course = cint(course_idx) if course_idx not in (None, "") else None
    fires, cancellations = _diff(order, _load_snapshot(order), course)
    station_index = _station_index(order.company, order.pos_profile)
    group_by_item = _item_groups({entry["item_code"] for entry in fires + cancellations if entry["item_code"]})

    return {
        "order": order.name,
        "stations": _route(fires, station_index, group_by_item),
        "cancellations": _route(cancellations, station_index, group_by_item),
    }


# How far back the comandas board looks. A service window, not an archive:
# yesterday's tickets are the closing report's business, not the kitchen's.
BOARD_WINDOW_HOURS = 12


def _board_lines(station_groups):
    """Flatten a frozen projection's station groups for the board card."""
    lines = []
    for group in station_groups or []:
        station = group.get("station") or GENERAL_STATION
        for line in group.get("lines") or []:
            lines.append(
                {
                    "item": line.get("item_name") or line.get("item_code") or "?",
                    "qty": flt(line.get("qty") or 0),
                    "station": station,
                }
            )
    return lines


@frappe.whitelist(methods=["GET", "POST"])
def list_kitchen_batches(pos_profile, limit=30):
    """The comandas board's read (critique B2, 08-29).

    Every fire already leaves a durable trace — a ``Doco Print Batch`` with
    the frozen projection and a per-station delivery verdict — and until now
    nothing projected it: the floor answered "which table do I open?" and
    nobody could answer "what is in the kitchen and how old is it?". This
    read is that projection: the register's kitchen tickets from the last
    :data:`BOARD_WINDOW_HOURS`, newest first, each carrying its table, its
    frozen lines, its print status and its age — enough for a board with
    en-cocina / impresas / falladas lanes and nothing invented (a "servida"
    lane needs a KDS bump, which does not exist yet — see critique B3).

    Scoped like ``get_floor_snapshot``: the profile assert plus the doctype
    read gate, because the profile name comes from the client and this read
    returns another register's kitchen traffic without it. Batches are then
    joined THROUGH their source order's ``pos_profile`` — a batch whose order
    belongs to another register is silently not yours to see.
    """
    from posawesome.posawesome.api._scope import assert_profile

    assert_profile(frappe.session.user, pos_profile)
    assert_tables_capability(pos_profile)
    frappe.has_permission("POS Table Order", "read", throw=True)

    server_time = str(now_datetime())
    if not frappe.db.exists("DocType", "Doco Print Batch"):
        return {"batches": [], "server_time": server_time}

    limit = min(max(cint(limit) or 30, 1), 100)
    # The lifecycle columns land by patch (add_kitchen_ticket_state_fields);
    # a site mid-rollout must keep its board rather than 500 on a column the
    # migrate has not created yet — the servida lane simply stays empty.
    has_state = frappe.db.has_column("Doco Print Batch", "posa_rt_kitchen_state")
    fields = [
        "name",
        "status",
        "source_name",
        "event_key",
        "creation",
        "owner",
        "projection_json",
        "job_count",
        "sent_count",
        "failed_count",
    ]
    if has_state:
        fields += ["posa_rt_kitchen_state", "posa_rt_bumped_at", "posa_rt_bumped_by"]
    rows = frappe.get_all(
        "Doco Print Batch",
        filters={
            "source_doctype": "POS Table Order",
            "event_key": ["like", "posa-kot%"],
            "creation": [">=", add_to_date(now_datetime(), hours=-BOARD_WINDOW_HOURS)],
        },
        fields=fields,
        order_by="creation desc",
        # Overfetch: the profile join below drops other registers' traffic,
        # and a busy multi-register site would otherwise starve the board.
        limit_page_length=limit * 4,
        ignore_permissions=True,
    )

    order_names = list({row.source_name for row in rows if row.source_name})
    orders = {}
    if order_names:
        for order in frappe.get_all(
            "POS Table Order",
            filters={"name": ["in", order_names], "pos_profile": pos_profile},
            fields=["name", "table", "tab_name", "status"],
            ignore_permissions=True,
        ):
            orders[order.name] = order

    batches = []
    for row in rows:
        order = orders.get(row.source_name)
        if not order:
            continue
        try:
            projection = json.loads(row.projection_json or "{}")
        except (TypeError, ValueError):
            projection = {}
        if not isinstance(projection, dict):
            projection = {}
        batches.append(
            {
                "name": row.name,
                "status": row.status,
                "is_void": str(row.event_key or "").startswith(VOID_EVENT_PREFIX),
                "fired_at": str(row.creation),
                "fired_by": row.owner,
                "table": order.table,
                "tab_name": order.tab_name,
                "order_status": order.status,
                "lines": _board_lines(projection.get("stations")),
                "cancellations": _board_lines(projection.get("cancellations")),
                "job_count": cint(row.job_count),
                "sent_count": cint(row.sent_count),
                "failed_count": cint(row.failed_count),
                "kitchen_state": (row.get("posa_rt_kitchen_state") or "") if has_state else "",
                "bumped_at": str(row.get("posa_rt_bumped_at") or "") if has_state else "",
                "bumped_by": (row.get("posa_rt_bumped_by") or "") if has_state else "",
            }
        )
        if len(batches) >= limit:
            break

    return {"batches": batches, "server_time": server_time}


def _scoped_kitchen_batch(pos_profile, batch_name):
    """The write-side twin of the board's join: profile assert, capability,
    then prove the batch's source order belongs to THIS register before any
    state moves. A bump on another register's ticket is the same horizontal
    IDOR the read already refuses — silently there, loudly here."""
    from posawesome.posawesome.api._scope import assert_profile

    assert_profile(frappe.session.user, pos_profile)
    assert_tables_capability(pos_profile)
    frappe.has_permission("POS Table Order", "write", throw=True)

    if not frappe.db.exists("DocType", "Doco Print Batch"):
        frappe.throw(_("This site has no kitchen ticket spine."))
    if not frappe.db.has_column("Doco Print Batch", "posa_rt_kitchen_state"):
        frappe.throw(_("Kitchen ticket states are not installed yet — run migrate."))

    row = frappe.db.get_value(
        "Doco Print Batch",
        batch_name,
        ["name", "source_doctype", "source_name", "event_key"],
        as_dict=True,
    )
    if (
        not row
        or row.source_doctype != "POS Table Order"
        or not str(row.event_key or "").startswith("posa-kot")
    ):
        frappe.throw(_("Kitchen ticket {0} does not exist.").format(batch_name))
    order_profile = frappe.db.get_value("POS Table Order", row.source_name, "pos_profile")
    if order_profile != pos_profile:
        frappe.throw(
            _("Kitchen ticket {0} does not belong to this register.").format(batch_name),
            frappe.PermissionError,
        )
    return row


@frappe.whitelist(methods=["POST"])
def bump_kitchen_ticket(pos_profile, batch_name):
    """Mark one kitchen ticket served (critique B3) — idempotent.

    This verb is the whole lifecycle: printed paper says nothing about
    whether the food left the pass, and the «servida» lane must come from a
    human act, not from a printer verdict. Today the comandas board presses
    it; the KDS (critique D1) will press the SAME verb from a kitchen
    screen, which is why it lives here and nowhere else.
    """
    row = _scoped_kitchen_batch(pos_profile, batch_name)
    if frappe.db.get_value("Doco Print Batch", row.name, "posa_rt_kitchen_state") == "Bumped":
        return {"batch": row.name, "kitchen_state": "Bumped", "already": True}
    frappe.db.set_value(
        "Doco Print Batch",
        row.name,
        {
            "posa_rt_kitchen_state": "Bumped",
            "posa_rt_bumped_at": now_datetime(),
            "posa_rt_bumped_by": frappe.session.user,
        },
        update_modified=False,
    )
    return {"batch": row.name, "kitchen_state": "Bumped", "already": False}


@frappe.whitelist(methods=["POST"])
def recall_kitchen_ticket(pos_profile, batch_name):
    """Undo a bump — the expo pulled the plate back. Clears the state; the
    bump columns clear with it so a later bump is a fresh fact, not an edit
    of a stale one."""
    row = _scoped_kitchen_batch(pos_profile, batch_name)
    frappe.db.set_value(
        "Doco Print Batch",
        row.name,
        {
            "posa_rt_kitchen_state": "",
            "posa_rt_bumped_at": None,
            "posa_rt_bumped_by": None,
        },
        update_modified=False,
    )
    return {"batch": row.name, "kitchen_state": ""}
