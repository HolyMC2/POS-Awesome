"""Whitelisted spec 01 commands (§6 protocol).

Every mutating command: server-derived actor/scope → durable receipt (first
lock) → locked resources in the §7 order → business records + audit/outbox
event + receipt completion in ONE transaction. Replays return the original
result after re-checking authorization.
"""

from __future__ import annotations

import datetime as _dt
import functools
import hmac
import random
import time
import json
import re
import secrets

import frappe
from frappe import _
from frappe.utils import cint, get_datetime, now_datetime

from . import model
from .errors import denied, fail, rules
from .receipts import Receipt, emit, insert, save, service_write
from .runtime import assert_cashier_free, lock_cashier, lock_register, point_cashier, touch
from .scope import company_capabilities, is_admin, load_register, load_store

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _json(value, default=None):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        fail("validation_failed", "Invalid request data.")


def _user():
    user = frappe.session.user
    if not user or user == "Guest":
        fail("scope_denied", "Sign in to continue.")
    return user


def _reauth(password):
    from frappe.utils.password import check_password

    try:
        check_password(frappe.session.user, str(password or ""))
    except Exception:
        fail("scope_denied", "Confirm your password to authorize this recovery.")


def _retrying(fn):
    """Rerun the whole rolled-back transaction on 1020/1213 (spec 01 §7).

    Each command is its own request transaction and performs no external side
    effect, so a rerun with the same request ID is safe: a committed twin is
    found through its receipt and replayed instead of executed twice.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        for attempt in range(4):
            try:
                return fn(*args, **kwargs)
            except frappe.QueryDeadlockError:
                frappe.db.rollback()
                if attempt == 3:
                    fail("dependency_unavailable", "This caja is busy right now. Retry in a moment.", ["retry"])
                time.sleep(0.03 * (2 ** attempt) + random.random() * 0.03)
    return wrapper


def _schema(version):
    if version not in (None, "") and cint(version) != model.COMMAND_SCHEMA_VERSION:
        fail("validation_failed", "This screen is out of date. Reload POS to continue.", ["reload"])


# --------------------------------------------------------------------------
# Stores
# --------------------------------------------------------------------------

def _store_values(data):
    rows = {}
    for key in ("store_code", "store_name", "timezone", "business_day_cutoff", "address", "storefront_sucursal"):
        if key in data:
            rows[key] = data.get(key) or None
    return rows


@frappe.whitelist(methods=["POST"])
@_retrying
def create_store(request_id, company, store_code, store_name, timezone, business_day_cutoff=None,
                 warehouses=None, profiles=None, address=None, schema_version=None):
    user = _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
    if "configure" not in company_capabilities(user, company):
        denied("You cannot create stores for this company.")
    payload = dict(company=company, store_code=store_code, store_name=store_name, timezone=timezone,
                   business_day_cutoff=business_day_cutoff, warehouses=_json(warehouses, []),
                   profiles=_json(profiles, []), address=address)
    receipt = Receipt("stores.create", request_id, payload)
    if receipt.begin() is not None:
        return _store_dto(load_store(receipt.replayed["store"]))
    doc = frappe.get_doc({"doctype": "POS Store", "company": company, "status": "Active",
                          **_store_values(payload),
                          "warehouses": [{"warehouse": w} for w in payload["warehouses"]],
                          "profiles": [{"pos_profile": p} for p in payload["profiles"]]})
    insert(doc)
    emit("store.created", "POS Store", doc.name, 1, store=doc.name, receipt=receipt)
    receipt.complete({"store": doc.name}, "POS Store", doc.name, store=doc.name)
    return _store_dto(load_store(doc.name))


@frappe.whitelist(methods=["POST"])
@_retrying
def update_store(request_id, store, expected_revision, values, schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
    data = _json(values, {})
    row = load_store(store, "configure")
    receipt = Receipt("stores.update", request_id, {"store": store, "rev": expected_revision, "values": data}, store=store)
    if receipt.begin() is not None:
        return _store_dto(load_store(store))
    doc = frappe.get_doc("POS Store", row.name, for_update=True)
    with rules():
        model.assert_revision(doc.revision, expected_revision)
    doc.update(_store_values(data))
    if "warehouses" in data:
        doc.set("warehouses", [{"warehouse": w} for w in data["warehouses"] or []])
    if "profiles" in data:
        doc.set("profiles", [{"pos_profile": p} for p in data["profiles"] or []])
    save(doc)
    emit("store.updated", "POS Store", doc.name, doc.revision, store=doc.name, receipt=receipt,
         payload={"fields": sorted(data)})
    receipt.complete({"store": doc.name, "revision": doc.revision}, "POS Store", doc.name)
    return _store_dto(load_store(doc.name))


@frappe.whitelist(methods=["POST"])
@_retrying
def set_store_status(request_id, store, status, expected_revision, reason, schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
        reason = model.normalize_reason(reason)
    row = load_store(store, "configure")
    receipt = Receipt("stores.status", request_id, {"store": store, "status": status, "rev": expected_revision,
                                                    "reason": reason}, store=store)
    if receipt.begin() is not None:
        return _store_dto(load_store(store))
    doc = frappe.get_doc("POS Store", row.name, for_update=True)
    with rules():
        model.assert_revision(doc.revision, expected_revision)
        model.check_transition(doc.status, status, model.STORE_TRANSITIONS)
    if status == "Retired":
        active = frappe.db.get_value("POS Register", {"store": doc.name, "lifecycle": ["!=", "Retired"]}, "name")
        if active:
            fail("invalid_state", "Retire every caja of this store first.")
    # Suspension refuses new openings only; open shifts keep settlement paths.
    doc.status = status
    save(doc)
    emit("store.status", "POS Store", doc.name, doc.revision, store=doc.name, receipt=receipt,
         payload={"status": status, "reason": reason})
    receipt.complete({"store": doc.name, "status": status}, "POS Store", doc.name)
    return _store_dto(load_store(doc.name))


def _store_dto(row):
    return {"name": row.name, "store_code": row.store_code, "store_name": row.store_name,
            "company": row.company, "status": row.status, "timezone": row.timezone,
            "business_day_cutoff": str(row.business_day_cutoff or "00:00:00"),
            "revision": str(row.revision or 1), "capabilities": sorted(row.get("capabilities") or [])}


# --------------------------------------------------------------------------
# Registers
# --------------------------------------------------------------------------

_REGISTER_FIELDS = ("register_code", "label", "pos_profile", "mode", "drawer_account", "default_safe",
                    "requires_enrolled_device")


@frappe.whitelist(methods=["POST"])
@_retrying
def create_register(request_id, store, register_code, label, pos_profile, mode="Cash",
                    drawer_account=None, default_safe=None, requires_enrolled_device=1, schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
    row = load_store(store, "configure")
    if row.status != "Active":
        fail("invalid_state", "Reactivate the store before adding cajas.")
    payload = dict(store=store, register_code=register_code, label=label, pos_profile=pos_profile, mode=mode,
                   drawer_account=drawer_account, default_safe=default_safe,
                   requires_enrolled_device=cint(requires_enrolled_device))
    receipt = Receipt("registers.create", request_id, payload, store=store)
    if receipt.begin() is not None:
        return register_detail_payload(receipt.replayed["register"])
    doc = frappe.get_doc({"doctype": "POS Register", "lifecycle": "Draft", **payload})
    insert(doc)
    emit("register.created", "POS Register", doc.name, 1, store=store, receipt=receipt)
    receipt.complete({"register": doc.name}, "POS Register", doc.name)
    return register_detail_payload(doc.name)


@frappe.whitelist(methods=["POST"])
@_retrying
def configure_register(request_id, register, expected_revision, values, schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
    data = {k: v for k, v in _json(values, {}).items() if k in _REGISTER_FIELDS}
    unknown = set(_json(values, {})) - set(_REGISTER_FIELDS)
    if unknown:
        fail("validation_failed", "Unknown register settings: {0}", args=(", ".join(sorted(unknown)),))
    row, store = load_register(register, "configure")
    receipt = Receipt("registers.configure", request_id, {"register": register, "rev": expected_revision,
                                                          "values": data}, store=store.name)
    if receipt.begin() is not None:
        return register_detail_payload(register)
    doc = frappe.get_doc("POS Register", row.name, for_update=True)
    with rules():
        model.assert_revision(doc.revision, expected_revision)
    if doc.lifecycle == "Retired":
        fail("invalid_state", "Retired cajas cannot be reconfigured.")
    if doc.has_activity and "register_code" in data and data["register_code"] != doc.register_code:
        fail("invalid_state", "The caja code cannot change after financial activity.")
    doc.update(data)
    save(doc)
    emit("register.configured", "POS Register", doc.name, doc.revision, store=store.name, receipt=receipt,
         payload={"fields": sorted(data), "pending": bool(doc.pending_configuration)})
    receipt.complete({"register": doc.name, "revision": doc.revision}, "POS Register", doc.name)
    return register_detail_payload(doc.name)


@frappe.whitelist(methods=["POST"])
@_retrying
def set_register_lifecycle(request_id, register, target, expected_revision, reason=None, schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
        reason = model.normalize_reason(reason, required=target in ("Suspended", "Retired"))
    row, store = load_register(register, "configure" if target in ("Ready", "Retired") else "supervise")
    receipt = Receipt("registers.lifecycle", request_id, {"register": register, "target": target,
                                                          "rev": expected_revision, "reason": reason},
                      store=store.name)
    if receipt.begin() is not None:
        return register_detail_payload(register)
    doc = frappe.get_doc("POS Register", row.name, for_update=True)
    with rules():
        model.assert_revision(doc.revision, expected_revision)
        model.check_transition(doc.lifecycle, target)
    if target == "Ready":
        from .queries import readiness_for

        missing = readiness_for(doc.as_dict(), store)
        if missing:
            fail("invalid_state", "This caja is not ready: {0}", ["open_setup"],
                 args=("; ".join(_(item["message"]) for item in missing),))
    if target == "Retired":
        blockers = retirement_blockers(doc)
        if blockers:
            fail("invalid_state", "This caja cannot be retired yet: {0}", [b["key"] for b in blockers],
                 args=("; ".join(_(b["message"]) for b in blockers),))
    doc.lifecycle = target
    save(doc)
    emit("register.lifecycle", "POS Register", doc.name, doc.revision, store=store.name, receipt=receipt,
         payload={"lifecycle": target, "reason": reason})
    receipt.complete({"register": doc.name, "lifecycle": target}, "POS Register", doc.name)
    return register_detail_payload(doc.name)


def retirement_blockers(doc) -> list[dict]:
    """FND-T06: explain every unresolved obligation that blocks retirement."""
    blockers = []
    runtime = frappe.db.get_value("POS Register Runtime", doc.name,
                                  ["active_opening_shift", "work_state"], as_dict=True) or {}
    shifts = frappe.get_all("POS Opening Shift", filters={"posa_register": doc.name, "status": "Open", "docstatus": 1},
                            pluck="name", limit_page_length=5)
    if runtime.get("active_opening_shift") or shifts:
        blockers.append({"key": "open_shift", "message": "an open shift must be closed",
                         "shift": runtime.get("active_opening_shift") or shifts[0]})
    if frappe.db.exists("POS Opening Shift", {"posa_register": doc.name, "posa_terminal_recovery_pending": 1,
                                              "docstatus": 1, "status": "Open"}):
        blockers.append({"key": "recovery", "message": "a browser recovery case is unresolved"})
    if doc.default_safe and frappe.db.table_exists("POS Cash Bag"):
        bags = frappe.db.sql("""SELECT b.name FROM `tabPOS Cash Bag` b
            INNER JOIN `tabPOS Opening Shift` s ON s.name IN (b.opening_shift, b.receiving_shift)
            WHERE s.posa_register=%s AND b.state IN ('Unverified','Available','Disputed','In Transit') LIMIT 1""",
                             (doc.name,))
        if bags:
            blockers.append({"key": "bag", "message": "a cash bag from this caja is still in custody", "bag": bags[0][0]})
    if frappe.db.has_column("Sales Invoice", "posa_pos_opening_shift"):
        pending = frappe.db.sql("""SELECT i.name FROM `tabSales Invoice` i
            INNER JOIN `tabPOS Opening Shift` s ON s.name = i.posa_pos_opening_shift
            WHERE s.posa_register=%s AND i.docstatus=0 LIMIT 1""", (doc.name,))
        if pending:
            blockers.append({"key": "pending_payment", "message": "a draft or pending sale must be completed or cancelled",
                             "invoice": pending[0][0]})
    if doc.mode == "Cash" and doc.drawer_account:
        balance = frappe.db.sql("""SELECT COALESCE(SUM(debit - credit), 0) FROM `tabGL Entry`
            WHERE account=%s AND company=%s AND is_cancelled=0""", (doc.drawer_account, doc.company))[0][0]
        if abs(float(balance or 0)) >= 0.005:
            blockers.append({"key": "drawer_residual", "message": "the drawer account still holds an unexplained balance"})
    return blockers


@frappe.whitelist(methods=["POST"])
@_retrying
def approve_route_change(request_id, register, expected_revision, reason, schema_version=None):
    """Migration step 5: a legacy route difference needs explicit approval."""
    user = _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
        reason = model.normalize_reason(reason)
    row, store = load_register(register, "supervise")
    receipt = Receipt("registers.route_approval", request_id, {"register": register, "rev": expected_revision,
                                                               "reason": reason}, store=store.name)
    if receipt.begin() is not None:
        return register_detail_payload(register)
    doc = frappe.get_doc("POS Register", row.name, for_update=True)
    with rules():
        model.assert_revision(doc.revision, expected_revision)
    if frappe.db.get_value("POS Register Event", {"aggregate_id": doc.name, "event_type": "register.configured",
                                                  "actor": user}, "name") and not is_admin(user):
        fail("scope_denied", "Another supervisor must approve a route you configured.")
    doc.route_change_approved_by = user
    doc.route_change_reason = reason
    save(doc)
    emit("register.route_approved", "POS Register", doc.name, doc.revision, store=store.name,
         receipt=receipt, payload={"reason": reason, "drawer_account": doc.drawer_account})
    receipt.complete({"register": doc.name}, "POS Register", doc.name)
    return register_detail_payload(doc.name)


# --------------------------------------------------------------------------
# Devices
# --------------------------------------------------------------------------

def _terminal(terminal_id, terminal_token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", str(terminal_id or "")) or not re.fullmatch(
            r"[A-Za-z0-9_-]{32,128}", str(terminal_token or "")):
        fail("validation_failed", "This browser needs its device identity. Reload POS and retry.")
    return str(terminal_id), model.secret_hash(terminal_token)


@frappe.whitelist(methods=["POST"])
@_retrying
def issue_device_challenge(register, purpose="Enroll", reason=None, password=None, acknowledge_recovery=0):
    """Short-lived, single-use connection code; shown once, stored as a hash."""
    user = _user()
    if purpose not in ("Enroll", "Replace"):
        fail("validation_failed", "Choose connect or replace.")
    row, store = load_register(register, "enroll" if purpose == "Enroll" else "recover")
    if row.lifecycle == "Retired":
        fail("invalid_state", "Retired cajas cannot connect devices.")
    active = frappe.db.get_value("POS Device Binding", {"register": row.name, "active": 1, "kind": "Selling"}, "name")
    if purpose == "Enroll" and active:
        fail("invalid_state", "This caja already has a connected device. Use device replacement.", ["replace_device"])
    if purpose == "Replace":
        if not active:
            fail("invalid_state", "No device is connected yet. Connect one instead.", ["connect_device"])
        with rules():
            reason = model.normalize_reason(reason)
        if not cint(acknowledge_recovery):
            fail("validation_failed", "Acknowledge that the previous device may hold unsynced work.")
        _reauth(password)
    # Cancel older unused codes for this register: one live code at a time.
    frappe.db.sql("""UPDATE `tabPOS Enrollment Challenge` SET state='Cancelled'
        WHERE register=%s AND state='Issued'""", (row.name,))
    code = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    expires = now_datetime() + _dt.timedelta(seconds=model.CHALLENGE_TTL_SECONDS)
    doc = insert(frappe.get_doc({"doctype": "POS Enrollment Challenge", "register": row.name, "store": store.name,
                                 "purpose": purpose, "state": "Issued", "code_hash": model.secret_hash(code),
                                 "expires_at": expires, "issued_by": user, "reason": reason}))
    emit("device.challenge_issued", "POS Register", row.name, None, store=store.name,
         payload={"purpose": purpose, "challenge": doc.name})
    return {"code": code[:4] + "-" + code[4:], "expires_at": str(expires), "purpose": purpose,
            "register": row.name, "label": row.label, "store_name": store.store_name}


def _challenge(code, lock=False):
    with rules():
        code = model.normalize_challenge(code)
    row = frappe.db.get_value("POS Enrollment Challenge", {"code_hash": model.secret_hash(code)}, "*",
                              as_dict=True, for_update=lock)
    if not row:
        fail("validation_failed", "This connection code is not valid. Ask for a new one.")
    return row


@frappe.whitelist(methods=["POST"])
def preview_device_challenge(code):
    """What the cashier confirms on the device before enrolling it."""
    _user()
    row = _challenge(code)
    if row.state != "Issued" or get_datetime(row.expires_at) < now_datetime():
        fail("validation_failed", "This connection code expired or was already used. Ask for a new one.")
    reg, store = load_register(row.register)
    return {"register": reg.name, "label": reg.label, "register_code": reg.register_code,
            "store_name": store.store_name, "store_code": store.store_code, "purpose": row.purpose}


@frappe.whitelist(methods=["POST"])
@_retrying
def enroll_device(request_id, code, terminal_id, terminal_token, label=None, schema_version=None):
    """Redeem a code on the device; binds this browser identity to the caja."""
    user = _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
        label = model.normalize_label(label or "Dispositivo", "device name")
    terminal_id, verifier = _terminal(terminal_id, terminal_token)
    receipt = Receipt("devices.enroll", request_id, {"code_hash": model.secret_hash(re.sub(r"[\s-]+", "", str(code or "")).upper()),
                                                     "terminal_id": terminal_id, "label": label})
    if receipt.begin() is not None:
        result = receipt.replayed
        load_register(result["register"])
        return result
    challenge = _challenge(code, lock=True)
    if challenge.state != "Issued" or get_datetime(challenge.expires_at) < now_datetime():
        fail("validation_failed", "This connection code expired or was already used. Ask for a new one.")
    reg, store = load_register(challenge.register)
    if reg.lifecycle == "Retired":
        fail("invalid_state", "Retired cajas cannot connect devices.")
    # Lock order: register runtime before bindings/devices.
    runtime = lock_register(reg.name, store.name)
    device = frappe.db.get_value("POS Device", {"terminal_id": terminal_id}, "*", as_dict=True, for_update=True)
    if device and device.state == "Enrolled" and frappe.db.get_value(
            "POS Device Binding", {"device": device.name, "active": 1}, "name"):
        fail("invalid_state", "This browser is already connected to a caja. Disconnect it there first.")
    if device:
        with service_write():
            frappe.db.set_value("POS Device", device.name, {
                "state": "Enrolled", "verifier_hash": verifier, "label": label, "store": store.name,
                "installation_epoch": cint(device.installation_epoch) + 1, "enrolled_by": user,
                "enrolled_at": now_datetime(), "revoked_by": None, "revoked_at": None})
        device_name = device.name
    else:
        device_name = insert(frappe.get_doc({"doctype": "POS Device", "label": label, "store": store.name,
                                             "state": "Enrolled", "terminal_id": terminal_id,
                                             "verifier_hash": verifier, "installation_epoch": 1,
                                             "enrolled_by": user, "enrolled_at": now_datetime()})).name
    previous = frappe.db.get_value("POS Device Binding", {"register": reg.name, "active": 1, "kind": "Selling"},
                                   ["name", "device"], as_dict=True, for_update=True)
    if previous and challenge.purpose != "Replace":
        fail("invalid_state", "This caja already has a connected device. Use device replacement.", ["replace_device"])
    generation = cint(runtime.ownership_generation) + 1
    if previous:
        with service_write():
            frappe.db.set_value("POS Device Binding", previous.name, {
                "active": 0, "ended_at": now_datetime(), "end_reason": "Replaced: " + (challenge.reason or ""),
                "active_register_key": None, "active_device_key": None})
    binding = insert(frappe.get_doc({
        "doctype": "POS Device Binding", "device": device_name, "register": reg.name, "store": store.name,
        "kind": "Selling", "generation": generation, "active": 1, "started_at": now_datetime(),
        "authorized_by": challenge.issued_by, "reason": challenge.reason or "Enrollment",
        "active_register_key": reg.name, "active_device_key": device_name}))
    frappe.db.sql("""UPDATE `tabPOS Register Runtime` SET active_binding=%s, ownership_generation=%s,
        row_revision=row_revision+1, modified=%s WHERE name=%s""", (binding.name, generation, now_datetime(), reg.name))
    with service_write():
        frappe.db.set_value("POS Enrollment Challenge", challenge.name, {
            "state": "Used", "used_by": user, "used_at": now_datetime(), "device": device_name,
            "binding": binding.name})
    shift = runtime.active_opening_shift
    if previous and shift:
        _rebind_open_shift(shift, terminal_id, verifier, challenge)
    emit("device.bound", "POS Register", reg.name, cint(runtime.row_revision) + 1, store=store.name, receipt=receipt,
         payload={"device": device_name, "binding": binding.name, "generation": generation,
                  "replaced": previous.name if previous else None, "open_shift": shift})
    result = {"register": reg.name, "label": reg.label, "store_name": store.store_name, "device": device_name,
              "binding": binding.name, "generation": str(generation), "replaced": bool(previous),
              "open_shift": shift}
    receipt.complete(result, "POS Device Binding", binding.name, store=store.name)
    return result


def _rebind_open_shift(shift, terminal_id, verifier, challenge):
    """FND-T04: replacement fences the old browser; saved work keeps its owner.

    Same effect as a supervisor terminal transfer: the shift's possession
    credential moves to the new device, the generation advances (old queued
    submissions fail their generation check and enter recovery), and closing
    stays blocked until recovery review. The shift's cashier is unchanged.
    """
    from posawesome.posawesome.api.shifts import lock_opening_shift

    lock_opening_shift(shift)
    generation = cint(frappe.db.get_value("POS Opening Shift", shift, "posa_terminal_generation")) + 1
    frappe.db.set_value("POS Opening Shift", shift, {
        "posa_terminal_id": terminal_id, "posa_terminal_token_hash": verifier,
        "posa_terminal_generation": generation, "posa_terminal_resume_from_generation": 0,
        "posa_terminal_recovery_pending": 1})
    frappe.get_doc("POS Opening Shift", shift).add_comment("Info", text=frappe.utils.escape_html(_(
        "Device replaced by {0}; generation {1}. Previous browser credentials revoked. {2}").format(
            challenge.issued_by, generation, challenge.reason or "")))


@frappe.whitelist(methods=["POST"])
@_retrying
def revoke_device(request_id, device, reason, password, acknowledge_recovery=0, schema_version=None):
    user = _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
        reason = model.normalize_reason(reason)
    row = frappe.db.get_value("POS Device", device, ["name", "store", "state"], as_dict=True)
    if not row:
        denied()
    store = load_store(row.store, "recover")
    if not cint(acknowledge_recovery):
        fail("validation_failed", "Acknowledge that this device may hold unsynced work.")
    _reauth(password)
    receipt = Receipt("devices.revoke", request_id, {"device": device, "reason": reason}, store=store.name)
    if receipt.begin() is not None:
        return receipt.replayed
    binding = frappe.db.get_value("POS Device Binding", {"device": device, "active": 1},
                                  ["name", "register"], as_dict=True)
    if binding and binding.register:
        runtime = lock_register(binding.register, store.name)
        frappe.db.sql("""UPDATE `tabPOS Register Runtime` SET active_binding=NULL,
            ownership_generation=ownership_generation+1, row_revision=row_revision+1 WHERE name=%s""",
                      (binding.register,))
        if runtime.active_opening_shift:
            # Fence the revoked browser immediately; recovery review is required.
            shift = runtime.active_opening_shift
            from posawesome.posawesome.api.shifts import lock_opening_shift

            lock_opening_shift(shift)
            frappe.db.set_value("POS Opening Shift", shift, {
                "posa_terminal_id": "", "posa_terminal_token_hash": "",
                "posa_terminal_generation": cint(frappe.db.get_value("POS Opening Shift", shift,
                                                                     "posa_terminal_generation")) + 1,
                "posa_terminal_recovery_pending": 1})
    if binding:
        with service_write():
            frappe.db.set_value("POS Device Binding", binding.name, {
                "active": 0, "ended_at": now_datetime(), "end_reason": "Revoked: " + reason,
                "active_register_key": None, "active_device_key": None})
    with service_write():
        frappe.db.set_value("POS Device", device, {"state": "Revoked", "revoked_by": user,
                                                   "revoked_at": now_datetime(), "revocation_reason": reason})
    emit("device.revoked", "POS Device", device, None, store=store.name, receipt=receipt,
         payload={"binding": binding.name if binding else None, "reason": reason})
    result = {"device": device, "state": "Revoked", "register": binding.register if binding else None}
    receipt.complete(result, "POS Device", device)
    return result


def _device_for(register, terminal_id, terminal_token, required=True):
    """Active selling binding of ``register`` proven by this browser's secret."""
    terminal_id, verifier = _terminal(terminal_id, terminal_token)
    row = frappe.db.sql("""SELECT b.name, b.device, b.generation, d.verifier_hash
        FROM `tabPOS Device Binding` b INNER JOIN `tabPOS Device` d ON d.name = b.device
        WHERE b.register=%s AND b.active=1 AND b.kind='Selling' AND d.state='Enrolled' AND d.terminal_id=%s""",
                        (register, terminal_id), as_dict=True)
    if not row or not hmac.compare_digest(str(row[0].verifier_hash or ""), verifier):
        if required:
            fail("ownership_changed", "This browser is not the connected device for this caja. Ask a supervisor to connect or replace it.",
                 ["connect_device", "replace_device"])
        return None
    return frappe._dict(row[0])


