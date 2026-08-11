/**
 * Local mirror of table orders (`pos_table_orders`).
 *
 * Two kinds of row live here and are deliberately not distinguished by table:
 *
 * - **server-confirmed** — written from a floor snapshot or from an endpoint
 *   response, `name` set, `pending_sync` false;
 * - **device-local** — created by an offline `openTableOrder`, `name` null,
 *   `pending_sync` true. No other device can see these until the write queue
 *   drains (spec §6.8) — that bounds the multi-waiter collision of §6.1, it
 *   does not remove it.
 *
 * Reconciliation is an upsert keyed on `order_uid`, which is client-generated
 * and is also the server's `autoname` target, so the same order keeps one key
 * across the offline→online transition.
 *
 * @module offline/restaurantOrders
 */
import { checkDbHealth, db, initPromise } from "./db";
import type { OrderLine, OrderRow, TableOrderStatus } from "./restaurantTypes";

const ORDERS_TABLE = "pos_table_orders";

/** Statuses that still occupy a table. Mirrors the server-side predicate. */
const OPEN_STATUSES: TableOrderStatus[] = ["Open", "Settling"];

export interface StoredTableOrder extends OrderRow {
	/** Local write clock — used only for ordering, never sent to the server. */
	updated_at: string;
}

async function ensureRestaurantDbReady() {
	await initPromise;
	await checkDbHealth();
	if (!db.isOpen()) {
		await db.open();
	}
}

const nowIso = () => new Date().toISOString();

function toNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function countLines(lines: OrderLine[] | undefined) {
	const rows = Array.isArray(lines) ? lines : [];
	return {
		items_count: rows.length,
		unsent_count: rows.filter((line) => !toNumber(line?.fired, 0)).length,
		total: rows.reduce((sum, line) => sum + toNumber(line?.amount, 0), 0),
	};
}

/**
 * Fill in the fields a caller may have left off a partial row. Derived counts
 * are recomputed from `lines` whenever lines are present, so a locally edited
 * order shows the same badge the server would render.
 */
export function normalizeStoredOrder(
	row: Partial<OrderRow> & { order_uid: string },
	previous?: StoredTableOrder | null,
	options: { preferExplicitCounts?: boolean } = {},
): StoredTableOrder {
	const merged = { ...(previous || {}), ...row };
	const lines = Array.isArray(merged.lines) ? merged.lines : previous?.lines;
	const explicitCounts = {
		items_count: toNumber(row.items_count, 0),
		unsent_count: toNumber(row.unsent_count, 0),
		total: toNumber(row.total, 0),
	};
	// A floor snapshot carries authoritative counts but no lines. Merging it
	// over locally-held lines must not re-derive the badge from those lines —
	// another waiter may have added or dropped some, which is precisely the
	// state the snapshot is reporting and the local lines are not.
	const derived =
		options.preferExplicitCounts && typeof row.items_count !== "undefined"
			? explicitCounts
			: lines
				? countLines(lines)
				: {
						items_count: toNumber(merged.items_count, 0),
						unsent_count: toNumber(merged.unsent_count, 0),
						total: toNumber(merged.total, 0),
					};

	return {
		name: merged.name ?? null,
		order_uid: row.order_uid,
		table: merged.table ?? null,
		pos_profile: merged.pos_profile ?? null,
		company: merged.company ?? null,
		status: (merged.status as TableOrderStatus) || "Open",
		tab_name: merged.tab_name ?? null,
		guest_count: merged.guest_count ?? null,
		service_type: merged.service_type ?? null,
		customer: merged.customer ?? null,
		opened_by: merged.opened_by ?? null,
		waiter: merged.waiter ?? null,
		sales_invoice: merged.sales_invoice ?? null,
		modified: merged.modified ?? null,
		lines: lines ? [...lines] : undefined,
		pending_sync: Boolean(merged.pending_sync),
		...derived,
		updated_at: nowIso(),
	};
}

export async function getStoredTableOrder(
	orderUid: string,
): Promise<StoredTableOrder | null> {
	await ensureRestaurantDbReady();
	const row = (await db.table(ORDERS_TABLE).get(orderUid)) as
		| StoredTableOrder
		| undefined;
	return row || null;
}

/**
 * Upsert one order. Returns the stored row so callers can hand the caller-
 * visible `OrderRow` straight back without a second read.
 */
export async function putStoredTableOrder(
	row: Partial<OrderRow> & { order_uid: string },
): Promise<StoredTableOrder> {
	await ensureRestaurantDbReady();
	const table = db.table(ORDERS_TABLE);
	return db.transaction("rw", table, async () => {
		const previous = (await table.get(row.order_uid)) as
			| StoredTableOrder
			| undefined;
		const next = normalizeStoredOrder(row, previous);
		await table.put(next);
		return next;
	});
}

/**
 * Translate an endpoint payload into an {@link OrderRow}.
 *
 * Two shapes have to survive this:
 * - `order_payload()` (open/update/transfer/cancel) — a full order whose lines
 *   arrive under **`items`**, the child-table fieldname, not `lines`;
 * - `_settled_response()` / `fire_course()` — where **`order` is the docname
 *   string**, not a nested object, and the identifying fields sit at the top
 *   level.
 *
 * Returns null for anything that carries no usable identity, so a string or a
 * bare `{}` can never be spread into the mirror as a garbage row.
 */
