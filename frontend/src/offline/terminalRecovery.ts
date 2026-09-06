import { db, memory } from "./db";
import { getTerminalCredentials, getShiftTerminalContext } from "./shiftTerminal";
import { refreshQueueMemory } from "./writeQueue";

const __ = (text: string) => ((globalThis as any).__ || (globalThis as any).frappe?._ || ((value: string) => value))(text);

export async function getTerminalRecoverySales() {
	if (!memory.pos_opening_storage?.terminal_status?.can_manage) return [];
	const profile = memory.pos_opening_storage?.pos_profile?.name;
    const [rows, outbox] = await Promise.all([
        db.table("write_queue").where("entity_type").equals("invoice").toArray(),
        db.table("invoice_outbox").toArray(),
    ]);
    const pending = rows.filter((row) => !["synced", "resolved"].includes(row.status) &&
        row.payload?.invoice?.pos_profile === profile &&
        (row.payload?.invoice?.posa_client_request_id || row.payload?.data?.idempotency_key));
    for (const row of pending) {
        const id = row.payload.invoice.posa_client_request_id || row.payload.data?.idempotency_key;
        row.verify_only = outbox.some((entry) => entry.client_request_id === id &&
            (entry.reconcile_only === true || (entry.status === "acknowledged" && entry.server_verified !== true)));
    }
    const requestIds = new Set(rows.map((row) => row.payload?.invoice?.posa_client_request_id || row.payload?.data?.idempotency_key));
    for (const entry of outbox) {
        if (entry.invoice?.pos_profile !== profile || !entry.client_request_id ||
            requestIds.has(entry.client_request_id) || (entry.status === "acknowledged" && entry.server_verified === true)) continue;
        pending.push({ ...entry, queue_id: -entry.outbox_id, recovery_outbox_id: entry.outbox_id,
            idempotency_key: entry.client_request_id,
            verify_only: entry.reconcile_only === true || entry.status === "acknowledged",
            payload: { invoice: entry.invoice, data: { ...entry.data, idempotency_key: entry.client_request_id } } });
    }
    return pending;
}

export async function recoverTerminalSale(queueId: number, reason: string) {
	const manager = (globalThis as any).frappe?.session?.user;
	if (!memory.pos_opening_storage?.terminal_status?.can_manage) throw new Error(__("A POS supervisor must authorize saved-sale recovery."));
	const row = (await getTerminalRecoverySales()).find((entry) => entry.queue_id === queueId);
	if (!row) throw new Error(__("Saved sale is no longer available for recovery."));
	const requestId = row.payload.invoice.posa_client_request_id || row.payload.data?.idempotency_key;
	const response = await (globalThis as any).frappe.call({
		method: "posawesome.posawesome.api.offline_sync.recovery.recover_terminal_invoice",
		args: { opening_shift: memory.pos_opening_storage.pos_opening_shift.name,
			invoice: row.payload.invoice, data: row.payload.data || {}, reason, acknowledge_saved_work: 1, verify_only: Number(row.verify_only || false),
			...getTerminalCredentials(), ...getShiftTerminalContext() },
	});
	const result = response.message;
	if ((globalThis as any).frappe?.session?.user !== manager) throw new Error(__("The signed-in user changed. Saved work was preserved."));
	if (result?.client_request_id !== requestId || result?.invoice?.docstatus !== 1 || !result.invoice.name) {
		throw new Error(__("Recovered sale was not verified; its saved record was preserved."));
	}
	await db.transaction("rw", db.table("write_queue"), db.table("invoice_outbox"), async () => {
        if (!row.recovery_outbox_id) {
            const current = await db.table("write_queue").get(queueId);
            if (current?.idempotency_key !== row.idempotency_key || current?.queue_user !== row.queue_user ||
                JSON.stringify(current?.payload) !== JSON.stringify(row.payload)) throw new Error(__("Saved sale changed during recovery."));
            await db.table("write_queue").put({ ...current, status: "synced", last_error: null, next_attempt_at: null,
                recovery_invoice_name: result.invoice.name, recovery_reason: reason });
        } else {
            const current = await db.table("invoice_outbox").get(row.recovery_outbox_id);
            if (current?.client_request_id !== requestId || current?.queue_user !== row.queue_user ||
                JSON.stringify(current?.invoice) !== JSON.stringify(row.payload.invoice)) throw new Error(__("Saved sale changed during recovery."));
        }
		const mirrors = await db.table("invoice_outbox").where("client_request_id").equals(requestId).toArray();
		for (const mirror of mirrors) {
			if (mirror.queue_user !== row.queue_user || mirror.queue_profile !== row.queue_profile) continue;
			await db.table("invoice_outbox").put({ ...mirror, status: "acknowledged", server_verified: true,
				invoice_name: result.invoice.name, acknowledged_at: new Date().toISOString(), last_error: null });
		}
	});
	await refreshQueueMemory("invoice");
	return result;
}
