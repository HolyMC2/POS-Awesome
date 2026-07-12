import json

import frappe

from posawesome.posawesome.api.utils import get_active_pos_profile

SYNC_SCHEMA_VERSION = "2026-04-09"


def _normalize_timestamp(value):
    text = str(value or "").strip()
    return text or None


def _watermark_floor(watermark, overlap_seconds=2):
    """Push the incoming watermark back by a small overlap window.

    The watermark is max(modified) of the rows the client last received.
    Filtering with a strict `> watermark` permanently misses rows that
    committed in the same (micro)second after that page was read. Re-syncing
    a couple of seconds of overlap is harmless — the client upserts changes
    by key — while a missed row would stay stale until its next edit.
    """
    text = _normalize_timestamp(watermark)
    if not text:
        return None
    try:
        from frappe.utils import add_to_date, get_datetime

        return str(add_to_date(get_datetime(text), seconds=-abs(overlap_seconds)))
    except Exception:
        return text


def _max_timestamp(*values):
    normalized = []
    for value in values:
        if isinstance(value, (list, tuple, set)):
            normalized.extend([item for item in (_normalize_timestamp(entry) for entry in value) if item])
            continue
        timestamp = _normalize_timestamp(value)
        if timestamp:
            normalized.append(timestamp)
    return max(normalized) if normalized else None


def _build_response(
    changes=None,
    deleted=None,
    next_watermark=None,
    has_more=False,
    full_resync_required=False,
):
    response = {
        "changes": changes or [],
        "deleted": deleted or [],
        "next_watermark": next_watermark,
        "has_more": bool(has_more),
        "schema_version": SYNC_SCHEMA_VERSION,
    }
    if full_resync_required:
        response["full_resync_required"] = True
    return response


def _extract_claimed_profile_name(pos_profile):
    """Pull ONLY the profile *name* out of whatever the client sent.

    The client may pass a dict, a JSON-encoded dict/string, or a bare name.
    We deliberately keep nothing but the name — every scope field
    (warehouse, price list, customer/item groups, company) is re-read from
    the server-side doc in ``_resolve_profile``, never trusted from the
    inbound payload.
    """
    if isinstance(pos_profile, dict):
        return pos_profile.get("name")

    if isinstance(pos_profile, str):
        raw_value = pos_profile.strip()
        if not raw_value:
            return None
        try:
            decoded = json.loads(raw_value)
        except json.JSONDecodeError:
            return raw_value
        if isinstance(decoded, dict):
            return decoded.get("name")
        if isinstance(decoded, str):
            return decoded

    return None


def _resolve_profile(pos_profile=None):
    """Resolve the POS Profile for an offline-sync request — scope-checked.

    SECURITY (horizontal IDOR fix): the offline-sync read endpoints derive
    every query scope (customer group, warehouse, price list, item group,
    company) from the returned profile, and reach the DB via
    ``frappe.get_all`` which ignores Frappe's own permission layer. So we
    must NOT trust a client-supplied profile dict. We take only the claimed
    profile NAME, assert the session user is actually assigned to it
    (``_scope.assert_profile`` — the same guard the write endpoints use),
    then load the real doc server-side. A crafted ``{}`` (no scope filter →
    whole customer book) or a bare name of another store's profile
    (cross-warehouse/price-list read) can no longer widen the scope.
    """
    name = _extract_claimed_profile_name(pos_profile)
    if not name:
        active = get_active_pos_profile()
        if isinstance(active, dict):
            name = active.get("name")
        elif active is not None:
            name = getattr(active, "name", None)
    if not name:
        return None

    # Fail-closed scope assertion. Guest/unassigned users raise
    # PermissionError; System Manager bypasses (Frappe's own superuser
    # contract). Lazy import keeps standalone stub harnesses loadable.
    from posawesome.posawesome.api._scope import assert_profile

    assert_profile(getattr(getattr(frappe, "session", None), "user", None), name)

    try:
        doc = frappe.get_cached_doc("POS Profile", name)
    except frappe.DoesNotExistError:
        frappe.throw("POS Profile {0} not found".format(name))
        return None
    return doc.as_dict() if hasattr(doc, "as_dict") else doc
