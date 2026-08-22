/**
 * Combo (bundle) arithmetic — roadmap §17.6, promoted into Scan Retail and
 * Repair+Retail because both sell case+mica+instalación every day.
 *
 * Pure and separately tested for the same reason `itemPricing.ts` is: this is
 * MONEY a shopkeeper quotes out loud. "El combo te sale en 299, te ahorras 41"
 * has to mean the same thing every time, and the saving is a promise printed
 * on the ticket.
 *
 * WHAT THIS MODULE DOES NOT OWN — read before extending it:
 *
 * A combo is an ERPNext **Product Bundle**, not a posawesome invention. The
 * substrate already carries the component lines (`Product Bundle Item`) and,
 * crucially, already decrements stock per component: `packed_item.py` builds a
 * packing list for any sold item that is the `new_item_code` of a non-disabled
 * Product Bundle. Re-implementing that decrement here would duplicate the one
 * part of combos that ERPNext gets right for free, and getting it wrong means
 * negative stock — which §11 treats as a zero-tolerance incident, not a bug.
 *
 * So this module computes only what the POS needs and the substrate does not
 * provide: the LIST price the components would have cost separately, the
 * SAVING that difference represents, and the deterministic allocation of the
 * combo price back across components (which returns need — see
 * `comboReturns.ts`).
 */

/** Money rounded the way a price tag is: 2 decimals, half away from zero. */
export const roundMoney = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.round((value + Number.EPSILON) * 100) / 100;
};

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/** One component line of a bundle, as the POS read model returns it. */
export interface ComboComponent {
	item_code: string;
	item_name?: string;
	/** Units of this component per ONE combo. */
	qty: number;
	/** What this component sells for on its own, in the active price list. */
	rate: number;
	uom?: string | null;
	/** Free stock for this component in the register's warehouse. */
	actual_qty?: number;
}

export interface ComboPricing {
	/** Σ(qty × rate) — what the parts cost bought separately. */
	listPrice: number;
	/** What the combo actually sells for. */
	comboPrice: number;
	/** listPrice − comboPrice, never negative. */
	saving: number;
	/** Saving as a percentage of list; 0 when list is 0. */
	savingPercent: number;
	/** True when the combo is genuinely cheaper than its parts. */
	isDiscounted: boolean;
}

/**
 * Price a combo against its components.
 *
 * A combo priced at or ABOVE its parts is not an error — a shop may bundle for
 * convenience rather than discount, and an installation component can make the
 * total legitimately higher. It is reported as `saving: 0` /
 * `isDiscounted: false` so the UI simply omits the "ahorra" chip rather than
 * printing a negative saving, which reads as a surcharge nobody agreed to.
 */
export const priceCombo = (
	components: readonly ComboComponent[],
	comboPrice: unknown,
): ComboPricing => {
	const listPrice = roundMoney(
		(components ?? []).reduce(
			(sum, c) => sum + toNumber(c?.qty) * toNumber(c?.rate),
			0,
		),
	);
	const price = roundMoney(toNumber(comboPrice));
	const saving = roundMoney(Math.max(0, listPrice - price));

	return {
		listPrice,
		comboPrice: price,
		saving,
		savingPercent: listPrice > 0 ? roundMoney((saving / listPrice) * 100) : 0,
		isDiscounted: saving > 0,
	};
};

/** One component's share of what the customer actually paid. */
export interface ComboAllocation {
	item_code: string;
	/** Units of this component in the whole line (qty per combo × combos). */
	qty: number;
	/** This component's share of the combo price, for the WHOLE line. */
	allocated: number;
	/** What it would have cost at list, for the whole line. */
	listAmount: number;
}

/**
 * Split the combo price across its components, proportionally to list value.
 *
 * Returns need this: refunding one component of a combo at its LIST price
 * hands back money the customer never paid, and that gap is arbitrageable —
 * buy the combo, return the cheapest part at list, keep the difference. See
 * `comboReturns.ts` for the decision that rests on this function.
 *
 * The allocation uses LARGEST REMAINDER so the parts always sum to exactly the
 * line total. Naive per-component rounding does not: 299 split over 200/80/60
 * gives 175.88 + 70.35 + 52.76 = 298.99, and that missing cent would surface
 * later as a one-cent rounding difference on a return — the kind of thing that
 * makes a cashier distrust the whole ticket. Assigning the residual by largest
 * fractional remainder is deterministic: the same combo always allocates the
 * same way, regardless of which component is being returned.
 *
 * When components carry no list value at all (every rate 0), the price is
 * spread by QTY instead, because proportional-to-zero has no answer and
 * dropping the money silently would be worse.
 */
