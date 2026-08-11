# Copyright (c) 2026, Doco and contributors
# Capability-profile resolution for the POS SPA (VERTICAL_PROFILES_PLAN.md M3).

from __future__ import unicode_literals

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


def _log_dangling_link(pos_profile_name, link):
    """Error Log a dangling preset link at most once an hour per profile.

    Resolution runs on every opening AND on a whitelisted endpoint the SPA may
    poll — a row per call would bury the Error Log while saying the same thing.
    The cache is site-scoped, so the throttle is per (site, profile, link).
    """
    key = f"posawesome:vertical:dangling:{pos_profile_name}:{link}"
    cache = frappe.cache()
    if cache.get_value(key):
        return
    cache.set_value(key, 1, expires_in_sec=3600)
    frappe.log_error(
        f"POS Profile {pos_profile_name} links missing capability profile {link}",
        "posawesome.vertical",
    )


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
        _log_dangling_link(pos_profile_name, link)
        return None
    doc = frappe.get_cached_doc("POS Capability Profile", link)
    payload = doc.as_frontend_payload()
    payload["version"] = CAPABILITY_PAYLOAD_VERSION
    return payload


def opening_capability_payload(pos_profile_name):
    """Resolved capability payload for the opening response, tolerant of any
    failure (capability resolution must never take down shift opening).

    Injected as a SIBLING key in the opening `data` dict (plan C7's
    "denormalise into the opening payload") — NOT onto the POS Profile doc.
    The opening blob rides the offline shift snapshot wholesale, so this
    survives cold boot with no fake profile field to keep clean.
    """
    try:
        return resolve_capability_json(pos_profile_name)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "posawesome.vertical.opening_payload")
        return None


@frappe.whitelist()
def get_capability_json(pos_profile):
    """Direct fetch for the SPA when it needs the payload outside the opening
    flow (profile switch mid-session). Read-only, permission-checked by the
    POS Profile read the caller already holds."""
    frappe.has_permission("POS Profile", "read", pos_profile, throw=True)
    return resolve_capability_json(pos_profile)
