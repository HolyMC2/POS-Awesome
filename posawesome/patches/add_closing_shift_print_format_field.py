"""Add per-POS-Profile selector for the POS Closing Shift print format.

Operators close their cash drawer at the end of the shift. The
existing flow saves + submits the POS Closing Shift but never prints
a paper ticket — they have to navigate to the doc in Desk and click
"Print" manually, which on touchscreen POS terminals is friction.

This patch adds `posa_closing_shift_print_format` (Link → Print
Format) on POS Profile. When set, the SPA dispatches a QZ Tray print
job for the submitted closing shift using the chosen format, on the
same printer pinned via `posa_qz_printer_name`. When unset, no print
fires (preserves existing behavior for profiles that don't want
auto-print).

Companion patch `add_default_closing_shift_print_format.py` ships a
ready-to-use ESC/POS-friendly "POSA Cierre de Caja" format that
operators can pick here. They can also point at any other format
that targets POS Closing Shift.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


_FIELD = {
    "fieldname": "posa_closing_shift_print_format",
    "label": "Closing Shift Print Format",
    "fieldtype": "Link",
    "options": "Print Format",
    # Slot after the QZ tray fields so all auto-print settings cluster
    # together on the POS Profile form. `posa_qz_cut_after_print` is
    # the last QZ field after the Q11 patch landed.
    "insert_after": "posa_qz_cut_after_print",
    "description": (
        "Auto-print this format on the QZ Tray printer right after "
        "the operator submits a POS Closing Shift. Format must "
        "target the <code>POS Closing Shift</code> doctype. Leave "
        "blank to skip auto-print (operator can still print from "
        "Desk)."
    ),
}


def execute():
    # Idempotent: `create_custom_field` no-ops when the field already
    # exists; safe to re-run after future schema migrations.
    create_custom_field("POS Profile", _FIELD)
    frappe.db.commit()
