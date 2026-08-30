/**
 * Client-side mirror of the server's rate band (critique C3).
 *
 * The band itself is enforced in `_reprice.py` — this module only PREVIEWS
 * it, so the cashier reads «$80–$120» while typing instead of meeting the
 * same numbers as a submit-time refusal. The semantics mirror
 * `_resolve_band_pct` exactly, because a preview that disagrees with the
 * enforcer is worse than none:
 *
 *   - blank/0 band → the 20% default (the column is NOT NULL DEFAULT 0,
 *     so 0 means "not configured", never "no deviation allowed");
 *   - negative band → the per-register kill switch, no band at all;
 *   - skip-band SKUs (item or group, merged server-side onto the row) →
 *     no band for that line;
 *   - the same 0.01 currency tolerance on both edges.
 *
 * Always a WARNING, never a block: the server is the enforcer, and the
 * client's knowledge (a cached flag, a stale price) is advisory.
 */

const DEFAULT_BAND_PCT = 20;
const EDGE_TOLERANCE = 0.01;

export interface RateBandWindow {
	low: number;
	high: number;
	bandPct: number;
	priceListRate: number;
}

const num = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/** The allowed window for a line, or null when no band applies. */
export function rateBandWindow(
	priceListRate: unknown,
	bandPct: unknown,
	skipBand = false,
): RateBandWindow | null {
	if (skipBand) return null;
	const master = num(priceListRate);
	if (master <= 0) return null;
	const raw = bandPct === null || bandPct === undefined || bandPct === "" ? 0 : num(bandPct);
	if (raw < 0) return null;
	const band = raw || DEFAULT_BAND_PCT;
	return {
		low: master * (1 - band / 100),
		high: master * (1 + band / 100),
		bandPct: band,
		priceListRate: master,
	};
}

/** The window, but only when `rate` falls outside it — null means quiet. */
export function rateOutsideBand(
	rate: unknown,
	priceListRate: unknown,
	bandPct: unknown,
	skipBand = false,
): RateBandWindow | null {
	const window = rateBandWindow(priceListRate, bandPct, skipBand);
	if (!window) return null;
	const typed = num(rate);
	if (typed <= 0) return null; // comp/zero lines are the operator's call
	if (typed < window.low - EDGE_TOLERANCE || typed > window.high + EDGE_TOLERANCE) {
		return window;
	}
	return null;
}
