/**
 * Which physical unit is being sold — the model behind the LOT PICKER.
 *
 * A pharmacy does not sell "Paracetamol 500mg". It sells a numbered box with a
 * date on it, and which box leaves the shelf is a decision somebody has to make
 * out loud. Until now the register only let a cashier make it AFTER the fact:
 * an item with `has_batch_no` / `has_serial_no` was added like any other and the
 * choice hid inside the cart row's expanded panel (`ItemsTableExpandedRow.vue`),
 * which the phone does not have at all — so on glass those items landed
 * unusable.
 *
 * This module is the half of the picker that is a DECISION rather than a
 * widget: whether a tapped catalogue row needs the picker at all, what the
 * picker may offer, and what an answered picker turns into. It is pure — no
 * Vue, no store, no `__()` — so the gates can be asserted without a DOM, and so
 * the phone and the desk cannot drift into two answers.
 *
 * ⚠ IT INVENTS NO STOCK RULE.
 *
 * FEFO ordering, "is this expired", and "which serials belong to this batch"
 * are `useBatchSerial`'s own answers, imported rather than restated. What this
 * module adds is the shape a picker needs (rows, tones, reasons) and the ONE
 * translation from a cashier's selection into the add payloads the existing
 * pipeline already understands.
 */

import { applySerialBatchFilter, isBatchExpired } from "../../../../composables/pos/shared/useBatchSerial";

/** What the cashier is being asked to choose. */
export type LotMode =
	/** Serial-numbered only: pick N units by serial, qty = N. */
	| "serial"
	/** Batch-tracked only: pick quantities per batch, possibly across several. */
	| "batch"
	/** Both: the batch narrows the serial list (pharma's usual shape). */
	| "both";

/** Why a row cannot be picked. A KEY, not a sentence — the surface translates. */
export type LotBlockReason =
	/** Past its expiry date; the shelf may not sell it. */
	| "expired"
	/** Nothing left of it in this warehouse. */
	| "empty"
	/** Already committed to another line of this same ticket. */
	| "in-cart";

/** How urgently a date should read. `none` = the row carries no expiry at all. */
export type LotExpiryTone = "none" | "ok" | "soon" | "expired";

/** A date this close to expiry earns the warning tone (owner ask: pharma). */
export const LOT_EXPIRY_WARNING_DAYS = 30;

/**
 * How long the picker waits before re-filtering on a keystroke.
 *
 * Exported so the spec waits the real interval instead of guessing one: a test
 * that out-waits a debounce by luck is a test that goes green on a slow CI box
 * for the wrong reason.
 */
export const LOT_SEARCH_DEBOUNCE_MS = 120;

export interface LotProfile {
	/** When on, a batch-only item auto-picks FEFO and the picker stands down. */
	posa_auto_set_batch?: unknown;
}

export interface LotSourceItem {
	item_code?: string | null;
	item_name?: string | null;
	warehouse?: string | null;
	stock_uom?: string | null;
	uom?: string | null;
	has_serial_no?: unknown;
	has_batch_no?: unknown;
	has_variants?: unknown;
	batch_no?: string | null;
	serial_no_selected?: unknown;
	/** Set by `useScanProcessor` when the barcode itself named the unit. */
	to_set_serial_no?: string | null;
	to_set_batch_no?: string | null;
	batch_no_data?: unknown;
	serial_no_data?: unknown;
	[key: string]: any;
}

export interface LotBatchRow {
	batchNo: string;
	expiryDate: string | null;
	manufacturingDate: string | null;
	availableQty: number;
	isExpired: boolean;
	/** Negative once past; `null` when the batch carries no expiry date. */
	daysToExpiry: number | null;
	tone: LotExpiryTone;
	selectable: boolean;
	blockedReason: LotBlockReason | null;
}

export interface LotSerialRow {
	serialNo: string;
	batchNo: string | null;
	/** Inherited from the serial's own batch — a serial has no date of its own. */
	expiryDate: string | null;
	daysToExpiry: number | null;
	tone: LotExpiryTone;
	warehouse: string | null;
	warrantyExpiryDate: string | null;
	purchaseDate: string | null;
	selectable: boolean;
	blockedReason: LotBlockReason | null;
}

export interface LotPickerView {
	/** The catalogue row the picker was opened on — the add is built from it. */
	source: LotSourceItem;
	mode: LotMode;
	itemCode: string;
	itemName: string;
	warehouse: string;
	uom: string;
	/** FEFO: soonest expiry first, expired last, undated after dated. */
	batches: LotBatchRow[];
	serials: LotSerialRow[];
	/** Nothing on this shelf can be chosen — the primary stays closed. */
	isEmpty: boolean;
}

