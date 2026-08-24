"""The Cobranza panel's one write: filing a reminder (COBRANZA_GOLDEN_FLOW).

A reminder is a LOG row — never money. `receivables.py` stays reads-only per
its own header, and capture stays `payment_entry.process_pos_payment`; this
module records that a customer was chased, at what level of the ladder, and
what they owed at the time.

THE LADDER IS DERIVED, NEVER STORED. The level this endpoint files is
`min(prior_count + 1, MAX_REMINDER_LEVEL)` computed HERE from the log — the
client's `next_level` echo is display only. Two rules keep the derivation
honest:

* one step per invoice per day — the CRM seguimiento this rides beside is
  idempotent per customer+day, and a cashier pressing the button twice must
  not walk a customer from «gentle» to «firm» in one afternoon. The second
  press answers `already_today` instead of writing;
* the cap repeats — a customer at level 3 gets another level-3 row, never a
  level 4 the letterhead does not have.

Gated exactly like the reads it lives beside: register membership, the
register's own company, and the profile's customer scope.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate

from posawesome.posawesome.api._scope import assert_customer_in_profile
from posawesome.posawesome.api.receivables import (
    MAX_REMINDER_LEVEL,
    _assert_register,
    _company_for_profile,
    _receivable_doctypes,
)

#: Channels the log accepts — mirrors the doctype's Select. The endpoint
#: normalises rather than throwing: a stale client sending "whatsapp" gets a
#: correctly-cased row, an unknown string gets the honest "Other".
REMINDER_CHANNELS = ("CRM", "WhatsApp", "Email", "Phone", "Other")


def _normalize_channel(channel):
    wanted = str(channel or "").strip().lower()
    for known in REMINDER_CHANNELS:
        if known.lower() == wanted:
            return known
    return "CRM" if not wanted else "Other"


@frappe.whitelist(methods=["POST"])
def file_reminder(pos_profile, invoice, doctype="Sales Invoice", channel=None, note=None):
    """Record one press of the panel's Reminder button.

    Returns the invoice's refreshed ladder state — the same shape
    `attach_reminder_state` stamps on worklist rows — so the surface can
    update its chip without a second round trip.
    """
    _assert_register(pos_profile)
    company = _company_for_profile(pos_profile)

    doctype = str(doctype or "Sales Invoice").strip()
    if doctype not in _receivable_doctypes(pos_profile):
        frappe.throw(_("{0} is not an invoice this register collects against.").format(doctype))

    source = frappe.db.get_value(
        doctype,
        invoice,
        ["name", "company", "customer", "outstanding_amount", "docstatus"],
        as_dict=True,
    )
    if not source or cint(source.get("docstatus")) != 1 or source.get("company") != company:
        # Same wording as the detail read, for the same reason: "wrong
        # company" confirms a guessed folio exists.
        frappe.throw(_("Invoice {0} was not found on this register.").format(invoice))
    if flt(source.get("outstanding_amount")) <= 0:
        frappe.throw(_("Invoice {0} has nothing pending to remind about.").format(invoice))

    assert_customer_in_profile(frappe.session.user, source.get("customer"), pos_profile)

    prior = frappe.get_all(
        "POS Collection Reminder",
        filters={"invoice": invoice, "invoice_doctype": doctype},
        fields=["name", "level", "creation"],
        order_by="creation asc",
        limit_page_length=0,
        ignore_permissions=True,
    )
    today = nowdate()
    filed_today = [
        entry for entry in prior if str(entry.get("creation") or "")[:10] == str(today)
    ]
    if filed_today:
        latest = filed_today[-1]
        return {
            "already_today": True,
            "reminder": latest.get("name"),
            "level": cint(latest.get("level")),
            "count": len(prior),
            "next_level": min(len(prior) + 1, MAX_REMINDER_LEVEL),
        }

    level = min(len(prior) + 1, MAX_REMINDER_LEVEL)
    entry = frappe.get_doc(
        {
            "doctype": "POS Collection Reminder",
            "invoice_doctype": doctype,
            "invoice": invoice,
            "customer": source.get("customer"),
            "company": company,
            "pos_profile": pos_profile,
            "level": level,
            "channel": _normalize_channel(channel),
            "outstanding_at_send": flt(source.get("outstanding_amount")),
            "note": str(note or "").strip() or None,
        }
    )
    # The endpoint IS the permission gate (register + company + customer
    # scope, above) — the same pattern every write in this app follows, so a
    # cashier role needs no Desk-side grant to press the panel's button.
    entry.insert(ignore_permissions=True)

    return {
        "already_today": False,
        "reminder": entry.name,
        "level": level,
        "count": len(prior) + 1,
        "next_level": min(len(prior) + 2, MAX_REMINDER_LEVEL),
    }
