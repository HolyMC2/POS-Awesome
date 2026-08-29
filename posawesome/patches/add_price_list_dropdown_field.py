"""Ship the field the price-list selector has always been gated on.

The register's price-list dropdown (PostingDateRow / ItemsSelector) renders
only when the POS Profile carries ``posa_px_enable_price_list_dropdown`` — a
field no fixture or patch ever created, so the selector could not be turned
on anywhere: a whole feature dead behind a phantom column. The server side
now honours the flag too (``_resolve_effective_price_list`` stores the
switched list; ``_pricing_price_list`` draws the rate band around it), so
the field finally gets a real definition.

Runs from after_migrate, like the other POS Profile settings patches:
install_app marks patches done without running them, so a fresh install
would otherwise never get the column.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELD = {
    "fieldname": "posa_px_enable_price_list_dropdown",
    "label": "Show Price List Selector",
    "fieldtype": "Check",
    "default": "0",
    "insert_after": "posa_force_price_from_customer_price_list",
    "description": (
        "Lets the cashier switch the sale to any enabled selling price "
        "list (a credit or wholesale list, for example). Rates are then "
        "validated against the switched list. Off: each sale uses the "
        "customer's default price list, else the customer group's, else "
        "this profile's."
    ),
}


def execute():
    cf_name = f"POS Profile-{FIELD['fieldname']}"
    if not frappe.db.exists("Custom Field", cf_name):
        create_custom_field("POS Profile", FIELD)
    else:
        frappe.db.set_value(
            "Custom Field",
            cf_name,
            {
                "label": FIELD["label"],
                "fieldtype": FIELD["fieldtype"],
                "default": FIELD["default"],
                "insert_after": FIELD["insert_after"],
                "description": FIELD["description"],
            },
            update_modified=False,
        )
    frappe.clear_cache(doctype="POS Profile")
