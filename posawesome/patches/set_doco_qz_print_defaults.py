"""Q7 — set sensible QZ rasterizer defaults on POS Profiles that
don't have them filled yet.

Doco's tenants run 203-DPI thermal receipt printers. The legacy
`nearest-neighbor` + QZ auto-density combo causes visible banding
("stripes") on those printers (see `docs/QZ-BUNDLE-SCOPE.md` §3).
Setting `bicubic` interpolation + `203` density as the default
fixes the banding without operator intervention.

This patch is conservative: it ONLY writes the default when the
field is currently blank / null / zero. Operators who have
explicitly tuned their POS Profile (e.g. set `bilinear` for a
non-thermal printer) keep their choice.

Idempotent — re-running the patch is a no-op for sites that
already have the fields filled.
"""

import frappe


def execute():
    blank_interp = frappe.db.sql(
        """
        SELECT name FROM `tabPOS Profile`
        WHERE COALESCE(posa_qz_interpolation, '') = ''
        """,
        as_dict=True,
    )
    for row in blank_interp:
        frappe.db.set_value(
            "POS Profile",
            row["name"],
            "posa_qz_interpolation",
            "bicubic",
            update_modified=False,
        )

    blank_density = frappe.db.sql(
        """
        SELECT name FROM `tabPOS Profile`
        WHERE COALESCE(posa_qz_density, 0) = 0
        """,
        as_dict=True,
    )
    for row in blank_density:
        frappe.db.set_value(
            "POS Profile",
            row["name"],
            "posa_qz_density",
            203,
            update_modified=False,
        )

    frappe.db.commit()

    if blank_interp or blank_density:
        frappe.logger().info(
            "[posawesome.set_doco_qz_print_defaults] "
            f"set bicubic interpolation on {len(blank_interp)} profiles, "
            f"203 DPI density on {len(blank_density)} profiles"
        )
