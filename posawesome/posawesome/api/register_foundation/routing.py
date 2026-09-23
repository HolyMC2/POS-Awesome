"""Drawer routing from the shift's immutable register snapshot (FND-04/05/07/08).

The snapshot is stamped once when a register shift opens. Every cash route of
that shift reads the snapshot, never the live register/profile, so a later
configuration edit cannot move an open drawer's money:

* Sales Invoice / POS Invoice ``validate`` — cash payment rows and the change
  account (sales, returns, change) → drawer account.
* Payment Entry ``validate`` — entries bound to the shift (``reference_no`` is
  the shift: collections, advance refunds, change payouts) → drawer account on
  the cash side.
* Cash movements — ``resolve_source_cash_account`` (expense, deposit, cash in).

Legacy shifts (no snapshot) keep their existing routing untouched.
"""

from __future__ import annotations

import json

import frappe


def flt(value, precision=None):
    """Local float coercion; keeps this module importable under light stubs."""
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    return round(number, precision) if precision is not None else number


def fail(*args, **kwargs):
    from .errors import fail as _fail

    return _fail(*args, **kwargs)

_CACHE = "_posa_route_cache"


def cash_modes(profile_doc) -> list[str]:
    """The drawer's physical-cash Mode of Payment for this profile.

    Only the profile's configured cash mode (default "Cash") belongs to the
    drawer — the same mode closing reconciles as cash. Other Mode of Payment
    rows typed "Cash" (e.g. a supplier balance such as "Saldo proveedores")
    are NOT drawer money and keep their own accounts.
    """
    return [profile_doc.get("posa_cash_mode_of_payment") or "Cash"]


def other_cash_type_modes(profile_doc) -> list[str]:
    """Cash-typed modes that are deliberately outside the drawer route (audit)."""
    drawer = set(cash_modes(profile_doc))
    names = {row.mode_of_payment for row in (profile_doc.get("payments") or []) if row.get("mode_of_payment")}
    names -= drawer
    if not names:
        return []
    return sorted(frappe.get_all("Mode of Payment", filters={"name": ["in", sorted(names)], "type": "Cash"},
                                 pluck="name"))


def build_snapshot(register, store, profile_doc, *, business_date, binding, capability_version,
                   capability_fingerprint):
    return {
        "register_contract_version": 1,
        "register": register.name, "register_code": register.register_code, "label": register.label,
        "store": store.name, "store_code": store.store_code, "store_name": store.store_name,
        "company": register.company, "pos_profile": register.pos_profile, "mode": register.mode,
        "drawer_account": register.drawer_account if register.mode == "Cash" else None,
        "default_safe": register.default_safe if register.mode == "Cash" else None,
        "cash_modes": cash_modes(profile_doc),
        "other_cash_type_modes": other_cash_type_modes(profile_doc),
        "currency": frappe.get_cached_value("Company", register.company, "default_currency"),
        "configuration_revision": int(register.configuration_revision or 1),
        "hardware_profile_revision": int(register.hardware_profile_revision or 0),
        "store_timezone": store.timezone, "business_day_cutoff": str(store.business_day_cutoff or "00:00:00"),
        "store_policy_version": int(store.policy_version or 1),
        "business_date": str(business_date),
        "device": binding.device if binding else None,
        "binding": binding.name if binding else None,
        "binding_generation": int(binding.generation) if binding else 0,
        "capability_contract_version": capability_version,
        "capability_fingerprint": capability_fingerprint,
    }


def shift_route(opening_shift):
    """Parsed snapshot for a register shift, or None for a legacy shift."""
    if not opening_shift or not isinstance(opening_shift, str):
        return None
    cache = getattr(frappe.local, _CACHE, None)
    if cache is None:
        cache = {}
        setattr(frappe.local, _CACHE, cache)
    if opening_shift in cache:
        return cache[opening_shift]
    route = None
    if frappe.db.has_column("POS Opening Shift", "posa_register_snapshot"):
        raw = frappe.db.get_value("POS Opening Shift", opening_shift, "posa_register_snapshot")
        if raw:
            route = json.loads(raw)
    cache[opening_shift] = route
    return route


def drawer_for(opening_shift, mode_of_payment):
    """Drawer account when this shift's route owns ``mode_of_payment``.

    Returns (route, account|None). A cashless register returns the route with
    no account; callers refuse any nonzero cash on it.
    """
    route = shift_route(opening_shift)
    if not route or mode_of_payment not in (route.get("cash_modes") or []):
        return route, None
    return route, route.get("drawer_account")


def _refuse_cash(route, amount):
    if route and route.get("mode") == "Cashless" and abs(flt(amount)) >= 0.005:
        fail("invalid_state", "This caja is cashless and cannot accept or pay out cash. Use another payment method or a cash caja.")


def apply_invoice_route(doc, method=None):
    """Sales Invoice / POS Invoice validate hook (runs after the controller)."""
    route = shift_route(doc.get("posa_pos_opening_shift"))
    if not route:
        return
    if doc.get("company") != route.get("company"):
        fail("scope_denied", "The sale and its caja belong to different companies.")
    modes = set(route.get("cash_modes") or [])
    drawer = route.get("drawer_account")
    has_cash = False
    for row in doc.get("payments") or []:
        if row.get("mode_of_payment") in modes:
            _refuse_cash(route, row.get("amount"))
            if drawer:
                row.account = drawer
                has_cash = True
    _refuse_cash(route, doc.get("change_amount"))
    if drawer and (has_cash or flt(doc.get("change_amount"))):
        doc.account_for_change_amount = drawer


