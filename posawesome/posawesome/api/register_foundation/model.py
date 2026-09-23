"""Pure rules for stores, registers and grants (spec 01 §3–§7).

No Frappe import: every rule here is exercised by the standalone suite and
reused by the Desk controllers and the business commands, so both paths
enforce one contract.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import re
import unicodedata

REGISTER_CONTRACT_VERSION = 1
# site_config switch: pauses caja openings and restores legacy profile openings
# (spec 01 §8 rollback before new financial activity). Open caja shifts keep
# their stamped routes; nothing is rewritten.
DISABLE_FLAG = "posa_registers_disabled"
COMMAND_SCHEMA_VERSION = 1
PAGE_DEFAULT = 50
PAGE_MAX = 100
FRESH_SECONDS = 90
CHALLENGE_TTL_SECONDS = 600

LIFECYCLES = ("Draft", "Ready", "Suspended", "Retired")
# Draft → Ready → Suspended → Ready; Retired is terminal (spec 01 §4).
TRANSITIONS = {
    "Draft": {"Ready", "Retired"},
    "Ready": {"Suspended", "Retired"},
    "Suspended": {"Ready", "Retired"},
    "Retired": set(),
}
STORE_STATES = ("Active", "Suspended", "Retired")
STORE_TRANSITIONS = {"Active": {"Suspended", "Retired"}, "Suspended": {"Active", "Retired"}, "Retired": set()}
MODES = ("Cash", "Cashless")

# Capability bundles (spec 01 §7). Bundles are data, not Frappe roles.
BUNDLES = {
    "Cashier": {"sell"},
    "Order taker": {"order"},
    "Safe custodian": {"safe_custody"},
    "Store supervisor": {"supervise", "recover", "assign", "enroll", "view_amounts"},
    "Financial reviewer": {"review", "view_amounts", "audit"},
    "Regional manager": {"supervise", "view_amounts"},
    "Auditor": {"audit"},
    "Configuration admin": {"configure", "enroll", "supervise"},
}
# Capabilities that imply read access to the store directory.
READ_CAPABILITIES = {"sell", "order", "safe_custody", "supervise", "review", "audit", "configure"}
SCOPE_TYPES = ("Store", "Company")

_CODE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{0,31}$")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
_CHALLENGE = re.compile(r"^[A-Z2-9]{8}$")


class RuleError(ValueError):
    """A validation failure with a stable machine code (spec 01 §6)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def normalize_code(value) -> str:
    """Store/register codes: case-insensitive, 1–32 chars, letters/digits/_/-."""
    code = unicodedata.normalize("NFKC", str(value or "")).strip().upper()
    if not _CODE.match(code):
        raise RuleError("validation_failed", "Use 1 to 32 letters, digits, hyphens or underscores for the code.")
    return code


def normalize_label(value, field="label") -> str:
    label = " ".join(unicodedata.normalize("NFC", str(value or "")).split())
    if not 1 <= len(label) <= 120:
        raise RuleError("validation_failed", f"The {field} must have 1 to 120 characters.")
    return label


def normalize_reason(value, required=True, minimum=8) -> str:
    """Notes are bounded to 2,000 characters; mandatory reasons need real text."""
    reason = str(value or "").strip()
    if len(reason) > 2000:
        raise RuleError("validation_failed", "Keep the reason under 2,000 characters.")
    meaningful = re.sub(r"[\W_]+", "", reason, flags=re.UNICODE)
    if required and (len(reason) < minimum or len(meaningful) < 4):
        raise RuleError("validation_failed", f"Describe the reason in at least {minimum} characters.")
    return reason


def request_id(value) -> str:
    value = str(value or "")
    if not _REQUEST_ID.match(value):
        raise RuleError("validation_failed", "A stable request ID is required. Reload and retry.")
    return value


def positive_revision(value, field="expected_revision"):
    """Revision/generation are positive integers; strings avoid JS precision loss."""
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise RuleError("validation_failed", f"{field} must be a positive whole number.")
    text = str(value).strip()
    if not text.isdigit() or int(text) < 1 or len(text) > 15:
        raise RuleError("validation_failed", f"{field} must be a positive whole number.")
    return int(text)


def assert_revision(current, expected):
    """Every mutable command after creation carries the revision it read."""
    expected = positive_revision(expected)
    if expected is None:
        raise RuleError("validation_failed", "Reload the record; its revision is required to change it.")
    if int(current or 0) != expected:
        raise RuleError("revision_conflict", "Someone changed this record. Reload it; your entry is kept.")


