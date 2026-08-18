"""Add `posa_ux_keymap_id` Data field on POS Profile.

The per-register half of the shortcuts engine (roadmap §17.3): a capability
preset names the keymap its mode teaches, and a register may replace it —
one terminal in a shop migrating from another POS can run that vendor's
layout while the rest stay on muelle-default.

Blank means "use the mode's pack", which itself falls back to
muelle-default. Nothing here can change what an action DOES; a keymap moves
keys only, so a wrong value costs a cashier a keystroke, never a wrong sale.
"""

import frappe


def execute() -> None:
    if frappe.db.exists("Custom Field", "POS Profile-posa_ux_keymap_id"):
        return
    frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "POS Profile",
            "fieldname": "posa_ux_keymap_id",
            "fieldtype": "Data",
            "label": "Keymap",
            "description": (
                "Keyboard layout pack for this register. Blank = the mode's "
                "pack (muelle-default unless the capability preset names "
                "another). Moves keys only — never what an action does."
            ),
            "insert_after": "posa_hide_items_until_search",
        }
    ).insert()
