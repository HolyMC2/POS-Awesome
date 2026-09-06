#!/usr/bin/env python3
"""Capture real disposable-LAB lifecycle operations; NEVER a full release verdict.

Default is read-only snapshot. Mutating operations require --execute. Uses only
existing scoped scripts, no force provision, no shared source/image swap.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys

from release_execution import ROOT, private_json
from release_identity import capture, digest, validate_identity

MUELLE = ROOT.parent / "muelle"


def subject_state(site, compose):
    code = '''import os,json,pathlib,hashlib
os.chdir('/home/frappe/frappe-bench/sites')
site=SITE
root=pathlib.Path(site)
if not (root/'site_config.json').is_file():
 print('POS_LIFECYCLE='+json.dumps({'site':site,'exists':False}))
else:
 import frappe
 frappe.init(site=site,sites_path='.');frappe.connect()
 try:
  def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()
  tables={r[0] for r in frappe.db.sql('SHOW TABLES')}
  anchors={}
  for table in ('Company','Customer','Item','Sales Invoice','Payment Entry','GL Entry','Payment Ledger Entry','POS Opening Shift','POS Invoice Submission Ledger'):
   if 'tab'+table in tables:
    rows=frappe.db.sql('SELECT * FROM `tab'+table+'` ORDER BY name',as_dict=True)
    anchors[table]={'count':len(rows),'sha256':sha(rows)}
  files=[]
  for area in ('public/files','private/files'):
   for path in sorted((root/area).rglob('*')):
    if path.is_file():files.append([str(path.relative_to(root)),hashlib.sha256(path.read_bytes()).hexdigest()])
  schema=frappe.db.sql('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME,ORDINAL_POSITION',(frappe.conf.db_name,))
  print('POS_LIFECYCLE='+json.dumps({'site':site,'exists':True,'database_sha256':sha([frappe.conf.db_host,frappe.conf.db_name]),'installed_apps':sorted(frappe.get_installed_apps()),'schema_sha256':sha(schema),'anchors':anchors,'files_sha256':sha(files),'file_count':len(files),'encryption_key_sha256':sha(frappe.conf.encryption_key)}))
 finally:frappe.db.rollback();frappe.destroy()
'''.replace("SITE", repr(site))
    result = subprocess.run(["docker", "compose", "-f", str(compose), "exec", "-T", "backend", "./env/bin/python", "-"], input=code, text=True, capture_output=True, timeout=180)
    lines = [r[len("POS_LIFECYCLE="):] for r in result.stdout.splitlines() if r.startswith("POS_LIFECYCLE=")]
    if result.returncode or len(lines) != 1:
        raise ValueError("Lifecycle subject probe failed; no operation will be assumed safe")
    return json.loads(lines[0])


def operation_command(args, before):
    if not re.fullmatch(r"cert-[a-z0-9-]{6,60}\.lab\.xoloitzcuintles\.com", args.site):
        raise ValueError("Lifecycle operations require a uniquely named cert-* LAB tenant")
    if args.operation == "snapshot":
        return None
    if not args.execute:
        raise ValueError("Mutating lifecycle operations require explicit --execute after operational coordination")
    if args.operation == "provision":
        if before["exists"]:
            raise ValueError("Refusing provision over an existing tenant; no --force is available")
        if not args.business_payload or args.business_payload.stat().st_mode & 0o077 or not os.environ.get("MUELLE_ADMIN_PWD"):
            raise ValueError("Provision requires private business payload and MUELLE_ADMIN_PWD environment; never argv secrets")
        return ["flock", "--exclusive", "--timeout", "1800", str(MUELLE / ".deploy-lock"), "bash", str(MUELLE / "scripts/provision.sh"), args.site, "--bundle", "core", "--business-payload", str(args.business_payload), "--skip-dns-check"]
    if not before["exists"]:
        raise ValueError("Lifecycle target does not exist")
    if args.operation == "backup":
        return ["bash", str(MUELLE / "scripts/backup.sh"), args.site, "--with-files", "--keep", "2"]
    if args.operation == "restore":
        path = args.backup_path
        if not path or not path.resolve().is_relative_to((MUELLE / "backups" / args.site).resolve()):
            raise ValueError("Restore requires this exact disposable tenant's backup tree")
        verify_backup(path, args.site)
        return ["bash", str(MUELLE / "scripts/restore.sh"), args.site, str(path.resolve())]
    if args.operation == "install-fiscal-app":
        return ["flock", "--exclusive", "--timeout", "1800", str(MUELLE / ".deploy-lock"), "docker", "compose", "-f", str(args.compose), "exec", "-T", "backend", "bench", "--site", args.site, "install-app", "erpnext_mexico_compliance"]
    return ["bash", str(MUELLE / "scripts/migrate.sh"), args.site]


def verify_backup(path, site):
    spec = importlib.util.spec_from_file_location("coherent_backup", MUELLE / "scripts/lib/backup_artifacts.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    proof = module.verify_manifest(path, expected_site=site)
    manifest = json.loads((path / "backup-manifest.json").read_text())
    if proof.get("verified") is not True or manifest.get("with_files") is not True:
        raise ValueError("Lifecycle restore requires a verified coherent database+config+files backup")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True)
    parser.add_argument("--identity-file", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--operation", choices=("snapshot", "provision", "backup", "restore", "migrate", "install-fiscal-app"), default="snapshot")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--collect-log", type=pathlib.Path, help="Import an already-run operation as PARTIAL evidence only")
    parser.add_argument("--collected-exit", type=int)
    parser.add_argument("--business-payload", type=pathlib.Path)
    parser.add_argument("--backup-path", type=pathlib.Path)
    parser.add_argument("--compose", type=pathlib.Path, default=MUELLE / "compose.yaml")
    args = parser.parse_args(argv)
    owned = False
    try:
        if not re.fullmatch(r"cert-[a-z0-9-]{6,60}\.lab\.xoloitzcuintles\.com", args.site):
            raise ValueError("Only uniquely named cert-* LAB tenants are accepted")
        identity = json.loads(args.identity_file.read_text());validate_identity(identity)
        if args.site == identity["tenant"]["site"]:
            raise ValueError("Disposable lifecycle target must differ from the candidate's existing tenant")
        if capture(identity["tenant"]["site"], identity["release_id"], args.compose) != identity:
            raise ValueError("Pinned candidate drifted before lifecycle operation")
        args.output.mkdir(mode=0o700,parents=True,exist_ok=False);owned=True
        before = subject_state(args.site,args.compose)
        if args.collect_log:
            if args.execute or args.collected_exit is None:
                raise ValueError("Imported logs require collected exit and cannot execute an operation")
            before = {"site":args.site,"exists":None,"observation_missing":True}
            command = None
        else:
            command = operation_command(args,before)
        start = dt.datetime.now(dt.timezone.utc).isoformat()
        code, log = (args.collected_exit, args.collect_log.read_text()) if args.collect_log else (0, "Read-only lifecycle snapshot")
        if command:
            # Existing scripts own their deploy/site locks. Capture uncertainty;
            # never retry/drop/restore automatically when a process is interrupted.
            result = subprocess.run(command,cwd=MUELLE,text=True,capture_output=True,timeout=7200)
            code, log = result.returncode, result.stdout + result.stderr
        path = args.output / "operation.log";path.write_text(log);path.chmod(0o600)
        after = subject_state(args.site,args.compose)
        backup = None
        if args.operation == "backup" and code == 0:
            lines=[line[len("BACKUP_ARTIFACT_JSON:"):] for line in log.splitlines() if line.startswith("BACKUP_ARTIFACT_JSON:")]
            if len(lines)!=1:raise ValueError("Backup did not produce one exact operation receipt")
            backup_path=pathlib.Path(json.loads(lines[0])["path"])
            backup={"path":str(backup_path),"manifest":verify_backup(backup_path,args.site)}
        if args.operation == "restore":
            backup={"path":str(args.backup_path),"manifest":verify_backup(args.backup_path,args.site)}
        stable = capture(identity["tenant"]["site"],identity["release_id"],args.compose)==identity
        report=dict(schema_version=1,kind="pos_lifecycle_operation",operation=args.operation,identity=identity,subject_site=args.site,
            started_at=start,finished_at=dt.datetime.now(dt.timezone.utc).isoformat(),process_exit=code,
            status="unverified" if args.collect_log else "pass" if code==0 and stable else "fail",release_certified=False,before=before,after=after,backup=backup,
            verifier_source_sha256=digest(pathlib.Path(__file__).read_bytes()), imported_log=bool(args.collect_log),
            candidate_unchanged=stable,command=command,artifacts=[{"path":"operation.log","sha256":digest(path.read_bytes())}],
            limitations=["Operation exit is not a lifecycle certification gate.","Candidate migration is not prior-version rollback.","Seed, ordinary browser sale, financial invariants and cleanup require their own positive evidence."])
        private_json(args.output / "operation.json",report)
        print("Operation receipt captured; full release remains unverified")
        return 0 if report["status"]=="pass" else 2 if report["status"]=="unverified" else 1
    except (ValueError,TypeError,KeyError,OSError,subprocess.TimeoutExpired) as error:
        if owned:
            private_json(args.output/"operation.json",dict(schema_version=1,kind="pos_lifecycle_operation",status="unverified",release_certified=False,operation=args.operation,subject_site=args.site,error=type(error).__name__))
        print("Lifecycle UNVERIFIED: " + str(error),file=sys.stderr)
        return 2


if __name__=="__main__":sys.exit(main())
