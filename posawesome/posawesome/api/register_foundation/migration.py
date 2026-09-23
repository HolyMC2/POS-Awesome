"""Migration adapter (spec 01 §8): inventory, explicit mapping, shadow routes.

* ``inventory()`` is read-only: profiles, companies, warehouses, open legacy
  shifts, legacy cash routes per money path, safes, storefront links and the
  monetary baseline of every candidate drawer account. Ambiguity is reported,
  never resolved by guessing — a shared warehouse or name never implies a
  store, and several open shifts on one profile never become several cajas.
* ``apply_mapping(mapping, dry_run=1)`` creates stores and DRAFT legacy
  registers only from an explicit, approved mapping. It never closes, moves or
  re-owns a shift, never enables custody and never posts to the ledger.
* ``legacy_route(profile)`` is the shadow resolver used by readiness.
"""

from __future__ import annotations

import json

import frappe
from frappe.utils import cint, flt, now_datetime

from .errors import fail


def _admin():
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        fail("scope_denied", "Only an administrator can run the register migration.")


def legacy_route(pos_profile):
    """Cash account legacy cash movements of ``pos_profile`` post to."""
    from posawesome.posawesome.api.cash_movement.validation import _resolve_default_source_cash_account

    if not pos_profile:
        return None
    try:
        return _resolve_default_source_cash_account(frappe.get_doc("POS Profile", pos_profile))
    except Exception:
        return None


def _sale_cash_accounts(profile, company):
    """Mode of Payment accounts legacy SALES use for each cash mode."""
    from .routing import cash_modes

    out = {}
    for mode in cash_modes(profile):
        out[mode] = frappe.db.get_value("Mode of Payment Account", {"parent": mode, "company": company},
                                        "default_account") or frappe.db.get_value(
            "Company", company, "default_cash_account")
    return out


def _gl(account, company):
    if not account:
        return None
    row = frappe.db.sql("""SELECT COUNT(*) AS entries, COALESCE(SUM(debit), 0) AS debit,
        COALESCE(SUM(credit), 0) AS credit FROM `tabGL Entry`
        WHERE account=%s AND company=%s AND is_cancelled=0""", (account, company), as_dict=True)[0]
    return {"entries": cint(row.entries), "debit": flt(row.debit, 2), "credit": flt(row.credit, 2),
            "balance": flt(flt(row.debit) - flt(row.credit), 2)}


@frappe.whitelist()
def inventory():
    """Dry-run report; performs no writes."""
    _admin()
    profiles = frappe.get_all("POS Profile", fields=["name", "company", "warehouse", "disabled"],
                              order_by="name asc", limit_page_length=1000)
    by_warehouse, by_account, rows = {}, {}, []
    for p in profiles:
        doc = frappe.get_doc("POS Profile", p.name)
        users = frappe.get_all("POS Profile User", filters={"parent": p.name}, pluck="user")
        shifts = frappe.get_all("POS Opening Shift", filters={"pos_profile": p.name, "status": "Open", "docstatus": 1},
                                fields=["name", "user", "period_start_date", "posa_register"],
                                order_by="period_start_date asc", limit_page_length=500)
        sales = _sale_cash_accounts(doc, p.company)
        movement = legacy_route(p.name)
        custody = bool(frappe.db.table_exists("POS Cash Safe") and frappe.db.exists(
            "POS Cash Safe", {"pos_profile": p.name, "enabled": 1}))
        registers = frappe.get_all("POS Register", filters={"pos_profile": p.name},
                                   fields=["name", "register_code", "store", "lifecycle"], limit_page_length=100)
        from .routing import other_cash_type_modes

        row = {"profile": p.name, "company": p.company, "warehouse": p.warehouse, "disabled": bool(p.disabled),
               "assigned_users": len(users),
               "open_shifts": [{"name": s.name, "user": s.user, "opened": str(s.period_start_date),
                                "register": s.posa_register} for s in shifts],
               "cash_modes": sorted(sales), "sale_cash_accounts": sales,
               "other_cash_type_modes": other_cash_type_modes(doc),
               "movement_source_account": movement,
               "back_office_account": doc.get("posa_back_office_cash_account"),
               "custody_enabled": custody, "registers": registers,
               "client_queue_versions": "unknown: browser queues are not server-observable"}
        rows.append(row)
        if not p.disabled:
            by_warehouse.setdefault(p.warehouse, []).append(p.name)
            for account in set(filter(None, list(sales.values()) + [movement])):
                by_account.setdefault(account, []).append(p.name)
    for row in rows:
        reasons = []
        if len(row["open_shifts"]) > 1:
            reasons.append(f"{len(row['open_shifts'])} open legacy shifts share this profile; physical drawer count unknown")
        if row["warehouse"] and len(by_warehouse.get(row["warehouse"], [])) > 1:
            reasons.append("warehouse shared with " + ", ".join(sorted(set(by_warehouse[row["warehouse"]]) - {row["profile"]})))
        shared = sorted({o for a in set(filter(None, list(row["sale_cash_accounts"].values()) + [row["movement_source_account"]]))
                         for o in by_account.get(a, []) if o != row["profile"]})
        if shared:
            reasons.append("cash account shared with " + ", ".join(shared) + "; an exclusive drawer account is required")
        if len(set(filter(None, row["sale_cash_accounts"].values())) | {row["movement_source_account"]} - {None}) > 1:
            reasons.append("sales and cash movements already post to different cash accounts")
        if row["custody_enabled"]:
            reasons.append("single-register custody enabled; stays profile-level until shared safes (spec 03)")
        row["ambiguities"] = reasons
        row["register_candidate"] = "unambiguous" if not reasons and not row["disabled"] else (
            "disabled" if row["disabled"] else "needs_mapping_decision")
    accounts = sorted(by_account)
    baseline = {a: _gl(a, frappe.db.get_value("Account", a, "company")) for a in accounts}
    storefront = []
    if frappe.db.table_exists("Storefront Sucursal"):
        storefront = frappe.get_all("Storefront Sucursal", fields=["name"], limit_page_length=200)
    return {"as_of": str(now_datetime()), "site": frappe.local.site, "profiles": rows,
            "stores": frappe.get_all("POS Store", fields=["name", "store_code", "company", "status"],
                                     limit_page_length=500),
            "safes": frappe.get_all("POS Cash Safe", fields=["name", "pos_profile", "enabled", "safe_account"],
                                    limit_page_length=200) if frappe.db.table_exists("POS Cash Safe") else [],
            "storefront_sucursales": [s.name for s in storefront],
            "storefront_note": "Not mapped automatically; link a store explicitly if a channel branch applies.",
            "monetary_baseline": baseline, "writes_performed": 0}


