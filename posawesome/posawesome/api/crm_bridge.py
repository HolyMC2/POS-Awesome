# Copyright (c) 2026, doco contributors
"""The seam between the register and the CRM.

Three things, and the split between them is the whole design (owner direction,
2026-08-23):

1. **PASSIVE** — `crm_context` tells the ticket what the back office already
   knows about this customer: open deals, the last time anyone touched them, a
   lead status when there is no deal. Read-only, and it answers
   `{"installed": false}` rather than refusing when the app is absent, so the
   SPA can hide the strip on a probe instead of learning by 403.
2. **AUTOMATIC** — a submitted sale appends a note to the customer's EXISTING
   crm record. Enqueued after commit, never inline: the submit path stays fast,
   the end-of-request rollback stays meaningful, and a sale that did not commit
   never gets logged. It creates nothing — a customer with no crm record is a
   customer the back office has not decided to track, and the register does not
   get to make that decision for them.
3. **DELIBERATE** — «Seguimiento» is the one act a cashier can take: it asks
   the back office to follow up. THAT one may create a lead, because a person
   pressed a button that says so.

NO SCHEMA CHANGES TO THE CRM APP. Everything written here is an ordinary
`FCRM Note` or `CRM Task` with `reference_doctype`/`reference_docname` — the
crm app's own generic attachment points — or a plain `CRM Lead`. Nothing adds a
field, and nothing imports the crm package: this file installs on tenants that
have no CRM at all, and every doctype is reached by name behind a probe.

MATCHING A CUSTOMER TO A CRM RECORD is the hard part, because `CRM Deal` has no
Customer link and this may not add one. The ladder in `find_deals` goes from
exact and free to broad and bounded, and stops at the first rung that answers.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from posawesome.posawesome.api._scope import (
    assert_company,
    assert_customer_in_profile,
    assert_profile,
)

CRM_APP = "crm"
DEAL_DOCTYPE = "CRM Deal"
LEAD_DOCTYPE = "CRM Lead"
NOTE_DOCTYPE = "FCRM Note"
TASK_DOCTYPE = "CRM Task"
REPAIR_ORDER_DOCTYPE = "Repair Order"

# `CRM Deal Status.type` values that mean the deal is still live. Read from the
# status doctype rather than from a hard-coded list of status NAMES: these
# tenants have thirty of them, half in Spanish, and a name list would go stale
# the first time somebody adds one.
OPEN_STATUS_TYPES = ("Open", "Ongoing", "On Hold")

# How many deals the strip will ever show. It is a context strip beside a
# ticket, not a report: past three, a cashier stops reading.
CONTEXT_DEAL_LIMIT = 3

# Bound on the broadest matcher. A phone-suffix LIKE cannot use an index, and
# these tenants carry ~10k deals — fine to scan once per customer selection,
# not fine to let it return the whole table.
PHONE_MATCH_LIMIT = 10


def crm_installed() -> bool:
    """True when this tenant actually has the CRM.

    Both halves matter: the app can be in `installed_apps` while a migration
    is mid-flight and the doctype is not there yet. Never raises — this is the
    probe the SPA gates on, and a probe that throws is a probe that teaches the
    frontend to retry.
    """
    try:
        if CRM_APP not in (frappe.get_installed_apps() or []):
            return False
        return bool(frappe.db.exists("DocType", DEAL_DOCTYPE))
    except Exception:
        return False


def _open_status_names() -> list[str]:
    return [
        row["name"]
        for row in frappe.get_all(
            "CRM Deal Status",
            filters={"type": ["in", list(OPEN_STATUS_TYPES)]},
            fields=["name"],
            limit_page_length=0,
        )
    ]


def _handles(customer: str) -> dict:
    """What we can match a customer on: a contact, a phone, an email."""
    row = (
        frappe.db.get_value(
            "Customer",
            customer,
            ["customer_name", "mobile_no", "email_id", "customer_primary_contact"],
            as_dict=True,
        )
        or {}
    )
    phone = str(row.get("mobile_no") or "").strip()
    return {
        "customer_name": row.get("customer_name") or customer,
        "contact": row.get("customer_primary_contact") or None,
        "phone": phone or None,
        # Last eight digits, which is what survives "+52 " prefixes, spaces and
        # dashes on both sides of the match.
        "phone_tail": "".join(ch for ch in phone if ch.isdigit())[-8:] or None,
        "email": (str(row.get("email_id") or "").strip() or None),
    }


def _deals_from_repairs(customer: str) -> list[str]:
    """The exact link taller already keeps: `Repair Order.crm_deal`.

    Free and indexed where it exists, which makes it the first rung. Guarded
    on the doctype AND the two custom columns, because both are added by
    taller's installer and a site mid-upgrade has neither.
    """
    if not frappe.db.exists("DocType", REPAIR_ORDER_DOCTYPE):
        return []
    if not (
        frappe.db.has_column(REPAIR_ORDER_DOCTYPE, "customer")
        and frappe.db.has_column(REPAIR_ORDER_DOCTYPE, "crm_deal")
    ):
        return []
    rows = frappe.get_all(
        REPAIR_ORDER_DOCTYPE,
        filters={"customer": customer, "crm_deal": ["is", "set"]},
        fields=["crm_deal"],
        order_by="creation desc",
        limit_page_length=PHONE_MATCH_LIMIT,
    )
    return [row["crm_deal"] for row in rows if row.get("crm_deal")]


def find_deals(customer: str, handles: dict, open_only: bool = True) -> list[dict]:
    """Deals that belong to this customer, best evidence first.

    Four rungs, each stopping the ladder when it answers:

    1. `Repair Order.crm_deal` — an explicit link somebody already made.
    2. `CRM Deal.contact` — the same Contact the Customer points at.
    3. Exact phone or email.
    4. Phone SUFFIX, bounded. The broad one, and last for a reason: it matches
       on the last eight digits, so two customers who share a landline would
       both surface. That is the right failure for a read-only strip beside a
       ticket, and the wrong one for anything that writes — which is why
       `log_sale_to_crm` and `create_seguimiento` use the same ladder but only
       ever act on a SINGLE unambiguous match.
    """
    statuses = _open_status_names() if open_only else None
    fields = ["name", "status", "deal_value", "currency", "deal_owner", "modified", "organization"]

    def _fetch(filters: dict) -> list[dict]:
        if statuses is not None:
            filters = {**filters, "status": ["in", statuses]}
        return frappe.get_all(
            DEAL_DOCTYPE,
            filters=filters,
            fields=fields,
            order_by="modified desc",
            limit_page_length=CONTEXT_DEAL_LIMIT,
        )

    linked = _deals_from_repairs(customer)
    if linked:
        found = _fetch({"name": ["in", linked]})
        if found:
            return found

    if handles.get("contact"):
        found = _fetch({"contact": handles["contact"]})
        if found:
            return found

    for field, value in (("mobile_no", handles.get("phone")), ("email", handles.get("email"))):
        if value:
            found = _fetch({field: value})
            if found:
                return found

    tail = handles.get("phone_tail")
    if tail and len(tail) >= 7:
        found = _fetch({"mobile_no": ["like", f"%{tail}"]})
        if found:
            return found
    return []


def find_lead(handles: dict) -> dict | None:
    """An unconverted lead for the same phone or email, when there is no deal."""
    if not frappe.db.exists("DocType", LEAD_DOCTYPE):
        return None
    for field, value in (("mobile_no", handles.get("phone")), ("email", handles.get("email"))):
        if not value:
            continue
        rows = frappe.get_all(
            LEAD_DOCTYPE,
            filters={field: value, "converted": 0},
            fields=["name", "status", "lead_name", "modified", "lead_owner"],
            order_by="modified desc",
            limit_page_length=1,
        )
        if rows:
            return rows[0]
    return None


@frappe.whitelist(methods=["GET", "POST"])
def crm_context(customer, pos_profile):
    """What the back office knows about this customer, for the ticket's strip.

    Returns `{"installed": False}` — never an exception — when the tenant has
    no CRM. That is the contract the SPA gates on: a probe that refuses teaches
    the frontend to retry, and a strip that polls a 403 is the floors/tables
    lesson repeated.
    """
    if not crm_installed():
        return {"installed": False}

    customer = str(customer or "").strip()
    if not customer:
        return {"installed": True, "deals": [], "lead": None}
    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, frappe.db.get_value("POS Profile", pos_profile, "company"))
    assert_customer_in_profile(frappe.session.user, customer, pos_profile)

    handles = _handles(customer)
    deals = find_deals(customer, handles)
    lead = None if deals else find_lead(handles)
    return {
        "installed": True,
        "customer": customer,
        "deals": [
            {
                "name": deal["name"],
                "status": deal.get("status"),
                "amount": flt(deal.get("deal_value")),
                "currency": deal.get("currency"),
                "owner": deal.get("deal_owner"),
                "modified": deal.get("modified"),
            }
            for deal in deals
        ],
        "lead": (
            {
                "name": lead["name"],
                "status": lead.get("status"),
                "label": lead.get("lead_name"),
                "modified": lead.get("modified"),
            }
            if lead
            else None
        ),
    }


def _note(reference_doctype: str, reference_name: str, title: str, content: str) -> str:
    doc = frappe.get_doc(
        {
            "doctype": NOTE_DOCTYPE,
            "title": title[:140],
            "content": content,
            "reference_doctype": reference_doctype,
            "reference_docname": reference_name,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def on_sales_invoice_submit(doc, method=None):
    """doc_events hook. Queues the log and returns; it never writes here.

    Inline would put a CRM lookup and an insert on the submit path — the
    hottest write in the product — and would make the end-of-request rollback
    meaningless for the note. `enqueue_after_commit` is the other half: the
    worker reads COMMITTED data, so a submit that rolls back never produces a
    note about a sale that did not happen.

    Fail-open by construction: a raise here would fail the SALE, and a note in
    another app is never worth a customer's money.
    """
    try:
        if getattr(doc, "is_return", 0):
            return
        if not getattr(doc, "customer", None):
            return
        if not crm_installed():
            return
        frappe.enqueue(
            "posawesome.posawesome.api.crm_bridge.log_sale_to_crm",
            queue="short",
            enqueue_after_commit=True,
            invoice_doctype=doc.doctype,
            invoice=doc.name,
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "posawesome: CRM auto-log could not be queued")


def log_sale_to_crm(invoice_doctype, invoice):
    """Background job: append a note about this sale to an EXISTING crm record.

    Creates nothing. A customer with no deal and no lead is a customer the back
    office has not decided to track, and an automatic job does not get to make
    that decision — `create_seguimiento` is where a person does.
    """
    if not crm_installed():
        return
    row = frappe.db.get_value(
        invoice_doctype,
        invoice,
        ["customer", "grand_total", "posting_date", "currency", "docstatus"],
        as_dict=True,
    )
    if not row or int(row.get("docstatus") or 0) != 1 or not row.get("customer"):
        return

    handles = _handles(row["customer"])
    # `open_only=False`: a sale against a WON deal is exactly the note the back
    # office wants on it. The strip's own view is narrower on purpose.
    deals = find_deals(row["customer"], handles, open_only=False)
    target = (
        (DEAL_DOCTYPE, deals[0]["name"])
        if len(deals) == 1
        else (LEAD_DOCTYPE, (find_lead(handles) or {}).get("name"))
    )
    if len(deals) > 1:
        # Ambiguous match. A note on the wrong deal is worse than no note: it is
        # a fact somebody will act on. Silence, and the strip still shows all
        # three so a person can decide.
        return
    if not target[1]:
        return

    title = _("Sale {0}").format(invoice)
    content = _("Purchase {0} — {1}, {2}").format(
        frappe.utils.fmt_money(flt(row.get("grand_total")), currency=row.get("currency")),
        invoice,
        row.get("posting_date"),
    )
    _note(target[0], target[1], title, content)


def _seguimiento_marker(customer: str, day: str) -> str:
    """Idempotency key: this customer, this day. A second press updates."""
    return f"POS:{customer}:{day}"


@frappe.whitelist(methods=["POST"])
def create_seguimiento(customer, pos_profile, note=None, reference_doctype=None, reference_name=None):
    """Ask the back office to follow up with this customer.

    On an existing deal it creates a CRM Task (the crm app's own follow-up
    object, and the one a back office already works from); with no deal it
    creates a prefilled CRM Lead. Assigned to NOBODY either way — triage is the
    back office's call, and a cashier guessing an owner is how a task lands in
    a queue nobody reads.

    Pressed twice on the same day it UPDATES rather than duplicating: the
    marker is customer + date, which is the grain a counter actually works at.
    """
    if not crm_installed():
        frappe.throw(_("The CRM is not installed on this site."))
    customer = str(customer or "").strip()
    if not customer:
        frappe.throw(_("A customer is required."))
    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, frappe.db.get_value("POS Profile", pos_profile, "company"))
    assert_customer_in_profile(frappe.session.user, customer, pos_profile)

    note = str(note or "").strip()[:1000]
    reference_doctype = str(reference_doctype or "").strip()
    reference_name = str(reference_name or "").strip()
    if reference_doctype and not frappe.db.exists("DocType", reference_doctype):
        frappe.throw(_("Unknown reference doctype {0}.").format(reference_doctype))

    handles = _handles(customer)
    day = nowdate()
    marker = _seguimiento_marker(customer, day)
    context = _("Follow-up asked for at the register by {0}.").format(frappe.session.user)
    body = "\n\n".join(part for part in (note, context, marker) if part)

    deals = find_deals(customer, handles)
    if deals:
        deal = deals[0]["name"]
        existing = frappe.db.get_value(
            TASK_DOCTYPE,
            {
                "reference_doctype": DEAL_DOCTYPE,
                "reference_docname": deal,
                "description": ["like", f"%{marker}%"],
            },
            "name",
        )
        if existing:
            frappe.db.set_value(TASK_DOCTYPE, existing, "description", body)
            return {"action": "updated", "doctype": TASK_DOCTYPE, "name": existing, "deal": deal}
        task = frappe.get_doc(
            {
                "doctype": TASK_DOCTYPE,
                "title": _("Follow up · {0}").format(handles["customer_name"])[:140],
                "description": body,
                "status": "Backlog",
                "priority": "Medium",
                "reference_doctype": DEAL_DOCTYPE,
                "reference_docname": deal,
            }
        )
        task.insert(ignore_permissions=True)
        return {"action": "created", "doctype": TASK_DOCTYPE, "name": task.name, "deal": deal}

    lead = find_lead(handles)
    if lead:
        _note(LEAD_DOCTYPE, lead["name"], _("Follow-up from the register"), body)
        return {"action": "noted", "doctype": LEAD_DOCTYPE, "name": lead["name"]}

    doc = frappe.get_doc(
        {
            "doctype": LEAD_DOCTYPE,
            "first_name": handles["customer_name"],
            "lead_name": handles["customer_name"],
            "mobile_no": handles.get("phone"),
            "email": handles.get("email"),
            # No owner: the back office triages. A cashier's guess puts it in a
            # queue nobody reads.
            "lead_owner": None,
        }
    )
    doc.insert(ignore_permissions=True)
    _note(LEAD_DOCTYPE, doc.name, _("Follow-up from the register"), body)
    if reference_doctype and reference_name:
        _note(
            LEAD_DOCTYPE,
            doc.name,
            _("From {0}").format(_(reference_doctype)),
            f"{reference_doctype}: {reference_name}",
        )
    return {"action": "created", "doctype": LEAD_DOCTYPE, "name": doc.name}
