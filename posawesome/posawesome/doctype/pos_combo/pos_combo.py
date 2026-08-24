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
"""

import frappe
from frappe import _
from frappe.model.document import Document


class POSCombo(Document):
    def validate(self):
        self.validate_bundle_enabled()
        self.validate_targets_not_components()
        self.validate_attribute_targets()

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
