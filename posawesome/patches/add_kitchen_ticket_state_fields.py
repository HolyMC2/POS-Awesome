"""Give the kitchen ticket a service lifecycle (critique B3).

The durable ticket already exists — every fire persists a ``Doco Print
Batch`` with the frozen projection and a per-station print verdict. What it
never had is the state the KITCHEN moves it through: printed paper says
nothing about whether the food left the pass. These three fields are the
bump:

  * ``posa_rt_kitchen_state``  — "" (in service) or "Bumped".
  * ``posa_rt_bumped_at/by``   — when, and by whom.

They live on Doco's doctype but in posawesome's ``posa_rt_`` restaurant
space (C8): the batch is the shared spine, the SERVICE semantics are table
service's. The comandas board grows its «Servida» lane from the state, and
the KDS (critique D1) will press the same verb from the kitchen side —
``bump_kitchen_ticket`` is deliberately the only writer.

Guarded on the doctype existing: posawesome installs without doco on core
sites, and after_migrate reruns every migrate, so the fields self-heal the
first migrate after doco lands.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

FIELDS = [
    {
        "fieldname": "posa_rt_kitchen_state",
        "label": "Kitchen State",
        "fieldtype": "Select",
        "options": "\nBumped",
        "default": "",
        "insert_after": "failed_count",
        "read_only": 1,
        "description": (
            "Table-service lifecycle of this kitchen ticket. Empty = in "
            "service; Bumped = the kitchen marked it served. Written only "
            "by the register's bump/recall endpoints."
        ),
    },
    {
        "fieldname": "posa_rt_bumped_at",
        "label": "Bumped At",
        "fieldtype": "Datetime",
        "insert_after": "posa_rt_kitchen_state",
        "read_only": 1,
    },
    {
        "fieldname": "posa_rt_bumped_by",
        "label": "Bumped By",
        "fieldtype": "Link",
        "options": "User",
        "insert_after": "posa_rt_bumped_at",
        "read_only": 1,
    },
]


def execute():
    if not frappe.db.exists("DocType", "Doco Print Batch"):
        return
    for field in FIELDS:
        cf_name = f"Doco Print Batch-{field['fieldname']}"
        if not frappe.db.exists("Custom Field", cf_name):
            create_custom_field("Doco Print Batch", dict(field))
        else:
            frappe.db.set_value(
                "Custom Field",
                cf_name,
                {
                    "label": field["label"],
                    "fieldtype": field["fieldtype"],
                    "options": field.get("options"),
                    "default": field.get("default"),
                    "insert_after": field["insert_after"],
                    "read_only": field.get("read_only", 0),
                    "description": field.get("description"),
                },
                update_modified=False,
            )
    frappe.clear_cache(doctype="Doco Print Batch")
