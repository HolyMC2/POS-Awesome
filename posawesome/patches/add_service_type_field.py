import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

# Recorded service type on a held ticket (cafetería / restaurante vertical).
# Tax-by-service-type is intentionally NOT wired here — this only records the
# value for reporting and future kitchen routing.
_OPTIONS = "\nDine In\nTakeout\nDelivery"


def execute():
    for dt in ("Sales Invoice", "POS Invoice"):
        if not frappe.db.exists("Custom Field", f"{dt}-posa_rt_service_type"):
            create_custom_field(
                dt,
                {
                    "fieldname": "posa_rt_service_type",
                    "label": "Service Type",
                    "fieldtype": "Select",
                    "options": _OPTIONS,
                    "insert_after": "posa_rt_guest_count",
                    "no_copy": 1,
                    "in_standard_filter": 1,
                    "print_hide": 0,
                },
            )