export const allocateComboPrice = (
	components: readonly ComboComponent[],
	comboPrice: unknown,
	comboQty: unknown = 1,
): ComboAllocation[] => {
	const rows = components ?? [];
	if (!rows.length) return [];

	const combos = toNumber(comboQty) || 0;
	const lineTotal = roundMoney(toNumber(comboPrice) * combos);

	const weights = rows.map((c) => toNumber(c?.qty) * toNumber(c?.rate));
	const weightTotal = weights.reduce((a, b) => a + b, 0);
	const fallback = rows.map((c) => toNumber(c?.qty));
	const fallbackTotal = fallback.reduce((a, b) => a + b, 0);

	const useQty = weightTotal <= 0;
	const basis = useQty ? fallback : weights;
	const basisTotal = useQty ? fallbackTotal : weightTotal;

	// Nothing to apportion against: hand the whole amount to the first line
	// rather than vanish it. A visible oddity beats a silent shortfall.
	if (basisTotal <= 0) {
		return rows.map((c, i) => ({
			item_code: String(c?.item_code ?? ""),
			qty: roundMoney(toNumber(c?.qty) * combos),
			allocated: i === 0 ? lineTotal : 0,
			listAmount: roundMoney(toNumber(c?.qty) * toNumber(c?.rate) * combos),
		}));
	}

	// Work in integer cents so the residual is exact.
	const totalCents = Math.round(lineTotal * 100);
	const exact = basis.map((b) => (totalCents * b) / basisTotal);
	const floors = exact.map((v) => Math.floor(v));
	let residual = totalCents - floors.reduce((a, b) => a + b, 0);

	const order = exact
		.map((v, i) => ({ i, frac: v - Math.floor(v) }))
		.sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

	const cents = floors.slice();
	for (const { i } of order) {
		if (residual <= 0) break;
		cents[i] = (cents[i] ?? 0) + 1;
		residual -= 1;
	}

	return rows.map((c, i) => ({
		item_code: String(c?.item_code ?? ""),
		qty: roundMoney(toNumber(c?.qty) * combos),
		allocated: roundMoney((cents[i] ?? 0) / 100),
		listAmount: roundMoney(toNumber(c?.qty) * toNumber(c?.rate) * combos),
	}));
};

/**
 * Units of each component that leave stock when `comboQty` combos are sold.
 *
 * PROJECTION ONLY — the actual decrement is ERPNext's packing list, and this
 * must never be used to post stock. It exists so the operator can be told
 * "descuenta 9 piezas al cobrar" before committing, which is what the artboard
 * shows above the totals.
 */
export const projectComponentDecrement = (
	components: readonly ComboComponent[],
	comboQty: unknown = 1,
): Array<{ item_code: string; qty: number }> => {
	const combos = toNumber(comboQty) || 0;
	return (components ?? []).map((c) => ({
		item_code: String(c?.item_code ?? ""),
		qty: roundMoney(toNumber(c?.qty) * combos),
	}));
};

/** Total pieces a combo line removes from the shelf — the artboard's count. */
export const totalPiecesForCombo = (
	components: readonly ComboComponent[],
	comboQty: unknown = 1,
): number =>
	projectComponentDecrement(components, comboQty).reduce((sum, c) => sum + c.qty, 0);

/**
 * The one-line component summary under a combo's name, as the artboard writes
 * it: "Case negro + Mica Cristal + Instalación · lista $340.00".
 *
 * Names only, no quantities, unless a component takes more than one unit —
 * the shopkeeper reading this at speed needs the SHAPE of the combo, and "2 ×"
 * only earns its space when it is true.
 */
export const describeComponents = (components: readonly ComboComponent[]): string =>
	(components ?? [])
		.map((c) => {
			const name = String(c?.item_name || c?.item_code || "").trim();
			const qty = toNumber(c?.qty);
			return qty > 1 ? `${qty} × ${name}` : name;
		})
		.filter(Boolean)
		.join(" + ");
