/**
 * Cart ↔ table-order translation (spec §6.1).
 *
 * The cart already mints a stable per-line id (`posa_row_id`), so it IS the
 * `line_uid` — a second identity would only be a second thing to keep in step.
 *
 * The delta is a **per-line union**, never a whole-payload replace: lines the
 * server holds that this cart never saw must survive, because the other waiter
 * who added them is not wrong. Only lines this device actually dropped are
 * named in `removed_line_uids`.
 *
 * @module posapp/stores/floor/floorCartBridge
 */
import { ensureLineUid, type OrderLine, type OrderRow } from "../../api/restaurant";

/**
 * The cart, expressed as table-order lines.
 *
 * A line with no `line_uid` is silently dropped by both the offline coalescer
 * and the server, so `ensureLineUid` mints one — but the minted id is then
 * written BACK onto the cart row. Without that write it would be a fresh id on
 * every debounce tick, and the union would upsert the same food as a new line
 * each time instead of updating one. (`invoiceStore` stamps `posa_row_id` on
 * every insert path, so this is a backstop, not the normal case.)
 */
export const cartAsLines = (cartItems: readonly any[]): OrderLine[] =>
	cartItems.map((item) => {
		const line = ensureLineUid({
			line_uid: item.posa_row_id,
			item_code: String(item.item_code),
			item_name: item.item_name ?? null,
			qty: Number(item.qty) || 0,
			uom: item.uom ?? null,
			rate: Number(item.rate) || 0,
			notes: item.posa_notes ?? null,
			course_idx: Number(item.posa_course_idx) || 1,
			seat: Number(item.posa_seat) || 0,
		});
		if (!item.posa_row_id) {
			item.posa_row_id = line.line_uid;
		}
		return line;
	});

/**
 * Order lines as cart rows. They carry only what the ticket records, so the
 * cart receives item_code/qty/rate/uom and the existing pricing path fills the
 * rest.
 */
export const orderAsCartItems = (order: OrderRow): Array<Record<string, unknown>> =>
	(order.lines || []).map((line) => ({
		posa_row_id: line.line_uid,
		item_code: line.item_code,
		item_name: line.item_name,
		qty: line.qty,
		uom: line.uom,
		rate: line.rate,
		amount: (Number(line.qty) || 0) * (Number(line.rate) || 0),
		posa_notes: line.notes,
		posa_course_idx: line.course_idx,
		posa_seat: line.seat ?? 0,
		// Read-only service truth for the cart's chips (critique B1/B4):
		// «enviada» is the kitchen's history, painted at resume — the fire
		// path clears the cart, so a live resync is not needed to keep it
		// honest.
		posa_line_fired: line.fired ? 1 : 0,
	}));

export interface LineDelta {
	upserts: OrderLine[];
	removed: string[];
	/** The cart keyed by line_uid — the next `syncedLines` baseline. */
	incoming: Map<string, OrderLine>;
}

const changed = (previous: OrderLine, line: OrderLine): boolean =>
	previous.qty !== line.qty ||
	previous.rate !== line.rate ||
	previous.notes !== line.notes ||
	previous.course_idx !== line.course_idx ||
	(previous.seat ?? 0) !== (line.seat ?? 0);

/** Diff the cart against what the server last accepted. */
export const buildLineDelta = (
	cartLines: OrderLine[],
	syncedLines: ReadonlyMap<string, OrderLine>,
): LineDelta => {
	const incoming = new Map(cartLines.map((line) => [line.line_uid, line]));
	const upserts: OrderLine[] = [];
	for (const line of cartLines) {
		const previous = syncedLines.get(line.line_uid);
		if (!previous || changed(previous, line)) {
			upserts.push(line);
		}
	}
	const removed: string[] = [];
	for (const lineUid of syncedLines.keys()) {
		if (!incoming.has(lineUid)) removed.push(lineUid);
	}
	return { upserts, removed, incoming };
};

/**
 * Rebase the baseline after a sync. Removals the server refused (the line is
 * already fired) stay in the baseline, or the next diff would ask again on
 * every keystroke.
 */
export const rebaseSyncedLines = (
	incoming: Map<string, OrderLine>,
	previous: ReadonlyMap<string, OrderLine>,
	rejectedRemovals: readonly string[] = [],
): Map<string, OrderLine> => {
	const next = new Map(incoming);
	for (const lineUid of rejectedRemovals) {
		const kept = previous.get(lineUid);
		if (kept) next.set(lineUid, kept);
	}
	return next;
};
