# Copyright (c) 2026, Doco Mexico and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class POSComboTarget(Document):
    """One device a combo is FOR — the phone a case+mica+instalación protects.

    A Link rather than free text so a renamed item cannot silently orphan the
    targeting and quietly stop the combo being suggested.
    """

    pass
