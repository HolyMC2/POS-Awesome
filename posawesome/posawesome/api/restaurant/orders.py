# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

"""Open / update / transfer / cancel the Record-Only table ticket.

The update path is a PER-LINE UNION, never a whole-document replace. Two
waiters on one table is not an edge case — Odoo carries dedicated repair code
for it — and last-write-wins silently deletes one of their orders (spec §6.1).
Server lines absent from an incoming payload SURVIVE; a deletion has to be
named explicitly in ``removed_line_uids``, and a line already sent to the
kitchen refuses removal outright.

Idempotency is our own, not the submit ledger's: ``update_invoice`` does no
ledger lookup, so two calls with one id make two drafts (spec §6.2). Every
endpoint here dedupes on ``posa_client_request_id`` / ``order_uid`` itself.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from posawesome.posawesome.api.restaurant._tickets import (
    OPEN_STATUS,
    assert_tables_capability,
    get_scoped_order,
    open_order_filters,
    publish_order_change,
    resolve_order_name,
)

LINE_SCALARS = ("item_code", "item_name", "qty", "uom", "rate", "notes", "course_idx")


# ---------------------------------------------------------------------------
# payload shaping
# ---------------------------------------------------------------------------


def _line_payload(row):
    return {
        "line_uid": row.line_uid,
        "item_code": row.item_code,
        "item_name": row.item_name,
        "qty": flt(row.qty),
        "uom": row.uom,
        "rate": flt(row.rate),
        "amount": flt(row.amount),
        "notes": row.notes,
        "course_idx": cint(row.course_idx),
        "fired": cint(row.fired),
        "fired_at": str(row.fired_at) if row.fired_at else None,
    }


def order_payload(doc, existing=False, rejected_removals=None):
    return {
        "name": doc.name,
        "order_uid": doc.order_uid,
        "table": doc.table,
        "status": doc.status,
        "pos_profile": doc.pos_profile,
        "company": doc.company,
        "pos_opening_shift": doc.pos_opening_shift,
        "tab_name": doc.tab_name,
        "guest_count": cint(doc.guest_count),
        "service_type": doc.service_type,
        "customer": doc.customer,
        "opened_by": doc.opened_by,
        "waiter": doc.waiter,
        # Wire name frozen for the offline wrapper; the stored field behind it
        # is the `settled_invoice` Dynamic Link (POS-Invoice-mode tenants
        # settle into a POS Invoice, which a plain Link could not hold).
        "sales_invoice": doc.settled_invoice,
        "modified": str(doc.modified),
        "items": [_line_payload(row) for row in doc.items or []],
        "existing": bool(existing),
        "rejected_removals": list(rejected_removals or []),
    }


def _coerce_list(value, label):
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return value
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        frappe.throw(_("{0} must be valid JSON.").format(label))
        return []
    if not isinstance(parsed, list):
        frappe.throw(_("{0} must be a JSON list.").format(label))
    return parsed


# ---------------------------------------------------------------------------
# open
# ---------------------------------------------------------------------------


def _current_user_shift(pos_profile):
    """The caller's own open shift on this register, or None.

    Binding is best-effort on purpose: a waiter with no shift open still
    needs to seat a table, and the order stays visible because the floor
    predicate also admits shift-less orders inside the staleness window.
    """
    return frappe.db.get_value(
        "POS Opening Shift",
        {
            "user": frappe.session.user,
            "pos_profile": pos_profile,
            "status": "Open",
            "docstatus": 1,
            "pos_closing_shift": ["is", "not set"],
        },
        "name",
    )


def _dedupe_open(pos_profile, client_request_id, order_uid, table):
    """Return an existing order this open call should resolve to, or None.

    Three ways the same tap arrives twice: a retried request (same
    client_request_id), a replayed queue entry (same order_uid), and a second
    waiter tapping a table that is already busy (tap-to-open).
    """
    if client_request_id:
        name = frappe.db.get_value(
            "POS Table Order",
            {"posa_client_request_id": client_request_id, "pos_profile": pos_profile},
            "name",
        )
        if name:
            return frappe.get_doc("POS Table Order", name)

    if order_uid:
        name = frappe.db.get_value("POS Table Order", {"order_uid": order_uid}, "name")
        if name:
            return frappe.get_doc("POS Table Order", name)

    if table:
        names = frappe.get_all(
            "POS Table Order",
            filters=open_order_filters(table=table),
            pluck="name",
            order_by="creation asc",
            limit_page_length=1,
        )
        if names:
            return frappe.get_doc("POS Table Order", names[0])

    return None


@frappe.whitelist(methods=["POST"])
def open_table_order(
    pos_profile,
    company,
    client_request_id=None,
    order_uid=None,
    table=None,
    tab_name=None,
    guest_count=None,
    service_type=None,
    customer=None,
    source_device=None,
):
    """Seat a table (or open a named tab). Tapping IS the transition.

    There is no "seat party" dialog and no status dropdown: one open order on
    the table → return it; none → create one.
    """
    from posawesome.posawesome.api._scope import (
        assert_company,
        assert_customer_in_profile,
        assert_profile,
    )

    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, company)
    assert_customer_in_profile(frappe.session.user, customer, pos_profile)
    assert_tables_capability(pos_profile)

    if table and not frappe.db.exists("POS Table", table):
        frappe.throw(_("Table {0} not found.").format(table), frappe.DoesNotExistError)

    existing = _dedupe_open(pos_profile, client_request_id, order_uid, table)
    if existing:
        return order_payload(existing, existing=True)

    doc = frappe.new_doc("POS Table Order")
    doc.order_uid = order_uid or frappe.generate_hash(length=22)
    doc.table = table or None
    doc.pos_profile = pos_profile
    doc.company = company
    doc.pos_opening_shift = _current_user_shift(pos_profile)
    doc.status = OPEN_STATUS
    doc.tab_name = tab_name
    doc.guest_count = cint(guest_count) if guest_count else 0
    doc.service_type = service_type
    doc.customer = customer
    doc.opened_by = frappe.session.user
    doc.waiter = frappe.session.user
    doc.posa_client_request_id = client_request_id
    doc.insert(ignore_permissions=True)

    publish_order_change(doc, source_device=source_device)
    return order_payload(doc)


# ---------------------------------------------------------------------------
# update — the per-line union
# ---------------------------------------------------------------------------


def _apply_incoming_lines(doc, lines):
    """Upsert incoming lines by `line_uid`; leave every other server line alone."""
    by_uid = {row.line_uid: row for row in doc.items or [] if row.line_uid}

    for incoming in lines:
        if not isinstance(incoming, dict):
            continue
        uid = incoming.get("line_uid")
        if not uid:
            frappe.throw(_("Every incoming line needs a line_uid."))

        row = by_uid.get(uid)
        if row is None:
            item_code = incoming.get("item_code")
            if not item_code:
                frappe.throw(_("Line {0} has no item_code.").format(uid))
            if not frappe.db.exists("Item", item_code):
                frappe.throw(_("Item {0} not found.").format(item_code), frappe.DoesNotExistError)
            row = doc.append("items", {"line_uid": uid, "item_code": item_code})
            by_uid[uid] = row

        for field in LINE_SCALARS:
            if field in incoming and incoming[field] is not None:
                row.set(field, incoming[field])
        # amount is recomputed in the controller — never taken from the client.


def _apply_removals(doc, removed_line_uids):
    """Remove named lines, refusing anything already sent to the kitchen.

    A fired line has been cooked. Dropping it because an offline device
    replayed a stale removal would leave the kitchen ticket and the bill
    disagreeing, so the removal is rejected and reported back instead.
    """
    if not removed_line_uids:
        return []

    wanted = {uid for uid in removed_line_uids if uid}
    rejected = []
    keep = []
    for row in doc.items or []:
        if row.line_uid in wanted:
            if cint(row.fired):
                rejected.append(row.line_uid)
                keep.append(row)
            continue
        keep.append(row)

    doc.set("items", keep)
    return rejected


@frappe.whitelist(methods=["POST"])
def update_table_order(
    name_or_uid,
    client_request_id=None,
    lines=None,
    removed_line_uids=None,
    tab_name=None,
    guest_count=None,
    service_type=None,
    customer=None,
    source_device=None,
):
    """Merge a device's view of the ticket into the server's.

    Returns the full order state plus ``rejected_removals`` — the lines the
    caller asked to drop that were already fired.
    """
    doc = get_scoped_order(name_or_uid)
    assert_tables_capability(doc.pos_profile)

    # A retried request must not append its lines a second time. The id of
    # the last applied write lives on the order, so a replay is a read.
    if client_request_id and doc.posa_client_request_id == client_request_id:
        return order_payload(doc, existing=True)

    if doc.status != OPEN_STATUS:
        frappe.throw(
            _("Order {0} is {1} and can no longer be edited.").format(doc.name, doc.status)
        )

    from posawesome.posawesome.api._scope import assert_customer_in_profile

    if customer is not None:
        assert_customer_in_profile(frappe.session.user, customer, doc.pos_profile)

    _apply_incoming_lines(doc, _coerce_list(lines, _("Lines")))
    rejected = _apply_removals(doc, _coerce_list(removed_line_uids, _("Removed line uids")))

    for field, value in (
        ("tab_name", tab_name),
        ("guest_count", cint(guest_count) if guest_count not in (None, "") else None),
        ("service_type", service_type),
        ("customer", customer),
    ):
        if value is not None:
            doc.set(field, value)

    if client_request_id:
        doc.posa_client_request_id = client_request_id
    doc.save(ignore_permissions=True)

    publish_order_change(doc, source_device=source_device)
    return order_payload(doc, rejected_removals=rejected)


# ---------------------------------------------------------------------------
# transfer / cancel
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def transfer_table_order(name_or_uid, to_table, client_request_id=None, source_device=None):
    """Move a ticket to an EMPTY table. Merge is phase 2.

    Transfer is trivial precisely because table status is derived: reparent
    the FK and both boards repaint. Landing on an occupied table would create
    a second invisible order for the same party, so it throws.
    """
    doc = get_scoped_order(name_or_uid)
    assert_tables_capability(doc.pos_profile)

    if doc.status != OPEN_STATUS:
        frappe.throw(_("Only an open order can be transferred (this one is {0}).").format(doc.status))
    if not to_table:
        frappe.throw(_("Destination table is required."))
    if not frappe.db.exists("POS Table", to_table):
        frappe.throw(_("Table {0} not found.").format(to_table), frappe.DoesNotExistError)

    previous_table = doc.table
    if previous_table == to_table:
        return order_payload(doc, existing=True)

    if client_request_id and doc.posa_client_request_id == client_request_id:
        return order_payload(doc, existing=True)

    occupied_by = frappe.get_all(
        "POS Table Order",
        filters=open_order_filters(table=to_table),
        pluck="name",
        limit_page_length=1,
    )
    if occupied_by:
        frappe.throw(
            _("Table {0} already has open order {1}. Merging two parties is not supported yet.").format(
                to_table, occupied_by[0]
            )
        )

    doc.table = to_table
    if client_request_id:
        doc.posa_client_request_id = client_request_id
    doc.save(ignore_permissions=True)

    publish_order_change(doc, previous_table=previous_table, source_device=source_device)
    return order_payload(doc)


@frappe.whitelist(methods=["POST"])
def cancel_table_order(name_or_uid, client_request_id=None, source_device=None):
    """Release the table. Cancelled orders keep their FK for reporting."""
    doc = get_scoped_order(name_or_uid)
    assert_tables_capability(doc.pos_profile)

    if doc.status == "Cancelled":
        from posawesome.posawesome.api.restaurant.kot import void_order

        result = order_payload(doc, existing=True)
        result["kitchen_void"] = void_order(doc)
        return result
    if doc.status == "Settled":
        frappe.throw(_("Order {0} already settled into {1}.").format(doc.name, doc.settled_invoice))

    # Persist the frozen per-station void batch in the same transaction as
    # the terminal order transition.  If the save rolls back, the batch rolls
    # back too; a lost response replays the deterministic batch event key.
    from posawesome.posawesome.api.restaurant.kot import void_order

    kitchen_void = void_order(doc)
    doc.status = "Cancelled"
    if client_request_id:
        doc.posa_client_request_id = client_request_id
    doc.save(ignore_permissions=True)

    publish_order_change(doc, source_device=source_device)
    result = order_payload(doc)
    result["kitchen_void"] = kitchen_void
    return result


@frappe.whitelist(methods=["GET", "POST"])
def get_table_order(name_or_uid):
    """Read one ticket — the client's authoritative pull after a socket hint."""
    frappe.has_permission("POS Table Order", "read", throw=True)
    doc = get_scoped_order(resolve_order_name(name_or_uid))
    assert_tables_capability(doc.pos_profile)
    return order_payload(doc)
