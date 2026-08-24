"""Shaping for the register's Cotizaciones lane (DOCUMENTOS_GOLDEN_FLOW §1).

Pure arithmetic, deliberately free of `frappe.get_all` and of `_()`:

* **No queries** — every function takes rows and returns rows, so the bucket
  rules can be exercised in a unit test without a site. `quotations.py` owns
  the reads; this module owns what the rows MEAN.
* **No translation** — the bucket is an id (`active`, `expiring`, `expired`,
  `converted`) and the client names it. The four Spanish nouns on the artboard
  («Vigente», «Por vencer», «Vencida», «Convertida») are feminine because every
  noun on that surface is a *cotización*; the shared `Expired` / `Converted`
  keys are translated elsewhere for other genders, so naming them here would
  force one of the two surfaces to read wrong.

Named after `charge_request_read_model.py`, which split the same way and for
the same reason.
"""

from __future__ import annotations

from frappe.utils import cint, flt, getdate

#: Hours before `valid_till` at which a quotation starts asking to be chased.
#: The golden flow says «Por vencer ≤48h»; expressed in days because
#: `valid_till` is a Date and an hour of it would be invented precision.
EXPIRING_WITHIN_DAYS = 2

#: Bucket ids, in the artboard's tab order. The client renders one tab per id.
QUOTATION_BUCKETS = ("active", "expiring", "expired", "converted")


def quotation_bucket(row, today):
    """Which estado tab this quotation belongs to.

    Order matters and is not alphabetical: a CONVERTED quotation whose validity
    has also run out is still Convertida, because the thing that happened to it
    is the sale, not the calendar. Checking expiry first would file every old
    won quote under Vencida and lose the invoice link the cashier came for.

    A quotation with no `valid_till` never expires — the artboard draws that
    row's Vence column as «—» — so it stays Vigente until it is converted.
    """
    if row.get("converted_invoice"):
        return "converted"

    valid_till = row.get("valid_till")
    if not valid_till:
        return "active"

    remaining = days_until(valid_till, today)
    if remaining is None:
        return "active"
    if remaining < 0:
        return "expired"
    if remaining <= EXPIRING_WITHIN_DAYS:
        return "expiring"
    return "active"


def days_until(valid_till, today):
    """Whole days from `today` to `valid_till`; `None` when either is unusable.

    Negative means the date has passed — 0 is "expires today", which the
    artboard prints as «hoy» and which is still Por vencer, not Vencida: a
    quote is honoured for the whole of its last day.
    """
    if not valid_till or not today:
        return None
    try:
        return (getdate(valid_till) - getdate(today)).days
    except Exception:
        return None


def is_honoured(row, today):
    """May this quotation's rates still be loaded into a sale unchanged?

    The one guardrail §3 states: *quoted-price honoring is bounded by
    validity*. Converted is deliberately NOT considered here — a converted
    quote is refused before pricing ever comes up.
    """
    return quotation_bucket(row, today) in ("active", "expiring")


def shape_row(source, today):
    """One list row, exactly the fields the artboard's six columns read.

    `total` is `grand_total` and nothing else: the surface must not compute a
    total the document does not carry, or a rounding rule that changed since
    the quote was written would silently reprice a promise.
    """
    row = {
        "name": source.get("name"),
        "customer": source.get("party_name") or source.get("customer_name"),
        "customer_name": source.get("customer_name") or source.get("party_name"),
        "date": str(source.get("transaction_date") or ""),
        "valid_till": str(source.get("valid_till") or ""),
        "total": flt(source.get("grand_total") or 0),
        "currency": source.get("currency"),
        "converted_invoice": source.get("posa_converted_invoice") or None,
        "converted_invoice_doctype": (
            source.get("posa_converted_invoice_doctype") or "Sales Invoice"
        ),
        "pos_profile": source.get("posa_pos_profile") or None,
        "note": source.get("posa_note") or "",
        "owner": source.get("owner"),
        "items_count": cint(source.get("items_count") or 0),
    }
    # Cleared rather than carried: a `converted_invoice_doctype` beside an
    # empty invoice name reads as a half-written link on every Vigente row.
    if not row["converted_invoice"]:
        row["converted_invoice_doctype"] = None
    row["estado"] = quotation_bucket(row, today)
    row["days_left"] = days_until(row["valid_till"], today)
    return row


def bucket_counts(rows):
    """The number beside each tab. Every bucket is present, `0` included —
    a tab that vanishes when it empties makes the row of tabs move under the
    cashier's finger between one search and the next."""
    counts = {bucket: 0 for bucket in QUOTATION_BUCKETS}
    for row in rows:
        bucket = row.get("estado")
        if bucket in counts:
            counts[bucket] += 1
    return counts


def matches_search(row, search):
    """Folio or customer, the two things printed on the paper the customer
    brings back. Case-insensitive substring, not a ranked search: the cashier
    is holding the exact folio."""
    needle = str(search or "").strip().lower()
    if not needle:
        return True
    haystack = " ".join(
        str(row.get(field) or "")
        for field in ("name", "customer", "customer_name")
    ).lower()
    return needle in haystack


def line_provenance(quoted_rate, today_rate, precision=2):
    """What the detail panel says under a line whose rate is the QUOTED one.

    Returns `None` when there is nothing to say — the rate has not moved, or
    today's rate is unknown — because the artboard prints the provenance line
    on exactly one of its three lines. A note under every line is a note the
    cashier stops reading, and the one that matters is the one that moved.
    """
    quoted = flt(quoted_rate, precision)
    current = flt(today_rate, precision)
    if not current or quoted == current:
        return None
    return {"quoted_rate": quoted, "today_rate": current}
