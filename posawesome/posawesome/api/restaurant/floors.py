# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""Floor snapshot + floor-layout persistence.

The snapshot is ONE grouped query, never a count per tile — the in-house
precedent is `taller/taller/api/floor_plan.py:44-64`, and the floor screen is
the hot path a year of restaurant volume runs through (spec F9).

The layout save honours the client's `modified` token. The invoice path
deliberately STRIPS `modified` to dodge TimestampMismatchError; the floor path
must do the opposite, or the second concurrent manager silently wipes the
first's additions (spec §6.3).
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, now_datetime, nowdate

from posawesome.posawesome.api.restaurant._tickets import (
    OPEN_STATUS,
    _publish_floor_update,
    assert_tables_capability,
    register_open_shifts,
)

FLOOR_FIELDS = ("name", "floor_uid", "floor_name", "company", "pos_profile", "sequence", "layout", "modified")
TABLE_FIELDS = (
    "name",
    "table_uid",
    "table_label",
    "floor",
    "seats",
    "layout",
    "occupied",
    "needs_cleaning",
    "bill_printed_at",
    "modified",
)


def _assert_read_scope(pos_profile, company):
    """Doctype read permission AND the tenant boundary.

    §1.1 puts read-only endpoints on `has_permission` rather than `_scope`,
    but this endpoint takes a pos_profile from the client and returns that
    register's floors, tables and live tickets. Without the profile assert a
    cashier could name another store's profile and read its board — the same
    horizontal IDOR the offline-sync readers were hardened against. Both
    gates, not one.
    """
    from posawesome.posawesome.api._scope import assert_company, assert_profile

    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, company)
    frappe.has_permission("POS Floor", "read", throw=True)
    frappe.has_permission("POS Table", "read", throw=True)


def _visible_floors(pos_profile, company, floor=None):
    """Active floors of the company this register may render.

    A floor with a blank `pos_profile` serves every register of the company.
    That is filtered in Python on purpose: a SQL `IN ('profile', '')` never
    matches NULL, so the blank-profile floors would silently vanish.
    """
    filters = {"company": company, "is_active": 1}
    if floor:
        filters["name"] = floor
    rows = frappe.get_all(
        "POS Floor",
        filters=filters,
        fields=list(FLOOR_FIELDS),
        order_by="sequence asc, floor_name asc",
        ignore_permissions=True,
    )
    return [row for row in rows or [] if not row.get("pos_profile") or row["pos_profile"] == pos_profile]


def _open_orders_for(pos_profile, shifts, max_age_days):
    """Open orders of the register, with per-order line aggregates.

    ONE grouped query. `items_count` / `unsent_count` / `total` come from the
    same pass as the order row, so a floor of 40 tables is one round trip.

    Orders carrying no shift (opened while the register had none open) stay
    visible but are bounded by age — otherwise an orphan from May sits on the
    board forever.
    """
    conditions = ["o.status = %(open_status)s", "o.pos_profile = %(pos_profile)s"]
    params = {
        "open_status": OPEN_STATUS,
        "pos_profile": pos_profile,
        "cutoff": add_days(nowdate(), -abs(cint(max_age_days))),
    }

    if shifts:
        placeholders = ", ".join([f"%(shift_{i})s" for i in range(len(shifts))])
        for index, shift in enumerate(shifts):
            params[f"shift_{index}"] = shift
        conditions.append(
            f"(o.pos_opening_shift IN ({placeholders})"
            " OR (IFNULL(o.pos_opening_shift, '') = '' AND o.creation >= %(cutoff)s))"
        )
    else:
        conditions.append("(IFNULL(o.pos_opening_shift, '') = '' AND o.creation >= %(cutoff)s)")

    rows = frappe.db.sql(
        """
        SELECT o.name                AS name,
               o.order_uid           AS order_uid,
               o.`table`             AS `table`,
               o.status              AS status,
               o.tab_name            AS tab_name,
               o.guest_count         AS guest_count,
               o.opened_by           AS opened_by,
               o.waiter              AS waiter,
               o.customer            AS customer,
               o.service_type        AS service_type,
               o.pos_opening_shift   AS pos_opening_shift,
               o.modified            AS modified,
               COUNT(i.name)                                          AS items_count,
               SUM(CASE WHEN IFNULL(i.fired, 0) = 0 THEN 1 ELSE 0 END) AS unsent_count,
               COALESCE(SUM(i.amount), 0)                             AS total
        FROM `tabPOS Table Order` o
        LEFT JOIN `tabPOS Table Order Item` i
               ON i.parent = o.name AND i.parenttype = 'POS Table Order'
        WHERE {conditions}
        GROUP BY o.name, o.order_uid, o.`table`, o.status, o.tab_name, o.guest_count,
                 o.opened_by, o.waiter, o.customer, o.service_type,
                 o.pos_opening_shift, o.modified
        ORDER BY o.creation ASC
        """.format(conditions=" AND ".join(conditions)),
        params,
        as_dict=True,
    )

    return [
        {
            "name": row["name"],
            "order_uid": row["order_uid"],
            "table": row["table"],
            "status": row["status"],
            "tab_name": row["tab_name"],
            "guest_count": cint(row["guest_count"]),
            "opened_by": row["opened_by"],
            "waiter": row["waiter"],
            "customer": row["customer"],
            "service_type": row["service_type"],
            "items_count": cint(row["items_count"]),
            "unsent_count": cint(row["unsent_count"]),
            "total": flt(row["total"]),
            "modified": str(row["modified"]) if row["modified"] else None,
        }
        for row in rows or []
    ]


