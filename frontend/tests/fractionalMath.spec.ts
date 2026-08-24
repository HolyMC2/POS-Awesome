import { describe, expect, it } from "vitest";

import {
	DEFAULT_QTY_PRECISION,
	floorTo,
	isFractionEligible,
	netFromTara,
	qtyFromImporte,
	qtyFromSubUnit,
	qtyPrecisionForUom,
	quantizeQty,
	readSubUnit,
	roundTo,
	toSubUnit,
} from "../src/posapp/utils/fractionalMath";

describe("decimal shifting", () => {
	it("rounds the cases binary floating point gets wrong", () => {
		// 1.005 * 100 is 100.49999999999999 in binary; a naive round loses a centavo.
		expect(roundTo(1.005, 2)).toBe(1.01);
		expect(roundTo(2.675, 2)).toBe(2.68);
		expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
		expect(roundTo(49.925, 2)).toBe(49.93);
	});

	it("floors without inheriting the same error", () => {
		expect(floorTo(0.1 + 0.2, 3)).toBe(0.3);
		expect(floorTo(49.999, 2)).toBe(49.99);
		expect(floorTo(0.3125, 3)).toBe(0.312);
		expect(floorTo(5, 3)).toBe(5);
	});

	it("survives values JavaScript prints in exponent form", () => {
		expect(roundTo(1e-7, 3)).toBe(0);
		expect(floorTo(1e-7, 3)).toBe(0);
		expect(roundTo(1.5e-3, 3)).toBe(0.002);
		expect(floorTo(1e21, 2)).toBe(1e21);
	});

	it("answers NaN for non-finite input rather than 0", () => {
		expect(roundTo(NaN, 2)).toBeNaN();
		expect(floorTo(Infinity, 2)).toBeNaN();
	});
});

describe("fraction eligibility", () => {
	it("reads a Check field in every shape Frappe delivers it", () => {
		expect(isFractionEligible({ mustBeWholeNumber: 0 })).toBe(true);
		expect(isFractionEligible({ mustBeWholeNumber: "0" })).toBe(true);
		expect(isFractionEligible({ mustBeWholeNumber: false })).toBe(true);
		expect(isFractionEligible({ mustBeWholeNumber: 1 })).toBe(false);
		expect(isFractionEligible({ mustBeWholeNumber: "1" })).toBe(false);
		expect(isFractionEligible({ mustBeWholeNumber: true })).toBe(false);
	});

	it("treats an ABSENT fact as ineligible, never as permission", () => {
		// An offline row cached before the field shipped is not evidence that
		// the UOM takes decimals — guessing yes builds a cart the server
		// refuses at save.
		expect(isFractionEligible({})).toBe(false);
		expect(isFractionEligible({ mustBeWholeNumber: undefined })).toBe(false);
		expect(isFractionEligible({ mustBeWholeNumber: null })).toBe(false);
		expect(isFractionEligible({ mustBeWholeNumber: "" })).toBe(false);
		expect(isFractionEligible(null)).toBe(false);
		expect(isFractionEligible(undefined)).toBe(false);
	});

	it("gives a whole-number UOM zero decimals of qty", () => {
		expect(qtyPrecisionForUom({ uom: "Nos", mustBeWholeNumber: 1 })).toBe(0);
		expect(qtyPrecisionForUom({})).toBe(0);
	});

	it("gives an eligible UOM the register's precision, capped", () => {
		expect(qtyPrecisionForUom({ uom: "Kg", mustBeWholeNumber: 0 })).toBe(DEFAULT_QTY_PRECISION);
		expect(qtyPrecisionForUom({ mustBeWholeNumber: 0, precision: 2 })).toBe(2);
		expect(qtyPrecisionForUom({ mustBeWholeNumber: 0, precision: "4" })).toBe(4);
		expect(qtyPrecisionForUom({ mustBeWholeNumber: 0, precision: 99 })).toBe(6);
		expect(qtyPrecisionForUom({ mustBeWholeNumber: 0, precision: -3 })).toBe(0);
		expect(qtyPrecisionForUom({ mustBeWholeNumber: 0, precision: "nonsense" }, 3)).toBe(3);
	});
});

