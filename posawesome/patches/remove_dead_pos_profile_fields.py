import frappe


# POS-PROFILE-SPEC P1 (2026-07-11 wiring audit): these POS Profile custom
# fields have ZERO consumers anywhere in backend or SPA — they shipped in
# fixtures and rendered as dead knobs operators could flip with no effect.
# posa_allow_supervisor_manage_gift_cards was superseded by the supervisor
# ROLE gate in gift_cards.py.
DEAD_FIELDS = (
    "posa_allow_supervisor_manage_gift_cards",
    "posa_allow_zero_rated_items",
    "posa_apply_customer_discount",
    "posa_default_card_view",
    "posa_fetch_coupon",
    "posa_smart_reload_mode",
)


def execute():
    for fieldname in DEAD_FIELDS:
        name = f"POS Profile-{fieldname}"
        if frappe.db.exists("Custom Field", name):
            frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
    frappe.clear_cache(doctype="POS Profile")