export interface LotPickerOptions {
	profile?: LotProfile | null;
	/** Fixed "today" for the expiry arithmetic; a spec pins it. */
	today?: Date | string;
	/** Serials this ticket already committed elsewhere (see `serialSelection`). */
	usedSerials?: Iterable<string> | null;
}

/** One batch's share of a quantity. Several make a split across batches. */
export interface LotBatchAllocation {
	batchNo: string;
	qty: number;
}

export interface LotSelection {
	serials?: string[];
	batches?: LotBatchAllocation[];
}

/** An `add_item` payload: the catalogue row with its unit already decided. */
export type LotAddPayload = Record<string, any> & { qty: number };

const DAY_MS = 86400000;

const text = (value: unknown): string => String(value ?? "").trim();

const flag = (value: unknown): boolean => Boolean(value);

const toNumber = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) ? parsed : 0;
};

const startOfDay = (value: Date | string): number | null => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

/**
 * Whole days from `today` to `expiry`. Negative once past, 0 on the day itself
 * — which is already expired, because `isBatchExpired` refuses the day of.
 */
export const daysToExpiry = (
	expiry: unknown,
	today: Date | string = new Date(),
): number | null => {
	const raw = text(expiry);
	if (!raw) return null;
	const target = startOfDay(raw);
	const from = startOfDay(today);
	if (target === null || from === null) return null;
	return Math.round((target - from) / DAY_MS);
};

/** The tone a date reads in: expired, expiring soon, or simply dated. */
export const expiryTone = (days: number | null, expired: boolean): LotExpiryTone => {
	if (expired) return "expired";
	if (days === null) return "none";
	return days <= LOT_EXPIRY_WARNING_DAYS ? "soon" : "ok";
};

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/**
 * Does this tapped catalogue row need a cashier to choose a unit first?
 *
 * `null` means "add it the way you always did". Every `null` below is an
 * existing behaviour being PRESERVED, not a corner being cut:
 *
 *  - a TEMPLATE belongs to the variant picker, which runs before this one;
 *  - a scanned serial/batch (`to_set_*`) already named the unit — the barcode
 *    is the answer, and raising a dialog over a scan gun would be a regression;
 *  - a row that already carries `batch_no` / `serial_no_selected` has been
 *    through this picker (or through a re-add of a resolved line): re-opening
 *    on our own output would be an infinite door;
 *  - `posa_auto_set_batch` on the profile means the shop has DELEGATED the
 *    batch choice to FEFO, and a shop that asked not to be asked is not asked.
 *    (It only silences the BATCH question — a serialised item still needs a
 *    cashier to say which numbered unit left the shelf.)
 */
export const resolveLotRequirement = (
	item: LotSourceItem | null | undefined,
	profile: LotProfile | null | undefined = null,
): LotMode | null => {
	if (!item) return null;
	if (flag(item.has_variants)) return null;

	const hasSerial = flag(item.has_serial_no);
	const hasBatch = flag(item.has_batch_no);
	if (!hasSerial && !hasBatch) return null;

	// The scanner already decided.
	if (text(item.to_set_serial_no) || text(item.to_set_batch_no)) return null;

	// Our own output coming back around.
	const alreadySerialised = asArray(item.serial_no_selected).length > 0;
	if (hasSerial && alreadySerialised) return null;
	if (!hasSerial && hasBatch && text(item.batch_no)) return null;

	if (hasSerial) return hasBatch ? "both" : "serial";
	return flag(profile?.posa_auto_set_batch) ? null : "batch";
};

const buildBatchRows = (
	item: LotSourceItem,
	today: Date | string,
): LotBatchRow[] => {
	const rows = asArray(item.batch_no_data)
		.map((batch: any, index: number) => {
			const batchNo = text(batch?.batch_no);
			if (!batchNo) return null;
			// `available_qty` is what `getBatchAvailability` leaves behind once
			// the cart's own lines are subtracted; `batch_qty` is the raw shelf.
			const availableQty = toNumber(
				batch.available_qty ?? batch.batch_qty ?? batch.original_batch_qty,
			);
			const expired =
				typeof batch.is_expired === "boolean"
					? batch.is_expired
					: isBatchExpired(batch, today);
			const expiryDate = text(batch.expiry_date) || null;
			const days = daysToExpiry(expiryDate, today);
			const blockedReason: LotBlockReason | null = expired
				? "expired"
				: availableQty <= 0
					? "empty"
					: null;
			return {
				_index: index,
				batchNo,
				expiryDate,
				manufacturingDate: text(batch.manufacturing_date) || null,
				availableQty,
				isExpired: expired,
				daysToExpiry: days,
				tone: expiryTone(days, expired),
				selectable: blockedReason === null,
				blockedReason,
			};
		})
		.filter(Boolean) as Array<LotBatchRow & { _index: number }>;

	// FEFO, the same ordering `getBatchAvailability` sorts a cart line by:
	// expired last, then soonest expiry, then oldest manufacture, then the
	// order the server sent. A pharmacy reads this list top-down and takes the
	// first row; anything else quietly ages the shelf.
	rows.sort((a, b) => {
		if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
		if (a.expiryDate && b.expiryDate) {
			const diff = (startOfDay(a.expiryDate) ?? 0) - (startOfDay(b.expiryDate) ?? 0);
			if (diff !== 0) return diff;
		} else if (a.expiryDate) return -1;
		else if (b.expiryDate) return 1;

		if (a.manufacturingDate && b.manufacturingDate) {
			const diff =
				(startOfDay(a.manufacturingDate) ?? 0) - (startOfDay(b.manufacturingDate) ?? 0);
			if (diff !== 0) return diff;
		} else if (a.manufacturingDate) return -1;
		else if (b.manufacturingDate) return 1;

		return a._index - b._index;
	});

	return rows.map(({ _index, ...row }) => row);
};

