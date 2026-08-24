/**
 * Live margin and cost for the cart (convergence checklist item F,
 * `Main.dc.html` nodes 113–116: `Margen estimado $457` · `Costo $672`).
 *
 * Pure by construction: no Vue, no store, no `__()`. The component asks this
 * module what to render and renders it, the contract `registerStatusLine.ts`
 * and `bandState.ts` already use.
 *
 * ## Why cost needs more care than the other figures on this card
 *
 * Every other number in the summary is one the cashier is allowed to see and
 * the customer is about to be told. Cost is neither. §11 F says so plainly —
 * *gate it behind a role before building it* — and the gate is already real:
 * `item_fetchers._session_may_see_item_cost` nulls `valuation_rate` on the way
 * out for any session without a supervisor role, so a normal cashier's payload
 * never carries the figure at all.
 *
 * That server gate is the one that matters; this module's supervisor check is
 * the second half of the same rule, not a substitute for it. Both are needed:
 * without the server's, the cost sits in every cashier's IndexedDB whether it
 * is drawn or not; without this one, a supervisor's cached catalogue would
 * keep printing cost after the terminal was handed to somebody else.
 *
 * ## Three states, because two would have to lie
 *
 * A cart can be missing cost for one line and carry it for the other nine.
 * Summing what we have and calling it "the cost" understates cost and
 * therefore OVERSTATES margin — the direction that flatters the owner and is
 * the one worth being careful about. So a partial cart reports `incomplete`
 * and the strip says so instead of showing a figure.
 *
 * ## One deliberate divergence from the artboard
 *
 * The artboard's own numbers are `Total MX$1,129.00`, `Subtotal $973.28`,
 * `IVA $155.72`, `Costo $672`, `Margen estimado $457` — and 1,129 − 672 = 457,
 * so the mock computes margin against the TAX-INCLUSIVE total. On a real
 * register that is wrong by the whole IVA: the tax is collected for the SAT
 * and never was the shop's to earn, and a margin quoting it would overstate
 * every ticket by 16%. This module subtracts cost from NET revenue instead
 * (973.28 − 672 = 301.28 on the artboard's own figures). The artboard is the
 * reference for what appears on screen and where; it is not a reference for
 * arithmetic about somebody's money.
 */

/** What the strip should draw. */
export type CartMarginState =
	/** Not a supervisor, or nothing to describe. The row is absent. */
	| "hidden"
	/** At least one line has no cost. The row says so and shows no figure. */
	| "incomplete"
	/** Every line is costed. `cost` and `margin` are both numbers. */
	| "ready";

export interface CartMarginLine {
	/** Quantity in the line's own UOM. */
	qty?: unknown;
	/** Quantity in the STOCK UOM — what `valuation_rate` is priced against. */
	stock_qty?: unknown;
	conversion_factor?: unknown;
	/** Item cost per stock unit. `null` when the server stripped it. */
	valuation_rate?: unknown;
}

export interface CartMarginInput {
	lines?: readonly CartMarginLine[] | null;
	/**
	 * Revenue EXCLUDING tax, after discounts — the same `netSubtotal` the
	 * breakdown prints beside `IVA`. Passed in rather than recomputed so the
	 * margin can never disagree with the subtotal drawn two inches away.
	 */
	netRevenue?: unknown;
	/** The acting cashier's role, not the logged-in user's. */
	isSupervisor?: boolean;
}

export interface CartMargin {
	state: CartMarginState;
	/** Total cost of the cart, or null unless `state === "ready"`. */
	cost: number | null;
	/** Net revenue minus cost, or null unless `state === "ready"`. */
	margin: number | null;
}

const HIDDEN: CartMargin = Object.freeze({ state: "hidden", cost: null, margin: null });
const INCOMPLETE: CartMargin = Object.freeze({
	state: "incomplete",
	cost: null,
	margin: null,
});

const finite = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

/** Money rounding, applied once at the end rather than per line. */
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * How many STOCK units this line moves.
 *
 * `valuation_rate` is priced per stock UOM, so a line sold by the box against
 * a cost held per piece has to be converted or the cost is out by the
 * conversion factor. `stock_qty` is what `calcStockQty` maintains for exactly
 * this; `qty × conversion_factor` is the same product, used when the line has
 * not been through that path yet.
 */
export function stockUnits(line: CartMarginLine): number | null {
	const stockQty = finite(line?.stock_qty);
	if (stockQty !== null && stockQty !== 0) {
		return stockQty;
	}
	const qty = finite(line?.qty);
	if (qty === null) {
		return stockQty; // 0 or null — either way there is nothing to convert
	}
	const factor = finite(line?.conversion_factor);
	return qty * (factor === null || factor === 0 ? 1 : factor);
}

/**
 * The cost this line contributes, or `null` when it cannot be known.
 *
 * A `valuation_rate` at or below zero counts as UNKNOWN rather than as free.
 * It is what an item that was never valued looks like, it is what a stripped
 * payload looks like once a cache has round-tripped it through `0`, and
 * treating it as a genuine zero would credit the shop with pure profit on that
 * line. Between "we cannot say" and "it cost nothing", only one of those is
 * ever wrong in the owner's favour.
 */
export function lineCost(line: CartMarginLine): number | null {
	const units = stockUnits(line);
	if (units === null || units === 0) {
		// No quantity, no contribution — and no reason to demand a cost for it.
		return 0;
	}
	const rate = finite(line?.valuation_rate);
	if (rate === null || rate <= 0) {
		return null;
	}
	return rate * units;
}

/**
 * Resolve what the summary should draw beside the total.
 */
export function resolveCartMargin(input: CartMarginInput = {}): CartMargin {
	if (!input.isSupervisor) {
		return HIDDEN;
	}
	const lines = Array.isArray(input.lines) ? input.lines : [];
	if (!lines.length) {
		// An empty cart has no margin, and "Margen estimado $0.00" beside an
		// empty total is noise pretending to be information.
		return HIDDEN;
	}

	let cost = 0;
	for (const line of lines) {
		const contribution = lineCost(line || {});
		if (contribution === null) {
			return INCOMPLETE;
		}
		cost += contribution;
	}

	const revenue = finite(input.netRevenue);
	if (revenue === null) {
		// Cost without revenue is half a subtraction. Say nothing rather than
		// print a margin computed against a total we could not read.
		return INCOMPLETE;
	}

	return {
		state: "ready",
		cost: round2(cost),
		margin: round2(revenue - cost),
	};
}

export default resolveCartMargin;
