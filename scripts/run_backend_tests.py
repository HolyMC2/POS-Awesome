#!/usr/bin/env python3
"""Run every API test file in a fresh process so framework stubs cannot leak.

Native modules report their explicit missing-Frappe skips in this standalone
lane; their real-bench execution contract is documented in docs/testing/backend.md.
A failed import, assertion, or child process always makes this runner fail.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
API_TESTS = ROOT / "posawesome" / "posawesome" / "api"


def run_tests(directory):
    paths = sorted(directory.rglob("test_*.py"))
    if not paths:
        raise ValueError("No backend test files discovered")
    failures = []
    for path in paths:
        print(f"\n=== {path.relative_to(directory)} ===", flush=True)
        result = subprocess.run(
            [sys.executable, "-B", "-m", "unittest", "discover", "-v",
             "-s", str(path.parent), "-p", path.name],
            cwd=ROOT,
        )
        if result.returncode:
            failures.append(str(path.relative_to(directory)))
    print(f"\nBackend files: {len(paths)}; failed: {len(failures)}", flush=True)
    for name in failures:
        print(f"FAILED: {name}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(run_tests(API_TESTS))
