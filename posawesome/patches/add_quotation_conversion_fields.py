"""Fields that make a cotización → venta conversion a FACT, not a guess.

ERPNext maps a Quotation onto a Sales Invoice (`make_sales_invoice`) but keeps
no link afterwards: `Sales Invoice Item` has `sales_order`, never `quotation`,
and `Quotation.status` is derived from Sales ORDERS only (`get_ordered_status`
counts `Sales Order Item.prevdoc_docname`), so "Ordered" can never be reached
through an invoice and writing it by hand is undone by the next `validate`.
The fork's own document-flow seam carries `flow_context.source_links.quotation`
to the browser and stops there — nothing posts it back — so before these fields
a converted quotation was indistinguishable from an open one.

Five fields, three jobs:

* `Sales Invoice/POS Invoice.posa_quotation` — the invoice says which promise
  it honours. Written server-side by `load_quotation_for_sale` onto the DRAFT,
  so the cart never has to carry it and cannot drop it.
* `Quotation.posa_converted_invoice` + `…_doctype` — the quotation says which
  sale closed it. Two plain Data fields rather than one Link because the target
  is `Sales Invoice` on most registers and `POS Invoice` where
  `create_pos_invoice_instead_of_sales_invoice` is on; a Link cannot point at
  either and a Dynamic Link would need its own options field anyway.
* `Quotation.posa_pos_profile` + `posa_note` — which register wrote it, and the
  cashier's line about it («apartan con el 30 %; confirman color sábado»).
  ERPNext's `terms` is a Terms and Conditions field that prints as such; a note
  to the next cashier is not a term of sale.

Idempotent, and re-runnable: existing fields are updated in place rather than
skipped, so a label fix ships without a second patch.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

_INVOICE_LINK = {
    "fieldname": "posa_quotation",
    "label": "Quotation",
    "fieldtype": "Link",
    "options": "Quotation",
    "insert_after": "posa_notes",
    "read_only": 1,
    "no_copy": 1,
    "print_hide_if_no_value": 1,
}

FIELDS_BY_DOCTYPE = {
    "Sales Invoice": [dict(_INVOICE_LINK)],
    "POS Invoice": [dict(_INVOICE_LINK)],
    "Quotation": [
        {
            "fieldname": "posa_converted_invoice",
            "label": "Converted Invoice",
            "fieldtype": "Data",
            "insert_after": "status",
            "read_only": 1,
            "no_copy": 1,
            "print_hide_if_no_value": 1,
        },
        {
            "fieldname": "posa_converted_invoice_doctype",
            "label": "Converted Invoice Type",
            "fieldtype": "Data",
            "insert_after": "posa_converted_invoice",
            "read_only": 1,
            "no_copy": 1,
            "print_hide_if_no_value": 1,
        },
        {
            "fieldname": "posa_pos_profile",
            "label": "POS Profile",
            "fieldtype": "Link",
            "options": "POS Profile",
            "insert_after": "posa_converted_invoice_doctype",
            "read_only": 1,
            "no_copy": 1,
            "print_hide_if_no_value": 1,
        },
        {
            "fieldname": "posa_note",
            "label": "POS Note",
            "fieldtype": "Small Text",
            "insert_after": "posa_pos_profile",
            "no_copy": 1,
            "print_hide_if_no_value": 1,
        },
    ],
    "POS Profile": [
        {
            "fieldname": "posa_quotation_validity_days",
            "label": "Quotation Validity (Days)",
            "fieldtype": "Int",
            "insert_after": "custom_allow_create_quotation",
            "default": "7",
            "depends_on": "eval:doc.custom_allow_create_quotation",
            "description": (
                "Default days a quotation saved from the cart stays valid. "
                "The cashier can change it per quote."
            ),
        },
    ],
}

_UPDATABLE = (
    "label",
    "fieldtype",
    "options",
    "insert_after",
    "read_only",
    "no_copy",
    "print_hide_if_no_value",
    "depends_on",
    "description",
)


def execute():
    for doctype, fields in FIELDS_BY_DOCTYPE.items():
        if not frappe.db.exists("DocType", doctype):
            # `POS Invoice` is absent on sites that never enabled it. Nothing to
            # stamp there, and nothing reads the field on such a site either.
            continue
        for field in fields:
            custom_field_name = f"{doctype}-{field['fieldname']}"
            if not frappe.db.exists("Custom Field", custom_field_name):
                create_custom_field(doctype, dict(field))
                continue
            frappe.db.set_value(
                "Custom Field",
                custom_field_name,
                {key: field[key] for key in _UPDATABLE if key in field},
                update_modified=False,
            )
        frappe.clear_cache(doctype=doctype)
