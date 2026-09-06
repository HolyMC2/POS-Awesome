"""Physical evidence and lifecycle operations cannot be replaced by config flags."""
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import lifecycle_job as job
from hardware_evidence import STEPS
from release_policy import REQUIRED,evaluate_gate
from test_release_certification import identity,NOW


class HardwareEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);self.identity=identity()

    def proof(self):
        start=(NOW-dt.timedelta(minutes=10)).isoformat();end=(NOW-dt.timedelta(minutes=1)).isoformat()
        raw=dict(kind='physical_operator_session',identity=self.identity,operator=dict(id='fixture-operator',session_id='physical-session'),
            review=dict(reviewer='fixture-reviewer',decision='accepted',reviewed_at=NOW.isoformat()),
            devices=[dict(step=step,model='fixture-model',identity_sha256='a'*64) for step in STEPS],
            steps=[dict(step=step,device_identity_sha256='a'*64,started_at=start,finished_at=end,observed_result='passed',captures=[step+'.png']) for step in STEPS])
        (self.root/'raw.json').write_text(json.dumps(raw))
        for step in STEPS:(self.root/(step+'.png')).write_bytes(b'\x89PNG\r\n\x1a\n'+b'fixture-test-image-bytes'*3)
        envelope=dict(schema_version=1,gate='hardware',kind='hardware_session',identity=self.identity,started_at=start,finished_at=NOW.isoformat(),process_exit=0,
            summary=dict(passed=4,failed=0,skipped=0,flaky=0,global_errors=0),assertions={step:True for step in STEPS},
            artifacts=[dict(path=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in [self.root/'raw.json',*[self.root/(s+'.png') for s in STEPS]]])
        path=self.root/'evidence.json';path.write_text(json.dumps(envelope));return path

    def test_complete_operator_session_contract_is_supported(self):
        # Synthetic unit data validates the parser only; never release evidence.
        self.assertEqual(evaluate_gate('hardware',self.proof(),self.identity,NOW)['status'],'pass')

    def test_missing_capture_or_changed_device_fails(self):
        path=self.proof();(self.root/'scanner.png').unlink()
        self.assertEqual(evaluate_gate('hardware',path,self.identity,NOW)['status'],'fail')
        path=self.proof();raw=json.loads((self.root/'raw.json').read_text());raw['devices'][0]['identity_sha256']='unknown'
        (self.root/'raw.json').write_text(json.dumps(raw))
        self.assertEqual(evaluate_gate('hardware',path,self.identity,NOW)['status'],'fail')

    def test_lifecycle_bare_pass_booleans_cannot_certify(self):
        path=self.proof();envelope=json.loads(path.read_text());envelope.update(gate='backup_restore',kind='lifecycle',assertions={k:True for k in REQUIRED['backup_restore']})
        raw=self.root/'raw.json';raw.write_text(json.dumps(dict(status='pass',assertions=envelope['assertions'])))
        envelope['artifacts']=[dict(path=raw.name,sha256=hashlib.sha256(raw.read_bytes()).hexdigest())];path.write_text(json.dumps(envelope))
        self.assertEqual(evaluate_gate('backup_restore',path,self.identity,NOW)['status'],'fail')


class LifecycleCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
        self.payload=self.root/'business.json';self.payload.write_text('{}');self.payload.chmod(0o600)
        self.args=types.SimpleNamespace(site='cert-unique123.lab.xoloitzcuintles.com',operation='provision',execute=True,business_payload=self.payload,backup_path=None,compose=self.root/'compose.yaml')

    def test_provision_uses_real_runtime_script_without_force_and_owns_lock(self):
        with patch.dict(os.environ,{'MUELLE_ADMIN_PWD':'private-fixture'}):
            command=job.operation_command(self.args,{'exists':False})
        self.assertEqual(command[0],'flock');self.assertIn('--exclusive',command);self.assertNotIn('--force',command)
        self.assertNotIn('private-fixture',' '.join(command));self.assertIn(str(job.MUELLE/'scripts/provision.sh'),command)

    def test_existing_tenant_is_never_reprovisioned(self):
        with self.assertRaisesRegex(ValueError,'existing tenant'):job.operation_command(self.args,{'exists':True})

    def test_no_mutation_without_explicit_execution(self):
        self.args.execute=False
        with self.assertRaisesRegex(ValueError,'explicit'):job.operation_command(self.args,{'exists':False})

    def test_production_and_non_disposable_sites_are_rejected(self):
        for site in ('ventas.docomexico.com','demo-abarrotes.lab.xoloitzcuintles.com','cert-../victim.lab.xoloitzcuintles.com'):
            self.args.site=site
            with self.assertRaises(ValueError):job.operation_command(self.args,{'exists':False})

    def test_backup_uses_files_and_restore_requires_same_site_manifest(self):
        self.args.operation='backup';command=job.operation_command(self.args,{'exists':True})
        self.assertIn('--with-files',command)
        self.args.operation='restore';self.args.backup_path=self.root/'another-tenant'
        with self.assertRaisesRegex(ValueError,'exact disposable'):job.operation_command(self.args,{'exists':True})

    def test_candidate_migrate_never_selects_skip_or_rollback(self):
        self.args.operation='migrate';command=job.operation_command(self.args,{'exists':True})
        self.assertEqual(command,['bash',str(job.MUELLE/'scripts/migrate.sh'),self.args.site])

    def test_private_credentials_are_required_before_provision(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(ValueError,'private'):job.operation_command(self.args,{'exists':False})


if __name__=='__main__':unittest.main()
