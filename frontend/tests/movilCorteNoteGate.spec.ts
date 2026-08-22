import { describe, expect, it } from "vitest";

/**
 * The two rules `MovilCorte.dc.html` drew and the app did not have: when a cash
 * difference must be explained in writing, and what that difference is as a
 * share of the day.
 *
 * The gate is the control with money behind it — an unexplained difference is
 * how a drawer bleeds quietly — so this file does two things a normal spec does
 * not. It pins the BOUNDARIES rather than a happy path, and it carries a
 * mutation harness: a faithful re-implementation of the rule with one edit
 * applied at a time, run against the same oracle, asserting that every mutant
 * is caught. A gate whose off-by-one survives its own test suite is a gate that
 * is not being tested, only exercised.
 */

import {
	DEFAULT_NOTE_POLICY,
	differenceRatio,
	evaluateNoteGate,
	type NoteGate,
	type NoteVerdict,
} from "../src/posapp/components/pos/mobile/closing/differenceNote";
import { majorToMinor } from "../src/posapp/components/pos/closing/denominations";

/** The artboard's shift, in its own figures (build plan §8 R7: artboards win). */
const ARTBOARD = {
	expected: 5391,
	counted: 5366,
	difference: -25,
	/** "Total del turno" — 5,120 cash + 3,890 card + 1,240 transfer + 420 wallet. */
	takings: 10670,
	cashTakings: 5120,
	note: "Faltan $25 de la venta B-04801: se dio cambio de más al cerrar con prisa.",
};

// ---------------------------------------------------------------------------
// the percentage
// ---------------------------------------------------------------------------

describe("the difference as a share of the day", () => {
	it("reads the artboard's 0.23 % off the artboard's own takings", () => {
		const ratio = differenceRatio(ARTBOARD.difference, ARTBOARD.takings);

		expect(ratio).not.toBeNull();
		expect(ratio!.percent).toBe(0.23);
		// Signed underneath, unsigned on screen: the caption beside it already
		// says *faltante*, and "−0.23 %" under that says the direction twice.
		expect(ratio!.ratio).toBeLessThan(0);
	});

	it("divides by every payment mode, not by the cash lane alone", () => {
		// Both readings are defensible and they are NOT the same number, which is
		// the reason to pin the choice: against cash takings the same shortfall
		// reads twice as loud. `differenceNote.ts` argues why the day wins.
		expect(differenceRatio(-25, ARTBOARD.cashTakings)!.percent).toBe(0.49);
		// And it is not the expected-cash denominator either — that one already
		// exists per-row as PaymentReconciliation.vue's variance chip.
		expect(differenceRatio(-25, ARTBOARD.expected)!.percent).toBe(0.46);
	});

	it("scales the same peso against the size of the day", () => {
		// The whole point of the figure: $25 is a different event at each scale,
		// and this is what makes that legible at 8pm without arithmetic.
		expect(differenceRatio(-25, 200)!.percent).toBe(12.5);
		expect(differenceRatio(-25, 11000)!.percent).toBe(0.23);
		expect(differenceRatio(-25, 100000)!.percent).toBe(0.03);
	});

	it("has no answer on a day with no takings, and says so rather than dividing", () => {
		expect(differenceRatio(-25, 0)).toBeNull();
		expect(differenceRatio(0, 0)).toBeNull();
		// A refunds-only shift can hand back a negative total; "the difference is
		// −X % of sales" is arithmetic nobody can read.
		expect(differenceRatio(-25, -400)).toBeNull();
	});

	it("divides integers, so a float that arrived long cannot move the decimal", () => {
		expect(differenceRatio(-25, 10670.000000000002)!.percent).toBe(0.23);
		expect(differenceRatio(-25.000000000000004, 10670)!.percent).toBe(0.23);
	});
});

// ---------------------------------------------------------------------------
// the gate — the oracle
// ---------------------------------------------------------------------------

interface Case {
	name: string;
	difference: number;
	takings: number;
	note: string;
	required: boolean;
	canClose: boolean;
	verdict: NoteVerdict;
	tolerance: number;
}

