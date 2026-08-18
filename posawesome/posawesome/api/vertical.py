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

# ---- typed per-register override allowlist (roadmap F1) --------------------
# The ONLY per-register knobs that may adjust a linked preset's contract.
# Every entry is typed and carries an explicit merge rule; anything not listed
# here is mode content and cannot be overridden from the profile. Candidates
# and rationale: docs/LEGACY-FIELD-INVENTORY.md §5.1.
#
# merge "enable_only": effective = preset value OR register override — a
# register may switch ON what its mode left off, never strip what the mode
# pins on. Chosen because a Check field cannot distinguish "mode default off"
# from "mode pins off", and because it restores the documented role of
# posa_lean_vertical_layout, which the always-present payload key had silently
# made dead on every linked register.
OVERRIDE_ALLOWLIST = {
    "layout.lean_vertical": {
        "profile_field": "posa_lean_vertical_layout",
        "kind": "bool",
        "merge": "enable_only",
        "mode_default": False,
    },
    "layout.hide_items_until_search": {
        "profile_field": "posa_hide_items_until_search",
        "kind": "bool",
        "merge": "enable_only",
        "mode_default": False,
    },
    # Which keyboard pack this register teaches (roadmap §17.3). "replace",
    # not "enable_only": a keymap is a choice, not a power — a shop migrating
    # from another POS sets its own pack per terminal, and the mode's default
    # must be replaceable rather than merged. Empty means "not set" (see
    # _profile_override_value) so an untouched Data field never blanks the
    # mode's pack.
    "shortcuts.keymap_id": {
        "profile_field": "posa_ux_keymap_id",
        "kind": "data",
        "merge": "replace",
        "mode_default": None,
    },
}


def _profile_override_value(pos_profile_name, spec):
    """The register's raw override for one allowlist entry, or None when the
    schema does not carry the field (pre-migration site)."""
    field = spec["profile_field"]
    if not frappe.db.has_column("POS Profile", field):
        return None
    raw = frappe.db.get_value("POS Profile", pos_profile_name, field)
    if spec["kind"] == "bool":
        return bool(int(raw or 0))
    if spec["kind"] == "data":
        # An untouched Data field reads as "" (or None). Both mean "the
        # register did not choose" — returning "" would let an empty field
        # blank the mode's value under the replace rule.
        raw = (raw or "").strip() if isinstance(raw, str) else raw
        return raw or None
    return raw


def _merge_override(spec, mode_value, override):
    if spec["merge"] == "enable_only":
        return bool(mode_value) or bool(override)
    return override if override is not None else mode_value


def _apply_register_overrides(payload, pos_profile_name):
    """Merge the typed override layer into a resolved preset payload."""
    if not isinstance(payload, dict):
        return payload
    for key, spec in OVERRIDE_ALLOWLIST.items():
        group, _sep, leaf = key.partition(".")
        container = payload.setdefault(group, {})
        if not isinstance(container, dict):
            continue
        mode_value = container.get(leaf, spec["mode_default"])
        override = _profile_override_value(pos_profile_name, spec)
        container[leaf] = _merge_override(spec, mode_value, override)
    return payload


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
    payload = _apply_register_overrides(doc.as_frontend_payload(), pos_profile_name)
    payload = _stamp(payload, RESOLUTION_RESOLVED, source="current")
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


def _disabled_capabilities():
    """Tenant-level emergency kill switch (roadmap §3 / §9.3).

    ``site_config posa_disabled_capabilities: "tables, tips"`` removes a
    dangerous optional capability IMMEDIATELY — the one sanctioned exception
    to next-shift activation. Base token names; a role-suffixed entry in a
    preset is matched by its base name.
    """
    raw = frappe.conf.get("posa_disabled_capabilities") or ""
    return {
        part.strip().partition(":")[0].strip()
        for part in str(raw).split(",")
        if part.strip()
    }


def _subtract_disabled(payload):
    disabled = _disabled_capabilities()
    if not disabled or not isinstance(payload, dict):
        return payload
    capabilities = payload.get("capabilities") or []
    kept = [
        entry
        for entry in capabilities
        if str(entry).partition(":")[0].strip() not in disabled
    ]
    if len(kept) == len(capabilities):
        return payload
    trimmed = copy.deepcopy(payload)
    trimmed["capabilities"] = kept
    trimmed.setdefault("resolution", {})["disabled_capabilities"] = sorted(disabled)
    return trimmed