@frappe.whitelist(methods=["GET", "POST"])
def get_floor_snapshot(pos_profile, company=None, floor=None, max_age_days=3):
    """Everything the floor screen renders, in three queries.

    Returns ``{floors, tables, orders, server_time}``. Table board state is
    included as the reconciled hint; `orders` is the truth the client derives
    free/seated/ordered from.
    """
    _assert_read_scope(pos_profile, company)
    assert_tables_capability(pos_profile)
    if not company:
        company = frappe.db.get_value("POS Profile", pos_profile, "company")

    floors = _visible_floors(pos_profile, company, floor)
    floor_names = [row["name"] for row in floors]

    tables = []
    if floor_names:
        tables = (
            frappe.get_all(
                "POS Table",
                filters={"floor": ["in", floor_names], "is_active": 1},
                fields=list(TABLE_FIELDS),
                order_by="table_label asc",
                ignore_permissions=True,
            )
            or []
        )

    shifts = register_open_shifts(pos_profile, max_age_days=max_age_days)
    orders = _open_orders_for(pos_profile, shifts, max_age_days)

    return {
        "floors": [dict(row) for row in floors],
        "tables": [dict(row) for row in tables],
        "orders": orders,
        "server_time": str(now_datetime()),
    }


# ---------------------------------------------------------------------------
# layout persistence
# ---------------------------------------------------------------------------


def _coerce_json_arg(value, label):
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        frappe.throw(_("{0} must be valid JSON.").format(label))


def _upsert_table(floor_doc, payload):
    """Insert-or-update one table row of the layout payload.

    Keyed on `table_uid`, so an offline editor that created a table before
    the save landed updates its own row rather than spawning a twin.
    """
    uid = (payload or {}).get("table_uid")
    if not uid:
        frappe.throw(_("Every table in the layout payload needs a table_uid."))

    name = frappe.db.get_value("POS Table", {"table_uid": uid}, "name")
    if name:
        doc = frappe.get_doc("POS Table", name)
        if doc.floor != floor_doc.name:
            frappe.throw(
                _("Table {0} belongs to floor {1} — move it with a transfer, not a layout save.").format(
                    uid, doc.floor
                )
            )
    else:
        doc = frappe.new_doc("POS Table")
        doc.table_uid = uid
        doc.floor = floor_doc.name

    if payload.get("table_label") is not None:
        doc.table_label = payload["table_label"]
    if payload.get("seats") is not None:
        doc.seats = cint(payload["seats"])
    if payload.get("is_active") is not None:
        doc.is_active = cint(payload["is_active"])
    if "layout" in payload:
        # Always re-serialise. The column is a native JSON type and MariaDB
        # enforces a JSON CHECK on it, so a raw string from the client would
        # surface as an opaque constraint error instead of a usable message.
        geometry = _coerce_json_arg(payload.get("layout"), _("Table layout"))
        doc.layout = json.dumps(geometry, separators=(",", ":")) if geometry is not None else None

    if not doc.table_label:
        doc.table_label = uid[:8]

    doc.save(ignore_permissions=True)
    return doc.name


