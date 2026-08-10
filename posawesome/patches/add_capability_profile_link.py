"""Link a POS Profile to a POS Capability Profile preset (M3).

Nullable by design: a profile with no link resolves to the frontend's
retail-phones default (VERTICAL_PROFILES_PLAN.md C12), so every existing
tenant keeps working with zero data change. No backfill here — presets and
per-tenant assignment come later, gated separately.
"""

import frappe


def execute() -> None:
    if frappe.db.exists("Custom Field", "POS Profile-posa_capability_profile"):
        return
    frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "POS Profile",
            "fieldname": "posa_capability_profile",
            "label": "Capability Profile",
            "fieldtype": "Link",
            "options": "POS Capability Profile",
            "insert_after": "posa_pos_awesome_settings",
            "description": (
                "Vertical layout + capability preset for this register. "
                "Empty = default retail layout."
            ),
        }
    ).insert()
