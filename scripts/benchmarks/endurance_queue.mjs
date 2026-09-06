import { setTimeout as sleep } from 'node:timers/promises';

export function durableCounts(state) {
  const write_queue_pending = state.queue.filter(row => !['synced', 'resolved'].includes(row.status)).length;
  const outbox_pending = state.outbox.filter(row => row.status !== 'resolved' &&
    !(row.status === 'acknowledged' && row.server_verified === true)).length;
  return { write_queue_pending, outbox_pending, queue_pending: write_queue_pending + outbox_pending };
}

export async function waitForDurableDrain(read, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await read(); // A failed IndexedDB read is not an empty queue.
    if (durableCounts(state).queue_pending === 0) return state;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(1000, deadline - Date.now()));
  } while (Date.now() <= deadline);
  throw Error('Durable queue/outbox did not drain');
}

export function recoveredAck({ confirmed, seen, accounting, reads, state }) {
  const ids = [...new Set(seen)];
  if (!confirmed || ids.length !== 1 || !ids[0] || accounting?.request_id !== ids[0]
    || accounting?.docstatus !== 1 || accounting?.verified !== true || !accounting?.invoice
    || durableCounts(state).queue_pending !== 0) throw Error('ACK recovery lacks exact native/queue proof');
  const direct = reads.some(row => row.kind !== 'verified_outbox' && row.invoice === accounting.invoice && row.docstatus === 1);
  const outbox = reads.some(row => row.kind === 'verified_outbox' && row.request_id === ids[0]
    && row.invoice === accounting.invoice && row.docstatus === 1)
    || state.outbox.some(row => row.client_request_id === ids[0] && row.invoice_name === accounting.invoice
    && row.status === 'acknowledged' && row.server_verified === true);
  if (!direct && seen.length < 2 && !outbox) throw Error('No observed browser recovery of the lost ACK');
  return { verified: true, kind: direct ? 'direct_docstatus' : outbox ? 'verified_outbox' : 'same_request_replay',
    request_id: ids[0], invoice: accounting.invoice, submit_attempts: seen.length };
}
