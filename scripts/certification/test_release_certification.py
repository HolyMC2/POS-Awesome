"""Regression proof for candidate binding, mandatory gates and unsafe evidence."""
import contextlib
import copy
import datetime as dt
import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import release_certification as cli
import release_identity
from release_execution import NATIVE_MODULES, SEED_ASSERTIONS, native_code, run_gate
from release_policy import REQUIRED, certify, evaluate_gate

NOW = dt.datetime(2026, 9, 6, 20, tzinfo=dt.timezone.utc)


def identity():
    return {"release_id": "candidate", "build": {"version": "build-exact", "manifest_sha256": "a" * 64, "assets_sha256": "b" * 64},
        "apps": {app: {"revision": "c" * 40, "source_sha256": "d" * 64} for app in ("frappe", "erpnext", "doco", "posawesome")},
        "tenant": {"site": "cert-test.lab.xoloitzcuintles.com", "database_sha256": "e" * 64, "schema_sha256": "f" * 64, "installed_apps": {app: "16.0" for app in ("frappe", "erpnext", "doco", "posawesome")}}}


class CertificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.identity = identity()

    def evidence(self, gate="tenant_seed", raw=None, **changes):
        folder = self.root / gate
        folder.mkdir(exist_ok=True)
        assertions = {key: True for key in REQUIRED[gate]}
        raw = raw if raw is not None else {"ok":True,"assertions":{key:{"ok":True} for key in SEED_ASSERTIONS}} if gate == "tenant_seed" else {"status": "pass", "assertions": assertions}
        artifact = folder / "raw.json"
        artifact.write_text(json.dumps(raw))
        result = {"schema_version": 1, "gate": gate, "kind": "seed" if gate == "tenant_seed" else "assertions", "identity": self.identity,
            "started_at": (NOW - dt.timedelta(minutes=10)).isoformat(), "finished_at": NOW.isoformat(), "process_exit": 0,
            "summary": {"passed": 1, "failed": 0, "skipped": 0, "flaky": 0, "global_errors": 0}, "assertions": assertions,
            "artifacts": [{"path": "raw.json", "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}]}
        result.update(changes)
        path = folder / "evidence.json"
        path.write_text(json.dumps(result))
        return path

    def verdict(self, path, gate="tenant_seed"):
        return evaluate_gate(gate, path, self.identity, NOW)["status"]

    def test_one_green_gate_does_not_certify_missing_mandatory_gates(self):
        path = self.evidence()
        self.assertEqual(self.verdict(path), "pass")
        report = certify(self.identity, {"tenant_seed": path}, now=NOW)
        self.assertEqual(report["status"], "unverified")
        self.assertFalse(report["certified"])
        self.assertEqual(len(report["gates"]), len(REQUIRED))

    def test_each_candidate_dimension_must_match(self):
        for key, value in (("release_id", "other"), ("build", dict(self.identity["build"], version="old")),
                           ("apps", dict(self.identity["apps"], doco={"revision": "c"*40, "source_sha256": "0"*64})),
                           ("tenant", dict(self.identity["tenant"], schema_sha256="0"*64)),
                           ("tenant", dict(self.identity["tenant"], site="other.lab.xoloitzcuintles.com"))):
            changed = copy.deepcopy(self.identity);changed[key] = value
            with self.subTest(key=key):
                self.assertEqual(self.verdict(self.evidence(identity=changed)), "fail")

    def test_manual_smoke_and_unsupported_cannot_be_configured_to_pass(self):
        for kind in ("manual", "unsupported", "smoke", "endurance_smoke"):
            self.assertEqual(self.verdict(self.evidence(kind=kind, passed=True, certified=True)), "unverified")
        self.assertEqual(self.verdict(self.evidence("hardware"), "hardware"), "fail")

    def test_stale_future_and_missing_timezone_are_rejected(self):
        for start in ((NOW-dt.timedelta(days=2)).isoformat(), (NOW+dt.timedelta(minutes=1)).isoformat(), "2026-09-06T10:00:00"):
            self.assertEqual(self.verdict(self.evidence(started_at=start)), "fail")
        self.assertEqual(self.verdict(self.evidence(finished_at=(NOW-dt.timedelta(hours=1)).isoformat())), "fail")

    def test_failed_skipped_flaky_global_error_and_missing_counts_fail(self):
        good = dict(passed=3, failed=0, skipped=0, flaky=0, global_errors=0)
        for key in ("failed", "skipped", "flaky", "global_errors"):
            self.assertEqual(self.verdict(self.evidence(summary=dict(good, **{key: 1}))), "fail")
        for summary in ({"passed": 3}, dict(good, passed=0), dict(good, failed=False)):
            self.assertEqual(self.verdict(self.evidence(summary=summary)), "fail")
        self.assertEqual(self.verdict(self.evidence(process_exit=1)), "fail")

    def test_tampered_missing_or_escaped_raw_evidence_fails(self):
        path = self.evidence();(path.parent / "raw.json").write_text("{}")
        self.assertEqual(self.verdict(path), "fail")
        self.assertEqual(self.verdict(self.evidence(artifacts=[])), "fail")
        self.assertEqual(self.verdict(self.evidence(artifacts=[{"path":"../outside.json", "sha256":"a"*64}])), "fail")
        self.assertEqual(self.verdict(self.evidence(raw={"status":"pass", "assertions":{}})), "fail")

    def test_required_assertions_cannot_be_missing_or_truthy_strings(self):
        self.assertEqual(self.verdict(self.evidence(assertions={})), "fail")
        self.assertEqual(self.verdict(self.evidence(assertions={k:"true" for k in REQUIRED["tenant_seed"]})), "fail")

    def test_raw_playwright_retries_global_errors_and_wrong_spec_fail(self):
        test = {"status":"expected", "results":[{"status":"passed", "errors":[]}]}
        report = {"stats":{"expected":1}, "errors":[], "suites":[{"specs":[{"file":"golden-flow-scan-retail.spec.ts", "tests":[test]}]}]}
        gate = "browser_golden"
        self.assertEqual(self.verdict(self.evidence(gate, report, kind="playwright"), gate), "pass")
        self.assertEqual(self.verdict(self.evidence("browser_offline", report, kind="playwright"), "browser_offline"), "fail")
        for modified in (dict(report, errors=[{"message":"afterAll failed"}]), dict(report, suites=[])):
            self.assertEqual(self.verdict(self.evidence(gate, modified, kind="playwright"), gate), "fail")
        test["results"].insert(0,{"status":"failed"})
        self.assertEqual(self.verdict(self.evidence(gate, report, kind="playwright"), gate), "fail")

    def test_native_suite_requires_real_modules_and_all_cases(self):
        report = {"successful":True,"tests_run":len(NATIVE_MODULES), "global_errors":[], "tests":[{"id":m+".Test.case", "status":"passed"} for m in NATIVE_MODULES]}
        self.assertEqual(self.verdict(self.evidence("money_integrity", report, kind="unittest"), "money_integrity"), "pass")
        report["tests"].pop();report["tests_run"]-=1
        self.assertEqual(self.verdict(self.evidence("money_integrity", report, kind="unittest"), "money_integrity"), "fail")
        compile(native_code(self.identity["tenant"]["site"]), "native_runner", "exec")

    def test_vitest_summary_alone_cannot_certify(self):
        raw = {"success":True,"numFailedTests":0,"numPendingTests":0,"numPassedTests":1,"testResults":[]}
        self.assertEqual(self.verdict(self.evidence("frontend_unit",raw,kind="vitest"),"frontend_unit"),"fail")
        raw["testResults"]=[{"assertionResults":[{"status":"passed"}]}]
        self.assertEqual(self.verdict(self.evidence("frontend_unit",raw,kind="vitest"),"frontend_unit"),"pass")

    def test_unknown_gate_cannot_replace_required_gate(self):
        with self.assertRaises(ValueError):certify(self.identity,{"manual-waiver":"anything"},now=NOW)

    def test_native_adapter_owns_lock_and_preserves_nonzero_exit(self):
        raw = {"successful":True,"tests_run":len(NATIVE_MODULES),"global_errors":[],"tests":[{"id":m+".Test.case","status":"passed"} for m in NATIVE_MODULES]}
        response=types.SimpleNamespace(returncode=17,stdout="POS_CERT_RESULT="+json.dumps(raw),stderr="")
        with patch("release_execution.subprocess.run",return_value=response) as process:
            path=run_gate("money_integrity",self.identity,self.root/"native",self.root/"compose.yaml",self.root/"unused.env")
        self.assertEqual(process.call_args.args[0][0],"flock")
        self.assertIn("--exclusive",process.call_args.args[0])
        self.assertEqual(evaluate_gate("money_integrity",path,self.identity)["status"],"fail")
        self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_identity_includes_dirty_tracked_and_untracked_source(self):
        repo=self.root/'repo';repo.mkdir()
        def git(*args):subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True)
        git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
        source=repo/'source.py';source.write_text('a=1\n');git('add','.');git('commit','-m','fixture')
        first=release_identity.source_identity(repo);source.write_text('a=2\n');second=release_identity.source_identity(repo)
        self.assertEqual(first['revision'],second['revision']);self.assertNotEqual(first['source_sha256'],second['source_sha256'])
        (repo/'new.py').write_text('new=True\n');self.assertNotEqual(second['source_sha256'],release_identity.source_identity(repo)['source_sha256'])

    def test_source_identity_ignores_global_git_excludes_and_fsmonitor_not_repository_ignores(self):
        repo=self.root/'canonical';repo.mkdir()
        def git(*args):
            return subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True).stdout
        git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
        (repo/'source.py').write_text('source=1\n')
        (repo/'.gitignore').write_text('repo-ignored.txt\n')
        git('add','.');git('commit','-m','fixture')
        (repo/'.git/info/exclude').write_text('info-ignored.txt\n')
        hidden=repo/'.claude-flow';hidden.mkdir();(hidden/'source.json').write_text('{"value":1}')
        ignored=[repo/'repo-ignored.txt',repo/'info-ignored.txt']
        for path in ignored:path.write_text('ignored one')
        marker=self.root/'monitor-called'
        hook=self.root/'monitor';hook.write_text('#!/bin/sh\ntouch "'+str(marker)+'"\nexit 1\n');hook.chmod(0o700)
        excludes=self.root/'global-ignore';excludes.write_text('.claude-flow/\n')
        config=self.root/'global-config';config.write_text('[core]\nexcludesFile = '+str(excludes)+'\nfsmonitor = '+str(hook)+'\n')
        with patch.dict(os.environ,{'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}):
            clean=release_identity.source_identity(repo)
        with patch.dict(os.environ,{'GIT_CONFIG_GLOBAL':str(config),'GIT_CONFIG_NOSYSTEM':'1'}):
            # Demonstrate the original host/container discrepancy using real Git.
            self.assertNotIn(b'.claude-flow/source.json',git('ls-files','--others','--exclude-standard'))
            marker.unlink(missing_ok=True)
            self.assertEqual(clean,release_identity.source_identity(repo))
            self.assertFalse(marker.exists(), 'Fingerprint must not invoke a global fsmonitor hook')
            for path in ignored:path.write_text('ignored two')
            self.assertEqual(clean,release_identity.source_identity(repo))
            (hidden/'source.json').write_text('{"value":2}')
            self.assertNotEqual(clean,release_identity.source_identity(repo))

    def test_image_baked_app_uses_actual_tree_and_ignores_bytecode(self):
        root=self.root/'baked';root.mkdir();(root/'app.py').write_text('x=1')
        one=release_identity.source_identity(root);(root/'__pycache__').mkdir();(root/'__pycache__/app.pyc').write_bytes(b'cache')
        self.assertEqual(one,release_identity.source_identity(root))
        (root/'app.py').write_text('x=2');self.assertNotEqual(one,release_identity.source_identity(root))

    def invoke(self, extra, capture=None):
        args=['--site',self.identity['tenant']['site'],'--release-id','candidate','--output',str(self.root/'run'),*extra]
        with patch.object(cli,'capture',side_effect=capture or [self.identity,self.identity]),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            return cli.main(args)

    def test_dry_run_and_missing_gates_exit_nonzero_machine_readable(self):
        self.assertEqual(self.invoke(['--dry-run']),2)
        report=json.loads((self.root/'run/certification.json').read_text())
        self.assertFalse(report['certified']);self.assertEqual(report['status'],'unverified')

    def test_candidate_drift_fails_after_gate_collection(self):
        changed=copy.deepcopy(self.identity);changed['apps']['doco']['source_sha256']='0'*64
        self.assertEqual(self.invoke([],capture=[self.identity,changed]),1)
        self.assertEqual(json.loads((self.root/'run/certification.json').read_text())['status'],'fail')

    def test_overlapping_runner_cannot_write_into_existing_run(self):
        (self.root/'run').mkdir()
        self.assertEqual(self.invoke([]),2)
        self.assertEqual(list((self.root/'run').iterdir()),[])


if __name__ == '__main__':unittest.main()
