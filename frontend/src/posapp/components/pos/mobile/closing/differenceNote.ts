/**
 * Two business rules the corte did not have, both drawn on `MovilCorte.dc.html`
 * and neither of them a widget: **when a cash difference must be explained in
 * writing**, and **what that difference is as a share of the day's takings**.
 *
 * Pure on purpose — no Vue, no store, no formatter — for the same reason
 * `bandState.ts` is: a control with money behind it has to be testable without
 * mounting anything, and mutation-testable at all.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE NOTE IS MANDATORY, and why it is not "always"
 * ---------------------------------------------------------------------------
 *
 * The artboard labels the field `Nota del faltante · obligatoria`. The question
 * it does not answer is *obligatoria from which peso*, and the answer decides
 * whether this is a control or a ritual.
 *
 * **Not every non-zero difference.** A drawer in this app cannot come out exact
 * very often, and two of the reasons are ours: `denominations.ts` stops its
 * count list at $1 on purpose, so every centavo physically in the tray is
 * outside the instrument; and the register rounds cash tenders per ticket, so
 * 31 tickets can land a few pesos from `expected` with nothing whatsoever
 * having gone wrong. Demanding a written explanation for that produces
 * explanations of it — "cambio", ".", "x" — every night, and a field that is
 * full of noise on the ordinary nights is a field nobody reads on the night it
 * matters. The control would be destroyed by its own frequency.
 *
 * **Not a fixed peso amount either.** A flat "over $50 needs a note" is 25 % of
 * a $200 taquería shift and 0.45 % of an $11,000 one. One threshold cannot be
 * right for both, and this app runs both.
 *
 * **So: the larger of an absolute floor and a proportional band.**
 *
 *     tolerance = max(floorMajor, rateOfTakings × takings)
 *     required  = |difference| > tolerance
 *
 * The proportional half is the same quantity the artboard already prints beside
 * the difference (`0.23 % de ventas`), which is the point — the rule and the
 * number on screen are one idea, so a cashier who is asked for a note can see
 * in the same card why. The floor is what stops a slow morning from demanding
 * prose over twenty centavos.
 *
 * Defaults, and where they come from:
 *
 *   - `floorMajor: 20` — the smallest banknote in Mexico. Below one note, a
 *     drawer difference is coins: rounding, a tip left in the tray, the
 *     centavos the count list cannot resolve. At one note or more, something
 *     happened that a person can point at. This is a POLICY number, not a
 *     derivation, and it is an input precisely so a tenant can move it; see the
 *     report for the POS Profile field it should read from.
 *   - `rateOfTakings: 0.001` (0.1 %) — deliberately under the artboard's own
 *     0.23 %, so the artboard's shift (−$25 on $10,670 takings) requires a note,
 *     which is exactly what the artboard draws. With these defaults the floor
 *     governs until takings pass $20,000 and the proportional band takes over
 *     above that, which is the busy-register case it exists for.
 *
 * **A surplus counts.** `|difference|`, not `difference`. `bandState.ts`
 * already tints an over-count amber for the stated reason that cash which
 * appeared is as unexplained as cash that vanished, and a gate that only
 * challenged shortfalls would teach the drawer's cleanest hiding place.
 *
 * **The gate never traps anyone.** It asks for an explanation, not a correct
 * one: "no sé qué pasó" satisfies it. What it makes impossible is closing a
 * shift with a material difference and *no named human having written anything
 * at all* against it. That is the whole control, and it is why there is no
 * override — an escape hatch here would be used every night by the same
 * pressure that produces "." in the box.
 *
 * ---------------------------------------------------------------------------
 * THE PERCENTAGE, and which denominator
 * ---------------------------------------------------------------------------
 *
 * `Corte.dc.html` prints `Sobre ventas · 0.23 %` beside `Total del turno
 * $10,670.00`, and 25 / 10,670 = 0.2343 %. So the denominator is the shift's
 * takings across EVERY payment mode — not cash takings, and not expected cash.
 *
 * That is arguable and worth stating, because the cash lane is the only lane a
 * drawer difference can come out of: against cash takings the same $25 reads
 * 0.49 %, twice as loud. The artboard chose total takings and the artboards are
 * the reference of record (§8 R2), but the reason it is also the better choice
 * is that the figure answers *"how big a deal is this for today?"* — the scale
 * of the day is the day, not the cash half of it. The per-mode variance the
 * other reading wants already exists: `PaymentReconciliation.vue` prints
 * `difference / expected_amount` per row. Two questions, two numbers, and they
 * must not be made to look like one.
 *
 * On a dead day the ratio does not exist. It is `null`, not `0 %` and not
 * `Infinity`: a $25 difference on $0 of sales is not "0 % of sales", and the
 * card renders nothing there rather than a number that means the opposite of
 * what it says.
 */

/** Minor-unit conversion, shared with the count so both round the same way. */
import { majorToMinor } from "../../closing/denominations";

export interface NotePolicy {
	/** Absolute floor, in MAJOR units. Below this, a difference is coins. */
	floorMajor: number;
	/** Proportional band as a fraction of takings — 0.001 is 0.1 %. */
	rateOfTakings: number;
	/** Characters a note must carry after trimming. Kills ".", "x", "asdf". */
	minLength: number;
	/** Distinct non-whitespace characters. Kills "aaaaaaaaaaaa". */
	minDistinct: number;
}

