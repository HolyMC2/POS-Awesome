/**
 * The margin row is a claim about somebody's money made to somebody who may
 * not be allowed to hear it, so both halves are tested here: the gate and the
 * arithmetic.
 *
 * The gate cases are the ones worth reading first. `hidden` and `incomplete`
 * are not degraded versions of `ready` — they are the two answers that stop a
 * wrong number reaching the screen, and both of them were easier to get wrong
 * than the subtraction was.
 */

import { describe, it, expect } from "vitest";
import {
	lineCost,
	marginNeedsIntervention,
	resolveCartMargin,
	stockUnits,
} from "../src/posapp/components/pos/invoice/cartMargin";
import SummarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";

const line = (over: Record<string, unknown> = {}) => ({
	qty: 1,
	stock_qty: 1,
	conversion_factor: 1,
	valuation_rate: 10,
	...over,
});

describe("the role gate", () => {
	it("says nothing at all to a cashier who is not a supervisor", () => {
		const result = resolveCartMargin({
			lines: [line()],
			netRevenue: 100,
			isSupervisor: false,
		});
		expect(result.state).toBe("hidden");
		expect(result.cost).toBeNull();
		expect(result.margin).toBeNull();
	});

	it("treats an absent supervisor flag as not a supervisor", () => {
		expect(resolveCartMargin({ lines: [line()], netRevenue: 100 }).state).toBe("hidden");
	});

	it("hides the row on an empty cart rather than claiming a zero margin", () => {
		expect(resolveCartMargin({ lines: [], netRevenue: 0, isSupervisor: true }).state).toBe(
			"hidden",
		);
		expect(resolveCartMargin({ isSupervisor: true }).state).toBe("hidden");
	});
});

describe("partial cost data", () => {
	it("refuses a figure when any priced line has no cost", () => {
		const result = resolveCartMargin({
			lines: [line(), line({ valuation_rate: null })],
			netRevenue: 100,
			isSupervisor: true,
		});
		expect(result.state).toBe("incomplete");
		expect(result.cost).toBeNull();
		expect(result.margin).toBeNull();
	});

	it("counts a zero valuation as unknown, never as free", () => {
		// The direction matters: summing the costed lines alone would understate
		// cost and therefore overstate margin, which flatters the owner.
		expect(
			resolveCartMargin({
				lines: [line(), line({ valuation_rate: 0 })],
				netRevenue: 100,
				isSupervisor: true,
			}).state,
		).toBe("incomplete");
	});

	it("does not demand a cost for a line that moves no quantity", () => {
		const result = resolveCartMargin({
			lines: [line(), line({ qty: 0, stock_qty: 0, valuation_rate: null })],
			netRevenue: 100,
			isSupervisor: true,
		});
		expect(result.state).toBe("ready");
		expect(result.cost).toBe(10);
	});

	it("refuses a margin it cannot subtract from", () => {
		expect(
			resolveCartMargin({ lines: [line()], netRevenue: null, isSupervisor: true }).state,
		).toBe("incomplete");
		expect(
			resolveCartMargin({ lines: [line()], netRevenue: "n/a", isSupervisor: true }).state,
		).toBe("incomplete");
	});
});

