/**
 * Send-or-queue plumbing shared by every table-order mutation, plus the
 * optimistic local writes that keep the mirror showing what the replay will
 * produce.
 *
 * Split out of `posapp/api/restaurant.ts` to keep that module a thin, readable
 * public surface; it lives in the offline layer because optimistic local state
 * and queue fallback are offline-layer concerns.
 *
 * @module offline/restaurantDispatch
 */
import { isOffline } from "./db";
import { getDeviceIdentifier } from "./deviceIdentity";
import { generateTableOrderRequestId } from "./idempotency";
import { getStoredTableOrder, putStoredTableOrder } from "./restaurantOrders";
import { enqueueRestaurantMutation } from "./restaurantQueue";
import type {
	OpenOrderParams,
	OrderLine,
	OrderRow,
	RestaurantQueueKind,
	UpdateOrderParams,
} from "./restaurantTypes";

declare const frappe: any;

export function isServerReachable() {
	return (
		!isOffline() &&
		typeof frappe !== "undefined" &&
		typeof frappe.call === "function"
	);
}

export async function callRestaurant(
	method: string,
	args: Record<string, any>,
) {
	const response = await frappe.call({ method, args });
	return typeof response?.message === "undefined" ? response : response.message;
}

/**
 * Did the request die before the server judged it?
 *
 * Only then is queueing the right answer. Anything carrying a Frappe error
 * signature (`exc_type`, server messages, a 4xx) is a verdict — replaying it
 * would just fail again, after hiding the reason from the cashier.
 */
export function isTransportFailure(error: unknown) {
	const candidate = (error || {}) as Record<string, any>;
	if (candidate.exc_type || candidate.exc || candidate._server_messages) {
		return false;
	}
	const status = Number(
		candidate.httpStatus ?? candidate.status ?? candidate.statusCode ?? 0,
	);
	if (status >= 400 && status < 500) {
		return false;
	}
	return true;
}

/** Matches the repo's uuid pattern (services/api.ts, utils/telemetry.ts). */
export function newUid() {
	return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Every cart line needs a stable union-merge key before it can be sent. */
export function ensureLineUid(line: Partial<OrderLine>): OrderLine {
	return {
		...(line as OrderLine),
		line_uid: String(line?.line_uid || "").trim() || newUid(),
	};
}

function toNumber(value: unknown, fallback = 0) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Send now or queue — with ONE request id either way.
 *
 * The id is minted before the attempt and reused by the queued entry, so a
 * write lost in transport replays under the id the server may already have
 * seen and is deduped rather than double-applied.
 *
 * `carriesRequestId: false` is for `cancel_table_order`, whose signature takes
 * only `name_or_uid`; passing an unexpected kwarg raises TypeError server-side
 * before any guard runs.
 */
export async function dispatchOrderMutation(options: {
	kind: RestaurantQueueKind;
	method: string;
	orderUid: string;
	args: Record<string, any>;
	carriesRequestId?: boolean;
}): Promise<{ result: any; queued: boolean }> {
	const clientRequestId = generateTableOrderRequestId();
	const carriesRequestId = options.carriesRequestId !== false;
	// Stamped into the STORED args too, not just the live call: on a replay the
	// origin device is still this one, so the echo it must ignore is still its
	// own. Every order endpoint accepts source_device.
	const args = { ...options.args, source_device: getDeviceIdentifier() };

	if (isServerReachable()) {
		try {
			const result = await callRestaurant(options.method, {
				...args,
				...(carriesRequestId ? { client_request_id: clientRequestId } : {}),
			});
			return { result, queued: false };
		} catch (error) {
			if (!isTransportFailure(error)) {
				throw error;
			}
			console.error(
				`${options.kind} lost in transport — queueing for replay`,
				error,
			);
		}
	}

	await enqueueRestaurantMutation({
		kind: options.kind,
		orderUid: options.orderUid,
		args,
		clientRequestId,
	});
	return { result: null, queued: true };
}

export function buildLocalOrder(
	orderUid: string,
	p: OpenOrderParams,
): OrderRow {
	return {
		name: null,
		order_uid: orderUid,
		table: p.table ?? null,
		pos_profile: p.posProfile,
		company: p.company,
		status: "Open",
		tab_name: p.tabName ?? null,
		guest_count: p.guestCount ?? null,
		service_type: p.serviceType ?? null,
		customer: p.customer ?? null,
		opened_by: null,
		waiter: null,
		items_count: 0,
		unsent_count: 0,
		total: 0,
		modified: null,
		lines: [],
		pending_sync: true,
	};
}

/**
 * Apply an update to the local mirror with the same per-line union the server
 * uses, so an offline edit shows the operator exactly what the replay will
 * produce: lines upsert by `line_uid`, untouched lines survive, and deletion
 * happens only through `removedLineUids`.
 */
export async function mergeLocalOrderLines(
	p: UpdateOrderParams,
	lines: OrderLine[],
): Promise<OrderRow> {
	const existing = await getStoredTableOrder(p.orderUid);
	const merged = new Map<string, OrderLine>();
	for (const line of existing?.lines || []) {
		merged.set(line.line_uid, line);
	}
	for (const line of lines) {
		const previous = merged.get(line.line_uid);
		merged.set(line.line_uid, previous ? { ...previous, ...line } : line);
	}
	for (const uid of p.removedLineUids || []) {
		const target = merged.get(uid);
		// Fired lines are refused server-side; refusing here keeps the
		// optimistic view honest instead of showing a removal that will bounce.
		if (target && !toNumber(target.fired, 0)) {
			merged.delete(uid);
		}
	}

	return putStoredTableOrder({
		...(existing || {}),
		order_uid: p.orderUid,
		lines: [...merged.values()],
		tab_name: p.tabName !== undefined ? p.tabName : (existing?.tab_name ?? null),
		guest_count:
			p.guestCount !== undefined
				? p.guestCount
				: (existing?.guest_count ?? null),
		service_type:
			p.serviceType !== undefined
				? p.serviceType
				: (existing?.service_type ?? null),
		customer:
			p.customer !== undefined ? p.customer : (existing?.customer ?? null),
		pending_sync: true,
	});
}
