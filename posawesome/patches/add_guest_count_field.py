import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    if not frappe.db.exists("Custom Field", "Sales Invoice-posa_rt_guest_count"):
        create_custom_field(
            "Sales Invoice",
            {
                "fieldname": "posa_rt_guest_count",
                "label": "Guests",
                "fieldtype": "Int",
                "insert_after": "posa_rt_tab_name",
                "no_copy": 1,
                "in_standard_filter": 1,
                "non_negative": 1,
                "print_hide": 0,
            },
        )

    if not frappe.db.exists("Custom Field", "POS Invoice-posa_rt_guest_count"):
        create_custom_field(
            "POS Invoice",
            {
                "fieldname": "posa_rt_guest_count",
                "label": "Guests",
                "fieldtype": "Int",
                "insert_after": "posa_rt_tab_name",
                "no_copy": 1,
                "in_standard_filter": 1,
                "non_negative": 1,
                "print_hide": 0,
            },
        )
