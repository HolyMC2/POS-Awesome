import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnduranceJournal, cyclePlan, MINIMUM } from './endurance_state.mjs';

const identity = { release_id: 'unit-only', build: { version: 'unit-build' }, tenant: { site: 'unit.invalid' } };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'endurance-unit-'));
  const journal = new EnduranceJournal(directory, identity);
  journal.append('baseline', { metrics: { queue_pending: 0, heap_bytes: 1000, listeners: 10 } });
  return { directory, journal, close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('full fixed schedule has exactly20 real financial cycles and500 total; smoke stays distinct', () => {
  const plans = Array.from({ length: MINIMUM.iterations }, (_, index) => cyclePlan(index));
  assert.equal(plans.filter(row => row.financial).length, 20);
  assert.equal(plans.filter(row => row.fault === 'ack_loss').length, 10);
  assert.equal(plans.filter(row => row.fault === 'offline_sale').length, 10);
  assert.equal(MINIMUM.duration_ms, 28800000);
});

test('unfinished/short run cannot produce success even with a completed status request', () => {
  const f = fixture();
  try {
    const report = f.journal.report('completed');
    assert.equal(report.process_exit, 1);
    assert.equal(report.assertions.duration_met, false);
    assert.equal(report.assertions.financial_cycles_met, false);
    assert.equal(report.assertions.queue_drained, false);
  } finally { f.close(); }
});

test('crash after cycle start refuses resume rather than minting another financial request', () => {
  const f = fixture();
  try {
    f.journal.append('cycle_started', { plan: cyclePlan(0) });
    assert.throws(() => new EnduranceJournal(f.directory, identity, false, true), /Interrupted cycle/);
  } finally { f.close(); }
});

test('clean checkpoint can resume only the identical candidate, with intact journal chain', () => {
  const f = fixture();
  try {
    f.journal.append('paused');
    assert.equal(new EnduranceJournal(f.directory, identity, false, true).rows.at(-1).type, 'paused');
    assert.throws(() => new EnduranceJournal(f.directory, { ...identity, release_id: 'changed' }, false, true), /identity mismatch/);
    const path = join(f.directory, 'journal.jsonl');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"paused"', '"forged"'));
    assert.throws(() => new EnduranceJournal(f.directory, identity, false, true), /hash mismatch/);
  } finally { f.close(); }
});

test('unknown financial acknowledgment cannot satisfy native accounting invariants', () => {
  const f = fixture();
  try {
    f.journal.append('cycle_completed', { plan: cyclePlan(0), active_ms: 60000, faults: ['ack_loss'],
      build_version: identity.build.version, page_errors: 0,
      metrics: { queue_pending: 0, heap_bytes: 1000, listeners: 10, realtime_scripts: 1 },
      accounting: { verified: true, docstatus: 0, invoice: 'DRAFT', request_id: 'request' } });
    const report = f.journal.report('completed', { final_audit: { submitted: 1, verified: true, duplicate_financial_documents: 0 } });
    assert.equal(report.assertions.financial_native_verified, false);
    assert.equal(report.assertions.financial_invariants, false);
    assert.equal(report.process_exit, 1);
    assert.equal(report.artifacts[0].path, 'journal.jsonl');
  } finally { f.close(); }
});

test('a truncated journal or prior terminal failure cannot resume', () => {
  const f = fixture();
  try {
    f.journal.append('failed', { error: 'unit failure' });
    assert.throws(() => new EnduranceJournal(f.directory, identity, false, true), /Terminal/);
    const path = join(f.directory, 'journal.jsonl');
    writeFileSync(path, readFileSync(path, 'utf8').slice(0, -1));
    assert.throws(() => new EnduranceJournal(f.directory, identity, false, true), /Truncated/);
  } finally { f.close(); }
});
