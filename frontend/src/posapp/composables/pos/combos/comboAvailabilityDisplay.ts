/**
 * Turning an availability ANSWER into what a cart row actually shows.
 *
 * `comboAvailability.ts` (W25-D) decides the number. This module decides
 * whether the number may be drawn at all, and it exists as a separate pure
 * unit because there are three distinct ways to render something false here
 * and all three end in the same visible outcome — no figure — for different
 * reasons:
 *
 *   1. UNBOUNDED. An all-labour combo is capped by the shop's time, not its
 *      shelves, and `available` is `POSITIVE_INFINITY`. W25-D chose Infinity
 *      over a 999999 sentinel precisely so an unchecked surface renders a
 *      visibly wrong "Infinity" and gets fixed. This is the check that keeps
 *      us from being that surface.
 *   2. UNKNOWN. `null` — an offline line, or a draft resumed from before the
 *      field existed. Rendering 0 here reads as "out of stock" on a combo the
 *      shop may have plenty of, which is the lie in the dangerous direction.
 *   3. NOT A NUMBER. Defensive: a hand-edited draft or a bad payload. Reads
 *      as unknown rather than unbounded, because ignorance is what it is.
 *
 * A real 0 is NOT one of these. Zero is a genuine answer — the shelves cannot
 * cover one combo — and it renders, in the low tint, because that is exactly
 * when the cashier needs to see it.
 */

import {
	isUnboundedAvailability,
	type ComboAvailability,
	type ComboAvailabilityContext,
	comboAvailabilityOrUnknown,
} from "./comboAvailability";
import type { ComboComponent } from "./comboPricing";

export interface ComboAvailabilityDisplay {
	/** False means: draw no figure at all. Never draw `value` when false. */
	show: boolean;
	/** Finite, non-negative integer when `show`; null otherwise. */
	value: number | null;
	/** Component that set the ceiling, for the operator-facing explanation. */
	limitedBy: string | null;
	/** At or under the register's own low-stock threshold. */
	isLow: boolean;
	/** Why the figure is or is not drawn — asserted on directly by tests. */
	reason: "bounded" | "unbounded" | "unknown";
}

const HIDDEN = (reason: "unbounded" | "unknown"): ComboAvailabilityDisplay => ({
	show: false,
	value: null,
	limitedBy: null,
	isLow: false,
	reason,
});

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/**
 * Decide what to draw.
 *
 * `lowStockThreshold` is the register's existing
 * `posa_low_stock_alert_threshold` (Int, default 10) — the same setting the
 * dashboard already alerts on. Riding it rather than inventing a combo number
 * means a shop that has already tuned "tight" for its turnover gets that
 * answer here too. A threshold of 0 or absent disables the tint rather than
 * making everything low, since 0 means "never warn", not "always warn".
 */
export const describeAvailability = (
	availability: ComboAvailability | null | undefined,
	options: { lowStockThreshold?: unknown } = {},
): ComboAvailabilityDisplay => {
	if (!availability) return HIDDEN("unknown");

	const { available, limitedBy } = availability;

	// Order matters: NaN is not finite, so it would fall into the unbounded
	// branch and be reported as "no shelf limit" — the optimistic reading of a
	// broken value. Ask the narrower question first.
	if (typeof available !== "number" || Number.isNaN(available)) return HIDDEN("unknown");
	if (isUnboundedAvailability(availability)) return HIDDEN("unbounded");

	const threshold = Math.max(0, Math.floor(toNumber(options.lowStockThreshold)));
	const value = Math.max(0, Math.floor(available));

	return {
		show: true,
		value,
		limitedBy: limitedBy ?? null,
		isLow: threshold > 0 && value <= threshold,
		reason: "bounded",
	};
};

/**
 * The availability a cart line should display.
 *
 * Prefers the line's own `_combo_available` / `_combo_limited_by`, which
 * `comboLineAttachment.ts` computed when the line was added. Those are
 * client-only display fields — underscore-prefixed, absent from
 * `custom_field.json`, and never persisted, because a figure computed against
 * one warehouse at one instant has no business on a document. This module
 * READS them and adds nothing to any payload.
 *
 * Falls back to asking the choke point when the line predates the field — a
 * draft saved before combos shipped has components but no `_combo_available`,
 * and recomputing is better than showing a resumed sale nothing at all.
 *
 * The distinction that matters: `_combo_available === null` means the resolver
 * ran and could not answer, so it is honoured as UNKNOWN. Only `undefined`
 * means "nobody has asked yet".
 */
export const availabilityForLine = (
	line: { _combo_available?: number | null; _combo_limited_by?: string | null } | null | undefined,
	components: readonly ComboComponent[],
	context: ComboAvailabilityContext = {},
): ComboAvailability | null => {
	if (line && line._combo_available !== undefined) {
		return line._combo_available === null
			? null
			: { available: line._combo_available, limitedBy: line._combo_limited_by ?? null };
	}
	return comboAvailabilityOrUnknown(components, context);
};
