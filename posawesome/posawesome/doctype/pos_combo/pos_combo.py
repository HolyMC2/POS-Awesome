# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

"""POS presentation overlay for an ERPNext Product Bundle (roadmap §17.6).

This doctype deliberately holds NO component lines and NO price. Both already
exist on the substrate — `Product Bundle Item` for the components, `Item Price`
for what the combo sells for — and duplicating either would create a second
truth for money or stock.

It exists because the design asks two questions the substrate cannot answer:
which bundles a register shows in its Combos category, and which device each
combo is FOR, so the "se suele llevar junto" strip can filter by what the
customer is already buying.

"Which device" is expressible two ways and both are here, because neither
covers the other:

* `targets` names ITEMS. Exact, auditable, and the right shape for a shop with
  a dozen handsets on the shelf.
* `attribute_targets` names VALUES of the shop's entry attribute — the Item
  Attribute its `Storefront Profile` points at (see `api/entry_attribute.py`).
  One row, «Samsung A01», reaches every one of the 3 526 cases and 622 micas
  docomexico's catalogue already tags with that model. Naming those by item
  code is not merely tedious, it is a list that goes stale every time the
  merchant adds a colour.

It is OPTIONAL. A tenant with no POS Combo rows gets every enabled Product
Bundle offered as a combo; see `api/combos.py`. That way the feature works the
moment a bundle exists, and configuring it is a refinement rather than a
prerequisite.

A second TYPE lives here too: ``Choice Groups``, the cafetería paquete —
«Combo Desayuno: elige tu bebida, elige tu pan, incluye molletes». A Product
Bundle cannot say "one of these", so this record carries the groups and their
options itself, and the register sells ``combo_item`` at its own Item Price
with each picked item riding the ticket as its own line (priced 0, or at the
option's extra charge). Those lines are what move stock, route to the kitchen
and show in item reports; `api/combo_choice.py` vouches for their prices at
submit against THIS record, so a register cannot invent a $0 line.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt


BUNDLE_TYPE = "Product Bundle"
CHOICE_TYPE = "Choice Groups"


class POSCombo(Document):
    def is_choice(self) -> bool:
        # getattr: a record loaded before the column existed has no attribute.
        return (getattr(self, "combo_type", None) or BUNDLE_TYPE) == CHOICE_TYPE

    def before_naming(self):
        self.sync_combo_item_from_bundle()

    def autoname(self):
        """A paquete is named by the item it sells.

        Bundle combos keep the doctype's own rule (``field:product_bundle``):
        a Product Bundle is named after its ``new_item_code``, so both rules
        land on the same name and existing records never move.
        """
        if self.is_choice() and self.combo_item:
            self.name = self.combo_item

    def validate(self):
        self.combo_type = self.combo_type or BUNDLE_TYPE
        if self.is_choice():
            # A NULL, not "": the column is UNIQUE, and two paquetes with an
            # empty-string bundle would collide on it.
            self.product_bundle = None
            self.validate_choice_item()
            self.validate_choice_groups()
        else:
            self.validate_no_choice_rows()
            self.sync_combo_item_from_bundle()
            self.validate_bundle_enabled()
        self.validate_targets_not_components()
        self.validate_attribute_targets()

    def sync_combo_item_from_bundle(self):
        """A bundle combo sells its bundle's item; keep that on the record."""
        if self.is_choice() or not self.product_bundle:
            return
        item = frappe.db.get_value("Product Bundle", self.product_bundle, "new_item_code")
        if item:
            self.combo_item = item

    def validate_no_choice_rows(self):
        """Choice rows on a bundle combo would be silently ignored — say so."""
        if self.get("groups") or self.get("options"):
            frappe.throw(
                _(
                    "Groups and Options only apply to a Choice Groups combo. "
                    "Change the Combo Type or clear those tables."
                )
            )

    def validate_choice_item(self):
        """The item a paquete sells must be sellable and must not carry stock.

        The picked items are real lines and move their own stock. If the
        paquete's item were a stock item it would move stock too, and if it
        were a Product Bundle ERPNext would pack its components on top of the
        picked lines — the same coffee leaving the shelf twice.
        """
        if not self.combo_item:
            frappe.throw(_("Choose the item this paquete sells (Combo Item)."))
        item = frappe.db.get_value(
            "Item",
            self.combo_item,
            ["disabled", "is_sales_item", "is_stock_item", "has_variants"],
            as_dict=True,
        )
        if not item:
            frappe.throw(_("Item {0} does not exist.").format(self.combo_item))
        if item.disabled:
            frappe.throw(_("Item {0} is disabled.").format(self.combo_item))
        if not item.is_sales_item:
            frappe.throw(_("Item {0} is not a sales item.").format(self.combo_item))
        if item.has_variants:
            frappe.throw(
                _("{0} is a template with variants. Choose the item the register sells.").format(
                    self.combo_item
                )
            )
        if item.is_stock_item:
            frappe.throw(
                _(
                    "{0} is a stock item. A paquete's own item must be non-stock: "
                    "the picked items carry the stock."
                ).format(self.combo_item)
            )
        if frappe.db.exists("Product Bundle", {"new_item_code": self.combo_item, "disabled": 0}):
            frappe.throw(
                _(
                    "{0} is a Product Bundle. A paquete with choice groups cannot also be "
                    "a Product Bundle, or its stock would move twice."
                ).format(self.combo_item)
            )

    def validate_choice_groups(self):
        """Groups and options must describe a paquete the till can complete."""
        groups = list(self.get("groups") or [])
        if not groups:
            frappe.throw(_("Add at least one group, such as «Bebida» or «Pan»."))

        by_name = {}
        for row in groups:
            name = (row.group_name or "").strip()
            row.group_name = name
            if not name:
                frappe.throw(_("Row {0}: every group needs a name.").format(row.idx))
            key = name.casefold()
            if key in by_name:
                frappe.throw(_("Group {0} appears twice.").format(name))
            row.min_qty = cint(row.min_qty)
            row.max_qty = cint(row.max_qty)
            if row.max_qty < 1:
                frappe.throw(_("Group {0}: Max Picks must be at least 1.").format(name))
            if row.min_qty < 0 or row.min_qty > row.max_qty:
                frappe.throw(
                    _("Group {0}: Min Picks ({1}) must be between 0 and Max Picks ({2}).").format(
                        name, row.min_qty, row.max_qty
                    )
                )
            by_name[key] = row

        options = list(self.get("options") or [])
        items = {
            row.name: row
            for row in frappe.get_all(
                "Item",
                filters={"name": ["in", sorted({o.item_code for o in options if o.item_code})]},
                fields=["name", "disabled", "is_sales_item", "has_variants", "has_serial_no", "has_batch_no"],
            )
        } if options else {}
        bundles = set(
            frappe.get_all(
                "Product Bundle",
                filters={
                    "new_item_code": ["in", sorted({o.item_code for o in options if o.item_code})],
                    "disabled": 0,
                },
                pluck="new_item_code",
            )
            or []
        ) if options else set()

        seen = set()
        count_by_group = {}
        defaults_by_group = {}
        for row in options:
            group = by_name.get((row.group_name or "").strip().casefold())
            if not group:
                frappe.throw(
                    _("Options row {0}: group {1} is not in the Groups table.").format(
                        row.idx, row.group_name or "?"
                    )
                )
            row.group_name = group.group_name
            code = row.item_code
            item = items.get(code)
            if not item:
                frappe.throw(_("Options row {0}: item {1} does not exist.").format(row.idx, code))
            if code == self.combo_item:
                frappe.throw(_("Options row {0}: {1} is the paquete's own item.").format(row.idx, code))
            if item.disabled or not item.is_sales_item:
                frappe.throw(
                    _("Options row {0}: {1} is disabled or not a sales item.").format(row.idx, code)
                )
            if item.has_variants:
                frappe.throw(
                    _("Options row {0}: {1} is a template. Add the variant the customer can pick.").format(
                        row.idx, code
                    )
                )
            if item.has_serial_no or item.has_batch_no:
                frappe.throw(
                    _(
                        "Options row {0}: {1} is serial- or batch-tracked. Paquete options "
                        "cannot need a unit chosen at the till."
                    ).format(row.idx, code)
                )
            if code in bundles:
                frappe.throw(
                    _("Options row {0}: {1} is a Product Bundle and cannot be a paquete option.").format(
                        row.idx, code
                    )
                )
            if flt(row.qty) <= 0:
                frappe.throw(_("Options row {0}: Qty per Pick must be more than zero.").format(row.idx))
            if flt(row.extra_price) < 0:
                frappe.throw(_("Options row {0}: Extra Charge cannot be negative.").format(row.idx))
            key = (group.group_name, code)
            if key in seen:
                frappe.throw(
                    _("Options row {0}: {1} is listed twice in group {2}.").format(
                        row.idx, code, group.group_name
                    )
                )
            seen.add(key)
            count_by_group[group.group_name] = count_by_group.get(group.group_name, 0) + 1
            if cint(row.is_default):
                defaults_by_group[group.group_name] = defaults_by_group.get(group.group_name, 0) + 1

        for group in groups:
            if not count_by_group.get(group.group_name) and not group.item_group:
                frappe.throw(
                    _("Group {0} has no options. Add rows in Options or set Any Item From.").format(
                        group.group_name
                    )
                )
            defaults = defaults_by_group.get(group.group_name, 0)
            if defaults > group.max_qty:
                frappe.throw(
                    _("Group {0} preselects {1} options but allows only {2}.").format(
                        group.group_name, defaults, group.max_qty
                    )
                )

    def validate_bundle_enabled(self):
        """A disabled bundle cannot be sold, so presenting it is a dead end."""
        if not self.product_bundle:
            return
        if frappe.db.get_value("Product Bundle", self.product_bundle, "disabled"):
            frappe.throw(
                _("Product Bundle {0} is disabled and cannot be offered as a combo.").format(
                    self.product_bundle
                )
            )

    def validate_targets_not_components(self):
        """A combo must not target its own components.

        Targeting a component means the combo is suggested once that component
        is in the cart — which is exactly the sale the combo was supposed to
        replace. The operator ends up offered a bundle around something the
        customer already bought separately, at a discount that no longer
        applies to the line they have.
        """
        if not self.targets:
            return

        if self.is_choice():
            components = {row.item_code for row in (self.get("options") or []) if row.item_code}
        else:
            components = set(
                frappe.get_all(
                    "Product Bundle Item",
                    filters={"parent": self.product_bundle},
                    pluck="item_code",
                )
                or []
            )
        clashes = sorted({row.item_code for row in self.targets if row.item_code in components})
        if clashes:
            frappe.throw(
                _("A combo cannot target its own components: {0}").format(", ".join(clashes))
            )

    def validate_attribute_targets(self):
        """Tidy the device targets, and refuse one the shop cannot ever match.

        Two failures this closes, both of which look identical from the shop
        floor — the combo simply never appears, on any ticket, with nothing in
        any log to say why:

        1. A TYPO. «Samsung A1» is not «Samsung A01». No cart line will ever
           carry it, and because a combo with attribute targets is no longer
           universal, the row silently removes the combo from every register.
        2. A VALUE FROM ANOTHER ATTRIBUTE. «Rojo» is a real Item Attribute
           Value, just not one of «Modelos Celulares», so it matches nothing
           for the same reason.

        The check runs only when the shop's entry attribute RESOLVES. A tenant
        who authors combos before configuring a Storefront Profile — or who
        never runs one — keeps their rows; they are dead weight rather than a
        wrong answer, and refusing them would make this doctype depend on
        another app being set up first.
        """
        rows = list(getattr(self, "attribute_targets", None) or [])
        if not rows:
            return

        # Trim and de-duplicate in place: two rows saying «Samsung A01» are one
        # fact, and the payload the register reads should say it once.
        seen = set()
        kept = []
        for row in rows:
            value = (row.attribute_value or "").strip()
            if not value or value in seen:
                continue
            seen.add(value)
            row.attribute_value = value
            kept.append(row)
        if len(kept) != len(rows):
            self.attribute_targets = kept
            for index, row in enumerate(kept, start=1):
                row.idx = index

        from posawesome.posawesome.api.entry_attribute import (
            attribute_values,
            entry_attributes,
        )

        # EVERY enabled storefront's entry attribute, not just the one the
        # register would resolve. `POS Combo` carries no company — it is an
        # overlay on a bundle, and bundles are company-less — so a site running
        # two storefronts has no way to say which one a row meant. Accepting a
        # value any of them knows refuses typos without refusing the second
        # shop's legitimate models.
        attributes = entry_attributes()
        if not attributes:
            return

        known = set()
        for attribute in attributes:
            known.update(attribute_values(attribute))
        if not known:
            return
        unknown = sorted(value for value in seen if value not in known)
        if unknown:
            frappe.throw(
                _("{0} has no such value as {1}.").format(
                    ", ".join(attributes), ", ".join(unknown)
                )
            )