def validate_timezone(value) -> str:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    name = str(value or "").strip()
    if not name or len(name) > 64 or "/" not in name and name != "UTC":
        raise RuleError("validation_failed", "Choose an IANA timezone such as America/Mazatlan.")
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise RuleError("validation_failed", "Choose an IANA timezone such as America/Mazatlan.") from None
    return name


def parse_cutoff(value) -> _dt.time:
    if isinstance(value, _dt.timedelta):
        seconds = int(value.total_seconds())
        return _dt.time(seconds // 3600 % 24, seconds // 60 % 60, seconds % 60)
    if isinstance(value, _dt.time):
        return value
    text = str(value or "00:00:00").strip()
    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?", text)
    if not match or int(match.group(1)) > 23 or int(match.group(2)) > 59:
        raise RuleError("validation_failed", "Business day cutoff must be a time of day (HH:MM).")
    return _dt.time(int(match.group(1)), int(match.group(2)), int(match.group(3) or 0))


def business_date(instant_utc: _dt.datetime, timezone: str, cutoff) -> _dt.date:
    """Local business date: before the cutoff still belongs to the previous day."""
    from zoneinfo import ZoneInfo

    if instant_utc.tzinfo is None:
        instant_utc = instant_utc.replace(tzinfo=_dt.timezone.utc)
    local = instant_utc.astimezone(ZoneInfo(timezone))
    cut = parse_cutoff(cutoff)
    day = local.date()
    if local.time() < cut:
        day -= _dt.timedelta(days=1)
    return day


def check_transition(current, target, table=TRANSITIONS):
    if target not in table.get(current, set()):
        raise RuleError("invalid_state", f"A register cannot move from {current} to {target}.")


def capabilities(bundle) -> set:
    return set(BUNDLES.get(bundle, set()))


def payload_hash(namespace: str, actor: str, payload: dict) -> str:
    """Canonical command fingerprint. Secrets never enter the hash."""
    secret_keys = {"terminal_token", "password", "code", "challenge_code"}
    clean = {k: v for k, v in (payload or {}).items() if k not in secret_keys and k != "request_id"}
    body = json.dumps({"ns": namespace, "actor": actor, "data": clean}, sort_keys=True,
                      separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode()).hexdigest()


def secret_hash(value: str) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()


def normalize_challenge(value) -> str:
    code = re.sub(r"[\s-]+", "", str(value or "")).upper()
    if not _CHALLENGE.match(code):
        raise RuleError("validation_failed", "Enter the 8-character connection code.")
    return code


def connectivity(last_seen, now, fresh_seconds=FRESH_SECONDS) -> str:
    """Fresh ≤ 90 s, Stale after, Unknown when never observed (spec 02 §4)."""
    if not last_seen:
        return "Unknown"
    return "Fresh" if (now - last_seen).total_seconds() <= fresh_seconds else "Stale"


def page_length(value) -> int:
    try:
        number = int(value or PAGE_DEFAULT)
    except (TypeError, ValueError):
        number = PAGE_DEFAULT
    return max(1, min(number, PAGE_MAX))


def readiness(register: dict, facts: dict) -> list[dict]:
    """Unmet Ready requirements, each naming its owning setup step.

    ``facts`` carries server-read context: store_status, profile_enabled,
    profile_company, profile_in_store, drawer_conflict, drawer_valid,
    custody_enabled, active_binding, route_difference, route_approved.
    """
    items = []

    def need(key, message, owner):
        items.append({"key": key, "message": message, "owner": owner})

    if facts.get("store_status") != "Active":
        need("store_active", "The store is not active.", "store")
    if not facts.get("profile_enabled"):
        need("profile", "Choose an enabled POS Profile.", "register")
    elif facts.get("profile_company") != register.get("company"):
        need("profile_company", "The POS Profile belongs to another company.", "register")
    elif not facts.get("profile_in_store"):
        need("profile_store", "Add this POS Profile to the store's permitted profiles.", "store")
    if register.get("mode") == "Cash":
        if not register.get("drawer_account"):
            need("drawer_account", "Choose the drawer's own cash account.", "register")
        elif not facts.get("drawer_valid"):
            need("drawer_account", "The drawer account must be an active cash ledger in the company currency.", "register")
        elif facts.get("drawer_conflict"):
            need("drawer_exclusive", "Another drawer, safe or payment method already uses this cash account.", "register")
        if facts.get("custody_enabled"):
            need("custody", "This profile uses single-register cash custody. Multi-register custody arrives with shared safes.", "custody")
        if facts.get("route_difference") and not facts.get("route_approved"):
            need("route_change", "The drawer route differs from the legacy route. A supervisor must approve the change.", "register")
    if register.get("requires_enrolled_device") and not facts.get("active_binding"):
        need("device", "Connect this caja's device.", "device")
    return items
