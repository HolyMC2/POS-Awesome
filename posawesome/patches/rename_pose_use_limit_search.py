import frappe


def execute():
    """Fix the `pose_use_limit_search` fieldname typo → `posa_use_limit_search`.

    POS-PROFILE-SPEC P2: the field worked but the `pose_` prefix made it
    invisible to every `posa_`-prefix tool and grep. Runs before fixture
    sync, so the Custom Field row is renamed in place (same name key the
    fixture now carries) and sync updates it instead of duplicating.
    """
    old, new = "pose_use_limit_search", "posa_use_limit_search"
    old_cf, new_cf = f"POS Profile-{old}", f"POS Profile-{new}"

    has_old = frappe.db.has_column("POS Profile", old)
    has_new = frappe.db.has_column("POS Profile", new)
    if has_old and not has_new:
        frappe.db.sql_ddl(f"alter table `tabPOS Profile` rename column `{old}` to `{new}`")
    elif has_old and has_new:
        # Defensive: partial earlier run left both columns.
        frappe.db.sql(f"update `tabPOS Profile` set `{new}` = `{old}` where ifnull(`{new}`, 0) = 0")
        frappe.db.sql_ddl(f"alter table `tabPOS Profile` drop column `{old}`")

    if frappe.db.exists("Custom Field", old_cf):
        if frappe.db.exists("Custom Field", new_cf):
            frappe.db.delete("Custom Field", {"name": old_cf})
        else:
            frappe.db.sql(
                "update `tabCustom Field` set name = %s, fieldname = %s where name = %s",
                (new_cf, new, old_cf),
            )

    # Anything still anchored to the old name (site-local fields) follows.
    frappe.db.sql(
        "update `tabCustom Field` set insert_after = %s where dt = 'POS Profile' and insert_after = %s",
        (new, old),
    )

    frappe.clear_cache(doctype="POS Profile")
