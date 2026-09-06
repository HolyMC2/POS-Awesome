"""Verify lifecycle receipts and independent executable checks, never copied booleans."""
import hashlib
import json
import pathlib

from release_identity import validate_identity


class IncompleteLifecycle(ValueError):
    pass


def verify_lifecycle(raw, evidence, paths):
    if raw.get("kind") != "lifecycle_verification":
        return False
    folder = paths[0].parent.resolve()
    allowed = {p.resolve() for p in paths}
    subject = raw.get("subject_identity")
    validate_identity(subject)
    if subject["tenant"]["site"] == evidence["identity"]["tenant"]["site"] or not subject["tenant"]["site"].startswith("cert-"):
        return False
    if subject["build"] != evidence["identity"]["build"]:
        return False
    for name, app in evidence["identity"]["apps"].items():
        if name in subject["apps"] and subject["apps"][name] != app:
            return False
    source_hash = hashlib.sha256(pathlib.Path(__file__).with_name("lifecycle_job.py").read_bytes()).hexdigest()
    receipts = {}
    for name in raw.get("operation_receipts", []):
        path = (folder / name).resolve()
        if path not in allowed:
            return False
        receipt = json.loads(path.read_text())
        if (receipt.get("kind") != "pos_lifecycle_operation" or receipt.get("identity") != evidence["identity"]
            or receipt.get("subject_site") != subject["tenant"]["site"] or receipt.get("status") != "pass"
            or receipt.get("process_exit") != 0 or receipt.get("candidate_unchanged") is not True or receipt.get("imported_log") is not False
            or receipt.get("verifier_source_sha256") != source_hash):
            return False
        for artifact in receipt.get("artifacts", []):
            target = (path.parent / artifact["path"]).resolve()
            if target not in allowed or hashlib.sha256(target.read_bytes()).hexdigest() != artifact.get("sha256"):
                return False
        if not receipt.get("artifacts") or receipt["operation"] in receipts:
            return False
        receipts[receipt["operation"]] = receipt
    gate = evidence["gate"]
    if gate in ("tenant_isolation", "upgrade_rollback"):
        raise IncompleteLifecycle("No executable cross-tenant/isolated-prior-runtime verifier is available; this gate remains unverified")
    needed = {"provision"} if gate == "provision_zero" else {"backup", "restore"}
    if not needed.issubset(receipts):
        raise IncompleteLifecycle("Required actual operation receipts are missing")
    if gate == "provision_zero":
        operation = receipts["provision"]
        if operation["before"].get("exists") is not False or operation["after"].get("exists") is not True:
            return False
        if not {"frappe", "erpnext", "doco", "posawesome", "abordo"}.issubset(operation["after"].get("installed_apps", [])):
            return False
    elif gate == "backup_restore":
        before, after = receipts["backup"]["before"], receipts["restore"]["after"]
        if receipts["backup"].get("backup") != receipts["restore"].get("backup") or not receipts["backup"].get("backup"):
            return False
        if any(before.get(key) != after.get(key) for key in ("database_sha256", "schema_sha256", "anchors", "files_sha256", "encryption_key_sha256")):
            return False
        if before.get("anchors", {}).get("Sales Invoice", {}).get("count", 0) < 1 or before.get("anchors", {}).get("GL Entry", {}).get("count", 0) < 2:
            return False
    # The lifecycle script alone cannot demonstrate selling or seed correctness.
    # Require fresh complete child gates against this exact disposable tenant.
    from release_policy import evaluate_gate
    checks = raw.get("checks", {})
    for child in ("tenant_seed", "browser_golden", "money_integrity"):
        path = (folder / checks.get(child, "missing")).resolve()
        if path not in allowed:
            raise IncompleteLifecycle("Lifecycle still needs independently executed seed/browser/money evidence")
        if evaluate_gate(child, path, subject)["status"] != "pass":
            return False
    cleanup = receipts.get("cleanup")
    if not cleanup or cleanup.get("after", {}).get("exists") is not False or cleanup.get("after", {}).get("database_absent") is not True:
        raise IncompleteLifecycle("Verified disposable database cleanup is missing")
    return True
