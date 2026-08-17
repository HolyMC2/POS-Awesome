#!/usr/bin/env python3
"""Golden-flow certification job — the unattended "job" rung.

Runs the Scan Retail golden-flow Playwright spec against a tenant as the
dedicated golden cashier, writes a repo-versioned run record, and ledgers
the outcome on the boat controller (`record_golden_flow_run`) so
`run_seed_certification` can require a fresh successful row.

Example (lab):
    python3 scripts/certification/golden_flow_job.py \
        --site demo-abarrotes.lab.xoloitzcuintles.com

Credentials come from an env file (default frontend/.env.golden.local,
git-ignored, 0600) — never from argv. The job overrides only the target
URL; a missing credential is a setup error (exit 2), never a silent skip.

Exit codes: 0 run passed and was ledgered · 1 flow failed (still ledgered)
· 2 setup/environment error.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from golden_flow_lib import (  # noqa: E402
    bench_execute_command,
    ledger_kwargs,
    parse_env_file,
    run_record,
    sha256_text,
    verdict_from_report,
)

SPEC = "tests/e2e/golden-flow-scan-retail.spec.ts"
FRONTEND = REPO_ROOT / "frontend"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", required=True, help="tenant FQDN the flow runs against")
    ap.add_argument("--manifest-id", default="abarrotes-comercio-thin")
    ap.add_argument("--golden-flow-id", default="abarrotes-scan-basket-v1")
    ap.add_argument("--env-file", default=str(FRONTEND / ".env.golden.local"))
    ap.add_argument("--boat-site", default="boat.lab.xoloitzcuintles.com")
    ap.add_argument(
        "--compose", default=str(pathlib.Path.home() / "muelle-host/muelle/compose.yaml")
    )
    ap.add_argument("--runs-dir", default=str(REPO_ROOT / "docs/certification/golden-flow-runs"))
    ap.add_argument("--no-ledger", action="store_true", help="record the run file only")
    args = ap.parse_args()

    env_path = pathlib.Path(args.env_file)
    if not env_path.exists():
        print(f"setup error: env file missing: {env_path}", file=sys.stderr)
        return 2
    creds = parse_env_file(env_path.read_text())
    if not creds.get("POSA_SMOKE_USER") or not creds.get("POSA_SMOKE_PASSWORD"):
        print("setup error: env file lacks POSA_SMOKE_USER/POSA_SMOKE_PASSWORD", file=sys.stderr)
        return 2

    started_at = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    report_path = FRONTEND / "test-results" / "golden-flow-report.json"
    env = dict(os.environ)
    env.update(creds)
    env["POSA_SMOKE_BASE_URL"] = f"https://{args.site}"
    env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = str(report_path)

    proc = subprocess.run(
        ["npx", "playwright", "test", SPEC, "--reporter=json"],
        cwd=FRONTEND,
        env=env,
        capture_output=True,
        text=True,
    )
    if not report_path.exists():
        print("setup error: no Playwright JSON report produced", file=sys.stderr)
        print(proc.stdout[-2000:], file=sys.stderr)
        print(proc.stderr[-2000:], file=sys.stderr)
        return 2
    verdict = verdict_from_report(json.loads(report_path.read_text()))

    spec_text = (FRONTEND / SPEC).read_text()
    git_rev = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True
    ).stdout.strip()
    record = run_record(
        site=args.site,
        manifest_id=args.manifest_id,
        golden_flow_id=args.golden_flow_id,
        verdict=verdict,
        spec_path=SPEC,
        spec_sha256=sha256_text(spec_text),
        git_rev=git_rev,
        playwright_exit=proc.returncode,
        started_at=started_at,
    )

    runs_dir = pathlib.Path(args.runs_dir)
    runs_dir.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%d-%H%M")
    out_path = runs_dir / f"{stamp}-{args.site.split('.')[0]}.json"
    out_path.write_text(json.dumps(record, indent=1, sort_keys=True) + "\n")
    print(f"run record: {out_path}")
    print(f"verdict: {'PASS' if verdict['passed'] else 'FAIL'} {verdict}")

    if not args.no_ledger:
        cmd = bench_execute_command(args.compose, args.boat_site, ledger_kwargs(record))
        ledger = subprocess.run(cmd, capture_output=True, text=True)
        if ledger.returncode != 0:
            print("ledger record FAILED:", file=sys.stderr)
            print(ledger.stdout[-1000:], file=sys.stderr)
            print(ledger.stderr[-1000:], file=sys.stderr)
            return 2
        print(f"ledgered on {args.boat_site}: {ledger.stdout.strip().splitlines()[-1]}")

    return 0 if verdict["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
