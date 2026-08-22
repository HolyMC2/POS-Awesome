/**
 * Returning a combo, whole or in part — roadmap §17.6, §5.4 (Reverse).
 *
 * §5.4's rule for the register is that money goes back the way it came and an
 * exchange is a return plus a sale, LINKED, never an edited cart. Combos add
 * one question that rule does not answer on its own: what is a single
 * component of a combo worth when it comes back alone?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DECISION: refund a component at its ALLOCATED share, not at list.
 *
 * Three options were on the table.
 *
 * (a) Refuse partial returns — a combo comes back whole or not at all. Simple
 *     and safe for the till, and wrong at the counter: a customer whose mica
 *     arrived cracked is told to bring back the case and the installation
 *     too. The shop then does it by hand, off-ticket, and the combo's
 *     reporting is fiction.
 *
 * (b) Refund the component at its LIST price. This is the tempting one
 *     because list is the number already on the item. It hands back money the
 *     customer never paid — they bought the mica inside a discounted combo —
 *     and the gap is ARBITRAGEABLE: buy the 299 combo, return the 80 mica at
 *     list, keep a 299-worth of goods for 219. Anyone who notices can repeat
 *     it, and the shop finds out through inventory, not through the till.
 *
 * (c) Refund the component's allocated share of what was actually paid.
 *     `allocateComboPrice` splits the combo price proportionally to list
 *     value with largest-remainder, so the shares always sum to exactly the
 *     line total. The customer gets back precisely what that part cost them
 *     inside the combo, and there is no gap to arbitrage in either direction.
 *
 * (c) is implemented. It is the only one of the three where the money the
 * customer receives equals the money the customer paid.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE COROLLARY: the remainder keeps its discount, and stops calling itself a
 * combo.
 *
 * Once a component is returned, the customer holds two of three parts bought
 * at a bundle price. Two defensible things could happen to the rest:
 *
 *   - Reprice the remainder at list and claw back the discount. Commercially
 *     arguable — the discount was for buying all three. But it charges the
 *     customer MORE during a return, which is the single most surprising
 *     moment to raise a price, and §5.4 wants returns boring. A cashier
 *     cannot defend it at the counter without an argument.
 *   - Let the remainder keep its allocated prices. The customer keeps the
 *     discount on what they kept. The shop loses the difference on a minority
 *     of returns, and the return desk stays explainable.
 *
 * The second is implemented. What is NOT allowed is leaving the line labelled
 * `COMBO · 3` with two components in it — §17.7's whole point is that the
 * register must not lie about its own numbers. A partially-returned combo is
 * marked `broken`, and the UI is expected to drop the combo badge and show
 * the surviving components as ordinary discounted lines.
 */

import {
	allocateComboPrice,
	roundMoney,
	type ComboComponent,
} from "./comboPricing";

export interface ComboReturnRequest {
	/** Components of the original combo line, as sold. */
	components: readonly ComboComponent[];
	/** Combo price per combo, as sold. */
	comboPrice: number;
	/** How many combos were on the original line. */
	soldQty: number;
	/**
	 * Units to return, keyed by component item_code. Absent or zero means the
	 * customer is keeping that component.
	 */
	returning: Record<string, number>;
}

export interface ComboReturnLine {
	item_code: string;
	/** Units coming back. */
	qty: number;
	/** Money refunded for those units. */
	refund: number;
	/** Refund per unit, for the credit note line. */
	rate: number;
}

export interface ComboReturnPlan {
	/** Every component being returned, with its share of the money. */
	lines: ComboReturnLine[];
	/** Total going back to the customer. */
	refundTotal: number;
	/** True when the whole combo is coming back in full. */
	isWholeCombo: boolean;
	/**
	 * True when SOME but not all of the combo returns. The surviving line is
	 * no longer a combo and must stop rendering as one.
	 */
	broken: boolean;
	/** Components the customer keeps, with the money they keep paying for them. */
	remaining: ComboReturnLine[];
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/**
 * Plan the money for a combo return.
 *
 * Works from the allocation of the WHOLE original line, then refunds
 * per-unit shares of it, so a partial return of a multi-combo line
 * (2 combos sold, 1 mica back) stays consistent with a full one.
 */
export const planComboReturn = (request: ComboReturnRequest): ComboReturnPlan => {
	const components = request?.components ?? [];
	const soldQty = toNumber(request?.soldQty) || 0;
	const returning = request?.returning ?? {};

	const allocation = allocateComboPrice(components, request?.comboPrice, soldQty);
	const byItem = new Map(allocation.map((a) => [a.item_code, a]));

	const lines: ComboReturnLine[] = [];
	const remaining: ComboReturnLine[] = [];
	let everythingBack = components.length > 0;
	let anythingBack = false;

	for (const component of components) {
		const code = String(component?.item_code ?? "");
		const share = byItem.get(code);
		// Units of this component present across the whole original line.
		const soldUnits = share?.qty ?? toNumber(component?.qty) * soldQty;
		const allocated = share?.allocated ?? 0;

		// Cannot return more than was sold, and cannot return a negative.
		const askedFor = toNumber(returning[code]);
		const backUnits = Math.max(0, Math.min(askedFor, soldUnits));

		// Per-unit rate derived from the allocated share, so the refund of every
		// unit sums back to the allocation and no cent is invented.
		const perUnit = soldUnits > 0 ? allocated / soldUnits : 0;

		if (backUnits > 0) {
			anythingBack = true;
			lines.push({
				item_code: code,
				qty: roundMoney(backUnits),
				// The last unit of a component carries the rounding residual, so
				// returning every unit refunds the allocation EXACTLY rather than
				// n × a rounded per-unit rate that drifts a cent.
				refund:
					backUnits >= soldUnits
						? roundMoney(allocated)
						: roundMoney(perUnit * backUnits),
				rate: roundMoney(perUnit),
			});
		}
		if (backUnits < soldUnits) {
			everythingBack = false;
			const keptUnits = soldUnits - backUnits;
			remaining.push({
				item_code: code,
				qty: roundMoney(keptUnits),
				refund: 0,
				rate: roundMoney(perUnit),
			});
		}
	}

	const refundTotal = roundMoney(lines.reduce((sum, l) => sum + l.refund, 0));

	return {
		lines,
		refundTotal,
		isWholeCombo: everythingBack && anythingBack,
		broken: anythingBack && !everythingBack,
		remaining,
	};
};

/**
 * Convenience for the common case: the whole combo comes back.
 *
 * Refunds exactly the line total by construction, because the allocation sums
 * to it — a full return can never differ from what was charged by a cent.
 */
export const planWholeComboReturn = (
	components: readonly ComboComponent[],
	comboPrice: number,
	soldQty = 1,
): ComboReturnPlan =>
	planComboReturn({
		components,
		comboPrice,
		soldQty,
		returning: Object.fromEntries(
			(components ?? []).map((c) => [
				String(c?.item_code ?? ""),
				toNumber(c?.qty) * (toNumber(soldQty) || 0),
			]),
		),
	});
