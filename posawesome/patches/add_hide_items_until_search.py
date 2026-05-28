"""Add `posa_hide_items_until_search` Check field on POS Profile.

Use case: convenience stores that operate barcode-first. The operator
never browses the catalogue — every sale is a scan. The items grid is
visual noise that overwhelms non-tech salespeople. With the flag ON,
the grid stays empty until the operator types or scans (which fills
the search input). Behaviour matches: cart empty + scan barcode = item
appears in cart directly via the existing barcode-resolve path.

Default OFF — full opt-in, zero behaviour change for current
operators.
"""

import frappe


def execute() -> None:
    if frappe.db.exists("Custom Field", "POS Profile-posa_hide_items_until_search"):
        return
    frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "POS Profile",
            "fieldname": "posa_hide_items_until_search",
            "fieldtype": "Check",
            "label": "Hide items list until search/scan",
            "description": (
                "Barcode-first mode. Items grid stays empty until the operator "
                "types in the search box or scans. Reduces visual clutter for "
                "non-tech salespeople in convenience-store layouts."
            ),
            "insert_after": "posa_hide_variants_items",
            "default": "0",
        }
    ).insert()
