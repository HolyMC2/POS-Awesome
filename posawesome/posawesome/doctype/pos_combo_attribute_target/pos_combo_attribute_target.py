# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class POSComboAttributeTarget(Document):
    """One device MODEL a combo is FOR, named by attribute value rather than by item.

    `POS Combo Target` names items and cannot scale: docomexico's catalogue
    carries 3 526 cases and 622 micas across 4 311 variants that already
    declare which phone they fit, and a combo for «Samsung A01» would have to
    list every one of them by code. This names the value instead — one row,
    every item that carries it.

    `Data` and not a `Link` because there is nothing to link to: an Item
    Attribute's values are its own child rows (`Item Attribute Value`), not
    documents. `POSCombo.validate_attribute_targets` refuses a value the shop's
    attribute does not actually carry, which is the check a Link would have
    given for free.
    """

    pass