const buildSerialRows = (
	item: LotSourceItem,
	batches: LotBatchRow[],
	today: Date | string,
	usedSerials: Set<string>,
): LotSerialRow[] => {
	const batchByNo = new Map(batches.map((batch) => [batch.batchNo, batch]));
	const seen = new Set<string>();

	return asArray(item.serial_no_data)
		.map((serial: any) => {
			const serialNo = text(serial?.serial_no);
			if (!serialNo || seen.has(serialNo)) return null;
			seen.add(serialNo);

			const batchNo = text(serial?.batch_no) || null;
			const batch = batchNo ? batchByNo.get(batchNo) : undefined;
			// A serial has no date of its own; the box it came in does.
			const expiryDate = batch?.expiryDate ?? (text(serial?.expiry_date) || null);
			const expired = batch ? batch.isExpired : isBatchExpired({ expiry_date: expiryDate }, today);
			const days = daysToExpiry(expiryDate, today);
			const blockedReason: LotBlockReason | null = expired
				? "expired"
				: usedSerials.has(serialNo)
					? "in-cart"
					: null;

			return {
				serialNo,
				batchNo,
				expiryDate,
				daysToExpiry: days,
				tone: expiryTone(days, expired),
				warehouse: text(serial?.warehouse) || null,
				warrantyExpiryDate: text(serial?.warranty_expiry_date) || null,
				purchaseDate: text(serial?.purchase_date) || null,
				selectable: blockedReason === null,
				blockedReason,
			};
		})
		.filter(Boolean) as LotSerialRow[];
};

/**
 * The whole picker, or `null` when this row does not need one.
 *
 * Deliberately tolerant of a row whose lot arrays have not arrived yet: the
 * surface opens on what the register already knows and re-draws when the
 * detail fetch answers, which is why a view with zero rows is a legitimate —
 * and clearly labelled — state rather than a reason to refuse to open.
 */
export const resolveLotPicker = (
	item: LotSourceItem | null | undefined,
	options: LotPickerOptions = {},
): LotPickerView | null => {
	const mode = resolveLotRequirement(item, options.profile ?? null);
	if (!item || !mode) return null;

	const today = options.today ?? new Date();
	const usedSerials = new Set<string>();
	for (const serial of options.usedSerials ?? []) {
		const normalized = text(serial);
		if (normalized) usedSerials.add(normalized);
	}

	// Built once: the serial rows read the batch rows for their expiry, and a
	// serial-only item simply has none to read.
	const batches = buildBatchRows(item, today);
	const serials = mode === "batch" ? [] : buildSerialRows(item, batches, today, usedSerials);

	const isEmpty =
		mode === "batch"
			? !batches.some((batch) => batch.selectable)
			: !serials.some((serial) => serial.selectable);

	return {
		source: item,
		mode,
		itemCode: text(item.item_code),
		itemName: text(item.item_name) || text(item.item_code),
		warehouse: text(item.warehouse),
		uom: text(item.uom) || text(item.stock_uom),
		batches: mode === "serial" ? [] : batches,
		serials,
		isEmpty,
	};
};

/**
 * The serial rows a chosen batch leaves standing.
 *
 * `applySerialBatchFilter` is asked the question, on a synthetic row, so the
 * picker and the cart line filter by the same rule — including its "no batch
 * chosen means every serial" branch.
 */
export const filterSerialsByBatch = (
	serials: LotSerialRow[],
	batchNo: string | null,
): LotSerialRow[] =>
	applySerialBatchFilter({
		has_serial_no: true,
		has_batch_no: true,
		batch_no: batchNo || null,
		serial_no_data: serials.map((serial) => ({ ...serial, batch_no: serial.batchNo })),
	}).map((row: any) => {
		const { batch_no: _ignored, ...rest } = row;
		return rest as LotSerialRow;
	});

