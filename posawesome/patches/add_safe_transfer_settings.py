import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    """POS Profile settings for POS Safe Transfer (safe -> bank deposits).

    Mirrors add_pos_cash_movement_settings: idempotent create_custom_field
    loop, fields hang off the existing cash-movement section. A
    `posa_cash_in_transit_account` field is deliberately NOT added yet —
    phase 2 would introduce two-step transit accounting.
    """
    fields = [
        {
            "fieldname": "posa_enable_safe_transfer",
            "label": "Enable Safe Transfer",
            "fieldtype": "Check",
            "default": "0",
            "depends_on": "eval:doc.posa_enable_cash_movement==1",
            "insert_after": "posa_cash_movement_max_amount",
        },
        {
            "fieldname": "posa_bank_deposit_account",
            "label": "Bank Deposit Account",
            "fieldtype": "Link",
            "options": "Account",
            "depends_on": "eval:doc.posa_enable_safe_transfer==1",
            "insert_after": "posa_enable_safe_transfer",
        },
        {
            "fieldname": "posa_safe_transfer_max_amount",
            "label": "Safe Transfer Max Amount",
            "fieldtype": "Currency",
            "options": "Company:company:default_currency",
            "depends_on": "eval:doc.posa_enable_safe_transfer==1",
            "insert_after": "posa_bank_deposit_account",
        },
    ]

    for field in fields:
        custom_field_name = f"POS Profile-{field['fieldname']}"
        if not frappe.db.exists("Custom Field", custom_field_name):
            create_custom_field("POS Profile", field)
