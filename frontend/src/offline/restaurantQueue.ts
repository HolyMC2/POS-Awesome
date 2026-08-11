/**
 * Write queue for table-order mutations.
 *
 * Registers a {@link WriteQueuePlugin} for the `restaurant_order` entity so the
 * merge rules live here rather than in the queue plumbing, and owns the drain
 * that replays queued mutations in dependency order.
 *
 * ## Queue identity
 * One entry per `(kind, order_uid)`:
 * `restaurant:order:<kind>:<order_uid>`. `open`, `transfer`, `settle` and
 * `cancel` are one-per-order by construction; `update` accumulates.
 *
 * ## `restaurant:order:settle` — queued here, refused at the UI
 * The queue path is durable and complete: a settle replays under the SAME
 * `client_request_id` as the attempt that queued it, so
 * `invoice_processing.creation`'s submission ledger dedupes an ack-miss rather
 * than double-billing. v1 refuses a queued settle at the payment seam instead
 * (that seam prints and navigates off the submitted invoice doc, which a queued
 * settle has not got yet) — a product decision at the UI, deliberately NOT
 * amputated from the queue, so a later phase can enable offline settle without
 * rebuilding this.
 *
 * ## Coalescing (spec §6.1)
 * The only in-repo precedent — `customer:update:*` in `writeQueue.ts` — is a
 * whole-payload last-write-wins replace, which for an order would silently drop
 * the lines a waiter added in the earlier write. `update` therefore uses a
 * **per-line union** instead: lines merge by `line_uid` (later wins per line),
 * `removed_line_uids` unions, scalars take the latest non-undefined value.
 * `transfer` genuinely is last-write-wins (a single destination). The rest
 * dedupe to the queued entry untouched.
 *
 * ## Why a coalesced entry mints a NEW client_request_id
 * The server dedupes on `posa_client_request_id` and answers an already-applied
 * id with a no-op. If a send is applied but its ack is lost, the entry comes
 * back as `failed` with content the server already holds — merging new lines in
 * under the *same* id would make the replay a no-op and lose them. Content
 * change ⇒ new id; a plain retry never changes content, so retries and replays
 * reuse the id exactly as idempotency requires.
 *
 * ## Replay order
 * `open → update(s) → transfer → settle` per `order_uid`. Coalescing preserves
 * the original `created_at`, so claim order already encodes this. A failure
 * releases the rest of that order's group back to `pending` untouched — a
 * queued `update` must never reach a server that has not seen its `open`.
 *
 * @module offline/restaurantQueue
 */
import { isOffline } from "./db";
import { generateTableOrderRequestId } from "./idempotency";
import { getOfflineCapabilityVersion } from "./invoices";
import { applyServerOrder } from "./restaurantOrders";
import type {
	OrderLine,
	RestaurantQueueKind,
	RestaurantQueuePayload,
} from "./restaurantTypes";
import {
	claimRetryableQueueEntries,
	enqueueWriteQueueEntry,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	markWriteQueueEntryFailed,
	markWriteQueueEntrySynced,
	registerWriteQueuePlugin,
	releaseClaimedQueueEntry,
	type OfflineEntityType,
	type OfflineQueueEntry,
} from "./writeQueue";

declare const frappe: any;

type AnyRecord = Record<string, any>;

export const RESTAURANT_ORDER_ENTITY: OfflineEntityType = "restaurant_order";

const ENDPOINTS: Record<RestaurantQueueKind, string> = {
	"restaurant:order:open":
		"posawesome.posawesome.api.restaurant.orders.open_table_order",
	"restaurant:order:update":
		"posawesome.posawesome.api.restaurant.orders.update_table_order",
	"restaurant:order:transfer":
		"posawesome.posawesome.api.restaurant.orders.transfer_table_order",
	"restaurant:order:cancel":
		"posawesome.posawesome.api.restaurant.orders.cancel_table_order",
	"restaurant:order:settle":
		"posawesome.posawesome.api.restaurant.settle.settle_table_order",
};

