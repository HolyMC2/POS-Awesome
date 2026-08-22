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
#
# Must equal frontend DOCK_TAB_IDS (viewContracts.ts) in membership AND order —
# TestDockTabCrossStackParity is the only machine check that keeps them equal.
# APPEND, never insert: a preset stores its tabs as a CSV of these ids, so a
# middle insertion silently reorders every dock already configured in the field.
VALID_DOCK_TABS = ("browse", "offers", "cart", "coupons", "pay", "floor", "serviceOrder")

# What a preset that names NO dock tabs falls back to. Deliberately not
# VALID_DOCK_TABS: adding a vertical's tab to the valid list must not hand it
# to every preset that left the field blank — a retail register would grow a
# floor tab onto a floor it has no tables for, and a "Service Orders" tab onto
# a counter that has never taken a repair in.
DEFAULT_DOCK_TABS = ("browse", "offers", "cart", "coupons", "pay")

# Layout keys the frontend view registry has entries for. Kept in sync with
# vertical/viewRegistry.ts by tests on both sides.
VALID_ITEMS_PANELS = ("standard",)
VALID_CART_STYLES = ("table",)
VALID_ITEMS_VIEWS = ("list", "card")

# The capability names something in this stack actually asks has() about. A
# typo ("tab_identiy") is a silent no-op at the counter otherwise — same
# reasoning as the dock tabs: reject it while an admin is still looking at it.
# An entry may carry a `:Role` suffix; only the base name is checked here.
KNOWN_CAPABILITIES = (
    "tab_identity",
    "service_types",
    "external_document_checkout",
    "tables",
    "tips",
)

# How the open ticket is backed. Blank = the shipped retail behaviour (a draft
# invoice per ticket). "Record Only" is the one mode that needs POS Table Order:
# a draft Sales Invoice is force-deleted when its shift closes, and shifts are
# per-user, so a draft cannot back a table that outlives one waiter's turn
# (spec §0.1 / F1).
VALID_INVOICE_MODES = ("", "Sales Invoice", "POS Invoice", "Record Only")

# Keymap packs the SPA ships (roadmap §17.3). Mirrors the frontend
# registry in frontend/src/posapp/shortcuts/keymap.ts — the two lists are
# a contract pinned by tests on both sides. Blank = muelle-default.
# Validated at edit time for the same reason every other vocabulary here
# is: an unknown pack must fail at a manager's desk, never silently
# degrade a cashier's keyboard mid-shift.
VALID_KEYMAPS = ("", "muelle-default")


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
        if self.invoice_mode and self.invoice_mode not in VALID_INVOICE_MODES:
            frappe.throw(f"Unknown invoice mode «{self.invoice_mode}»")
        if self.keymap_id and self.keymap_id not in VALID_KEYMAPS:
            frappe.throw(
                f"Unknown keymap «{self.keymap_id}». Valid: "
                + ", ".join(k or "(blank = muelle-default)" for k in VALID_KEYMAPS)
            )

        tabs = _split_csv(self.dock_tabs)
        unknown = [t for t in tabs if t not in VALID_DOCK_TABS]
        if unknown:
            frappe.throw(
                f"Unknown dock tab(s): {', '.join(unknown)}. Valid: {', '.join(VALID_DOCK_TABS)}"
            )

        unknown = [
            entry for entry in _split_csv(self.capabilities)
            if entry.split(":")[0].strip() not in KNOWN_CAPABILITIES
        ]
        if unknown:
            frappe.throw(
                f"Unknown capability(ies): {', '.join(unknown)}. "
                f"Valid: {', '.join(KNOWN_CAPABILITIES)}"
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
                "dock_tabs": dock_tabs or list(DEFAULT_DOCK_TABS),
                "lean_vertical": bool(self.lean_vertical),
            },
            "capabilities": _split_csv(self.capabilities),
            "labels": labels,
            "print_format": self.print_format or None,
            # Top level, not under `layout`: how the ticket is backed is a
            # data-model choice the offline write queue branches on, not a
            # rendering one.
            "invoice_mode": self.invoice_mode or None,
            # Its own group so the register override allowlist can address
            # `shortcuts.keymap_id`, and so later keymap knobs (a per-mode
            # override map) have a home that is not `layout`.
            "shortcuts": {"keymap_id": self.keymap_id or None},
        }
