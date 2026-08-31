/**
 * The cart, as the phone draws it (`MovilVenta.dc.html`, nodes 20–44).
 *
 * The phone shows one line per row and has room for exactly one subtitle:
 *
 *     Combo Protección iPhone 15 Pro   [COMBO · 3] [−$41]           299
 *     Anillo Case iPhone 12 Pro Max    IPN001545 · quedan 5         200
 *     Adaptador Apple Lightning a Jack IPN001880 · 2 × 120 · quedan 3  240
 *
 * ⚠ THIS MODULE ADDS TWO FIELDS AND NOTHING ELSE.
 *
 * `payments/saleSummary.ts` already shapes a cart line for a small surface —
 * key, name, qty, rate, amount, combo badge, saving — and the payment screen
 * ships it. Re-deriving that here would give the register two answers to
 * "what is a combo" and "which amount is authoritative", which is the failure
 * `saleSummary` itself warns about. So the summary is imported whole and this
 * module contributes only:
 *
 *   `stock` — the one thing the sale screen shows and the payment screen does
 *   not: `quedan N`, from `invoice/cartLineStock.ts`, so the phone and the
 *   desktop cart obey the same absence rule (an ABSENT figure renders nothing,
 *   never `0` — `0` is a claim a cashier repeats out loud).
 *
 *   `rowId` — the row's own `posa_row_id`, added for the movil LINE SHEET
 *   (round 10). `key` cannot serve: it falls back to `CODE#index` so that
 *   `v-for` always has something, and an EDIT addressed by that would land on
 *   whichever row matched first. A line the register has not yet stamped
 *   carries `""` here, and the tap falls back to the classic cart.
 *
 * Pure: no Vue, no store, no `__()`. Labels come out as parts and the
 * component assembles them, matching `saleSummary.ts` and `bandState.ts`.
 */

import {
	resolveSaleSummary,
	type SaleSummaryLine,
	type SaleSummarySourceLine,
} from "../../payments/saleSummary";
import {
	describeLineStock,
	type CartLineStockDisplay,
	type CartLineStockSource,
} from "../../invoice/cartLineStock";

/** A cart line plus the phone's `Existencia` figure and the row's identity. */
export interface MobileSaleLine extends SaleSummaryLine {
	/**
	 * `quedan N`, or the instruction to draw nothing. Never a bare `0` unless
	 * the shelf genuinely reads zero — see `cartLineStock.ts`.
	 */
	stock: CartLineStockDisplay;
	/**
	 * `posa_row_id` — the identity every engine handler resolves a cart row by
	 * (`ItemsTable`'s `getItemIndex`, `Invoice.vue`'s `focusCartItemQty`).
	 * Empty when the register has not stamped one yet; the line sheet refuses
	 * to open on an empty one rather than editing by item code.
	 */
	rowId: string;
	/**
	 * The row's photo, in the desk's own preference order
	 * (`CartItemRow.lineThumbSrc`): the pre-shrunk `posa_image_thumb` first,
	 * the full `image` as its stand-in. Empty means the tile stays a quiet
	 * grey square — the row's rhythm, never a broken-image glyph.
	 */
	thumbSrcs: string[];
}

export interface MobileSaleCart {
	lines: MobileSaleLine[];
	/** Rows on the ticket — the artboard's "6 líneas". */
	lineCount: number;
	/** Pieces across those rows — the artboard's "9 piezas". */
	pieceCount: number;
}

export interface MobileSaleLinesOptions {
	/** POS Profile `posa_low_stock_alert_threshold` (Int, default 10). */
	lowStockThreshold?: unknown;
}

/**
 * Rows `resolveSaleSummary` keeps, in its order.
 *
 * Restated rather than exported from there because the two modules must agree
 * on WHICH rows survive, and a mismatch is caught below rather than papered
 * over: `resolveSaleSummary` drops a falsy row and a row carrying neither a
 * code nor a name, because that is a cart mid-way through building a line and
 * drawing it puts a blank row and a $0 on screen the instant somebody taps Add.
 */
const isDrawableRow = (row: SaleSummarySourceLine | null | undefined): boolean => {
	if (!row) return false;
	const code = String(row.item_code ?? "").trim();
	const name = String(row.item_name ?? "").trim();
	return Boolean(code || name);
};

/**
 * Shape the cart for the phone.
 *
 * The stock figures are zipped onto the summary's lines POSITIONALLY, which is
 * only sound while both walks keep the same rows. If they ever disagree — a
 * future change to either filter — every line degrades to "no figure" rather
 * than pairing line 3's stock onto line 4. Showing nothing costs a cashier one
 * glance at the shelf; showing the WRONG shelf count sells stock the shop does
 * not have, and does it confidently.
 */
export const describeMobileSaleLines = (
	items: readonly (SaleSummarySourceLine | null | undefined)[] | null | undefined,
	options: MobileSaleLinesOptions = {},
): MobileSaleCart => {
	const summary = resolveSaleSummary(items);
	const rows = (Array.isArray(items) ? items : []).filter(isDrawableRow);
	const paired = rows.length === summary.lines.length;

	return {
		lines: summary.lines.map((line, index) => {
			const source = paired ? rows[index] : null;
			return {
				...line,
				stock: describeLineStock(source as CartLineStockSource | null, {
					lowStockThreshold: options.lowStockThreshold,
				}),
				// Same pairing rule as the stock figure: unpaired means every
				// line degrades to "no identity" (and so to the classic-cart
				// fallback) rather than one line carrying its neighbour's.
				rowId: String(source?.posa_row_id ?? "").trim(),
				thumbSrcs: [
					(source as Record<string, unknown> | null)?.posa_image_thumb,
					(source as Record<string, unknown> | null)?.image,
				]
					.map((src) => String(src ?? "").trim())
					.filter(Boolean),
			};
		}),
		lineCount: summary.lineCount,
		pieceCount: summary.pieceCount,
	};
};

export default describeMobileSaleLines;
