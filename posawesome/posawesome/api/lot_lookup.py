"""SERIES Y LOTES — the register's own lookup for serial numbers and batches.

Why this exists (owner, 2026-09-05): a sale was refused because the IMEI in
the cashier's hand had been «sold» two months earlier — a previous ticket
had consumed the wrong unit — and finding which serial of the same model was
still Active meant leaving the register for the desk's Serial No list.  This
module answers that question from inside the app: search a serial or a
batch, read where it went (which voucher, whom, when), and see which units of
the SAME item this register can still sell.

Read-only, every endpoint.  Scope is the POS Profile's company — never a
``company`` argument — and the profile itself is asserted against the
session user (`_scope.assert_profile`), the same contract the quotations
lane keeps.  `frappe.get_all` is used deliberately: Serial No's own role
permissions (Stock User / Manager) are a warehouse clerk's, and a cashier
who may SELL a serial must be able to READ it.

Every decision about rows lives in `lot_read_model.py`, without frappe, so
the tests can assert it.
"""

from __future__ import annotations

from typing import Any, Sequence

import frappe
from frappe import _
from frappe.query_builder import Criterion
from frappe.query_builder.functions import Count, Sum
from frappe.utils import nowdate

from posawesome.posawesome.api import lot_read_model as model
from posawesome.posawesome.api._scope import assert_profile

_ENTRY_FIELDS = [
    "serial_no",
    "batch_no",
    "warehouse",
    "voucher_type",
    "voucher_no",
    "posting_datetime",
    "is_outward",
    "type_of_transaction",
    "qty",
    "docstatus",
    "is_cancelled",
    "creation",
]

_SERIAL_FIELDS = [
    "name",
    "item_code",
    "item_name",
    "status",
    "warehouse",
    "customer",
    "batch_no",
    "purchase_document_no",
    "warranty_expiry_date",
    "posting_date",
    "company",
]

_BATCH_FIELDS = [
    "name",
    "batch_id",
    "item",
    "item_name",
    "expiry_date",
    "manufacturing_date",
    "disabled",
    "stock_uom",
    "supplier",
]


def _profile_scope(pos_profile: str | None) -> tuple[str, str | None]:
    """(company, warehouse) of the register — asserted, never trusted."""
    assert_profile(frappe.session.user, pos_profile)
    row = frappe.db.get_value("POS Profile", pos_profile, ["company", "warehouse"], as_dict=True)
    if not row or not row.get("company"):
        frappe.throw(_("POS Profile {0} has no company.").format(pos_profile))
    return row["company"], row.get("warehouse") or None


def _company_warehouses(company: str) -> list[str]:
    return frappe.get_all("Warehouse", filters={"company": company, "is_group": 0}, pluck="name")


def _like(term: str) -> str:
    return f"%{term}%"


def _serial_scope_filters(company: str, item_code: str | None, warehouse: str | None) -> dict[str, Any]:
    filters: dict[str, Any] = {"company": company}
    if item_code:
        filters["item_code"] = item_code
    if warehouse:
        filters["warehouse"] = warehouse
    return filters


def _serial_or_filters(query: str) -> list[list[Any]]:
    if not query:
        return []
    like = _like(query)
    return [
        ["Serial No", "name", "like", like],
        ["Serial No", "item_code", "like", like],
        ["Serial No", "item_name", "like", like],
        ["Serial No", "customer", "like", like],
    ]


def _serial_status_counts(company: str, item_code: str | None, warehouse: str | None, term: str):
    """`status → count` over the scoped set. Query builder, not a string
    `count(name)`: v16's HTTP path validates SELECT strings and 417s a SQL
    function written as text (charge_requests learned the same lesson)."""
    SN = frappe.qb.DocType("Serial No")
    query = frappe.qb.from_(SN).select(SN.status, Count(SN.name).as_("n")).where(SN.company == company)
    if item_code:
        query = query.where(SN.item_code == item_code)
    if warehouse:
        query = query.where(SN.warehouse == warehouse)
    if term:
        like = _like(term)
        query = query.where(
            Criterion.any(
                [SN.name.like(like), SN.item_code.like(like), SN.item_name.like(like), SN.customer.like(like)]
            )
        )
    return query.groupby(SN.status).run(as_dict=True)


def _active_warehouse_counts(company: str):
    SN = frappe.qb.DocType("Serial No")
    return (
        frappe.qb.from_(SN)
        .select(SN.warehouse, Count(SN.name).as_("n"))
        .where((SN.company == company) & (SN.status == "Active"))
        .groupby(SN.warehouse)
        .run(as_dict=True)
    )


def _live_entries(**filters: Any) -> list[dict[str, Any]]:
    """Bundle entries that still count: submitted, not cancelled."""
    return frappe.get_all(
        "Serial and Batch Entry",
        filters={"docstatus": 1, "is_cancelled": 0, **filters},
        fields=_ENTRY_FIELDS,
    )