export function normalizeServerOrderPayload(
	payload: unknown,
	fallbackOrderUid?: string,
): (Partial<OrderRow> & { order_uid: string }) | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const row = payload as Record<string, any>;
	const orderUid = String(row.order_uid || fallbackOrderUid || "").trim();
	if (!orderUid) {
		return null;
	}

	const next: Partial<OrderRow> & { order_uid: string } = {
		...row,
		order_uid: orderUid,
	};

	// `order` is a docname on the settle/fire responses and absent on
	// order_payload — either way `name` is the field the mirror stores.
	if (typeof row.order === "string" && row.order) {
		next.name = row.order;
	} else if (typeof row.order !== "undefined") {
		delete (next as Record<string, any>).order;
	}

	if (Array.isArray(row.items)) {
		next.lines = row.items as OrderLine[];
		delete (next as Record<string, any>).items;
	}

	return next;
}

/**
 * Reconcile a server response into the mirror.
 *
 * The invoice drain discards its submit response (`offline/invoices.ts`
 * :422-435 in the shipped code) because an invoice is terminal once submitted.
 * A table order is not — the server may have merged another waiter's lines
 * into it (§6.1), so the response is the only place that merged state exists.
 * Dropping it would show this device a stale ticket until the next pull.
 */
export async function applyServerOrder(
	payload: unknown,
	fallbackOrderUid?: string,
): Promise<StoredTableOrder | null> {
	const row = normalizeServerOrderPayload(payload, fallbackOrderUid);
	if (!row) {
		return null;
	}
	return putStoredTableOrder({ ...row, pending_sync: false });
}

/**
 * Mark lines fired in the mirror after a successful `fire_course`.
 *
 * The projection response carries the line uids that went to the kitchen but
 * not the updated order, so without this the unsent badge keeps counting lines
 * the kitchen already has until the next pull.
 */
export async function markLinesFired(orderUid: string, lineUids: string[]) {
	const fired = new Set(lineUids.filter(Boolean));
	if (!fired.size) {
		return null;
	}
	const existing = await getStoredTableOrder(orderUid);
	if (!existing?.lines?.length) {
		return existing;
	}
	const firedAt = nowIso();
	return putStoredTableOrder({
		...existing,
		lines: existing.lines.map((line) =>
			fired.has(line.line_uid)
				? { ...line, fired: 1, fired_at: line.fired_at || firedAt }
				: line,
		),
	});
}

export async function markTableOrderPending(orderUid: string, pending: boolean) {
	const existing = await getStoredTableOrder(orderUid);
	if (!existing) {
		return null;
	}
	return putStoredTableOrder({ ...existing, pending_sync: pending });
}

export async function listStoredTableOrders(options: {
	openOnly?: boolean;
	table?: string | null;
	posProfile?: string | null;
} = {}): Promise<StoredTableOrder[]> {
	await ensureRestaurantDbReady();
	const rows = (await db
		.table(ORDERS_TABLE)
		.toArray()) as StoredTableOrder[];

	return rows.filter((row) => {
		if (options.openOnly && !OPEN_STATUSES.includes(row.status)) {
			return false;
		}
		if (options.table !== undefined && row.table !== options.table) {
			return false;
		}
		if (options.posProfile && row.pos_profile && row.pos_profile !== options.posProfile) {
			return false;
		}
		return true;
	});
}

/** Open orders this device created offline and has not yet drained. */
export async function listPendingTableOrders(posProfile?: string | null) {
	const rows = await listStoredTableOrders({ openOnly: true, posProfile });
	return rows.filter((row) => row.pending_sync);
}

/**
 * Replace the server-confirmed slice with a fresh snapshot, leaving every
 * still-pending device-local order in place.
 *
 * A pull is authoritative only for what the server can see. Wiping the table
 * wholesale would delete orders whose queue entries have not drained yet —
 * i.e. destroy a waiter's un-synced ticket on the first successful refresh.
 */
export async function replaceServerTableOrders(orders: Partial<OrderRow>[]) {
	await ensureRestaurantDbReady();
	const table = db.table(ORDERS_TABLE);
	const incoming = (orders || []).filter((row) => !!row?.order_uid);
	const incomingUids = new Set(incoming.map((row) => String(row.order_uid)));

	await db.transaction("rw", table, async () => {
		const existing = (await table.toArray()) as StoredTableOrder[];
		const stale = existing
			.filter((row) => !row.pending_sync && !incomingUids.has(row.order_uid))
			.map((row) => row.order_uid);
		if (stale.length) {
			await table.bulkDelete(stale);
		}

		for (const row of incoming) {
			const orderUid = String(row.order_uid);
			const previous = (await table.get(orderUid)) as
				| StoredTableOrder
				| undefined;
			// A pending local order that the server now also knows about has
			// drained; the server copy wins but keeps any lines the snapshot
			// omits (the floor snapshot carries counts, not lines).
			await table.put(
				normalizeStoredOrder(
					{ ...row, order_uid: orderUid, pending_sync: false },
					previous,
					{ preferExplicitCounts: true },
				),
			);
		}
	});
}

export async function deleteStoredTableOrder(orderUid: string) {
	await ensureRestaurantDbReady();
	await db.table(ORDERS_TABLE).delete(orderUid);
}