@frappe.whitelist(methods=["POST"])
def heartbeat(register, terminal_id, terminal_token, client_version=None):
    """Connectivity observation only; never grants possession (FND-03)."""
    _user()
    row, _store = load_register(register)
    binding = _device_for(row.name, terminal_id, terminal_token, required=False)
    if not binding:
        return {"observed": False}
    touch(row.name, binding.device)
    frappe.db.set_value("POS Device", binding.device, {"last_heartbeat": now_datetime(),
                                                      "last_version": str(client_version or "")[:60]},
                        update_modified=False)
    return {"observed": True, "as_of": str(now_datetime())}


# --------------------------------------------------------------------------
# Opening (FND-02, FND-05, FND-T02, FND-T05)
# --------------------------------------------------------------------------

def _balances(balance_details):
    rows = _json(balance_details, [])
    if not isinstance(rows, list) or len(rows) > 50:
        fail("validation_failed", "Invalid opening balances.")
    return [{"mode_of_payment": str(r.get("mode_of_payment") or ""), "amount": float(r.get("amount") or 0)}
            for r in rows if isinstance(r, dict)]


def _apply_pending(doc):
    pending = _json(doc.pending_configuration, None)
    if not pending:
        return False
    doc.pending_configuration = None
    for field, value in pending.items():
        doc.set(field, value)
    save(doc)  # re-runs exclusivity/validity checks with the drawer now free
    return True


