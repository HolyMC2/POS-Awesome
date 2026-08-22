/**
 * The line picker — "Qué regresa el cliente" (`Devolucion.dc.html`).
 *
 * **This module does not price a return.** It clamps a selection and projects
 * what the operator has chosen so the screen can show it. Every number it
 * produces is read straight off the original document's own per-unit `rate`;
 * nothing here decides a refund, allocates a discount, or computes a tax.
 * `api/invoice_processing/returns.py` and the cart still own all of that, and
 * the items this module marks selected are handed onward with their `rate`,
 * `price_list_rate`, `discount_*`, `net_*` and `amount` untouched — which is
 * what the screen means when it prints *"se conserva el precio, el IVA y la
 * forma de pago originales"*.
 *
 * NO TAX SPLIT, deliberately. The artboard's footer reads "Subtotal $128.45 ·
 * IVA $20.55", and the only way to produce those from what
 * `get_invoice_for_return` returns is `rate − net_rate`, which is the tax
 * only when the price list is tax-INCLUSIVE. On a tax-exclusive register the
 * same subtraction yields zero and the screen would report a return with no
 * IVA on it. A missing figure is a gap; a confidently wrong one is a defect,
 * so the split waits for the server to state it.
 */

import { roundMoney } from "../../../../composables/pos/combos/comboPricing";

/**
 * One returnable row, as `api.invoices.get_invoice_for_return` returns it.
 *
 * `qty` is already NET of every previous return against this invoice — the
 * endpoint subtracts them before it answers — so "cannot select more than was
 * sold" is enforced against this number and needs no second ledger here.
 */
export interface ReturnableLine {
	/** The original invoice's item row name; the picker's stable key. */
	name: string;
	item_code: string;
	item_name?: string;
	/** Per-unit price as recorded on the original sale. */
	rate?: number;
	/** Units still returnable. */
	qty?: number;
	uom?: string;
	warehouse?: string;
	serial_no?: string;
}

/** Requested units per row name. Absent or 0 means "not coming back". */
export type ReturnSelection = Readonly<Record<string, number>>;

const toNumber = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Units of this row that may come back.
 *
 * Clamped at both ends, and the upper clamp is the invariant with money
 * behind it: a register that accepts 5 back on a line that sold 1 pays out
 * four units it never took in. Non-integers are floored rather than rejected
 * because a weighed line (§4.2) genuinely returns 0.740 kg — flooring a
 * fractional request would silently refuse it.
 */
export const clampReturnQty = (requested: unknown, returnable: unknown): number => {
	const cap = Math.max(0, toNumber(returnable));
	const wanted = toNumber(requested);
	if (!(wanted > 0)) {
		return 0;
	}
	return wanted > cap ? cap : wanted;
};

export interface PlannedReturnLine {
	name: string;
	item_code: string;
	item_name: string;
	/** What the operator asked for, after clamping. */
	qty: number;
	/** What the original sale left available. */
	returnableQty: number;
	rate: number;
	/** `rate × qty`, for display beside the row. Never a refund decision. */
	amount: number;
	selected: boolean;
	/** The request exceeded what is returnable and was cut down to fit. */
	clamped: boolean;
	uom: string;
	warehouse: string;
	serial_no: string;
}

export interface ReturnLinePlan {
	lines: PlannedReturnLine[];
	selectedLineCount: number;
	totalLineCount: number;
	selectedPieceCount: number;
	/**
	 * Σ `rate × qty` over the selected rows, rounded once at the end.
	 *
	 * A PROJECTION of the original prices, shown so the cashier can see what
	 * they are about to hand over before they commit. The refund the customer
	 * actually receives is computed downstream from the return document, and
	 * this number never feeds it.
	 */
	selectedAmount: number;
	/** At least one row was asked for more than it had. */
	anyClamped: boolean;
}

/**
 * Everything selected at full quantity — the state the picker opens in.
 *
 * The artboard draws "1 de 3 artículos", one line ticked of three, and that
 * is a picture of a cashier mid-task, not a default. Opening with nothing
 * selected would change what the shipped flow does today: both entry points
 * that load a return (this dialog and Invoice Management) hand the WHOLE
 * invoice to the cart and let the cashier delete rows there. Selecting all is
 * the same document, reached the same way; deselecting is the cart's existing
 * delete, moved one screen earlier where the original quantities are still
 * on screen to check against.
 */
export const defaultSelection = (lines: readonly ReturnableLine[]): Record<string, number> => {
	const selection: Record<string, number> = {};
	for (const line of lines ?? []) {
		if (!line?.name) continue;
		selection[line.name] = Math.max(0, toNumber(line.qty));
	}
	return selection;
};

export const planReturnLines = (
	lines: readonly ReturnableLine[] | null | undefined,
	selection: ReturnSelection | null | undefined,
): ReturnLinePlan => {
	const planned: PlannedReturnLine[] = [];
	let selectedLineCount = 0;
	let selectedPieceCount = 0;
	let amount = 0;
	let anyClamped = false;

	for (const line of lines ?? []) {
		if (!line?.name) continue;
		const returnableQty = Math.max(0, toNumber(line.qty));
		const requested = selection ? selection[line.name] : undefined;
		const qty = clampReturnQty(requested, returnableQty);
		const clamped = toNumber(requested) > returnableQty;
		const rate = toNumber(line.rate);
		const lineAmount = roundMoney(rate * qty);

		if (qty > 0) {
			selectedLineCount += 1;
			selectedPieceCount += qty;
			amount += rate * qty;
		}
		if (clamped) {
			anyClamped = true;
		}

		planned.push({
			name: line.name,
			item_code: line.item_code,
			item_name: line.item_name || line.item_code,
			qty,
			returnableQty,
			rate,
			amount: lineAmount,
			selected: qty > 0,
			clamped,
			uom: line.uom || "",
			warehouse: line.warehouse || "",
			serial_no: line.serial_no || "",
		});
	}

	return {
		lines: planned,
		selectedLineCount,
		totalLineCount: planned.length,
		selectedPieceCount: roundMoney(selectedPieceCount),
		// Rounded once over the sum rather than per row: rounding each line and
		// then adding drifts by a cent per line, which is exactly the drift
		// comboReturns.ts spends a largest-remainder allocation avoiding.
		selectedAmount: roundMoney(amount),
		anyClamped,
	};
};

/**
 * The rows to hand onward, with every money field exactly as the server sent
 * it — only `qty` narrowed to what the operator selected.
 *
 * `source` is the raw item array from `get_invoice_for_return`; this returns
 * the same objects, filtered and with `qty` overwritten, so the caller's
 * existing mapping (which negates quantities and preserves rate, discount,
 * net_amount and `locked_price`) sees the shape it already expects.
 */
export const selectedSourceItems = <T extends { name?: string; qty?: number }>(
	source: readonly T[] | null | undefined,
	plan: ReturnLinePlan,
): T[] => {
	const byName = new Map(plan.lines.map((line) => [line.name, line]));
	const chosen: T[] = [];
	for (const item of source ?? []) {
		const line = item?.name ? byName.get(item.name) : undefined;
		if (!line || line.qty <= 0) continue;
		chosen.push({ ...item, qty: line.qty });
	}
	return chosen;
};
