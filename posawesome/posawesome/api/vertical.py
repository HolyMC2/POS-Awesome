# Copyright (c) 2026, Doco and contributors
# Capability-profile resolution for the POS SPA (VERTICAL_PROFILES_PLAN.md M3).

from __future__ import unicode_literals

import copy
import hashlib
import json

import frappe
from frappe import _

# Bumped whenever the resolved payload's SHAPE changes in a way a queued
# offline invoice would need to detect on replay (plan C7). Not the preset's
# content version — the schema of what resolve_capability_json returns.
#
# 2 (2026-08-11): added the top-level `invoice_mode` key and the `floor` dock
# tab. A sale queued under v1 was built with no notion of Record Only, so a
# version mismatch must route it to draft-for-review rather than blind submit.
CAPABILITY_PAYLOAD_VERSION = 3
RESOLUTION_RESOLVED = "resolved"
RESOLUTION_INVALID = "invalid"
RESOLUTION_TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"
RESOLUTION_UNCONFIGURED = "unconfigured"
LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60


def _last_good_key(pos_profile_name):
    return f"posawesome:vertical:last_good:{pos_profile_name}"


def _stamp(payload, status, **details):
    stamped = copy.deepcopy(payload)
    stamped["version"] = CAPABILITY_PAYLOAD_VERSION
    stamped["resolution"] = {"status": status, **details}
    return stamped


def _invalid_payload(link=None, code="resolution_failed"):
    """A renderable but non-selling contract; never inherit retail powers."""
    return {
        "name": "invalid-configuration",
        "version": CAPABILITY_PAYLOAD_VERSION,
        "layout": {
            "items_view": {"default": "list", "allow": ["list"]},
            "items_panel": "standard",
            "cart_style": "table",
            "dock_tabs": ["browse", "cart"],
        },
        "capabilities": [],
        "labels": {},
        "print_format": None,
        "invoice_mode": None,
        "resolution": {
            "status": RESOLUTION_INVALID,
            "code": code,
            **({"linked_profile": link} if link else {}),
        },
    }


def _remember_last_good(pos_profile_name, payload):
    frappe.cache().set_value(
        _last_good_key(pos_profile_name), payload, expires_in_sec=LAST_GOOD_TTL_SECONDS
    )


def _last_good_payload(pos_profile_name):
    cached = frappe.cache().get_value(_last_good_key(pos_profile_name))
    if not isinstance(cached, dict):
        return None
    return _stamp(
        cached,
        RESOLUTION_TEMPORARILY_UNAVAILABLE,
        source="last_known_good",
    )


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
        # A dangling link is configuration corruption, not an unconfigured
        # legacy register. Returning None here used to grant retail defaults.
        _log_dangling_link(pos_profile_name, link)
        return _invalid_payload(link, "missing_linked_profile")
    doc = frappe.get_cached_doc("POS Capability Profile", link)
    payload = _stamp(doc.as_frontend_payload(), RESOLUTION_RESOLVED, source="current")
    _remember_last_good(pos_profile_name, payload)
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
        return _last_good_payload(pos_profile_name) or _invalid_payload(code="resolution_failed")


def assert_capability_configuration(pos_profile_name):
    """Block the money moment for linked configuration that cannot resolve."""
    if not pos_profile_name:
        return
    payload = opening_capability_payload(pos_profile_name)
    status = (payload or {}).get("resolution", {}).get("status")
    if status == RESOLUTION_INVALID:
        frappe.throw(
            _("This register configuration is invalid. Ask a manager to repair its capability profile."),
            frappe.ValidationError,
        )


def effective_contract_stamp(pos_profile_name):
    """Immutable stamp of the contract a shift opens under (roadmap F1
    "version/stamp effective contract at shift open").

    Returns ``(snapshot_json, fingerprint, version)``. An unconfigured legacy
    register stamps an explicit marker rather than nothing, so "opened with no
    contract" and "predates stamping" stay distinguishable in the audit trail.
    Tolerant like ``opening_capability_payload`` — stamping must never take
    down shift opening.
    """
    payload = opening_capability_payload(pos_profile_name)
    if payload is None:
        payload = {
            "name": None,
            "version": CAPABILITY_PAYLOAD_VERSION,
            "capabilities": [],
            "resolution": {"status": RESOLUTION_UNCONFIGURED},
        }
    snapshot_json = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), default=str
    )
    fingerprint = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
    return snapshot_json, fingerprint, CAPABILITY_PAYLOAD_VERSION


@frappe.whitelist()
def get_capability_json(pos_profile):
    """Direct fetch for the SPA when it needs the payload outside the opening
    flow (profile switch mid-session). Read-only, permission-checked by the
    POS Profile read the caller already holds."""
    frappe.has_permission("POS Profile", "read", pos_profile, throw=True)
    return opening_capability_payload(pos_profile)