@frappe.whitelist(methods=["POST"])
@_retrying
def open_register(request_id, register, balance_details, terminal_id, terminal_token,
                  expected_revision=None, schema_version=None):
    user = _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
    row, store = load_register(register, "sell")
    from posawesome.posawesome.api._scope import assert_company, assert_profile

    assert_profile(user, row.pos_profile)
    assert_company(user, row.company)
    balances = _balances(balance_details)
    receipt = Receipt("registers.open", request_id, {"register": register, "balances": balances,
                                                     "terminal_id": str(terminal_id or "")}, store=store.name)
    if receipt.begin() is not None:
        return _opening_payload(receipt.replayed["opening_shift"], terminal_id, terminal_token)
    if store.status != "Active":
        fail("invalid_state", "This store is suspended; new shifts cannot open.")
    binding = _device_for(row.name, terminal_id, terminal_token, required=cint(row.requires_enrolled_device))
    # §7 lock order: receipt (held) → cashier runtime → register runtime.
    cashier = lock_cashier(user)
    runtime = lock_register(row.name, store.name)
    assert_cashier_free(user, cashier)
    if runtime.active_opening_shift:
        state = frappe.db.get_value("POS Opening Shift", runtime.active_opening_shift, ["status", "user"], as_dict=True)
        if state and state.status == "Open":
            fail("invalid_state", "This caja is already open by another cashier.", ["request_help"])
    if expected_revision not in (None, ""):
        with rules():
            model.assert_revision(runtime.row_revision, expected_revision)
    doc = frappe.get_doc("POS Register", row.name, for_update=True)
    if doc.lifecycle != "Ready":
        fail("invalid_state", "This caja is not ready to open.", ["open_setup"])
    applied = _apply_pending(doc)
    from .queries import readiness_for

    missing = readiness_for(doc.as_dict(), store, binding_override=bool(binding))
    if missing:
        fail("invalid_state", "This caja is not ready: {0}", ["open_setup"],
             args=("; ".join(_(i["message"]) for i in missing),))
    profile = frappe.get_doc("POS Profile", doc.pos_profile)
    from .routing import build_snapshot, cash_modes

    modes = set(cash_modes(profile))
    allowed_modes = {p.mode_of_payment for p in profile.get("payments") or []}
    for bal in balances:
        if bal["mode_of_payment"] not in allowed_modes:
            fail("validation_failed", "An opening balance uses a payment method this caja does not accept.")
        if doc.mode == "Cashless" and bal["mode_of_payment"] in modes and abs(bal["amount"]) >= 0.005:
            fail("invalid_state", "A cashless caja opens without cash.")
    from posawesome.posawesome.api.cash_custody.service import enforce_opening
    enforce_opening(doc.pos_profile, balances)

    started = now_datetime()
    with rules():
        day = model.business_date(_utc(started), store.timezone, store.business_day_cutoff)
    from posawesome.posawesome.api.vertical import effective_contract_stamp

    snapshot_json, fingerprint, version = effective_contract_stamp(doc.pos_profile)
    snapshot = build_snapshot(doc, store, profile, business_date=day, binding=binding,
                              capability_version=version, capability_fingerprint=fingerprint)
    shift = frappe.get_doc({"doctype": "POS Opening Shift", "period_start_date": started,
                            "posting_date": frappe.utils.getdate(), "user": user, "pos_profile": doc.pos_profile,
                            "company": doc.company, "docstatus": 1})
    shift.set("balance_details", balances)
    shift.posa_effective_contract = snapshot_json
    shift.posa_contract_fingerprint = fingerprint
    shift.posa_contract_version = version
    shift.posa_store = store.name
    shift.posa_register = doc.name
    shift.posa_business_date = day
    shift.posa_drawer_account = snapshot["drawer_account"]
    shift.posa_register_contract_version = model.REGISTER_CONTRACT_VERSION
    shift.posa_binding_generation = snapshot["binding_generation"]
    shift.posa_register_snapshot = json.dumps(snapshot, sort_keys=True, default=str)
    shift.flags.posa_register_open = True
    from posawesome.posawesome.api.shift_terminal import bind_new_shift
    bind_new_shift(shift, terminal_id, terminal_token)
    shift.insert(ignore_permissions=True)

    with service_write():
        frappe.db.sql("""UPDATE `tabPOS Register Runtime` SET active_opening_shift=%s, active_cashier=%s,
            work_state='Open', row_revision=row_revision+1, modified=%s WHERE name=%s""",
                      (shift.name, user, now_datetime(), doc.name))
        point_cashier(user, shift.name, doc.name)
        if not doc.has_activity:
            frappe.db.set_value("POS Register", doc.name, "has_activity", 1, update_modified=False)
        if not store.has_activity:
            frappe.db.set_value("POS Store", store.name, "has_activity", 1, update_modified=False)
    emit("register.opened", "POS Register", doc.name, cint(runtime.row_revision) + 1, store=store.name,
         receipt=receipt, payload={"opening_shift": shift.name, "cashier": user, "business_date": str(day),
                                   "binding_generation": snapshot["binding_generation"],
                                   "applied_pending_configuration": applied})
    receipt.complete({"opening_shift": shift.name, "register": doc.name, "store": store.name,
                      "business_date": str(day)}, "POS Opening Shift", shift.name)
    return _opening_payload(shift.name, terminal_id, terminal_token)


