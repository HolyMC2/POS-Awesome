# Copyright (c) 2026, doco contributors
"""What happened to this document, in the order it happened.

One read model behind one timeline. The register keeps asking the same
question about three different things — a repair order, a sales order, a
customer — and until now the answer lived in whichever doctype's list view the
cashier happened to know how to open. A counter cannot open a list view with a
customer standing in front of them.

THE CONTRACT: an event is `(ts, kind, topic, amount?, actor?, detail?)` and
NOTHING ELSE. In particular it carries no sentence. `kind` and `topic` are
stable keys; the SPA composes «Anticipo $600 — efectivo, 19 ago» from them
because it is the side that holds `es.csv` and knows the tenant's currency.
A server that returned the sentence would make the string untranslatable and
the event untestable in the same move.

TALLER IS READ BY DOCTYPE NAME, NEVER IMPORTED — same rule, same reason as
`charge_request_read_model`. A tenant with no workshop gets the Sales Order leg
and nothing is missing; there is simply no repair to tell a story about.

WHAT IS DELIBERATELY ABSENT: a part the workshop recorded but never moved
through a Stock Entry has no timestamp anywhere, so it produces no event. It is
still on the bill, where it belongs. Dating it by the order's `modified` would
put a fact on the timeline at a time it did not happen, which is the one thing
a timeline must never do.
"""

from __future__ import annotations

from datetime import datetime

import frappe
from frappe import _

from posawesome.posawesome.api._scope import assert_company

REPAIR_ORDER_DOCTYPE = "Repair Order"

# The doctypes a story can be told about. Not a guess and not open-ended: each
# one has a hand-written gatherer below, because "the events of a document" is
# not a generic question — a Sales Order's story is its deliveries and its
# invoices, and a Repair Order's is its bench log.
STORY_DOCTYPES = ("Repair Order", "Sales Order")

# Events per story. Generous enough that a real order is never cut short, small
# enough that one runaway document cannot hand the SPA a megabyte.
STORY_CAP = 120

EVENT_KINDS = ("created", "payment", "consumption", "movement", "billing", "delivery")


def _stamp(value: object) -> str | None:
    """A sortable timestamp string, or None when there is nothing to sort by.

    None is a first-class answer here: `assemble_story` drops those events
    rather than dating them "now", which would put a fact on the timeline at a
    time it did not happen.
    """
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value or "").strip()
    if not text:
        return None
    # A bare date sorts before every time on the same day, which is right: a
    # posting_date with no time is not "midnight", it is "that day, unknown".
    return text


def event(
    ts: object,
    kind: str,
    topic: str | None = None,
    *,
    amount: float | None = None,
    actor: str | None = None,
    detail: str | None = None,
    doctype: str | None = None,
    name: str | None = None,
) -> dict:
    return {
        "ts": _stamp(ts),
        "kind": kind,
        "topic": topic,
        "amount": float(amount) if amount is not None else None,
        "actor": actor or None,
        "detail": detail or None,
        "doctype": doctype,
        "name": name,
    }


def assemble_story(events: list[dict], cap: int = STORY_CAP) -> dict:
    """Undated events out, newest first, capped — and SAYS it was capped.

    `truncated` is not decoration. A timeline that silently stops at 120 tells
    a cashier the account began there, and the one thing they are usually
    looking for on a long-running customer is the oldest thing on it.
    """
    dated = [row for row in events if row.get("ts")]
    dated.sort(key=lambda row: str(row["ts"]), reverse=True)
    return {
        "events": dated[:cap],
        "truncated": len(dated) > cap,
        "cap": cap,
        "dropped_undated": len(events) - len(dated),
    }


# --------------------------------------------------------------------------
# Gatherers. Each one is a pile of events; ordering is `assemble_story`'s job.
# --------------------------------------------------------------------------


