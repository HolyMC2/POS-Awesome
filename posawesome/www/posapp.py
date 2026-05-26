# Copyright (c) 2026, doco contributors
# For license information, please see license.txt
"""Web route serving the POSAwesome SPA outside the Frappe Desk shell.

Why
---
The Desk shell (sidebar / navbar / workspace / global modals) adds
~150 k DOM nodes baseline that the POS doesn't use. Mounting the SPA
at `/posapp` (web route) instead of `/app/posapp` (Page DocType inside
Desk) cuts the baseline DOM cost ~60 % and removes a ~5 s LCP overhead
on slow devices. See `3-SIGMA.md §3 Phase 1` for the rationale + plan.

This route is opt-in via the POS Profile flag `posa_use_web_route`
(handled in the Page DocType controller `posapp.js`). End-users still
land on `/app/posapp` until they toggle the flag; the legacy boot path
remains the supported default for at least one release.

Behaviour
---------
- Requires a logged-in session. Guests are redirected to `/login`.
- Pre-fetches a minimal `bootinfo` payload + a CSRF token so the SPA
  can call protected endpoints without bouncing through the Desk
  bootstrap.
- Renders a tiny HTML shell that loads the SPA via the
  `posawesome-web-entry` Vite chunk (NOT the Desk-side `loader.js`).

Public attributes used by Frappe's web router:
    - `no_cache = True` — every load re-evaluates session + boot
      payload; the SPA chunks themselves are content-hashed and
      cached at the asset layer.
    - `sitemap = 0` — internal app, not indexable.
"""

from __future__ import annotations

import json
from typing import Any, Dict

import frappe
from frappe import _

no_cache = True
sitemap = 0


def get_context(context: Dict[str, Any]) -> Dict[str, Any]:
    """Frappe web-route context builder.

    Called once per HTTP GET to `/posapp`. Returns the dict the
    Jinja template (`posapp.html`) renders.
    """
    if frappe.session.user == "Guest":
        # `frappe.local.flags.redirect_location` is the standard way
        # to bounce a web route. The SPA can be reached only by a
        # logged-in user; guests get the standard login screen with
        # a redirect-back to `/posapp`.
        frappe.local.flags.redirect_location = "/login?redirect-to=/posapp"
        raise frappe.Redirect

    # Phase 1.E feature flag: opt-in per POS Profile. Until any of the
    # current user's profiles has `posa_use_web_route` set, redirect
    # back to the legacy `/app/posapp` Desk Page so non-opted shops
    # get the well-tested boot path. Ops can roll back per-terminal
    # by toggling the flag and reloading — no redeploy needed.
    if not _user_opted_into_web_route(frappe.session.user):
        frappe.local.flags.redirect_location = "/app/posapp"
        raise frappe.Redirect

    boot_payload = _build_boot_payload()
    asset_manifest = _read_asset_manifest()

    context.update(
        {
            "no_cache": True,
            "title": _("POS Awesome"),
            "boot_json": json.dumps(boot_payload),
            "csrf_token": frappe.sessions.get_csrf_token(),
            "site_name": frappe.local.site,
            "user": frappe.session.user,
            "language": frappe.local.lang or "en",
            "build_version": (
                asset_manifest.get("version") if isinstance(asset_manifest, dict) else ""
            )
            or "",
            "asset_loader": (
                asset_manifest.get("assets", {}).get("loader")
                if isinstance(asset_manifest, dict)
                else ""
            )
            or "/assets/posawesome/dist/js/loader.js",
            "asset_css": (
                asset_manifest.get("assets", {}).get("css")
                if isinstance(asset_manifest, dict)
                else ""
            )
            or "/assets/posawesome/dist/js/posawesome.css",
            "asset_web_entry": _resolve_web_entry_url(asset_manifest),
            # List of hashed module URLs to `<link rel=modulepreload>`
            # in the HTML head. Browser starts fetching boot chunks in
            # parallel instead of waiting for the entry to parse + walk
            # imports — biggest LCP win for cold loads. List comes from
            # `frontend/build-manifest.js#PRELOAD_CHUNK_NAMES`; missing
            # chunk names drop silently. Empty list = no preload (older
            # builds without the new manifest field).
            "asset_web_preload": (
                (asset_manifest.get("assets", {}).get("web_preload") or [])
                if isinstance(asset_manifest, dict)
                else []
            ),
        }
    )
    return context


