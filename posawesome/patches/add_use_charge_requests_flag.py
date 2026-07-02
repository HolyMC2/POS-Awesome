import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


# Pull-model billing: when ON (and the generic doco "POS Charge Request"
# doctype is installed), the POS shows external ready-to-charge requests
# (e.g. taller repair orders) and builds the invoice fresh in the cashier's
# own shift — replacing the old push-a-draft-into-a-guessed-shift flow.
FIELD = {
    "fieldname": "posa_use_charge_requests",
    "label": "Use POS Charge Requests",
    "fieldtype": "Check",
    "default": "0",
    "description": "Show external charge requests (repairs etc.) so cashiers can bill them in their own shift.",
    "insert_after": "posa_force_close_stale_shift",
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
                "description": FIELD["description"],
                "insert_after": FIELD["insert_after"],
            },
            update_modified=False,
        )
