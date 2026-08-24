"""The Cobranza panel's read model (COBRANZA_GOLDEN_FLOW §2).

READS ONLY. Nothing in this module writes, and that is the guardrail the whole
feature rests on (§3): capture stays the one existing, validated path
(`payment_entry.process_pos_payment`, reached through `PayView`), and this
module exists so a cashier can find the invoice to capture against WITHOUT
searching for it first.

The one write the panel does own — filing a reminder, a LOG row and never
money — lives in `receivables_reminders.py` so this header stays literally
true. This module reads that log back (escalation chips on the worklist, the
history in the detail), which is still a read.

Shaped like `quotation_read_model.py` + `quotations.py`, deliberately:

* the arithmetic is pure (dicts in, dicts out) so the bucket rules can be
  exercised without a site — `test_receivables.py` runs standalone;
* the endpoints are thin, gated on register membership before they read
  anything, and scoped by the company of the POS Profile rather than by a
  `company` argument the client could widen;
* every `fields=` list is plain column names. An aggregate in `fields` is
  rejected as unsafe over HTTP (417) even though it works in the bench
  console — the trap that makes a read model pass its tests and fail on the
  register. Counting and summing happen in Python, over rows already read.

CURRENCY, honestly. `Sales Invoice.grand_total` is in the invoice's currency
and `Sales Invoice.outstanding_amount` is in the PARTY ACCOUNT's, and on every
single-currency register those are the same thing. Where they are not, this
module refuses to subtract one from the other: `paid` comes back `None` rather
than as a number produced by mixing two units, and the surface omits the
«Pagado» line instead of printing a wrong one.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from posawesome.posawesome.api._scope import (
    _get_profile_customer_groups,
    assert_customer_in_profile,
    assert_profile,
)

#: Days ahead of `due_date` at which an invoice starts asking to be chased.
#: The golden flow says «Por vencer ≤7 días» — a week is the horizon a counter
#: can act on, and anything further out is «Todas».
DUE_SOON_WITHIN_DAYS = 7

#: Bucket ids, in the artboard's tab order. «Cobrado hoy» is NOT here: it is a
#: different document (Payment Entry) read by a different endpoint, and folding
#: it into this tuple would make every bucket filter answer for two doctypes.
RECEIVABLE_BUCKETS = ("overdue", "due_soon", "all")

#: How many invoices one page of the worklist may carry, and the ceiling a
#: client cannot argue past. Stated back to the caller as `capped` so the
#: surface can say «mostrando las primeras N» rather than implying it is
#: showing everything.
DEFAULT_LIMIT = 200
MAX_LIMIT = 500

#: The same, for the reconciliation half. A day's Payment Entries on one
#: company is a much smaller set than a year of open invoices.
DEFAULT_PAYMENT_LIMIT = 200
MAX_PAYMENT_LIMIT = 500

#: The escalation ladder's ceiling — 1 gentle, 2 firm, 3 final notice. A
#: fourth press repeats the final notice; it never invents a level 4. The
#: WRITE that steps the ladder lives in `receivables_reminders.py` (this
#: module stays reads-only per its header); the ladder itself is derived
#: from the log rows, never stored, so a chip and its history cannot
#: disagree.
MAX_REMINDER_LEVEL = 3

#: How many log rows the detail panel prints. Three levels × a few repeats
#: is the realistic whole history; the cap is a guard, not a pager.
DETAIL_REMINDER_LIMIT = 20


# ---------------------------------------------------------------------------
# The arithmetic — pure, no `frappe.get_all`, no `_()`
# ---------------------------------------------------------------------------


def days_until(due, today):
    """Whole days from `today` to `due`; `None` when either is unusable.

    Negative means the date has passed — 0 is "due today", which is still Por
    vencer rather than Vencida: an invoice is not late until the day after the
    day it was due.
    """
    if not due or not today:
        return None
    try:
        return (getdate(due) - getdate(today)).days
    except Exception:
        return None


def aging_bucket(row, today):
    """Which tab this invoice belongs to.

    Off `due_date`, falling back to `posting_date` — `shape_row` has already
    collapsed those two into `due`, because an invoice with no due date is due
    the day it was written, and treating it as "no opinion" would file the
    oldest debt in the shop under «Todas» where nobody looks.

    An invoice we cannot date at all is `upcoming`: it appears in «Todas», it
    is never claimed to be overdue, and no red badge is raised on a guess.
    """
    remaining = days_until(row.get("due"), today)
    if remaining is None:
        return "upcoming"
    if remaining < 0:
        return "overdue"
    if remaining <= DUE_SOON_WITHIN_DAYS:
        return "due_soon"
    return "upcoming"


def shape_row(source, today, doctype="Sales Invoice"):
    """One worklist row, exactly the columns the artboard's six read.

    `estado` is the CHIP and `aging` is the TAB, and they are deliberately
    different questions. The artboard's first row is 24 days overdue AND partly
    paid, and it wears «Apartado»: what the cashier needs to know about it is
    that somebody already put money down, not that the calendar passed — the
    calendar is why the row is in the Vencidas tab in the first place.
    """
    total_currency = source.get("currency") or None
    outstanding_currency = source.get("party_account_currency") or total_currency

    total = flt(source.get("rounded_total") or source.get("grand_total") or 0)
    outstanding = flt(source.get("outstanding_amount") or 0)

    # See the module header: subtracting a party-account figure from an
    # invoice-currency one would be arithmetic across two units.
    comparable = bool(total_currency) and total_currency == outstanding_currency
    paid = max(total - outstanding, 0) if comparable else None

    row = {
        "name": source.get("name"),
        "doctype": doctype,
        "customer": source.get("customer"),
        "customer_name": source.get("customer_name") or source.get("customer"),
        "date": str(source.get("posting_date") or ""),
        "due": str(source.get("due_date") or source.get("posting_date") or ""),
        "total": total,
        "outstanding": outstanding,
        "paid": paid,
        "currency": total_currency,
        "outstanding_currency": outstanding_currency,
        "pos_profile": source.get("pos_profile") or None,
    }
    row["aging"] = aging_bucket(row, today)
    row["days_until_due"] = days_until(row["due"], today)
    # «Apartado» is the apartado shape the golden flow names (§2): a submitted
    # invoice somebody has already paid part of. `paid is None` (mixed
    # currencies) is not evidence of a part payment, so it does not claim one.
    row["estado"] = "apartado" if (paid or 0) > 0 else row["aging"]
    return row


def in_bucket(row, bucket):
    """Does this row belong in the chosen tab? «Todas» takes everything."""
    if not bucket or bucket == "all":
        return True
    return row.get("aging") == bucket


def bucket_counts(rows):
    """The number beside each tab, over the WHOLE company-scoped set.

    Every bucket is present, `0` included — a tab that vanishes when it empties
    makes the row of tabs move under the cashier's finger between one search
    and the next.
    """
    counts = {bucket: 0 for bucket in RECEIVABLE_BUCKETS}
    for row in rows:
        counts["all"] += 1
        aging = row.get("aging")
        if aging in counts:
            counts[aging] += 1
    return counts


def bucket_totals(rows):
    """The stats row: what is owed, what is late, and how late the worst is.

    `oldest_overdue_days` is what turns «$6,410 vencido» into something a
    cashier acts on — "the oldest is 24 days" is the sentence that gets a phone
    picked up. `None` when nothing is overdue, never `0`: zero days overdue is
    a real state (due today) and would read as "there is one".
    """
    outstanding = 0.0
    overdue = 0.0
    overdue_count = 0
    oldest = None
    for row in rows:
        outstanding += flt(row.get("outstanding") or 0)
        if row.get("aging") != "overdue":
            continue
        overdue += flt(row.get("outstanding") or 0)
        overdue_count += 1
        days = row.get("days_until_due")
        if days is None:
            continue
        late = -int(days)
        if oldest is None or late > oldest:
            oldest = late
    return {
        "outstanding": flt(outstanding),
        "outstanding_count": len(rows),
        "overdue": flt(overdue),
        "overdue_count": overdue_count,
        "oldest_overdue_days": oldest,
    }


def matches_search(row, search):
    """Folio or cliente — a REFINEMENT of the visible bucket, never the entry
    gesture (§1). Case-insensitive substring, not a ranked search: the cashier
    is either holding the folio or looking at the customer's name."""
    needle = str(search or "").strip().lower()
    if not needle:
        return True
    haystack = " ".join(
        str(row.get(field) or "") for field in ("name", "customer", "customer_name")
    ).lower()
    return needle in haystack


