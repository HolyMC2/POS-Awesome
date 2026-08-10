"""Drop the posa_capability_json field — superseded by the sibling-payload design.

An interim fix made posa_capability_json a hidden POS Profile field so the
resolved capability payload would serialise to the SPA. That was a workaround:
the payload now rides a SIBLING key of the opening response (plan C7's
intent), so no field on the profile is needed. Drop the orphan column on any
site that created it (never reached prod). No-op where the field is absent.
"""

import frappe


def execute() -> None:
    if frappe.db.exists("Custom Field", "POS Profile-posa_capability_json"):
        frappe.delete_doc(
            "Custom Field", "POS Profile-posa_capability_json", force=True, ignore_permissions=True
        )
