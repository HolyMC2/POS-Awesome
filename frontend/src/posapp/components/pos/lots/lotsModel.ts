/**
 * SERIES Y LOTES — the model behind the register's serial / batch lookup.
 *
 * The question this destination answers (owner, 2026-09-05): «the IMEI in my
 * hand says it was sold two months ago — to whom, on which ticket, and which
 * unit of the SAME model is still in stock so I can sell that one instead».
 * Until now that meant leaving the register for the desk's Serial No list.
 *
 * Pure — no Vue, no store, no `__()` — so the tabs, the tones and the add
 * payload a «Sell this one» produces can be asserted without a DOM, and so
 * the desk and the phone cannot drift into two readings of one row.
 *
 * ⚠ IT INVENTS NO STOCK RULE. `sellable_here` is the SERVER's verdict
 * (`lot_read_model.sellable_here` / `batch_sellable_here`); this module only
 * translates rows into what a surface draws and into the ONE add shape the
 * cart already understands (`lot:confirm`, the picker's own contract).
 */

export type LotKind = "serial" | "batch";

/** ERPNext's Serial No status vocabulary, plus the blank rows a mirror carries. */
export type SerialStatus = "Active" | "Delivered" | "Consumed" | "Inactive" | "Expired" | "Unknown";

export type SerialBucket = "all" | "Active" | "Delivered" | "Consumed" | "Inactive" | "Expired";

export type BatchBucket = "available" | "all" | "expired" | "empty";

/** How a status reads on the surface: the chip tone, from the register's tokens. */
export type LotTone = "positive" | "neutral" | "warning" | "negative" | "returned" | "muted";

export interface SerialRow {
	serial_no: string;
	item_code: string;
	item_name: string;
	status: SerialStatus | string;
	warehouse: string | null;
	customer: string | null;
	batch_no: string | null;
	purchase_document_no: string | null;
	warranty_expiry_date: string | null;
	posting_date: string | null;
	last_voucher_type: string | null;
	last_voucher_no: string | null;
	last_moved_at: string | null;
	last_outward: boolean | null;
	sellable_here: boolean;
}

export interface LotMovement {
	voucher_type: string;
	voucher_no: string;
	warehouse: string | null;
	posting_datetime: string | null;
	outward: boolean;
	qty: number;
	cancelled: boolean;
	party: string | null;
	is_return: boolean;
	return_against: string | null;
	grand_total: number | null;
	owner: string | null;
	voucher_status: string | null;
}

export interface SerialSibling {
	serial_no: string;
	warehouse: string | null;
	batch_no: string | null;
	sellable_here: boolean;
}

export interface SerialStory {
	serial: SerialRow;
	sold_on: LotMovement | null;
	movements: LotMovement[];
	siblings: SerialSibling[];
	profile_warehouse: string | null;
}

export interface SerialSearchPayload {
	rows: SerialRow[];
	counts: Record<SerialBucket, number>;
	total: number;
	offset: number;
	limit: number;
	warehouses: Array<{ warehouse: string; n: number }>;
	profile_warehouse: string | null;
	query: string;
	status: SerialBucket;
}

export interface BatchStock {
	warehouse: string | null;
	qty: number;
}

export interface BatchRow {
	batch_no: string;
	item_code: string;
	item_name: string;
	expiry_date: string | null;
	manufacturing_date: string | null;
	days_to_expiry: number | null;
	tone: "none" | "ok" | "soon" | "expired";
	disabled: boolean;
	stock_uom: string | null;
	supplier: string | null;
	total_qty: number;
	qty_here: number;
	stock: BatchStock[];
	sellable_here: boolean;
}

export interface BatchSearchPayload {
	rows: BatchRow[];
	counts: Record<BatchBucket, number>;
	bucket: BatchBucket;
	profile_warehouse: string | null;
	today: string;
	query: string;
}

export interface BatchStory {
	batch: BatchRow;
	movements: LotMovement[];
	profile_warehouse: string | null;
}

export interface LotTab<Id extends string> {
	id: Id;
	/** English source string; the surface translates. */
	label: string;
	count: number;
	active: boolean;
}

/** Serial tabs in the order a counter reaches for them: what it can sell first. */
export const SERIAL_TABS: ReadonlyArray<{ id: SerialBucket; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "Active", label: "In stock" },
	{ id: "Delivered", label: "Sold" },
	{ id: "Consumed", label: "Consumed" },
	{ id: "Inactive", label: "Inactive" },
	{ id: "Expired", label: "Expired" },
];

export const BATCH_TABS: ReadonlyArray<{ id: BatchBucket; label: string }> = [
	{ id: "available", label: "Available" },
	{ id: "all", label: "All" },
	{ id: "expired", label: "Expired lot" },
	{ id: "empty", label: "Empty" },
];

export const emptySerialCounts = (): Record<SerialBucket, number> => ({
	all: 0,
	Active: 0,
	Delivered: 0,
	Consumed: 0,
	Inactive: 0,
	Expired: 0,
});

