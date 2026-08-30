/**
 * Shared row/param shapes for the restaurant tables feature.
 *
 * Lives in the offline layer so both the Dexie mirror and the public wrapper
 * (`posapp/api/restaurant.ts`, which re-exports every type here) can use them
 * without the offline layer importing upward from `posapp/`.
 *
 * Field names mirror the backend doctypes exactly — these rows are written
 * straight from sync payloads and endpoint responses, so renaming a field here
 * silently breaks the mirror.
 *
 * @module offline/restaurantTypes
 */

export interface FloorLayout {
	/** Canvas reference frame — table geometry is in these grid units. */
	cols?: number;
	rows?: number;
	cell?: number;
	[key: string]: unknown;
}

export interface TableLayout {
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	rotation?: number;
	shape?: string;
	color?: string;
	[key: string]: unknown;
}

export interface FloorRow {
	name: string;
	floor_uid: string;
	floor_name: string;
	company: string | null;
	pos_profile: string | null;
	sequence: number;
	is_active: number;
	layout: FloorLayout | null;
	modified: string | null;
}

export interface TableRow {
	name: string;
	table_uid: string;
	table_label: string;
	floor: string;
	seats: number;
	is_active: number;
	layout: TableLayout | null;
	needs_cleaning: number;
	bill_printed_at: string | null;
	/** Reconciled hint, never the truth — occupancy derives from open orders. */
	occupied: number;
	modified: string | null;
}

export type TableOrderStatus = "Open" | "Settling" | "Settled" | "Cancelled";

export interface OrderLine {
	/** Client-generated per-line id — the union-merge key. */
	line_uid: string;
	item_code: string;
	item_name?: string | null;
	qty: number;
	uom?: string | null;
	rate?: number | null;
	amount?: number | null;
	notes?: string | null;
	course_idx?: number | null;
	/** Who ordered it, for per-seat settling. 0 = the table (shared). */
	seat?: number | null;
	fired?: number;
	fired_at?: string | null;
}

export interface OrderRow {
	/** Server docname. Null while the order exists only on this device. */
	name: string | null;
	order_uid: string;
	table: string | null;
	pos_profile: string | null;
	company: string | null;
	status: TableOrderStatus;
	tab_name: string | null;
	guest_count: number | null;
	service_type: string | null;
	customer: string | null;
	opened_by: string | null;
	waiter: string | null;
	/** Set at settle — the accounting document, for reprint after a reload. */
	sales_invoice?: string | null;
	items_count: number;
	/** Lines with `fired = 0` — the kitchen badge. */
	unsent_count: number;
	total: number;
	modified: string | null;
	/** Present on single-order responses; absent in the floor snapshot. */
	lines?: OrderLine[];
	/**
	 * True while at least one mutation for this order is still queued. No other
	 * device can see such an order until the queue drains (spec §6.8).
	 */
	pending_sync?: boolean;
	/** True when the server reported this table already had an open order. */
	existing?: boolean;
	/**
	 * Line uids the server refused to remove because they are already fired.
	 * Present on an `updateTableOrder` response; the UI should put them back
	 * rather than showing a removal the kitchen never saw.
	 */
	rejected_removals?: string[];
}

export interface FloorSnapshot {
	floors: FloorRow[];
	tables: TableRow[];
	orders: OrderRow[];
	serverTime: string;
}

export interface OpenOrderParams {
	posProfile: string;
	company: string;
	/** Null/omitted = a counter tab rather than a seated table. */
	table?: string | null;
	tabName?: string | null;
	guestCount?: number | null;
	serviceType?: string | null;
	customer?: string | null;
	/** Supply to re-open a known uid; omitted mints a fresh UUID. */
	orderUid?: string;
}

export interface UpdateOrderParams {
	orderUid: string;
	/** Upserted by `line_uid`. Server lines absent here SURVIVE (§6.1). */
	lines?: OrderLine[];
	/** The only way to delete a line. Fired lines are refused server-side. */
	removedLineUids?: string[];
	tabName?: string | null;
	guestCount?: number | null;
	serviceType?: string | null;
	customer?: string | null;
}

export interface SettleParams {
	orderUid: string;
	invoicePayload: Record<string, unknown>;
	tipAmount?: number;
}

export interface FloorEditorTable {
	table_uid: string;
	table_label?: string;
	seats?: number;
	layout?: TableLayout;
	is_active?: number;
}

export interface SaveFloorParams {
	posProfile: string;
	company: string;
	floor: string;
	layout: FloorLayout;
	tables: FloorEditorTable[];
	/** Optimistic-concurrency token — the floor's last known `modified` (§6.3). */
	modified: string | null;
}

export interface KotLine {
	line_uid: string;
	item_code: string;
	item_name?: string | null;
	qty: number;
	uom?: string | null;
	notes?: string | null;
	course_idx?: number | null;
}

export interface KotStation {
	station: string;
	printer: string | null;
	lines: KotLine[];
}

export interface KotProjection {
	stations: KotStation[];
	cancellations: KotLine[];
	/**
	 * Durable print batch handle for the delivery-verdict poll (audit r2 A6).
	 * Null when the printing spine is absent (legacy sites) or nothing printed.
	 */
	batch?: { name: string } | null;
	/** Order the fire belongs to — the verdict poll needs a scoped ref. */
	orderUid?: string | null;
}

export type RestaurantQueueKind =
	| "restaurant:order:open"
	| "restaurant:order:update"
	| "restaurant:order:transfer"
	| "restaurant:order:settle"
	| "restaurant:order:cancel";

/**
 * What a queued table-order mutation stores. `args` is passed verbatim to the
 * endpoint, so it uses backend (snake_case) names while the wrapper params
 * above use frontend (camelCase) ones.
 */
export interface RestaurantQueuePayload {
	kind: RestaurantQueueKind;
	order_uid: string;
	client_request_id: string;
	args: Record<string, any>;
	queued_at: string;
	/** Stamped when a preset is linked; gates replay (spec §6.9). */
	posa_capability_version?: number;
}