def _utc(naive_local):
    """Frappe datetimes are naive in the site's system timezone."""
    from zoneinfo import ZoneInfo

    from frappe.utils import get_system_timezone

    return naive_local.replace(tzinfo=ZoneInfo(get_system_timezone())).astimezone(_dt.timezone.utc)


def _opening_payload(opening_shift, terminal_id=None, terminal_token=None):
    """Same shape as create_opening_voucher plus the register block."""
    shift = frappe.get_doc("POS Opening Shift", opening_shift)
    if shift.user != frappe.session.user:
        denied()
    load_register(shift.posa_register, "sell")
    from posawesome.posawesome.api.cash_custody.service import is_enabled
    from posawesome.posawesome.api.shift_terminal import _status
    from posawesome.posawesome.api.shifts import update_opening_shift_data

    data = {"pos_opening_shift": shift.as_dict(),
            "terminal_status": _status(shift, terminal_id, terminal_token)}
    update_opening_shift_data(data, shift.pos_profile)
    data["cash_custody_enabled"] = is_enabled(shift.pos_profile)
    data["register"] = register_block(shift)
    return data


def register_block(shift):
    snap = _json(shift.get("posa_register_snapshot"), {}) or {}
    return {"register": shift.posa_register, "store": shift.posa_store, "label": snap.get("label"),
            "register_code": snap.get("register_code"), "store_name": snap.get("store_name"),
            "business_date": str(shift.posa_business_date or ""), "mode": snap.get("mode"),
            "contract_version": cint(shift.posa_register_contract_version)}


