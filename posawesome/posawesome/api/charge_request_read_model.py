# Copyright (c) 2026, doco contributors
"""Read model behind the Orden de servicio surface (artboard `Orden.dc.html`).

`charge_requests.py` owns the WRITE path — the gate, the draft invoice, the
Open → Charged transition — and stays the only module that mints money. This
one only reads, and it exists as a separate file for two reasons: that module
is already at 276 lines and a board + detail model does not fit under the
500-line ceiling beside it, and everything here is shaped for a screen rather
than for a transaction.

TALLER IS READ BY DOCTYPE NAME, NEVER IMPORTED. posawesome installs on tenants
that have no repair workshop at all, so a module-level `from taller import …`
would break every one of them. Every repair fact below is fetched through
`frappe.db` behind an existence probe, exactly as doco's own POS Charge Request
controller duck-types its reference callback. A tenant without taller still
gets a working surface: the cards render from the charge request alone and the
«En trabajo» bucket is ABSENT rather than zero, because zero is a claim about
a workshop that does not exist.

WHAT THE SERVER DOES NOT DO: it returns provenance as a KEY (`stock`,
`customer_supplied`, `ordered`, `labor`), never as a sentence. Choosing the
operator's words is the SPA's job — it already holds `es.csv` — and a server
that formats "surtida de almacén" makes the string untranslatable and the
value untestable at the same time.
"""

from __future__ import annotations

import json
from datetime import datetime

import frappe

# Numeric coercion and datetime parsing are done with the stdlib rather than
# with `frappe.utils`, so the pure half of this module has NO frappe dependency
# beyond the bare import. That is not stylistic: several sibling test modules
# replace `sys.modules["frappe.utils"]` with a stub of their own and never
# restore it, so under `unittest discover` a module-level
# `from frappe.utils import flt` resolves against whichever stub ran first and
# fails on the one attribute that stub happens to lack.


