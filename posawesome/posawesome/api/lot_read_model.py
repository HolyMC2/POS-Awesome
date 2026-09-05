"""Pure shaping for the SERIES surface (serial / IMEI lookup).

No ``frappe`` import on purpose: everything here is a decision about rows the
endpoints already fetched — which movement is the latest, what a status means
to a counter, how a raw search term is read — and each decision has to be
assertable without a site.  ``serials.py`` owns the queries.

The register's question is not "list Serial Nos"; it is «this IMEI in my hand
says it was sold — to whom, when, on which ticket, and which one of the SAME
model is still in stock so I can sell that instead».  The shapes below are
built to answer exactly that.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

#: ERPNext's Serial No status vocabulary (v15+; the mirror also carries a
#: handful of blank rows from hand-typed serials).  Order = tab order on the
#: surface: what the counter can still sell first.
SERIAL_STATUSES: tuple[str, ...] = ("Active", "Delivered", "Consumed", "Inactive", "Expired")

#: Bucket ids the client filters by.  ``all`` is the ONLY key that is not a
#: raw ERPNext status, so an unknown value from the wire collapses to it.
STATUS_BUCKETS: tuple[str, ...] = ("all",) + SERIAL_STATUSES

#: Voucher doctypes and the party field the story panel wants from each.
VOUCHER_PARTY_FIELDS: dict[str, tuple[str, ...]] = {
    "Sales Invoice": ("customer", "customer_name", "posting_date", "grand_total", "owner", "is_return", "return_against", "status", "docstatus", "pos_profile"),
    "Delivery Note": ("customer", "customer_name", "posting_date", "grand_total", "owner", "is_return", "return_against", "status", "docstatus"),
    "Purchase Receipt": ("supplier", "supplier_name", "posting_date", "grand_total", "owner", "status", "docstatus"),
    "Purchase Invoice": ("supplier", "supplier_name", "posting_date", "grand_total", "owner", "status", "docstatus"),
    "Stock Entry": ("stock_entry_type", "purpose", "posting_date", "owner", "docstatus"),
    "Stock Reconciliation": ("purpose", "posting_date", "owner", "docstatus"),
}

MAX_PAGE = 200
DEFAULT_PAGE = 60


def _text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def normalize_query(raw: Any) -> str:
    """One search term, as a counter types it.

    IMEIs get dictated with spaces and dashes («35 3150 4004-43913»); a
    cashier pasting from WhatsApp brings a trailing newline.  Strip the
    separators when the term is otherwise digits so a partial IMEI still
    matches, keep letters as they are (item names, customers).
    """
    text = _text(raw)
    if not text:
        return ""
    compact = "".join(ch for ch in text if ch not in " - \t\r\n")
    if compact.isdigit():
        return compact
    return " ".join(text.split())


def normalize_bucket(raw: Any) -> str:
    """Which status tab is being read; anything unknown = the whole set."""
    text = _text(raw)
    return text if text in STATUS_BUCKETS else "all"


def clamp_page(limit: Any, offset: Any) -> tuple[int, int]:
    try:
        size = int(limit or 0)
    except (TypeError, ValueError):
        size = 0
    try:
        start = int(offset or 0)
    except (TypeError, ValueError):
        start = 0
    size = DEFAULT_PAGE if size <= 0 else min(size, MAX_PAGE)
    return size, max(start, 0)


def voucher_party_fields(voucher_type: str) -> tuple[str, ...]:
    return VOUCHER_PARTY_FIELDS.get(_text(voucher_type), ("posting_date", "owner", "docstatus"))


def latest_movement_by_serial(entries: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Fold bundle entries into ONE latest live movement per serial.

    ``entries`` are `Serial and Batch Entry` rows joined to a submitted,
    un-cancelled bundle, in any order.  The latest is by ``posting_datetime``
    and then by ``creation`` — two movements can share a posting stamp when a
    backdated document lands, and the later-created one is the truth.
    """
    latest: dict[str, dict[str, Any]] = {}
    for entry in entries:
        serial_no = _text(entry.get("serial_no"))
        if not serial_no:
            continue
        key = (_text(entry.get("posting_datetime")), _text(entry.get("creation")))
        current = latest.get(serial_no)
        if current is None or key > current["_key"]:
            latest[serial_no] = {
                "_key": key,
                "voucher_type": _text(entry.get("voucher_type")),
                "voucher_no": _text(entry.get("voucher_no")),
                "warehouse": _text(entry.get("warehouse")) or None,
                "posting_datetime": entry.get("posting_datetime"),
                "outward": bool(entry.get("is_outward")) or _text(entry.get("type_of_transaction")) == "Outward",
            }
    for row in latest.values():
        row.pop("_key", None)
    return latest