# --------------------------------------------------------------------------
# Grants (FND-T10)
# --------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
@_retrying
def grant_access(request_id, user, bundle, store=None, company=None, valid_to=None, reason=None,
                 schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
    scope_type = "Store" if store else "Company"
    if store:
        load_store(store, "assign")
    elif not is_admin():
        denied("Only an administrator can grant company-wide access.")
    receipt = Receipt("assignments.grant", request_id, {"user": user, "bundle": bundle, "store": store,
                                                        "company": company, "valid_to": valid_to,
                                                        "reason": reason}, store=store)
    if receipt.begin() is not None:
        return receipt.replayed
    doc = frappe.get_doc({"doctype": "POS Store Assignment", "user": user, "bundle": bundle,
                          "scope_type": scope_type, "store": store, "company": company, "enabled": 1,
                          "valid_from": now_datetime(), "valid_to": valid_to or None, "reason": reason})
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    emit("assignment.granted", "POS Store Assignment", doc.name, 1, store=store, receipt=receipt,
         payload={"user": user, "bundle": bundle, "scope_type": scope_type, "company": doc.company})
    result = {"assignment": doc.name, "revision": "1"}
    receipt.complete(result, "POS Store Assignment", doc.name)
    return result


@frappe.whitelist(methods=["POST"])
@_retrying
def revoke_access(request_id, assignment, expected_revision, reason, schema_version=None):
    _user()
    _schema(schema_version)
    with rules():
        request_id = model.request_id(request_id)
        reason = model.normalize_reason(reason)
    row = frappe.db.get_value("POS Store Assignment", assignment, ["name", "store", "scope_type"], as_dict=True)
    if not row:
        denied()
    if row.store:
        load_store(row.store, "assign")
    elif not is_admin():
        denied()
    receipt = Receipt("assignments.revoke", request_id, {"assignment": assignment, "rev": expected_revision,
                                                         "reason": reason}, store=row.store)
    if receipt.begin() is not None:
        return receipt.replayed
    doc = frappe.get_doc("POS Store Assignment", assignment, for_update=True)
    with rules():
        model.assert_revision(doc.revision, expected_revision)
    doc.enabled = 0
    doc.reason = reason
    doc.save(ignore_permissions=True)
    emit("assignment.revoked", "POS Store Assignment", doc.name, doc.revision, store=row.store, receipt=receipt,
         payload={"user": doc.user, "bundle": doc.bundle, "reason": reason})
    result = {"assignment": doc.name, "enabled": False, "revision": str(doc.revision)}
    receipt.complete(result, "POS Store Assignment", doc.name)
    return result


def register_detail_payload(register):
    from .queries import register_detail

    return register_detail(register)