export const emptyBatchCounts = (): Record<BatchBucket, number> => ({
	available: 0,
	all: 0,
	expired: 0,
	empty: 0,
});

export const describeSerialTabs = (
	counts: Record<SerialBucket, number>,
	active: SerialBucket,
): LotTab<SerialBucket>[] =>
	SERIAL_TABS.map((tab) => ({
		id: tab.id,
		label: tab.label,
		count: Number(counts?.[tab.id]) || 0,
		active: tab.id === active,
	}));

export const describeBatchTabs = (
	counts: Record<BatchBucket, number>,
	active: BatchBucket,
): LotTab<BatchBucket>[] =>
	BATCH_TABS.map((tab) => ({
		id: tab.id,
		label: tab.label,
		count: Number(counts?.[tab.id]) || 0,
		active: tab.id === active,
	}));

/**
 * What a status means at the counter. `Delivered` is ERPNext's word; the
 * cashier's is «Vendido», and the chip says so. `Consumed` is a unit that
 * left through a Stock Entry (a repair, a demo) — not a sale, and the
 * distinction is exactly what the blocked-sale case turned on.
 */
export const SERIAL_STATUS_LABELS: Record<SerialStatus, string> = {
	Active: "In stock",
	Delivered: "Sold",
	Consumed: "Consumed",
	Inactive: "Inactive",
	Expired: "Expired",
	Unknown: "Unknown",
};

export const serialStatusLabel = (status: string | null | undefined): string =>
	SERIAL_STATUS_LABELS[(status as SerialStatus) || "Unknown"] ?? String(status || "Unknown");

export const serialTone = (status: string | null | undefined): LotTone => {
	switch (status) {
		case "Active":
			return "positive";
		case "Delivered":
			return "returned";
		case "Consumed":
			return "neutral";
		case "Inactive":
		case "Expired":
			return "warning";
		default:
			return "muted";
	}
};

export const batchTone = (row: Pick<BatchRow, "tone" | "total_qty" | "disabled">): LotTone => {
	if (row.disabled) return "muted";
	if (row.tone === "expired") return "negative";
	if (row.tone === "soon") return "warning";
	if (row.total_qty <= 0) return "muted";
	return "positive";
};

/** The batch chip's word: a date, a countdown, or the stock verdict. */
export const batchStatusKey = (
	row: Pick<BatchRow, "tone" | "days_to_expiry" | "total_qty" | "disabled">,
): { key: string; count: number | null } => {
	if (row.disabled) return { key: "Disabled", count: null };
	if (row.tone === "expired") return { key: "Expired lot", count: null };
	if (row.tone === "soon") return { key: "Expires in {0} days", count: row.days_to_expiry ?? 0 };
	if (row.total_qty <= 0) return { key: "Empty", count: null };
	return { key: "Available", count: null };
};

/**
 * One line under a serial's name: where it is, or where it went.
 *
 * Returns a translation KEY and its args — the surface calls `__()`. A row
 * with a live outward movement reads «Sold on {voucher} · {date}»; an
 * in-stock row names its warehouse; anything else falls back to the status.
 */
export const describeSerialWhereabouts = (
	row: Pick<SerialRow, "status" | "warehouse" | "last_voucher_no" | "last_moved_at" | "last_outward" | "customer">,
): { key: string; args: string[] } => {
	if (row.status === "Active" && row.warehouse) {
		return { key: "{0}", args: [row.warehouse] };
	}
	if (row.last_outward && row.last_voucher_no) {
		const when = (row.last_moved_at || "").slice(0, 10);
		if (row.customer) {
			return { key: "{0} · {1} · {2}", args: [row.last_voucher_no, when, row.customer] };
		}
		return { key: "{0} · {1}", args: [row.last_voucher_no, when] };
	}
	if (row.last_voucher_no) {
		return { key: "{0} · {1}", args: [row.last_voucher_no, (row.last_moved_at || "").slice(0, 10)] };
	}
	return { key: "—", args: [] };
};

/** Does a row satisfy the search box locally (a keystroke between two pages)? */
export const matchesLotQuery = (
	row: { serial_no?: string; batch_no?: string; item_code: string; item_name: string; customer?: string | null },
	query: string,
): boolean => {
	const term = normalizeLotQuery(query);
	if (!term) return true;
	const hay = [row.serial_no, row.batch_no, row.item_code, row.item_name, row.customer]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return hay.includes(term.toLowerCase());
};

/**
 * The same reading the server gives a term: an IMEI dictated with spaces or
 * dashes collapses to its digits; words keep single spaces.
 */
export const normalizeLotQuery = (raw: string | null | undefined): string => {
	const text = String(raw ?? "").trim();
	if (!text) return "";
	const compact = text.replace(/[\s-]/g, "");
	if (/^\d+$/.test(compact)) return compact;
	return text.replace(/\s+/g, " ");
};