# ---------------------------------------------------------------------------
# Scope helpers
# ---------------------------------------------------------------------------


def _company_for_profile(pos_profile):
    """The company a register belongs to — never taken from the client.

    Every read below is scoped by THIS value rather than by a `company`
    argument, so a cashier cannot widen their own scope by editing a request.
    The same rule `quotations.profile_company` states for the other lane.
    """
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    if not company:
        frappe.throw(_("POS Profile {0} has no company.").format(pos_profile))
    return company


def _assert_register(pos_profile):
    """Membership, before anything is read.

    No feature flag: cobranza is not a capability a profile opts into, it is
    what the Payments destination has always been allowed to do. The gate is
    "are you a cashier on this register", which is `assert_profile`'s question.
    """
    assert_profile(frappe.session.user, pos_profile)


def _receivable_doctypes(pos_profile):
    """Which invoice doctypes this register's sales land in.

    A register configured with `create_pos_invoice_instead_of_sales_invoice`
    books POS Invoices, and those carry an `outstanding_amount` like any other.
    Reading only Sales Invoice on such a tenant would show an empty worklist
    beside a drawer full of unpaid tickets, so the flag decides — the same
    field `pos_closing_shift/closing_processing/creation.py` reads to find the
    day's transactions.
    """
    doctypes = ["Sales Invoice"]
    uses_pos_invoice = cint(
        frappe.db.get_value(
            "POS Profile", pos_profile, "create_pos_invoice_instead_of_sales_invoice"
        )
        or 0
    )
    if uses_pos_invoice:
        doctypes.append("POS Invoice")
    return doctypes


