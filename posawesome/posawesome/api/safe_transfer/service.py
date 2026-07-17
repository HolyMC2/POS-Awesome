"""POS Safe Transfer endpoints — safe (back-office cash) → bank.

Shift-independent by design: the remote manager records the bank deposit
days after the tills closed. Manager-only, feature-gated per POS Profile
(`posa_enable_safe_transfer`), idempotent on `client_request_id`, and
serialized per safe account with a named lock so two concurrent
transfers can't double-spend the same balance.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from posawesome.posawesome.api.cash_movement.permissions import is_manager
from posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer import (
    get_safe_gl_balance,
)

_LOCK_TIMEOUT_SECONDS = 10


def _require_manager():
    if not is_manager():
        frappe.throw(_("Only managers can record safe transfers."), frappe.PermissionError)


def _get_profile(pos_profile):
    if not pos_profile:
        frappe.throw(_("POS Profile is required."))
    profile = frappe.db.get_value(
        "POS Profile",
        pos_profile,
        [
            "name",
            "company",
            "posa_back_office_cash_account",
            "posa_bank_deposit_account",
            "posa_enable_safe_transfer",
            "posa_safe_transfer_max_amount",
        ],
        as_dict=1,
    )
    if not profile:
        frappe.throw(_("POS Profile {0} not found.").format(pos_profile))
    return profile


def _ensure_enabled(profile):
    if not profile.get("posa_enable_safe_transfer"):
        frappe.throw(_("Safe transfers are not enabled for this POS Profile."))
    if not profile.get("posa_back_office_cash_account"):
        frappe.throw(_("Back Office Cash Account is not configured on the POS Profile."))
    if not profile.get("posa_bank_deposit_account"):
        frappe.throw(_("Bank Deposit Account is not configured on the POS Profile."))


@frappe.whitelist(methods=["GET", "POST"])
def get_safe_transfer_context(pos_profile):
    _require_manager()
    profile = _get_profile(pos_profile)
    safe_account = profile.get("posa_back_office_cash_account")
    return {
        "pos_profile": profile.name,
        "company": profile.company,
        "enabled": bool(profile.get("posa_enable_safe_transfer")),
        "safe_account": safe_account,
        "bank_account": profile.get("posa_bank_deposit_account"),
        "safe_balance": get_safe_gl_balance(safe_account, profile.company) if safe_account else 0,
        "max_amount": flt(profile.get("posa_safe_transfer_max_amount")),
    }


@frappe.whitelist(methods=["POST"])
def create_safe_transfer(payload):
    _require_manager()

    data = payload
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            frappe.throw(_("Invalid payload."))
    if not isinstance(data, dict):
        frappe.throw(_("Invalid payload."))

    profile = _get_profile(data.get("pos_profile"))
    _ensure_enabled(profile)

    amount = flt(data.get("amount"))
    if amount <= 0:
        frappe.throw(_("Amount must be greater than zero."))
    max_amount = flt(profile.get("posa_safe_transfer_max_amount"))
    if max_amount and amount > max_amount:
        frappe.throw(_("Amount exceeds the configured maximum ({0}).").format(max_amount))

    client_request_id = (data.get("client_request_id") or "").strip() or None
    if client_request_id:
        existing = frappe.db.get_value(
            "POS Safe Transfer", {"client_request_id": client_request_id}, "name"
        )
        if existing:
            return frappe.get_doc("POS Safe Transfer", existing).as_dict()

    safe_account = profile["posa_back_office_cash_account"]

    # Serialize per safe account: balance re-check + insert + submit under
    # the lock, commit inside it, so a concurrent transfer can't read a
    # stale balance and double-spend the safe.
    key = f"posa_safe_transfer:{safe_account}"[:60]
    rv = frappe.db.sql("SELECT GET_LOCK(%s, %s)", (key, _LOCK_TIMEOUT_SECONDS))[0][0]
    if rv is None:
        frappe.throw(_("Could not acquire the safe lock — try again."))
    if int(rv) != 1:
        frappe.throw(_("Another transfer for this safe is in progress — try again."))
    try:
        doc = frappe.get_doc(
            {
                "doctype": "POS Safe Transfer",
                "posting_date": data.get("posting_date") or nowdate(),
                "company": profile.company,
                "pos_profile": profile.name,
                "user": frappe.session.user,
                "amount": amount,
                "source_account": safe_account,
                "target_account": profile["posa_bank_deposit_account"],
                "remarks": (data.get("remarks") or "").strip(),
                "deposit_reference": (data.get("deposit_reference") or "").strip(),
                "deposited_on": data.get("deposited_on") or None,
                "client_request_id": client_request_id,
            }
        )
        doc.flags.ignore_permissions = True
        doc.insert()
        # JE is created atomically inside on_submit (same discipline as
        # POS Cash Movement).
        doc.submit()
        doc.reload()
        frappe.db.commit()
        return doc.as_dict()
    finally:
        frappe.db.sql("SELECT RELEASE_LOCK(%s)", (key,))


@frappe.whitelist(methods=["GET", "POST"])
def list_safe_transfers(pos_profile=None, company=None, days=30, limit=100):
    _require_manager()
    from frappe.utils import add_days, cint, today

    filters = {"posting_date": [">=", add_days(today(), -max(1, min(cint(days) or 30, 365)))]}
    if pos_profile:
        filters["pos_profile"] = pos_profile
    if company:
        filters["company"] = company
    return frappe.get_all(
        "POS Safe Transfer",
        filters=filters,
        fields=[
            "name",
            "posting_date",
            "company",
            "pos_profile",
            "user",
            "amount",
            "source_account",
            "target_account",
            "deposit_reference",
            "deposited_on",
            "remarks",
            "journal_entry",
            "docstatus",
        ],
        order_by="posting_date desc, creation desc",
        limit=max(1, min(cint(limit) or 100, 500)),
    )


@frappe.whitelist(methods=["POST"])
def set_deposit_reference(name, deposit_reference, deposited_on=None):
    """Attach the bank slip folio to a submitted transfer. No GL change."""
    _require_manager()
    doc = frappe.get_doc("POS Safe Transfer", name)
    if doc.docstatus != 1:
        frappe.throw(_("Only submitted transfers can take a deposit reference."))
    doc.db_set("deposit_reference", (deposit_reference or "").strip())
    if deposited_on:
        doc.db_set("deposited_on", deposited_on)
    doc.add_comment(
        "Comment",
        _("Deposit reference set to {0} by {1}").format(
            deposit_reference, frappe.session.user
        ),
    )
    return {"name": doc.name, "deposit_reference": doc.deposit_reference, "deposited_on": doc.deposited_on}


@frappe.whitelist(methods=["POST"])
def cancel_safe_transfer(name):
    _require_manager()
    doc = frappe.get_doc("POS Safe Transfer", name)
    if doc.docstatus != 1:
        frappe.throw(_("Only submitted transfers can be cancelled."))
    doc.flags.ignore_permissions = True
    doc.cancel()
    return {"name": doc.name, "docstatus": doc.docstatus}
