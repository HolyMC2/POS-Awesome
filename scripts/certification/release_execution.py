"""Fixed executable adapters; arbitrary shell commands cannot create passing gates."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import pathlib
import subprocess

from golden_flow_lib import parse_env_file
from release_policy import KINDS

ROOT = pathlib.Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
AUTOMATED = ("frontend_unit", "frontend_types", "browser_golden", "browser_offline", "money_integrity", "tenant_seed", "endurance")
NATIVE_MODULES = (
    "doco.docoutils.test_charge_delivery",
    "posawesome.posawesome.api.payment_processing.test_advance_refunds",
    "posawesome.posawesome.api.payment_processing.test_source_reconciliation",
    "posawesome.posawesome.api.payment_processing.test_request_ledger",
)


def private_json(path, value):
    path = pathlib.Path(path)
    with path.open("x") as output:
        os.chmod(path, 0o600)
        json.dump(value, output, sort_keys=True, indent=2)
        output.write("\n")


SEED_ASSERTIONS = (
    "catalog.item_groups_exist", "catalog.starter_items_present", "catalog.items_carry_sat_claves",
    "accounting.item_tax_templates_exist", "accounting.zero_rate_items_bound", "accounting.sales_taxes_template_default",
    "profile.capability_preset_exists", "profile.pos_profile_linked",
)


def seed_code(site):
    return """import os,json
os.chdir('/home/frappe/frappe-bench/sites')
import frappe
frappe.init(site=SITE,sites_path='.');frappe.connect();frappe.set_user('Administrator')
try:
 from doco.docoutils.seed_verify import verify_thin_seed
 result=verify_thin_seed('abarrotes')
 print('POS_CERT_RESULT='+json.dumps(result))
