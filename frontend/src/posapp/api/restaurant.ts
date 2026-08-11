/**
 * Public API for the restaurant tables feature.
 *
 * The ONLY surface the floor UI should call. Every mutating function is
 * online/offline transparent except the two noted below: online it hits the
 * backend directly; offline (or when the call dies in transport) it writes an
 * optimistic row into the local mirror and queues the mutation for replay.
 *
 * **One request id per logical write.** Each call mints exactly one `tbl-` id
 * up front and reuses it if the write falls through to the queue and on every
 * later retry — that stability is what makes the server-side dedupe on
 * `posa_client_request_id` correct. A *transport* failure therefore never loses
 * or duplicates a write; a *validation* failure is re-thrown immediately so the
 * cashier sees it instead of it queueing to fail again later.
 *
 * **Offline bound (spec §6.8):** a single Frappe server is the only
 * coordinator, so an offline device sees only the orders it created itself plus
 * whatever the last successful pull left in the mirror. Two tablets offline
 * from the server but reachable to each other still cannot see each other's
 * tables. This bounds the multi-waiter collision of §6.1; it does not remove it.
 *
 * **Online-only — both throw {@link RestaurantOfflineError}:**
 * `saveFloorLayout` (the editor needs the server's `modified` token to detect a
 * concurrent edit — queueing a whole-floor save would overwrite another
 * manager's changes) and `fireCourse` (the kitchen projection is diffed
 * server-side against the stored last-fired snapshot, so a queued fire would
 * print a ticket describing state the kitchen no longer has).
 *
 * `settleTableOrder` DOES queue offline and stays durable here. The UI refuses
 * a queued settle at the payment seam (v1 product decision) because that seam
 * prints and navigates off the submitted invoice doc; the queue path is left
 * whole underneath rather than amputated, for a later phase.
 *
 * @module posapp/api/restaurant
 */
import { getDeviceIdentifier } from "../../offline/deviceIdentity";
import { generateTableOrderRequestId } from "../../offline/idempotency";
import {
	listStoredFloors,
	listStoredTables,
	putStoredFloors,
	putStoredTables,
} from "../../offline/restaurantCatalog";
import {
	buildLocalOrder,
	callRestaurant,
	dispatchOrderMutation,
	ensureLineUid,
	isServerReachable,
	isTransportFailure,
	mergeLocalOrderLines,
	newUid,
} from "../../offline/restaurantDispatch";
import {
	applyServerOrder,
	getStoredTableOrder,
	listStoredTableOrders,
	markLinesFired,
	putStoredTableOrder,
	replaceServerTableOrders,
} from "../../offline/restaurantOrders";
import type {
	FloorSnapshot,
	KotProjection,
	OpenOrderParams,
	OrderRow,
	SaveFloorParams,
	SettleParams,
	UpdateOrderParams,
} from "../../offline/restaurantTypes";

export { ensureLineUid, newUid };

export type {
	FloorEditorTable,
	FloorLayout,
	FloorRow,
	FloorSnapshot,
	KotLine,
	KotProjection,
	KotStation,
	OpenOrderParams,
	OrderLine,
	OrderRow,
	SaveFloorParams,
	SettleParams,
	TableLayout,
	TableOrderStatus,
	TableRow,
	UpdateOrderParams,
} from "../../offline/restaurantTypes";

const METHODS = {
	floorSnapshot: "posawesome.posawesome.api.restaurant.floors.get_floor_snapshot",
	saveFloorLayout: "posawesome.posawesome.api.restaurant.floors.save_floor_layout",
	openOrder: "posawesome.posawesome.api.restaurant.orders.open_table_order",
	updateOrder: "posawesome.posawesome.api.restaurant.orders.update_table_order",
	transferOrder:
		"posawesome.posawesome.api.restaurant.orders.transfer_table_order",
	cancelOrder: "posawesome.posawesome.api.restaurant.orders.cancel_table_order",
	settleOrder: "posawesome.posawesome.api.restaurant.settle.settle_table_order",
	settlementState:
		"posawesome.posawesome.api.restaurant.settle.get_settlement_state",
	fireCourse: "posawesome.posawesome.api.restaurant.kot.fire_course",
	markTableClean: "posawesome.posawesome.api.restaurant.floors.mark_table_clean",
} as const;

