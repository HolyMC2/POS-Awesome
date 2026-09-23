"""Scoped, bounded reads for stores and cajas (spec 01 §6, spec 02 §8).

Lists use signed keyset cursors bound to user/scope/filters, page size 50
(max 100) and a constant number of queries per page. They never scan invoices
or GL. Details read authoritative records and omit unauthorized fields.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import frappe
from frappe.utils import cint, get_datetime, now_datetime

from . import model
from .errors import denied, fail
from .scope import grants, is_admin, load_register, load_store, store_predicate


# --- cursors --------------------------------------------------------------

def _sign(payload: str) -> str:
    key = frappe.conf.get("encryption_key")
    if not key:
        fail("dependency_unavailable", "Site signing key is not configured.")
    return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _cursor(values, context):
    payload = base64.urlsafe_b64encode(json.dumps({"v": values, "c": context, "e": int(time.time()) + 3600},
                                                  separators=(",", ":"), default=str).encode()).decode()
    return payload + "." + _sign(payload)


def _read_cursor(cursor, context):
    try:
        if not isinstance(cursor, str) or len(cursor) > 4096:
            raise ValueError
        payload, signature = cursor.split(".")
        if not hmac.compare_digest(signature, _sign(payload)):
            raise ValueError
        data = json.loads(base64.urlsafe_b64decode(payload))
        if data["c"] != context or data["e"] < time.time():
            raise ValueError
        return data["v"]
    except (ValueError, KeyError, TypeError):
        fail("revision_conflict", "This list expired or its filters changed. Refresh to continue.", ["refresh"])


def _like(value):
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


# --- readiness ------------------------------------------------------------

def readiness_facts(register: dict, store) -> dict:
    from .documents import drawer_conflicts, drawer_valid

    profile = frappe.db.get_value("POS Profile", register.get("pos_profile"), ["name", "company", "disabled"],
                                  as_dict=True) or {}
    in_store = bool(frappe.db.exists("POS Store Profile", {"parent": store.name, "pos_profile": register.get("pos_profile")}))
    facts = {"store_status": store.status, "profile_enabled": bool(profile) and not cint(profile.get("disabled")),
             "profile_company": profile.get("company"), "profile_in_store": in_store,
             "active_binding": bool(frappe.db.exists("POS Device Binding", {
                 "register": register.get("name"), "active": 1, "kind": "Selling"}))}
    account = register.get("drawer_account")
    if register.get("mode") == "Cash" and account:
        facts["drawer_valid"] = drawer_valid(account, register.get("company"))
        conflicts = drawer_conflicts(account, register.get("company"), register.get("name"))
        facts["drawer_conflict"] = bool(conflicts) and not (
            register.get("legacy_profile_route") and conflicts == ["mode_of_payment_default"])
        facts["custody_enabled"] = bool(frappe.db.table_exists("POS Cash Safe") and frappe.db.exists(
            "POS Cash Safe", {"pos_profile": register.get("pos_profile"), "enabled": 1}))
        from .migration import legacy_route, legacy_route_shared

        legacy = legacy_route(register.get("pos_profile"))
        if register.get("legacy_profile_route") and legacy_route_shared(
                account, register.get("company"), register.get("pos_profile")):
            # A legacy route another unmigrated profile still posts to is not exclusive.
            facts["drawer_conflict"] = True
        facts["route_difference"] = bool(register.get("legacy_profile_route")) and legacy != account
        facts["route_approved"] = bool(register.get("route_change_approved_by"))
    return facts


def readiness_for(register: dict, store, binding_override=None) -> list[dict]:
    facts = readiness_facts(register, store)
    if binding_override is not None:
        facts["active_binding"] = facts["active_binding"] and binding_override
    return model.readiness(register, facts)


# --- lists ----------------------------------------------------------------

_REG_FIELDS = """r.name, r.register_code, r.label, r.store, r.company, r.pos_profile, r.mode, r.lifecycle,
    r.revision, r.drawer_account, r.requires_enrolled_device, r.pending_configuration,
    st.store_code, st.store_name, st.status AS store_status,
    rt.work_state, rt.active_opening_shift, rt.active_cashier, rt.last_seen_at, rt.row_revision,
    rt.active_binding, u.full_name AS cashier_name,
    os.period_start_date AS opened_at, os.posa_terminal_recovery_pending AS recovery_pending"""
_REG_FROM = """FROM `tabPOS Register` r
    INNER JOIN `tabPOS Store` st ON st.name = r.store
    LEFT JOIN `tabPOS Register Runtime` rt ON rt.name = r.name
    LEFT JOIN `tabPOS Opening Shift` os ON os.name = rt.active_opening_shift
    LEFT JOIN `tabUser` u ON u.name = rt.active_cashier"""


def _row_dto(row, user, now):
    state = row.work_state or "Available"
    if row.active_opening_shift and cint(row.recovery_pending):
        state = "Recovery"
    older = bool(row.opened_at and get_datetime(row.opened_at).date() < now.date())
    attention = []
    if cint(row.recovery_pending):
        attention.append("recovery")
    if older:
        attention.append("older_shift")
    if row.pending_configuration:
        attention.append("pending_configuration")
    if row.lifecycle == "Draft":
        attention.append("setup_incomplete")
    dto = {"name": row.name, "register_code": row.register_code, "label": row.label, "store": row.store,
           "store_code": row.store_code, "store_name": row.store_name, "mode": row.mode,
           "company": row.company, "pos_profile": row.pos_profile,
           "lifecycle": row.lifecycle, "work_state": state if row.active_opening_shift else "Available",
           "connectivity": model.connectivity(get_datetime(row.last_seen_at) if row.last_seen_at else None, now),
           "last_seen_at": str(row.last_seen_at) if row.last_seen_at else None,
           "opening_shift": row.active_opening_shift, "cashier": row.active_cashier,
           "cashier_name": row.cashier_name, "opened_at": str(row.opened_at) if row.opened_at else None,
           "is_mine": row.active_cashier == user, "attention": attention,
           "severity": "action" if ("recovery" in attention or "older_shift" in attention) else (
               "info" if attention else "none"),
           "device_connected": bool(row.active_binding), "revision": str(row.revision or 1)}
    return dto


@frappe.whitelist()
def list_registers(store=None, filter="all", search="", cursor=None, page_length=None):
    """Cajas of one store (or all granted stores), ordered by store and caja code."""
    user = frappe.session.user
    if not user or user == "Guest":
        denied()
    if filter not in ("all", "attention", "open", "available", "setup"):
        fail("validation_failed", "Unknown filter.")
    limit = model.page_length(page_length)
    search = str(search or "").strip()[:120]
    params = {"limit": limit + 1}
    clause, scope_params = store_predicate(user, alias="st")
    params.update(scope_params)
    clauses = [clause, "r.lifecycle != 'Retired'"]
    if store:
        load_store(store)  # scoped existence check, no leak
        clauses.append("r.store = %(store)s")
        params["store"] = store
    if filter == "open":
        clauses.append("rt.active_opening_shift IS NOT NULL")
    elif filter == "available":
        clauses.append("rt.active_opening_shift IS NULL AND r.lifecycle = 'Ready'")
    elif filter == "setup":
        clauses.append("r.lifecycle IN ('Draft','Suspended')")
    elif filter == "attention":
        clauses.append("""(os.posa_terminal_recovery_pending = 1 OR DATE(os.period_start_date) < CURDATE()
            OR r.pending_configuration IS NOT NULL OR r.lifecycle = 'Draft')""")
    if search:
        params["search"] = _like(search)
        clauses.append("(r.register_code LIKE %(search)s OR r.label LIKE %(search)s OR st.store_name LIKE %(search)s)")
    context = [frappe.local.site, user, store or "", filter, search]
    if cursor:
        after = _read_cursor(cursor, context)
        params.update(after_store=after[0], after_code=after[1], after_name=after[2])
        clauses.append("""(st.store_code > %(after_store)s OR (st.store_code = %(after_store)s AND
            (r.register_code > %(after_code)s OR (r.register_code = %(after_code)s AND r.name > %(after_name)s))))""")
    rows = frappe.db.sql(f"""SELECT {_REG_FIELDS} {_REG_FROM} WHERE {' AND '.join(clauses)}
        ORDER BY st.store_code ASC, r.register_code ASC, r.name ASC LIMIT %(limit)s""", params, as_dict=True)
    more = len(rows) > limit
    rows = rows[:limit]
    now = now_datetime()
    summary_where = " AND ".join([clause, "r.lifecycle != 'Retired'"] + (["r.store = %(store)s"] if store else []))
    summary = frappe.db.sql(f"""SELECT COUNT(*) AS total,
        COALESCE(SUM(rt.active_opening_shift IS NOT NULL), 0) AS open,
        COALESCE(SUM(os.posa_terminal_recovery_pending = 1 OR DATE(os.period_start_date) < CURDATE()
            OR r.pending_configuration IS NOT NULL OR r.lifecycle = 'Draft'), 0) AS attention,
        COALESCE(SUM(r.lifecycle IN ('Draft','Suspended')), 0) AS setup
        {_REG_FROM} WHERE {summary_where}""", params, as_dict=True)[0]
    return {"registers": [_row_dto(r, user, now) for r in rows],
            "summary": {k: cint(summary[k]) for k in ("total", "open", "attention", "setup")},
            "as_of": str(now), "coverage": "complete",
            "next_cursor": _cursor([rows[-1].store_code, rows[-1].register_code, rows[-1].name], context) if more else None}


@frappe.whitelist()
def list_stores(cursor=None, page_length=None, search=""):
    """Paged store rollups in one grouped query (no per-store N+1)."""
    user = frappe.session.user
    if not user or user == "Guest":
        denied()
    limit = model.page_length(page_length)
    search = str(search or "").strip()[:120]
    clause, params = store_predicate(user, alias="st")
    params["limit"] = limit + 1
    clauses = [clause, "st.status != 'Retired'"]
    if search:
        params["search"] = _like(search)
        clauses.append("(st.store_code LIKE %(search)s OR st.store_name LIKE %(search)s)")
    context = [frappe.local.site, user, "stores", search]
    if cursor:
        after = _read_cursor(cursor, context)
        params.update(after_code=after[0], after_name=after[1])
        clauses.append("(st.store_code > %(after_code)s OR (st.store_code = %(after_code)s AND st.name > %(after_name)s))")
    rows = frappe.db.sql(f"""SELECT st.name, st.store_code, st.store_name, st.company, st.status, st.revision,
        st.timezone,
        COUNT(r.name) AS registers,
        COALESCE(SUM(rt.active_opening_shift IS NOT NULL), 0) AS open,
        COALESCE(SUM(os.posa_terminal_recovery_pending = 1 OR DATE(os.period_start_date) < CURDATE()
            OR r.pending_configuration IS NOT NULL OR r.lifecycle = 'Draft'), 0) AS attention
        FROM `tabPOS Store` st
        LEFT JOIN `tabPOS Register` r ON r.store = st.name AND r.lifecycle != 'Retired'
        LEFT JOIN `tabPOS Register Runtime` rt ON rt.name = r.name
        LEFT JOIN `tabPOS Opening Shift` os ON os.name = rt.active_opening_shift
        WHERE {' AND '.join(clauses)}
        GROUP BY st.name ORDER BY st.store_code ASC, st.name ASC LIMIT %(limit)s""", params, as_dict=True)
    more = len(rows) > limit
    rows = rows[:limit]
    from .scope import company_capabilities, store_capabilities

    companies = frappe.get_all("Company", pluck="name") if is_admin(user) else sorted(
        {g.company for g in grants(user) if g.scope_type == "Company"})
    out = []
    for row in rows:
        caps = store_capabilities(user, row.name, row.company)
        out.append({"name": row.name, "store_code": row.store_code, "store_name": row.store_name,
                    "company": row.company, "status": row.status, "timezone": row.timezone,
                    "revision": str(row.revision or 1), "registers": cint(row.registers), "open": cint(row.open),
                    "attention": cint(row.attention), "can_configure": "configure" in caps,
                    "can_supervise": "supervise" in caps})
    return {"stores": out, "as_of": str(now_datetime()),
            "can_create_in": [c for c in companies if "configure" in company_capabilities(user, c)],
            "next_cursor": _cursor([rows[-1].store_code, rows[-1].name], context) if more else None}


@frappe.whitelist()
def my_registers(terminal_id=None):
    """Cashier home: Ready cajas this user may sell on, and this browser's binding."""
    user = frappe.session.user
    if not user or user == "Guest":
        denied()
    if frappe.conf.get(model.DISABLE_FLAG):
        # Rollback switch: the opening dialog falls back to profile openings.
        return {"registers": [], "truncated": False, "as_of": str(now_datetime()), "can_connect": False, "paused": True}
    clause, params = store_predicate(user, alias="st", capabilities={"sell"})
    params.update(user=user, terminal=str(terminal_id or "")[:80])
    profile_clause = "1=1" if is_admin(user) else (
        "EXISTS (SELECT 1 FROM `tabPOS Profile User` pu WHERE pu.parent = r.pos_profile AND pu.user = %(user)s)")
    rows = frappe.db.sql(f"""SELECT {_REG_FIELDS},
        EXISTS (SELECT 1 FROM `tabPOS Device Binding` b INNER JOIN `tabPOS Device` d ON d.name = b.device
            WHERE b.register = r.name AND b.active = 1 AND d.state = 'Enrolled' AND d.terminal_id = %(terminal)s)
            AS this_device
        {_REG_FROM} WHERE {clause} AND {profile_clause} AND r.lifecycle = 'Ready' AND st.status = 'Active'
        ORDER BY st.store_code, r.register_code, r.name LIMIT 101""", params, as_dict=True)
    now = now_datetime()
    result = []
    for row in rows[:100]:
        dto = _row_dto(row, user, now)
        dto["this_device"] = bool(row.this_device)
        dto["can_open"] = bool(row.this_device or not cint(row.requires_enrolled_device)) and not row.active_opening_shift
        result.append(dto)
    # A granted cashier may redeem a connection code before the caja is Ready.
    can_connect = bool(result) or is_admin(user) or any(
        g.bundle in ("Cashier", "Store supervisor", "Configuration admin") for g in grants(user))
    return {"registers": result, "truncated": len(rows) > 100, "as_of": str(now), "can_connect": can_connect}