#: Plain column names, no aggregates — see the module header on 417.
_INVOICE_FIELDS = (
    "name",
    "customer",
    "customer_name",
    "posting_date",
    "due_date",
    "grand_total",
    "rounded_total",
    "outstanding_amount",
    "currency",
    "party_account_currency",
    "pos_profile",
)


def _read_open_invoices(company, doctypes, limit):
    """Every submitted, still-owed invoice on this company, oldest due first.

    Ordered by `due_date asc` on purpose: a worklist is a queue, and the row
    that has waited longest is the one to work. `limit` is applied per doctype
    and the caller states the cap.

    Each row is stamped with the doctype it came from before the two lists are
    merged. A register that books POS Invoices has folios in both tables, and
    every downstream act — COBRAR, «Estado de cuenta», the CRM reference — has
    to name the right one; recovering it afterwards from the folio would be an
    extra query per row to re-learn something we already knew.
    """
    rows = []
    for doctype in doctypes:
        sources = frappe.get_all(
            doctype,
            filters={
                "company": company,
                "docstatus": 1,
                "outstanding_amount": [">", 0],
            },
            fields=list(_INVOICE_FIELDS),
            order_by="due_date asc, posting_date asc, name asc",
            limit_page_length=limit,
        )
        for source in sources:
            row = dict(source)
            row["doctype"] = doctype
            rows.append(row)
    return rows


def _coerce_limit(limit, default, ceiling):
    value = cint(limit or 0) or default
    return max(1, min(value, ceiling))


def _within_customer_scope(rows, pos_profile):
    """Drop rows for customers this register is not allowed to see.

    The invoice read is COMPANY-wide, and a POS Profile that declares customer
    groups is saying its cashiers work a subset of that company's customers.
    Without this the panel would be a way to read every name and balance in the
    company from a register deliberately scoped to one branch's groups.

    FILTERED, not asserted. `assert_customer_in_profile` throws, which is right
    for "open this customer" and wrong for a worklist: one out-of-scope invoice
    would take the whole panel down instead of being the one row that is not
    this cashier's to chase.

    `_scope`'s own resolver is reused rather than re-derived — including its
    convention that an empty configuration means "all groups" — so the list and
    the detail endpoint cannot disagree about what a group scope is.
    """
    allowed = _get_profile_customer_groups(pos_profile)
    if not allowed:
        return rows

    customers = {row.get("customer") for row in rows if row.get("customer")}
    if not customers:
        return rows

    groups = frappe.get_all(
        "Customer",
        filters={"name": ["in", sorted(customers)]},
        fields=["name", "customer_group"],
        limit_page_length=0,
    )
    in_scope = {
        row.get("name") for row in groups if row.get("customer_group") in allowed
    }
    return [row for row in rows if row.get("customer") in in_scope]