def _all_entries(**filters: Any) -> list[dict[str, Any]]:
    """Every entry, cancelled ones included — the story shows them struck."""
    return frappe.get_all(
        "Serial and Batch Entry",
        filters=filters,
        fields=_ENTRY_FIELDS,
        order_by="posting_datetime desc, creation desc",
    )


def _vouchers(entries: Sequence[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """The voucher head behind each entry, one query per doctype."""
    wanted: dict[str, set[str]] = {}
    for entry in entries:
        vt, vn = entry.get("voucher_type"), entry.get("voucher_no")
        if vt and vn:
            wanted.setdefault(vt, set()).add(vn)
    found: dict[tuple[str, str], dict[str, Any]] = {}
    for voucher_type, names in wanted.items():
        if not frappe.db.exists("DocType", voucher_type):
            continue
        fields = [f for f in model.voucher_party_fields(voucher_type) if frappe.db.has_column(voucher_type, f)]
        for row in frappe.get_all(voucher_type, filters={"name": ["in", sorted(names)]}, fields=["name", *fields]):
            found[(voucher_type, row["name"])] = row
    return found


def _movements(entries: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    vouchers = _vouchers(entries)
    return model.order_movements(
        [
            model.shape_movement(
                entry, vouchers.get((str(entry.get("voucher_type") or ""), str(entry.get("voucher_no") or "")))
            )
            for entry in entries
        ]
    )


# ---------------------------------------------------------------------------
# Serial numbers
# ---------------------------------------------------------------------------


@frappe.whitelist()
def search_serials(
    pos_profile=None,
    query=None,
    status=None,
    item_code=None,
    warehouse=None,
    limit=None,
    offset=None,
):
    """A page of serials matching the counter's question, plus the facets.

    Counts come from the whole scoped set (text + item + warehouse, but not
    the status tab), so the tab headers describe the list rather than the
    page — the same rule `get_quotations` keeps for its buckets.
    """
    company, profile_warehouse = _profile_scope(pos_profile)
    term = model.normalize_query(query)
    bucket = model.normalize_bucket(status)
    size, start = model.clamp_page(limit, offset)
    item_code = str(item_code or "").strip() or None
    warehouse = str(warehouse or "").strip() or None

    scope = _serial_scope_filters(company, item_code, warehouse)
    or_filters = _serial_or_filters(term)

    counts = {key: 0 for key in model.STATUS_BUCKETS}
    for row in _serial_status_counts(company, item_code, warehouse, term):
        key = str(row.get("status") or "")
        n = int(row.get("n") or 0)
        counts["all"] += n
        if key in counts:
            counts[key] += n

    page_filters = dict(scope)
    if bucket != "all":
        page_filters["status"] = bucket
    serials = frappe.get_all(
        "Serial No",
        filters=page_filters,
        or_filters=or_filters,
        fields=_SERIAL_FIELDS,
        order_by="modified desc",
        limit_start=start,
        limit_page_length=size,
    )

    names = [row["name"] for row in serials]
    latest = model.latest_movement_by_serial(_live_entries(serial_no=["in", names])) if names else {}
    rows = [model.shape_row(row, latest.get(row["name"])) for row in serials]
    for row in rows:
        row["sellable_here"] = model.sellable_here(row, profile_warehouse)

    warehouses = sorted(_active_warehouse_counts(company), key=lambda w: -int(w.get("n") or 0))

    return {
        "rows": rows,
        "counts": counts,
        "total": counts["all"] if bucket == "all" else counts.get(bucket, 0),
        "offset": start,
        "limit": size,
        "warehouses": [
            {"warehouse": w.get("warehouse"), "n": int(w.get("n") or 0)} for w in warehouses if w.get("warehouse")
        ],
        "profile_warehouse": profile_warehouse,
        "query": term,
        "status": bucket,
    }


@frappe.whitelist()
def get_serial_story(pos_profile=None, serial_no=None):
    """One serial, whole: its head, every movement, and its sellable siblings.

    The siblings are the answer the owner actually needed — «which one of
    the SAME model is still in stock» — listed with this register's own
    warehouse first so the fix is one tap away.
    """
    company, profile_warehouse = _profile_scope(pos_profile)
    serial_no = str(serial_no or "").strip()
    if not serial_no:
        frappe.throw(_("Serial No is required."))

    head = frappe.db.get_value("Serial No", serial_no, _SERIAL_FIELDS, as_dict=True)
    if not head or head.get("company") != company:
        frappe.throw(_("Serial No {0} was not found.").format(serial_no), frappe.DoesNotExistError)

    movements = _movements(_all_entries(serial_no=serial_no))
    live = [m for m in movements if not m.get("cancelled")]
    row = model.shape_row(head, None)
    if live:
        newest = live[0]
        row.update(
            last_voucher_type=newest.get("voucher_type"),
            last_voucher_no=newest.get("voucher_no"),
            last_moved_at=newest.get("posting_datetime"),
            last_outward=bool(newest.get("outward")),
        )
    row["sellable_here"] = model.sellable_here(row, profile_warehouse)

    siblings = frappe.get_all(
        "Serial No",
        filters={"company": company, "item_code": head["item_code"], "status": "Active", "name": ["!=", serial_no]},
        fields=["name", "warehouse", "batch_no", "warranty_expiry_date", "posting_date"],
        order_by="posting_date desc, name asc",
        limit_page_length=60,
    )
    sibling_rows = []
    for sib in siblings:
        sibling_rows.append(
            {
                "serial_no": sib["name"],
                "warehouse": sib.get("warehouse"),
                "batch_no": sib.get("batch_no"),
                "sellable_here": bool(profile_warehouse) and sib.get("warehouse") == profile_warehouse,
            }
        )
    sibling_rows.sort(key=lambda s: (not s["sellable_here"], s["warehouse"] or "", s["serial_no"]))

    return {
        "serial": row,
        "sold_on": model.sold_on(movements),
        "movements": movements,
        "siblings": sibling_rows,
        "profile_warehouse": profile_warehouse,
    }


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------


def _batch_stock(batch_names: Sequence[str], warehouses: Sequence[str]) -> dict[str, list[dict[str, Any]]]:
    if not batch_names or not warehouses:
        return {}
    E = frappe.qb.DocType("Serial and Batch Entry")
    aggregates = (
        frappe.qb.from_(E)
        .select(E.batch_no, E.warehouse, Sum(E.qty).as_("qty"))
        .where(E.batch_no.isin(list(batch_names)))
        .where(E.warehouse.isin(list(warehouses)))
        .where((E.docstatus == 1) & (E.is_cancelled == 0))
        .groupby(E.batch_no, E.warehouse)
        .run(as_dict=True)
    )
    return model.stock_by_batch(aggregates)


@frappe.whitelist()
def search_batches(pos_profile=None, query=None, bucket=None, item_code=None, limit=None):
    """Batches of the register's company, with where their units sit.

    Filtered and FEFO-ordered in Python after the page is fetched: a batch's
    bucket (available / expired / empty) depends on stock the row itself does
    not carry, so it cannot be a SQL filter without repeating the ledger sum.
    The page is bounded by `limit` (≤ 200) on the Batch side.
    """
    company, profile_warehouse = _profile_scope(pos_profile)
    term = model.normalize_query(query)
    size, _ = model.clamp_page(limit, 0)
    item_code = str(item_code or "").strip() or None

    filters: dict[str, Any] = {}
    if item_code:
        filters["item"] = item_code
    or_filters: list[list[Any]] = []
    if term:
        like = _like(term)
        or_filters = [
            ["Batch", "name", "like", like],
            ["Batch", "batch_id", "like", like],
            ["Batch", "item", "like", like],
            ["Batch", "item_name", "like", like],
        ]
    batches = frappe.get_all(
        "Batch",
        filters=filters,
        or_filters=or_filters,
        fields=_BATCH_FIELDS,
        order_by="modified desc",
        limit_page_length=size,
    )

    warehouses = _company_warehouses(company)
    stock = _batch_stock([b["name"] for b in batches], warehouses)
    today = nowdate()
    rows = [model.shape_batch_row(b, stock.get(b["name"]), profile_warehouse, today) for b in batches]
    for row in rows:
        row["sellable_here"] = model.batch_sellable_here(row, profile_warehouse)

    wanted = model.normalize_batch_bucket(bucket)
    return {
        "rows": model.bucket_batches(rows, wanted),
        "counts": model.batch_counts(rows),
        "bucket": wanted,
        "profile_warehouse": profile_warehouse,
        "today": today,
        "query": term,
    }


@frappe.whitelist()
def get_batch_story(pos_profile=None, batch_no=None):
    """One batch: head, stock per warehouse, and every movement."""
    company, profile_warehouse = _profile_scope(pos_profile)
    batch_no = str(batch_no or "").strip()
    if not batch_no:
        frappe.throw(_("Batch is required."))
    head = frappe.db.get_value("Batch", batch_no, _BATCH_FIELDS, as_dict=True)
    if not head:
        frappe.throw(_("Batch {0} was not found.").format(batch_no), frappe.DoesNotExistError)

    warehouses = _company_warehouses(company)
    stock = _batch_stock([batch_no], warehouses)
    row = model.shape_batch_row(head, stock.get(batch_no), profile_warehouse, nowdate())
    row["sellable_here"] = model.batch_sellable_here(row, profile_warehouse)

    entries = [e for e in _all_entries(batch_no=batch_no) if not warehouses or e.get("warehouse") in warehouses]
    return {
        "batch": row,
        "movements": _movements(entries),
        "profile_warehouse": profile_warehouse,
    }
