# Copyright (c) 2026, doco contributors
"""What has happened with THIS customer, answered mid-sale.

The same timeline as `order_story`, one level up: instead of one document's
events it interleaves everything the customer has done recently — bought, paid,
left in for repair, picked up. It exists because the question is asked at the
counter, with the customer standing there, and every existing answer requires
leaving the ticket.

It lives beside `order_story` rather than inside it for one reason: that module
is at 426 lines and this adds a fourth leg. It reuses its `event`,
`assemble_story` and `payment_events` verbatim, so all four legs pour into one
shape and the SPA renders them with one component.

TWO CAPS, BOTH STATED ON SCREEN. Ninety days and fifty events, because this is
a read of a person's commercial history handed to whoever is on the register:
the honest scope is "recently", not "ever". `assemble_story` sets `truncated`
and the surface says so, so nobody reads a window as a beginning.

SCOPE. The brief's signature is `get_customer_story(customer)`; the POS Profile
is required on top of it, because `_scope.assert_customer_in_profile` is this
fork's rule for reading a customer at all and a story is a bigger disclosure
than a name. A register cannot ask about a customer outside its own groups.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, nowdate

from posawesome.posawesome.api._scope import (
    assert_company,
    assert_customer_in_profile,
    assert_profile,
)
from posawesome.posawesome.api.order_story import (
    REPAIR_ORDER_DOCTYPE,
    assemble_story,
    event,
    payment_events,
)

# The window and the cap. Both are stated in the UI — see the module header.
CUSTOMER_STORY_DAYS = 90
CUSTOMER_STORY_CAP = 50

# Hard bounds on what a caller may widen them to. A cashier's surface has no
# business pulling a five-year history through a POS endpoint, and an unbounded
# `days` is an unbounded table scan on the busiest doctype in the system.
MAX_STORY_DAYS = 365
MAX_STORY_CAP = 200


def _bounded(value: object, default: int, ceiling: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return min(parsed, ceiling)


def invoice_events(customer: str, company: str, since: str) -> list[dict]:
    """Submitted sales, newest first — what the customer bought."""
    rows = frappe.get_all(
        "Sales Invoice",
        filters={
            "customer": customer,
            "company": company,
            "docstatus": 1,
            "posting_date": [">=", since],
        },
        fields=["name", "posting_date", "grand_total", "owner", "is_return", "status"],
        order_by="posting_date desc",
        limit_page_length=MAX_STORY_CAP,
    )
    return [
        event(
            row.get("posting_date"),
            "billing",
            # A credit note is not a sale read quickly. It is the row a
            # customer is most likely to be asking about, so it gets its own
            # key rather than a negative total nobody reads as negative.
            "returned" if row.get("is_return") else "invoiced",
            amount=row.get("grand_total"),
            actor=row.get("owner"),
            detail=row.get("status"),
            doctype="Sales Invoice",
            name=row.get("name"),
        )
        for row in rows
    ]


def sales_order_events(customer: str, company: str, since: str) -> list[dict]:
    rows = frappe.get_all(
        "Sales Order",
        filters={
            "customer": customer,
            "company": company,
            "docstatus": 1,
            "transaction_date": [">=", since],
        },
        fields=["name", "transaction_date", "grand_total", "owner", "status"],
        order_by="transaction_date desc",
        limit_page_length=MAX_STORY_CAP,
    )
    return [
        event(
            row.get("transaction_date"),
            "created",
            "ordered",
            amount=row.get("grand_total"),
            actor=row.get("owner"),
            detail=row.get("status"),
            doctype="Sales Order",
            name=row.get("name"),
        )
        for row in rows
    ]


def repair_events(customer: str, since: str) -> list[dict]:
    """Repairs left in and handed back, when this tenant has a workshop.

    Guarded by doctype existence and by column existence: taller links a
    Repair Order to a Customer through a CUSTOM field (`customer`) added at
    install time, so a site mid-upgrade has the doctype without the column and
    a query on it would take the whole surface down.
    """
    if not frappe.db.exists("DocType", REPAIR_ORDER_DOCTYPE):
        return []
    if not frappe.db.has_column(REPAIR_ORDER_DOCTYPE, "customer"):
        return []
    rows = frappe.get_all(
        REPAIR_ORDER_DOCTYPE,
        filters={"customer": customer, "creation": [">=", since]},
        fields=["name", "creation", "owner", "status", "device_model", "work_finished_on"],
        order_by="creation desc",
        limit_page_length=MAX_STORY_CAP,
    )
    events: list[dict] = []
    for row in rows:
        events.append(
            event(
                row.get("creation"),
                "created",
                "received",
                actor=row.get("owner"),
                detail=row.get("device_model"),
                doctype=REPAIR_ORDER_DOCTYPE,
                name=row.get("name"),
            )
        )
        events.append(
            event(
                row.get("work_finished_on"),
                "movement",
                "work_finished",
                detail=row.get("device_model"),
                doctype=REPAIR_ORDER_DOCTYPE,
                name=row.get("name"),
            )
        )
    events += payment_events(REPAIR_ORDER_DOCTYPE, [row["name"] for row in rows])
    return events


def customer_payment_events(customer: str, company: str, since: str) -> list[dict]:
    """Money the customer handed over, against anything.

    Read from the Payment Entry's own party rather than through reference rows,
    because at this level the question is "did they pay us", not "what did this
    settle" — an unallocated payment on account is exactly the row a customer
    asks about.
    """
    rows = frappe.get_all(
        "Payment Entry",
        filters={
            "party_type": "Customer",
            "party": customer,
            "company": company,
            "docstatus": 1,
            "posting_date": [">=", since],
        },
        fields=["name", "posting_date", "paid_amount", "mode_of_payment", "owner"],
        order_by="posting_date desc",
        limit_page_length=MAX_STORY_CAP,
    )
    return [
        event(
            row.get("posting_date"),
            "payment",
            "payment",
            amount=row.get("paid_amount"),
            actor=row.get("owner"),
            detail=row.get("mode_of_payment"),
            doctype="Payment Entry",
            name=row.get("name"),
        )
        for row in rows
    ]


@frappe.whitelist(methods=["GET", "POST"])
def get_customer_story(customer, pos_profile, days=None, limit=None):
    """Everything this customer has done lately, in one list.

    Scoped three ways before a single row is read: the caller must own the
    profile, the profile's company is the only company searched, and the
    customer must fall inside the profile's customer groups. A story is a
    bigger disclosure than a name, and the register that may not sell to a
    customer must not be able to read their history either.
    """
    customer = str(customer or "").strip()
    if not customer:
        frappe.throw(_("A customer is required."))
    assert_profile(frappe.session.user, pos_profile)
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    assert_company(frappe.session.user, company)
    assert_customer_in_profile(frappe.session.user, customer, pos_profile)

    days = _bounded(days, CUSTOMER_STORY_DAYS, MAX_STORY_DAYS)
    cap = _bounded(limit, CUSTOMER_STORY_CAP, MAX_STORY_CAP)
    since = add_days(nowdate(), -days)

    gathered = invoice_events(customer, company, since)
    gathered += sales_order_events(customer, company, since)
    gathered += customer_payment_events(customer, company, since)
    gathered += repair_events(customer, since)

    story = assemble_story(gathered, cap=cap)
    story.update(
        {
            "doctype": "Customer",
            "name": customer,
            "customer_name": frappe.db.get_value("Customer", customer, "customer_name") or customer,
            # The window, not just the cap: a story can be short because the
            # customer was quiet OR because ninety days is where we stopped
            # looking, and only one of those is worth saying out loud.
            "days": days,
        }
    )
    return story
