# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class POSComboGroup(Document):
    """One choice a combo asks for — «elige tu bebida».

    The rules (min/max, which options belong) are validated on the parent
    `POS Combo`, because they only make sense against the whole combo: a group
    with no options is fine while an Item Group feeds it, and the options that
    name it live in a sibling table.
    """

    pass