/**
 * Every case is a decision the rule has to get right, and each one exists to
 * catch a specific way of getting it wrong — the mutation table below names
 * which. Nothing here is a happy path for its own sake.
 */
const ORACLE: Case[] = [
	{
		name: "the artboard's shift, nothing written",
		difference: -25,
		takings: 10670,
		note: "",
		required: true,
		canClose: false,
		verdict: "missing",
		tolerance: 20,
	},
	{
		name: "the artboard's shift, explained the way the artboard explains it",
		difference: -25,
		takings: 10670,
		note: ARTBOARD.note,
		required: true,
		canClose: true,
		verdict: "satisfied",
		tolerance: 20,
	},
	{
		name: "a surplus is as unexplained as a shortfall",
		difference: 25,
		takings: 10670,
		note: "",
		required: true,
		canClose: false,
		verdict: "missing",
		tolerance: 20,
	},
	{
		name: "exactly at tolerance is the last ordinary difference",
		difference: -20,
		takings: 10670,
		note: "",
		required: false,
		canClose: true,
		verdict: "notRequired",
		tolerance: 20,
	},
	{
		name: "one centavo past tolerance already is not",
		difference: -20.01,
		takings: 10670,
		note: "",
		required: true,
		canClose: false,
		verdict: "missing",
		tolerance: 20,
	},
	{
		name: "between the proportional band and the floor, the floor governs",
		// 0.1 % of 10,670 is $10.67; without the floor this would demand prose.
		difference: -15,
		takings: 10670,
		note: "",
		required: false,
		canClose: true,
		verdict: "notRequired",
		tolerance: 20,
	},
	{
		name: "on a busy register the proportional band takes over",
		// 0.1 % of 100,000 is $100, so $50 is inside tolerance there and would
		// not be on the artboard's day.
		difference: -50,
		takings: 100000,
		note: "",
		required: false,
		canClose: true,
		verdict: "notRequired",
		tolerance: 100,
	},
	{
		name: "a rounding peso never demands an explanation",
		// This is the case that decides whether the control survives contact
		// with a real drawer: denominations.ts stops counting at $1 and cash
		// tenders round per ticket, so small differences are the instrument, not
		// an event. Demanding prose here is what trains cashiers to type ".".
		difference: -1,
		takings: 10670,
		note: "",
		required: false,
		canClose: true,
		verdict: "notRequired",
		tolerance: 20,
	},
	{
		name: "a clean drawer closes with nothing written",
		difference: 0,
		takings: 10670,
		note: "",
		required: false,
		canClose: true,
		verdict: "notRequired",
		tolerance: 20,
	},
	{
		name: '"." is not an explanation',
		difference: -25,
		takings: 10670,
		note: ".",
		required: true,
		canClose: false,
		verdict: "tooShort",
		tolerance: 20,
	},
	{
		name: "neither is one character held down",
		difference: -25,
		takings: 10670,
		note: "aaaaaaaaaaaaaa",
		required: true,
		canClose: false,
		verdict: "tooShort",
		tolerance: 20,
	},
	{
		name: "a short word padded with spaces is still a short word",
		difference: -25,
		takings: 10670,
		note: "          hola          ",
		required: true,
		canClose: false,
		verdict: "tooShort",
		tolerance: 20,
	},
	{
		name: '"I do not know" IS an explanation — the gate asks, it does not trap',
		difference: -25,
		takings: 10670,
		note: "No sé qué pasó, conté dos veces",
		required: true,
		canClose: true,
		verdict: "satisfied",
		tolerance: 20,
	},
	{
		name: "a dead day still has a floor, and no percentage",
		difference: -25,
		takings: 0,
		note: "",
		required: true,
		canClose: false,
		verdict: "missing",
		tolerance: 20,
	},
	{
		name: "a note under tolerance is kept, never demanded",
		difference: -3,
		takings: 10670,
		note: "Se dejó propina en la charola, tres pesos",
		required: false,
		canClose: true,
		verdict: "notRequired",
		tolerance: 20,
	},
];

