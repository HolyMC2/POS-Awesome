/**
 * Discount decision logic (roadmap §17.2), kept out of the .vue on purpose.
 *
 * A discount is money leaving the till, so the rules that decide whether one
 * is allowed — and what total it leaves behind — are pure, exported and unit
 * tested rather than tangled in a dialog's render tree.
 */

export type DiscountMode = "percentage" | "amount";

export interface DiscountIntent {
	/** Safe to apply. */
	ok: boolean;
	/** Operator-facing reason it is refused; empty when ok. */
	warning: string;
	/** Currency taken off the sale. */
	discountAmount: number;
	/** What the customer would pay, never below zero. */
	newTotal: number;
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/**
 * Evaluate a proposed discount.
 *
 * `translate` lets the caller pass Frappe's `__` so the reasons are the
 * operator's language; it defaults to identity so this module stays testable
 * with no globals.
 */
export const evaluateDiscount = (
	mode: DiscountMode,
	value: unknown,
	baseTotal: unknown,
	translate: (_text: string) => string = (text) => text,
): DiscountIntent => {
	const amountEntered = toNumber(value);
	const base = toNumber(baseTotal);
	const discountAmount =
		mode === "percentage" ? (base * amountEntered) / 100 : amountEntered;

	let warning = "";
	if (amountEntered < 0) {
		warning = translate("A discount cannot be negative.");
	} else if (mode === "percentage" && amountEntered > 100) {
		warning = translate("A discount cannot exceed 100%.");
	} else if (mode === "amount" && discountAmount > base) {
		// Giving away more than the sale is worth is never intended, and a
		// negative total is a refund the till has no record of.
		warning = translate("The discount is larger than the sale total.");
	}

	return {
		ok: !warning,
		warning,
		discountAmount,
		newTotal: Math.max(0, base - discountAmount),
	};
};

/** The seed value a reopened dialog should show for the applied discount. */
export const seedDraft = (
	mode: DiscountMode,
	appliedPercentage: unknown,
	appliedAmount: unknown,
): number | "" => {
	const value = toNumber(mode === "percentage" ? appliedPercentage : appliedAmount);
	// "" rather than 0 so an untouched dialog shows an empty box, but a real
	// applied discount shows itself — an empty box over a live discount reads
	// as "no discount" and invites double-discounting.
	return value === 0 ? "" : value;
};