describe("importe → qty", () => {
	it("is the golden flow's jamón: $50 at $160/kg", () => {
		const result = qtyFromImporte({ importe: 50, rate: 160 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.qty).toBe(0.312);
		expect(result.charged).toBe(49.92);
		expect(result.asked).toBe(50);
		expect(result.difference).toBe(0.08);
	});

	it("hands the whole ask over when the division is exact", () => {
		const result = qtyFromImporte({ importe: 50, rate: 10 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.qty).toBe(5);
		expect(result.charged).toBe(50);
		expect(result.difference).toBe(0);
	});

	it("handles a rate far above the importe", () => {
		const result = qtyFromImporte({ importe: 50, rate: 1000 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.qty).toBe(0.05);
		expect(result.charged).toBe(50);
	});

	it("handles a rate far below it", () => {
		const result = qtyFromImporte({ importe: 50, rate: 0.01 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.qty).toBe(5000);
		expect(result.charged).toBe(50);
	});

	it("never rounds the qty UP to reach the importe", () => {
		// 0.313 kg would charge $50.08 for a $50 ask. The register must not.
		const result = qtyFromImporte({ importe: 50, rate: 160 });
		if (!result.ok) throw new Error("expected a qty");
		expect(result.qty).toBeLessThan(50 / 160);
		expect(result.charged).toBeLessThanOrEqual(50);
	});

	it("refuses when one step of qty already costs more than the ask", () => {
		// $50 at $100,000/kg is half a gram — below the line's precision.
		expect(qtyFromImporte({ importe: 50, rate: 100000 })).toEqual({
			ok: false,
			reason: "below_minimum_qty",
		});
	});

	it("refuses a missing or nonsensical rate rather than inventing one", () => {
		expect(qtyFromImporte({ importe: 50, rate: 0 }).ok).toBe(false);
		expect(qtyFromImporte({ importe: 50, rate: -160 })).toEqual({
			ok: false,
			reason: "rate_not_positive",
		});
		expect(qtyFromImporte({ importe: 50, rate: NaN })).toEqual({
			ok: false,
			reason: "rate_not_positive",
		});
	});

	it("refuses an empty ask", () => {
		expect(qtyFromImporte({ importe: 0, rate: 160 })).toEqual({
			ok: false,
			reason: "importe_not_positive",
		});
		expect(qtyFromImporte({ importe: -50, rate: 160 })).toEqual({
			ok: false,
			reason: "importe_not_positive",
		});
		// Floors to $0.00 — a sub-centavo ask buys nothing.
		expect(qtyFromImporte({ importe: 0.004, rate: 160 })).toEqual({
			ok: false,
			reason: "importe_not_positive",
		});
	});

	it("floors an over-precise ask instead of rounding it up", () => {
		const result = qtyFromImporte({ importe: 49.999, rate: 1 });
		if (!result.ok) throw new Error("expected a qty");
		expect(result.asked).toBe(49.99);
		expect(result.charged).toBeLessThanOrEqual(49.99);
	});

	it("does not give product away to make the charge come out round", () => {
		// At $1/kg, 10.004 kg still charges $10.00 — and is 4 g of free ham.
		const result = qtyFromImporte({ importe: 10, rate: 1 });
		if (!result.ok) throw new Error("expected a qty");
		expect(result.qty).toBe(10);
	});

	it("honours a register that prices to more than two decimals", () => {
		const result = qtyFromImporte({ importe: 50, rate: 160, currencyPrecision: 3 });
		if (!result.ok) throw new Error("expected a qty");
		expect(result.charged).toBe(49.92);
		expect(result.asked).toBe(50);
	});

	it("respects a coarser qty precision", () => {
		const result = qtyFromImporte({ importe: 50, rate: 160, qtyPrecision: 2 });
		if (!result.ok) throw new Error("expected a qty");
		expect(result.qty).toBe(0.31);
		expect(result.charged).toBe(49.6);
	});
});

/**
 * The invariant is the product, so it is swept rather than sampled: ~19k rate ×
 * importe pairs, every one of them checked against both halves of the rule.
 * A deterministic generator, not `Math.random` — a property test that cannot be
 * re-run on the pair that broke it is a rumour.
 */
describe("importe → qty, swept", () => {
	const nextSeed = (seed: number) => (seed * 1103515245 + 12345) % 2147483648;

	const RATES = [
		0.01, 0.05, 0.33, 0.99, 1, 1.5, 3.33, 7, 9.99, 12.5, 19.9, 23, 37.75, 49.5, 66.66, 89.9,
		99.99, 120, 160, 189, 249.5, 333.33, 499, 750.25, 999.99, 1234.56, 5000, 12345.67,
	];
	const IMPORTES = [
		0.01, 0.05, 0.5, 1, 2.5, 5, 7.77, 10, 13.5, 20, 25.25, 33.33, 50, 75, 99.99, 100, 150.5,
		200, 333, 500, 750.75, 1000, 2500, 9999.99,
	];

	it("charges at most what was asked, and never hands over more than it buys", () => {
		const step = 0.001;
		let checked = 0;
		let refused = 0;

		for (const rate of RATES) {
			for (const importe of IMPORTES) {
				const result = qtyFromImporte({ importe, rate });
				checked += 1;
				if (!result.ok) {
					// The only honest refusal here is "a full step costs more
					// than the whole ask".
					expect(result.reason).toBe("below_minimum_qty");
					expect(rate * step).toBeGreaterThan(floorTo(importe, 2));
					refused += 1;
					continue;
				}
				// 1. Money: the charge never exceeds the ask.
				expect(result.charged).toBeLessThanOrEqual(result.asked);
				// 2. Product: the qty never exceeds what the ask buys.
				expect(result.qty * rate).toBeLessThanOrEqual(result.asked + 1e-9);
				// 3. Tight: one more step would break rule 2.
				expect((result.qty + step) * rate).toBeGreaterThan(result.asked - 1e-9);
				// 4. Representable at the line's precision.
				expect(roundTo(result.qty, 3)).toBe(result.qty);
				expect(result.difference).toBeGreaterThanOrEqual(0);
			}
		}

		expect(checked).toBe(RATES.length * IMPORTES.length);
		// The sweep must actually exercise the refusal branch, not just skip it.
		expect(refused).toBeGreaterThan(0);
	});

	it("holds across pseudo-random rates and asks", () => {
		let seed = 20260823;
		const step = 0.001;

		for (let iteration = 0; iteration < 18000; iteration += 1) {
			seed = nextSeed(seed);
			// Rates from a centavo to ~$2,000, at two decimals.
			const rate = roundTo(0.01 + (seed % 200000) / 100, 2);
			seed = nextSeed(seed);
			const importe = roundTo(0.01 + (seed % 100000) / 100, 2);

			const result = qtyFromImporte({ importe, rate });
			if (!result.ok) {
				expect(result.reason).toBe("below_minimum_qty");
				continue;
			}
			expect(result.charged).toBeLessThanOrEqual(result.asked);
			expect(result.qty * rate).toBeLessThanOrEqual(result.asked + 1e-9);
			expect((result.qty + step) * rate).toBeGreaterThan(result.asked - 1e-9);
			expect(result.difference).toBe(roundTo(result.asked - result.charged, 2));
		}
	});

	it("holds when the qty precision is the coarse one a scale would use", () => {
		let seed = 991;
		for (let iteration = 0; iteration < 4000; iteration += 1) {
			seed = nextSeed(seed);
			const rate = roundTo(0.01 + (seed % 50000) / 100, 2);
			seed = nextSeed(seed);
			const importe = roundTo(0.01 + (seed % 20000) / 100, 2);

			const result = qtyFromImporte({ importe, rate, qtyPrecision: 1 });
			if (!result.ok) continue;
			expect(result.charged).toBeLessThanOrEqual(result.asked);
			expect(result.qty * rate).toBeLessThanOrEqual(result.asked + 1e-9);
			expect(roundTo(result.qty, 1)).toBe(result.qty);
		}
	});
});

describe("quantizing a measured qty", () => {
	it("keeps a weight the line can hold", () => {
		expect(quantizeQty(0.312, 3)).toEqual({
			ok: true,
			qty: 0.312,
			requested: 0.312,
			rounded: false,
		});
	});

	it("floors a gram-precise weight onto a two-decimal register", () => {
		// The doco mirror runs float_precision 2: a line saved as 0.312 comes
		// back 0.31, so the register must say 0.31 before it quotes a total.
		expect(quantizeQty(0.312, 2)).toEqual({
			ok: true,
			qty: 0.31,
			requested: 0.312,
			rounded: true,
		});
	});

	it("floors rather than rounds, so the shop absorbs the remainder", () => {
		expect(quantizeQty(0.319, 2)).toMatchObject({ qty: 0.31 });
		expect(quantizeQty(1.999, 0)).toMatchObject({ qty: 1 });
	});

	it("refuses a measurement too small for the register to hold", () => {
		expect(quantizeQty(0.004, 2)).toEqual({ ok: false, reason: "below_minimum_qty" });
		expect(quantizeQty(0.5, 0)).toEqual({ ok: false, reason: "below_minimum_qty" });
	});

	it("refuses an empty or nonsensical measurement", () => {
		expect(quantizeQty(0, 3)).toEqual({ ok: false, reason: "qty_not_positive" });
		expect(quantizeQty(-1, 3)).toEqual({ ok: false, reason: "qty_not_positive" });
		expect(quantizeQty(NaN, 3)).toEqual({ ok: false, reason: "qty_not_positive" });
	});

	it("clamps a nonsensical precision instead of trusting it", () => {
		expect(quantizeQty(0.312, 99)).toMatchObject({ qty: 0.312 });
		expect(quantizeQty(0.312, -1)).toEqual({ ok: false, reason: "below_minimum_qty" });
		expect(quantizeQty(1.5, NaN)).toMatchObject({ qty: 1.5 });
	});
});

describe("reading a sub-unit off the payload", () => {
	it("accepts a real conversion in either key spelling", () => {
		expect(readSubUnit({ uom: "Gram", perUnit: 1000 })).toEqual({ uom: "Gram", perUnit: 1000 });
		expect(readSubUnit({ uom: "Gram", per_unit: 1000 })).toEqual({ uom: "Gram", perUnit: 1000 });
		expect(readSubUnit({ uom: "Millilitre", per_unit: "1000" })).toEqual({
			uom: "Millilitre",
			perUnit: 1000,
		});
	});

	it("refuses a factor that is not actually smaller", () => {
		// 1 or less is the same unit or a LARGER one; offering it as a sub-unit
		// would multiply where it must divide.
		expect(readSubUnit({ uom: "Kg", perUnit: 1 })).toBeNull();
		expect(readSubUnit({ uom: "Tonne", perUnit: 0.001 })).toBeNull();
		expect(readSubUnit({ uom: "Gram", perUnit: -1000 })).toBeNull();
	});

	it("answers null for anything absent or malformed — no chip, today's entry", () => {
		expect(readSubUnit(null)).toBeNull();
		expect(readSubUnit(undefined)).toBeNull();
		expect(readSubUnit({})).toBeNull();
		expect(readSubUnit({ uom: "Gram" })).toBeNull();
		expect(readSubUnit({ perUnit: 1000 })).toBeNull();
		expect(readSubUnit({ uom: "  ", perUnit: 1000 })).toBeNull();
		expect(readSubUnit({ uom: "Gram", perUnit: "many" })).toBeNull();
		expect(readSubUnit("Gram")).toBeNull();
	});
});

describe("typing in grams", () => {
	const GRAM = { uom: "Gram", perUnit: 1000 };
	const ML = { uom: "Millilitre", perUnit: 1000 };
	const CM = { uom: "Centimeter", perUnit: 100 };

	it("is the cashier's 475 g on a three-decimal register", () => {
		expect(qtyFromSubUnit({ value: 475, subUnit: GRAM })).toEqual({
			ok: true,
			qty: 0.475,
			entered: 475,
			subUnit: GRAM,
			rounded: false,
		});
	});

	it("converts millilitres and centimetres by their own factors", () => {
		expect(qtyFromSubUnit({ value: 250, subUnit: ML })).toMatchObject({ qty: 0.25 });
		expect(qtyFromSubUnit({ value: 45, subUnit: CM })).toMatchObject({ qty: 0.45 });
	});

	it("floors onto a register that keeps two decimals, and says it rounded", () => {
		expect(qtyFromSubUnit({ value: 475, subUnit: GRAM, qtyPrecision: 2 })).toEqual({
			ok: true,
			qty: 0.47,
			entered: 475,
			subUnit: GRAM,
			rounded: true,
		});
	});

	it("converts BEFORE it floors", () => {
		// Flooring in grams first would quantize against the wrong grid: 1 g is
		// already below a two-decimal kilo, so the line would take 0.00 rather
		// than refuse.
		expect(qtyFromSubUnit({ value: 1, subUnit: GRAM, qtyPrecision: 2 })).toEqual({
			ok: false,
			reason: "below_minimum_qty",
		});
		expect(qtyFromSubUnit({ value: 1, subUnit: GRAM, qtyPrecision: 3 })).toMatchObject({
			qty: 0.001,
		});
	});

	it("refuses an empty or nonsensical entry", () => {
		expect(qtyFromSubUnit({ value: 0, subUnit: GRAM })).toEqual({
			ok: false,
			reason: "qty_not_positive",
		});
		expect(qtyFromSubUnit({ value: -475, subUnit: GRAM })).toEqual({
			ok: false,
			reason: "qty_not_positive",
		});
		expect(qtyFromSubUnit({ value: NaN, subUnit: GRAM })).toEqual({
			ok: false,
			reason: "qty_not_positive",
		});
	});

	it("refuses when the sub-unit itself is not usable", () => {
		expect(qtyFromSubUnit({ value: 475, subUnit: { uom: "", perUnit: 1000 } })).toEqual({
			ok: false,
			reason: "qty_not_positive",
		});
	});

	it("shows a pricing-unit quantity back in sub-units without binary noise", () => {
		expect(toSubUnit(0.475, GRAM)).toBe(475);
		expect(toSubUnit(0.3, GRAM)).toBe(300);
		expect(toSubUnit(1.245, GRAM)).toBe(1245);
		expect(toSubUnit(0.25, ML)).toBe(250);
	});
});

/**
 * The sub-unit path is a second door onto the same line, so it is swept the
 * same way the importe path is: whatever the cashier types in grams, the line
 * must never end up holding MORE product than was entered.
 */
describe("typing in grams, swept", () => {
	const nextSeed = (seed: number) => (seed * 1103515245 + 12345) % 2147483648;
	const FACTORS = [
		{ uom: "Gram", perUnit: 1000 },
		{ uom: "Millilitre", perUnit: 1000 },
		{ uom: "Centimeter", perUnit: 100 },
	];

	it("never converts to more product than was typed", () => {
		let seed = 4711;
		let refused = 0;
		let accepted = 0;

		for (const subUnit of FACTORS) {
			for (const precision of [0, 1, 2, 3, 4]) {
				for (let iteration = 0; iteration < 1200; iteration += 1) {
					seed = nextSeed(seed);
					// Whole sub-units up to 5 kg, the way a scale reads.
					const value = 1 + (seed % 5000);
					const result = qtyFromSubUnit({ value, subUnit, qtyPrecision: precision });

					if (!result.ok) {
						expect(result.reason).toBe("below_minimum_qty");
						expect(value / subUnit.perUnit).toBeLessThan(Math.pow(10, -precision));
						refused += 1;
						continue;
					}
					accepted += 1;
					// 1. Never more product than the cashier typed.
					expect(result.qty).toBeLessThanOrEqual(value / subUnit.perUnit + 1e-9);
					// 2. Representable at the line's precision.
					expect(roundTo(result.qty, precision)).toBe(result.qty);
					// 3. Tight: one more step would exceed what was typed.
					const step = Math.pow(10, -precision);
					expect(result.qty + step).toBeGreaterThan(value / subUnit.perUnit - 1e-9);
					// 4. `rounded` tells the truth, so the readout can too.
					expect(result.rounded).toBe(result.qty !== value / subUnit.perUnit);
				}
			}
		}
		expect(accepted).toBeGreaterThan(0);
		expect(refused).toBeGreaterThan(0);
	});

	it("leaves the importe rule untouched when the same line is priced from it", () => {
		// Grams change the ENTRY, never the money rule. A qty arrived at through
		// grams and then priced must obey exactly the two invariants the importe
		// path does.
		let seed = 8191;
		for (let iteration = 0; iteration < 4000; iteration += 1) {
			seed = nextSeed(seed);
			const rate = roundTo(0.5 + (seed % 40000) / 100, 2);
			seed = nextSeed(seed);
			const importe = roundTo(1 + (seed % 20000) / 100, 2);

			const derived = qtyFromImporte({ importe, rate });
			if (!derived.ok) continue;
			expect(derived.charged).toBeLessThanOrEqual(derived.asked);
			expect(derived.qty * rate).toBeLessThanOrEqual(derived.asked + 1e-9);

			// And the same quantity expressed in grams round-trips to itself.
			const grams = toSubUnit(derived.qty, { uom: "Gram", perUnit: 1000 });
			const back = qtyFromSubUnit({
				value: grams,
				subUnit: { uom: "Gram", perUnit: 1000 },
				qtyPrecision: 3,
			});
			if (back.ok) expect(back.qty).toBe(derived.qty);
		}
	});
});

describe("tara", () => {
	it("is the golden flow's 0.495 bruto on a 0.020 tray", () => {
		const result = netFromTara({ bruto: 0.495, tara: 0.02 });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.neto).toBe(0.475);
		expect(result.bruto).toBe(0.495);
		expect(result.tara).toBe(0.02);
	});

	it("passes the gross through when the scale was already tared", () => {
		expect(netFromTara({ bruto: 1.245 })).toEqual({ ok: true, neto: 1.245, bruto: 1.245, tara: 0 });
		expect(netFromTara({ bruto: 1.245, tara: 0 })).toEqual({
			ok: true,
			neto: 1.245,
			bruto: 1.245,
			tara: 0,
		});
	});

	it("refuses a tara heavier than the gross instead of clamping it", () => {
		expect(netFromTara({ bruto: 0.02, tara: 0.5 })).toEqual({
			ok: false,
			reason: "tara_exceeds_bruto",
		});
	});

	it("refuses an empty net — a zero-weight line is not a sale", () => {
		expect(netFromTara({ bruto: 0.02, tara: 0.02 })).toEqual({ ok: false, reason: "net_empty" });
	});

	it("refuses nonsense on either side", () => {
		expect(netFromTara({ bruto: 0 })).toEqual({ ok: false, reason: "bruto_not_positive" });
		expect(netFromTara({ bruto: -1, tara: 0 })).toEqual({ ok: false, reason: "bruto_not_positive" });
		expect(netFromTara({ bruto: NaN })).toEqual({ ok: false, reason: "bruto_not_positive" });
		expect(netFromTara({ bruto: 1, tara: -0.1 })).toEqual({ ok: false, reason: "tara_negative" });
		expect(netFromTara({ bruto: 1, tara: NaN })).toEqual({ ok: false, reason: "tara_negative" });
	});

	it("does not leak binary noise into the net weight", () => {
		const result = netFromTara({ bruto: 0.3, tara: 0.1 });
		if (!result.ok) throw new Error("expected a net");
		expect(result.neto).toBe(0.2);
	});

	it("rounds the net to the line's precision", () => {
		const result = netFromTara({ bruto: 1.2345, tara: 0.02 });
		if (!result.ok) throw new Error("expected a net");
		expect(result.neto).toBe(1.215);
	});
});
