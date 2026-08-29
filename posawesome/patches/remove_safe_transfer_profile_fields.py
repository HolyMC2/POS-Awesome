"""Remove the safe-transfer POS Profile fields — a feature with no surface.

2026-08-29 settings audit: `posa_enable_safe_transfer`,
`posa_bank_deposit_account` and `posa_safe_transfer_max_amount` gate the
five whitelisted endpoints in ``api/safe_transfer/service.py`` — and nothing
in the SPA ever calls them (``rg 'safe.?transfer' frontend/src`` = zero
hits). The toggles enabled a path no cashier could reach, and no tenant
ever set them (all profiles 0/None, zero POS Safe Transfer documents).

The endpoints stay: they read the fields via ``profile.get(...)``, so with
the columns gone they refuse cleanly ("Safe transfers are not enabled…").
The ``POS Safe Transfer`` doctype and its Desk path are untouched — that
path validates against ``posa_back_office_cash_account`` (a cash-movement
field, which stays).

Same shape as remove_dead_pos_profile_fields. Registered in after_migrate
because install_app marks patches.txt entries done without running them,
and the companion creator (add_safe_transfer_settings, now deleted) lived
in after_migrate too — a lab site that migrated recently has the fields
and needs the removal to actually run.
"""

import frappe

REMOVED_FIELDS = (
    "posa_enable_safe_transfer",
    "posa_bank_deposit_account",
    "posa_safe_transfer_max_amount",
)


def execute():
    for fieldname in REMOVED_FIELDS:
        name = f"POS Profile-{fieldname}"
        if frappe.db.exists("Custom Field", name):
            frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
    frappe.clear_cache(doctype="POS Profile")
