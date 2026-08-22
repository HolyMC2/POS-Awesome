"""Give a repair preset the Service Orders dock tab it needs, in place of the
Floor tab it can never use (roadmap §17.7, Riel y Cajón).

`serviceOrder` joined VALID_DOCK_TABS / DOCK_TAB_IDS as the seventh id. On a
repair register that tab is the point of the change — the canvas promotes Orden
de servicio from a dialog to a destination — and `floor` is dead weight there:
the dock renders a Salón tab onto a shop with no tables.

**This patch matches on a RULE, not on a preset name.** There is no repair
preset seeded anywhere in this app — presets are DB documents that each tenant
carries — so a name would be a guess that silently does nothing on every tenant
that named theirs differently. The rule is exact and self-evidently safe:

    a preset that lists `floor` in dock_tabs
    but does NOT hold the `tables` capability

is, by construction, showing a tab it can never open. A restaurant preset holds
`tables` and is untouched; a retail preset lists no `floor` and is untouched.

`floor` is REPLACED IN PLACE rather than dropped and appended, because a
preset stores its tabs as an ordered CSV and the dock renders them in that
order — moving the tab to the end would rearrange a dock under the thumbs of
whoever is already using it.

Idempotent: a preset with no `floor` left is skipped, so a re-run is a no-op.
"""

import frappe

from posawesome.posawesome.doctype.pos_capability_profile.pos_capability_profile import (
    _split_csv,
)


def execute():
    for name in frappe.get_all("POS Capability Profile", pluck="name"):
        tabs = _split_csv(frappe.db.get_value("POS Capability Profile", name, "dock_tabs"))
        if "floor" not in tabs:
            continue

        capabilities = [
            entry.split(":")[0].strip()
            for entry in _split_csv(
                frappe.db.get_value("POS Capability Profile", name, "capabilities")
            )
        ]
        if "tables" in capabilities:
            # A real floor. Leave it alone.
            continue

        # Replace in place; drop a duplicate if the preset somehow carries both.
        moved = []
        for tab in tabs:
            replacement = "serviceOrder" if tab == "floor" else tab
            if replacement not in moved:
                moved.append(replacement)

        frappe.db.set_value(
            "POS Capability Profile", name, "dock_tabs", ", ".join(moved)
        )
        frappe.logger().info(
            f"posawesome: preset «{name}» dock_tabs floor → serviceOrder ({', '.join(moved)})"
        )
