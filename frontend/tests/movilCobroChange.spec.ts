import { describe, expect, it } from "vitest";

import { denominationsFor } from "../src/posapp/components/pos/closing/denominations";
import {
	breakdownAddsUp,
	noteFaceMajor,
	resolveChangeBreakdown,
	totalPieces,
} from "../src/posapp/components/pos/mobile/pay/changeBreakdown";

/**
 * The change breakdown — `MovilCobro.dc.html`'s `1 × $50 · 1 × $20 · 1 × $1`.
 *
 * This is the one derivation on the phone's payment screen with money behind
 * it, so it is tested the way `tenderChips.resolveArmedTender` and
 * `hardwareReadiness` are: by property and by mutation, not by one happy case.
 *
 * Three properties matter, in this order:
 *
 *   1. it never emits a face the currency's own list does not contain — a
 *      register that tells a cashier to hand back a note the drawer has never
 *      held is worse than one that says nothing;
 *   2. the stacks plus the unmakeable remainder come to exactly the amount
 *      owed, in integers;
 *   3. the remainder is stated rather than rounded away.
 *
 * No jsdom: pure modules, and the float twin below reads no DOM.
 */

const MXN = denominationsFor("MXN");

describe("the artboard's own change", () => {
	it("breaks $71.00 into 1 × $50 · 1 × $20 · 1 × $1", () => {
		// `Total $1,129.00 · Recibido $1,200.00` — the canvas's numbers, so the
		// code and the reference cannot drift apart unnoticed.
		const breakdown = resolveChangeBreakdown(1200 - 1129, "MXN");

		expect(breakdown.minor).toBe(7100);
		expect(breakdown.notes).toEqual([
			{ minor: 5000, count: 1 },
			{ minor: 2000, count: 1 },
			{ minor: 100, count: 1 },
		]);
		expect(breakdown.notes.map((note) => noteFaceMajor(note, breakdown.denominations))).toEqual([
			50, 20, 1,
		]);
		expect(breakdown.unbreakableMinor).toBe(0);
		expect(totalPieces(breakdown)).toBe(3);
	});

	it("hands back nothing when nothing is owed", () => {
		for (const amount of [0, -5, Number.NaN, null, undefined, "abc"]) {
			const breakdown = resolveChangeBreakdown(amount, "MXN");
			expect(breakdown.minor).toBe(0);
			expect(breakdown.notes).toEqual([]);
			expect(breakdown.unbreakableMinor).toBe(0);
		}
	});
});

describe("it never invents a denomination", () => {
	const currencies = ["MXN", "USD", "PKR", "JPY", "ZZZ", "", null];

	it("emits only faces the currency's own list carries", () => {
		for (const currency of currencies) {
			const faces = new Set(denominationsFor(currency).faces);
			for (let cents = 1; cents <= 5_000; cents += 7) {
				const breakdown = resolveChangeBreakdown(cents / 100, currency);
				for (const note of breakdown.notes) {
					expect(
						faces.has(note.minor),
						`${currency}: ${note.minor} is not a face this drawer holds`,
					).toBe(true);
					expect(note.count).toBeGreaterThan(0);
					expect(Number.isInteger(note.count)).toBe(true);
				}
			}
		}
	});

	it("adds up, to the centavo, including what it cannot make", () => {
		for (const currency of currencies) {
			for (let cents = 0; cents <= 20_000; cents += 13) {
				const breakdown = resolveChangeBreakdown(cents / 100, currency);
				expect(breakdownAddsUp(breakdown), `${currency} @ ${cents}`).toBe(true);
			}
		}
	});

	it("never overshoots — the stack is worth no more than is owed", () => {
		for (const currency of currencies) {
			for (let cents = 0; cents <= 20_000; cents += 11) {
				const breakdown = resolveChangeBreakdown(cents / 100, currency);
				const handed = breakdown.notes.reduce((sum, note) => sum + note.minor * note.count, 0);
				expect(handed).toBeLessThanOrEqual(breakdown.minor);
			}
		}
	});

	it("largest face first, which is how a hand moves through a drawer", () => {
		const breakdown = resolveChangeBreakdown(1863.5, "MXN");
		const faces = breakdown.notes.map((note) => note.minor);
		expect([...faces].sort((a, b) => b - a)).toEqual(faces);
	});
});

