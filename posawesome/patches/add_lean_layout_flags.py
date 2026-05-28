"""POS Profile flags for layout-simplification mocks.

`posa_lean_vertical_layout` (B mock) — stacks the cart below the
selector, vuelve la UI single-column. Tablet-vertical / mobile-first.

`posa_lean_wizard_layout` (C mock) — wizard step indicator + larger
pay button. Anti-overwhelm para dueños sin experiencia previa en POS.

Both default OFF — full opt-in, mutually exclusive with
`posa_hide_items_until_search` only at semantic level (operators
can mix, but lean modes already imply hidden-by-default catalog).
"""

import frappe


def execute() -> None:
    fields = [
        {
            "fieldname": "posa_lean_vertical_layout",
            "label": "Lean: single-column / vertical layout",
            "description": (
                "Stack cart below the selector. Tablet-vertical / mobile-first "
                "UI. Hides item-group chips + sales person + extras toolbar."
            ),
            "insert_after": "posa_hide_items_until_search",
        },
        {
            "fieldname": "posa_lean_wizard_layout",
            "label": "Lean: wizard / step-by-step flow",
            "description": (
                "Wizard-style operator flow: 1) add → 2) review → 3) pay. "
                "Larger touch targets, one decision per screen."
            ),
            "insert_after": "posa_lean_vertical_layout",
        },
    ]
    for f in fields:
        if frappe.db.exists("Custom Field", f"POS Profile-{f['fieldname']}"):
            continue
        frappe.get_doc(
            {
                "doctype": "Custom Field",
                "dt": "POS Profile",
                "fieldtype": "Check",
                "default": "0",
                **f,
            }
        ).insert()
