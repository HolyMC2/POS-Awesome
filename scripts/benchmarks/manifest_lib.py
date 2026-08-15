"""Pure logic for benchmark manifests, baseline captures and the regression
gate (roadmap §6). No frappe, no I/O beyond json loading helpers — so the
whole thing is testable standalone and importable from thin CLIs.

Vocabulary
----------
manifest   docs/benchmarks/manifests/<id>.json — the comparability contract.
capture    one recorded measurement: telemetry percentiles + context.
baseline   a capture that was blessed as the comparison point.

Honesty rules (from §6):
- results without a satisfied manifest are OBSERVATIONS, not evidence;
- an interaction with fewer than gate.min_samples samples never gates;
- ceilings are hard RELEASE ceilings but only fail the gate when asked
  (--strict-ceilings) — the default gate fails on regression vs baseline,
  because targets are aspirational until the named hardware is pinned.
"""

from __future__ import annotations

import hashlib
import json

REQUIRED_MANIFEST_KEYS = (
    "manifest_id",
    "manifest_version",
    "roadmap_profile",
    "device",
    "network",
    "dataset",
    "gate",
    "interactions",
)
REQUIRED_INTERACTION_KEYS = ("key", "events", "unit")


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def manifest_sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def validate_manifest(manifest):
    """Return a list of problems (empty = valid)."""
    problems = []
    for key in REQUIRED_MANIFEST_KEYS:
        if key not in manifest:
            problems.append(f"missing top-level key: {key}")
    gate = manifest.get("gate") or {}
    min_samples = gate.get("min_samples")
    if not (isinstance(min_samples, int) and min_samples >= 1):
        problems.append("gate.min_samples must be a positive int")
    if not isinstance(gate.get("regression_tolerance_pct"), (int, float)):
        problems.append("gate.regression_tolerance_pct must be a number")
    seen = set()
    for row in manifest.get("interactions") or []:
        for key in REQUIRED_INTERACTION_KEYS:
            if key not in row:
                problems.append(f"interaction missing {key}: {row}")
        key = row.get("key")
        if key in seen:
            problems.append(f"duplicate interaction key: {key}")
        seen.add(key)
        if not row.get("events") and not row.get("gap"):
            problems.append(f"interaction {key}: no events and not marked as gap")
    return problems


def evidence_class(manifest):
    device_pinned = bool((manifest.get("device") or {}).get("pinned"))
    network_shaped = bool((manifest.get("network") or {}).get("shaped"))
    return "evidence" if (device_pinned and network_shaped) else "observation"


def extract_interactions(manifest, events):
    """Map a telemetry summary ``events`` dict onto manifest interactions.

    Returns {interaction_key: {"events": {name: row}, "worst_p95": float|None,
    "worst_p99": float|None, "total_count": int}} — worst_* consider only
    events with at least gate.min_samples samples, so thin data never
    pretends to be a percentile.
    """
    min_samples = (manifest.get("gate") or {}).get("min_samples", 30)
    out = {}
    for row in manifest.get("interactions") or []:
        picked = {}
        worst_p95 = None
        worst_p99 = None
        total = 0
        for name in row.get("events") or []:
            stat = (events or {}).get(name)
            if not stat:
                continue
            picked[name] = stat
            count = int(stat.get("count") or 0)
            total += count
            if count < min_samples:
                continue
            p95 = stat.get("p95")
            if p95 is not None and (worst_p95 is None or p95 > worst_p95):
                worst_p95 = p95
            if row.get("gate_p99", True):
                p99 = stat.get("p99")
                if p99 is not None and (worst_p99 is None or p99 > worst_p99):
                    worst_p99 = p99
        out[row["key"]] = {
            "events": picked,
            "worst_p95": worst_p95,
            "worst_p99": worst_p99,
            "total_count": total,
        }
    return out


def evaluate(manifest, capture, baseline=None, strict_ceilings=False):
    """Gate a capture against the manifest (and optionally a baseline).

    Returns {"findings": [...], "failed": bool}. Finding levels:
    - REGRESSION      p95 worse than baseline by > tolerance  (fails)
    - CEILING-BREACH  p99 over the hard release ceiling       (fails only
                      with strict_ceilings)
    - OVER-TARGET     p95 over the aspirational target        (warn)
    - GAP             manifest marks missing instrumentation  (info)
    - NO-DATA         events named but nothing sampled enough (info)
    """
    tol = float(manifest["gate"].get("regression_tolerance_pct", 20))
    cap = extract_interactions(manifest, capture.get("events") or {})
    base = (
        extract_interactions(manifest, baseline.get("events") or {})
        if baseline
        else {}
    )
    findings = []
    failed = False
    for row in manifest.get("interactions") or []:
        key = row["key"]
        if row.get("gap"):
            findings.append((key, "GAP", row.get("gap")))
            continue
        got = cap.get(key) or {}
        p95 = got.get("worst_p95")
        p99 = got.get("worst_p99")
        if p95 is None and p99 is None:
            findings.append(
                (key, "NO-DATA", f"{got.get('total_count', 0)} samples, below min")
            )
            continue
        ceiling = row.get("ceiling_p99")
        if ceiling is not None and p99 is not None and p99 > ceiling:
            findings.append((key, "CEILING-BREACH", f"p99 {p99} > ceiling {ceiling}"))
            if strict_ceilings:
                failed = True
        target = row.get("target_p95")
        if target is not None and p95 is not None and p95 > target:
            findings.append((key, "OVER-TARGET", f"p95 {p95} > target {target}"))
        base_p95 = (base.get(key) or {}).get("worst_p95")
        if base_p95 is not None and p95 is not None:
            limit = base_p95 * (1 + tol / 100.0)
            if p95 > limit:
                findings.append(
                    (
                        key,
                        "REGRESSION",
                        f"p95 {p95} > baseline {base_p95} +{tol}% ({round(limit, 2)})",
                    )
                )
                failed = True
    return {"findings": findings, "failed": failed}
