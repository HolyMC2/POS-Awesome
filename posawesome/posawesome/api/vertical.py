# Copyright (c) 2026, Doco and contributors
# Capability-profile resolution for the POS SPA (VERTICAL_PROFILES_PLAN.md M3).

from __future__ import unicode_literals

import json

import frappe

# Bumped whenever the resolved payload's SHAPE changes in a way a queued
# offline invoice would need to detect on replay (plan C7). Not the preset's
# content version — the schema of what resolve_capability_json returns.
CAPABILITY_PAYLOAD_VERSION = 1


def _profile_capability_link(pos_profile_name):
    """The POS Capability Profile linked from a POS Profile, tolerating a
    missing column.

    posa_capability_profile is fixture+patch schema; a site that has not
    migrated since M3 lacks the column, and a raw get_value would 500 the
    whole opening call. Absent column resolves to null → the frontend uses
    its retail-phones default, which is the pre-M3 behaviour (plan C12: an
    existing tenant keeps working with zero data change).
    """
    if not frappe.db.has_column("POS Profile", "posa_capability_profile"):
        return None
    return frappe.db.get_value("POS Profile", pos_profile_name, "posa_capability_profile") or None


def resolve_capability_json(pos_profile_name):
    """Resolved capability payload for a POS Profile, or None.

    None means "no preset linked" — the frontend falls back to its built-in
    retail-phones profile. Returns a JSON-serialisable dict otherwise, stamped
    with the payload version so a queued offline invoice can reject replay on
    a shape mismatch.
    """
    link = _profile_capability_link(pos_profile_name)
    if not link:
        return None
    if not frappe.db.exists("POS Capability Profile", link):
        # A dangling link (preset deleted) must not break the counter.
        frappe.log_error(
            f"POS Profile {pos_profile_name} links missing capability profile {link}",
            "posawesome.vertical",
        )
        return None
    doc = frappe.get_cached_doc("POS Capability Profile", link)
    payload = doc.as_frontend_payload()
    payload["version"] = CAPABILITY_PAYLOAD_VERSION
    return payload


def stamp_capability_json(pos_profile_doc):
    """Attach the resolved capability JSON onto a POS Profile doc dict in
    place, under `posa_capability_json`, so it rides the opening payload into
    the offline shift snapshot with no extra fetch (plan C7).

    Stores a JSON STRING (not a nested object) because the profile is later
    round-tripped through JSON.stringify in the offline cache; a string is
    inert to that and the frontend parses it once.
    """
    try:
        payload = resolve_capability_json(pos_profile_doc.name)
    except Exception:
        # Never let capability resolution take down shift opening.
        frappe.log_error(frappe.get_traceback(), "posawesome.vertical.stamp")
        payload = None
    pos_profile_doc.set_onload("posa_capability_json", None)
    # set_onload isn't read by the SPA (it reads the doc dict), so assign the
    # attribute directly — get_doc(...).as_dict() will carry it.
    pos_profile_doc.posa_capability_json = json.dumps(payload) if payload else None


def clear_transient_capability_json(doc, method=None):
    """before_save guard: posa_capability_json is derived + stamped in-memory
    only, never stored. Null it on save so a persisted stale value can never
    shadow the live resolve (defensive — no current path saves a stamped
    profile, but this closes the class)."""
    if doc.get("posa_capability_json"):
        doc.posa_capability_json = None


@frappe.whitelist()
def get_capability_json(pos_profile):
    """Direct fetch for the SPA when it needs the payload outside the opening
    flow (profile switch mid-session). Read-only, permission-checked by the
    POS Profile read the caller already holds."""
    frappe.has_permission("POS Profile", "read", pos_profile, throw=True)
    return resolve_capability_json(pos_profile)
