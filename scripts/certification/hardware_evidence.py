"""Validate an explicit physical operator session; configuration is not proof."""
import datetime as dt
import pathlib
import re

STEPS = {"physical_printer", "scanner", "cash_drawer", "customer_display"}


def verify_hardware(raw, evidence, paths):
    if raw.get("kind") != "physical_operator_session" or raw.get("identity") != evidence["identity"]:
        return False
    operator = raw.get("operator", {})
    if not isinstance(operator.get("id"), str) or not operator["id"].strip() or not operator.get("session_id"):
        return False
    review = raw.get("review", {})
    if not review.get("reviewer") or review.get("decision") != "accepted" or not review.get("reviewed_at"):
        return False
    start = dt.datetime.fromisoformat(evidence["started_at"].replace("Z", "+00:00"))
    finish = dt.datetime.fromisoformat(evidence["finished_at"].replace("Z", "+00:00"))
    reviewed = dt.datetime.fromisoformat(review["reviewed_at"].replace("Z", "+00:00"))
    if not reviewed.tzinfo or not start <= reviewed <= finish:
        return False
    devices = raw.get("devices", [])
    indexed = {device.get("step"): device for device in devices}
    if len(indexed) != 4 or set(indexed) != STEPS:
        return False
    for device in devices:
        if not device.get("model") or not re.fullmatch(r"[0-9a-f]{64}", device.get("identity_sha256", "")):
            return False
    captures = {str(p.relative_to(paths[0].parent)): p for p in paths[1:]}
    completed = set()
    for step in raw.get("steps", []):
        key = step.get("step")
        if key not in STEPS or key in completed or step.get("device_identity_sha256") != indexed[key]["identity_sha256"]:
            return False
        a = dt.datetime.fromisoformat(step["started_at"].replace("Z", "+00:00"))
        b = dt.datetime.fromisoformat(step["finished_at"].replace("Z", "+00:00"))
        if not a.tzinfo or not b.tzinfo or not start <= a < b <= reviewed or step.get("observed_result") != "passed":
            return False
        # An actual capture must be retained and hashed in the envelope. Plain
        # JSON booleans or an empty text file cannot stand in for observation.
        if not step.get("captures"):
            return False
        for name in step["captures"]:
            path = captures.get(name)
            if path is None:
                return False
            content = path.read_bytes()
            if len(content) < 32 or not (content.startswith(b"\x89PNG\r\n\x1a\n") or content.startswith(b"\xff\xd8\xff") or content.startswith(b"%PDF-") or content[4:8] == b"ftyp"):
                return False
        completed.add(key)
    return completed == STEPS
