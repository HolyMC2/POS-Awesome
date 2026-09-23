"""Runtime pointer rows and the shared opening exclusion (FND-02).

Lock order (spec 01 §7): receipt → cashier runtime rows (sorted) → register
runtime rows (sorted) → opening shifts. Rows are created with INSERT IGNORE so
two racing first-time openings serialize on the primary key instead of
failing, then both take ``SELECT … FOR UPDATE``. Legacy profile openings use
the same cashier row, so one legacy and one register shift can never coexist
for one cashier.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, now_datetime

from .errors import fail
from .receipts import service_write


def _ensure(doctype, name, values):
    table = f"tab{doctype}"
    now = now_datetime()
    columns = ["name", "creation", "modified", "owner", "modified_by", "docstatus", "idx"] + list(values)
    params = [name, now, now, "Administrator", "Administrator", 0, 0] + list(values.values())
    frappe.db.sql(
        f"INSERT IGNORE INTO `{table}` ({', '.join('`' + c + '`' for c in columns)}) "
        f"VALUES ({', '.join(['%s'] * len(columns))})", params)


def lock_cashier(user):
    """Create-if-missing and lock the cashier's runtime row."""
    if not frappe.db.table_exists("POS Cashier Runtime"):
        return None
    _ensure("POS Cashier Runtime", user, {"user": user, "revision": 1})
    return frappe.db.get_value("POS Cashier Runtime", user, "*", as_dict=True, for_update=True)


def lock_register(register, store):
    _ensure("POS Register Runtime", register, {"register": register, "store": store,
                                               "work_state": "Available", "ownership_generation": 0,
                                               "row_revision": 1})
    return frappe.db.get_value("POS Register Runtime", register, "*", as_dict=True, for_update=True)


def _shift_open(name) -> bool:
    if not name:
        return False
    row = frappe.db.get_value("POS Opening Shift", name, ["status", "docstatus"], as_dict=True)
    return bool(row and row.status == "Open" and cint(row.docstatus) == 1)


def assert_cashier_free(user, cashier_row):
    """Common user-level exclusion used by legacy and register openings.

    Called after the cashier runtime row is locked. The legacy query remains
    the authority for shifts opened by old clients or Desk.
    """
    pointer = cashier_row.get("accountable_shift") if cashier_row else None
    if pointer and _shift_open(pointer):
        fail("invalid_state", "You already have an open shift ({0}). Close it before opening another.",
             ["resume_shift", "close_shift"], args=(pointer,))
    existing = frappe.db.get_all("POS Opening Shift", filters={
        "user": user, "pos_closing_shift": ["is", "not set"], "docstatus": 1, "status": "Open"},
        fields=["name", "pos_profile"], order_by="period_start_date desc", limit=1)
    if existing:
        fail("invalid_state", "You already have an open shift ({0}) on POS Profile {1}. Close it before opening a new one.",
             ["resume_shift", "close_shift"], args=(existing[0].name, existing[0].pos_profile))


def point_cashier(user, shift, register=None):
    if not frappe.db.table_exists("POS Cashier Runtime"):
        return
    with service_write():
        frappe.db.sql("""UPDATE `tabPOS Cashier Runtime` SET accountable_shift=%s, register=%s,
            revision=revision+1, modified=%s WHERE name=%s""", (shift, register, now_datetime(), user))


def release_shift(opening_shift, closed_by=None):
    """Clear runtime pointers that reference ``opening_shift`` (close/cancel)."""
    if not frappe.db.table_exists("POS Cashier Runtime"):
        return
    shift = frappe.db.get_value("POS Opening Shift", opening_shift, ["user", "posa_register"], as_dict=True)
    if not shift:
        return
    cashier = lock_cashier(shift.user)
    if cashier and cashier.accountable_shift == opening_shift:
        point_cashier(shift.user, None, None)
    if shift.posa_register:
        runtime = frappe.db.get_value("POS Register Runtime", shift.posa_register, "*", as_dict=True, for_update=True)
        if runtime and runtime.active_opening_shift == opening_shift:
            frappe.db.sql("""UPDATE `tabPOS Register Runtime` SET active_opening_shift=NULL, active_cashier=NULL,
                work_state='Available', row_revision=row_revision+1, modified=%s WHERE name=%s""",
                          (now_datetime(), shift.posa_register))
            from .receipts import emit
            store = frappe.db.get_value("POS Register", shift.posa_register, "store")
            emit("register.closed", "POS Register", shift.posa_register, int(runtime.row_revision or 1) + 1,
                 store=store, payload={"opening_shift": opening_shift, "closed_by": closed_by or frappe.session.user})


def on_closing_submit(doc, method=None):
    if doc.get("pos_opening_shift"):
        release_shift(doc.pos_opening_shift)


def on_closing_cancel(doc, method=None):
    """A cancelled closing reopens its shift; restore the pointers."""
    shift = doc.get("pos_opening_shift")
    if not shift or not _shift_open(shift) or not frappe.db.table_exists("POS Cashier Runtime"):
        return
    row = frappe.db.get_value("POS Opening Shift", shift, ["user", "posa_register", "posa_store"], as_dict=True)
    cashier = lock_cashier(row.user)
    if cashier and cashier.accountable_shift and cashier.accountable_shift != shift and _shift_open(cashier.accountable_shift):
        fail("invalid_state", "The cashier already has another open shift; this closing cannot be cancelled.")
    point_cashier(row.user, shift, row.posa_register)
    if row.posa_register:
        runtime = lock_register(row.posa_register, row.posa_store)
        if runtime.active_opening_shift and runtime.active_opening_shift != shift and _shift_open(runtime.active_opening_shift):
            fail("invalid_state", "The caja already has another open shift; this closing cannot be cancelled.")
        frappe.db.sql("""UPDATE `tabPOS Register Runtime` SET active_opening_shift=%s, active_cashier=%s,
            work_state='Open', row_revision=row_revision+1, modified=%s WHERE name=%s""",
                      (shift, row.user, now_datetime(), row.posa_register))


def on_opening_cancel(doc, method=None):
    release_shift(doc.name)


def touch(register, device, observed_at=None):
    """Heartbeat observation. Availability only — never grants possession."""
    frappe.db.sql("""UPDATE `tabPOS Register Runtime` SET last_seen_at=%s, last_seen_device=%s WHERE name=%s""",
                  (observed_at or now_datetime(), device, register))
