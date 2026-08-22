import { describe, expect, it } from "vitest";

import {
	availabilityForLine,
	describeAvailability,
} from "../src/posapp/composables/pos/combos/comboAvailabilityDisplay";
import type { ComboComponent } from "../src/posapp/composables/pos/combos/comboPricing";

/**
 * Three ways to render something false, all ending in "no figure" for
 * different reasons. `reason` is asserted directly rather than inferred from
 * an empty string, so a guard that hides the number for the WRONG cause still
 * fails.
 */
describe("render no number: unbounded", () => {
	it("hides POSITIVE_INFINITY rather than printing Infinity", () => {
		const display = describeAvailability({
			available: Number.POSITIVE_INFINITY,
			limitedBy: null,
		});
		expect(display.show).toBe(false);
		expect(display.reason).toBe("unbounded");
		expect(display.value).toBeNull();
	});

	it("never lets an unbounded answer look low, so no tint appears", () => {
		const display = describeAvailability(
			{ available: Number.POSITIVE_INFINITY, limitedBy: null },
			{ lowStockThreshold: 10 },
		);
		expect(display.isLow).toBe(false);
	});
});

describe("render no number: unknown", () => {
	it("hides a null answer instead of showing 0", () => {
		const display = describeAvailability(null);
		expect(display.show).toBe(false);
		expect(display.reason).toBe("unknown");
		// The dangerous lie: 0 reads as out-of-stock on a combo the shop has.
		expect(display.value).not.toBe(0);
	});

	it("treats NaN as unknown, not as unbounded", () => {
		// NaN is also not finite; asking the narrower question first is what
		// stops a broken value being read as "no shelf limit".
		const display = describeAvailability({ available: Number.NaN, limitedBy: null });
		expect(display.reason).toBe("unknown");
		expect(display.show).toBe(false);
	});

	it("treats a non-numeric answer as unknown", () => {
		const display = describeAvailability({
			available: "12" as unknown as number,
			limitedBy: null,
		});
		expect(display.show).toBe(false);
		expect(display.reason).toBe("unknown");
	});
});

describe("a real zero is not one of the hidden cases", () => {
	it("shows 0, because the shelves genuinely cannot cover one combo", () => {
		const display = describeAvailability(
			{ available: 0, limitedBy: "Mica Cristal" },
			{ lowStockThreshold: 10 },
		);
		expect(display.show).toBe(true);
		expect(display.value).toBe(0);
		expect(display.isLow).toBe(true);
		expect(display.limitedBy).toBe("Mica Cristal");
	});
});

describe("low tint rides the register's own threshold", () => {
	it("marks at or below the threshold as low", () => {
		expect(describeAvailability({ available: 5, limitedBy: "A" }, { lowStockThreshold: 10 }).isLow).toBe(true);
		expect(describeAvailability({ available: 10, limitedBy: "A" }, { lowStockThreshold: 10 }).isLow).toBe(true);
		expect(describeAvailability({ available: 11, limitedBy: "A" }, { lowStockThreshold: 10 }).isLow).toBe(false);
	});

	it("a zero or absent threshold means never warn, not always warn", () => {
		expect(describeAvailability({ available: 1, limitedBy: "A" }, { lowStockThreshold: 0 }).isLow).toBe(false);
		expect(describeAvailability({ available: 1, limitedBy: "A" }).isLow).toBe(false);
	});
});

describe("where a line's figure comes from", () => {
	const components: ComboComponent[] = [
		{ item_code: "CASE", qty: 1, rate: 200, actual_qty: 4 },
		{ item_code: "MICA", qty: 1, rate: 80, actual_qty: 40 },
	];

	it("prefers the line's own _combo_available over recomputing", () => {
		const answer = availabilityForLine(
			{ _combo_available: 7, _combo_limited_by: "Case negro" },
			components,
		);
		expect(answer).toEqual({ available: 7, limitedBy: "Case negro" });
	});

	it("honours an explicit null as unknown rather than recomputing", () => {
		// The resolver ran and could not answer; recomputing would invent one.
		expect(availabilityForLine({ _combo_available: null }, components)).toBeNull();
	});

	it("recomputes only when the field was never set", () => {
		// A draft saved before combos shipped has components but no field.
		const answer = availabilityForLine({}, components);
		expect(answer?.available).toBe(4);
		expect(answer?.limitedBy).toBe("CASE");
	});

	it("reads the line without adding anything to it", () => {
		const line: Record<string, unknown> = { _combo_available: 3, _combo_limited_by: "Case" };
		const before = Object.keys(line).sort();
		availabilityForLine(line, components);
		expect(Object.keys(line).sort()).toEqual(before);
	});
});