export const DEFAULT_NOTE_POLICY: NotePolicy = {
	floorMajor: 20,
	rateOfTakings: 0.001,
	minLength: 12,
	minDistinct: 4,
};

/**
 * The difference against the day's takings.
 *
 * `ratio` is signed because the quantity is; `percent` is the magnitude at two
 * decimals, because that is what the artboard prints and the direction is
 * already carried by the label beside it ("faltante" / "sobrante"). Printing
 * "−0.23 %" under a caption that already says *faltante* says it twice.
 */
export interface DifferenceRatio {
	/** Signed fraction — −0.002343 for the artboard's shift. */
	ratio: number;
	/** Unsigned percentage, two decimals — 0.23. */
	percent: number;
}

/**
 * Ratio in MINOR units on both sides, so the division is over two integers and
 * a takings figure that arrived as 10670.000000000002 cannot move the second
 * decimal of the percentage.
 *
 * `null` when there is nothing to divide by. Guarding `<= 0` rather than
 * `=== 0` also covers a takings figure that came back negative from a
 * refunds-only shift, where "the difference is −X % of sales" would be
 * arithmetic no one can read.
 */
export function differenceRatio(
	difference: unknown,
	takings: unknown,
	minorPerMajor = 100,
): DifferenceRatio | null {
	const takingsMinor = majorToMinor(takings, minorPerMajor);
	if (!(takingsMinor > 0)) return null;

	const differenceMinor = majorToMinor(difference, minorPerMajor);
	const ratio = differenceMinor / takingsMinor;
	return { ratio, percent: Math.round(Math.abs(ratio) * 10000) / 100 };
}

/** Why the close is or is not held. One value, so the UI cannot invent a fifth. */
export type NoteVerdict =
	/** The difference is inside tolerance; a note is welcome, never demanded. */
	| "notRequired"
	/** Over tolerance and the box is empty. */
	| "missing"
	/** Over tolerance and what was typed is not an explanation. */
	| "tooShort"
	/** Over tolerance and explained. */
	| "satisfied";

export interface NoteGate {
	/** The difference this verdict was reached on, echoed for the caller. */
	difference: number;
	/** What a difference has to exceed before it must be explained. */
	tolerance: number;
	/** Its share of the day, or `null` on a shift with no takings. */
	ratio: DifferenceRatio | null;
	required: boolean;
	/** Whether the note as typed actually explains anything. */
	satisfied: boolean;
	/** THE answer: may this shift close? */
	canClose: boolean;
	verdict: NoteVerdict;
}

export interface NoteGateInput {
	/**
	 * Signed, counted minus expected — and it must come FROM the band
	 * (`resolveBandState({ kind: "closing", … }).value`), never from arithmetic
	 * done here. A second opinion about the difference is the one thing this
	 * screen must not have.
	 */
	difference: unknown;
	/** The shift's takings across every payment mode, in major units. */
	takings: unknown;
	/** What the cashier wrote. */
	note?: string | null;
	minorPerMajor?: number;
	policy?: Partial<NotePolicy>;
}

/** Trimmed, with the whitespace inside it collapsed so "a          b" is 3. */
const substanceOf = (note: string | null | undefined) => {
	const text = String(note ?? "").trim();
	const distinct = new Set(text.replace(/\s+/g, "")).size;
	return { text, length: text.length, distinct };
};

export function evaluateNoteGate(input: NoteGateInput): NoteGate {
	const policy = { ...DEFAULT_NOTE_POLICY, ...(input.policy || {}) };
	const minorPerMajor = Number(input.minorPerMajor) || 100;

	const differenceMinor = majorToMinor(input.difference, minorPerMajor);
	const takingsMinor = Math.max(0, majorToMinor(input.takings, minorPerMajor));

	// Both halves in minor units, compared as integers. `Math.round` on the
	// proportional half rather than `floor`: the tolerance is a threshold, and
	// truncating it would make the rule marginally stricter than it reads.
	const floorMinor = Math.max(0, majorToMinor(policy.floorMajor, minorPerMajor));
	const bandMinor = Math.max(0, Math.round(takingsMinor * Number(policy.rateOfTakings || 0)));
	const toleranceMinor = Math.max(floorMinor, bandMinor);

	// Strictly greater: a difference EQUAL to the tolerance is the last one the
	// policy calls ordinary. Flipping this to `>=` is the boundary mutant
	// `movilCorteNoteGate.spec.ts` exists to kill.
	const required = Math.abs(differenceMinor) > toleranceMinor;

	const substance = substanceOf(input.note);
	const satisfied =
		substance.length >= policy.minLength && substance.distinct >= policy.minDistinct;

	const verdict: NoteVerdict = !required
		? "notRequired"
		: satisfied
			? "satisfied"
			: substance.length === 0
				? "missing"
				: "tooShort";

	return {
		difference: differenceMinor / minorPerMajor,
		tolerance: toleranceMinor / minorPerMajor,
		ratio: differenceRatio(input.difference, input.takings, minorPerMajor),
		required,
		satisfied,
		canClose: !required || satisfied,
		verdict,
	};
}

export default evaluateNoteGate;