/** Desk URL for a voucher, for the «Open document» link. */
export const voucherDeskPath = (voucherType: string, voucherNo: string): string =>
	`/app/${String(voucherType || "")
		.toLowerCase()
		.replace(/\s+/g, "-")}/${encodeURIComponent(voucherNo)}`;

/** A cart row's own catalogue row — whatever the store holds for the item. */
export interface CatalogueRowLike {
	item_code?: string | null;
	warehouse?: string | null;
	has_serial_no?: unknown;
	has_batch_no?: unknown;
	[key: string]: any;
}

/**
 * «Sell this one»: ONE `lot:confirm` add for a serial the register may sell.
 *
 * Shaped exactly as `lotPicker.buildAdd` shapes a picked serial —
 * `serial_no_selected` + count + the newline-joined `serial_no` — because the
 * add path (`ItemsSelector.onLotConfirm` → `add_item` with `lotResolved`) reads
 * that contract and nothing else. Refused, never coerced, when the server did
 * not mark the unit sellable here: the add would die at submit with «not in
 * warehouse», the very wall this surface exists to remove.
 */
export const buildSerialAdd = (
	catalogueRow: CatalogueRowLike | null | undefined,
	row: Pick<SerialRow, "serial_no" | "item_code" | "sellable_here" | "batch_no">,
): Record<string, any> | null => {
	if (!catalogueRow || !row?.sellable_here || !row.serial_no) return null;
	if (String(catalogueRow.item_code || "") !== row.item_code) return null;
	const payload: Record<string, any> = {
		...catalogueRow,
		code: row.item_code,
		item_code: row.item_code,
		qty: 1,
		serial_no_selected: [row.serial_no],
		serial_no_selected_count: 1,
		serial_no: row.serial_no,
	};
	if (row.batch_no) {
		payload.batch_no = row.batch_no;
		payload.to_set_batch_no = row.batch_no;
	}
	delete payload.filtered_serial_no_data;
	delete payload.to_set_serial_no;
	return payload;
};

/** «Sell from this batch»: one unit of a batch the register may sell. */
export const buildBatchAdd = (
	catalogueRow: CatalogueRowLike | null | undefined,
	row: Pick<BatchRow, "batch_no" | "item_code" | "sellable_here" | "qty_here">,
	qty = 1,
): Record<string, any> | null => {
	if (!catalogueRow || !row?.sellable_here || !row.batch_no) return null;
	if (String(catalogueRow.item_code || "") !== row.item_code) return null;
	const wanted = Math.max(1, Math.min(Number(qty) || 1, Number(row.qty_here) || 1));
	const payload: Record<string, any> = {
		...catalogueRow,
		code: row.item_code,
		item_code: row.item_code,
		qty: wanted,
		batch_no: row.batch_no,
		to_set_batch_no: row.batch_no,
	};
	delete payload.filtered_serial_no_data;
	delete payload.to_set_serial_no;
	return payload;
};

/** The `?q=` a support instruction can carry: `/lots?q=353150400443913`. */
export const lotQueryFromSearch = (search: string | null | undefined): string => {
	try {
		const params = new URLSearchParams(String(search || ""));
		return normalizeLotQuery(params.get("q") || params.get("serial") || params.get("batch") || "");
	} catch {
		return "";
	}
};

export const lotKindFromSearch = (search: string | null | undefined): LotKind => {
	try {
		const params = new URLSearchParams(String(search || ""));
		if (params.get("batch")) return "batch";
		const kind = params.get("kind");
		return kind === "batch" ? "batch" : "serial";
	} catch {
		return "serial";
	}
};

/**
 * The verb a movement line wears. ERPNext names the DOCTYPE; the counter
 * reads what HAPPENED — a sale, a return, a purchase, an issue, an
 * adjustment — and the story is read top-down at a glance.
 */
export const movementLabel = (
	move: Pick<LotMovement, "voucher_type" | "outward" | "is_return">,
): string => {
	switch (move.voucher_type) {
		case "Sales Invoice":
		case "Delivery Note":
			return move.outward ? "Sale" : "Return";
		case "Purchase Receipt":
		case "Purchase Invoice":
			return move.outward ? "Purchase return" : "Purchase";
		case "Stock Reconciliation":
			return "Adjustment";
		case "Stock Entry":
			return move.outward ? "Issued" : "Received";
		default:
			return move.outward ? "Stock out" : "Stock in";
	}
};

export const movementTone = (move: Pick<LotMovement, "outward" | "cancelled">): LotTone => {
	if (move.cancelled) return "muted";
	return move.outward ? "returned" : "positive";
};

/** A stamp trimmed to the minute — the story reads dates, not microseconds. */
export const shortStamp = (stamp: string | null | undefined): string => {
	const text = String(stamp || "").replace("T", " ");
	return text ? text.slice(0, 16) : "—";
};
