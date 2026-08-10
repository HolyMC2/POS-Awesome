"""Remove the never-consumed posa_lean_wizard_layout flag (M5 decision).

Shipped 2026-06 in add_lean_layout_flags alongside posa_lean_vertical_layout
as a UI-mock placeholder. Its sibling got a real renderer in M1; this one
never did and there is no plan to build the wizard flow now. Per the
rehearsal-slice principle (implement or delete — VERTICAL_PROFILES_PLAN.md
C3), delete the dead admin-visible field rather than leave a toggle wired to
nothing. A future wizard layout, if built, becomes a capability preset, not
a resurrected flag.
"""

import frappe


def execute() -> None:
    name = "POS Profile-posa_lean_wizard_layout"
    if frappe.db.exists("Custom Field", name):
        frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