@frappe.whitelist(methods=["POST"])
def save_floor_layout(
    pos_profile,
    company,
    floor,
    layout=None,
    tables=None,
    modified=None,
    source_device=None,
):
    """Persist the plan's canvas + its table geometry under a concurrency token.

    `modified` is the floor's timestamp as the editor last read it. A drift
    means another manager saved in between, and last-write-wins would drop
    their additions — raise instead and let the client re-read.

    `source_device` is echoed on the broadcast so the editor that just saved
    ignores its own occupancy ping instead of coalescing a needless refresh.
    Every other mutation in this package already stamps it.
    """
    from posawesome.posawesome.api._scope import assert_company, assert_profile

    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, company)
    assert_tables_capability(pos_profile)
    frappe.has_permission("POS Floor", "write", throw=True)
    frappe.has_permission("POS Table", "write", throw=True)

    floor_doc = frappe.get_doc("POS Floor", floor)
    if floor_doc.company != company:
        frappe.throw(_("Floor {0} does not belong to company {1}.").format(floor, company))

    if modified and str(floor_doc.modified) != str(modified):
        frappe.throw(
            _("This floor plan changed since you opened it. Reload before saving."),
            frappe.TimestampMismatchError,
        )

    parsed_layout = _coerce_json_arg(layout, _("Layout"))
    if parsed_layout is not None:
        floor_doc.layout = json.dumps(parsed_layout, separators=(",", ":"))
        floor_doc.save(ignore_permissions=True)

    table_rows = _coerce_json_arg(tables, _("Tables")) or []
    if not isinstance(table_rows, list):
        frappe.throw(_("Tables must be a JSON list."))
    saved = [_upsert_table(floor_doc, row) for row in table_rows]

    _publish_floor_update(floor_doc.name, source_device=source_device)

    fresh = frappe.get_doc("POS Floor", floor_doc.name)
    return {
        "floor": fresh.name,
        "modified": str(fresh.modified),
        "saved_tables": saved,
        "tables": frappe.get_all(
            "POS Table",
            filters={"floor": fresh.name, "is_active": 1},
            fields=list(TABLE_FIELDS),
            order_by="table_label asc",
            ignore_permissions=True,
        )
        or [],
    }


@frappe.whitelist(methods=["POST"])
def mark_table_clean(pos_profile, company, table, source_device=None):
    """Clear the bussing latch settle sets (needs_cleaning=1, spec §0.2/§3).

    Without this, the flag is one-way: after its first settle a table shows
    the broom forever and the kanban's cleaning column only ever grows.

    Deliberately NOT gated on POS Table write permission: bussing is a
    counter action, and the settle path already flips this same flag under
    cashier permissions via db.set_value. Scope asserts + the fetched
    company check are the tenant boundary (spec §1.1); the flag write
    touches nothing but the two bussing fields.
    """
    from posawesome.posawesome.api._scope import assert_company, assert_profile

    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, company)
    assert_tables_capability(pos_profile)

    table_doc = frappe.get_doc("POS Table", table)
    floor_company = frappe.db.get_value("POS Floor", table_doc.floor, "company")
    if floor_company != company:
        frappe.throw(_("Table {0} does not belong to company {1}.").format(table, company))

    frappe.db.set_value(
        "POS Table",
        table_doc.name,
        {"needs_cleaning": 0, "bill_printed_at": None},
        update_modified=True,
    )

    _publish_floor_update(table_doc.floor, source_device=source_device)

    return {"table": table_doc.name, "needs_cleaning": 0}