# ---------------------------------------------------------------------------
# The endpoints
# ---------------------------------------------------------------------------


def _reminder_summaries(rows):
    """Escalation state per worklist row, derived from the reminder log.

    One read for the whole page (the worklist is capped at MAX_LIMIT), folded
    in Python — an aggregate in `fields=` is the 417 trap the module header
    names. Absence is honest: a row nobody has reminded gets `count 0` and
    `last_level None`, and the chip simply does not render.
    """
    names = [row.get("name") for row in rows if row.get("name")]
    if not names:
        return {}
    entries = frappe.get_all(
        "POS Collection Reminder",
        filters={"invoice": ["in", names]},
        fields=["invoice", "level", "channel", "creation"],
        order_by="creation asc",
        limit_page_length=0,
        ignore_permissions=True,
    )
    summaries = {}
    for entry in entries:
        summary = summaries.setdefault(
            entry.get("invoice"),
            {"count": 0, "last_level": None, "last_on": None, "last_channel": None},
        )
        summary["count"] += 1
        level = cint(entry.get("level"))
        if level >= cint(summary["last_level"] or 0):
            summary["last_level"] = level
        summary["last_on"] = str(entry.get("creation"))
        summary["last_channel"] = entry.get("channel")
    return summaries


def attach_reminder_state(rows, summaries):
    """Stamp each row with its ladder position and the level a press files.

    Pure on purpose (summaries in, rows mutated, nothing read) so
    `test_receivables.py`'s standalone lane can exercise the cap without a
    site: `next_level` is where `min(count + 1, MAX)` lives, and the write
    endpoint recomputes it server-side rather than trusting this echo.
    """
    for row in rows:
        summary = summaries.get(row.get("name")) or {
            "count": 0,
            "last_level": None,
            "last_on": None,
            "last_channel": None,
        }
        row["reminders"] = dict(summary)
        row["reminders"]["next_level"] = min(cint(summary["count"]) + 1, MAX_REMINDER_LEVEL)
    return rows