def _build_boot_payload() -> Dict[str, Any]:
    """Subset of `frappe.boot` the SPA actually needs.

    Calling the full `frappe.boot.get_bootinfo()` is expensive (~200 ms +
    a lot of payload the SPA never reads). We seed the SPA with the
    fields it depends on according to the audit of `frappe.boot.*` call
    sites in the SPA codebase, plus a CSRF token. The SPA's `frappe-shim`
    can fetch the full bootinfo on demand if a code path needs more.
    """
    user = frappe.session.user
    user_doc = (
        frappe.get_cached_doc("User", user)
        if user and user != "Guest"
        else None
    )
    sysdefaults: Dict[str, Any] = {}
    try:
        sysdefaults = frappe.defaults.get_defaults() or {}
    except Exception:
        sysdefaults = {}
    return {
        "user": user,
        "user_fullname": (
            (user_doc.first_name or "") + " " + (user_doc.last_name or "")
        ).strip()
        if user_doc
        else user,
        "lang": frappe.local.lang or "en",
        "sysdefaults": sysdefaults,
        "csrf_token": frappe.sessions.get_csrf_token(),
        "time_zone": {
            "system": sysdefaults.get("time_zone") or "UTC",
            "user": sysdefaults.get("time_zone") or "UTC",
        },
        "posawesome_settings": {
            "use_web_route": _user_opted_into_web_route(user),
        },
    }


def _user_opted_into_web_route(user: str) -> bool:
    """Phase 1.E feature-flag check. Delegates to the shared helper in
    `posawesome.posawesome.api.utilities` so the web-route controller
    and the Desk Page banner (`posapp.js` → Phase 1.F) agree on the
    answer. Administrator is always opted in for ops + smoke specs.
    """
    if not user or user == "Administrator":
        return True
    # The session may not be initialised yet when web-route imports run;
    # temporarily swap it so the helper can read frappe.session.user
    # directly.
    from posawesome.posawesome.api.utilities import posa_user_opted_into_web_route

    saved = getattr(frappe.session, "user", None)
    try:
        frappe.session.user = user
        return bool(posa_user_opted_into_web_route())
    finally:
        if saved is not None:
            frappe.session.user = saved


def _read_asset_manifest() -> Dict[str, Any]:
    """Read the per-build asset manifest emitted by `build-manifest.js`.

    Returns an empty dict if the manifest is missing — the template
    will fall back to legacy un-hashed paths in that case.
    """
    try:
        from frappe.utils import get_bench_path
    except Exception:
        get_bench_path = None
    manifest_path = None
    if get_bench_path:
        try:
            manifest_path = (
                get_bench_path()
                + "/sites/assets/posawesome/dist/js/version.json"
            )
        except Exception:
            manifest_path = None
    if not manifest_path:
        return {}
    try:
        with open(manifest_path, "rb") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _resolve_web_entry_url(manifest: Dict[str, Any]) -> str:
    """Return the hashed URL of the SPA's web entry chunk.

    The web entry is built by Vite as a separate Rollup input
    (`posawesome-web-entry`). Its hashed filename is published in
    `version.json.assets.web_entry` once Phase 1.C lands. Until then
    we fall back to the un-hashed default path so the route shell
    still serves something.
    """
    if isinstance(manifest, dict):
        url = (manifest.get("assets") or {}).get("web_entry")
        if isinstance(url, str) and url.strip():
            return url
    return "/assets/posawesome/dist/js/web-entry.js"