finally:frappe.db.rollback();frappe.destroy()
raise SystemExit(0 if result['ok'] else 1)
""".replace("SITE", repr(site))


def native_code(site):
    # Rollback-only real ERPNext suites, not the standalone mocked finance tests.
    return '''import os,json,unittest,traceback
os.chdir('/home/frappe/frappe-bench/sites')
import frappe
frappe.init(site=SITE,sites_path='.');frappe.connect();frappe.set_user('Administrator')
class Result(unittest.TestResult):
 def __init__(self):super().__init__();self.rows=[]
 def addSuccess(self,test):super().addSuccess(test);self.rows.append({'id':test.id(),'status':'passed'})
 def addError(self,test,error):super().addError(test,error);self.rows.append({'id':test.id(),'status':'error','error_type':error[0].__name__,'detail':str(error[1])})
 def addFailure(self,test,error):super().addFailure(test,error);self.rows.append({'id':test.id(),'status':'failed','error_type':error[0].__name__,'detail':str(error[1])})
 def addSkip(self,test,reason):super().addSkip(test,reason);self.rows.append({'id':test.id(),'status':'skipped'})
 def addExpectedFailure(self,test,error):super().addExpectedFailure(test,error);self.rows.append({'id':test.id(),'status':'skipped'})
 def addUnexpectedSuccess(self,test):super().addUnexpectedSuccess(test);self.rows.append({'id':test.id(),'status':'failed'})
result=Result();errors=[]
try:
 unittest.defaultTestLoader.loadTestsFromNames(MODULES).run(result)
except Exception as error:errors.append(type(error).__name__)
finally:frappe.db.rollback();frappe.destroy()
payload={'tests_run':result.testsRun,'tests':result.rows,'successful':result.wasSuccessful() and not errors,'global_errors':errors}
print('POS_CERT_RESULT='+json.dumps(payload))
raise SystemExit(0 if payload['successful'] and result.testsRun and not result.skipped and not result.expectedFailures else 1)
'''.replace("SITE", repr(site)).replace("MODULES", repr(NATIVE_MODULES))


def run_gate(gate, identity, directory, compose, env_file, endurance_fixture=None):
    directory = pathlib.Path(directory)
    directory.mkdir(mode=0o700)
    report = directory / "raw.json"
    env = dict(os.environ)
    env["CI"] = "1"
    input_code = None
    if gate == "endurance":
        if not endurance_fixture or pathlib.Path(endurance_fixture).stat().st_mode & 0o077:
            raise ValueError("Endurance requires an explicitly allocated private fixture file")
        command = ["node", str(ROOT / "scripts/benchmarks/run_endurance.mjs"), "--identity-file", str(directory.parent / "identity.json"), "--fixture-file", str(endurance_fixture), "--run-dir", str(directory)]
        try:
            process = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=9 * 3600)
            code = process.returncode
        except subprocess.TimeoutExpired:
            code = 124
        destination = directory / "evidence.json"
        if destination.is_file() and code == 0:
            return destination
        # Never accept a green file when its runner failed after writing it.
        failed = directory / "execution-failed.json"
        private_json(failed, {"schema_version": 1, "gate": gate, "identity": identity, "kind": "endurance", "process_exit": code})
        return failed
    if gate == "frontend_unit":
        command = [str(FRONTEND / "node_modules/.bin/vitest"), "run", "--reporter=json", "--outputFile=" + str(report)]
    elif gate == "frontend_types":
        command = [str(FRONTEND / "node_modules/.bin/vue-tsc"), "--noEmit"]
    elif gate.startswith("browser_"):
        credentials = pathlib.Path(env_file)
        if credentials.stat().st_mode & 0o077:
            raise ValueError("Browser credentials file must have private permissions (0600)")
        env.update(parse_env_file(credentials.read_text()))
        if not env.get("POSA_SMOKE_USER") or not env.get("POSA_SMOKE_PASSWORD"):
            raise ValueError("Browser credentials missing; skipped tests cannot certify")
        env["POSA_SMOKE_BASE_URL"] = "https://" + identity["tenant"]["site"]
        env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = str(report)
        specs = ["tests/e2e/golden-flow-scan-retail.spec.ts"] if gate == "browser_golden" else ["tests/e2e/offline-reconnect-sale.spec.ts", "tests/e2e/offline-reconnect-sale.movil.spec.ts"]
        command = [str(FRONTEND / "node_modules/.bin/playwright"), "test", *specs, "--reporter=json", "--retries=0", "--workers=1", "--output=" + str(directory / "browser-artifacts")]
    elif gate in ("money_integrity", "tenant_seed"):
        command = ["docker", "compose", "-f", str(compose), "exec", "-T", "backend", "./env/bin/python", "-"]
        input_code = native_code(identity["tenant"]["site"]) if gate == "money_integrity" else seed_code(identity["tenant"]["site"])
        if gate == "money_integrity":
            command = ["flock", "--exclusive", "--timeout", "1800", str(ROOT.parent / "muelle/.deploy-lock"), *command]
    else:
        raise ValueError("This gate has no unattended adapter; supply real proof, never a success override")
    start = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        process = subprocess.run(command, cwd=FRONTEND, env=env, input=input_code, capture_output=True, text=True, timeout=2400)
        code, output = process.returncode, process.stdout + process.stderr
    except subprocess.TimeoutExpired:
        code, output = 124, "Runner timed out; no certification possible."
    except OSError:
        code, output = 127, "Runner could not start; no certification possible."
    finish = dt.datetime.now(dt.timezone.utc).isoformat()
    log = directory / "process.log"
    log.write_text(output)
    os.chmod(log, 0o600)
    if gate in ("money_integrity", "tenant_seed"):
        lines = [line[len("POS_CERT_RESULT="):] for line in output.splitlines() if line.startswith("POS_CERT_RESULT=")]
        if len(lines) == 1:
            report.write_text(lines[0])
    counts = dict(passed=0, failed=0, skipped=0, flaky=0, global_errors=0)
    if gate == "frontend_types":
        counts["passed" if code == 0 else "failed"] = 1
        report.write_text(json.dumps({"command": command, "process_exit": code}))
    elif report.is_file():
        try:
            raw = json.loads(report.read_text())
            if gate == "frontend_unit":
                counts.update(passed=raw.get("numPassedTests", 0), failed=raw.get("numFailedTests", 0), skipped=raw.get("numPendingTests", 0) + raw.get("numTodoTests", 0))
            elif gate.startswith("browser_"):
                stats = raw.get("stats", {})
                counts.update(passed=stats.get("expected", 0), failed=stats.get("unexpected", 0), skipped=stats.get("skipped", 0), flaky=stats.get("flaky", 0), global_errors=len(raw.get("errors", [])))
            elif gate == "tenant_seed":
                for row in raw.get("assertions", {}).values():
                    counts["passed" if row.get("ok") is True else "failed"] += 1
            else:
                for row in raw.get("tests", []):
                    counts[row["status"] if row["status"] in ("passed", "skipped") else "failed"] += 1
                counts["global_errors"] = len(raw.get("global_errors", []))
        except (ValueError, TypeError, KeyError):
            counts["global_errors"] += 1
    else:
        counts["global_errors"] += 1
        report.write_text("{}")
    os.chmod(report, 0o600)
    artifacts = [{"path": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in (report, log)]
    assertions = {}
    if gate == "tenant_seed":
        raw_seed = json.loads(report.read_text())
        returned = raw_seed.get("assertions", {})
        assertions = {"exact_assertion_coverage": set(returned) == set(SEED_ASSERTIONS)}
        for prefix in ("accounting", "profile", "catalog"):
            assertions[prefix + "_seed"] = all(returned.get(key, {}).get("ok") is True for key in SEED_ASSERTIONS if key.startswith(prefix + "."))
    result = dict(schema_version=1, gate=gate, kind=KINDS[gate], identity=identity, started_at=start, finished_at=finish,
        process_exit=code, summary=counts, assertions=assertions, artifacts=artifacts, runner="pos-release-v1", command=command)
    destination = directory / "evidence.json"
    private_json(destination, result)
    return destination
