import { db } from "./db";
import { currentQueueOwner, queueOwnershipError } from "./queueOwnership";
import { ensureOfflineQueueReady } from "./writeQueue";
import { getShiftTerminalContext, terminalFenceKey } from "./shiftTerminal";

type RecordData = Record<string, any>;
export type ClosingQueueScope = { name: string; user?: string | null; pos_profile?: string | null };
const MONEY_ENTITIES = new Set(["invoice", "payment", "cash_movement", "restaurant_order"]);
const TERMINAL = new Set(["synced", "resolved", "acknowledged"]);
const linkName = (value: any): string => String(typeof value === "object" ? value?.name || "" : value || "").trim();

function belongsToShift(row: RecordData, payload: RecordData, scope: ClosingQueueScope) {
	const candidates = [payload.invoice, payload.args?.payload, payload.payload, payload.args, payload].filter(Boolean);
	const shift = candidates.map((value) => linkName(value.posa_pos_opening_shift || value.pos_opening_shift ||
		value.pos_opening_shift_name || value.opening_shift || value.opening_shift_name)).find(Boolean);
	if (shift) return shift === scope.name;
	// Older records may lack a shift. Exclude only a provably different
	// cashier/profile; unknown-owner money remains quarantined and blocks close.
	const profile = linkName(row.queue_profile) || candidates.map((value) => linkName(value.pos_profile)).find(Boolean);
	if (profile && scope.pos_profile && profile !== scope.pos_profile) return false;
	if (row.queue_user && scope.user && row.queue_user !== scope.user) return false;
	return true;
}

/** Read durable records, not the possibly empty/stale in-memory queue mirror. */
export async function getPendingShiftWorkCount(scope: ClosingQueueScope, fence = false): Promise<number> {
	if (!scope.name) throw queueOwnershipError("The opening shift could not be verified. Reopen the closing dialog.");
	const owner = currentQueueOwner();
	if (!owner) throw queueOwnershipError("The signed-in user changed.");
	const resolved = { ...scope, user: scope.user || owner.queue_user, pos_profile: linkName(scope.pos_profile) || owner.queue_profile };
	await ensureOfflineQueueReady();
	const queue = db.table("write_queue");
	const outbox = db.table("invoice_outbox");
	const keyval = db.table("keyval");
	const context = fence ? getShiftTerminalContext() : null;
	const count = await db.transaction(fence ? "rw" : "r", queue, outbox, keyval, async () => {
		const queued = await queue.toArray();
		const outgoing = await outbox.toArray();
		const pending = queued.filter((row) => MONEY_ENTITIES.has(row.entity_type) && !TERMINAL.has(row.status) &&
			belongsToShift(row, row.payload || {}, resolved)).length +
			outgoing.filter((row) => (!TERMINAL.has(row.status) ||
				(row.status === "acknowledged" && row.server_verified !== true)) && belongsToShift(row, row, resolved)).length;
		if (fence && !pending) await keyval.put({ key: terminalFenceKey(scope.name),
			value: { generation: context?.terminal_generation, created_at: Date.now() } });
		return pending;
	});
	const current = currentQueueOwner();
	if (!current || current.queue_user !== owner.queue_user || current.queue_profile !== owner.queue_profile) {
		throw queueOwnershipError("The signed-in user changed.");
	}
	return count;
}
