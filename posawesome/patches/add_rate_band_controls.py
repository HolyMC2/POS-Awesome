"""Fields behind the rate band on rate-edit-enabled registers.

`assert_rates_within_band` caps how far a typed rate may sit from the Item
Price. The cap was switched off wholesale in 23ca94e6 because a POS Profile
flag is too blunt an instrument: "cambiar pantalla" legitimately quotes 400
against a 150 price-list entry, so the whole register had to be exempted.

These fields put the exemption where the variability actually lives — on the
SKU (or its category) — and make the width tunable per till:

  * Item / Item Group ``posa_px_skip_rate_band`` → this SKU quotes any figure.
  * POS Profile ``posa_px_max_rate_change_pct``  → band half-width, default 20.
    0 reads as "not configured" (Frappe's Float column is NOT NULL DEFAULT 0,
    so every pre-existing profile reads 0) and falls back to 20; a NEGATIVE
    value is the deliberate per-register kill switch.

The ``posa_px_`` prefix is the pricing-controls space registered in
``scripts/check_fixture_coverage.py``: Custom Fields are keyed
``{dt}-{fieldname}`` and globally unique per site with last writer winning
silently, so ``posa_skip_rate_band`` on Item — a doctype the lab tenant already
shares with six-plus apps — is a name worth owning. An earlier build of this
patch shipped the unprefixed names to lab sites; ``_rename_legacy_fields``
below moves those rows (and the values on them) rather than leaving a site with
both columns and the flags on the wrong one.

Runs from after_migrate, like the gift-card and customer-card settings
patches: install_app marks patches done without running them, so a fresh
install would otherwise never get these columns.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

# old fieldname -> new fieldname, per doctype it was created on.
_RENAMES = (
    ("Item", "posa_skip_rate_band", "posa_px_skip_rate_band"),
    ("Item Group", "posa_skip_rate_band", "posa_px_skip_rate_band"),
    ("POS Profile", "posa_max_rate_change_pct", "posa_px_max_rate_change_pct"),
)

_SKIP_FIELD = {
    "fieldname": "posa_px_skip_rate_band",
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
            "fieldname": "posa_px_max_rate_change_pct",
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
    _rename_legacy_fields()

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


def _rename_legacy_fields():
    """Move a site that ran the unprefixed build onto the ``posa_px_`` names.

    Same shape as rename_pose_use_limit_search: rename the COLUMN so the values
    ride along (which SKUs a tenant flagged is knowledge nobody wants to
    re-enter), then rename the Custom Field row to the key the fixture now
    carries so sync updates it instead of shipping a duplicate.

    Runs before the create loop below, so a fresh site — where no old column
    exists — passes straight through and the fields are simply created.
    """
    for doctype, old, new in _RENAMES:
        table = f"tab{doctype}"
        has_old = frappe.db.has_column(doctype, old)
        has_new = frappe.db.has_column(doctype, new)
        if has_old and not has_new:
            frappe.db.sql_ddl(f"alter table `{table}` rename column `{old}` to `{new}`")
        elif has_old and has_new:
            # Defensive: a partial earlier run left both columns. The old one
            # is the one operators have been writing to, so it wins where the
            # new column is still at its zero default.
            frappe.db.sql(
                f"update `{table}` set `{new}` = `{old}` where ifnull(`{new}`, 0) = 0"
            )
            frappe.db.sql_ddl(f"alter table `{table}` drop column `{old}`")

        old_cf, new_cf = f"{doctype}-{old}", f"{doctype}-{new}"
        if frappe.db.exists("Custom Field", old_cf):
            if frappe.db.exists("Custom Field", new_cf):
                frappe.db.delete("Custom Field", {"name": old_cf})
            else:
                frappe.db.sql(
                    "update `tabCustom Field` set name = %s, fieldname = %s where name = %s",
                    (new_cf, new, old_cf),
                )

        # Site-local fields anchored to the old name follow it.
        frappe.db.sql(
            "update `tabCustom Field` set insert_after = %s where dt = %s and insert_after = %s",
            (new, doctype, old),
        )

        frappe.clear_cache(doctype=doctype)


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
            "Item", name, "posa_px_skip_rate_band", 1, update_modified=False
        )