# --- detail ---------------------------------------------------------------

def _actions(reg, store, runtime, caps, user, readiness):
    """Descriptors aid discovery; every command revalidates on the server."""
    acts = []

    def add(action_id, enabled=True, reason=None, capability=None):
        acts.append({"action_id": action_id, "enabled": bool(enabled), "blocking_reason": reason,
                     "required_capability": capability})

    open_shift = runtime.get("active_opening_shift")
    if "configure" in caps and reg.lifecycle != "Retired":
        add("configure", capability="configure")
        if reg.lifecycle in ("Draft", "Suspended"):
            add("activate", not readiness, readiness[0]["message"] if readiness else None, "configure")
        add("retire", not open_shift, "Close the open shift first." if open_shift else None, "configure")
    if "supervise" in caps and reg.lifecycle == "Ready":
        add("suspend", True, None, "supervise")
    if "enroll" in caps and reg.lifecycle != "Retired" and not runtime.get("active_binding"):
        add("connect_device", capability="enroll")
    if "recover" in caps and runtime.get("active_binding"):
        add("replace_device", capability="recover")
    if "sell" in caps and reg.lifecycle == "Ready" and not open_shift:
        add("open_shift", capability="sell")
    if open_shift and runtime.get("active_cashier") == user:
        add("resume_shift", capability="sell")
    if open_shift and runtime.get("active_cashier") != user and "recover" in caps:
        add("review_browser_access", capability="recover")
    if reg.legacy_profile_route and "supervise" in caps and not reg.route_change_approved_by:
        add("approve_route_change", capability="supervise")
    return acts


