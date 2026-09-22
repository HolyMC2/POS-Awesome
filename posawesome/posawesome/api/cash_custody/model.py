"""Cash custody arithmetic. Amounts are integer minor units, never binary floats."""
import hashlib
import json
from decimal import Decimal, InvalidOperation

MAX_MINOR = 100_000_000_00


def minor(value):
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number < 0 or number * 100 != (number * 100).to_integral_value():
            raise ValueError("Use a nonnegative amount with at most two decimal places.")
        result = int(number * 100)
        if result > MAX_MINOR:
            raise ValueError("Amount exceeds the cash count limit.")
        return result
    except (InvalidOperation, TypeError):
        raise ValueError("Enter a valid cash amount.") from None


def count(payload):
    if not isinstance(payload, dict):
        raise ValueError("A denomination count is required.")
    rows = payload.get("denominations", [])
    if not isinstance(rows, list) or len(rows) > 50:
        raise ValueError("Invalid denomination rows.")
    seen, normalized, total = set(), [], 0
    for row in rows:
        face = minor(row.get("value"))
        quantity = row.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 0 <= quantity <= 100000:
            raise ValueError("Denomination quantities must be nonnegative whole numbers.")
        if face <= 0 or face in seen:
            raise ValueError("Each denomination must be positive and appear only once.")
        seen.add(face)
        total += face * quantity
        normalized.append({"value": face / 100, "quantity": quantity})
    if total > MAX_MINOR:
        raise ValueError("Amount exceeds the cash count limit.")
    source = payload.get("source", "denominations")
    reason = str(payload.get("reason") or "").strip()
    if source == "manual":
        if len(reason) < 8:
            raise ValueError("Explain the manual count override (at least 8 characters).")
        counted = minor(payload.get("amount"))
    elif source == "denominations":
        counted = total
    else:
        raise ValueError("Unknown count method.")
    return {"denominations": sorted(normalized, key=lambda r: r["value"], reverse=True),
            "source": source, "reason": reason, "amount": counted / 100, "derived_minor": total, "total_minor": counted}


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
