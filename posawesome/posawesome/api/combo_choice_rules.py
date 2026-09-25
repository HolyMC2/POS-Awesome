# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

"""Which paquete lines are genuine — the rules, with no database in reach.

A paquete (a ``POS Combo`` of type ``Choice Groups``) sells as one line for
the combo's own item at its Item Price, followed by one line per picked item:
priced 0, or at the option's extra charge. Those picked lines are why stock,
kitchen tickets and item reports see a «Capuchino» inside a «Combo Desayuno».

They are also a $0 line on a ticket, which the price guards in ``_reprice.py``
exist to refuse. This module is the answer those guards ask for through the
``posa_price_guard_exemptions`` hook: a picked line is vouched for ONLY when
the ticket carries the paquete line it names, the paquete still exists, the
item is one of the named group's options, its price is exactly the option's
extra charge with no discount, its quantity is a whole number of picks, and
every group's picks land between its minimum and maximum. Anything else is
reported, never vouched, so the guards go on refusing it.

Returns are judged against the SALE instead: a returned picked line must match
a picked line of the original invoice (same paquete line, item, group and
price) and cannot return more than was sold. A partial return — the customer
brings back only the juice — is legitimate there, so the group counts are not
re-applied.

Pure on purpose: lines may be Frappe documents or dicts, the definitions come
from ``combo_choice.load_choice_definitions`` and the item-group membership is
precomputed by the caller, so the standalone suite can test every rule without
a site.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

MONEY_TOLERANCE = 0.01
QTY_TOLERANCE = 1e-6

PARENT_FIELD = "posa_combo_parent"
GROUP_FIELD = "posa_combo_group"


def _get(line: Any, key: str, default: Any = None) -> Any:
    if line is None:
        return default
    if isinstance(line, dict):
        return line.get(key, default)
    return getattr(line, key, default)


def _num(value: Any) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0  # NaN → 0


def _text(value: Any) -> str:
    return str(value or "").strip()


def is_combo_component(line: Any) -> bool:
    """A picked line names the paquete line it belongs to."""
    return bool(_text(_get(line, PARENT_FIELD)))


def stock_units(line: Any) -> float:
    """Units of the item the line moves, in its stock UOM, as a magnitude."""
    stock_qty = _num(_get(line, "stock_qty"))
    if stock_qty:
        return abs(stock_qty)
    factor = _num(_get(line, "conversion_factor")) or 1.0
    return abs(_num(_get(line, "qty")) * factor)


def _label(line: Any) -> str:
    return _text(_get(line, "item_name")) or _text(_get(line, "item_code")) or "?"


def find_option(
    group: dict, item_code: str, item_group_members: dict[str, set[str]] | None = None
) -> dict | None:
    """The option row for this item in this group, explicit rows first.

    A group fed by an Item Group accepts any member of it at no extra charge,
    one unit per pick — the same terms the read model offers them on.
    """
    for option in group.get("options") or []:
        if option.get("item_code") == item_code:
            return option
    source = group.get("item_group")
    if source and item_code in (item_group_members or {}).get(source, set()):
        return {"item_code": item_code, "qty": 1.0, "extra_price": 0.0, "is_default": 0}
    return None


def evaluate_combo_lines(
    lines: Iterable[Any],
    definitions: dict[str, dict],
    *,
    original_components: dict[tuple[str, str, str], dict] | None = None,
    item_group_members: dict[str, set[str]] | None = None,
    conversion_rate: float = 1.0,
    translate: Callable[[str], str] | None = None,
) -> tuple[list[Any], list[str]]:
    """Split a ticket's picked lines into vouched lines and reasons.

    ``definitions`` maps a paquete's item code to
    ``{"name", "item_name", "groups": [{"name", "min", "max", "item_group",
    "options": [{"item_code", "qty", "extra_price"}]}]}``.

    ``original_components`` switches to RETURN rules: it maps
    ``(paquete line id, item_code, group)`` of the sale being returned to
    ``{"rate", "units"}``.

    Returns the line OBJECTS it vouches for (the price guards compare them by
    identity) and one human-readable reason per refusal. A paquete is vouched
    whole or not at all: one wrong pick refuses all of its lines, because the
    others' $0 prices only mean something as part of a complete paquete.
    """
    t = translate or (lambda text: text)
    all_lines = list(lines or [])
    children = [line for line in all_lines if is_combo_component(line)]
    if not children:
        return [], []

    rate_divisor = _num(conversion_rate) or 1.0

    by_row: dict[str, Any] = {}
    for line in all_lines:
        row_id = _text(_get(line, "posa_row_id"))
        if row_id and row_id not in by_row:
            by_row[row_id] = line

    by_parent: dict[str, list[Any]] = {}
    for child in children:
        by_parent.setdefault(_text(_get(child, PARENT_FIELD)), []).append(child)

    vouched: list[Any] = []
    errors: list[str] = []

    for parent_id, kids in by_parent.items():
        if original_components is not None:
            # A return is priced by the sale it reverses, in the same currency,
            # so no conversion applies here.
            kid_errors = _return_errors(kids, parent_id, original_components, t)
        else:
            kid_errors = _sale_errors(
                kids, by_row.get(parent_id), definitions, item_group_members, rate_divisor, t
            )
        if kid_errors:
            errors.extend(kid_errors)
        else:
            vouched.extend(kids)

    return vouched, errors


def _sale_errors(kids, header, definitions, item_group_members, rate_divisor, t) -> list[str]:
    first = kids[0]
    if header is None or is_combo_component(header):
        return [
            t("Line {0} ({1}) belongs to a paquete that is not on this ticket.").format(
                _get(first, "idx") or "?", _label(first)
            )
        ]

    definition = definitions.get(_text(_get(header, "item_code")))
    paquete = _label(header)
    if not definition:
        return [
            t("{0} is no longer a paquete with choices. Remove it and add it again.").format(paquete)
        ]

    combos = abs(_num(_get(header, "qty")))
    if combos <= 0:
        return [t("{0} has no quantity, so its picks cannot be checked.").format(paquete)]

    groups = {group["name"]: group for group in definition.get("groups") or []}
    picks_by_group: dict[str, int] = {}
    errors: list[str] = []

    for kid in kids:
        idx = _get(kid, "idx") or "?"
        label = _label(kid)
        group_name = _text(_get(kid, GROUP_FIELD))
        group = groups.get(group_name)
        if not group:
            errors.append(
                t("Line {0} ({1}): {2} has no group «{3}».").format(idx, label, paquete, group_name or "?")
            )
            continue
        option = find_option(group, _text(_get(kid, "item_code")), item_group_members)
        if not option:
            errors.append(
                t("Line {0} ({1}) is not an option of «{2}» in {3}.").format(idx, label, group_name, paquete)
            )
            continue

        per_pick = _num(option.get("qty")) or 1.0
        picks = stock_units(kid) / (combos * per_pick)
        whole = round(picks)
        if whole < 1 or abs(picks - whole) > QTY_TOLERANCE:
            errors.append(
                t("Line {0} ({1}): the quantity does not match whole picks of {2}.").format(idx, label, paquete)
            )
            continue

        expected = (_num(option.get("extra_price")) / per_pick) / rate_divisor
        discounted = _num(_get(kid, "discount_percentage")) or _num(_get(kid, "discount_amount"))
        if abs(_num(_get(kid, "rate")) - expected) > MONEY_TOLERANCE or discounted:
            errors.append(
                t("Line {0} ({1}): its price must be the paquete's extra charge ({2}).").format(
                    idx, label, round(expected, 2)
                )
            )
            continue

        picks_by_group[group_name] = picks_by_group.get(group_name, 0) + int(whole)

    if errors:
        return errors

    for group in definition.get("groups") or []:
        picked = picks_by_group.get(group["name"], 0)
        low, high = int(group.get("min") or 0), int(group.get("max") or 0)
        if picked < low or picked > high:
            # `picked` is already per paquete: every line was divided by the
            # paquete line's quantity when its picks were counted.
            errors.append(
                t("{0} needs {1} to {2} of «{3}» per paquete; the ticket has {4}.").format(
                    paquete, low, high, group["name"], picked
                )
                if high != low
                else t("{0} needs {1} of «{2}» per paquete; the ticket has {3}.").format(
                    paquete, low, group["name"], picked
                )
            )
    return errors


def _return_errors(kids, parent_id, original_components, t) -> list[str]:
    errors: list[str] = []
    for kid in kids:
        idx = _get(kid, "idx") or "?"
        label = _label(kid)
        key = (parent_id, _text(_get(kid, "item_code")), _text(_get(kid, GROUP_FIELD)))
        sold = original_components.get(key)
        if not sold:
            errors.append(
                t("Line {0} ({1}) was not part of a paquete on the original sale.").format(idx, label)
            )
            continue
        if abs(_num(_get(kid, "rate")) - _num(sold.get("rate"))) > MONEY_TOLERANCE:
            errors.append(
                t("Line {0} ({1}) must be returned at the price it was sold for ({2}).").format(
                    idx, label, round(_num(sold.get("rate")), 2)
                )
            )
            continue
        if stock_units(kid) > _num(sold.get("units")) + QTY_TOLERANCE:
            errors.append(
                t("Line {0} ({1}) returns more than the paquete sold.").format(idx, label)
            )
    return errors