describe("the arithmetic", () => {
	it("subtracts cost from NET revenue, not from the tax-inclusive total", () => {
		// `Main.dc.html`'s own figures. The artboard prints 457, which is
		// 1,129.00 − 672 — margin computed against a total that includes
		// $155.72 of IVA the shop collects for the SAT and never earned.
		const result = resolveCartMargin({
			lines: [line({ qty: 1, stock_qty: 1, valuation_rate: 672 })],
			netRevenue: 973.28,
			isSupervisor: true,
		});
		expect(result.state).toBe("ready");
		expect(result.cost).toBe(672);
		expect(result.margin).toBe(301.28);
		expect(result.margin).not.toBe(457);
	});

	it("prices cost against the stock unit, not the selling unit", () => {
		// A box of 12 at 8.50 a piece costs 102, not 8.50.
		const result = resolveCartMargin({
			lines: [line({ qty: 1, stock_qty: 12, conversion_factor: 12, valuation_rate: 8.5 })],
			netRevenue: 150,
			isSupervisor: true,
		});
		expect(result.cost).toBe(102);
		expect(result.margin).toBe(48);
	});

	it("converts with the factor when the line has no stock quantity yet", () => {
		expect(stockUnits({ qty: 2, conversion_factor: 6 })).toBe(12);
		expect(lineCost({ qty: 2, conversion_factor: 6, valuation_rate: 3 })).toBe(36);
	});

	it("falls back to a factor of one rather than to zero units", () => {
		expect(stockUnits({ qty: 3 })).toBe(3);
		expect(stockUnits({ qty: 3, conversion_factor: 0 })).toBe(3);
	});

	it("adds every line", () => {
		const result = resolveCartMargin({
			lines: [
				line({ qty: 2, stock_qty: 2, valuation_rate: 15 }),
				line({ qty: 3, stock_qty: 3, valuation_rate: 4 }),
				line({ qty: 1, stock_qty: 1, valuation_rate: 100 }),
			],
			netRevenue: 260,
			isSupervisor: true,
		});
		expect(result.cost).toBe(142);
		expect(result.margin).toBe(118);
	});

	it("rounds to money once, at the end", () => {
		const result = resolveCartMargin({
			lines: [
				line({ qty: 3, stock_qty: 3, valuation_rate: 1.005 }),
				line({ qty: 3, stock_qty: 3, valuation_rate: 1.005 }),
			],
			netRevenue: 10,
			isSupervisor: true,
		});
		expect(result.cost).toBe(6.03);
		expect(result.margin).toBe(3.97);
	});

	it("reverses on a return, where both halves are negative", () => {
		// A refunded ticket gives back the margin it earned; the figure staying
		// consistent with the sale it reverses is the point.
		const result = resolveCartMargin({
			lines: [line({ qty: -2, stock_qty: -2, valuation_rate: 20 })],
			netRevenue: -70,
			isSupervisor: true,
		});
		expect(result.cost).toBe(-40);
		expect(result.margin).toBe(-30);
	});

	it("survives a cart whose figures arrived as strings", () => {
		const result = resolveCartMargin({
			lines: [{ qty: "2", stock_qty: "2", valuation_rate: "12.5" }],
			netRevenue: "60",
			isSupervisor: true,
		});
		expect(result.cost).toBe(25);
		expect(result.margin).toBe(35);
	});

	it("ignores a null line instead of throwing on it", () => {
		const result = resolveCartMargin({
			lines: [line(), null as never],
			netRevenue: 50,
			isSupervisor: true,
		});
		// The null line moves nothing, so it costs nothing and blocks nothing.
		expect(result.state).toBe("ready");
		expect(result.cost).toBe(10);
	});
});

describe("when the register brings the figure up on its own", () => {
	// Owner rule (2026-08-31): «sales person doesnt need to know until it
	// need intervention». The strip is silent on a healthy ticket; it speaks
	// exactly when the ticket is priced below its own cost.
	const line = { qty: 1, stock_qty: 1, valuation_rate: 45 };

	it("stays silent while the ticket earns its cost back", () => {
		const healthy = resolveCartMargin({
			lines: [line],
			netRevenue: 172.41,
			isSupervisor: true,
		});
		expect(healthy.state).toBe("ready");
		expect(marginNeedsIntervention(healthy)).toBe(false);
	});

	it("speaks on a ticket priced below its own cost", () => {
		const belowCost = resolveCartMargin({
			lines: [line],
			netRevenue: 30,
			isSupervisor: true,
		});
		expect(belowCost.state).toBe("ready");
		expect(marginNeedsIntervention(belowCost)).toBe(true);
	});

	it("stays silent on what it cannot prove — hidden and incomplete alike", () => {
		expect(
			marginNeedsIntervention(
				resolveCartMargin({ lines: [line], netRevenue: 30, isSupervisor: false }),
			),
		).toBe(false);
		expect(
			marginNeedsIntervention(
				resolveCartMargin({
					lines: [{ qty: 1, valuation_rate: null }],
					netRevenue: 30,
					isSupervisor: true,
				}),
			),
		).toBe(false);
	});

	it("is the rule the summary actually applies", () => {
		// Source pin: the display computed must route through the ONE named
		// rule — a hand-rolled `state !== \"ready\"` check here would quietly
		// bring the always-on figure back.
		expect(SummarySource).toContain("if (!marginNeedsIntervention(resolved))");
		expect(SummarySource).toContain(
			'import { marginNeedsIntervention, resolveCartMargin } from "./cartMargin"',
		);
	});
});
