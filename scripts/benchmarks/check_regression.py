#!/usr/bin/env python3
"""Gate a benchmark capture against its manifest and (optionally) a blessed
baseline (roadmap §6).

    python3 scripts/benchmarks/check_regression.py \
        --manifest docs/benchmarks/manifests/counter-standard.json \
        --capture  docs/benchmarks/baselines/counter-standard/<new>.json \
        --baseline docs/benchmarks/baselines/counter-standard/<blessed>.json

Exit codes: 0 = pass, 1 = gate failed (regression, or ceiling breach with
--strict-ceilings), 2 = inputs invalid / not comparable.

Comparability: capture and baseline must reference the same manifest_id.
A differing manifest_sha256 downgrades the run to a warning-only report —
per §6, results without the same manifest are observations, not evidence.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from manifest_lib import evaluate, load_json, manifest_sha256, validate_manifest  # noqa: E402

LEVEL_ORDER = {"REGRESSION": 0, "CEILING-BREACH": 1, "OVER-TARGET": 2, "NO-DATA": 3, "GAP": 4}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--capture", required=True)
    ap.add_argument("--baseline")
    ap.add_argument("--strict-ceilings", action="store_true")
    args = ap.parse_args()

    manifest = load_json(args.manifest)
    problems = validate_manifest(manifest)
    if problems:
        print("invalid manifest:\n" + "\n".join(problems))
        return 2

    capture = load_json(args.capture)
    baseline = load_json(args.baseline) if args.baseline else None

    comparable = True
    for name, doc in (("capture", capture), ("baseline", baseline)):
        if doc is None:
            continue
        if doc.get("manifest_id") != manifest.get("manifest_id"):
            print(f"{name} belongs to manifest {doc.get('manifest_id')!r}, not "
                  f"{manifest.get('manifest_id')!r} — not comparable")
            return 2
        if doc.get("manifest_sha256") != manifest_sha256(args.manifest):
            print(f"note: {name} was recorded against a different manifest revision — "
                  "treating results as observations only")
            comparable = False

    result = evaluate(manifest, capture, baseline, strict_ceilings=args.strict_ceilings)
    findings = sorted(result["findings"], key=lambda f: LEVEL_ORDER.get(f[1], 9))
    for key, level, detail in findings:
        print(f"{level:<15} {key:<28} {detail}")
    if not findings:
        print("no findings")

    if result["failed"] and comparable:
        print("GATE: FAIL")
        return 1
    if result["failed"] and not comparable:
        print("GATE: would fail, but manifest revisions differ — observation only")
        return 0
    print("GATE: PASS" + ("" if baseline else " (no baseline given — thresholds only)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
