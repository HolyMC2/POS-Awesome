/**
 * Quick-item money math (roadmap §17.2). Pure arithmetic a shopkeeper trusts
 * without re-checking, so it is pinned rather than eyeballed.
 */

import { describe, expect, it } from "vitest";

import {
	buildQuickItemPayload,
	marginFromSell,
	profitAmount,
	quickItemBlockers,
	roundMoney,
	sellFromMargin,
} from "../src/posapp/components/pos/items/itemPricing";

describe("margin is markup over cost", () => {
	it("computes the sell price a markup implies", () => {
		expect(sellFromMargin(10, 50)).toBe(15);
		expect(sellFromMargin(12.5, 30)).toBe(16.25);
	});

	it("computes the markup a sell price implies", () => {
		expect(marginFromSell(10, 15)).toBe(50);
		expect(marginFromSell(12.5, 16.25)).toBe(30);
	});

	it("round-trips to within the cent the price was rounded to", () => {
		// NOT exact, and that is honest: 37.90 at 22% is 46.238, and a price
		// tag cannot hold a third decimal. Reading the margin back off the
		// rounded 46.24 gives 22.01%. The UI must therefore never recompute
		// the field the operator is typing in — see the dialog's edit guard —
		// or a typed "22" would visibly jump to "22.01".
		const cost = 37.9;
		const sell = sellFromMargin(cost, 22)!;
		expect(sell).toBe(46.24);
		expect(marginFromSell(cost, sell)).toBeCloseTo(22, 1);
	});

	it("round-trips exactly when the price lands on a clean cent", () => {
		expect(marginFromSell(20, sellFromMargin(20, 35)!)).toBe(35);
	});

	it("refuses to invent a margin on a zero cost", () => {
		// Any price over a zero cost is an infinite gain; writing 0 into the
		// field would be a confident lie.
		expect(marginFromSell(0, 15)).toBeNull();
		expect(sellFromMargin(0, 50)).toBeNull();
		expect(marginFromSell(undefined, 15)).toBeNull();
	});

	it("keeps a below-cost sale visible instead of clamping it", () => {
		expect(marginFromSell(10, 8)).toBe(-20);
		expect(sellFromMargin(10, -20)).toBe(8);
	});

	it("reports profit in currency even when cost is zero", () => {
		expect(profitAmount(0, 15)).toBe(15);
		expect(profitAmount(10, 15)).toBe(5);
		expect(profitAmount(10, 8)).toBe(-2);
	});

	it("rounds money to the two decimals a price tag has", () => {
		expect(roundMoney(10.005)).toBe(10.01);
		expect(roundMoney(1 / 3)).toBe(0.33);
		expect(sellFromMargin(9.99, 33)).toBe(13.29);
	});

	it("survives strings from number inputs", () => {
		expect(sellFromMargin("10", "50")).toBe(15);
		expect(marginFromSell("10", "15")).toBe(50);
		expect(sellFromMargin("", 50)).toBeNull();
	});
});

describe("blockers are caught before the server throws", () => {
	const ok = {
		item_code: "TORT",
		item_name: "Tortilla",
		item_group: "Alimentos",
		stock_uom: "Kg",
	};

	it("passes a complete draft with no stock", () => {
		expect(quickItemBlockers(ok)).toEqual([]);
	});

	it("names each missing required field", () => {
		expect(quickItemBlockers({})).toEqual([
			"item_code",
			"item_name",
			"item_group",
			"stock_uom",
		]);
	});

	it("opening stock without a cost is refused here, not by ERPNext", () => {
		// erpnext item.py: "Valuation Rate is mandatory if Opening Stock
		// entered" — a raw server throw is not an answer for a cashier.
		expect(
			quickItemBlockers({ ...ok, opening_stock: 5 }, { warehouse: "Main - X" }),
		).toContain("opening_needs_cost");
	});

	it("opening stock without a warehouse is refused", () => {
		expect(
			quickItemBlockers({ ...ok, opening_stock: 5, valuation_rate: 10 }, {}),
		).toContain("opening_needs_warehouse");
	});

	it("accepts opening stock when cost and warehouse are present", () => {
		expect(
			quickItemBlockers(
				{ ...ok, opening_stock: 5, valuation_rate: 10 },
				{ warehouse: "Main - X" },
			),
		).toEqual([]);
	});

	it("refuses negative opening stock", () => {
		expect(quickItemBlockers({ ...ok, opening_stock: -1 })).toContain("opening_negative");
	});
});

describe("payload only carries what was filled", () => {
	const base = {
		item_code: " TORT ",
		item_name: " Tortilla ",
		item_group: "Alimentos",
		stock_uom: "Kg",
		standard_rate: 25,
	};

	it("trims identity and rounds the price", () => {
		const doc = buildQuickItemPayload({ ...base, standard_rate: 25.006 }, {});
		expect(doc.item_code).toBe("TORT");
		expect(doc.item_name).toBe("Tortilla");
		expect(doc.standard_rate).toBe(25.01);
	});

	it("omits empty optionals rather than blanking ERPNext defaults", () => {
		const doc = buildQuickItemPayload({ ...base, description: "  ", barcode: "" }, {});
		expect(doc).not.toHaveProperty("description");
		expect(doc).not.toHaveProperty("barcode");
		expect(doc).not.toHaveProperty("valuation_rate");
		expect(doc).not.toHaveProperty("taxes");
		expect(doc).not.toHaveProperty("opening_stock");
	});

	it("carries the tax template as the child row ERPNext expects", () => {
		const doc = buildQuickItemPayload({ ...base, item_tax_template: "IVA 16%" }, {});
		expect(doc.taxes).toEqual([{ item_tax_template: "IVA 16%" }]);
	});

	it("pins the warehouse when opening stock is requested", () => {
		const doc = buildQuickItemPayload(
			{ ...base, opening_stock: 12, valuation_rate: 18 },
			{ company: "Grupo Doco", warehouse: "Tienda - GD" },
		);
		expect(doc.opening_stock).toBe(12);
		expect(doc.valuation_rate).toBe(18);
		expect(doc.item_defaults).toEqual([
			{ company: "Grupo Doco", default_warehouse: "Tienda - GD" },
		]);
	});

	it("never sends opening stock without the warehouse pin", () => {
		// Without item_defaults ERPNext guesses a warehouse; stock landing
		// somewhere the register cannot sell from reads as a broken item.
		const doc = buildQuickItemPayload(
			{ ...base, opening_stock: 12, valuation_rate: 18 },
			{},
		);
		expect(doc).not.toHaveProperty("item_defaults");
	});
});
