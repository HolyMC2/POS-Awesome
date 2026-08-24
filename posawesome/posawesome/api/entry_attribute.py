# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

"""The shop's ENTRY ATTRIBUTE — the one Item Attribute its catalogue is entered by.

A phone shop's customer does not arrive asking for a case; they arrive with a
phone. The storefront already models exactly that and has for a while:
``Storefront Profile.entry_attribute`` names ONE ``Item Attribute`` (on
docomexico: «Modelos Celulares»), the shop's sellable variants carry a value
for it («Samsung A01», «iPhone 13»), and ``storefront/search.py`` uses it twice
— for the «compatible con …» typeahead group (``_search_compatible``) and for
the catalogue's entry selector, whose values come from
``_sellable_variants_of``'s ``{item_code: {attribute: value}}`` map.

The register had no equivalent. ``combos/browseCompatibility.ts`` wrote the gap
down in as many words: "No Item field links a loose accessory to the devices it
fits". That was true of posawesome and false of the tenant — the relation
exists, on the storefront's side of the house, authored by the same merchant.
This module is the bridge, and it is deliberately the whole bridge: every
posawesome surface that wants to know "which device is this item for?" asks
here, so there is one answer and one resolution rule.

WHAT IT IS NOT. It does not import doco, does not require it, and does not
create anything. ``Storefront Profile`` absent, disabled, or naming no
attribute all mean the same thing — the feature is not configured, callers get
``None`` and behave exactly as they did before this module existed.
"""

import frappe

#: Field on the POS-facing item rows that carries an item's value for the
#: shop's entry attribute. Named once here because three wire paths write it
#: and the client reads it; a silent divergence would look like "compatibility
#: doesn't work" rather than like a typo.
ENTRY_ATTRIBUTE_VALUE_FIELD = "entry_attribute_value"

#: Columns the resolution reads. Checked rather than assumed: ``Storefront
#: Profile`` belongs to another app, and a tenant on an older doco has a row
#: without ``entry_attribute`` — asking for a column that is not there is a
#: SQL error on the item catalogue's hot path, which is not a price worth
#: paying for an optional presentation hint.
_REQUIRED_COLUMNS = ("enabled", "company", "entry_attribute")

_MEMO_ATTR = "_posa_entry_attribute"


def _memo():
    """Per-REQUEST memo, or None when there is no request to hang it on.

    ``frappe.local`` is reset per request, so this cannot serve a stale answer
    across a back-office edit — the merchant who names an entry attribute sees
    it on the register's next call, not five minutes later. Within one request
    it matters: ``get_items`` pages the catalogue and every page would
    otherwise re-resolve the same profile.
    """
    local = getattr(frappe, "local", None)
    if local is None:
        return None
    cache = getattr(local, _MEMO_ATTR, None)
    if cache is None:
        cache = {}
        try:
            setattr(local, _MEMO_ATTR, cache)
        except Exception:  # pragma: no cover - a `local` that refuses attributes
            return None
    return cache


def _resolve(company=None):
    if not frappe.db.exists("DocType", "Storefront Profile"):
        return None
    for column in _REQUIRED_COLUMNS:
        if not frappe.db.has_column("Storefront Profile", column):
            return None

    filters = {"enabled": 1, "entry_attribute": ["is", "set"]}
    # A register belongs to a company, and so does a storefront. Joining on it
    # is the only honest link the two have: ``storefront._profile`` resolves by
    # an explicit profile NAME (the URL says which shop), and the POS has no
    # such name to pass. Borrowing another company's attribute on a
    # multi-company site would offer one tenant's accessories against another
    # tenant's device list, so a company that names none simply has none.
    if company:
        filters["company"] = company

    # Oldest first, so two profiles for one company give a STABLE answer rather
    # than one that follows whichever row was edited last. A shop that runs two
    # storefronts entered by different attributes is out of scope on purpose:
    # the register has one catalogue, so it can have one entry.
    rows = frappe.get_all(
        "Storefront Profile",
        filters=filters,
        fields=["entry_attribute"],
        order_by="creation asc",
        limit=1,
    )
    if not rows:
        return None
    return rows[0].get("entry_attribute") or None


def entry_attribute(company=None):
    """The Item Attribute this company's shop enters its catalogue by, or None.

    None is the ordinary answer, not an error: most tenants run no storefront,
    and every caller treats it as "this feature is not configured".
    """
    key = str(company or "")
    memo = _memo()
    if memo is not None and key in memo:
        return memo[key]
    value = _resolve(company)
    if memo is not None:
        memo[key] = value
    return value


def entry_attributes():
    """Every entry attribute any enabled storefront on this site names.

    The register resolves ONE (by its company); this is for the places that
    have no company to resolve by — `POS Combo`, which is an overlay on a
    company-less bundle. Distinct, in profile order, possibly empty.
    """
    if not frappe.db.exists("DocType", "Storefront Profile"):
        return []
    for column in _REQUIRED_COLUMNS:
        if not frappe.db.has_column("Storefront Profile", column):
            return []

    seen = []
    for row in frappe.get_all(
        "Storefront Profile",
        filters={"enabled": 1, "entry_attribute": ["is", "set"]},
        fields=["entry_attribute"],
        order_by="creation asc",
    ):
        value = row.get("entry_attribute")
        if value and value not in seen:
            seen.append(value)
    return seen


def entry_attribute_values(item_codes, attribute):
    """``{item_code: value}`` for the given items, for ONE attribute.

    Mirrors ``storefront/_cards.py::_variant_attr_map`` — same doctype, same
    ``parenttype`` filter — narrowed to the single attribute the caller asked
    about, because the register needs one fact per item and not the item's
    whole attribute sheet.

    Templates are absent from the result by construction: an ``Item Variant
    Attribute`` row on a template declares WHICH attribute its variants vary by
    and carries no value, and a blank value is not a device.
    """
    codes = [str(code) for code in (item_codes or []) if code]
    if not codes or not attribute:
        return {}

    rows = frappe.get_all(
        "Item Variant Attribute",
        filters={"parent": ["in", codes], "parenttype": "Item", "attribute": attribute},
        fields=["parent", "attribute_value"],
    )
    return {
        row["parent"]: row["attribute_value"]
        for row in rows
        if row.get("parent") and (row.get("attribute_value") or "").strip()
    }


def entry_attribute_value_map(item_codes, company=None):
    """The map every item wire path wants: resolve the attribute, then read it.

    Returns ``(attribute, {item_code: value})``. ``(None, {})`` when the shop
    configured no entry attribute, which is the shape a caller must handle
    anyway and costs exactly one cheap existence check to reach.
    """
    attribute = entry_attribute(company)
    if not attribute:
        return None, {}
    return attribute, entry_attribute_values(item_codes, attribute)


def attribute_values(attribute):
    """Every authored value of one Item Attribute, in the merchant's own order.

    Used to refuse a typo'd target on ``POS Combo``: a value that is not in the
    attribute's list can never match a cart line, and a combo that silently
    never appears is the hardest kind of misconfiguration to notice.
    """
    if not attribute:
        return []
    return frappe.get_all(
        "Item Attribute Value",
        filters={"parent": attribute, "parenttype": "Item Attribute"},
        pluck="attribute_value",
        order_by="idx asc",
    )
