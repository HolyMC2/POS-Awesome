/**
 * The sale, line by line, as the payment screen shows it
 * (Riel y Cajón §12 item B, `Cobro.dc.html` nodes 30–48).
 *
 * The artboard puts the whole ticket on the screen where the money is taken:
 *
 *     Combo Protección iPhone 15 Pro     3 artículos · ahorró $41    299.00
 *     Anillo Case iPhone 12 Pro Max      IPN001545 · 1 ×             200.00
 *     Adaptador Apple Lightning a Jack   IPN001880 · 2 × 120.00      240.00
 *
 * A cashier taking money should be able to see what they are taking it for
 * without going back to the cart. That is the whole claim of this module.
 *
 * ⚠ IT READS. It never prices, never rounds a total and never touches a
 * payment row. Every number here comes off the invoice line the server (or the
 * repricing pipeline) already wrote; where a line does not carry one, the
 * figure is DERIVED from that same line's own qty × rate and nothing else.
 * There is no path from this file to what the customer is charged.
 *
 * Pure: no Vue, no store, no `__()`. Labels come out as parts and the
 * component assembles them — same contract as `registerStatusLine.ts` and
 * `bandState.ts`, so the three do not drift into different habits.
 */

import { priceCombo, type ComboComponent } from "../../../composables/pos/combos/comboPricing";
import {
	COMBO_BROKEN_FIELD,
	COMBO_COMPONENTS_FIELD,
} from "../../../composables/pos/items/comboLineAttachment";

/** One cart line, as the invoice's `items` child table carries it. */
export interface SaleSummarySourceLine {
	item_code?: string | null;
	item_name?: string | null;
	qty?: number | string | null;
	rate?: number | string | null;
	amount?: number | string | null;
	/** Non-empty on a combo line — see `comboLineAttachment.ts`. */
	posa_combo_components?: readonly unknown[] | null;
	/** A combo whose components no longer resolve is an ordinary line. */
	posa_combo_broken?: number | boolean | null;
	/** POSAwesome's stable per-line key; falls back to the item code. */
	posa_row_id?: string | null;
	name?: string | null;
}

export interface SaleSummaryLine {
	/** Stable across a re-render; `v-for` keys on it. */
	key: string;
	itemCode: string;
	itemName: string;
	qty: number;
	rate: number;
	/** What this line contributes to the ticket. */
	amount: number;
	/**
	 * Whether the unit rate is worth printing under the name. One of
	 * something says nothing extra — `IPN001545 · 1 ×` is the artboard's own
	 * treatment, and the rate is already the amount.
	 */
	showsUnitRate: boolean;
	isCombo: boolean;
	/** Components in the bundle. 0 on an ordinary line. */
	componentCount: number;
	/**
	 * What the combo saved against its components at list, FOR THE WHOLE LINE
	 * (two combos save twice). 0 when the combo is priced at list, which is a
	 * legitimate configuration and renders no claim.
	 */
	saving: number;
}

export interface SaleSummary {
	lines: SaleSummaryLine[];
	/** Rows on the ticket. */
	lineCount: number;
	/** Pieces across those rows — the artboard's "9 pzas". */
	pieceCount: number;
}

const toNumber = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown): string => String(value ?? "").trim();

const truthy = (value: unknown): boolean =>
	value === 1 || value === "1" || value === true;

/**
 * Is this line a combo?
 *
 * The predicate is `ItemsTable.vue`'s, restated against the same two field
 * constants rather than re-derived — a summary that disagreed with the cart
 * about what is a combo would be worse than one that never mentioned combos.
 * A BROKEN combo is deliberately an ordinary line here too: its components no
 * longer resolve, so "3 artículos · ahorró $41" would be a claim about a
 * bundle the register can no longer describe.
 */
export const isComboSummaryLine = (line: SaleSummarySourceLine | null | undefined): boolean => {
	const components = line?.[COMBO_COMPONENTS_FIELD];
	return (
		Array.isArray(components) && components.length > 0 && !truthy(line?.[COMBO_BROKEN_FIELD])
	);
};

/**
 * The line's own money.
 *
 * `amount` is authoritative when the line carries one — it is what the
 * repricing pipeline wrote, discounts included. qty × rate is the fallback for
 * a line that has not been through it yet (an offline draft, a line added the
 * instant before PAY), and it is the same arithmetic the cart itself falls
 * back to. What this must never do is prefer its own multiplication over a
 * server-written amount: that is how a summary quietly disagrees with the
 * total the customer is being charged.
 */
const resolveAmount = (line: SaleSummarySourceLine): number => {
	const raw = line?.amount;
	if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) {
		return toNumber(raw);
	}
	return toNumber(line?.qty) * toNumber(line?.rate);
};

/**
 * What the combo saved, for the whole line.
 *
 * `priceCombo` answers per combo, against the components' list value; the line
 * may hold several. The figure is only rendered when it is positive — a combo
 * priced at or above its parts saves nothing, and "ahorró $0" is noise on the
 * densest card of the screen.
 */
const resolveSaving = (line: SaleSummarySourceLine): number => {
	const components = (line?.[COMBO_COMPONENTS_FIELD] ?? []) as readonly ComboComponent[];
	const { saving } = priceCombo(components, toNumber(line?.rate));
	if (saving <= 0) {
		return 0;
	}
	const qty = toNumber(line?.qty);
	// A fractional or absent qty cannot multiply a saving honestly; fall back
	// to one combo's worth rather than inventing a share.
	const multiplier = Number.isInteger(qty) && qty > 0 ? qty : 1;
	return saving * multiplier;
};

/**
 * Shape the cart into what the payment screen draws.
 *
 * Lines arrive in cart order and stay in it. A summary that sorted — by
 * amount, by name — would stop matching the ticket that prints, and the
 * cashier reads the two side by side.
 */
export const resolveSaleSummary = (
	items: readonly (SaleSummarySourceLine | null | undefined)[] | null | undefined,
): SaleSummary => {
	const rows = Array.isArray(items) ? items : [];
	const lines: SaleSummaryLine[] = [];
	let pieceCount = 0;

	for (const [index, row] of rows.entries()) {
		if (!row) continue;
		const itemCode = text(row.item_code);
		const itemName = text(row.item_name) || itemCode;
		// A line with neither a code nor a name is not something a cashier can
		// be shown; it is a placeholder row the cart is mid-way through
		// building. Rendering it would put a blank line and a $0 on the ticket
		// summary the moment somebody clicks Add.
		if (!itemCode && !itemName) continue;

		const qty = toNumber(row.qty);
		const isCombo = isComboSummaryLine(row);

		lines.push({
			key: text(row.posa_row_id) || text(row.name) || `${itemCode}#${index}`,
			itemCode,
			itemName,
			qty,
			rate: toNumber(row.rate),
			amount: resolveAmount(row),
			showsUnitRate: qty > 1,
			isCombo,
			componentCount: isCombo ? (row[COMBO_COMPONENTS_FIELD] as readonly unknown[]).length : 0,
			saving: isCombo ? resolveSaving(row) : 0,
		});
		pieceCount += qty;
	}

	return {
		lines,
		lineCount: lines.length,
		// Pieces are counted, not measured: 2.5 kg of anything is still one
		// thing on the ticket's piece line, and the artboard's "9 pzas" is a
		// count a cashier verifies by looking at the counter.
		pieceCount: Math.round(pieceCount * 1000) / 1000,
	};
};
