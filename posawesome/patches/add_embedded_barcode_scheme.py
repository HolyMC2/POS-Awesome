import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


# What the five measurement digits on a labelling scale's EAN-13 label mean.
# There is no third option and no auto-detect: 00312 is 0.312 kg under one
# scheme and $3.12 under the other, and a register that guessed would mis-charge
# by two orders of magnitude on a label it read perfectly. Blank — the default —
# means this register has no labelling scale, and a 20-25 code stays an ordinary
# barcode exactly as it was before the field existed.
#
# The prefix range is NOT configurable. 20-25 is GS1's reserved band for
# restricted circulation within one company; a scale that prints outside it is
# minting codes that collide with real GS1 assignments, and the fix for that is
# the scale's settings, not a POS Profile knob.
#
# The `posa_gr_` prefix is granel — the giro that weighs (abarrotes, carnicería,
# ferretería a granel). Custom Fields are globally unique per site as
# {dt}-{fieldname} with last-writer-wins and no warning, so every new field
# takes the prefix of the vertical that owns it; `scripts/check_fixture_coverage.py`
# enforces it and its VERTICAL_PREFIXES tuple gained `posa_gr_` with this round.
FIELD = {
    "fieldname": "posa_gr_embedded_barcode_scheme",
    "label": "Embedded Barcode Scheme",
    "fieldtype": "Select",
    "options": "\nweight\nprice",
    "default": "",
    "description": (
        "Labelling-scale barcodes (EAN-13 prefixes 20-25): item short code plus five "
        "digits that mean grams under «weight» or centavos under «price». Leave blank "
        "if this register has no labelling scale."
    ),
    "insert_after": "posa_camera_scan_type",
}


# Dead on arrival. It shipped in the 2020 upstream fixture as an Int («Scale
# Barcode Start With», default 221) and has never had a single reader: the scale
# parser in `item_processing/barcode.py` takes its prefix from the Scale Barcode
# Settings single doctype, and the SPA takes its own from that same payload. An
# operator could type any number into it, on any register, and change nothing —
# which is worse than a missing feature, because the register looked configured.
#
# LEGACY-FIELD-INVENTORY §5.5 slated it for removal; the field above is what
# actually answers the question it appeared to ask.
DEAD_FIELD = "posa_scale_barcode_start"


def execute():
    cf_name = f"POS Profile-{FIELD['fieldname']}"
    if not frappe.db.exists("Custom Field", cf_name):
        create_custom_field("POS Profile", FIELD)
    else:
        frappe.db.set_value(
            "Custom Field",
            cf_name,
            {
                "label": FIELD["label"],
                "fieldtype": FIELD["fieldtype"],
                "options": FIELD["options"],
                "default": FIELD["default"],
                "description": FIELD["description"],
                "insert_after": FIELD["insert_after"],
            },
            update_modified=False,
        )

    dead_name = f"POS Profile-{DEAD_FIELD}"
    if frappe.db.exists("Custom Field", dead_name):
        frappe.delete_doc("Custom Field", dead_name, force=True, ignore_permissions=True)

    frappe.clear_cache(doctype="POS Profile")
