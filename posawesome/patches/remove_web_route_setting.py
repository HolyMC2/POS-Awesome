"""Retire the obsolete route switch without dropping stored profile columns."""

import frappe


FIELD = "posa_use_web_route"


def execute():
    # Reconnect fields that were placed after the retired control, including
    # tenant customizations. Removing Custom Field metadata leaves the old
    # SQL column intact for a reversible release.
    for name in frappe.get_all(
        "Custom Field", filters={"dt": "POS Profile", "insert_after": FIELD}, pluck="name"
    ):
        frappe.db.set_value("Custom Field", name, "insert_after", "posa_use_server_cache")
    for name in frappe.get_all(
        "Property Setter", filters={"doc_type": "POS Profile", "field_name": FIELD}, pluck="name"
    ):
        frappe.delete_doc("Property Setter", name, ignore_permissions=True)
    name = f"POS Profile-{FIELD}"
    if frappe.db.exists("Custom Field", name):
        frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
    frappe.clear_cache(doctype="POS Profile")
