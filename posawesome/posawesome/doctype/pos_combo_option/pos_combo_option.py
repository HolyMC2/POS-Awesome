# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class POSComboOption(Document):
    """One answer to a combo group — «Capuchino», «Latte +$10».

    `group_name` is a Select whose choices the parent's form script fills from
    the Groups table; the parent's `validate` is what enforces the match.
    """

    pass
