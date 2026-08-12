import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    for doctype in ("Sales Invoice", "POS Invoice"):
        name = f"{doctype}-posa_rt_tip_amount"
        if frappe.db.exists("Custom Field", name):
            continue
        create_custom_field(
            doctype,
            {
                "fieldname": "posa_rt_tip_amount",
                "label": "Tip Amount",
                "fieldtype": "Currency",
                "insert_after": "posa_rt_waiter",
                "hidden": 1,
                "no_copy": 1,
                "non_negative": 1,
            },
        )
