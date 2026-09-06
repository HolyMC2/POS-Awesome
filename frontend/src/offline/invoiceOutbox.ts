import { checkDbHealth, db, initPromise, memory, persist, safeBulkPut } from "./db";

import { assertQueueOwner, captureQueueOwner, ownsQueueEntry, type QueueOwner } from "./queueOwnership";
import { refreshQueueMemory } from "./writeQueue";
import { assertTerminalEnqueueAllowed, stampTerminalPayload } from "./shiftTerminal";

type AnyRecord = Record<string, any>;

export type InvoiceOutboxMode = "off" | "dual_write" | "coordinator";
export type InvoiceOutboxStatus =
	| "pending"
	| "syncing"
	| "retrying"
	| "acknowledged"
	| "dead_letter";

export interface InvoiceOutboxEntry extends Partial<QueueOwner> {
	outbox_id?: number;
	client_request_id: string;
	resource?: "invoice_outbox";
	status: InvoiceOutboxStatus;
	invoice: AnyRecord;
	data: AnyRecord;
	created_at: string;
	updated_at: string;
	next_retry_at: string | null;
	nextAttemptAt?: string | null;
	retry_count: number;
	last_error: string | null;
	invoice_name: string | null;
	acknowledged_at: string | null;
	/** Old acknowledgements are not proof of a submitted server document. */
	server_verified?: boolean;
	/** Recovery may verify existing identity, but must never create a sale. */
	reconcile_only?: boolean;
	// operator-driven dead-letter requeues (SPEC A); no auto-retry cap
	requeue_count?: number;
}

const TABLE = "invoice_outbox";
const MAX_RETRY_COUNT = 5;
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60 * 1_000;
const TERMINAL_STATUSES = new Set<InvoiceOutboxStatus>([
	"acknowledged",
	"dead_letter",
]);

function nowIso() {
	return new Date().toISOString();
}

function cloneSerializable<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

function toErrorMessage(error: unknown) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error || "Unknown error");
	}
}

async function ensureOutboxReady() {
	await initPromise;
	await checkDbHealth();
	if (!db.isOpen()) {
		await db.open();
	}
}

export function getInvoiceOutboxMode(): InvoiceOutboxMode {
	const mode = memory.invoice_outbox_mode;
	return mode === "dual_write" || mode === "coordinator" ? mode : "off";
}

export function setInvoiceOutboxMode(mode: InvoiceOutboxMode) {
	memory.invoice_outbox_mode = mode;
	persist("invoice_outbox_mode", mode);
}

export function shouldWriteInvoiceOutbox() {
	return getInvoiceOutboxMode() !== "off";
}

function getClientRequestId(entry: AnyRecord) {
	return String(
		entry?.invoice?.posa_client_request_id ||
			entry?.data?.idempotency_key ||
			entry?.data?.client_request_id ||
			"",
	).trim();
}

export async function enqueueInvoiceOutboxEntry(entry: AnyRecord) {
	const owner = captureQueueOwner(entry);
	await ensureOutboxReady();
	assertQueueOwner(owner);
	const cleanEntry = cloneSerializable(entry);
	stampTerminalPayload(cleanEntry);
	const clientRequestId = getClientRequestId(cleanEntry);
	if (!clientRequestId) {
		throw new Error("Invoice outbox entry requires a client_request_id");
	}

	const table = db.table(TABLE);
	return db.transaction("rw", table, db.table("keyval"), async () => {
		await assertTerminalEnqueueAllowed(cleanEntry);
		const existing = (await table
			.where("client_request_id")
			.equals(clientRequestId)
			.first()) as InvoiceOutboxEntry | undefined;
		if (existing) {
			assertQueueOwner(existing);
			return existing;
		}

		const timestamp = nowIso();
		const outboxEntry: InvoiceOutboxEntry = {
			...owner,
			client_request_id: clientRequestId,
			resource: "invoice_outbox",
			status: "pending",
			invoice: cleanEntry.invoice,
			data: cleanEntry.data || {},
			created_at: timestamp,
			updated_at: timestamp,
			next_retry_at: null,
			nextAttemptAt: null,
			retry_count: 0,
			last_error: null,
			invoice_name: null,
			acknowledged_at: null,
		};
		assertQueueOwner(owner);
		const outboxId = await table.add(outboxEntry);
		return { ...outboxEntry, outbox_id: outboxId };
	});
}