def shift_effective_capability_payload(pos_profile_name, user=None):
    """The contract in force for the acting user's register.

    Next-shift activation (roadmap F1 / §3): while a user has an OPEN shift on
    the profile, capability checks and the SPA resume path resolve from that
    shift's immutable stamp — a preset edit mid-shift changes nothing until
    the next opening. Without an open shift (fresh open, supervisor acting
    shiftless, pre-stamp rows) resolution is live. The emergency kill switch
    subtracts in both cases. An unconfigured stamp resolves to None, matching
    live resolution's legacy-fallback semantics.
    """
    if not pos_profile_name:
        return None
    user = user or frappe.session.user
    stamped = None
    if frappe.db.has_column("POS Opening Shift", "posa_effective_contract"):
        raw = frappe.db.get_value(
            "POS Opening Shift",
            {
                "user": user,
                "pos_profile": pos_profile_name,
                "docstatus": 1,
                "status": "Open",
                "pos_closing_shift": ["is", "not set"],
            },
            "posa_effective_contract",
            order_by="period_start_date desc",
        )
        if raw:
            try:
                parsed = json.loads(raw)
            except (TypeError, ValueError):
                parsed = None
            if isinstance(parsed, dict):
                stamped = parsed
    if stamped is not None:
        status = (stamped.get("resolution") or {}).get("status")
        if status == RESOLUTION_UNCONFIGURED:
            return None
        return _subtract_disabled(stamped)
    return _subtract_disabled(opening_capability_payload(pos_profile_name))


def effective_contract_stamp(pos_profile_name):
    """Immutable stamp of the contract a shift opens under (roadmap F1
    "version/stamp effective contract at shift open").

    Returns ``(snapshot_json, fingerprint, version)``. An unconfigured legacy
    register stamps an explicit marker rather than nothing, so "opened with no
    contract" and "predates stamping" stay distinguishable in the audit trail.
    Tolerant like ``opening_capability_payload`` — stamping must never take
    down shift opening. The emergency kill switch is applied before stamping,
    so a shift opened while a capability is disabled records the truth.
    """
    payload = _subtract_disabled(opening_capability_payload(pos_profile_name))
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
def get_contract_provenance(pos_profile):
    """Provenance inspection for the register's effective contract (roadmap
    F1: each effective override exposes value, mode default, override and why
    locked).

    ``value`` is what is IN FORCE right now (shift-aware — the open shift's
    stamp); ``mode_default``/``override`` reflect current authoring, so
    ``pending_next_shift`` marks a knob whose edit is waiting for the next
    opening. Read-only.
    """
    frappe.has_permission("POS Profile", "read", pos_profile, throw=True)

    in_force = shift_effective_capability_payload(pos_profile)
    link = _profile_capability_link(pos_profile)
    preset_payload = None
    if link and frappe.db.exists("POS Capability Profile", link):
        preset_payload = frappe.get_cached_doc(
            "POS Capability Profile", link
        ).as_frontend_payload()

    overrides = []
    for key, spec in OVERRIDE_ALLOWLIST.items():
        group, _sep, leaf = key.partition(".")
        mode_value = ((preset_payload or {}).get(group) or {}).get(
            leaf, spec["mode_default"]
        )
        override = _profile_override_value(pos_profile, spec)
        recomputed = _merge_override(spec, mode_value, override)
        in_force_value = ((in_force or {}).get(group) or {}).get(leaf, recomputed)
        why_locked = None
        if spec["merge"] == "enable_only" and bool(mode_value):
            why_locked = _(
                "Enabled by the mode preset; the register override cannot disable it."
            )
        overrides.append(
            {
                "key": key,
                "value": in_force_value,
                "mode_default": mode_value,
                "override": override,
                "profile_field": spec["profile_field"],
                "why_locked": why_locked,
                "pending_next_shift": bool(in_force_value != recomputed),
            }
        )

    disabled = sorted(_disabled_capabilities())
    locked = [
        {
            "key": "capabilities",
            "value": (in_force or {}).get("capabilities") or [],
            "why_locked": _(
                "Certified mode content; changed by editing the linked preset, "
                "active from the next shift. The emergency kill switch "
                "(posa_disabled_capabilities) subtracts immediately."
            ),
        },
        {
            "key": "invoice_mode",
            "value": (in_force or {}).get("invoice_mode"),
            "why_locked": _(
                "Data-model choice owned by the certified mode; not overridable."
            ),
        },
    ]

    return {
        "pos_profile": pos_profile,
        "preset": link or None,
        "version": CAPABILITY_PAYLOAD_VERSION,
        "resolution": (in_force or {}).get("resolution")
        or {"status": RESOLUTION_UNCONFIGURED},
        "overrides": overrides,
        "locked": locked,
        "disabled_capabilities": disabled,
    }


@frappe.whitelist()
def get_capability_json(pos_profile):
    """Direct fetch for the SPA when it needs the payload outside the opening
    flow (profile switch mid-session). Read-only, permission-checked by the
    POS Profile read the caller already holds. Shift-aware: a mid-session
    refetch while the caller's shift is open returns the stamped contract the
    server gates enforce, not a preset edited after opening."""
    frappe.has_permission("POS Profile", "read", pos_profile, throw=True)
    return shift_effective_capability_payload(pos_profile)
