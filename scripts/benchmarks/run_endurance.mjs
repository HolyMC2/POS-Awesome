#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { EnduranceJournal, MINIMUM, cyclePlan, atomicJson } from './endurance_state.mjs';
import { EnduranceBrowser } from './endurance_browser.mjs';
import { fixtureOperation, verifyBoundSources } from './endurance_fixture_host.mjs';

const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (['--smoke', '--smoke-online', '--resume'].includes(key)) options[key] = true;
  else if (['--identity-file', '--fixture-file', '--run-dir'].includes(key)) options[key] = process.argv[++index];
  else throw Error(`Unknown endurance option ${key}`);
}
for (const key of ['--identity-file', '--fixture-file', '--run-dir']) if (!options[key]) throw Error(`Required ${key}`);
const fixture = JSON.parse(readFileSync(options['--fixture-file'], 'utf8'));
const identity = JSON.parse(readFileSync(options['--identity-file'], 'utf8'));
if (!identity.release_id || !identity.build?.version || !identity.apps || identity.tenant?.site !== fixture.site) throw Error('Invalid or mismatched candidate identity');
if (!['demo-abarrotes.lab.xoloitzcuintles.com', 'doco-mirror.lab.xoloitzcuintles.com'].includes(fixture.site)) throw Error('LAB only');
const directory = resolve(options['--run-dir']);
const smoke = Boolean(options['--smoke'] || options['--smoke-online']);
const journal = new EnduranceJournal(directory, identity, smoke, Boolean(options['--resume']));
const browser = new EnduranceBrowser(fixture, identity, directory, smoke);
process.env.POSA_TEST_TERMINAL_FILE = resolve(options['--fixture-file']);
const pausePath = join(directory, 'pause.request');
const lockPath = '/home/holymc2/muelle-host/muelle/.deploy-lock';
const limits = smoke ? { duration_ms: 0, iterations: 5, financial_cycles: 1 } : MINIMUM;
const deadline = Date.parse(journal.rows[0].at) + 9 * 60 * 60 * 1000;
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function acquireDeployReadLock() {
  // A live pipe keeps flock alive. No stale lock survives either process dying.
  const child = spawn('flock', ['--shared', '--timeout', '60', lockPath, process.execPath, '-e',
    'process.stdout.write("LOCKED\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', () => resolve());
    child.once('error', reject);
    child.once('exit', code => { if (code !== 0) reject(Error('Deploy lock unavailable; resume after deployment')); });
  });
  return () => new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); });
}

async function waitWhilePaused() {
  if (!existsSync(pausePath)) return;
  journal.append('paused'); journal.report('paused');
  while (existsSync(pausePath) && !stopping) {
    if (Date.now() >= deadline) throw Error('Endurance job deadline exceeded while paused');
    await sleep(1000);
  }
  if (!stopping) journal.append('resumed');
}