def payment_events(reference_doctype: str, reference_names: list[str]) -> list[dict]:
    """Submitted Payment Entries pointing at these documents.

    Read through `Payment Entry Reference` rather than through the Payment
    Entry's own party, because an anticipo taken against a Repair Order is a
    reference row and nothing else — taller's own finance views join exactly
    this way.
    """
    if not reference_names:
        return []
    rows = frappe.get_all(
        "Payment Entry Reference",
        filters={
            "parenttype": "Payment Entry",
            "docstatus": 1,
            "reference_doctype": reference_doctype,
            "reference_name": ["in", reference_names],
        },
        fields=["parent", "reference_name", "allocated_amount"],
        limit_page_length=STORY_CAP,
    )
    if not rows:
        return []
    entries = {
        row["name"]: row
        for row in frappe.get_all(
            "Payment Entry",
            filters={"name": ["in", [row["parent"] for row in rows]], "docstatus": 1},
            fields=["name", "posting_date", "mode_of_payment", "owner", "payment_type"],
            limit_page_length=STORY_CAP,
        )
    }
    out = []
    for row in rows:
        entry = entries.get(row["parent"])
        if not entry:
            continue
        out.append(
            event(
                entry.get("posting_date"),
                "payment",
                # An anticipo and a settlement are the same doctype and read
                # very differently at a counter. Which one it is depends on
                # what it was paid against, so the caller names the topic.
                "advance" if reference_doctype == REPAIR_ORDER_DOCTYPE else "payment",
                amount=row.get("allocated_amount"),
                actor=entry.get("owner"),
                detail=entry.get("mode_of_payment"),
                doctype="Payment Entry",
                name=entry.get("name"),
            )
        )
    return out


def repair_log_events(repair_name: str) -> list[dict]:
    """taller's own bench log — the workshop's account of its own work."""
    if not frappe.db.exists("DocType", "Repair Log Entry"):
        return []
    rows = frappe.get_all(
        "Repair Log Entry",
        filters={"repair_order": repair_name},
        fields=["name", "entry_datetime", "technician", "step_type", "outcome", "creation"],
        order_by="entry_datetime asc",
        limit_page_length=STORY_CAP,
    )
    return [
        event(
            row.get("entry_datetime") or row.get("creation"),
            "movement",
            "log",
            actor=row.get("technician"),
            # The workshop's own words for the step, passed through. Not a key:
            # `step_type` is a tenant-editable Select, so translating it here
            # would silently drop any option the shop added itself.
            detail=row.get("step_type"),
            doctype="Repair Log Entry",
            name=row.get("name"),
        )
        for row in rows
    ]


def repair_consumption_events(repair_name: str) -> list[dict]:
    """Parts that actually MOVED, dated by the Stock Entry that moved them.

    A part with no stock entry produces no event — see the module header. It is
    on the bill; it is not on the timeline, because nothing knows when it
    happened.
    """
    if not frappe.db.exists("DocType", "Repair Order Part"):
        return []
    rows = frappe.get_all(
        "Repair Order Part",
        filters={"parenttype": REPAIR_ORDER_DOCTYPE, "parent": repair_name},
        fields=["item", "item_name", "qty", "source", "stock_entry"],
        order_by="idx asc",
        limit_page_length=200,
    )
    stock_names = [row["stock_entry"] for row in rows if row.get("stock_entry")]
    stamps = {}
    if stock_names:
        stamps = {
            row["name"]: row
            for row in frappe.get_all(
                "Stock Entry",
                filters={"name": ["in", stock_names]},
                fields=["name", "posting_date", "owner"],
                limit_page_length=len(stock_names) + 1,
            )
        }
    out = []
    for row in rows:
        moved = stamps.get(row.get("stock_entry") or "")
        if not moved:
            continue
        out.append(
            event(
                moved.get("posting_date"),
                "consumption",
                {"Customer-Supplied": "customer_supplied", "Ordered": "ordered"}.get(
                    str(row.get("source") or ""), "stock"
                ),
                actor=moved.get("owner"),
                detail=row.get("item_name") or row.get("item"),
                doctype="Stock Entry",
                name=moved.get("name"),
            )
        )
    return out


def repair_billing_events(repair_name: str) -> list[dict]:
    """The invoices the order was billed with, dated by their posting date."""
    if not frappe.db.exists("DocType", "Repair Order Invoice"):
        return []
    rows = frappe.get_all(
        "Repair Order Invoice",
        filters={"parenttype": REPAIR_ORDER_DOCTYPE, "parent": repair_name},
        fields=["invoice_type", "invoice", "amount"],
        limit_page_length=STORY_CAP,
    )
    out = []
    for row in rows:
        doctype = row.get("invoice_type") or "Sales Invoice"
        name = row.get("invoice")
        if not name:
            continue
        stamp = frappe.db.get_value(doctype, name, ["posting_date", "owner"], as_dict=True) or {}
        out.append(
            event(
                stamp.get("posting_date"),
                "billing",
                "invoiced",
                amount=row.get("amount"),
                actor=stamp.get("owner"),
                doctype=doctype,
                name=name,
            )
        )
    return out


