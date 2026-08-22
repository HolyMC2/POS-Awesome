/**
 * What a drawer can hold, and the arithmetic of counting it (canvas artboard
 * `design/register-hifi/Corte.dc.html`, build plan §12 C).
 *
 * The corte asked for one number and trusted it. The artboard counts by
 * denomination instead, and the difference is not cosmetic: a typed total is an
 * ASSERTION, a denomination count is a DERIVATION. Only the second one can be
 * checked — by the cashier re-counting one row, and by the supervisor reading
 * how the figure was reached.
 *
 * Two decisions are load-bearing here.
 *
 * **Minor units, always.** Every face value below is an integer number of
 * centavos/cents, and the total is an integer sum. `0.1 + 0.2` is famously not
 * `0.3`; less famously, summing ten peso amounts in float leaves a drawer
 * short by a hundredth that then reads as an unexplained difference on the
 * band. Currency in a float is a bug waiting for a peso, so the conversion to
 * major units happens once, at the very end, in `minorToMajor`.
 *
 * **Keyed by currency, not hard-coded.** A drawer in Chetumal holds the ten
 * MXN faces the artboard draws; one in a border shop also holds dollars. The
 * list is data so a currency can differ without a template changing, and the
 * manual override in `DrawerCount.vue` is the escape hatch for the case this
 * table gets wrong — a face it does not list, or a currency it has never seen.
 *
 * NOT derived from `utils/smartTender.ts`'s `defaultDenominations`, though that
 * map is also per-currency: it holds BILLS, because its job is suggesting what
 * a customer hands over. A drawer count needs the coins too — the artboard's
 * bottom four rows ($10, $5, $2, $1) are all coins in Mexico. It is used as the
 * fallback precisely because a bills-only list is a poor count list but a much
 * better one than nothing.
 */

import { defaultDenominations } from "../../../../utils/smartTender";

export interface CurrencyDenominations {
	/** Minor units in one major unit — 100 centavos to a peso, 1 yen to a yen. */
	minorPerMajor: number;
	/**
	 * Face values in MINOR units, largest first. Render order IS this order:
	 * a cashier counts the big notes first and the artboard draws them that way.
	 */
	faces: readonly number[];
}

/** One row of the count: a face value and how many of it are in the drawer. */
export interface DenominationCount {
	/** Face value in minor units. */
	minor: number;
	/** How many. Non-integer and negative inputs are rejected, not rounded. */
	count: number;
}

/**
 * Currencies whose ISO 4217 minor unit is the major unit. An unlisted currency
 * is assumed to have 100 minor units, which is true of the overwhelming
 * majority and wrong in a way the override covers.
 */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "VND", "ISK", "PYG"]);

/**
 * Count lists we have a source for.
 *
 * MXN is the artboard's own ten rows, in its own order — $1,000 down to $1. It
 * stops at $1 rather than descending to the 50¢ and 10¢ coins for the reason
 * the artboard header states plainly ("10 denominaciones"): nobody counts
 * centavos at close, and eight more rows would push the count card past the
 * fold to reconcile a peso.
 *
 * USD is here because border shops take dollars, and a count list that omits
 * quarters is not a count list.
 */
const DRAWER_DENOMINATIONS: Record<string, CurrencyDenominations> = {
	MXN: {
		minorPerMajor: 100,
		faces: [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100],
	},
	USD: {
		minorPerMajor: 100,
		faces: [10_000, 5_000, 2_000, 1_000, 500, 100, 25, 10, 5, 1],
	},
};

/** Last resort: smartTender's own generic ladder, in major units. */
const GENERIC_FACES = [1000, 500, 100, 50, 20, 10, 5, 1];

/**
 * The count list for a currency.
 *
 * Never throws and never returns an empty list — a corte that renders no rows
 * is a corte that cannot be counted at all, and the register still has to
 * close. An unknown currency falls back to bills and then to a generic ladder,
 * and the manual override remains available either way.
 */
export function denominationsFor(currency: string | null | undefined): CurrencyDenominations {
	const code = String(currency || "").trim().toUpperCase();

	const known = DRAWER_DENOMINATIONS[code];
	if (known) return known;

	const minorPerMajor = ZERO_DECIMAL.has(code) ? 1 : 100;
	const bills = defaultDenominations[code];
	const major = bills && bills.length ? [...bills] : [...GENERIC_FACES];

	return {
		minorPerMajor,
		// Descending, because the render order is the counting order and
		// `defaultDenominations` is written ascending for the tender path.
		faces: major
			.map((face) => Math.round(face * minorPerMajor))
			.filter((face) => face > 0)
			.sort((a, b) => b - a),
	};
}

/** How many of a face value are usable. Fractions of a banknote do not exist. */
const usableCount = (count: unknown): number => {
	const parsed = Number(count);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.trunc(parsed);
};

/** One row's contribution, in minor units. Integer in, integer out. */
export function rowMinorSubtotal(minor: number, count: unknown): number {
	const face = Number(minor);
	if (!Number.isFinite(face) || face <= 0) return 0;
	return Math.trunc(face) * usableCount(count);
}

/**
 * THE derivation: what the drawer holds, in minor units.
 *
 * Every row contributes. That sounds too obvious to state, until a row is
 * skipped by a stale key or a filter and the count silently comes up short —
 * which is why `tests/corteDenominations.spec.ts` mutates this function to drop
 * one row and asserts the failure by name.
 */
export function countedMinorTotal(rows: readonly DenominationCount[]): number {
	let total = 0;
	for (const row of rows) {
		total += rowMinorSubtotal(row.minor, row.count);
	}
	return total;
}

/**
 * Minor units to major, once, at the end. Rounded rather than divided raw:
 * `536_600 / 100` is exact, but a zero-decimal currency divides by 1 and a
 * hand-edited table could carry a non-integer, and a total that arrives at the
 * band with a trailing 0.0000000001 renders as the wrong money.
 */
export function minorToMajor(minor: number, minorPerMajor: number): number {
	const divisor = Number(minorPerMajor) || 1;
	if (divisor === 1) return Math.trunc(minor);
	return Math.round((minor / divisor) * 100) / 100;
}

/** Major units to minor, for the manual override's typed amount. */
export function majorToMinor(major: unknown, minorPerMajor: number): number {
	const parsed = Number(major);
	if (!Number.isFinite(parsed)) return 0;
	const divisor = Number(minorPerMajor) || 1;
	return Math.round(parsed * divisor);
}

export default denominationsFor;
