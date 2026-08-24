import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


# Tarjeta de cliente — the register's own cashback/monedero surface.
# `posa_use_customer_cards` gates the whole thing (view, deposit, enrolment,
# the Cobro accrual line); `posa_customer_card_program` names the ERPNext
# Loyalty Program a one-tap «Activar» enrols the customer into. Both are read
# SERVER-SIDE by stored_value.py — the flag is a gate, not a hint (the
# gift-cards P0-3 lesson).
#
# Sits beside the gift-card pair on purpose: the two tarjetas configure
# together even though they never merge into one figure.
FIELDS = [
    {
        "fieldname": "posa_use_customer_cards",
        "label": "Use Customer Cards",
        "fieldtype": "Check",
        "default": "0",
        "insert_after": "posa_gift_card_liability_account",
    },
    {
        "fieldname": "posa_customer_card_program",
        "label": "Customer Card Program",
        "fieldtype": "Link",
        "options": "Loyalty Program",
        "depends_on": "eval:doc.posa_use_customer_cards==1",
        "insert_after": "posa_use_customer_cards",
    },
]


def execute():
    for field in FIELDS:
        cf_name = f"POS Profile-{field['fieldname']}"
        if not frappe.db.exists("Custom Field", cf_name):
            create_custom_field("POS Profile", field)
        else:
            frappe.db.set_value(
                "Custom Field",
                cf_name,
                {
                    "label": field["label"],
                    "fieldtype": field["fieldtype"],
                    "default": field.get("default"),
                    "depends_on": field.get("depends_on"),
                    "options": field.get("options"),
                    "insert_after": field["insert_after"],
                },
                update_modified=False,
            )
    frappe.clear_cache(doctype="POS Profile")