def repair_story(name: str) -> list[dict]:
    """The Repair Order leg: opened, worked, paid, parted out, billed."""
    order = frappe.db.get_value(
        REPAIR_ORDER_DOCTYPE,
        name,
        ["name", "creation", "owner", "status", "work_started_on", "work_finished_on", "technician"],
        as_dict=True,
    )
    if not order:
        frappe.throw(_("Repair order {0} does not exist.").format(name))

    events = [
        event(order.get("creation"), "created", "received", actor=order.get("owner")),
        event(
            order.get("work_started_on"),
            "movement",
            "work_started",
            actor=order.get("technician"),
        ),
        event(
            order.get("work_finished_on"),
            "movement",
            "work_finished",
            actor=order.get("technician"),
        ),
    ]
    events += repair_log_events(name)
    events += payment_events(REPAIR_ORDER_DOCTYPE, [name])
    events += repair_consumption_events(name)
    events += repair_billing_events(name)
    return events


def sales_order_story(name: str) -> list[dict]:
    """The Sales Order leg, built from ERPNext's own links.

    Deliveries come from `Delivery Note Item.against_sales_order` and invoices
    from `Sales Invoice Item.sales_order` — the two fields ERPNext itself uses
    to answer "what came of this order". Nothing here reads a status field's
    history: `Version` rows are a change log of every field on the document and
    filtering them for a status transition costs a full scan of JSON blobs per
    order, which is not a price a POS surface can pay on open.
    """
    order = frappe.db.get_value(
        "Sales Order",
        name,
        ["name", "creation", "owner", "transaction_date", "status", "company"],
        as_dict=True,
    )
    if not order:
        frappe.throw(_("Sales order {0} does not exist.").format(name))
    assert_company(frappe.session.user, order.get("company"))

    events = [
        event(
            order.get("creation"),
            "created",
            "ordered",
            actor=order.get("owner"),
            doctype="Sales Order",
            name=order.get("name"),
        )
    ]
    events += payment_events("Sales Order", [name])

    for row in frappe.get_all(
        "Delivery Note Item",
        filters={"against_sales_order": name, "docstatus": 1},
        fields=["parent", "item_name", "qty"],
        limit_page_length=STORY_CAP,
    ):
        note = (
            frappe.db.get_value(
                "Delivery Note", row["parent"], ["posting_date", "owner"], as_dict=True
            )
            or {}
        )
        events.append(
            event(
                note.get("posting_date"),
                "delivery",
                "delivered",
                actor=note.get("owner"),
                detail=row.get("item_name"),
                doctype="Delivery Note",
                name=row["parent"],
            )
        )

    seen_invoices: set[str] = set()
    for row in frappe.get_all(
        "Sales Invoice Item",
        filters={"sales_order": name, "docstatus": 1},
        fields=["parent"],
        limit_page_length=STORY_CAP,
    ):
        if row["parent"] in seen_invoices:
            continue
        seen_invoices.add(row["parent"])
        invoice = (
            frappe.db.get_value(
                "Sales Invoice",
                row["parent"],
                ["posting_date", "owner", "grand_total"],
                as_dict=True,
            )
            or {}
        )
        events.append(
            event(
                invoice.get("posting_date"),
                "billing",
                "invoiced",
                amount=invoice.get("grand_total"),
                actor=invoice.get("owner"),
                doctype="Sales Invoice",
                name=row["parent"],
            )
        )
    return events


@frappe.whitelist(methods=["GET", "POST"])
def get_order_story(doctype, name):
    """The timeline for ONE document.

    Read-only and permission-checked the ordinary way: `has_permission` on the
    document itself, so a cashier who cannot read a sales order cannot read its
    story either. `assert_company` guards the Sales Order leg on top of that,
    because a POS session is scoped to a company and a story is a disclosure of
    what that company sold and to whom.
    """
    doctype = str(doctype or "").strip()
    name = str(name or "").strip()
    if doctype not in STORY_DOCTYPES:
        frappe.throw(_("No story is kept for {0}.").format(doctype or "?"))
    if not name:
        frappe.throw(_("A document name is required."))
    if doctype == REPAIR_ORDER_DOCTYPE and not frappe.db.exists("DocType", REPAIR_ORDER_DOCTYPE):
        frappe.throw(_("Repair orders are not installed on this site."))
    if not frappe.has_permission(doctype, "read", doc=name):
        frappe.throw(
            _("You are not allowed to read {0} {1}.").format(_(doctype), name),
            frappe.PermissionError,
        )

    gathered = repair_story(name) if doctype == REPAIR_ORDER_DOCTYPE else sales_order_story(name)
    story = assemble_story(gathered)
    story.update({"doctype": doctype, "name": name})
    return story