def shape_row(serial: Mapping[str, Any], latest: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The list row: the Serial No head plus its latest live movement."""
    status = _text(serial.get("status")) or "Unknown"
    move = latest or {}
    return {
        "serial_no": _text(serial.get("name") or serial.get("serial_no")),
        "item_code": _text(serial.get("item_code")),
        "item_name": _text(serial.get("item_name")) or _text(serial.get("item_code")),
        "status": status,
        "warehouse": _text(serial.get("warehouse")) or None,
        "customer": _text(serial.get("customer")) or None,
        "batch_no": _text(serial.get("batch_no")) or None,
        "purchase_document_no": _text(serial.get("purchase_document_no")) or None,
        "warranty_expiry_date": _date(serial.get("warranty_expiry_date")),
        "posting_date": _date(serial.get("posting_date")),
        "last_voucher_type": move.get("voucher_type") or None,
        "last_voucher_no": move.get("voucher_no") or None,
        "last_moved_at": _stamp(move.get("posting_datetime")),
        "last_outward": bool(move.get("outward")) if move else None,
    }


def shape_movement(entry: Mapping[str, Any], voucher: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """One line of the story: a bundle entry, with what its voucher says."""
    doc = voucher or {}
    voucher_type = _text(entry.get("voucher_type"))
    party = (
        _text(doc.get("customer_name") or doc.get("customer"))
        or _text(doc.get("supplier_name") or doc.get("supplier"))
        or _text(doc.get("stock_entry_type") or doc.get("purpose"))
        or None
    )
    cancelled = bool(entry.get("is_cancelled")) or int(entry.get("docstatus") or 0) == 2
    return {
        "voucher_type": voucher_type,
        "voucher_no": _text(entry.get("voucher_no")),
        "warehouse": _text(entry.get("warehouse")) or None,
        "posting_datetime": _stamp(entry.get("posting_datetime")),
        "outward": bool(entry.get("is_outward")) or _text(entry.get("type_of_transaction")) == "Outward",
        "qty": _number(entry.get("qty")),
        "cancelled": cancelled,
        "party": party,
        "is_return": bool(doc.get("is_return")),
        "return_against": _text(doc.get("return_against")) or None,
        "grand_total": _number(doc.get("grand_total")) if doc.get("grand_total") is not None else None,
        "owner": _text(doc.get("owner")) or None,
        "voucher_status": _text(doc.get("status")) or None,
    }


def order_movements(movements: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Newest first — the counter reads the story from what happened last."""
    return sorted(
        (dict(m) for m in movements),
        key=lambda m: (_text(m.get("posting_datetime")), _text(m.get("voucher_no"))),
        reverse=True,
    )


def sold_on(movements: Sequence[Mapping[str, Any]]) -> dict[str, Any] | None:
    """The live outward SALE that consumed this serial, if any.

    Cancelled movements never count — a cancelled ticket did not sell
    anything — and a Stock Entry issue is a consumption, not a sale, so the
    story labels it differently.
    """
    for move in order_movements(movements):
        if move.get("cancelled") or not move.get("outward"):
            continue
        if move.get("voucher_type") in ("Sales Invoice", "Delivery Note"):
            return move
    return None


def sellable_here(row: Mapping[str, Any], profile_warehouse: str | None) -> bool:
    """Can THIS register put the serial on a ticket right now?

    Active in the register's own warehouse.  Another warehouse's unit is
    shown, never offered — the add would die at submit with «not in
    warehouse», which is exactly the wall this surface exists to remove.
    """
    return (
        _text(row.get("status")) == "Active"
        and bool(profile_warehouse)
        and _text(row.get("warehouse")) == _text(profile_warehouse)
    )


def _date(value: Any) -> str | None:
    text = _text(value)
    return text[:10] if text else None


def _stamp(value: Any) -> str | None:
    text = _text(value)
    if not text:
        return None
    # `2026-08-04 14:09:36.004213` → seconds; ISO `T` from JSON round-trips too.
    return text.replace("T", " ")[:19]


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------

#: How close to its date a batch earns the warning tone.  The lot picker's
#: `LOT_EXPIRY_WARNING_DAYS` says 30 too; both read from the pharma ask.
BATCH_EXPIRY_WARNING_DAYS = 30

BATCH_BUCKETS: tuple[str, ...] = ("available", "all", "expired", "empty")


def normalize_batch_bucket(raw: Any) -> str:
    text = _text(raw)
    return text if text in BATCH_BUCKETS else "available"


def stock_by_batch(aggregates: Iterable[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Per-batch stock split by warehouse, from summed bundle entries.

    ``aggregates`` are ``{batch_no, warehouse, qty}`` rows (already summed by
    the query).  Zero and negative warehouses are dropped: a warehouse the
    batch left entirely is history, and the story panel reads history from
    the movements, not from the stock split.
    """
    stock: dict[str, list[dict[str, Any]]] = {}
    for row in aggregates:
        batch_no = _text(row.get("batch_no"))
        qty = _number(row.get("qty"))
        if not batch_no or qty <= 0:
            continue
        stock.setdefault(batch_no, []).append(
            {"warehouse": _text(row.get("warehouse")) or None, "qty": qty}
        )
    for rows in stock.values():
        rows.sort(key=lambda r: (-r["qty"], r["warehouse"] or ""))
    return stock


def days_until(date_text: str | None, today: str) -> int | None:
    """Whole days from ``today`` to an ISO date; negative once past."""
    if not date_text or not today:
        return None
    try:
        from datetime import date

        target = date.fromisoformat(_text(date_text)[:10])
        base = date.fromisoformat(_text(today)[:10])
    except ValueError:
        return None
    return (target - base).days


def expiry_tone(days: int | None) -> str:
    if days is None:
        return "none"
    if days < 0:
        return "expired"
    if days <= BATCH_EXPIRY_WARNING_DAYS:
        return "soon"
    return "ok"


def shape_batch_row(
    batch: Mapping[str, Any],
    stock: Sequence[Mapping[str, Any]] | None,
    profile_warehouse: str | None,
    today: str,
) -> dict[str, Any]:
    """The list row for a batch: identity, dates, and where its units are."""
    split = [dict(r) for r in (stock or [])]
    total = sum(_number(r.get("qty")) for r in split)
    here = sum(
        _number(r.get("qty")) for r in split if _text(r.get("warehouse")) == _text(profile_warehouse)
    )
    expiry = _date(batch.get("expiry_date"))
    days = days_until(expiry, today)
    return {
        "batch_no": _text(batch.get("name") or batch.get("batch_id")),
        "item_code": _text(batch.get("item")),
        "item_name": _text(batch.get("item_name")) or _text(batch.get("item")),
        "expiry_date": expiry,
        "manufacturing_date": _date(batch.get("manufacturing_date")),
        "days_to_expiry": days,
        "tone": expiry_tone(days),
        "disabled": bool(batch.get("disabled")),
        "stock_uom": _text(batch.get("stock_uom")) or None,
        "supplier": _text(batch.get("supplier")) or None,
        "total_qty": total,
        "qty_here": here,
        "stock": split,
    }


def batch_bucket_of(row: Mapping[str, Any]) -> str:
    """Which tab a shaped batch row belongs to (a row is in exactly one)."""
    if row.get("tone") == "expired":
        return "expired"
    if _number(row.get("total_qty")) <= 0:
        return "empty"
    return "available"


def bucket_batches(rows: Sequence[Mapping[str, Any]], bucket: str) -> list[dict[str, Any]]:
    """Filter + FEFO order: soonest date first, undated last, then by name."""
    wanted = normalize_batch_bucket(bucket)
    kept = [dict(r) for r in rows if wanted == "all" or batch_bucket_of(r) == wanted]
    kept.sort(
        key=lambda r: (
            r.get("expiry_date") is None,
            r.get("expiry_date") or "",
            r.get("batch_no") or "",
        )
    )
    return kept


def batch_counts(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counts = {bucket: 0 for bucket in BATCH_BUCKETS}
    for row in rows:
        counts[batch_bucket_of(row)] += 1
        counts["all"] += 1
    return counts


def batch_qty_in(row: Mapping[str, Any], warehouse: str | None) -> float:
    """Units of a shaped batch row sitting in ONE warehouse, from its split."""
    if not warehouse:
        return 0.0
    return sum(
        _number(part.get("qty"))
        for part in row.get("stock") or []
        if _text(part.get("warehouse")) == _text(warehouse)
    )


def batch_sellable_here(row: Mapping[str, Any], profile_warehouse: str | None) -> bool:
    """Units of THIS batch this register can sell right now: not expired,
    not disabled, and physically in the register's warehouse — read from
    the stock split, so the answer follows the warehouse asked about."""
    return (
        bool(profile_warehouse)
        and not row.get("disabled")
        and row.get("tone") != "expired"
        and batch_qty_in(row, profile_warehouse) > 0
    )