describe("what the drawer cannot make is stated, not rounded", () => {
	it("keeps the 30 centavos the MXN list has no coin for", () => {
		// The count list stops at $1 on purpose (`denominations.ts`: nobody
		// counts centavos at close), so a 30-centavo remainder is real.
		const breakdown = resolveChangeBreakdown(8.3, "MXN");

		expect(breakdown.notes).toEqual([
			{ minor: 500, count: 1 },
			{ minor: 200, count: 1 },
			{ minor: 100, count: 1 },
		]);
		expect(breakdown.unbreakableMinor).toBe(30);
		expect(breakdownAddsUp(breakdown)).toBe(true);
	});

	it("makes 70 US cents out of coins the drawer actually has", () => {
		const breakdown = resolveChangeBreakdown(0.7, "USD");

		expect(breakdown.notes).toEqual([
			{ minor: 25, count: 2 },
			{ minor: 10, count: 2 },
		]);
		expect(breakdown.unbreakableMinor).toBe(0);
	});

	it("refuses to break a bills-only fallback list into coins", () => {
		// PKR has no drawer list, so `denominationsFor` falls back to
		// smartTender's BILLS. Seven rupees cannot be handed back from bills
		// and the module says so rather than inventing a coin.
		const breakdown = resolveChangeBreakdown(7, "PKR");

		expect(breakdown.notes).toEqual([]);
		expect(breakdown.unbreakableMinor).toBe(700);
	});
});

/**
 * MUTATION: the same greedy, in floats.
 *
 * `closing/denominations.ts` says currency in a float is a bug waiting for a
 * peso; this is that bug, made to happen. The twin below is the identical
 * algorithm with one change — it subtracts major units instead of minor ones —
 * and on 70 US cents it hands the customer 69 and claims the drawer cannot
 * make the last one. Nothing about the face list, the order or the loop
 * differs; only the arithmetic does.
 *
 * If this test ever starts passing "the same as the integer path", the integer
 * path has been quietly replaced.
 */
const floatChange = (changeMajor: number, currency: string) => {
	const { faces, minorPerMajor } = denominationsFor(currency);
	const notes: { minor: number; count: number }[] = [];
	let remaining = changeMajor;

	for (const face of faces) {
		const major = face / minorPerMajor;
		if (remaining < major) continue;
		const count = Math.floor(remaining / major);
		remaining -= count * major;
		notes.push({ minor: face, count });
	}

	return { notes, remaining };
};

describe("mutation — the same arithmetic in floats", () => {
	it("short-changes the customer by a cent on 70¢", () => {
		const mutated = floatChange(0.7, "USD");
		const handedBack = mutated.notes.reduce((sum, note) => sum + note.minor * note.count, 0);

		// 69, not 70. The customer is a cent down and the register is a cent up.
		expect(handedBack).toBe(69);
		expect(handedBack).toBeLessThan(resolveChangeBreakdown(0.7, "USD").minor);
	});

	it("invents a remainder out of a drawer that has the coin for it", () => {
		const mutated = floatChange(0.7, "USD");

		// A leftover of ~0.01 in a currency whose list carries a 1¢ coin: the
		// float path both under-pays AND reports it cannot make up the
		// difference, which is the failure mode the integer path removes.
		expect(mutated.remaining).toBeGreaterThan(0);
		expect(resolveChangeBreakdown(0.7, "USD").unbreakableMinor).toBe(0);
	});

	it("hands over more pieces than the drawer needs to", () => {
		expect(floatChange(0.7, "USD").notes.reduce((n, note) => n + note.count, 0)).toBeGreaterThan(
			totalPieces(resolveChangeBreakdown(0.7, "USD")),
		);
	});

	it("and the integer path is exact across the whole range", () => {
		// The positive half of the mutation: every amount the float twin can
		// spoil, the shipped path gets right.
		for (let cents = 1; cents <= 500; cents += 1) {
			const breakdown = resolveChangeBreakdown(cents / 100, "USD");
			const handed = breakdown.notes.reduce((sum, note) => sum + note.minor * note.count, 0);
			expect(handed + breakdown.unbreakableMinor).toBe(cents);
		}
	});
});

describe("the table is the corte's, not a second one", () => {
	it("reads its faces from closing/denominations", () => {
		// The point of reuse: change and the drawer count cannot disagree about
		// what this shop holds, because there is only one list to disagree with.
		expect(resolveChangeBreakdown(0, "MXN").denominations).toBe(MXN);
		expect(MXN.faces).toContain(5000);
		expect(MXN.minorPerMajor).toBe(100);
	});
});