const run = (c: Case): NoteGate =>
	evaluateNoteGate({ difference: c.difference, takings: c.takings, note: c.note });

/** By name, not by index — a case inserted above must not silently repoint one. */
const caseNamed = (name: string): Case => {
	const found = ORACLE.find((c) => c.name === name);
	if (!found) throw new Error(`no oracle case named "${name}"`);
	return found;
};

describe("when a difference has to be explained", () => {
	for (const c of ORACLE) {
		it(c.name, () => {
			const gate = run(c);
			expect(gate.required, "required").toBe(c.required);
			expect(gate.canClose, "canClose").toBe(c.canClose);
			expect(gate.verdict, "verdict").toBe(c.verdict);
			expect(gate.tolerance, "tolerance").toBe(c.tolerance);
		});
	}

	it("echoes the difference it ruled on, so a caller cannot mismatch them", () => {
		expect(run(ORACLE[0]!).difference).toBe(-25);
	});

	it("carries the same share-of-sales the card prints", () => {
		expect(run(ORACLE[0]!).ratio?.percent).toBe(0.23);
		expect(run(caseNamed("a dead day still has a floor, and no percentage")).ratio).toBeNull();
	});

	it("lets a tenant move the threshold without moving the rule", () => {
		// Drop the floor below the proportional band and the band governs alone.
		const strict = evaluateNoteGate({
			difference: -11,
			takings: 10670,
			note: "",
			policy: { floorMajor: 2 },
		});
		expect(strict.tolerance).toBe(10.67);
		expect(strict.required).toBe(true);

		const lax = evaluateNoteGate({
			difference: -25,
			takings: 10670,
			note: "",
			policy: { floorMajor: 500 },
		});
		expect(lax.required).toBe(false);
	});

	it("keeps its defaults where the artboard put them", () => {
		// The rate must sit UNDER the artboard's own 0.23 %, or the shift the
		// artboard draws with a mandatory note would not have required one.
		expect(DEFAULT_NOTE_POLICY.rateOfTakings * 100).toBeLessThan(0.23);
		expect(DEFAULT_NOTE_POLICY.floorMajor).toBeLessThan(25);
	});
});

// ---------------------------------------------------------------------------
// the mutation harness
// ---------------------------------------------------------------------------

/**
 * One plausible slip each — the kind that survives review because the line
 * still reads correctly.
 */
type Mutation =
	| "none"
	| "boundary-gte"
	| "inverted"
	| "unsigned-difference"
	| "shortfall-only"
	| "min-not-max"
	| "no-floor"
	| "no-band"
	| "rate-ten-times"
	| "always-closes"
	| "any-text-counts"
	| "no-trim"
	| "no-distinct-check";

/**
 * A faithful transcription of `differenceNote.ts`'s rule, with exactly one edit
 * applied. `"none"` must agree with the module on every oracle case — that
 * agreement is asserted first, because a mutant set measured against a drifted
 * transcription measures nothing at all.
 */
