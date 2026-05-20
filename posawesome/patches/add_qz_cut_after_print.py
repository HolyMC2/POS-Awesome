"""Add QZ Tray cut-after-print field to POS Profile.

Q11 — extends the QZ print-quality field set (`posa_qz_interpolation`,
`posa_qz_density`) with a Boolean that controls whether the SPA
appends an ESC/POS cut command after the rendered HTML raster.

Why: many CUPS PPD drivers for thermal printers don't auto-cut at end
of job (especially the "generic / text-only" driver path used when the
manufacturer PPD isn't installed). Operators report the receipt
prints fine but stays attached to the next ticket until they tear
it manually.

Frontend (`services/qzTray.ts`) reads this field; when truthy, it
appends a raw ESC/POS data segment to the print job. Default cut
command is GS V B 0 = partial cut with 1 line feed (safe across
Epson / Star / SNBC heads). Custom command can be sent per-call via
the `cutCommand` option for printers needing full cut or specific
feed-line count.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


_FIELDS = (
    {
        "fieldname": "posa_qz_cut_after_print",
        "fieldtype": "Check",
        "label": "QZ Append Cut Command",
        "insert_after": "posa_qz_density",
        "default": 0,
        "description": (
            "When checked, the SPA appends an ESC/POS cut command "
            "(<code>GS V B 0</code> = partial cut + 1 line feed) after "
            "the rendered HTML raster. Enable when the CUPS driver "
            "doesn't auto-cut between jobs. Blank = no cut command."
        ),
    },
)


def execute():
    for spec in _FIELDS:
        # Idempotent: `create_custom_field` no-ops when the field is
        # already registered.
        create_custom_field("POS Profile", spec)
    frappe.db.commit()