@frappe.whitelist()
def register_detail(register):
    user = frappe.session.user
    reg, store = load_register(register)
    caps = reg.capabilities
    runtime = frappe.db.get_value("POS Register Runtime", reg.name, "*", as_dict=True) or {}
    readiness = readiness_for(reg, store) if reg.lifecycle != "Retired" else []
    now = now_datetime()
    last_seen = get_datetime(runtime.get("last_seen_at")) if runtime.get("last_seen_at") else None
    shift = None
    if runtime.get("active_opening_shift"):
        s = frappe.db.get_value("POS Opening Shift", runtime["active_opening_shift"],
                                ["name", "user", "period_start_date", "posa_business_date", "status",
                                 "posa_terminal_recovery_pending", "posa_binding_generation"], as_dict=True)
        if s:
            shift = {"name": s.name, "cashier": s.user,
                     "cashier_name": frappe.db.get_value("User", s.user, "full_name"),
                     "opened_at": str(s.period_start_date), "business_date": str(s.posa_business_date or ""),
                     "status": s.status, "recovery_pending": bool(cint(s.posa_terminal_recovery_pending)),
                     "is_mine": s.user == user}
    binding = None
    if runtime.get("active_binding"):
        b = frappe.db.get_value("POS Device Binding", runtime["active_binding"],
                                ["name", "device", "generation", "started_at"], as_dict=True)
        if b:
            d = frappe.db.get_value("POS Device", b.device, ["label", "last_heartbeat", "last_version"], as_dict=True) or {}
            binding = {"binding": b.name, "device": b.device, "label": d.get("label"),
                       "generation": str(b.generation), "since": str(b.started_at),
                       "last_version": d.get("last_version")}
    configure = "configure" in caps
    dto = {
        "name": reg.name, "register_code": reg.register_code, "label": reg.label,
        "store": store.name, "store_name": store.store_name, "store_code": store.store_code,
        "company": reg.company, "pos_profile": reg.pos_profile, "mode": reg.mode, "lifecycle": reg.lifecycle,
        "revision": str(reg.revision or 1), "configuration_revision": str(reg.configuration_revision or 1),
        "requires_enrolled_device": bool(cint(reg.requires_enrolled_device)),
        "work_state": ("Recovery" if shift and shift["recovery_pending"] else "Open") if shift else "Available",
        "runtime_revision": str(runtime.get("row_revision") or 1),
        "connectivity": model.connectivity(last_seen, now),
        "last_seen_at": str(last_seen) if last_seen else None,
        "shift": shift, "device": binding, "readiness": readiness,
        "pending_configuration": bool(reg.pending_configuration),
        "legacy_profile_route": bool(cint(reg.legacy_profile_route)),
        "route_change_approved": bool(reg.route_change_approved_by),
        "actions": _actions(reg, store, runtime, caps, user, readiness),
        "capabilities": sorted(caps), "as_of": str(now),
    }
    # Accounts are configuration detail: only configuration users receive them.
    if configure:
        dto["drawer_account"] = reg.drawer_account
        dto["default_safe"] = reg.default_safe
    return dto


@frappe.whitelist()
def setup_options(store):
    """Choices for the add/configure caja form, scoped to the store company."""
    row = load_store(store, "configure")
    from .documents import drawer_conflicts

    profiles = frappe.db.sql("""SELECT sp.pos_profile AS name FROM `tabPOS Store Profile` sp
        INNER JOIN `tabPOS Profile` p ON p.name = sp.pos_profile AND p.disabled = 0
        WHERE sp.parent = %s ORDER BY sp.idx""", (row.name,), as_dict=True)
    currency = frappe.get_cached_value("Company", row.company, "default_currency")
    accounts = frappe.get_all("Account", filters={"company": row.company, "account_type": "Cash", "is_group": 0,
                                                  "disabled": 0, "account_currency": currency},
                              fields=["name", "account_name"], order_by="name asc", limit_page_length=100)
    for account in accounts:
        account["conflicts"] = drawer_conflicts(account.name, row.company)
    safes = frappe.get_all("POS Cash Safe", filters={"company": row.company}, fields=["name", "title", "enabled"],
                           limit_page_length=50) if frappe.db.table_exists("POS Cash Safe") else []
    return {"store": row.name, "company": row.company, "profiles": [p.name for p in profiles],
            "drawer_accounts": accounts, "safes": safes}