@frappe.whitelist(methods=["POST"])
def apply_mapping(mapping, dry_run=1):
    """Create stores + Draft legacy registers from an explicit mapping.

    mapping = {"stores": [{store_code, store_name, company, timezone,
    business_day_cutoff?, profiles: [...], warehouses: [...]}],
    "registers": [{store_code, register_code, label, pos_profile, mode?,
    drawer_account?, acknowledge_ambiguity?: "<reason>"}]}
    """
    _admin()
    data = json.loads(mapping) if isinstance(mapping, str) else mapping
    if not isinstance(data, dict):
        fail("validation_failed", "Mapping must be an object.")
    report = inventory()
    ambiguous = {r["profile"]: r["ambiguities"] for r in report["profiles"]}
    plan, stores = [], {}
    for store in data.get("stores") or []:
        key = f"{store.get('company')}::{str(store.get('store_code') or '').upper()}"
        existing = frappe.db.get_value("POS Store", {"store_key": key}, "name")
        stores[str(store.get("store_code") or "").upper()] = existing or key
        plan.append({"action": "keep_store" if existing else "create_store", "store": key})
    for reg in data.get("registers") or []:
        profile = reg.get("pos_profile")
        if profile not in ambiguous:
            fail("validation_failed", f"Unknown POS Profile {profile}.")
        if ambiguous[profile] and len(str(reg.get("acknowledge_ambiguity") or "").strip()) < 8:
            plan.append({"action": "skip_register", "profile": profile, "reasons": ambiguous[profile]})
            continue
        plan.append({"action": "create_draft_register", "profile": profile,
                     "store": str(reg.get("store_code") or "").upper(), "register_code": reg.get("register_code"),
                     "drawer_account": reg.get("drawer_account") or legacy_route(profile),
                     "legacy_profile_route": not reg.get("drawer_account")})
    if cint(dry_run):
        return {"dry_run": True, "plan": plan, "writes_performed": 0}
    from .receipts import emit, insert, service_write

    created = []
    with service_write():
        for store in data.get("stores") or []:
            code = str(store.get("store_code") or "").upper()
            if frappe.db.exists("POS Store", stores[code]):
                continue
            doc = insert(frappe.get_doc({
                "doctype": "POS Store", "store_code": code, "store_name": store.get("store_name"),
                "company": store.get("company"), "timezone": store.get("timezone") or "America/Mexico_City",
                "business_day_cutoff": store.get("business_day_cutoff") or "00:00:00", "status": "Active",
                "profiles": [{"pos_profile": p} for p in store.get("profiles") or []],
                "warehouses": [{"warehouse": w} for w in store.get("warehouses") or []]}))
            stores[code] = doc.name
            emit("store.created", "POS Store", doc.name, 1, store=doc.name, payload={"migration": True})
            created.append(doc.name)
        for item in plan:
            if item["action"] != "create_draft_register":
                continue
            reg = next(r for r in data["registers"] if r.get("pos_profile") == item["profile"]
                       and str(r.get("register_code")) == str(item["register_code"]))
            doc = insert(frappe.get_doc({
                "doctype": "POS Register", "store": stores[item["store"]], "register_code": reg.get("register_code"),
                "label": reg.get("label") or reg.get("register_code"), "pos_profile": item["profile"],
                "mode": reg.get("mode") or "Cash", "lifecycle": "Draft",
                "drawer_account": item["drawer_account"], "legacy_profile_route": 1 if item["legacy_profile_route"] else 0}))
            emit("register.created", "POS Register", doc.name, 1, store=doc.store,
                 payload={"migration": True, "ambiguity_acknowledged": reg.get("acknowledge_ambiguity")})
            created.append(doc.name)
    return {"dry_run": False, "plan": plan, "created": created}


def legacy_route_shared(account, company, pos_profile):
    """Other enabled profiles whose legacy cash routes use ``account``."""
    others = []
    for p in frappe.get_all("POS Profile", filters={"company": company, "disabled": 0, "name": ["!=", pos_profile]},
                            pluck="name", limit_page_length=1000):
        doc = frappe.get_doc("POS Profile", p)
        routes = set(_sale_cash_accounts(doc, company).values()) | {legacy_route(p)}
        if account in routes:
            others.append(p)
    return others
