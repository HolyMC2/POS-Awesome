"""Read-only shift workspace. A POS Profile is not a physical cash register.

Lists never calculate money. Detail uses the canonical reconciliation reader,
not the closing builder (which may submit printed drafts). Terminal commands
remain owned by shift_terminal; this module grants no terminal possession.
"""

import base64
import hashlib
import hmac
import json
import time

import frappe
from frappe import _
from frappe.utils import cint, getdate, now_datetime, nowdate

from posawesome.posawesome.api._scope import _is_super, assert_company, assert_profile
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    is_closing_supervisor,
)


def _identity():
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw(_("Sign in to review shifts."), frappe.PermissionError)
    return user, bool(is_closing_supervisor(user))


def _scope(user, manager):
    # Match the profile-centric POS scope without loading every assigned profile.
    clauses = ["s.docstatus = 1", "p.company = s.company"]
    if not _is_super(user):
        clauses += ["p.disabled = 0", "EXISTS (SELECT 1 FROM `tabPOS Profile User` pu "
                    "WHERE pu.parent = p.name AND pu.user = %(user)s)"]
    if not manager:
        clauses.append("s.user = %(user)s")
    return " AND ".join(clauses)


def _signature(payload):
    key = frappe.conf.get("encryption_key")
    if not key:
        frappe.throw(_("Site signing key is not configured."))
    return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _cursor(row, context):
    payload = base64.urlsafe_b64encode(json.dumps({
        "date": str(row["period_start_date"]), "name": row["name"],
        "context": context, "expires": int(time.time()) + 3600,
    }, separators=(",", ":")).encode()).decode()
    return payload + "." + _signature(payload)


def _read_cursor(cursor, context):
    try:
        if not isinstance(cursor, str) or len(cursor) > 4096:
            raise ValueError
        payload, signature = cursor.split(".")
        if not hmac.compare_digest(signature, _signature(payload)):
            raise ValueError
        value = json.loads(base64.urlsafe_b64decode(payload))
        if value["context"] != context or value["expires"] < time.time():
            raise ValueError
        if not isinstance(value["date"], str) or not isinstance(value["name"], str):
            raise ValueError
        return value
    except (ValueError, KeyError, TypeError):
        frappe.throw(_("This shift list has expired. Refresh it to continue."))


_FROM = "FROM `tabPOS Opening Shift` s INNER JOIN `tabPOS Profile` p ON p.name = s.pos_profile"
_FIELDS = """s.name, s.user, s.pos_profile, s.company, s.status,
    s.period_start_date, s.period_end_date, s.pos_closing_shift,
    s.posa_terminal_recovery_pending AS recovery_pending,
    u.full_name AS cashier_name, p.warehouse"""


def _present(row, user):
    row = {key: row.get(key) for key in (
        "name", "user", "pos_profile", "company", "status", "period_start_date",
        "period_end_date", "pos_closing_shift", "recovery_pending", "cashier_name", "warehouse",
    )}
    row["is_mine"] = row["user"] == user
    row["older_shift"] = bool(row["status"] == "Open" and row.get("period_start_date")
                             and getdate(row["period_start_date"]) < getdate(nowdate()))
    row["recovery_pending"] = bool(row.get("recovery_pending"))
    return row


