import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


FIELDS = [
    {
        "fieldname": "posa_use_gift_cards",
        "label": "Use Gift Cards",
        "fieldtype": "Check",
        "default": "0",
        "insert_after": "use_customer_credit",
    },
    # posa_allow_supervisor_manage_gift_cards removed 2026-07-11 (dead —
    # superseded by the POS Awesome Supervisor ROLE gate in gift_cards.py;
    # see remove_dead_pos_profile_fields + POS-PROFILE-SPEC P1). This patch
    # runs on EVERY migrate (after_migrate), so keeping it here would
    # resurrect the field after removal.
    {
        "fieldname": "posa_gift_card_liability_account",
        "label": "Gift Card Liability Account",
        "fieldtype": "Link",
        "options": "Account",
        "depends_on": "eval:doc.posa_use_gift_cards==1",
        "insert_after": "posa_use_gift_cards",
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