/** Replay precedence within one order_uid; lower drains first. */
const KIND_ORDER: Record<RestaurantQueueKind, number> = {
	"restaurant:order:open": 0,
	"restaurant:order:update": 1,
	"restaurant:order:transfer": 2,
	"restaurant:order:cancel": 3,
	"restaurant:order:settle": 4,
};

const cloneSerializable = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const nowIso = () => new Date().toISOString();

function asPayload(value: AnyRecord): RestaurantQueuePayload | null {
	const kind = String(value?.kind || "") as RestaurantQueueKind;
	if (!ENDPOINTS[kind] || !value?.order_uid) {
		return null;
	}
	return value as RestaurantQueuePayload;
}

export function buildRestaurantQueueKey(
	kind: RestaurantQueueKind,
	orderUid: string,
) {
	return `${kind}:${orderUid}`;
}

// ---- coalesce --------------------------------------------------------------

function mergeLines(
	existing: OrderLine[] | undefined,
	incoming: OrderLine[] | undefined,
): OrderLine[] {
	const merged = new Map<string, OrderLine>();
	for (const line of existing || []) {
		const uid = String(line?.line_uid || "").trim();
		if (uid) {
			merged.set(uid, line);
		}
	}
	for (const line of incoming || []) {
		const uid = String(line?.line_uid || "").trim();
		if (!uid) {
			continue;
		}
		const previous = merged.get(uid);
		// Field-level merge, not replace: a partial later write (e.g. only a
		// note edit) must not blank the qty/rate the earlier write carried.
		merged.set(uid, previous ? { ...previous, ...line } : line);
	}
	return [...merged.values()];
}

function unionUids(
	existing: string[] | undefined,
	incoming: string[] | undefined,
) {
	const all = new Set<string>();
	for (const uid of [...(existing || []), ...(incoming || [])]) {
		const trimmed = String(uid || "").trim();
		if (trimmed) {
			all.add(trimmed);
		}
	}
	return [...all];
}

