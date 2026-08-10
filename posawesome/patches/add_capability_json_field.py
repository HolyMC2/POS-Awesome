"""Hidden read-only field carrying the resolved capability payload (M3 fix).

stamp_capability_json set posa_capability_json as a plain attribute on the
POS Profile doc, but a non-docfield attribute is dropped by frappe's
as_dict() at the API boundary — so the resolved preset never reached the
SPA (dock tabs / layout stayed at the retail default). Making it a real
(hidden, read-only, no-copy) Custom Field means as_dict() serialises it. It
is NEVER persisted — stamp_capability_json only sets it on the fetched doc
for the opening response; the value is recomputed every open.
"""

import frappe


def execute() -> None:
    if frappe.db.exists("Custom Field", "POS Profile-posa_capability_json"):
        return
    frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "POS Profile",
            "fieldname": "posa_capability_json",
            "label": "Capability JSON (resolved)",
            "fieldtype": "Long Text",
            "insert_after": "posa_capability_profile",
            "hidden": 1,
            "read_only": 1,
            "no_copy": 1,
            "print_hide": 1,
            "description": "Resolved capability payload, recomputed per shift open. Do not edit.",
        }
    ).insert()