@frappe.whitelist()
def list_shifts(queue="attention", search="", cursor=None, page_length=30):
    user, manager = _identity()
    if queue not in ("open", "attention", "closed"):
        frappe.throw(_("Choose open shifts, attention, or closed history."))
    search = str(search or "").strip()[:120]
    limit = max(1, min(cint(page_length) or 30, 50))
    params = {"user": user, "today": nowdate(), "limit": limit + 1}
    scope = _scope(user, manager)
    # Counts describe the entire permitted work queue, not just the current page.
    summary = frappe.db.sql(f"""SELECT
        COALESCE(SUM(s.status = 'Open'), 0) AS `open`,
        COALESCE(SUM(s.status = 'Open' AND (s.period_start_date < %(today)s
          OR s.posa_terminal_recovery_pending = 1)), 0) AS attention
        {_FROM} WHERE {scope} AND s.status = 'Open'""", params, as_dict=True)[0]
    clauses = [scope, "s.status = %(status)s"]
    params["status"] = "Closed" if queue == "closed" else "Open"
    if queue == "attention":
        clauses.append("(s.period_start_date < %(today)s OR s.posa_terminal_recovery_pending = 1)")
    if search:
        # Literal substring search: %, _ and backslash are not user wildcards.
        params["search"] = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        clauses.append("(s.name LIKE %(search)s OR s.pos_profile LIKE %(search)s "
                       "OR u.full_name LIKE %(search)s OR s.user LIKE %(search)s)")
    context = [frappe.local.site, user, manager, queue, search]
    if cursor:
        after = _read_cursor(cursor, context)
        params.update(after_date=after["date"], after_name=after["name"])
        clauses.append("(s.period_start_date < %(after_date)s OR "
                       "(s.period_start_date = %(after_date)s AND s.name < %(after_name)s))")
    rows = frappe.db.sql(f"""SELECT {_FIELDS} {_FROM}
        LEFT JOIN `tabUser` u ON u.name = s.user
        WHERE {' AND '.join(clauses)}
        ORDER BY s.period_start_date DESC, s.name DESC LIMIT %(limit)s""", params, as_dict=True)
    more = len(rows) > limit
    rows = rows[:limit]
    return {"shifts": [_present(row, user) for row in rows], "can_manage": manager,
            "summary": {key: cint(summary[key]) for key in ("open", "attention")},
            "as_of": str(now_datetime()),
            "next_cursor": _cursor(rows[-1], context) if more else None}


@frappe.whitelist()
def shift_detail(opening_shift):
    user, manager = _identity()
    # Scope the lookup itself. Missing and out-of-scope records are indistinguishable.
    rows = frappe.db.sql(f"""SELECT {_FIELDS} {_FROM}
        LEFT JOIN `tabUser` u ON u.name = s.user
        WHERE {_scope(user, manager)} AND s.name = %(name)s""",
        {"user": user, "name": opening_shift}, as_dict=True)
    if not rows:
        frappe.throw(_("This shift is unavailable or outside your access."), frappe.PermissionError)
    row = rows[0]
    assert_profile(user, row["pos_profile"])
    assert_company(user, row["company"])
    profile = frappe.get_cached_doc("POS Profile", row["pos_profile"])
    hidden = bool(cint(profile.get("hide_expected_amount")))
    result = {"shift": _present(row, user), "can_manage": manager,
              "as_of": str(now_datetime()), "amounts_hidden": hidden,
              "currency": frappe.get_cached_value("Company", row["company"], "default_currency"),
              "cash_movements_enabled": bool(cint(profile.get("posa_enable_cash_movement"))),
              "closing_enabled": not bool(cint(profile.get("posa_hide_closing_shift"))),
              "tenders": [], "movements": []}
    # Blind-count policy applies to managers too. Do not calculate or transmit amounts.
    if hidden or row["status"] != "Open":
        return result
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
        compute_closing_tables,
    )

    opening = frappe.get_doc("POS Opening Shift", row["name"])
    tables = compute_closing_tables(opening.as_dict(), for_update=False)
    result["tenders"] = [{key: tender.get(key) for key in
                          ("mode_of_payment", "opening_amount", "expected_amount")}
                         for tender in tables["payment_reconciliation"]]
    result["movements"] = frappe.get_all("POS Cash Movement", filters={
        "pos_opening_shift": row["name"], "docstatus": 1,
    }, fields=["name", "posting_date", "movement_type", "amount", "remarks"],
        order_by="modified desc, name desc", page_length=20)
    return result
