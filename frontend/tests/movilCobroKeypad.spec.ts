import { describe, expect, it } from "vitest";

import {
	EMPTY_ENTRY,
	KEYPAD_LAYOUT,
	applyKeypadKey,
	decimalPlaces,
	entryIsEmpty,
	entryMinor,
	type KeypadKey,
} from "../src/posapp/components/pos/mobile/pay/keypadEntry";
import {
	resolvePayTotals,
	splitIsAvailable,
} from "../src/posapp/components/pos/mobile/pay/payTotals";

/**
 * The phone's keypad and the four figures it moves.
 *
 * `MovilCobro.dc.html` draws `7 8 9 Borrar / 4 5 6 00 / 1 2 3 Dividir pago /
 * 0 .` — fourteen targets, two of which are not digits. What is tested here is
 * composition (what a sequence of taps comes to) and the relationship between
 * total, received, shortfall and change, which the screen must never be able
 * to state contradictorily.
 *
 * No jsdom: both modules are pure.
 */

const MXN = 100;
const JPY = 1;

/** Tap a sequence, left to right, from an empty pad. */
const type = (keys: string, minorPerMajor = MXN): string =>
	keys
		.split(" ")
		.filter(Boolean)
		.reduce((entry, key) => applyKeypadKey(entry, key as KeypadKey, minorPerMajor), EMPTY_ENTRY);

describe("the pad the artboard draws", () => {
	it("carries fourteen targets, in the artboard's order", () => {
		expect(KEYPAD_LAYOUT).toHaveLength(14);
		expect(KEYPAD_LAYOUT.map((button) => button.key)).toEqual([
			"7",
			"8",
			"9",
			"backspace",
			"4",
			"5",
			"6",
			"00",
			"1",
			"2",
			"3",
			"split",
			"0",
			".",
		]);
	});

	it("spans `Dividir pago` down two rows and `0` across two columns", () => {
		expect(KEYPAD_LAYOUT.find((button) => button.key === "split")?.rowSpan).toBe(2);
		expect(KEYPAD_LAYOUT.find((button) => button.key === "0")?.colSpan).toBe(2);
	});

	it("marks only the worded keys as translatable", () => {
		// `__("7")` is not a string anybody translates, and a digit in es.csv
		// is a row that will one day be "corrected".
		const translated = KEYPAD_LAYOUT.filter((button) => button.translate).map((b) => b.key);
		expect(translated).toEqual(["backspace", "split"]);
	});
});

describe("composing an amount", () => {
	it("keys $1,200.00 the way a cashier does — 1 2 00", () => {
		const entry = type("1 2 00");
		expect(entry).toBe("1200");
		expect(entryMinor(entry, MXN)).toBe(120_000);
	});

	it("ignores 00 as a first press, which would be a dressed-up zero", () => {
		expect(type("00")).toBe(EMPTY_ENTRY);
		expect(type("00 00 00")).toBe(EMPTY_ENTRY);
	});

	it("collapses a leading zero rather than stacking digits behind it", () => {
		expect(type("0")).toBe("0");
		expect(type("0 0")).toBe("0");
		expect(type("0 00")).toBe("0");
		expect(type("0 5")).toBe("5");
	});

	it("opens a decimal from an empty pad as 0.", () => {
		expect(type(".")).toBe("0.");
		expect(entryMinor("0.", MXN)).toBe(0);
	});

	it("takes one decimal point and no more", () => {
		expect(type("1 2 . 5 . 0")).toBe("12.50");
	});

	it("refuses a third decimal instead of rounding it away", () => {
		expect(type("1 2 . 5 0 9")).toBe("12.50");
		expect(entryMinor("12.50", MXN)).toBe(1250);
	});

	it("fits as much of 00 as the decimals allow", () => {
		expect(type("1 2 . 5 00")).toBe("12.50");
		expect(type("1 2 . 00")).toBe("12.00");
	});

	it("deletes one character at a time, and recovers from empty", () => {
		let entry = type("1 2 . 5");
		expect(entry).toBe("12.5");
		entry = applyKeypadKey(entry, "backspace", MXN);
		expect(entry).toBe("12.");
		entry = applyKeypadKey(entry, "backspace", MXN);
		expect(entry).toBe("12");
		entry = applyKeypadKey(entry, "backspace", MXN);
		expect(entry).toBe("1");
		entry = applyKeypadKey(entry, "backspace", MXN);
		expect(entry).toBe(EMPTY_ENTRY);
		expect(applyKeypadKey(entry, "backspace", MXN)).toBe(EMPTY_ENTRY);
	});

	it("leaves the entry alone when `Dividir pago` is pressed", () => {
		// The key acts on the amount; it does not edit it.
		expect(applyKeypadKey("1200", "split", MXN)).toBe("1200");
	});

	it("caps the digits rather than composing an amount that cannot be exact", () => {
		const entry = type("9 9 9 9 9 9 9 9 9 9 9 9 9 9 9");
		expect(entry.replace(/\D/g, "")).toHaveLength(12);
	});

	it("knows an empty pad from a keyed zero", () => {
		expect(entryIsEmpty(EMPTY_ENTRY)).toBe(true);
		expect(entryIsEmpty("0")).toBe(false);
	});
});