export async function getInvoiceOutboxRows(
	options: { includeTerminal?: boolean } = {},
) {
	await ensureOutboxReady();
	const rows = (await db
		.table(TABLE)
		.orderBy("created_at")
		.toArray()) as InvoiceOutboxEntry[];
	return rows.filter(
		(row) => ownsQueueEntry(row) && (options.includeTerminal ||
			(row.status === "acknowledged" && row.server_verified !== true) || !TERMINAL_STATUSES.has(row.status)),
	);
}

export async function getPendingInvoiceOutboxCount() {
	return (await getInvoiceOutboxRows()).length;
}

// ---- dead-letter surface (2026-07-11 audit SPEC A) -------------------
// A sale that exhausted MAX_RETRY_COUNT syncs used to fall into the
// terminal filter and vanish from every count — cash in the drawer, no
// invoice, no signal. These give the badge/panel a distinct view plus an
// operator-driven requeue (replay-safe: the server ledger replays by
// client_request_id, so a late retry cannot double-bill).

export async function getDeadLetterRows() {
	await ensureOutboxReady();
	const rows = (await db
		.table(TABLE)
		.orderBy("created_at")
		.toArray()) as InvoiceOutboxEntry[];
	return rows.filter((row) => ownsQueueEntry(row) && row.status === "dead_letter");
}

export async function getDeadLetterCount() {
	return (await getDeadLetterRows()).length;
}

export async function requeueDeadLetterEntry(clientRequestId: string) {
	await ensureOutboxReady();
	const rows = (await db.table(TABLE).toArray()) as InvoiceOutboxEntry[];
	const row = rows.find(
		(r) => ownsQueueEntry(r) && r.client_request_id === clientRequestId && r.status === "dead_letter",
	);
	if (!row) return null;
	const updated: InvoiceOutboxEntry = {
		...row,
		status: "retrying",
		updated_at: nowIso(),
		next_retry_at: nowIso(),
		nextAttemptAt: nowIso(),
		// keep retry history visible; the operator loop has no auto-retry cap
		requeue_count: Number((row as AnyRecord).requeue_count || 0) + 1,
	} as InvoiceOutboxEntry;
	assertQueueOwner(updated);
	await safeBulkPut(TABLE, [updated]);
	return updated;
}

export async function exportDeadLetterEntry(clientRequestId: string) {
	const rows = await getDeadLetterRows();
	const row = rows.find((r) => r.client_request_id === clientRequestId);
	if (!row) return null;
	return cloneSerializable({
		client_request_id: row.client_request_id,
		invoice: row.invoice,
		data: row.data,
		retry_count: row.retry_count,
		last_error: row.last_error,
		created_at: row.created_at,
		invoice_name: row.invoice_name,
		reconcile_only: row.reconcile_only === true,
	});
}

function shouldAttempt(row: InvoiceOutboxEntry) {
	if (row.status === "acknowledged" && row.server_verified !== true) return true;
	if (TERMINAL_STATUSES.has(row.status)) return false;
	if (row.status === "syncing" && Date.now() - Date.parse(row.updated_at) < 5 * 60_000) return false;
	if (!row.next_retry_at) return true;
	const nextRetryAt = Date.parse(row.next_retry_at);
	return !Number.isFinite(nextRetryAt) || nextRetryAt <= Date.now();
}

function computeBackoffMs(retryCount: number) {
	const multiplier = 2 ** Math.max(0, retryCount - 1);
	return Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * multiplier);
}

function markOutboxAcknowledged(
	row: InvoiceOutboxEntry,
	response: AnyRecord,
): InvoiceOutboxEntry {
	const timestamp = nowIso();
	return {
		...row,
		status: "acknowledged",
		resource: "invoice_outbox" as const,
		updated_at: timestamp,
		acknowledged_at: timestamp,
		server_verified: true,
		last_error: null,
		next_retry_at: null,
		nextAttemptAt: null,
		invoice_name:
			response?.invoice?.name ||
			response?.name ||
			row.invoice_name ||
			null,
	};
}

function markOutboxFailed(row: InvoiceOutboxEntry, error: unknown): InvoiceOutboxEntry {
	const retryCount = Number(row.retry_count || 0) + 1;
	const status: InvoiceOutboxStatus =
		retryCount >= MAX_RETRY_COUNT ? "dead_letter" : "retrying";
	const nextRetryAt =
		status === "dead_letter"
			? null
			: new Date(Date.now() + computeBackoffMs(retryCount)).toISOString();
	return {
		...row,
		resource: "invoice_outbox" as const,
		status,
		retry_count: retryCount,
		updated_at: nowIso(),
		next_retry_at: nextRetryAt,
		nextAttemptAt: nextRetryAt,
		last_error: toErrorMessage(error),
	};
}