let releaseLock;
try {
  atomicJson(join(directory, 'job.json'), { pid: process.pid, started_at: new Date().toISOString(),
    deadline: new Date(deadline).toISOString(), pause_file: pausePath,
    status_file: join(directory, 'status.json'), identity_file: resolve(options['--identity-file']),
    fixture_file: resolve(options['--fixture-file']), certifiable: !smoke });
  journal.report('running');
  const fixtureScope = Object.fromEntries(['company', 'customer', 'profile', 'item', 'mode_of_payment',
    'cash_account', 'currency', 'expected_financial'].map(key => [key, fixture[key]]));
  const existingScope = journal.rows.find(row => row.type === 'fixture_scope');
  if (existingScope) {
    for (const [key, value] of Object.entries(fixtureScope)) {
      if (JSON.stringify(existingScope.fixture?.[key]) !== JSON.stringify(value)) throw Error('Resume fixture scope changed');
    }
  } else journal.append('fixture_scope', { fixture: fixtureScope });
  releaseLock = await acquireDeployReadLock();
  if (!smoke) journal.append('source_guard', { apps: verifyBoundSources(identity) });
  await browser.open();
  await browser.checkBuild();
  const initialAudit = fixtureOperation('audit', fixture);
  if (initialAudit.submitted !== journal.cycles.filter(row => row.plan.financial).length) throw Error('Unjournaled financial documents require reconciliation');
  if (!journal.rows.some(row => row.type === 'baseline')) {
    await browser.uiCycle({ fault: 'normal' });
    const metrics = await browser.metrics();
    if (metrics.queue_pending !== 0 || browser.pageErrors.length) throw Error('Fixture baseline not clean');
    journal.append('baseline', { metrics });
  }
  await releaseLock(); releaseLock = null;
  for (let index = journal.cycles.length; index < limits.iterations; index++) {
    if (Date.now() >= deadline) throw Error('Endurance job deadline exceeded');
    await waitWhilePaused();
    if (stopping) break;
    if (browser.pageErrors.length) throw Error('Unexpected browser page error between cycles');
    releaseLock = await acquireDeployReadLock();
    const plan = cyclePlan(index, smoke, Boolean(options['--smoke-online']));
    const started = Date.now();
    journal.append('cycle_started', { plan }); journal.report('running');
    // Fingerprinting is active work too; only explicit pauses/lock waits are
    // excluded from the eight-hour clock.
    if (!smoke) verifyBoundSources(identity);
    const buildVersion = await browser.checkBuild();
    const result = plan.financial ? await browser.financialCycle(plan) : await browser.uiCycle(plan);
    let metrics = await browser.metrics();
    journal.append('cycle_observed', { plan, metrics, page_errors: browser.pageErrors.length, page_error_messages: browser.pageErrors });
    if (metrics.queue_pending !== 0) throw Error('Cycle left pending durable work');
    if (browser.pageErrors.length) throw Error('Unexpected browser page error');
    const baseline = journal.rows.find(row => row.type === 'baseline').metrics;
    if (metrics.heap_bytes > baseline.heap_bytes * 2 + 32 * 1024 * 1024 || metrics.listeners > baseline.listeners + 40 || metrics.realtime_scripts > 1) throw Error('Retained memory/listener budget exceeded');
    await browser.checkBuild();
    if (!smoke) verifyBoundSources(identity);
    // Pacing keeps one browser alive across a real shift; this is not a fast
    // 500-click loop mislabeled eight-hour evidence. Pause time is excluded.
    const activeBefore = journal.cycles.reduce((sum, row) => sum + row.active_ms, 0);
    const target = limits.duration_ms * (index + 1) / limits.iterations;
    while (!stopping && activeBefore + Date.now() - started < target) {
      if (browser.pageErrors.length) throw Error('Unexpected browser page error while idle');
      await sleep(Math.min(1000, target - activeBefore - (Date.now() - started)));
    }
    metrics = await browser.metrics();
    if (metrics.queue_pending || browser.pageErrors.length || metrics.heap_bytes > baseline.heap_bytes * 2 + 32 * 1024 * 1024 || metrics.listeners > baseline.listeners + 40 || metrics.realtime_scripts > 1) throw Error('End-of-cycle invariant failed');
    journal.append('cycle_completed', { plan, build_version: buildVersion, active_ms: Date.now() - started,
      faults: result.faults, accounting: result.accounting, ack_recovery: result.ack_recovery,
      metrics, page_errors: browser.pageErrors.length });
    journal.report('running');
    await releaseLock(); releaseLock = null;
    console.log(JSON.stringify({ cycle: index + 1, total: limits.iterations, financial: plan.financial, fault: plan.fault }));
  }
  if (stopping) {
    journal.append('paused', { reason: 'Graceful termination; explicit resume required' });
    journal.report('paused'); process.exitCode = 2;
  } else {
    releaseLock = await acquireDeployReadLock();
    if (!smoke) verifyBoundSources(identity);
    await browser.checkBuild();
    const finalAudit = fixtureOperation('audit', fixture);
    if (finalAudit.submitted !== limits.financial_cycles || !finalAudit.verified) throw Error('Final native financial count mismatch');
    const cleanup = fixtureOperation('cleanup', fixture);
    journal.append('completed', { final_audit: finalAudit, cleanup });
    const report = journal.report('completed', { final_audit: finalAudit, cleanup, assertions: { cleanup_verified: cleanup.verified === true } });
    process.exitCode = report.process_exit;
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
} catch (error) {
  // Preserve browser profile/queue and own ledger for explicit recovery. Never
  // cancel a sale merely because an interrupted browser could not see its ACK.
  journal.append('failed', { error: String(error.message).replaceAll(fixture.password, '[REDACTED]').replaceAll(fixture.terminal_token, '[REDACTED]'),
    page_error_messages: browser.pageErrors.map(message => message.replaceAll(fixture.password, '[REDACTED]').replaceAll(fixture.terminal_token, '[REDACTED]')) });
  const report = journal.report('failed');
  atomicJson(join(directory, 'evidence.json'), report);
  console.error('Endurance failed; inspect private evidence and preserve pending work.');
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  if (releaseLock) await releaseLock();
}