/** Thrown when an operation genuinely requires the server. */
export class RestaurantOfflineError extends Error {
	readonly operation: string;

	constructor(operation: string, message: string) {
		super(message);
		this.name = "RestaurantOfflineError";
		this.operation = operation;
	}
}

/**
 * Where a settle actually got to — the recovery read after a lost ack.
 *
 * Not needed by the normal path (a lost ack queues and replays under the same
 * request id, which the submission ledger dedupes). Exposed so the UI can offer
 * an explicit "check what happened" affordance.
 */
export async function getSettlementState(orderUid: string) {
	const result = await callRestaurant(METHODS.settlementState, {
		name_or_uid: orderUid,
	});
	return {
		order: (result?.order as string) || null,
		status: (result?.status as string) || null,
		salesInvoice: (result?.sales_invoice as string) || null,
		targetDoctype: (result?.target_doctype as string) || null,
		payload: result?.payload ?? null,
	};
}

// ---- reads -----------------------------------------------------------------

/**
 * Floors, tables and open orders for the register.
 *
 * Online this is one server round trip (the grouped snapshot query) and the
 * result warms the local mirror so an unplanned disconnect still leaves a
 * usable floor. Offline it is assembled from the mirror plus this device's own
 * queued orders.
 */
export async function getFloorSnapshot(
	posProfile: string,
	company: string,
	floor?: string,
): Promise<FloorSnapshot> {
	if (isServerReachable()) {
		try {
			const result = await callRestaurant(METHODS.floorSnapshot, {
				pos_profile: posProfile,
				company,
				floor: floor || null,
			});
			const snapshot: FloorSnapshot = {
				floors: result?.floors || [],
				tables: result?.tables || [],
				orders: result?.orders || [],
				serverTime: result?.server_time || result?.serverTime || "",
			};
			await putStoredFloors(snapshot.floors);
			await putStoredTables(snapshot.tables);
			await replaceServerTableOrders(snapshot.orders);
			return snapshot;
		} catch (error) {
			// A floor rendered from cache beats an error screen mid-service.
			console.error("Floor snapshot fetch failed, serving mirror", error);
		}
	}

	const [floors, tables, orders] = await Promise.all([
		listStoredFloors(posProfile),
		listStoredTables(floor || null),
		listStoredTableOrders({ openOnly: true, posProfile }),
	]);

	return { floors, tables, orders, serverTime: "" };
}

/** Local mirror read — carries `lines`, so use it to hydrate the cart. */
export async function getTableOrder(orderUid: string): Promise<OrderRow | null> {
	return getStoredTableOrder(orderUid);
}

// ---- writes ----------------------------------------------------------------

export async function openTableOrder(p: OpenOrderParams): Promise<OrderRow> {
	const orderUid = String(p.orderUid || "").trim() || newUid();
	const { result } = await dispatchOrderMutation({
		kind: "restaurant:order:open",
		method: METHODS.openOrder,
		orderUid,
		args: {
			pos_profile: p.posProfile,
			company: p.company,
			order_uid: orderUid,
			table: p.table ?? null,
			tab_name: p.tabName ?? null,
			guest_count: p.guestCount ?? null,
			service_type: p.serviceType ?? null,
			customer: p.customer ?? null,
		},
	});

	if (result) {
		const stored = await applyServerOrder(result, orderUid);
		if (stored) {
			// tap-to-open on an occupied table returns the existing order.
			return { ...stored, existing: Boolean(result?.existing) };
		}
	}

	return putStoredTableOrder(buildLocalOrder(orderUid, p));
}

