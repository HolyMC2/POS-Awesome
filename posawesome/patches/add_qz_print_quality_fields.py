"""Add QZ Tray rasterizer-quality fields to POS Profile.

Per docs/QZ-BUNDLE-SCOPE.md the print "stripes / banding" pathology is
caused by QZ rasterizing HTML at ~150 DPI then nearest-neighbor scaling
to the printer's native DPI (203 on most thermal receipts). Adding a
per-tenant choice via POS Profile lets operators A/B `bicubic` vs
`nearest-neighbor` + tune `density` without code redeploy.

Fields added:
  - posa_qz_interpolation (Select) — rasterizer algorithm
  - posa_qz_density (Int)          — output DPI to match printer

Both are optional; the frontend (`services/qzTray.ts`) falls back to
the legacy `nearest-neighbor` + QZ auto-density when the fields are
blank, so this patch is backward-compatible on sites that never set
them.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


_FIELDS = (
    {
        "fieldname": "posa_qz_interpolation",
        "fieldtype": "Select",
        "label": "QZ Print Interpolation",
        "options": "\nnearest-neighbor\nbilinear\nbicubic",
        "insert_after": "posa_silent_print",
        "description": (
            "Rasterizer interpolation hint sent to QZ Tray. Default "
            "<code>nearest-neighbor</code> can cause banding on 203 DPI "
            "thermal printers; try <code>bicubic</code> if receipts show "
            "stripes. Blank = legacy nearest-neighbor."
        ),
    },
    {
        "fieldname": "posa_qz_density",
        "fieldtype": "Int",
        "label": "QZ Print Density (DPI)",
        "insert_after": "posa_qz_interpolation",
        "description": (
            "Output DPI for the QZ Tray print job. Set to the printer's "
            "native DPI (e.g. 203 for most thermal receipts) to avoid "
            "scaling artefacts. Blank = QZ auto-detect."
        ),
    },
)


def execute():
    for spec in _FIELDS:
        # `create_custom_field` is idempotent: it checks for an existing
        # field with the same (dt, fieldname) and skips if present.
        create_custom_field("POS Profile", spec)
    frappe.db.commit()