export async function syncInvoiceOutboxResource(
	callOfflineSyncMethod: (
		method: string,
		args?: Record<string, any>,
	) => Promise<any>,
) {
	await ensureOutboxReady();
	let acknowledged = 0;
	let failed = 0;
	const claimTimestamp = nowIso();
	const table = db.table(TABLE);
	const claimedRows = await db.transaction("rw", table, async () => {
		const rows = await table.orderBy("created_at").toArray() as InvoiceOutboxEntry[];
		const claimed: InvoiceOutboxEntry[] = [];
		for (const row of rows) {
			if (!ownsQueueEntry(row) || !shouldAttempt(row)) continue;
			const next: InvoiceOutboxEntry = {
				...row, resource: "invoice_outbox", status: "syncing",
				reconcile_only: row.reconcile_only === true || (row.status === "acknowledged" && row.server_verified !== true),
				updated_at: claimTimestamp, nextAttemptAt: row.next_retry_at || null,
			};
			await table.put(next);
			claimed.push(next);
		}
		return claimed;
	});
	const finalRows: InvoiceOutboxEntry[] = [];

	for (const claimed of claimedRows) {
		if (!ownsQueueEntry(claimed)) break;
		try {
			const documentType = claimed.invoice?.doctype || "Sales Invoice";
			if (claimed.reconcile_only && (!claimed.invoice?.company || !claimed.invoice?.pos_profile)) {
				throw new Error("Saved acknowledgement is missing company or POS profile; manager review is required");
			}
			const response = await callOfflineSyncMethod(
				`posawesome.posawesome.api.offline_sync.invoices.${claimed.reconcile_only ? "reconcile_invoice_outbox_entry" : "submit_invoice_outbox_entry"}`,
				claimed.reconcile_only ? {
					client_request_id: claimed.client_request_id,
					company: claimed.invoice.company,
					pos_profile: claimed.invoice.pos_profile,
					document_type: documentType,
				} : {
					client_request_id: claimed.client_request_id,
					invoice: claimed.invoice,
					data: claimed.data,
				},
			);
			if (claimed.reconcile_only && (response?.client_request_id !== claimed.client_request_id ||
				!response?.invoice?.name || response.invoice.doctype !== documentType ||
				(claimed.invoice_name && response.invoice.name !== claimed.invoice_name))) {
				throw new Error("Reconciled invoice identity does not match saved work; manager review is required");
			}
			const docstatus = response?.invoice?.docstatus ?? response?.docstatus;
			if (Number(docstatus) !== 1) {
				throw new Error("Invoice outbox document is not submitted; sync or review is still required");
			}
			if (response?.acknowledged || response?.invoice || response?.name) {
				finalRows.push(markOutboxAcknowledged(claimed, response || {}));
				acknowledged += 1;
			} else {
				throw new Error("Invoice outbox response was not acknowledged");
			}
		} catch (error) {
			failed += 1;
			finalRows.push(markOutboxFailed(claimed, error));
		}
	}
	if (finalRows.length) {
		const queue = db.table("write_queue");
		await db.transaction("rw", table, queue, async () => {
			const mirrors = await queue.where("entity_type").equals("invoice").toArray();
			for (const result of finalRows) {
				const current = await table.get(result.outbox_id);
				if (current && ownsQueueEntry(current) && current.status === "syncing" &&
					current.updated_at === claimTimestamp) {
					await table.put(result);
					if (result.status !== "acknowledged") continue;
					// Coordinator mode writes both queues. Complete the same request
					// atomically, so a successful sale cannot remain pending forever.
					for (const mirror of mirrors) {
						if (!ownsQueueEntry(mirror) || mirror.queue_user !== result.queue_user ||
							mirror.queue_profile !== result.queue_profile ||
							mirror.payload?.invoice?.posa_client_request_id !== result.client_request_id) continue;
						await queue.put({ ...mirror, status: "synced", last_error: null, next_attempt_at: null });
					}
				}
			}
		});
		await refreshQueueMemory("invoice");
	}

	const pending = await getPendingInvoiceOutboxCount();
	return {
		resourceId: "invoice_outbox",
		status: failed ? "error" : "fresh",
		lastError: failed
			? `${failed} invoice outbox entr${failed === 1 ? "y" : "ies"} failed`
			: null,
		watermark: nowIso(),
		lastSyncedAt: nowIso(),
		consecutiveFailures: failed ? 1 : 0,
		pendingCount: pending,
		acknowledged,
	};
}