def apply_payment_entry_route(doc, method=None):
    """Payment Entry validate hook for entries bound to a register shift."""
    reference = doc.get("reference_no")
    if not reference or doc.get("docstatus", 0) == 2:
        return
    route = shift_route(reference)
    if not route or doc.get("mode_of_payment") not in (route.get("cash_modes") or []):
        return
    if doc.get("company") != route.get("company"):
        fail("scope_denied", "The payment and its caja belong to different companies.")
    _refuse_cash(route, doc.get("paid_amount"))
    drawer = route.get("drawer_account")
    if not drawer:
        return
    if doc.payment_type == "Receive":
        doc.paid_to = drawer
        doc.paid_to_account_currency = route.get("currency") or doc.paid_to_account_currency
    elif doc.payment_type == "Pay":
        doc.paid_from = drawer
        doc.paid_from_account_currency = route.get("currency") or doc.paid_from_account_currency


def movement_drawer(payload):
    """Cash-movement drawer for a register shift; None for legacy shifts."""
    shift = (payload or {}).get("pos_opening_shift") or (payload or {}).get("pos_opening_shift_name")
    route = shift_route(shift)
    if not route:
        return None
    if route.get("mode") == "Cashless" or not route.get("drawer_account"):
        fail("invalid_state", "This caja is cashless; it has no drawer for cash movements.")
    selected = str((payload or {}).get("source_account") or "").strip()
    if selected and selected != route["drawer_account"]:
        fail("validation_failed", "This caja's cash movements always use its own drawer account.")
    return route["drawer_account"]


def caja_managed(pos_profile) -> bool:
    """True when an activated caja serves ``pos_profile`` (and cajas are not paused)."""
    conf = getattr(frappe, "conf", None) or {}
    if not pos_profile or conf.get("posa_registers_disabled"):
        return False
    table_exists = getattr(getattr(frappe, "db", None), "table_exists", None)
    if not callable(table_exists) or not table_exists("POS Register"):
        return False
    return bool(frappe.db.exists("POS Register", {"pos_profile": pos_profile,
                                                  "lifecycle": ["in", ["Ready", "Suspended"]]}))


def session_drawer_route(pos_profile, mode_of_payment=None):
    """(drawer_account, opening_shift) for cash routes not bound to a shift document.

    Gift-card issue/top-up and purchase payments name only a profile. On a
    caja-managed profile the drawer cash mode must move through the acting
    user's own open caja shift: it is resolved server-side, LOCKED (the same
    first lock closing takes) and re-checked as open, so a concurrent close
    either finishes first (then this refuses) or waits and sees this document.
    Non-drawer tenders and legacy profiles return (None, None) unchanged.
    """
    if not caja_managed(pos_profile):
        return None, None
    # Non-drawer tenders (card, transfer, supplier balance…) keep their own
    # accounts and never need an open caja; decide before requiring a shift.
    drawer_mode = frappe.db.get_value("POS Profile", pos_profile, "posa_cash_mode_of_payment") or "Cash"
    if mode_of_payment and mode_of_payment != drawer_mode:
        return None, None
    shift = frappe.db.get_value("POS Opening Shift", {
        "user": frappe.session.user, "pos_profile": pos_profile, "status": "Open", "docstatus": 1,
        "posa_register": ["is", "set"]}, "name")
    if shift:
        from posawesome.posawesome.api.shifts import lock_opening_shift

        row = lock_opening_shift(shift)  # current read under the shift lock
        if row.status != "Open" or int(row.docstatus or 0) != 1 or row.user != frappe.session.user:
            shift = None
    route = shift_route(shift) if shift else None
    if not route:
        fail("invalid_state", "Cash for this profile is kept per caja. Open your caja shift before taking or paying out cash.",
             ["open_shift"])
    if route.get("mode") == "Cashless" or not route.get("drawer_account"):
        fail("invalid_state", "This caja is cashless and cannot accept or pay out cash. Use another payment method or a cash caja.")
    return route["drawer_account"], shift


def session_drawer(pos_profile, mode_of_payment=None):
    """Drawer account only (see ``session_drawer_route``)."""
    return session_drawer_route(pos_profile, mode_of_payment)[0]


def shift_journal_drawer_delta(opening_shift, for_update=False):
    """Drawer cash from Journal Entries referenced to a caja shift (cheque_no).

    Gift-card issue/top-up on a caja-managed profile posts a Journal Entry into
    the stamped drawer and references the shift. Closing adds only the drawer
    account rows of those journals, so each is counted exactly once and
    legacy shifts (no snapshot) are unaffected.
    """
    route = shift_route(opening_shift)
    if not route or not route.get("drawer_account"):
        return 0.0
    value = frappe.db.sql(
        """SELECT COALESCE(SUM(jea.debit - jea.credit), 0) FROM `tabJournal Entry Account` jea
        INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
        WHERE je.docstatus = 1 AND je.cheque_no = %s AND jea.account = %s"""
        + (" FOR UPDATE" if for_update else ""),
        (opening_shift, route["drawer_account"]))[0][0]
    return flt(value, 2)