def _flt(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _cint(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _as_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


REPAIR_ORDER_DOCTYPE = "Repair Order"

# The buckets the artboard's chips name, in render order. `working` is the
# only one that needs taller; the other two are charge-request facts.
SERVICE_ORDER_BUCKETS = ("ready", "working", "delivered")

# Repair Order statuses that mean "the workshop still has it". Mirrors the
# Select options on taller's own doctype; a status this list has never heard
# of counts as working, because an unknown state is certainly not delivered.
WORKING_REPAIR_STATUSES = (
    "Recibido",
    "En Trabajo",
    "Esperando Cliente",
    "Esperando Pieza",
)

# Fields read off a Repair Order for the cards and the detail panel. Listed
# rather than fetched whole: several are custom fields taller adds at install
# time, and `get_all` on a missing column throws where `get_value` on a doc
# would only return None.
_REPAIR_CARD_FIELDS = (
    "name",
    "status",
    "device_model",
    "repair_to_be_done",
    "falla_reportada",
)

_REPAIR_DETAIL_FIELDS = (
    "technician",
    "received_by",
    "work_started_on",
    "work_finished_on",
    "advance_amount",
    "balance_due",
    "billing_total",
    "labor_charge",
    "no_charge",
    "is_warranty_claim",
    "warranty_period_days",
    "warranty_expires_on",
)


def repairs_installed() -> bool:
    """True when this tenant has taller's Repair Order doctype.

    Cheap and cached by Frappe's own doctype cache, so it is safe on the read
    path. Never raises: a probe that throws would take the whole surface down
    on the tenants it exists to protect.
    """
    try:
        return bool(frappe.db.exists("DocType", REPAIR_ORDER_DOCTYPE))
    except Exception:
        return False


def _available_repair_fields(fields: tuple[str, ...]) -> list[str]:
    """The subset of `fields` the installed Repair Order actually has.

    taller adds `advance_amount`, `no_charge` and the warranty pair as CUSTOM
    fields through patches, so a tenant mid-upgrade can have the doctype
    without them. Asking for a column that is not there fails the whole query
    — and a detail panel that 500s because a warranty field has not landed yet
    is worse than a detail panel with no warranty chip.
    """
    return [field for field in fields if frappe.db.has_column(REPAIR_ORDER_DOCTYPE, field)]


# --------------------------------------------------------------------------
# Pure shaping — no frappe, no i18n. Tested directly with dict fixtures.
# --------------------------------------------------------------------------


def order_title(request: dict, repair: dict | None) -> str:
    """«Samsung A54 · pantalla rota» — the device and what is wrong with it.

    Falls back to the request's own `source_label` (taller writes
    "RO-00048 — Samsung A54" into it) and then to the request name, so a
    non-repair vertical pushing charge requests still gets a readable card.
    """
    if repair:
        parts = [
            str(repair.get("device_model") or "").strip(),
            str(repair.get("falla_reportada") or repair.get("repair_to_be_done") or "").strip(),
        ]
        named = [part for part in parts if part]
        if named:
            return " · ".join(named)
    return str(request.get("source_label") or request.get("name") or "")


def describe_order_card(
    request: dict,
    repair: dict | None,
    serials: list[str] | None = None,
) -> dict:
    """One card in the queue column.

    `folio` is the REPAIR ORDER's name when there is one, because that is the
    number printed on the customer's ticket and the number they will say out
    loud. The charge request's own name is kept as `name` — it is what every
    write endpoint takes — so the two never get confused.

    `serials` and `customer_phone` exist for ONE reason: the artboard's search
    box says "Folio, IMEI o teléfono…", and a counter really does find an order
    by the number on the back of the phone. They are on the card rather than
    behind a second endpoint because the search runs over the page the surface
    already holds — no round trip per keystroke.
    """
    charged = str(request.get("status") or "") == "Charged"
    advance = _flt(repair.get("advance_amount")) if repair else 0.0
    return {
        "name": request.get("name"),
        "serials": list(serials or []),
        "customer_phone": request.get("customer_phone") or None,
        "folio": (repair or {}).get("name") or request.get("reference_name") or request.get("name"),
        "reference_doctype": request.get("reference_doctype"),
        "reference_name": request.get("reference_name"),
        "customer": request.get("customer"),
        "customer_name": request.get("customer_name") or request.get("customer"),
        "title": order_title(request, repair),
        "amount_total": _flt(request.get("amount_total")),
        "advance": advance,
        "repair_status": (repair or {}).get("status"),
        # The three flags the artboard turns into chips. Each one is a fact
        # the register must not guess: an already-invoiced order is the one
        # the cashier must NOT charge again.
        "invoiced": charged,
        "invoice": request.get("invoice") if charged else None,
        "warranty": bool(_cint((repair or {}).get("is_warranty_claim"))),
        "no_charge": bool(_cint((repair or {}).get("no_charge"))),
        "warranty_days": _cint((repair or {}).get("warranty_period_days")) or None,
    }


_PART_PROVENANCE = {
    "Stock": "stock",
    "Customer-Supplied": "customer_supplied",
    "Ordered": "ordered",
}


def describe_order_lines(
    items: list[dict],
    parts: list[dict],
    labor_item: str | None,
) -> list[dict]:
    """«Mano de obra y refacciones», with each row carrying WHERE IT CAME FROM.

    Two sources, merged on purpose:

    - `items` is the charge request's `items_json` — exactly what will be
      billed, at the prices that will be billed. It is the money, so it leads.
    - `parts` is the Repair Order's own parts table, which is the ONLY place a
      customer-supplied piece appears: taller's `_billable_parts` filters
      `source == "Customer-Supplied"` out of the charge request by
      construction. The artboard draws that row ("pieza traída por el cliente ·
      no se cobra") and without this merge it could never be drawn.

    A part matched to a billed line lends it provenance and its serial; an
    unmatched customer-supplied part is appended at zero. Matching is by item
    code and first-wins, which is right because two rows of the same item on
    one order are the same part twice, not two different origins.
    """
    remaining: dict[str, list[dict]] = {}
    for part in parts or []:
        remaining.setdefault(str(part.get("item") or ""), []).append(part)

    lines: list[dict] = []
    for item in items or []:
        code = str(item.get("item_code") or "")
        qty = _flt(item.get("qty"))
        rate = _flt(item.get("rate"))
        match = remaining.get(code, [])
        part = match.pop(0) if match else None
        is_labor = bool(labor_item) and code == labor_item
        lines.append(
            {
                "item_code": code,
                "item_name": (part or {}).get("item_name") or item.get("description") or code,
                "description": item.get("description"),
                "qty": qty,
                "rate": rate,
                "amount": _flt(qty * rate),
                "kind": "labor" if is_labor else "part",
                "provenance": "labor"
                if is_labor
                else _PART_PROVENANCE.get(str((part or {}).get("source") or ""), "stock"),
                "billable": True,
                "serial_no": (part or {}).get("serial_no") or None,
            }
        )

    for rows in remaining.values():
        for part in rows:
            if str(part.get("source") or "") != "Customer-Supplied":
                # Anything else left over is a part the workshop recorded but
                # did not bill (a zero charge, a line added after the request
                # was built). It is not the cashier's business — the money is
                # the charge request's, and inventing a row here would put a
                # figure on screen that the invoice will not carry.
                continue
            lines.append(
                {
                    "item_code": part.get("item"),
                    "item_name": part.get("item_name") or part.get("item"),
                    "description": part.get("notes"),
                    "qty": _flt(part.get("qty")),
                    "rate": 0.0,
                    "amount": 0.0,
                    "kind": "part",
                    "provenance": "customer_supplied",
                    "billable": False,
                    "serial_no": part.get("serial_no") or None,
                }
            )
    return lines


def worked_minutes(started: object, finished: object) -> int | None:
    """Bench time on the order, in minutes, or None when it is not knowable.

    The artboard prints "1 h 40 m" beside the labor line and "8 h 28 m" in the
    header. Both are the SAME span — taller records one start and one finish
    per order, not per line — so the surface shows it once, on the header,
    rather than repeating it beside a labor row and implying a per-line
    measurement nobody takes.
    """
    begin = _as_datetime(started)
    end = _as_datetime(finished)
    if not begin or not end:
        return None
    minutes = int((end - begin).total_seconds() // 60)
    return minutes if minutes >= 0 else None


# --------------------------------------------------------------------------
# Gathering — the frappe half.
# --------------------------------------------------------------------------


def fetch_repair_cards(reference_names: list[str]) -> dict[str, dict]:
    """Repair Order facts for a page of charge requests, in ONE query.

    Keyed by RO name. Absent keys are the honest answer for a request whose
    reference is not a Repair Order (another vertical) or whose order was
    deleted — `describe_order_card` renders those from the request alone.
    """
    if not reference_names or not repairs_installed():
        return {}
    fields = _available_repair_fields(_REPAIR_CARD_FIELDS + _REPAIR_DETAIL_FIELDS)
    if "name" not in fields:
        return {}
    rows = frappe.get_all(
        REPAIR_ORDER_DOCTYPE,
        filters={"name": ["in", list(dict.fromkeys(reference_names))]},
        fields=fields,
        limit_page_length=len(reference_names) + 1,
    )
    return {row["name"]: row for row in rows}


def fetch_repair_serials(reference_names: list[str]) -> dict[str, list[str]]:
    """IMEIs and serials per Repair Order, so the search box can find one.

    Keyed by parent. One query for the whole page — the alternative is a
    lookup per card, which is the shape that turns a 40-order queue into 40
    round trips.
    """
    if not reference_names or not repairs_installed():
        return {}
    rows = frappe.get_all(
        "Repair Order Serial No",
        filters={
            "parenttype": REPAIR_ORDER_DOCTYPE,
            "parent": ["in", list(dict.fromkeys(reference_names))],
        },
        fields=["parent", "serial_no"],
        limit_page_length=0,
    )
    out: dict[str, list[str]] = {}
    for row in rows:
        serial = str(row.get("serial_no") or "").strip()
        if serial:
            out.setdefault(row["parent"], []).append(serial)
    return out


def fetch_repair_parts(repair_name: str) -> list[dict]:
    """The order's parts table, for provenance. Empty without taller."""
    if not repair_name or not repairs_installed():
        return []
    return frappe.get_all(
        "Repair Order Part",
        filters={"parenttype": REPAIR_ORDER_DOCTYPE, "parent": repair_name},
        fields=["item", "item_name", "qty", "source", "serial_no", "customer_charge", "notes"],
        order_by="idx asc",
        limit_page_length=200,
    )


def resolve_labor_item() -> str | None:
    """taller's configured labor Item, so a labor line can be told apart.

    Read off Taller App Settings rather than guessed from the description:
    `_build_billing_lines` writes "Mano de obra — …" into `description`, and
    matching on a Spanish prefix would break the moment a tenant renames it.
    """
    if not frappe.db.exists("DocType", "Taller App Settings"):
        return None
    try:
        return frappe.db.get_single_value("Taller App Settings", "labor_item_code") or None
    except Exception:
        return None


def working_repair_count() -> int | None:
    """How many orders the workshop still has open.

    None — not zero — without taller, and the surface renders no chip for it.
    A tenant with no repair app has no "En trabajo" to report, and a 0 there
    would read as "the workshop is idle" rather than "there is no workshop".

    Tenant-wide on purpose: Repair Order carries no `company` field (taller's
    own charge-request builder falls back to Global Defaults for it), so there
    is nothing to scope by. This is a COUNT of workshop work — the two buckets
    that reach the till, `ready` and `delivered`, stay company- and
    profile-scoped where the money is.
    """
    if not repairs_installed():
        return None
    return _cint(
        frappe.db.count(REPAIR_ORDER_DOCTYPE, {"status": ["in", list(WORKING_REPAIR_STATUSES)]})
    )


def request_items(request_name: str) -> list[dict]:
    """`items_json` off one charge request, parsed defensively.

    The doctype validates the JSON on write, but this is a READ path and a
    request written by an older build must not take the surface down.
    """
    raw = frappe.db.get_value("POS Charge Request", request_name, "items_json")
    try:
        parsed = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [row for row in parsed if isinstance(row, dict)]
