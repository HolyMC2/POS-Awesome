"""Standalone tests for the golden-flow job logic.

Run without bench:
    python3 scripts/certification/test_golden_flow_lib.py
"""

import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from golden_flow_lib import (
    bench_execute_command,
    ledger_kwargs,
    parse_env_file,
    run_record,
    verdict_from_report,
)


class TestParseEnvFile(unittest.TestCase):
    def test_parses_and_skips_comments(self):
        env = parse_env_file("# c\n\nA=1\nB = two \nnoequals\n=bad\n")
        self.assertEqual(env, {"A": "1", "B": "two"})


class TestVerdict(unittest.TestCase):
    def test_green_run_passes(self):
        v = verdict_from_report(
            {"stats": {"expected": 1, "unexpected": 0, "skipped": 0, "duration": 27000.4}}
        )
        self.assertTrue(v["passed"])
        self.assertEqual(v["duration_ms"], 27000)

    def test_failure_fails(self):
        v = verdict_from_report({"stats": {"expected": 0, "unexpected": 1, "skipped": 0}})
        self.assertFalse(v["passed"])

    def test_skipped_run_is_a_failure(self):
        # The spec self-skips without POSA_SMOKE_BASE_URL — an unattended job
        # that ran nothing must never ledger success.
        v = verdict_from_report({"stats": {"expected": 0, "unexpected": 0, "skipped": 1}})
        self.assertFalse(v["passed"])

    def test_empty_report_is_a_failure(self):
        self.assertFalse(verdict_from_report({})["passed"])


class TestLedgerPayload(unittest.TestCase):
    def _record(self, passed=True):
        return run_record(
            site="demo-abarrotes.lab.xoloitzcuintles.com",
            manifest_id="abarrotes-comercio-thin",
            golden_flow_id="abarrotes-scan-basket-v1",
            verdict={"passed": passed, "duration_ms": 1},
            spec_path="tests/e2e/golden-flow-scan-retail.spec.ts",
            spec_sha256="abc",
            git_rev="deadbee",
            playwright_exit=0 if passed else 1,
            started_at="2026-08-17T00:00:00+00:00",
        )

    def test_kwargs_round_trip_without_secrets(self):
        kwargs = json.loads(ledger_kwargs(self._record()))
        self.assertEqual(kwargs["golden_flow_id"], "abarrotes-scan-basket-v1")
        # String, not bool: bench --kwargs is a Python literal and bare JSON
        # true/false would explode in its parser.
        self.assertEqual(kwargs["passed"], "true")
        self.assertEqual(json.loads(ledger_kwargs(self._record(passed=False)))["passed"], "false")
        detail = json.loads(kwargs["detail"])
        self.assertEqual(detail["spec"]["git_rev"], "deadbee")
        self.assertNotIn("PASSWORD", json.dumps(kwargs).upper())

    def test_bench_command_targets_boat_execute(self):
        cmd = bench_execute_command("/tmp/compose.yaml", "boat.lab.x", "{}")
        self.assertIn("boat.muelle.certification.record_golden_flow_run", cmd)
        self.assertEqual(cmd[cmd.index("--site") + 1], "boat.lab.x")


if __name__ == "__main__":
    unittest.main()
