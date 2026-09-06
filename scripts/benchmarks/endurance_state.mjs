import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MINIMUM = Object.freeze({ duration_ms: 8 * 60 * 60 * 1000, iterations: 500, financial_cycles: 20 });
export const FAULTS = ['reload', 'offline', 'reconnect', 'session_expiry'];
export const digest = value => createHash('sha256').update(value).digest('hex');

export function cyclePlan(index, smoke = false, onlineSmoke = false) {
  const financial = smoke ? index === 2 : index % 25 === 0;
  const fault = financial ? (smoke ? (onlineSmoke ? 'ack_loss' : 'offline_ack') : index % 50 === 0 ? 'ack_loss' : 'offline_sale')
    : onlineSmoke && index === 4 ? 'offline'
    : ['normal', 'reload', 'offline', 'session_expiry', 'normal'][index % 5];
  return { index, financial, fault };
}

export function atomicJson(path, value) {
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
}

export class EnduranceJournal {
  constructor(directory, identity, smoke = false, resume = false) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.path = join(directory, 'journal.jsonl');
    this.identity = identity;
    this.smoke = smoke;
    this.rows = [];
    if (existsSync(this.path)) {
      if (!resume) throw Error('Run already exists; explicit resume is required');
      const source = readFileSync(this.path, 'utf8');
      if (!source.endsWith('\n')) throw Error('Truncated journal; run cannot certify');
      let previous = '';
      for (const line of source.trim().split('\n')) {
        const row = JSON.parse(line);
        const { hash, ...body } = row;
        if (body.previous !== previous || digest(JSON.stringify(body)) !== hash) throw Error('Journal hash mismatch');
        this.rows.push(row); previous = hash;
      }
      const start = this.rows[0];
      if (JSON.stringify(start.identity) !== JSON.stringify(identity) || start.smoke !== smoke) throw Error('Resume identity mismatch');
      const last = this.rows.at(-1);
      if (this.rows.some(row => row.type === 'failed' || row.type === 'completed')) throw Error('Terminal runs cannot resume');
      if (this.rows.filter(row => row.type === 'cycle_started').length > this.cycles.length) throw Error('Interrupted cycle requires reconciliation; run cannot certify');
    } else {
      this.append('started', { identity, smoke, requested: smoke ? { duration_ms: 0, iterations: 5, financial_cycles: 1 } : MINIMUM });
    }
  }
  append(type, data = {}) {
    const body = { sequence: this.rows.length, at: new Date().toISOString(), type, ...data, previous: this.rows.at(-1)?.hash || '' };
    const row = { ...body, hash: digest(JSON.stringify(body)) };
    const fd = openSync(this.path, 'a', 0o600);
    try { appendFileSync(fd, `${JSON.stringify(row)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    this.rows.push(row);
    return row;
  }
  get cycles() { return this.rows.filter(row => row.type === 'cycle_completed'); }
  report(status, extra = {}) {
    const cycles = this.cycles;
    const financial = cycles.filter(row => row.plan.financial);
    const faultCounts = {};
    for (const row of cycles) for (const fault of row.faults || []) faultCounts[fault] = (faultCounts[fault] || 0) + 1;
    const duration = cycles.reduce((sum, row) => sum + row.active_ms, 0) / 1000;
    const samples = cycles.map(row => row.metrics);
    const baseline = this.rows.find(row => row.type === 'baseline')?.metrics;
    const last = samples.at(-1);
    const limits = this.smoke ? { duration_ms: 0, iterations: 5, financial_cycles: 1 } : MINIMUM;
    const assertions = {
      completed: status === 'completed',
      duration_met: duration * 1000 >= limits.duration_ms,
      iterations_met: cycles.length >= limits.iterations,
      financial_cycles_met: financial.length === limits.financial_cycles,
      financial_native_verified: financial.every(({ accounting: row }) => row?.verified === true && row.docstatus === 1 &&
        row.invoice && row.request_id && Number(row.gl_rows) >= 2 && Number(row.gl_debit) > 0 &&
        Math.abs(Number(row.gl_debit) - Number(row.gl_credit)) < 0.001 && Number(row.outstanding_amount) === 0),
      faults_exercised: FAULTS.every(key => faultCounts[key] > 0),
      ack_loss_exercised: faultCounts.ack_loss > 0,
      queue_drained: baseline?.queue_pending === 0 && last?.queue_pending === 0,
      unique_financial_documents: new Set(financial.map(row => row.accounting?.invoice)).size === financial.length &&
        new Set(financial.map(row => row.accounting?.request_id)).size === financial.length,
      no_global_errors: cycles.every(row => row.page_errors === 0),
      no_unfinished_cycle: this.rows.at(-1)?.type !== 'cycle_started',
      exact_build: cycles.every(row => row.build_version === this.identity.build.version),
      heap_bounded: !!baseline && samples.every(row => row.heap_bytes <= baseline.heap_bytes * 2 + 32 * 1024 * 1024),
      listeners_bounded: !!baseline && samples.every(row => row.listeners <= baseline.listeners + 40),
      realtime_single_script: samples.every(row => row.realtime_scripts <= 1),
      ...extra.assertions,
    };
    Object.assign(assertions, {
      financial_invariants: assertions.financial_native_verified && extra.final_audit?.verified === true && extra.final_audit?.submitted === financial.length,
      no_duplicates: assertions.unique_financial_documents && extra.final_audit?.duplicate_financial_documents === 0,
      no_page_errors: assertions.no_global_errors,
      listener_budget: assertions.listeners_bounded,
      heap_budget: assertions.heap_bounded,
      ack_loss_recovered: assertions.ack_loss_exercised && cycles.filter(row => row.faults?.includes('ack_loss'))
        .every(row => row.ack_recovery?.verified === true && row.ack_recovery.invoice === row.accounting?.invoice
          && row.ack_recovery.request_id === row.accounting?.request_id),
    });
    const passed = status === 'completed' && Object.values(assertions).every(value => value === true);
    const evidence = {
      schema_version: 1, gate: 'endurance', kind: this.smoke ? 'endurance_smoke' : 'endurance',
      certifiable: !this.smoke, identity: this.identity, status,
      started_at: this.rows[0].at, finished_at: ['completed', 'failed'].includes(status) ? new Date().toISOString() : null,
      process_exit: status === 'completed' ? (passed ? 0 : 1) : status === 'failed' ? 1 : null,
      summary: { passed: cycles.length, failed: passed || !['failed', 'completed'].includes(status) ? 0 : 1, skipped: 0, flaky: 0, global_errors: this.rows.filter(row => row.type === 'failed').length },
      metrics: { duration_seconds: duration, iterations: cycles.length, financial_cycles: financial.length,
        fault_counts: faultCounts, queue_start: baseline?.queue_pending ?? null, queue_end: last?.queue_pending ?? null,
        duplicate_financial_documents: financial.length - new Set(financial.map(row => row.accounting?.invoice)).size,
        heap_start: baseline?.heap_bytes ?? null, heap_end: last?.heap_bytes ?? null,
        heap_max: samples.length ? Math.max(...samples.map(row => row.heap_bytes)) : null,
        listeners_start: baseline?.listeners ?? null, listeners_end: last?.listeners ?? null },
      assertions, artifacts: [{ path: 'journal.jsonl', sha256: digest(readFileSync(this.path)) }],
      limitations: ['Nonstock fixture: no inventory endurance claim.', 'UI iterations and native financial postings are counted separately.', 'Memory thresholds use forced-GC retained heap, not process RSS.'],
      ...extra, assertions,
    };
    atomicJson(join(this.directory, 'status.json'), evidence);
    return evidence;
  }
}
