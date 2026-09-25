# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

"""Paquetes: combos whose customer picks from groups (``POS Combo``, type
``Choice Groups``).

Three things live here, all reading the same definitions:

* ``load_choice_definitions`` — the paquetes, their groups and options. The
  read model (``combos.get_combos``) prices them for the register; the voucher
  below judges a ticket against them.
* ``combo_line_exemptions`` — posawesome's own answer to the
  ``posa_price_guard_exemptions`` hook. The picked lines of a paquete sell at 0
  (or at the option's extra charge), which ``_reprice`` would refuse as a rate
  edit; the hook hands back exactly the lines ``combo_choice_rules`` vouches
  for, and nothing else.
* ``assert_combo_lines`` — the submit gate, so a paquete the ticket got wrong
  is refused with its own reason («Combo Desayuno needs 1 of «Bebida»») rather
  than with the generic rate-band message the guards would give.

The rules themselves are in ``combo_choice_rules`` and touch no database.
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt

from posawesome.posawesome.api.combo_choice_rules import (
    GROUP_FIELD,
    PARENT_FIELD,
    evaluate_combo_lines,
    is_combo_component,
    stock_units,
)

CHOICE_TYPE = "Choice Groups"


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _lines(invoice_doc: Any) -> list:
    return list(_get(invoice_doc, "items") or [])


def choice_combos_supported() -> bool:
    """False on a site whose migrate has not created the paquete tables yet.

    The register's first call after a code deploy can land before
    ``bench migrate``; answering "no paquetes" there is the honest degraded
    state, where a query against a missing column would 500 the catalogue.
    """
    try:
        return bool(
            frappe.db.exists("DocType", "POS Combo Group")
            and frappe.db.exists("DocType", "POS Combo Option")
            and frappe.db.has_column("POS Combo", "combo_type")
            and frappe.db.has_column("POS Combo", "combo_item")
        )
    except Exception:
        return False


def load_choice_definitions(combo_items=None) -> dict[str, dict]:
    """Enabled paquetes keyed by the item they sell.

    ``combo_items`` narrows the answer; ``None`` means every paquete. Each value
    is ``{"name", "combo_item", "priority", "groups": [{"name", "min", "max",
    "item_group", "options": [{"item_code", "item_name", "qty",
    "extra_price", "is_default"}]}]}`` with groups and options in table order.
    """
    if not choice_combos_supported():
        return {}

    filters = {"disabled": 0, "combo_type": CHOICE_TYPE}
    if combo_items is not None:
        codes = sorted({code for code in combo_items if code})
        if not codes:
            return {}
        filters["combo_item"] = ["in", codes]

    rows = [
        row
        for row in frappe.get_all(
            "POS Combo", filters=filters, fields=["name", "combo_item", "priority"]
        )
        if row.get("combo_item")
    ]
    if not rows:
        return {}

    names = [row["name"] for row in rows]
    groups_by_parent: dict[str, list[dict]] = {}
    for row in frappe.get_all(
        "POS Combo Group",
        filters={"parent": ["in", names], "parenttype": "POS Combo"},
        fields=["parent", "group_name", "min_qty", "max_qty", "item_group"],
        order_by="parent asc, idx asc",
    ):
        name = (row.get("group_name") or "").strip()
        if not name:
            continue
        groups_by_parent.setdefault(row["parent"], []).append(
            {
                "name": name,
                "min": cint(row.get("min_qty")),
                "max": cint(row.get("max_qty")),
                "item_group": row.get("item_group") or None,
                "options": [],
            }
        )

    for row in frappe.get_all(
        "POS Combo Option",
        filters={"parent": ["in", names], "parenttype": "POS Combo"},
        fields=["parent", "group_name", "item_code", "item_name", "qty", "extra_price", "is_default"],
        order_by="parent asc, idx asc",
    ):
        group_name = (row.get("group_name") or "").strip()
        for group in groups_by_parent.get(row["parent"], []):
            if group["name"] == group_name:
                group["options"].append(
                    {
                        "item_code": row.get("item_code"),
                        "item_name": row.get("item_name") or row.get("item_code"),
                        "qty": flt(row.get("qty")) or 1.0,
                        "extra_price": flt(row.get("extra_price")),
                        "is_default": cint(row.get("is_default")),
                    }
                )
                break

    definitions = {}
    for row in rows:
        groups = groups_by_parent.get(row["name"]) or []
        if not groups:
            continue
        definitions[row["combo_item"]] = {
            "name": row["name"],
            "combo_item": row["combo_item"],
            "priority": flt(row.get("priority")),
            "groups": groups,
        }
    return definitions


def eligible_group_items(item_group: str, limit: int | None = None) -> list[dict]:
    """Items an «Any Item From» group offers: sellable, pickable at the till.

    The same exclusions ``POSCombo.validate_choice_groups`` applies to explicit
    options — no templates, nothing serial- or batch-tracked — so a group fed by
    an Item Group can never offer what an explicit row would be refused for.
    """
    if not item_group:
        return []
    return frappe.get_all(
        "Item",
        filters={
            "item_group": ["descendants of (inclusive)", item_group],
            "disabled": 0,
            "is_sales_item": 1,
            "has_variants": 0,
            "has_serial_no": 0,
            "has_batch_no": 0,
        },
        fields=["name", "item_name", "image", "is_stock_item", "stock_uom"],
        order_by="item_name asc",
        limit_page_length=limit or 0,
    )


def _item_group_members(definitions: dict[str, dict], item_codes: set[str]) -> dict[str, set[str]]:
    """For each «Any Item From» source, which of these items it contains."""
    sources = {
        group["item_group"]
        for definition in definitions.values()
        for group in definition.get("groups") or []
        if group.get("item_group")
    }
    if not sources or not item_codes:
        return {}

    items = frappe.get_all(
        "Item",
        filters={
            "name": ["in", sorted(item_codes)],
            "disabled": 0,
            "is_sales_item": 1,
            "has_variants": 0,
            "has_serial_no": 0,
            "has_batch_no": 0,
        },
        fields=["name", "item_group"],
    )
    wanted_groups = sources | {row.get("item_group") for row in items if row.get("item_group")}
    bounds = {
        row["name"]: (row["lft"], row["rgt"])
        for row in frappe.get_all(
            "Item Group", filters={"name": ["in", sorted(wanted_groups)]}, fields=["name", "lft", "rgt"]
        )
    }

    members: dict[str, set[str]] = {}
    for source in sources:
        if source not in bounds:
            continue
        low, high = bounds[source]
        members[source] = {
            row["name"]
            for row in items
            if row.get("item_group") in bounds
            and low <= bounds[row["item_group"]][0]
            and bounds[row["item_group"]][1] <= high
        }
    return members


def _original_components(invoice_doc: Any) -> dict[tuple[str, str, str], dict]:
    """The picked lines of the sale a return reverses, keyed for matching."""
    doctype = _get(invoice_doc, "doctype") or "Sales Invoice"
    child = "POS Invoice Item" if doctype == "POS Invoice" else "Sales Invoice Item"
    if not frappe.db.has_column(child, PARENT_FIELD):
        return {}

    sold: dict[tuple[str, str, str], dict] = {}
    for row in frappe.get_all(
        child,
        filters={
            "parent": _get(invoice_doc, "return_against"),
            "parenttype": doctype,
            PARENT_FIELD: ["is", "set"],
        },
        fields=["item_code", "rate", "qty", "stock_qty", "conversion_factor", PARENT_FIELD, GROUP_FIELD],
    ):
        key = (
            (row.get(PARENT_FIELD) or "").strip(),
            (row.get("item_code") or "").strip(),
            (row.get(GROUP_FIELD) or "").strip(),
        )
        entry = sold.setdefault(key, {"rate": flt(row.get("rate")), "units": 0.0})
        entry["units"] += stock_units(row)
    return sold


def verify_combo_lines(invoice_doc: Any, profile_doc: Any = None) -> tuple[list, list[str]]:
    """``(vouched line objects, reasons)`` for this ticket's paquete lines.

    ``profile_doc`` is accepted for the hook's signature; paquetes are not
    per-register, so it decides nothing here.
    """
    lines = _lines(invoice_doc)
    children = [line for line in lines if is_combo_component(line)]
    if not children:
        return [], []

    original = None
    if cint(_get(invoice_doc, "is_return")) and _get(invoice_doc, "return_against"):
        original = _original_components(invoice_doc)

    definitions = {} if original is not None else load_choice_definitions()
    members = (
        _item_group_members(definitions, {(_get(line, "item_code") or "") for line in children})
        if definitions
        else {}
    )
    return evaluate_combo_lines(
        lines,
        definitions,
        original_components=original,
        item_group_members=members,
        conversion_rate=flt(_get(invoice_doc, "conversion_rate")) or 1.0,
        translate=_,
    )


def combo_line_exemptions(invoice_doc: Any, profile_doc: Any = None) -> list:
    """Hook ``posa_price_guard_exemptions``: the paquete lines whose price we own."""
    vouched, _reasons = verify_combo_lines(invoice_doc, profile_doc)
    return vouched


def assert_combo_lines(invoice_doc: Any, profile_doc: Any = None) -> None:
    """Refuse a ticket whose paquete lines do not add up, saying why."""
    _vouched, reasons = verify_combo_lines(invoice_doc, profile_doc)
    if reasons:
        frappe.throw("<br>".join(reasons), title=_("Paquete"))
