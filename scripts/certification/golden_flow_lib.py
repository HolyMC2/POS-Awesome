"""Pure logic for the golden-flow certification job (no subprocess, no I/O).

The job rung's contract (boat seed_manifests.py, golden_flow.automation
"job"): an unattended runner executes the Playwright spec and ledgers the
outcome on the boat controller; the certification job then requires a fresh
successful ledger row. This module holds everything that can be tested
without a browser or a bench: env-file parsing, the Playwright JSON-report
verdict, the run-record payload and the bench-execute ledger command.
"""

from __future__ import annotations

import hashlib
import json


def parse_env_file(text: str) -> dict:
    """KEY=VALUE lines; comments and blanks skipped. Mirrors the loader in
    frontend/playwright.config.ts so the two never disagree about a file."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        sep = trimmed.find("=")
        if sep <= 0:
            continue
        out[trimmed[:sep].strip()] = trimmed[sep + 1 :].strip()
    return out


def verdict_from_report(report: dict) -> dict:
    """Pass/fail from a Playwright JSON report.

    A SKIPPED run is a FAILURE here: the spec self-skips when
    POSA_SMOKE_BASE_URL is absent, and an unattended job that silently ran
    nothing must never ledger a success.
    """
    stats = report.get("stats") or {}
    expected = int(stats.get("expected") or 0)
    unexpected = int(stats.get("unexpected") or 0)
    skipped = int(stats.get("skipped") or 0)
    flaky = int(stats.get("flaky") or 0)
    passed = expected >= 1 and unexpected == 0 and skipped == 0
    return {
        "passed": passed,
        "expected": expected,
        "unexpected": unexpected,
        "skipped": skipped,
        "flaky": flaky,
        "duration_ms": round(float(stats.get("duration") or 0)),
    }


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_record(
    *,
    site: str,
    manifest_id: str,
    golden_flow_id: str,
    verdict: dict,
    spec_path: str,
    spec_sha256: str,
    git_rev: str,
    playwright_exit: int,
    started_at: str,
) -> dict:
    """The repo-versioned evidence file, one per run (benchmarks pattern)."""
    return {
        "golden_flow_id": golden_flow_id,
        "manifest_id": manifest_id,
        "site": site,
        "passed": verdict["passed"],
        "verdict": verdict,
        "spec": {"path": spec_path, "sha256": spec_sha256, "git_rev": git_rev},
        "playwright_exit": playwright_exit,
        "started_at": started_at,
    }


def ledger_kwargs(record: dict) -> str:
    """--kwargs payload for boat.muelle.certification.record_golden_flow_run.
    Detail carries the evidence identity, never credentials.

    bench execute parses --kwargs as a PYTHON literal, so a bare JSON
    `true`/`false` explodes with `name 'false' is not defined` — `passed`
    travels as the string "true"/"false" (the receiver normalizes) and the
    booleans inside `detail` are safe because detail is itself a string."""
    return json.dumps(
        {
            "site": record["site"],
            "manifest_id": record["manifest_id"],
            "golden_flow_id": record["golden_flow_id"],
            "passed": "true" if record["passed"] else "false",
            "detail": json.dumps(
                {
                    "verdict": record["verdict"],
                    "spec": record["spec"],
                    "started_at": record["started_at"],
                }
            ),
        }
    )


def bench_execute_command(compose_file: str, boat_site: str, kwargs_json: str) -> list[str]:
    return [
        "docker",
        "compose",
        "-f",
        compose_file,
        "exec",
        "-T",
        "backend",
        "bench",
        "--site",
        boat_site,
        "execute",
        "boat.muelle.certification.record_golden_flow_run",
        "--kwargs",
        kwargs_json,
    ]
