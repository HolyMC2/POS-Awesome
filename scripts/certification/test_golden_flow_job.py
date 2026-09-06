"""Exercise job orchestration with local temporary files and mocked subprocesses."""

import contextlib
import io
import json
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import golden_flow_job as job


class GoldenFlowJobTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="golden-job-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        self.frontend = self.root / "frontend"
        spec = self.frontend / job.SPEC
        spec.parent.mkdir(parents=True)
        spec.write_text("// isolated golden spec fixture\n")
        self.env_file = self.root / "credentials.env"
        self.env_file.write_text("POSA_SMOKE_USER=fixture-user\nPOSA_SMOKE_PASSWORD=fixture-secret\n")
        self.reports = []
        self.commands = []

    def invoke(self, report, process_exit=0, *, no_ledger=False):
        def run(command, **options):
            self.commands.append(command)
            if command[0] == "npx":
                report_path = pathlib.Path(options["env"]["PLAYWRIGHT_JSON_OUTPUT_NAME"])
                self.assertFalse(report_path.exists(), "a new run must never inherit a report")
                self.reports.append(report_path)
                if report is not None:
                    report_path.write_text(json.dumps(report))
                return types.SimpleNamespace(returncode=process_exit, stdout="", stderr="")
            if command[0] == "git":
                return types.SimpleNamespace(returncode=0, stdout="test-rev\n", stderr="")
            self.assertEqual(command[0], "docker")
            return types.SimpleNamespace(returncode=0, stdout="ledger-fixture\n", stderr="")

        argv = ["golden_flow_job.py", "--site", "fixture.lab.xoloitzcuintles.com", "--env-file", str(self.env_file), "--runs-dir", str(self.root / "runs")]
        if no_ledger:
            argv.append("--no-ledger")
        with patch.object(job, "FRONTEND", self.frontend), patch.object(job, "REPO_ROOT", self.root), patch.object(sys, "argv", argv), patch.object(job.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return job.main()

    def records(self):
        return [json.loads(path.read_text()) for path in (self.root / "runs").glob("*.json")]

    def test_missing_new_report_cannot_reuse_old_passing_report(self):
        stale = self.frontend / "test-results/golden-flow-report.json"
        stale.parent.mkdir()
        stale.write_text(json.dumps({"stats": {"expected": 1}}))
        self.assertEqual(self.invoke(None, process_exit=1), 2)
        self.assertEqual(self.records(), [])
        self.assertFalse(any(command[0] == "docker" for command in self.commands))
        self.assertFalse(self.reports[0].exists())

    def test_fresh_paths_and_evidence_are_independent_between_runs(self):
        self.assertEqual(self.invoke({"stats": {"expected": 1}}, no_ledger=True), 0)
        self.assertEqual(self.invoke({"stats": {"expected": 0, "unexpected": 1}}, no_ledger=True), 1)
        self.assertNotEqual(*self.reports)
        self.assertTrue(all(not path.exists() for path in self.reports))
        self.assertEqual(len(self.records()), 2)
        self.assertEqual(sorted(record["passed"] for record in self.records()), [False, True])

    def test_global_report_errors_ledger_failure_even_with_passing_test(self):
        report = {"stats": {"expected": 1}, "errors": [{"message": "worker failed"}]}
        self.assertEqual(self.invoke(report), 1)
        self.assertFalse(self.records()[0]["passed"])
        ledger = next(command for command in self.commands if command[0] == "docker")
        self.assertEqual(json.loads(ledger[-1])["passed"], "false")

    def test_nonzero_runner_exit_cannot_ledger_passing_report(self):
        self.assertEqual(self.invoke({"stats": {"expected": 1}}, process_exit=7), 1)
        record = self.records()[0]
        self.assertFalse(record["passed"])
        self.assertEqual(record["playwright_exit"], 7)
        ledger = next(command for command in self.commands if command[0] == "docker")
        self.assertEqual(json.loads(ledger[-1])["passed"], "false")

    def test_no_ledger_never_invokes_docker_and_evidence_excludes_credentials(self):
        self.assertEqual(self.invoke({"stats": {"expected": 1}}, no_ledger=True), 0)
        self.assertFalse(any(command[0] == "docker" for command in self.commands))
        evidence = json.dumps(self.records())
        self.assertNotIn("fixture-secret", evidence)
        self.assertNotIn("fixture-user", evidence)


if __name__ == "__main__":
    unittest.main()
