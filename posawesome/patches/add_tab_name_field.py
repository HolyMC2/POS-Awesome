import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    if not frappe.db.exists("Custom Field", "Sales Invoice-posa_rt_tab_name"):
        create_custom_field(
            "Sales Invoice",
            {
                "fieldname": "posa_rt_tab_name",
                "label": "Tab Name",
                "fieldtype": "Data",
                "insert_after": "customer",
                "no_copy": 1,
                "hidden": 1,
                # A customer's name on a cup is data, not vocabulary: a
                # translatable Data field routes through _() at print time and
                # a name colliding with a translation key prints wrong.
                "translatable": 0,
                "print_hide": 0,
            },
        )

    if not frappe.db.exists("Custom Field", "POS Invoice-posa_rt_tab_name"):
        create_custom_field(
            "POS Invoice",
            {
                "fieldname": "posa_rt_tab_name",
                "label": "Tab Name",
                "fieldtype": "Data",
                "insert_after": "customer",
                "no_copy": 1,
                "hidden": 1,
                "translatable": 0,
                "print_hide": 0,
            },
        )
