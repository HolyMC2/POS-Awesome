"""Add `posa_disable_update_prompt` Check field on POS Profile.

When ON, suppresses the auto "Update available — new changes are
ready to load" prompt during a sale. Operators can still manually
hard-refresh; this just stops the dialog from interrupting an
in-progress transaction. Useful for shops where salespeople get
confused by the prompt mid-sale.

Default OFF — opt-in.
"""

import frappe


def execute() -> None:
    if frappe.db.exists("Custom Field", "POS Profile-posa_disable_update_prompt"):
        return
    frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "POS Profile",
            "fieldname": "posa_disable_update_prompt",
            "fieldtype": "Check",
            "label": "Disable 'Update available' prompt",
            "description": (
                "Suppresses the auto in-app update prompt during a sale. "
                "Operator can still hard-refresh manually. Useful when "
                "the prompt confuses non-tech salespeople."
            ),
            "insert_after": "posa_lean_wizard_layout",
            "default": "0",
        }
    ).insert()