@frappe.whitelist(methods=["GET", "POST"])
def get_receivables(pos_profile, bucket=None, search=None, limit=None):
    """The Cobranza worklist: rows, tab counts and the stats row.

    Counts and totals come from the WHOLE company-scoped set, the rows from the
    chosen bucket and search: a tab reading «Vencidas 6» above a list of the
    two that matched a search is the header contradicting the list. So the
    filters are applied AFTER the count, never before it.
    """
    _assert_register(pos_profile)
    company = _company_for_profile(pos_profile)
    limit = _coerce_limit(limit, DEFAULT_LIMIT, MAX_LIMIT)

    today = nowdate()
    doctypes = _receivable_doctypes(pos_profile)
    sources = _within_customer_scope(
        _read_open_invoices(company, doctypes, limit), pos_profile
    )
    rows = [
        shape_row(source, today, source.get("doctype") or doctypes[0]) for source in sources
    ]

    counts = bucket_counts(rows)
    totals = bucket_totals(rows)

    chosen = str(bucket or "").strip() or "all"
    if chosen not in RECEIVABLE_BUCKETS:
        chosen = "all"
    visible = [row for row in rows if in_bucket(row, chosen)]
    visible = [row for row in visible if matches_search(row, search)]
    # Only the rows going out on the wire — the whole set feeds counts and
    # totals, but nobody renders a chip on a row the bucket filtered away.
    attach_reminder_state(visible, _reminder_summaries(visible))

    return {
        "rows": visible,
        "counts": counts,
        "totals": totals,
        "bucket": chosen,
        "today": today,
        "company": company,
        "currency": frappe.get_cached_value("Company", company, "default_currency"),
        "limit": limit,
        # True when a doctype came back exactly full: there may be more behind
        # it, and the surface says so rather than implying the list is the
        # whole debt.
        "capped": len(sources) >= limit,
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_collected_today(pos_profile, limit=None):
    """Today's money in: the reconciliation half of the toolbox (§1).

    Submitted `Receive` Payment Entries on this company, dated today, with the
    day's total. Company-wide rather than per-shift on purpose — the question
    the panel answers is «cómo vamos hoy», and a cashier who took over at noon
    still wants the morning's collections in that number.

    Amounts are the BASE ones (company currency) and the total says so. A day
    total that silently added a dollar payment to a peso one would be the one
    number on this surface nobody could check against the drawer.
    """
    _assert_register(pos_profile)
    company = _company_for_profile(pos_profile)
    limit = _coerce_limit(limit, DEFAULT_PAYMENT_LIMIT, MAX_PAYMENT_LIMIT)

    today = nowdate()
    sources = frappe.get_all(
        "Payment Entry",
        filters={
            "company": company,
            "docstatus": 1,
            "payment_type": "Receive",
            "posting_date": today,
        },
        fields=[
            "name",
            "party",
            "party_name",
            "party_type",
            "mode_of_payment",
            "reference_no",
            "posting_date",
            "paid_amount",
            "base_paid_amount",
            "paid_from_account_currency",
        ],
        order_by="creation desc",
        limit_page_length=limit,
    )

    currency = frappe.get_cached_value("Company", company, "default_currency")
    rows = []
    total = 0.0
    for source in sources:
        amount = flt(source.get("base_paid_amount") or source.get("paid_amount") or 0)
        total += amount
        rows.append(
            {
                "name": source.get("name"),
                "party": source.get("party"),
                "party_name": source.get("party_name") or source.get("party"),
                "party_type": source.get("party_type"),
                "mode_of_payment": source.get("mode_of_payment") or None,
                "reference_no": source.get("reference_no") or None,
                "date": str(source.get("posting_date") or ""),
                "amount": amount,
                "currency": currency,
                # The figure as it was tendered, for a register that takes more
                # than one currency. The panel prints the base one; this is
                # what lets it say so honestly when they differ.
                "tendered_amount": flt(source.get("paid_amount") or 0),
                "tendered_currency": source.get("paid_from_account_currency") or currency,
            }
        )

    return {
        "rows": rows,
        "total": flt(total),
        "count": len(rows),
        "date": today,
        "company": company,
        "currency": currency,
        "limit": limit,
        "capped": len(sources) >= limit,
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_receivables_badge(pos_profile):
    """The overdue count for the rail (§2) — the panel reminding before it is
    opened, which is what makes it an ops panel rather than a page.

    Deliberately the SAME code path as the worklist rather than a cheaper
    `frappe.db.count` with a `due_date < today` filter: the acceptance says the
    badge equals the Vencidas count, and two different readings of "overdue"
    (one that falls back to `posting_date`, one that does not) would eventually
    disagree in front of a cashier. The rows are read with the same cap and
    thrown away; on a register with more open invoices than the cap the badge
    is a floor, and `capped` says so.
    """
    _assert_register(pos_profile)
    company = _company_for_profile(pos_profile)

    today = nowdate()
    doctypes = _receivable_doctypes(pos_profile)
    sources = _within_customer_scope(
        _read_open_invoices(company, doctypes, DEFAULT_LIMIT), pos_profile
    )
    rows = [
        shape_row(source, today, source.get("doctype") or doctypes[0]) for source in sources
    ]
    counts = bucket_counts(rows)

    return {
        "overdue": counts["overdue"],
        "due_soon": counts["due_soon"],
        "all": counts["all"],
        "today": today,
        "capped": len(sources) >= DEFAULT_LIMIT,
    }


#: How many invoice lines the detail panel summarises before it says «y N más».
#: The panel is a collections tool, not an invoice viewer: a cashier calling a
#: customer needs to recognise the ticket, not audit it.
DETAIL_LINE_LIMIT = 12

#: And how many payments. An invoice with more part-payments than this is a
#: story, and the story belongs in the document.
DETAIL_PAYMENT_LIMIT = 20


def _invoice_payments(doctype, invoice, posting_date=None, limit=DETAIL_PAYMENT_LIMIT):
    """Everything already paid against this invoice, newest first.

    TWO SOURCES, and missing either one puts a contradiction on screen. Found
    on doco-mirror while wiring this: an invoice showing «Pagado $200» listed
    NO payments, because the $200 was tendered at the counter and lives in the
    invoice's own `Sales Invoice Payment` table — a Payment Entry is only
    created when somebody comes BACK to pay. A collections panel that reports
    "nothing has been paid" directly under a paid figure is worse than one that
    reports nothing at all.

    So: the counter tender first (it is part of the document, dated with it),
    then every submitted Payment Entry allocated to it. Two reads rather than a
    join for the second — `Payment Entry Reference` carries the allocation,
    `Payment Entry` the date and the mode — because an `IN` lookup over a
    handful of parents is cheaper than teaching this module SQL.
    """
    payments = []
    for row in frappe.get_all(
        f"{doctype} Payment",
        filters={"parent": invoice, "parenttype": doctype},
        fields=["idx", "mode_of_payment", "amount", "reference_no"],
        order_by="idx asc",
        limit_page_length=limit,
    ):
        if flt(row.get("amount") or 0) <= 0:
            continue
        payments.append(
            {
                # Not a Payment Entry name — this row has none. The idx keeps
                # the client's `:key` unique without inventing a document id.
                "name": f"{invoice}#{cint(row.get('idx') or 0)}",
                "date": str(posting_date or ""),
                "mode_of_payment": row.get("mode_of_payment") or None,
                "reference_no": row.get("reference_no") or None,
                "amount": flt(row.get("amount") or 0),
                "at_the_counter": True,
            }
        )

    payments.extend(_allocated_payments(doctype, invoice, limit))
    payments.sort(key=lambda row: row["date"], reverse=True)
    return payments


def _allocated_payments(doctype, invoice, limit=DETAIL_PAYMENT_LIMIT):
    """Submitted Payment Entries allocated against this invoice."""
    references = frappe.get_all(
        "Payment Entry Reference",
        filters={"reference_doctype": doctype, "reference_name": invoice, "docstatus": 1},
        fields=["parent", "allocated_amount"],
        limit_page_length=limit,
    )
    parents = [row.get("parent") for row in references if row.get("parent")]
    if not parents:
        return []

    entries = {
        row["name"]: row
        for row in frappe.get_all(
            "Payment Entry",
            filters={"name": ["in", parents], "docstatus": 1},
            fields=["name", "posting_date", "mode_of_payment", "reference_no"],
            limit_page_length=0,
        )
    }

    payments = []
    for reference in references:
        entry = entries.get(reference.get("parent"))
        if not entry:
            # A draft or cancelled Payment Entry: the allocation row survives,
            # the money did not. Counting it would show a customer as having
            # paid something nobody banked.
            continue
        payments.append(
            {
                "name": entry["name"],
                "date": str(entry.get("posting_date") or ""),
                "mode_of_payment": entry.get("mode_of_payment") or None,
                "reference_no": entry.get("reference_no") or None,
                "amount": flt(reference.get("allocated_amount") or 0),
                "at_the_counter": False,
            }
        )
    return payments


def _store_credit(customer, company):
    """«Tiene $X en su monedero», or nothing at all.

    ABSENCE, NOT ZEROS (§2). A customer with no credit gets `None` and the chip
    does not render — «tiene $0 en monedero» is a sentence that trains cashiers
    to stop reading the chip that matters.

    `get_available_credit` is called here rather than from the SPA so the
    COMPANY is the register's own. That endpoint takes a company argument and a
    client could name someone else's; from the server it can only ever be the
    one the POS Profile belongs to.
    """
    from posawesome.posawesome.api.payments import get_available_credit

    try:
        rows = get_available_credit(customer, company) or []
    except Exception:
        # A credit read failing is not a reason to refuse the whole detail
        # panel — the cashier can still collect. No chip is the honest state.
        frappe.log_error(frappe.get_traceback(), "cobranza: store credit read failed")
        return None

    total = sum(flt(row.get("total_credit") or 0) for row in rows)
    return flt(total) if total > 0 else None


@frappe.whitelist(methods=["GET", "POST"])
def get_receivable_detail(pos_profile, invoice, doctype="Sales Invoice"):
    """Everything the detail panel prints for one row (§1).

    One round trip for the whole right column — the totals block, the lines
    summary, «Pagos recibidos», the contact chip and the monedero — because the
    panel opens it on every ↑↓ press and four calls per keystroke is what makes
    a keyboard-driven list feel broken.

    Gated three ways: the caller must be a cashier on this register, the
    invoice must belong to the register's own company, and the customer must be
    inside the profile's customer-group scope. The last one is asserted rather
    than filtered here — the cashier asked for THIS customer by name, and the
    honest answer to "not yours" is a refusal, not an empty panel.
    """
    _assert_register(pos_profile)
    company = _company_for_profile(pos_profile)

    doctype = str(doctype or "Sales Invoice").strip()
    if doctype not in _receivable_doctypes(pos_profile):
        frappe.throw(_("{0} is not an invoice this register collects against.").format(doctype))

    source = frappe.db.get_value(
        doctype,
        invoice,
        [
            "name",
            "company",
            "customer",
            "customer_name",
            "posting_date",
            "due_date",
            "grand_total",
            "rounded_total",
            "outstanding_amount",
            "currency",
            "party_account_currency",
            "pos_profile",
            "docstatus",
        ],
        as_dict=True,
    )
    if not source or cint(source.get("docstatus")) != 1:
        frappe.throw(_("Invoice {0} was not found on this register.").format(invoice))
    if source.get("company") != company:
        # Not a 404: saying "wrong company" to someone who guessed a folio
        # confirms the folio exists. The register's answer is the same either
        # way — this invoice is not one of ours.
        frappe.throw(_("Invoice {0} was not found on this register.").format(invoice))

    assert_customer_in_profile(frappe.session.user, source.get("customer"), pos_profile)

    row = shape_row(dict(source), nowdate(), doctype)
    attach_reminder_state([row], _reminder_summaries([row]))

    lines = frappe.get_all(
        f"{doctype} Item",
        filters={"parent": invoice, "parenttype": doctype},
        fields=["item_code", "item_name", "qty", "uom", "rate", "amount"],
        order_by="idx asc",
        limit_page_length=DETAIL_LINE_LIMIT,
    )

    # The ladder's receipts: who pressed what, when, and what was owed at the
    # time. Latest first — the cashier's question is "when did we LAST chase
    # this", not how it began.
    reminder_log = frappe.get_all(
        "POS Collection Reminder",
        filters={"invoice": invoice, "invoice_doctype": doctype},
        fields=[
            "name",
            "level",
            "channel",
            "note",
            "outstanding_at_send",
            "owner",
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=DETAIL_REMINDER_LIMIT,
        ignore_permissions=True,
    )

    contact = (
        frappe.db.get_value(
            "Customer",
            source.get("customer"),
            ["customer_name", "mobile_no", "email_id"],
            as_dict=True,
        )
        or {}
    )

    return {
        "row": row,
        "lines": [dict(line) for line in lines],
        "lines_shown": len(lines),
        "payments": _invoice_payments(doctype, invoice, source.get("posting_date")),
        "contact": {
            "customer": source.get("customer"),
            "customer_name": contact.get("customer_name") or source.get("customer_name"),
            "phone": (str(contact.get("mobile_no") or "").strip() or None),
            "email": (str(contact.get("email_id") or "").strip() or None),
        },
        "store_credit": _store_credit(source.get("customer"), company),
        "reminders": [
            {
                "name": entry.get("name"),
                "level": cint(entry.get("level")),
                "channel": entry.get("channel"),
                "note": entry.get("note"),
                "outstanding_at_send": flt(entry.get("outstanding_at_send")),
                "owner": entry.get("owner"),
                "creation": str(entry.get("creation")),
            }
            for entry in reminder_log
        ],
        "currency": row["currency"],
        "company": company,
    }
