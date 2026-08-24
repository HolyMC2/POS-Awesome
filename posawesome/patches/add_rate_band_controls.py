"""Fields behind the rate band on rate-edit-enabled registers.

`assert_rates_within_band` caps how far a typed rate may sit from the Item
Price. The cap was switched off wholesale in 23ca94e6 because a POS Profile
flag is too blunt an instrument: "cambiar pantalla" legitimately quotes 400
against a 150 price-list entry, so the whole register had to be exempted.

These fields put the exemption where the variability actually lives — on the
SKU (or its category) — and make the width tunable per till:

  * Item / Item Group ``posa_skip_rate_band``  → this SKU quotes any figure.
  * POS Profile ``posa_max_rate_change_pct``   → band half-width, default 20.
    0 reads as "not configured" (Frappe's Float column is NOT NULL DEFAULT 0,
    so every pre-existing profile reads 0) and falls back to 20; a NEGATIVE
    value is the deliberate per-register kill switch.

Runs from after_migrate, like the gift-card and customer-card settings
patches: install_app marks patches done without running them, so a fresh
install would otherwise never get these columns.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

_SKIP_FIELD = {
    "fieldname": "posa_skip_rate_band",
    "label": "Skip POS Rate Band",
    "fieldtype": "Check",
    "default": "0",
    "description": (
        "Variable-price item: the POS accepts any rate for it, even on "
        "registers that cap how far a typed rate may stray from the price "
        "list. For labour, quotes, and anything priced per job."
    ),
}

FIELDS = [
    ("Item", dict(_SKIP_FIELD, insert_after="max_discount")),
    ("Item Group", dict(_SKIP_FIELD, insert_after="is_group")),
    (
        "POS Profile",
        {
            "fieldname": "posa_max_rate_change_pct",
            "label": "Max Rate Change Percentage",
            "fieldtype": "Percent",
            "default": "20",
            "insert_after": "posa_allow_user_to_edit_rate",
            "depends_on": "eval:doc.posa_allow_user_to_edit_rate==1",
            "description": (
                "How far a typed rate may sit from the price list, in "
                "percent, on this register. Blank or 0 means the 20% "
                "default. Set a negative value to turn the cap off here. "
                "Items flagged Skip POS Rate Band ignore it entirely."
            ),
        },
    ),
]


def execute():
    for doctype, field in FIELDS:
        cf_name = f"{doctype}-{field['fieldname']}"
        if not frappe.db.exists("Custom Field", cf_name):
            create_custom_field(doctype, field)
        else:
            frappe.db.set_value(
                "Custom Field",
                cf_name,
                {
                    "label": field["label"],
                    "fieldtype": field["fieldtype"],
                    "default": field.get("default"),
                    "depends_on": field.get("depends_on"),
                    "description": field.get("description"),
                    "insert_after": field["insert_after"],
                },
                update_modified=False,
            )
        frappe.clear_cache(doctype=doctype)

    _flag_tip_item()


def _flag_tip_item():
    """The tip item is posawesome's own creation, not tenant catalogue data,
    and its rate is whatever the customer chose to leave. restaurant/tips.py
    keeps it out of the band today by asking that no Item Price ever exist for
    it — a convention one well-meaning price import breaks. Flag it instead.

    Matched on the item_code FIELD, not the docname: a Naming Series can
    rewrite one and leave the other (tips.py repairs that drift on settle).
    """
    from posawesome.posawesome.api.restaurant.tips import TIP_ITEM_CODE

    for name in frappe.get_all(
        "Item",
        filters={"item_code": TIP_ITEM_CODE},
        pluck="name",
    ):
        frappe.db.set_value(
            "Item", name, "posa_skip_rate_band", 1, update_modified=False
        )