const referenceGate = (c: Case, mutation: Mutation) => {
	const policy = DEFAULT_NOTE_POLICY;
	const minorPerMajor = 100;

	const differenceMinor = majorToMinor(c.difference, minorPerMajor);
	const takingsMinor = Math.max(0, majorToMinor(c.takings, minorPerMajor));

	const floorMinor = Math.max(0, majorToMinor(policy.floorMajor, minorPerMajor));
	const rate = mutation === "rate-ten-times" ? policy.rateOfTakings * 10 : policy.rateOfTakings;
	const bandMinor = Math.max(0, Math.round(takingsMinor * rate));

	const toleranceMinor =
		mutation === "min-not-max"
			? Math.min(floorMinor, bandMinor)
			: mutation === "no-floor"
				? bandMinor
				: mutation === "no-band"
					? floorMinor
					: Math.max(floorMinor, bandMinor);

	const magnitude =
		mutation === "unsigned-difference"
			? differenceMinor
			: mutation === "shortfall-only"
				? -differenceMinor
				: Math.abs(differenceMinor);
	const required =
		mutation === "boundary-gte"
			? magnitude >= toleranceMinor
			: mutation === "inverted"
				? magnitude < toleranceMinor
				: magnitude > toleranceMinor;

	const raw = String(c.note ?? "");
	const text = mutation === "no-trim" ? raw : raw.trim();
	const distinct = new Set(
		mutation === "no-trim" ? text : text.replace(/\s+/g, ""),
	).size;

	const satisfied =
		mutation === "any-text-counts"
			? text.trim().length > 0
			: mutation === "no-distinct-check"
				? text.length >= policy.minLength
				: text.length >= policy.minLength && distinct >= policy.minDistinct;

	const canClose = mutation === "always-closes" ? true : !required || satisfied;
	const verdict: NoteVerdict = !required
		? "notRequired"
		: satisfied
			? "satisfied"
			: text.length === 0
				? "missing"
				: "tooShort";

	return { required, satisfied, canClose, verdict, tolerance: toleranceMinor / minorPerMajor };
};

/** What the oracle actually checks — the mutant must move one of these. */
const observable = (g: { required: boolean; canClose: boolean; verdict: string; tolerance: number }) =>
	`${g.required}|${g.canClose}|${g.verdict}|${g.tolerance}`;

/**
 * Every mutant, and the oracle case that must catch it. Written down rather
 * than searched for: "something in the table happened to differ" is a weaker
 * claim than "THIS case is why this edit cannot land", and only the second one
 * tells a future reader which case they must not delete.
 */
const DISCRIMINATORS: Record<Exclude<Mutation, "none">, string> = {
	"boundary-gte": "exactly at tolerance is the last ordinary difference",
	inverted: "the artboard's shift, nothing written",
	// Dropping `Math.abs` breaks the COMMON case, not the surplus one.
	"unsigned-difference": "the artboard's shift, nothing written",
	// …and challenging only shortfalls is the edit the surplus case exists for.
	"shortfall-only": "a surplus is as unexplained as a shortfall",
	"min-not-max": "between the proportional band and the floor, the floor governs",
	"no-floor": "between the proportional band and the floor, the floor governs",
	"no-band": "on a busy register the proportional band takes over",
	"rate-ten-times": "the artboard's shift, nothing written",
	"always-closes": "the artboard's shift, nothing written",
	"any-text-counts": '"." is not an explanation',
	"no-trim": "a short word padded with spaces is still a short word",
	"no-distinct-check": "neither is one character held down",
};

const MUTANTS = Object.keys(DISCRIMINATORS) as Exclude<Mutation, "none">[];

describe("the gate survives its own mutation", () => {
	it("transcribes the real rule before mutating it", () => {
		// A mutant set measured against a drifted transcription measures nothing,
		// so the baseline is asserted against the module itself first.
		for (const c of ORACLE) {
			expect(observable(referenceGate(c, "none")), c.name).toBe(observable(run(c)));
		}
	});

	it("kills every mutant, and names any that lives", () => {
		const survivors = MUTANTS.filter(
			(mutation) =>
				!ORACLE.some(
					(c) => observable(referenceGate(c, mutation)) !== observable(referenceGate(c, "none")),
				),
		);

		expect(
			survivors,
			`these edits to the note gate would pass this suite unnoticed:\n${survivors.join("\n")}`,
		).toEqual([]);
		// Pinned so a mutant quietly leaving the table shows as a drop rather
		// than as a still-green file.
		expect(MUTANTS).toHaveLength(12);
	});

	it("is killed by the case named for it, not by luck elsewhere in the table", () => {
		for (const mutation of MUTANTS) {
			const c = caseNamed(DISCRIMINATORS[mutation]);
			expect(
				observable(referenceGate(c, mutation)),
				`"${c.name}" no longer distinguishes the "${mutation}" edit — either the case moved or the rule did`,
			).not.toBe(observable(referenceGate(c, "none")));
		}
	});
});
