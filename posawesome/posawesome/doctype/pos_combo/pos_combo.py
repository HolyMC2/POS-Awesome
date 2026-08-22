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
