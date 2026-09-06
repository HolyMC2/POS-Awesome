import test from 'node:test';
import assert from 'node:assert/strict';
import { durableCounts, recoveredAck, waitForDurableDrain } from './endurance_queue.mjs';

const empty = () => ({ queue: [], outbox: [] });
const accounting = { invoice: 'PRIVATE-INV', request_id: 'inv-private', docstatus: 1, verified: true };
const proof = () => ({ confirmed: true, seen: ['inv-private'], accounting,
  reads: [{ invoice: 'PRIVATE-INV', docstatus: 1 }], state: empty() });

test('empty durable stores are drained, but require observed same-invoice recovery to prove ACK loss', async () => {
  assert.deepEqual(await waitForDurableDrain(async () => empty(), 0), empty());
  assert.equal(recoveredAck(proof()).kind, 'direct_docstatus');
  assert.throws(() => recoveredAck({ ...proof(), reads: [] }), /No observed browser recovery/);
});

test('IndexedDB read failure propagates instead of becoming an empty queue', async () => {
  const failure = Error('IndexedDB unavailable');
  await assert.rejects(waitForDurableDrain(async () => { throw failure; }, 0), error => error === failure);
});

test('pending queue rows and unverified historical outbox ACKs block drainage', async () => {
  for (const state of [
    { queue: [{ status: 'pending' }], outbox: [] },
    { queue: [], outbox: [{ status: 'acknowledged', server_verified: false }] },
    { queue: [], outbox: [{ status: 'dead_letter' }] },
  ]) {
    assert.equal(durableCounts(state).queue_pending, 1);
    await assert.rejects(waitForDurableDrain(async () => state, 0), /did not drain/);
    assert.throws(() => recoveredAck({ ...proof(), state }), /native\/queue proof/);
  }
});

test('a server verified outbox ACK can prove recovery without a retained queue row', () => {
  const state = { queue: [], outbox: [{ client_request_id: 'inv-private', invoice_name: 'PRIVATE-INV',
    status: 'acknowledged', server_verified: true }] };
  assert.equal(recoveredAck({ ...proof(), reads: [], state }).kind, 'verified_outbox');
});

test('only repeated original request plus native exact identity can prove replay', () => {
  assert.equal(recoveredAck({ ...proof(), reads: [], seen: ['inv-private', 'inv-private'] }).kind, 'same_request_replay');
  assert.throws(() => recoveredAck({ ...proof(), seen: ['inv-private', 'inv-other'] }), /native\/queue proof/);
  assert.throws(() => recoveredAck({ ...proof(), confirmed: false }), /native\/queue proof/);
  assert.throws(() => recoveredAck({ ...proof(), accounting: { ...accounting, docstatus: 0 } }), /native\/queue proof/);
  assert.throws(() => recoveredAck({ ...proof(), accounting: { ...accounting, request_id: 'inv-other' } }), /native\/queue proof/);
});

test('a successful docstatus read for a different invoice cannot prove recovery', () => {
  assert.throws(() => recoveredAck({ ...proof(), reads: [{ invoice: 'OTHER', docstatus: 1 }] }), /No observed browser recovery/);
});

test('a verified reconciliation response must bind both original request and invoice', () => {
  const read = { kind: 'verified_outbox', invoice: 'PRIVATE-INV', request_id: 'inv-private', docstatus: 1 };
  assert.equal(recoveredAck({ ...proof(), reads: [read] }).kind, 'verified_outbox');
  assert.throws(() => recoveredAck({ ...proof(), reads: [{ ...read, request_id: 'inv-other' }] }), /No observed browser recovery/);
  assert.throws(() => recoveredAck({ ...proof(), reads: [{ ...read, docstatus: 0 }] }), /No observed browser recovery/);
});