/** Fields that are the PICKER's bookkeeping and have no business in a cart row. */
const stripPickerFields = (payload: Record<string, any>) => {
	delete payload.filtered_serial_no_data;
	delete payload.to_set_serial_no;
	delete payload.to_set_batch_no;
	return payload;
};

const buildAdd = (
	view: LotPickerView,
	part: { serials?: string[]; batchNo?: string | null; qty: number },
): LotAddPayload => {
	// `code` alongside `item_code` is what the variant picker's confirm sends —
	// `add_item`'s payload type carries both, and some listeners read `code`.
	const payload: Record<string, any> = {
		...view.source,
		code: view.itemCode,
		qty: part.qty,
	};
	stripPickerFields(payload);

	const batchNo = text(part.batchNo) || null;
	if (batchNo) {
		// BOTH fields, on purpose. `batch_no` is what the merge key is built
		// from, so two batches of one item land as two lines instead of being
		// folded into one; `to_set_batch_no` is what makes `addItem` run
		// `setBatchQty`, which fills the available qty, the expiry and the
		// batch price the same way a SCANNED batch does.
		payload.batch_no = batchNo;
		payload.to_set_batch_no = batchNo;
	} else if (flag(view.source.has_batch_no)) {
		payload.batch_no = null;
	}

	const serials = (part.serials ?? []).map(text).filter(Boolean);
	if (serials.length) {
		payload.serial_no_selected = serials;
		payload.serial_no_selected_count = serials.length;
		payload.serial_no = serials.join("\n");
	}

	return payload as LotAddPayload;
};

/**
 * What a confirmed picker becomes: one `add_item` payload per CART LINE.
 *
 * A cart line carries one batch, so a quantity split across three batches is
 * three lines — exactly the shape the engine already produces on its own when
 * it allocates FEFO across batches (`extra_items` in `useItemAddition`). N
 * serials of one batch stay ONE line with `serial_no_selected.length === N` and
 * `qty === N`, which is the contract `setSerialNo` keeps for the cart row.
 *
 * Anything the view marked unselectable is dropped rather than trusted: a
 * programmatic confirm (a stray dispatch, an assistive tool, a test) must not
 * be able to walk past an expired lot.
 */
export const resolveLotAdds = (
	view: LotPickerView | null | undefined,
	selection: LotSelection = {},
): LotAddPayload[] => {
	if (!view) return [];

	const selectableSerials = new Map(
		view.serials.filter((serial) => serial.selectable).map((serial) => [serial.serialNo, serial]),
	);
	const chosenSerials = Array.from(
		new Set((selection.serials ?? []).map(text).filter((serial) => selectableSerials.has(serial))),
	);

	if (view.mode === "serial" || view.mode === "both") {
		if (!chosenSerials.length) return [];
		if (view.mode === "serial") {
			return [buildAdd(view, { serials: chosenSerials, qty: chosenSerials.length })];
		}
		// Both: group by the batch each serial actually belongs to. A cashier
		// who filtered by one batch produces one group; one who picked across
		// batches gets one line per box, which is what the stock ledger needs.
		const groups = new Map<string, string[]>();
		for (const serialNo of chosenSerials) {
			const key = selectableSerials.get(serialNo)?.batchNo ?? "";
			const bucket = groups.get(key);
			if (bucket) bucket.push(serialNo);
			else groups.set(key, [serialNo]);
		}
		return Array.from(groups.entries()).map(([batchNo, serials]) =>
			buildAdd(view, { serials, batchNo: batchNo || null, qty: serials.length }),
		);
	}

	const selectableBatches = new Map(
		view.batches.filter((batch) => batch.selectable).map((batch) => [batch.batchNo, batch]),
	);
	const adds: LotAddPayload[] = [];
	for (const allocation of selection.batches ?? []) {
		const batch = selectableBatches.get(text(allocation?.batchNo));
		if (!batch) continue;
		const qty = toNumber(allocation?.qty);
		if (qty <= 0) continue;
		// Never more than the shelf has: the stepper caps it in the UI, and
		// this caps it again for anything that did not come from the stepper.
		adds.push(buildAdd(view, { batchNo: batch.batchNo, qty: Math.min(qty, batch.availableQty) }));
	}
	return adds;
};

/** How many units a selection commits — the header's live figure. */
export const resolveLotTotalQty = (adds: LotAddPayload[]): number =>
	adds.reduce((total, add) => total + toNumber(add.qty), 0);

export default resolveLotPicker;
