"""One durable selling capability per opening shift; no timed takeover."""

import hashlib
import hmac
import json
import re

import frappe
from frappe import _
from frappe.utils import cint

from ._scope import assert_company, assert_profile


def _credentials(terminal_id, terminal_token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", str(terminal_id or "")):
        frappe.throw(_("This browser needs terminal registration. Open Offline Status."))
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", str(terminal_token or "")):
        frappe.throw(_("This browser needs terminal registration. Open Offline Status."))
    return str(terminal_id), hashlib.sha256(terminal_token.encode()).hexdigest()


def _load(opening_shift):
    from .shifts import lock_opening_shift
    lock_opening_shift(opening_shift)
    row = frappe.db.get_value("POS Opening Shift", opening_shift, "*", as_dict=True, for_update=True)
    assert_profile(frappe.session.user, row.pos_profile)
    assert_company(frappe.session.user, row.company)
    return row


def _manager():
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import is_closing_supervisor
    return is_closing_supervisor(frappe.session.user)


def _owner_or_manager(row):
    if row.user != frappe.session.user and not _manager():
        frappe.throw(_("Only the shift owner or a POS supervisor can manage this terminal."), frappe.PermissionError)


def _open(row):
    if cint(row.docstatus) != 1 or row.status != "Open":
        frappe.throw(_("This shift is no longer open. Refresh the register."))


def _matches(row, terminal_id, terminal_generation, terminal_token):
    terminal_id, token_hash = _credentials(terminal_id, terminal_token)
    return (row.get("posa_terminal_id") == terminal_id and
            cint(row.get("posa_terminal_generation")) == cint(terminal_generation) and
            hmac.compare_digest(str(row.get("posa_terminal_token_hash") or ""), token_hash))


def assert_terminal_access(opening_shift_name, terminal_id=None, terminal_generation=None,
                           terminal_token=None, *, acting_user=None):
    """Public money boundary: verify possession before any party/invoice locks."""
    row = _load(opening_shift_name)
    _open(row)
    if row.user != (acting_user or frappe.session.user):
        frappe.throw(_("This shift belongs to another cashier."), frappe.PermissionError)
    if not _matches(row, terminal_id, terminal_generation, terminal_token):
        frappe.throw(_("This shift is assigned to another browser or its registration changed. Saved work is preserved; open Offline Status for recovery."), frappe.PermissionError)
    _grant(row)
    return row


def assert_verified_terminal_generation(opening_shift_name, terminal_generation):
    """Internal worker only: generation was recorded after public possession proof."""
    row = _load(opening_shift_name)
    _open(row)
    if not terminal_generation or cint(row.get("posa_terminal_generation")) != cint(terminal_generation):
        frappe.throw(_("Terminal registration changed before submission. Saved work needs review."))
    _grant(row)
    return row


def _grant(row):
    grants = getattr(frappe.local, "posa_verified_terminal_generations", None)
    if grants is None:
        grants = {}
        frappe.local.posa_verified_terminal_generations = grants
    grants[row.name] = cint(row.get("posa_terminal_generation"))


def assert_order_terminal(pos_profile, terminal_context):
    """Waiters may share tickets while each writes from their own shift."""
    context = json.loads(terminal_context) if isinstance(terminal_context, str) else terminal_context
    if not isinstance(context, dict) or not context.get("opening_shift"):
        frappe.throw(_("Register this browser before changing table orders. Open Offline Status."))
    row = assert_terminal_access(context["opening_shift"], context.get("terminal_id"),
                                 context.get("terminal_generation"), context.get("terminal_token"))
    if row.pos_profile != pos_profile:
        frappe.throw(_("The terminal and table order must use the same POS profile."), frappe.PermissionError)
    return context


def _status(row, terminal_id=None, terminal_token=None):
    owned = False
    if terminal_id and terminal_token:
        owned = _matches(row, terminal_id, row.get("posa_terminal_generation"), terminal_token)
    return {"opening_shift": row.name, "terminal_id": row.get("posa_terminal_id") or "",
            "terminal_generation": cint(row.get("posa_terminal_generation")), "owned": owned,
            "recovery_pending": bool(row.get("posa_terminal_recovery_pending")),
            "can_manage": bool(_manager()), "status": row.status}


def _audit(row, action, reason=""):
    # Neither the credential nor its hash belongs in the audit trail.
    frappe.get_doc("POS Opening Shift", row.name).add_comment("Info", text=frappe.utils.escape_html(_(
        "Terminal {0}; generation {1}. {2}").format(action, row.get("posa_terminal_generation"), reason)))


def bind_new_shift(row, terminal_id, terminal_token):
    """Called only while creating a new shift, before its insert."""
    terminal_id, token_hash = _credentials(terminal_id, terminal_token)
    row.flags.posa_binding_new_terminal = True
    row.posa_terminal_id = terminal_id
    row.posa_terminal_generation = 1
    row.posa_terminal_token_hash = token_hash
    row.posa_terminal_recovery_pending = 0


@frappe.whitelist(methods=["POST"])
def get_terminal_status(opening_shift, terminal_id=None, terminal_token=None):
    row = _load(opening_shift)
    _owner_or_manager(row)
    return _status(row, terminal_id, terminal_token)


@frappe.whitelist(methods=["POST"])
def claim_terminal(opening_shift, terminal_id, terminal_token, acknowledge_legacy=0):
    row = _load(opening_shift)
    _owner_or_manager(row)
    _open(row)
    terminal_id, token_hash = _credentials(terminal_id, terminal_token)
    if row.get("posa_terminal_id"):
        if not _matches(row, terminal_id, row.get("posa_terminal_generation"), terminal_token):
            frappe.throw(_("Another browser owns this shift. Release it there or ask a manager to transfer it."))
        return _status(row, terminal_id, terminal_token)
    legacy = not cint(row.get("posa_terminal_generation"))
    if legacy and not cint(acknowledge_legacy):
        frappe.throw(_("Review saved work on previous browsers before claiming this legacy shift."))
    values = {"posa_terminal_id": terminal_id, "posa_terminal_token_hash": token_hash,
              "posa_terminal_generation": cint(row.get("posa_terminal_generation")) + 1,
              "posa_terminal_recovery_pending": cint(legacy or row.get("posa_terminal_recovery_pending"))}
    frappe.db.set_value("POS Opening Shift", row.name, values)
    row.update(values)
    _audit(row, "claimed", "Previous-browser review required" if legacy else "")
    return _status(row, terminal_id, terminal_token)


@frappe.whitelist(methods=["POST"])
def release_terminal(opening_shift, terminal_id, terminal_generation, terminal_token, drained=0):
    row = assert_terminal_access(opening_shift, terminal_id, terminal_generation, terminal_token)
    if not cint(drained) or row.get("posa_terminal_recovery_pending"):
        frappe.throw(_("Sync and review all saved work before releasing this terminal."))
    values = {"posa_terminal_id": "", "posa_terminal_token_hash": "",
              "posa_terminal_generation": cint(row.get("posa_terminal_generation")) + 1}
    frappe.db.set_value("POS Opening Shift", row.name, values)
    row.update(values)
    _audit(row, "released", "Original browser reported durable queue drained")
    return _status(row)


@frappe.whitelist(methods=["POST"])
def transfer_terminal(opening_shift, terminal_id, terminal_token, reason, acknowledge_saved_work=0):
    row = _load(opening_shift)
    if not _manager():
        frappe.throw(_("A POS supervisor must authorize terminal recovery."), frappe.PermissionError)
    _open(row)
    reason = str(reason or "").strip()
    if not cint(acknowledge_saved_work) or len(reason) < 8 or len(reason) > 1000:
        frappe.throw(_("Record a recovery reason and acknowledge that previous browsers may still hold unsynced sales."))
    terminal_id, token_hash = _credentials(terminal_id, terminal_token)
    values = {"posa_terminal_id": terminal_id, "posa_terminal_token_hash": token_hash,
              "posa_terminal_generation": cint(row.get("posa_terminal_generation")) + 1,
              "posa_terminal_recovery_pending": 1}
    frappe.db.set_value("POS Opening Shift", row.name, values)
    row.update(values)
    _audit(row, "force-transferred; previous credentials revoked", reason)
    return _status(row, terminal_id, terminal_token)


@frappe.whitelist(methods=["POST"])
def resolve_terminal_recovery(opening_shift, reason, acknowledge_saved_work=0):
    row = _load(opening_shift)
    if not _manager():
        frappe.throw(_("A POS supervisor must authorize terminal recovery."), frappe.PermissionError)
    reason = str(reason or "").strip()
    if not cint(acknowledge_saved_work) or len(reason) < 8 or len(reason) > 1000:
        frappe.throw(_("Record how previous-browser sales were reconciled or accounted for before allowing closure."))
    frappe.db.set_value("POS Opening Shift", row.name, "posa_terminal_recovery_pending", 0)
    row.posa_terminal_recovery_pending = 0
    _audit(row, "recovery reviewed", reason)
    return _status(row)


@frappe.whitelist(methods=["POST"])
def resume_terminal(opening_shift, terminal_id, terminal_generation, terminal_token, drained=0):
    """Fence off a possibly delayed close before this browser resumes selling."""
    row = assert_terminal_access(opening_shift, terminal_id, terminal_generation, terminal_token)
    if not cint(drained):
        frappe.throw(_("Sync and review saved work before resuming this terminal."))
    generation = cint(row.posa_terminal_generation) + 1
    frappe.db.set_value("POS Opening Shift", row.name, "posa_terminal_generation", generation)
    row.posa_terminal_generation = generation
    _audit(row, "resumed; previous close credentials revoked")
    return _status(row, terminal_id, terminal_token)


@frappe.whitelist(methods=["POST"])
def list_manageable_open_shifts():
    """Replacement-browser selector; expose only the supervisor's profiles."""
    if not _manager():
        return {"can_manage": False, "shifts": []}
    from ._scope import _is_super, get_allowed_pos_profiles
    filters = {"docstatus": 1, "status": "Open"}
    if not _is_super(frappe.session.user):
        profiles = sorted(get_allowed_pos_profiles(frappe.session.user))
        if not profiles:
            return {"can_manage": True, "shifts": []}
        filters["pos_profile"] = ["in", profiles]
    rows = frappe.get_all("POS Opening Shift", filters=filters,
        fields=["name", "user", "pos_profile", "company"], order_by="period_start_date desc", limit_page_length=200)
    return {"can_manage": True, "shifts": rows}
