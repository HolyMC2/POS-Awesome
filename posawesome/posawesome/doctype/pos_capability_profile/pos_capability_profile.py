# Copyright (c) 2026, Doco and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import json

import frappe
from frappe.model.document import Document

# The dock tab ids the shell knows how to render. validate() REJECTS a preset
# that names an unknown id (fail at edit time, not the counter); the payload
# builder and the frontend registry additionally filter unknowns as a drift
# defense for presets saved before a shipped id list catches up.
VALID_DOCK_TABS = ("browse", "offers", "cart", "coupons", "pay")

# Layout keys the frontend view registry has entries for. Kept in sync with
# vertical/viewRegistry.ts by tests on both sides.
VALID_ITEMS_PANELS = ("standard",)
VALID_CART_STYLES = ("table",)
VALID_ITEMS_VIEWS = ("list", "card")


def _split_csv(value):
    return [part.strip() for part in (value or "").split(",") if part.strip()]


class POSCapabilityProfile(Document):
    def validate(self):
        # Fail at edit time, not at the counter: an unknown layout key would
        # make the frontend registry throw at boot.
        if self.items_panel and self.items_panel not in VALID_ITEMS_PANELS:
            frappe.throw(f"Unknown items panel «{self.items_panel}»")
        if self.cart_style and self.cart_style not in VALID_CART_STYLES:
            frappe.throw(f"Unknown cart style «{self.cart_style}»")
        if self.items_view_default and self.items_view_default not in VALID_ITEMS_VIEWS:
            frappe.throw(f"Unknown items view «{self.items_view_default}»")

        tabs = _split_csv(self.dock_tabs)
        unknown = [t for t in tabs if t not in VALID_DOCK_TABS]
        if unknown:
            frappe.throw(
                f"Unknown dock tab(s): {', '.join(unknown)}. Valid: {', '.join(VALID_DOCK_TABS)}"
            )

        # Fail at edit time on malformed vocabulary JSON — a parse error at
        # boot would strand the label map and the SPA would show raw keys.
        if self.labels and self.labels.strip():
            try:
                parsed = json.loads(self.labels)
            except (ValueError, TypeError):
                frappe.throw("Label Overrides must be valid JSON.")
                return
            if not isinstance(parsed, dict):
                frappe.throw("Label Overrides must be a JSON object of key → label.")

    def as_frontend_payload(self):
        """The shape verticalStore consumes.

        Kept deliberately flat and JSON-serialisable so it can ride the POS
        Profile payload into the offline shift snapshot with no extra
        plumbing (VERTICAL_PROFILES_PLAN.md C7). Missing pieces are omitted;
        the frontend merges this over its retail-phones defaults, so a
        sparse preset only overrides what it names.
        """
        items_view_default = self.items_view_default or "list"
        allow = ["list", "card"] if items_view_default in ("list", "card") else [items_view_default]
        dock_tabs = [t for t in _split_csv(self.dock_tabs) if t in VALID_DOCK_TABS]
        labels = {}
        if self.labels and self.labels.strip():
            try:
                parsed = json.loads(self.labels)
                if isinstance(parsed, dict):
                    labels = {str(k): str(v) for k, v in parsed.items()}
            except (ValueError, TypeError):
                labels = {}
        return {
            "name": self.name,
            "vertical": self.vertical or None,
            "layout": {
                "items_view": {"default": items_view_default, "allow": allow},
                "items_panel": self.items_panel or "standard",
                "cart_style": self.cart_style or "table",
                "dock_tabs": dock_tabs or list(VALID_DOCK_TABS),
                "lean_vertical": bool(self.lean_vertical),
            },
            "capabilities": _split_csv(self.capabilities),
            "labels": labels,
            "print_format": self.print_format or None,
        }
