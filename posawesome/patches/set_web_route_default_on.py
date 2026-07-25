import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


# 2026-07-24: the /posapp SPA is the default boot path, not an opt-in.
# `posa_use_web_route` shipped with default 0 while `page/posapp/posapp.js`
# bounces every /app/posapp hit back to /posapp — so a profile that never got
# the flag toggled put its cashiers in a /posapp ↔ /app/posapp redirect loop.
# Flip the schema default ON and backfill every existing profile; the flag now
# reads as an explicit per-shop opt-OUT (see api/utilities.py
# posa_user_opted_into_web_route + www/posapp.py).
FIELD = {
    "fieldname": "posa_use_web_route",
    "label": "Use Web Route (/posapp) — uncheck to fall back to Desk shell",
    "fieldtype": "Check",
    "default": "1",
    "description": (
        "ON (default): mount the SPA at /posapp (web route). Cuts baseline DOM ~60% on "
        "slow devices. Uncheck on EVERY profile a user belongs to as a rollback — that "
        "user then boots the legacy Desk shell at /app/posapp?legacy=1."
    ),
    "insert_after": "posa_use_server_cache",
}


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
                "default": FIELD["default"],
                "description": FIELD["description"],
                "insert_after": FIELD["insert_after"],
            },
            update_modified=False,
        )

    # Schema defaults only apply to NEW rows. Existing profiles sitting at 0
    # were never a deliberate rollback (the rollback path was broken) — turn
    # them on so no cashier keeps looping. Reversible per profile from Desk.
    frappe.db.sql("""update `tabPOS Profile` set posa_use_web_route = 1""")