export async function updateTableOrder(p: UpdateOrderParams): Promise<OrderRow> {
	const lines = (p.lines || []).map((line) => ensureLineUid(line));
	const { result } = await dispatchOrderMutation({
		kind: "restaurant:order:update",
		method: METHODS.updateOrder,
		orderUid: p.orderUid,
		args: {
			name_or_uid: p.orderUid,
			lines,
			removed_line_uids: p.removedLineUids || [],
			tab_name: p.tabName,
			guest_count: p.guestCount,
			service_type: p.serviceType,
			customer: p.customer,
		},
	});

	if (result) {
		const stored = await applyServerOrder(result, p.orderUid);
		if (stored) {
			// Lines the server refused to drop because they are already fired —
			// the UI must put them back rather than show a phantom removal.
			return { ...stored, rejected_removals: result?.rejected_removals };
		}
	}

	return mergeLocalOrderLines(p, lines);
}

export async function transferTableOrder(
	orderUid: string,
	toTable: string,
): Promise<void> {
	const { result } = await dispatchOrderMutation({
		kind: "restaurant:order:transfer",
		method: METHODS.transferOrder,
		orderUid,
		args: { name_or_uid: orderUid, to_table: toTable },
	});

	if (result) {
		await applyServerOrder(result, orderUid);
		return;
	}

	const existing = await getStoredTableOrder(orderUid);
	if (existing) {
		await putStoredTableOrder({
			...existing,
			table: toTable,
			pending_sync: true,
		});
	}
}

export async function cancelTableOrder(orderUid: string): Promise<void> {
	const { result } = await dispatchOrderMutation({
		kind: "restaurant:order:cancel",
		method: METHODS.cancelOrder,
		orderUid,
		args: { name_or_uid: orderUid },
		carriesRequestId: false,
	});

	if (result) {
		await applyServerOrder(result, orderUid);
		return;
	}

	const existing = await getStoredTableOrder(orderUid);
	if (existing) {
		await putStoredTableOrder({
			...existing,
			status: "Cancelled",
			pending_sync: true,
		});
	}
}

export interface SettleResult {
	salesInvoice?: string;
	/**
	 * The SUBMITTED invoice doc, straight from `invoice_processing.creation`.
	 * The payment path needs `docstatus`/`status` and the doc itself for print,
	 * change-due and navigation — a name alone drives none of that.
	 *
	 * Shape is the submit path's flat result (`name`, `docstatus`, `status`,
	 * `doctype`), NOT a full invoice document — fetch by name for line-level
	 * data.
	 *
	 * Absent in exactly two cases, which `queued` and `idempotent` distinguish:
	 * - `queued: true` — offline, nothing submitted yet.
	 * - `idempotent: true` — a replayed settle whose invoice landed on an
	 *   earlier attempt. The server deliberately does NOT repopulate it (a
	 *   replay must not re-run the submit), so `salesInvoice` carries the name
	 *   and the caller fetches the doc if it needs one.
	 *
	 * Branch on `queued` / `idempotent`, never on `!invoice` — a missing doc is
	 * not an error.
	 */
	invoice?: any;
	/**
	 * The invoice already existed from a prior attempt. NOT an error:
	 * `salesInvoice` is populated and the sale is complete. `invoice` is absent
	 * here by design — fetch by name if the payment path needs the document.
	 */
	idempotent?: boolean;
	/** The settle is queued for replay; nothing has been submitted yet. */
	queued: boolean;
}

/**
 * Settle an order into a Sales / POS Invoice.
 *
 * `queued: true` means the sale is durably recorded on this device and will
 * submit on reconnect. The replay carries the SAME `client_request_id` as the
 * attempt that queued it, so `invoice_processing.creation`'s submission ledger
 * dedupes it — an ack-miss (request applied, response lost) cannot double-bill.
 * The caller must NOT retry it, and must not print a fiscal receipt for a
 * `salesInvoice` it did not receive.
 *
 * The UI refuses a queued settle at the payment seam (v1 product decision);
 * this path stays durable and intact underneath for a later phase.
 */