/** Latest defined value wins; `undefined` means "not touched by this write". */
function mergeScalars(existing: AnyRecord, incoming: AnyRecord) {
	const merged: AnyRecord = { ...existing };
	for (const [key, value] of Object.entries(incoming)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged;
}

export function coalesceUpdateArgs(existing: AnyRecord, incoming: AnyRecord) {
	const merged = mergeScalars(existing, incoming);
	merged.lines = mergeLines(existing?.lines, incoming?.lines);
	merged.removed_line_uids = unionUids(
		existing?.removed_line_uids,
		incoming?.removed_line_uids,
	);
	// A line re-added after being removed is no longer a removal, and a line
	// removed after being edited must not travel as an upsert.
	const removed = new Set<string>(merged.removed_line_uids);
	const readded = new Set(
		(incoming?.lines || []).map((line: OrderLine) =>
			String(line?.line_uid || ""),
		),
	);
	merged.removed_line_uids = merged.removed_line_uids.filter(
		(uid: string) => !readded.has(uid),
	);
	merged.lines = merged.lines.filter(
		(line: OrderLine) => !removed.has(String(line?.line_uid || "")) ||
			readded.has(String(line?.line_uid || "")),
	);
	return merged;
}

function coalesceRestaurantPayload(
	existing: OfflineQueueEntry,
	incoming: AnyRecord,
): AnyRecord | null {
	const queued = asPayload(existing.payload);
	const next = asPayload(incoming);
	if (!queued || !next || queued.kind !== next.kind) {
		return null;
	}

	// A synced entry's content is already server-side truth; merging into it
	// would replay settled work and grow the payload without bound. Start fresh
	// from the incoming write instead.
	const supersede = existing.status === "synced";

	if (next.kind === "restaurant:order:update") {
		return {
			...next,
			client_request_id: generateTableOrderRequestId(),
			args: supersede
				? next.args
				: coalesceUpdateArgs(queued.args || {}, next.args || {}),
			queued_at: nowIso(),
		};
	}

	if (next.kind === "restaurant:order:transfer") {
		// One destination — the last one the waiter picked is the intent.
		return {
			...next,
			client_request_id: generateTableOrderRequestId(),
			queued_at: nowIso(),
		};
	}

	// open / settle / cancel: re-issuing is a no-op the server already dedupes
	// on order_uid or on status. Never re-mint an id for money (settle).
	return null;
}

function normalizeRestaurantPayload(payload: AnyRecord): AnyRecord {
	const next = cloneSerializable(payload);
	if (!String(next.client_request_id || "").trim()) {
		next.client_request_id = generateTableOrderRequestId();
	}
	if (!next.queued_at) {
		next.queued_at = nowIso();
	}
	// Stamp the capability payload the write was BUILT under so a replay
	// against a register that has since changed preset is held for review
	// rather than applied blind (spec §6.9). Undefined when no preset is
	// linked — the retail default — which leaves the guard inert.
	const capabilityVersion = getOfflineCapabilityVersion();
	if (capabilityVersion !== undefined) {
		next.posa_capability_version = capabilityVersion;
	}
	return next;
}

registerWriteQueuePlugin(RESTAURANT_ORDER_ENTITY, {
	normalizePayload: normalizeRestaurantPayload,
	deriveIdempotencyKey: (payload) => {
		const parsed = asPayload(payload);
		return parsed ? buildRestaurantQueueKey(parsed.kind, parsed.order_uid) : null;
	},
	coalesce: coalesceRestaurantPayload,
});

// ---- enqueue ---------------------------------------------------------------

export async function enqueueRestaurantMutation(args: {
	kind: RestaurantQueueKind;
	orderUid: string;
	args: AnyRecord;
	clientRequestId?: string;
}) {
	const payload: RestaurantQueuePayload = {
		kind: args.kind,
		order_uid: args.orderUid,
		client_request_id: args.clientRequestId || generateTableOrderRequestId(),
		args: args.args,
		queued_at: nowIso(),
	};
	return enqueueWriteQueueEntry(RESTAURANT_ORDER_ENTITY, payload);
}

export function getQueuedRestaurantMutations() {
	return getQueuedPayloadSnapshots(RESTAURANT_ORDER_ENTITY);
}

export function getPendingRestaurantMutationCount() {
	return getQueuedPayloadCount(RESTAURANT_ORDER_ENTITY);
}

// ---- drain -----------------------------------------------------------------

function buildEndpointArgs(payload: RestaurantQueuePayload): AnyRecord {
	const args: AnyRecord = { ...(payload.args || {}) };
	// cancel_table_order takes only name_or_uid — passing an unexpected kwarg
	// raises TypeError server-side before any guard runs.
	if (payload.kind !== "restaurant:order:cancel") {
		args.client_request_id = payload.client_request_id;
	}
	return args;
}

function unwrapMessage(response: any) {
	return typeof response?.message === "undefined" ? response : response.message;
}

function describeError(error: unknown) {
	const candidate = error as AnyRecord | null;
	return (
		candidate?.exc_type ||
		candidate?.message ||
		(typeof error === "string" ? error : "") ||
		"Table order sync failed"
	);
}

function compareEntries(left: OfflineQueueEntry, right: OfflineQueueEntry) {
	const leftPayload = asPayload(left.payload);
	const rightPayload = asPayload(right.payload);
	const leftRank = leftPayload ? KIND_ORDER[leftPayload.kind] : 99;
	const rightRank = rightPayload ? KIND_ORDER[rightPayload.kind] : 99;
	if (leftRank !== rightRank) {
		return leftRank - rightRank;
	}
	return String(left.created_at).localeCompare(String(right.created_at));
}

export interface RestaurantDrainTotals {
	pending: number;
	synced: number;
	failed: number;
	blocked: number;
}

/**
 * Replay queued table-order mutations.
 *
 * Sequential per `order_uid` and stops that order at its first failure, so a
 * lost `open` never leaves its `update` to hit a server that has never heard of
 * the order. Different orders are independent and keep draining.
 */
export async function syncRestaurantOrders(): Promise<RestaurantDrainTotals> {
	const idle = {
		pending: getPendingRestaurantMutationCount(),
		synced: 0,
		failed: 0,
		blocked: 0,
	};

	if (isOffline()) {
		return idle;
	}
	if (typeof frappe === "undefined" || typeof frappe.call !== "function") {
		return idle;
	}

	const claimed = await claimRetryableQueueEntries(RESTAURANT_ORDER_ENTITY);
	if (!claimed.length) {
		return idle;
	}

	const groups = new Map<string, OfflineQueueEntry[]>();
	for (const entry of claimed) {
		const payload = asPayload(entry.payload);
		const key = payload?.order_uid || `__invalid__:${entry.queue_id}`;
		const bucket = groups.get(key);
		if (bucket) {
			bucket.push(entry);
		} else {
			groups.set(key, [entry]);
		}
	}

	let synced = 0;
	let failed = 0;
	let blocked = 0;
	const currentCapabilityVersion = getOfflineCapabilityVersion();

	for (const entries of groups.values()) {
		entries.sort(compareEntries);
		let orderBlocked = false;

		for (const entry of entries) {
			const queueId = Number(entry.queue_id);

			if (orderBlocked) {
				blocked += 1;
				await releaseClaimedQueueEntry(
					RESTAURANT_ORDER_ENTITY,
					queueId,
					entry.last_attempt_at,
				);
				continue;
			}

			const payload = asPayload(entry.payload);
			if (!payload) {
				failed += 1;
				orderBlocked = true;
				await markWriteQueueEntryFailed(
					RESTAURANT_ORDER_ENTITY,
					queueId,
					new Error("Unrecognised table-order queue payload"),
					entry.last_attempt_at,
				);
				continue;
			}

			// Capability-version guard (spec §6.9). Unlike an invoice there is no
			// draft-for-review path for a table order, so a mismatch fails the
			// entry instead: it retries locally without a network call and lands
			// in the dead-letter surface for an operator to reconcile.
			const stampedVersion = payload.posa_capability_version;
			if (
				typeof stampedVersion === "number" &&
				typeof currentCapabilityVersion === "number" &&
				stampedVersion !== currentCapabilityVersion
			) {
				failed += 1;
				orderBlocked = true;
				await markWriteQueueEntryFailed(
					RESTAURANT_ORDER_ENTITY,
					queueId,
					new Error(
						`Table order built under capability v${stampedVersion} but ` +
							`register now runs v${currentCapabilityVersion} — held for review`,
					),
					entry.last_attempt_at,
				);
				continue;
			}

			try {
				const response = await frappe.call({
					method: ENDPOINTS[payload.kind],
					args: buildEndpointArgs(payload),
				});
				// Unlike the invoice drain, the response is NOT discarded: it is
				// the only copy of any lines another waiter merged in (§6.1).
				// applyServerOrder normalises both response shapes (order_payload
				// with `items`, and settle's docname-string `order`).
				await applyServerOrder(unwrapMessage(response), payload.order_uid);
				synced += 1;
				await markWriteQueueEntrySynced(
					RESTAURANT_ORDER_ENTITY,
					queueId,
					entry.last_attempt_at,
				);
			} catch (error) {
				console.error(
					`Failed to replay ${payload.kind} for order ${payload.order_uid}`,
					describeError(error),
				);
				failed += 1;
				orderBlocked = true;
				await markWriteQueueEntryFailed(
					RESTAURANT_ORDER_ENTITY,
					queueId,
					error,
					entry.last_attempt_at,
				);
			}
		}
	}

	return {
		pending: getPendingRestaurantMutationCount(),
		synced,
		failed,
		blocked,
	};
}

/**
 * Sync-resource face of the drain, so the coordinator schedules it on
 * `online_resume` / `timer` / `user_action` alongside every other resource and
 * the offline panel can show its state. Mirrors `syncInvoiceOutboxResource` —
 * the shipped precedent for a WRITE queue registered as a sync resource.
 */
export async function syncRestaurantOrdersResource() {
	const totals = await syncRestaurantOrders();
	return {
		resourceId: "restaurant_orders",
		status: totals.failed ? "error" : "fresh",
		lastError: totals.failed
			? `${totals.failed} table order write${totals.failed === 1 ? "" : "s"} failed`
			: null,
		watermark: nowIso(),
		lastSyncedAt: nowIso(),
		consecutiveFailures: totals.failed ? 1 : 0,
		pendingCount: totals.pending,
		acknowledged: totals.synced,
	};
}
