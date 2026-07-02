import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


# Default ON: selling into yesterday's shift silently corrupts the day's cash
# reconciliation. Shops that genuinely run overnight shifts can opt out per
# profile.
FIELD = {
    "fieldname": "posa_force_close_stale_shift",
    "label": "Force Closing Stale Shifts",
    "fieldtype": "Check",
    "default": "1",
    "description": "Block sales into a shift opened on a previous day until it is closed.",
    "insert_after": "posa_hide_closing_shift",
}


def execute():
    cf_name = f"POS Profile-{FIELD['fieldname']}"
    if not frappe.db.exists("Custom Field", cf_name):
        create_custom_field("POS Profile", FIELD)
        # create_custom_field only sets the schema default for NEW rows;
        # existing profiles get the flag ON explicitly (safe: pure gate,
        # reversible per profile).
        frappe.db.sql(
            """update `tabPOS Profile` set posa_force_close_stale_shift = 1"""
        )
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