describe("a currency with no minor unit", () => {
	it("offers no decimal point at all", () => {
		expect(decimalPlaces(JPY)).toBe(0);
		expect(type("1 2 . 5", JPY)).toBe("125");
	});

	it("reads the whole entry as minor units", () => {
		expect(entryMinor("1200", JPY)).toBe(1200);
	});
});

describe("the entry is parsed in integers, not multiplied out of a float", () => {
	it("reads 0.29 as exactly 29 centavos", () => {
		// `Number("0.29") * 100` is 28.999999999999996 in this language, which
		// truncates to 28 — one centavo the customer paid and the register
		// never saw. The string path cannot do that.
		expect(entryMinor("0.29", MXN)).toBe(29);
		expect(Math.floor(Number("0.29") * 100)).toBe(28);
	});

	it("agrees with the integer reading across every centavo of a peso", () => {
		for (let cents = 0; cents < 100; cents += 1) {
			expect(entryMinor(`7.${String(cents).padStart(2, "0")}`, MXN)).toBe(700 + cents);
		}
	});

	it("pads a half-typed fraction instead of guessing at it", () => {
		expect(entryMinor("12.5", MXN)).toBe(1250);
		expect(entryMinor("12.", MXN)).toBe(1200);
	});
});

describe("total, received, shortfall and change", () => {
	const artboard = () =>
		resolvePayTotals({ total: 1129, tendered: 0, keyedMinor: 120_000, currency: "MXN" });

	it("states the canvas's own figures", () => {
		const totals = artboard();
		expect(totals.total).toBe(1129);
		expect(totals.received).toBe(1200);
		expect(totals.shortfall).toBe(0);
		expect(totals.change.major).toBe(71);
		expect(totals.change.notes).toEqual([
			{ minor: 5000, count: 1 },
			{ minor: 2000, count: 1 },
			{ minor: 100, count: 1 },
		]);
	});

	it("never shows a shortfall and a change at the same time", () => {
		// The property, not a case: they come from one signed subtraction, so
		// no input can make both non-zero. A register that says "falta $40" and
		// "cambio $71" together is one nobody can act on.
		for (let keyed = 0; keyed <= 250_000; keyed += 733) {
			const totals = resolvePayTotals({ total: 1129, keyedMinor: keyed, currency: "MXN" });
			expect(
				totals.shortfallMinor === 0 || totals.change.minor === 0,
				`both non-zero at ${keyed}`,
			).toBe(true);
			expect(totals.shortfallMinor - totals.change.minor).toBe(112_900 - keyed);
		}
	});

	it("counts what is already on payment lines as received", () => {
		const totals = resolvePayTotals({
			total: 1129,
			tendered: 1000,
			keyedMinor: 20_000,
			currency: "MXN",
		});
		expect(totals.received).toBe(1200);
		expect(totals.change.major).toBe(71);
		expect(totals.remainingMinor).toBe(12_900);
	});

	it("treats a missing or unreadable figure as zero rather than throwing", () => {
		// This runs on every keystroke; a screen that blanks mid-sale because a
		// prop arrived late is worse than one that reads nothing owed yet.
		const totals = resolvePayTotals(null);
		expect(totals.total).toBe(0);
		expect(totals.received).toBe(0);
		expect(totals.shortfallMinor).toBe(0);
		expect(totals.change.minor).toBe(0);
		expect(resolvePayTotals({ total: "x", tendered: undefined }).totalMinor).toBe(0);
	});
});

describe("when `Dividir pago` is a real option", () => {
	const totals = resolvePayTotals({ total: 1129, tendered: 0, keyedMinor: 50_000, currency: "MXN" });

	const args = (over: Partial<Parameters<typeof splitIsAvailable>[0]> = {}) => ({
		totals,
		keyedMinor: 50_000,
		hasArmedTender: true,
		multipleTenders: true,
		...over,
	});

	it("offers it for a part-payment that leaves something behind", () => {
		expect(splitIsAvailable(args())).toBe(true);
	});

	it("refuses when nothing is keyed — there is nothing to split off", () => {
		expect(splitIsAvailable(args({ keyedMinor: 0 }))).toBe(false);
	});

	it("refuses when the keyed amount already settles the sale", () => {
		// Not a split: it is the sale. Offering it here invites a second
		// payment row for zero pesos.
		expect(splitIsAvailable(args({ keyedMinor: 112_900 }))).toBe(false);
		expect(splitIsAvailable(args({ keyedMinor: 120_000 }))).toBe(false);
	});

	it("refuses when no tender is armed, so a part-payment has nowhere to land", () => {
		expect(splitIsAvailable(args({ hasArmedTender: false }))).toBe(false);
	});

	it("refuses on a register with one tender, which has nothing to mix", () => {
		expect(splitIsAvailable(args({ multipleTenders: false }))).toBe(false);
	});
});
