/**
 * Which notes and coins to hand back (artboard `MovilCobro.dc.html`, build
 * plan §12 G).
 *
 * The phone's payment screen does not stop at `Cambio a entregar · $71.00`. It
 * breaks that figure into `1 × $50 · 1 × $20 · 1 × $1`, which is the part that
 * earns its pixels: at a counter, with a queue, the cashier's actual next
 * action is choosing notes out of a drawer, and a register that has already
 * chosen them removes both the arithmetic and the second-guessing.
 *
 * ⚠ IT DOES NOT DECIDE HOW MUCH. The amount of change is settled by the
 * payment path — `usePaymentCalculations.change_due`, recorded as
 * `paid_change` — exactly as it was before this screen existed. This module is
 * handed a figure and answers ONE question about it: which faces add up to it.
 * Nothing here captures, splits, rounds or authorises a peso.
 *
 * **Reuses `closing/denominations.ts` rather than restating it.** That module
 * was built for the corte's drawer count and already holds what a drawer can
 * contain, per currency, in MINOR UNITS with integer arithmetic — because
 * "currency in a float is a bug waiting for a peso". Making change is the same
 * problem read backwards: the corte multiplies faces by counts to reach a
 * total, this divides a total into faces. One table, two directions. A second
 * denomination list would be the bug: the day somebody adds the $200 note to
 * one of them, the corte and the change drawer would disagree about what the
 * shop holds.
 *
 * **Greedy, largest face first**, which is how a cashier's hand moves and
 * which is optimal for MXN and USD (both canonical systems — every face
 * divides into the ones above it). It is not provably minimal for an arbitrary
 * face list, and that is an accepted limit rather than an oversight: the two
 * properties that matter for money hold for ANY list. It never emits a face
 * the currency's list does not contain, and it never overshoots the amount
 * owed. A theoretically shorter stack of the same value is a nicety; handing
 * back a note the drawer has never held is a defect.
 *
 * Pure: no Vue, no store, no `__()`.
 */

import {
	denominationsFor,
	majorToMinor,
	minorToMajor,
	type CurrencyDenominations,
	type DenominationCount,
} from "../../closing/denominations";

/**
 * One stack to hand back. `DenominationCount` is reused rather than aliased:
 * the corte counts `{ minor, count }` rows out of the drawer and this counts
 * `{ minor, count }` rows back into a customer's hand.
 */
export type ChangeNote = DenominationCount;

export interface ChangeBreakdown {
	/** What is owed, in minor units. Clamped at zero — see `resolveChangeBreakdown`. */
	minor: number;
	/** Major units, for the figure the screen renders. */
	major: number;
	/** Stacks to hand back, largest face first. A zero count is never emitted. */
	notes: ChangeNote[];
	/**
	 * What the drawer's faces cannot make, in minor units — 0 in every ordinary
	 * sale, and non-zero exactly when the change lands below the smallest coin
	 * the list carries (MXN stops at $1, so 50¢ of change reaches here).
	 *
	 * Surfaced rather than swallowed. Rounding it away inside this module would
	 * be this screen quietly deciding what the customer is owed, which is the
	 * one thing it must not do; dropping it silently would show a breakdown
	 * that does not add up to the figure above it. The screen states it and
	 * the cashier settles it the way the shop settles it.
	 */
	unbreakableMinor: number;
	/** The currency's own list, so a caller can label faces without re-deriving it. */
	denominations: CurrencyDenominations;
}

/**
 * THE derivation. Greedy over the currency's faces, entirely in integers.
 *
 * `changeMajor` arrives in major units because that is what every money value
 * in this app is; it is converted ONCE here, by `majorToMinor`, and nothing
 * downstream sees a float. `tests/movilCobroChange.spec.ts` mutates this
 * function to do the same arithmetic in floats and asserts that it breaks —
 * the integer path is not a style preference, it is what keeps $71.00 from
 * arriving as $70.99 with a phantom centavo.
 *
 * A negative or unreadable amount yields no change and no notes rather than
 * throwing: this runs on every keystroke of the pad, and a screen that blanks
 * mid-sale because the cashier over-typed a digit is worse than one that says
 * nothing is owed yet.
 */
export const resolveChangeBreakdown = (
	changeMajor: unknown,
	currency: string | null | undefined,
): ChangeBreakdown => {
	const denominations = denominationsFor(currency);
	const parsed = Number(changeMajor);
	const owed = Number.isFinite(parsed) && parsed > 0 ? majorToMinor(parsed, denominations.minorPerMajor) : 0;

	// Sorted defensively rather than trusted. `denominationsFor` documents its
	// faces as largest-first and today they are, but greedy is only correct on
	// a descending list, and a table edited into ascending order would hand out
	// eighty-two 1-peso coins without anything going red.
	const faces = [...denominations.faces].filter((face) => Number.isFinite(face) && face > 0).sort((a, b) => b - a);

	const notes: ChangeNote[] = [];
	let remaining = owed;

	for (const face of faces) {
		if (remaining < face) continue;
		const count = Math.floor(remaining / face);
		remaining -= count * face;
		notes.push({ minor: face, count });
	}

	return {
		minor: owed,
		major: minorToMajor(owed, denominations.minorPerMajor),
		notes,
		unbreakableMinor: remaining,
		denominations,
	};
};

/** A face value in major units, for the `1 × $50` chip. */
export const noteFaceMajor = (note: ChangeNote, denominations: CurrencyDenominations): number =>
	minorToMajor(note.minor, denominations.minorPerMajor);

/**
 * How many pieces of currency change over. Not rendered anywhere yet; exported
 * because the mutation harness needs a way to assert that a breakdown which
 * "adds up" is not automatically a breakdown that could be handed over — a
 * single 71-peso note would satisfy the sum and does not exist.
 */
export const totalPieces = (breakdown: ChangeBreakdown): number =>
	breakdown.notes.reduce((pieces, note) => pieces + note.count, 0);

/**
 * Does the breakdown actually come to the figure above it?
 *
 * Exported so the screen and its tests agree on what "adds up" means without
 * either restating the arithmetic — the same reason `hardwareReadiness`
 * exports `claimsReady`.
 */
export const breakdownAddsUp = (breakdown: ChangeBreakdown): boolean =>
	breakdown.notes.reduce((sum, note) => sum + note.minor * note.count, 0) + breakdown.unbreakableMinor ===
	breakdown.minor;

export default resolveChangeBreakdown;
