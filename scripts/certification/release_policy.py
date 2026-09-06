"""Fail-closed certification policy. Required gates cannot be waived by a plan."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import pathlib

from golden_flow_lib import verdict_from_report
from release_identity import validate_identity
from endurance_evidence import verify_journal
from hardware_evidence import verify_hardware
from lifecycle_evidence import verify_lifecycle, IncompleteLifecycle

POLICY_VERSION = 1
MAX_AGE_SECONDS = 86400
REQUIRED = {
    "frontend_unit": (), "frontend_types": (), "browser_golden": (), "browser_offline": (),
    "money_integrity": (),
    "tenant_seed": ("exact_assertion_coverage", "accounting_seed", "profile_seed", "catalog_seed"),
    "tenant_isolation": ("different_databases", "cross_tenant_read_denied", "cross_tenant_write_denied", "no_cross_tenant_queue"),
    "provision_zero": ("absent_before", "fresh_database", "required_apps_installed", "seed_verified", "ordinary_cashier_sale", "cleanup_verified"),
    "backup_restore": ("coherent_artifact", "artifact_hash_verified", "isolated_restore", "database_anchors_match", "files_match", "financial_invariants", "browser_sale", "cleanup_verified"),
    "upgrade_rollback": ("isolated_runtime", "prior_version_identified", "candidate_migration", "post_upgrade_money", "pending_offline_preserved", "prior_version_restored", "rollback_money", "cleanup_verified"),
    "endurance": ("completed", "financial_invariants", "queue_drained", "no_duplicates", "no_page_errors", "listener_budget", "heap_budget", "ack_loss_recovered"),
    "hardware": ("physical_printer", "scanner", "cash_drawer", "customer_display"),
}
KINDS = {"frontend_unit": "vitest", "frontend_types": "command", "browser_golden": "playwright", "browser_offline": "playwright", "money_integrity": "unittest", "tenant_seed": "seed", "endurance": "endurance", "hardware": "hardware_session"}


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Evidence timestamps require a timezone")
    return parsed


def read_json(path):
    return json.loads(pathlib.Path(path).read_text())


def _artifact_files(evidence, folder):
    artifacts = evidence.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("Raw evidence artifacts are required")
    paths = []
    for artifact in artifacts:
        relative = pathlib.Path(artifact["path"])
        path = (folder / relative).resolve()
        if relative.is_absolute() or not path.is_relative_to(folder.resolve()) or not path.is_file():
            raise ValueError("Artifact must be a file within its evidence directory")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != artifact.get("sha256"):
            raise ValueError("Raw artifact hash mismatch")
        paths.append(path)
    return paths


def _summary(evidence):
    summary = evidence.get("summary")
    keys = {"passed", "failed", "skipped", "flaky", "global_errors"}
    if not isinstance(summary, dict) or set(summary) != keys or any(type(v) is not int or v < 0 for v in summary.values()):
        raise ValueError("Complete integer test counts are required")
    return summary["passed"] > 0 and all(summary[k] == 0 for k in keys - {"passed"})


def _playwright(report):
    if not verdict_from_report(report)["passed"]:
        return False
    tests = []
    def walk(suite):
        for spec in suite.get("specs", []):
            tests.extend(spec.get("tests", []))
        for child in suite.get("suites", []):
            walk(child)
    walk(report)
    if not tests or len(tests) != report["stats"].get("expected"):
        return False
    return all(t.get("status") == "expected" and len(t.get("results", [])) == 1 and t["results"][0].get("status") == "passed" and not t["results"][0].get("errors") for t in tests)


def _raw_green(kind, paths, gate, evidence):
    if kind == "endurance":
        return verify_journal(paths[0], evidence["identity"], evidence.get("metrics", {}))
    if kind == "command":
        data = read_json(paths[0])
        return data.get("process_exit") == 0 and data.get("command") == evidence.get("command") and data.get("command", [])[-1:] == ["--noEmit"] and pathlib.Path(data["command"][0]).name == "vue-tsc"
    data = read_json(paths[0])
    if kind == "seed":
        from release_execution import SEED_ASSERTIONS
        returned = data.get("assertions", {})
        return data.get("ok") is True and set(returned) == set(SEED_ASSERTIONS) and all(row.get("ok") is True for row in returned.values())
    if kind == "playwright":
        def files(suite):
            return {pathlib.Path(s["file"]).name for s in suite.get("specs", []) if s.get("file")} | set().union(*(files(s) for s in suite.get("suites", [])))
        expected = {"golden-flow-scan-retail.spec.ts"} if gate == "browser_golden" else {"offline-reconnect-sale.spec.ts", "offline-reconnect-sale.movil.spec.ts"}
        return _playwright(data) and expected.issubset(files(data))
    if kind == "vitest":
        results = [assertion for suite in data.get("testResults", []) for assertion in suite.get("assertionResults", [])]
        return data.get("success") is True and data.get("numFailedTests") == 0 and data.get("numPendingTests") == 0 and data.get("numTodoTests", 0) == 0 and len(results) == data.get("numPassedTests") and len(results) > 0 and all(r.get("status") == "passed" for r in results)
    if kind == "unittest":
        results = data.get("tests", [])
        from release_execution import NATIVE_MODULES
        covered = all(any(r.get("id", "").startswith(module + ".") for r in results) for module in NATIVE_MODULES)
        return covered and data.get("successful") is True and len(results) > 0 and data.get("tests_run") == len(results) and all(r.get("status") == "passed" for r in results) and not data.get("global_errors")
    if kind == "hardware_session":
        return verify_hardware(data, evidence, paths)
    return verify_lifecycle(data, evidence, paths)


def _endurance(evidence):
    metrics = evidence.get("metrics", {})
    minimum = {"duration_seconds": 28800, "iterations": 500, "financial_cycles": 20}
    for key, value in minimum.items():
        if type(metrics.get(key)) not in (int, float) or metrics[key] < value:
            return False
    if (timestamp(evidence["finished_at"]) - timestamp(evidence["started_at"])).total_seconds() < 28800:
        return False
    if metrics.get("queue_start") != 0 or metrics.get("queue_end") != 0 or metrics.get("duplicate_financial_documents") != 0:
        return False
    return all(type(metrics.get("fault_counts", {}).get(k)) is int and metrics["fault_counts"][k] >= 1 for k in ("reload", "offline", "reconnect", "session_expiry"))


def evaluate_gate(gate, evidence_path, identity, now=None):
    result = {"gate": gate, "status": "unverified", "reasons": []}
    if evidence_path is None:
        result["reasons"] = ["Required gate has no evidence; no waiver is permitted"]
        return result
    try:
        path = pathlib.Path(evidence_path)
        evidence = read_json(path)
        if evidence.get("schema_version") != 1 or evidence.get("gate") != gate:
            raise ValueError("Evidence schema or gate identity mismatch")
        if evidence.get("identity") != identity:
            raise ValueError("Candidate/app/build/tenant/schema identity mismatch")
        if evidence.get("kind") in ("manual", "unsupported", "smoke", "endurance_smoke"):
            result["reasons"] = ["Manual, unsupported or smoke evidence does not certify this gate"]
            return result
        now = now or dt.datetime.now(dt.timezone.utc)
        start, finish = timestamp(evidence["started_at"]), timestamp(evidence["finished_at"])
        if finish < start or finish > now + dt.timedelta(seconds=60) or start > now or (now - start).total_seconds() > MAX_AGE_SECONDS:
            raise ValueError("Evidence is stale, from the future, or has invalid time ordering")
        kind = KINDS.get(gate, "lifecycle")
        if evidence.get("kind") != kind:
            raise ValueError("Incorrect proof type for required gate")
        paths = _artifact_files(evidence, path.parent)
        if type(evidence.get("process_exit")) is not int or evidence["process_exit"] != 0 or not _summary(evidence):
            raise ValueError("Runner failed or tests were missing, failed, skipped, flaky, or had global errors")
        assertions = evidence.get("assertions", {})
        if not isinstance(assertions, dict) or not set(REQUIRED[gate]).issubset(assertions) or any(value is not True for value in assertions.values()):
            raise ValueError("Required invariants were not all positively verified")
        if not _raw_green(kind, paths, gate, evidence):
            raise ValueError("Raw test report does not contain an entirely green executed test set")
        if gate == "endurance" and not _endurance(evidence):
            raise ValueError("Full endurance minimum or final invariants were not met")
        result.update(status="pass", evidence_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    except IncompleteLifecycle as error:
        result.update(status="unverified", reasons=[str(error)])
    except (ValueError, KeyError, TypeError, OSError, OverflowError, AttributeError) as error:
        result.update(status="fail", reasons=[str(error)])
    return result


def certify(identity, evidence, *, now=None, requested_mode="release"):
    validate_identity(identity)
    unknown = set(evidence) - set(REQUIRED)
    if unknown:
        raise ValueError("Unknown gates: " + ", ".join(sorted(unknown)))
    gates = [evaluate_gate(g, evidence.get(g), identity, now) for g in REQUIRED]
    status = "fail" if any(g["status"] == "fail" for g in gates) else "unverified" if any(g["status"] != "pass" for g in gates) else "pass"
    return {"schema_version": 1, "policy_version": POLICY_VERSION, "kind": "pos_release_certification", "mode": requested_mode, "identity": identity,
        "generated_at": (now or dt.datetime.now(dt.timezone.utc)).isoformat(), "status": status, "certified": status == "pass" and requested_mode == "release", "gates": gates}
