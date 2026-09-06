#!/usr/bin/env python3
"""Strict POS release gate: exit0 only for full certification,1 failed,2 unverified.

Capture identity (read-only): --site SITE --release-id ID --output DIR --capture-only
Execute bounded existing gates: same args plus --execute frontend_unit frontend_types
Combine proof: --identity-file DIR/identity.json --evidence gate=/private/evidence.json
No flags waive required gates. Golden-flow smoke is not release certification.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys

from release_execution import AUTOMATED, ROOT, private_json, run_gate
from release_identity import capture, validate_identity
from release_policy import REQUIRED, certify


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--compose", type=pathlib.Path, default=ROOT.parent / "muelle/compose.yaml")
    parser.add_argument("--env-file", type=pathlib.Path, default=ROOT / "frontend/.env.golden.local")
    parser.add_argument("--identity-file", type=pathlib.Path)
    parser.add_argument("--endurance-fixture", type=pathlib.Path)
    parser.add_argument("--capture-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--execute", nargs="*", choices=AUTOMATED, default=[])
    parser.add_argument("--evidence", action="append", default=[], metavar="GATE=PATH")
    args = parser.parse_args(argv)
    owns_output = False
    try:
        if args.capture_only and (args.execute or args.evidence):
            raise ValueError("capture-only cannot run or certify gates")
        evidence = {}
        for argument in args.evidence:
            gate, separator, path = argument.partition("=")
            if not separator or gate not in REQUIRED or gate in evidence or gate in args.execute:
                raise ValueError("Evidence gate is unknown, duplicated, or also selected for execution")
            evidence[gate] = path
        if len(set(args.execute)) != len(args.execute):
            raise ValueError("A gate may be executed only once per run")
        args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
        owns_output = True
        if args.dry_run:
            private_json(args.output / "certification.json", {"schema_version": 1, "kind": "pos_release_certification", "status": "unverified", "certified": False,
                "reason": "Dry run executes no gates or identity probe", "required_gates": list(REQUIRED), "planned_execution": args.execute,
                "unsupported_automatic_gates": [g for g in REQUIRED if g not in AUTOMATED]})
            print("UNVERIFIED: dry run; no release certification")
            return 2
        identity = capture(args.site, args.release_id, args.compose)
        if args.identity_file:
            expected = json.loads(args.identity_file.read_text())
            validate_identity(expected)
            if identity != expected:
                raise ValueError("Current deployed candidate differs from the pinned identity")
        private_json(args.output / "identity.json", identity)
        if args.capture_only:
            print("Identity captured; no gates certified")
            return 2
        for gate in args.execute:
            print(f"Running {gate}", flush=True)
            evidence[gate] = run_gate(gate, identity, args.output / gate, args.compose, args.env_file, args.endurance_fixture)
        final_identity = capture(args.site, args.release_id, args.compose)
        report = certify(identity, evidence)
        if final_identity != identity:
            report.update(status="fail", certified=False, errors=["Candidate changed while collecting evidence"], observed_identity=final_identity)
        private_json(args.output / "certification.json", report)
        for gate in report["gates"]:
            print(gate["status"].upper() + ": " + gate["gate"])
        print("FULL RELEASE CERTIFIED" if report["certified"] else "NOT CERTIFIED: " + report["status"].upper())
        return 0 if report["certified"] else 1 if report["status"] == "fail" else 2
    except (ValueError, TypeError, KeyError, OSError) as error:
        if owns_output and not (args.output / "certification.json").exists():
            private_json(args.output / "certification.json", {"schema_version": 1, "kind": "pos_release_certification", "status": "unverified", "certified": False, "errors": [str(error)]})
        print("UNVERIFIED: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