export async function settleTableOrder(p: SettleParams): Promise<SettleResult> {
	const { result, queued } = await dispatchOrderMutation({
		kind: "restaurant:order:settle",
		method: METHODS.settleOrder,
		orderUid: p.orderUid,
		args: { name_or_uid: p.orderUid, invoice_payload: p.invoicePayload },
	});

	if (!queued) {
		// settle answers with {order: <docname>, order_uid, status,
		// sales_invoice, invoice_result, idempotent} — identity at the top
		// level, not a nested order, and the submitted doc under invoice_result.
		await applyServerOrder(result, p.orderUid);
		return {
			salesInvoice: result?.sales_invoice || result?.salesInvoice || undefined,
			// Accept either key: the shipped backend returns `invoice_result`;
			// an `invoice` alias may be added.
			invoice: result?.invoice ?? result?.invoice_result ?? undefined,
			idempotent: Boolean(result?.idempotent),
			queued: false,
		};
	}

	const existing = await getStoredTableOrder(p.orderUid);
	if (existing) {
		await putStoredTableOrder({
			...existing,
			status: "Settling",
			pending_sync: true,
		});
	}
	return { queued: true };
}

/** ONLINE ONLY — see the module header. */
export async function fireCourse(
	orderUid: string,
	courseIdx?: number,
): Promise<KotProjection> {
	if (!isServerReachable()) {
		throw new RestaurantOfflineError(
			"fireCourse",
			"Sending to the kitchen needs a connection. Reconnect and send again.",
		);
	}

	const result = await callRestaurant(METHODS.fireCourse, {
		name_or_uid: orderUid,
		course_idx: courseIdx ?? null,
		client_request_id: generateTableOrderRequestId(),
		source_device: getDeviceIdentifier(),
	});

	const projection: KotProjection = {
		stations: result?.stations || [],
		cancellations: result?.cancellations || [],
	};
	// The projection carries the fired line uids but not the updated order, so
	// clear the unsent badge here or it keeps counting lines the kitchen has.
	await markLinesFired(
		orderUid,
		projection.stations.flatMap((station) =>
			(station.lines || []).map((line) => line.line_uid),
		),
	);
	return projection;
}

/** ONLINE ONLY — see the module header. */
export async function saveFloorLayout(p: SaveFloorParams): Promise<void> {
	if (!isServerReachable()) {
		throw new RestaurantOfflineError(
			"saveFloorLayout",
			"Editing the floor plan needs a connection. Reconnect to save changes.",
		);
	}

	const result = await callRestaurant(METHODS.saveFloorLayout, {
		pos_profile: p.posProfile,
		company: p.company,
		floor: p.floor,
		layout: p.layout,
		tables: p.tables,
		modified: p.modified,
		source_device: getDeviceIdentifier(),
	});

	if (Array.isArray(result?.tables)) {
		await putStoredTables(result.tables);
	}
	// Refresh the concurrency token, or the very next save in this session
	// sends the pre-save `modified` and trips TimestampMismatchError (§6.3).
	if (result?.floor && result?.modified) {
		const stored = await listStoredFloors();
		const floorRow = stored.find((row) => row.name === result.floor);
		if (floorRow) {
			await putStoredFloors([
				{ ...floorRow, layout: p.layout, modified: result.modified },
			]);
		}
	}
}

/** The floor's current concurrency token, for the editor's next save. */
export async function getFloorModifiedToken(floor: string) {
	const floors = await listStoredFloors();
	return floors.find((row) => row.name === floor)?.modified ?? null;
}

/**
 * Clear the bussing latch settle set (needs_cleaning → 0).
 *
 * Online-only: the latch is shared state every device's board renders, and a
 * queued "clean" replaying after the table was re-seated and re-settled would
 * wipe a NEWER dirty state. Offline the broom just stays until reconnect.
 */
export async function markTableClean(p: {
	posProfile: string;
	company: string;
	table: string;
}): Promise<void> {
	if (!isServerReachable()) {
		throw new RestaurantOfflineError(
			"markTableClean",
			"Marking a table clean needs a connection. The broom stays until you reconnect.",
		);
	}

	await callRestaurant(METHODS.markTableClean, {
		pos_profile: p.posProfile,
		company: p.company,
		table: p.table,
		source_device: getDeviceIdentifier(),
	});

	const stored = await listStoredTables(null);
	const row = stored.find((entry) => entry.name === p.table);
	if (row) {
		await putStoredTables([{ ...row, needs_cleaning: 0, bill_printed_at: null }]);
	}
}
