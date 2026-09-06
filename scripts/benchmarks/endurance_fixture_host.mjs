import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { atomicJson } from './endurance_state.mjs';

export function verifyBoundSources(identity) {
  const code = `import json,pathlib,sys
sys.path.insert(0,'/home/holymc2/muelle-host/posawesome/scripts/certification')
from release_identity import source_identity
expected=json.load(sys.stdin)
root=pathlib.Path('/home/holymc2/muelle-host')
observed={app:source_identity(root/app) for app in expected if (root/app/'.git').exists()}
if not {'posawesome','doco'}.issubset(observed): raise ValueError('Required bound source repositories unavailable')
if any(observed[app]!=expected[app] for app in observed): raise ValueError('Bound app source changed during endurance')
print(json.dumps(sorted(observed)))`;
  const result = spawnSync('python3', ['-c', code], { input: JSON.stringify(identity.apps), encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw Error('Bound application source changed or could not be verified; run invalidated');
  return JSON.parse(result.stdout);
}

export function fixtureOperation(action, fixture, options = {}) {
  const site = fixture?.site || options.site;
  if (!['demo-abarrotes.lab.xoloitzcuintles.com', 'doco-mirror.lab.xoloitzcuintles.com'].includes(site)) throw Error('LAB fixture site required');
  const request = { action, site, ...options, ...(fixture ? { fixture } : {}) };
  const child = spawnSync('python3', ['/home/holymc2/muelle-host/muelle/agent/runtime.py', 'compose',
    'exec', '-T', '-w', '/home/frappe/frappe-bench/sites', 'backend',
    '/home/frappe/frappe-bench/env/bin/python',
    '/home/frappe/frappe-bench/apps/posawesome/scripts/benchmarks/endurance_fixture.py'],
  { input: JSON.stringify(request), encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  if (child.status !== 0) {
    // Never echo input or successful create stdout: both contain terminal secrets.
    throw Error(`Native fixture ${action} failed (exit ${child.status}): ${String(child.stderr || child.error || '').slice(-3000)}`);
  }
  const rows = child.stdout.split('\n').filter(line => line.startsWith('ENDURANCE_RESULT '));
  if (rows.length !== 1) throw Error('Native fixture operation returned no unique result');
  return JSON.parse(rows[0].slice('ENDURANCE_RESULT '.length));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, path, site, baseProfile] = process.argv.slice(2);
  if (action === 'create') {
    if (!path || !site || !baseProfile) throw Error('create requires output path, LAB site, base profile');
    const fixture = fixtureOperation('create', null, { site, base_profile: baseProfile, run_id: randomBytes(8).toString('hex') });
    atomicJson(path, fixture);
    console.log(JSON.stringify({ fixture_file: path, site, user: fixture.user, profile: fixture.profile, nonstock: true }));
  } else if (['audit', 'cleanup'].includes(action)) {
    console.log(JSON.stringify(fixtureOperation(action, JSON.parse(readFileSync(path, 'utf8')))));
  } else throw Error('Expected create, audit, or cleanup');
}
