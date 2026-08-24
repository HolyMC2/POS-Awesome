import { describe, expect, it } from "vitest";

// Frappe exposes the translator as a bare global; the header builder
// calls it at module scope of every invocation.
(globalThis as unknown as { __: (_value: string) => string }).__ = (value: string) => value;

import {
	getItemsTableHeaders,
	getResponsiveItemsTableHeaders,
	isCompactCatalogWidth,
} from "../src/posapp/utils/itemsTableHeaders";

const posHeaders = () => getItemsTableHeaders("pos", { posa_display_item_code: 1 });

const keysAt = (width: number) =>
	getResponsiveItemsTableHeaders(posHeaders(), width).map((header) => header.key);

const widthSum = (width: number) =>
	getResponsiveItemsTableHeaders(posHeaders(), width).reduce(
		(total, header) => total + Number.parseFloat(String(header.width)),
		0,
	);

describe("catalog responsive columns", () => {
	it("keeps the full five-column layout on a desktop-width panel", () => {
		expect(keysAt(760)).toEqual(["item_name", "item_code", "rate", "actual_qty", "stock_uom"]);
	});

	it("drops UOM first when the panel narrows", () => {
		expect(keysAt(600)).toEqual(["item_name", "item_code", "rate", "actual_qty"]);
	});

	it("drops the item code next, keeping name, rate and stock", () => {
		expect(keysAt(430)).toEqual(["item_name", "rate", "actual_qty"]);
	});

	it("keeps only name and rate on the narrowest phones", () => {
		// A 360px phone with the panel padding removed: five columns here
		// left every cell at "Bocina Auricula…".
		expect(keysAt(330)).toEqual(["item_name", "rate"]);
	});

	it("refills the row after dropping columns instead of leaving grid gaps", () => {
		for (const width of [760, 600, 430, 330]) {
			expect(widthSum(width)).toBeCloseTo(100, 1);
		}
	});

	it("gives the item name a bigger share as columns fall away", () => {
		const nameWidth = (width: number) =>
			Number.parseFloat(
				String(
					getResponsiveItemsTableHeaders(posHeaders(), width).find(
						(header) => header.key === "item_name",
					)?.width,
				),
			);

		// 48% at full width — QTY and UOM are one short number/word each,
		// the name is the read target (owner direction 2026-08-24).
		expect(nameWidth(760)).toBe(48);
		expect(nameWidth(600)).toBeGreaterThan(nameWidth(760));
		expect(nameWidth(430)).toBeGreaterThan(nameWidth(600));
		expect(nameWidth(330)).toBeGreaterThan(nameWidth(430));
	});

	it("returns the headers untouched before the container has been measured", () => {
		// Mirrors the cart's `width > 0` guard: a zero width means "not
		// laid out yet", not "a zero-pixel panel".
		expect(keysAt(0)).toEqual(["item_name", "item_code", "rate", "actual_qty", "stock_uom"]);
	});

	it("respects the profile that already hides the item code", () => {
		// Tiers drop by key, so a profile that never shows the code just
		// arrives at each tier with one column fewer — never with a column
		// the profile disabled reappearing.
		const headers = getItemsTableHeaders("pos", { posa_display_item_code: 0 });

		expect(getResponsiveItemsTableHeaders(headers, 600).map((header) => header.key)).toEqual([
			"item_name",
			"rate",
			"actual_qty",
		]);
		expect(getResponsiveItemsTableHeaders(headers, 760).map((header) => header.key)).toEqual([
			"item_name",
			"rate",
			"actual_qty",
			"stock_uom",
		]);
	});

	it("narrows the purchase context down to item and buying price", () => {
		const headers = getItemsTableHeaders("purchase");

		expect(getResponsiveItemsTableHeaders(headers, 330).map((header) => header.key)).toEqual([
			"item_name",
			"rate",
		]);
	});

	it("leaves non-percentage widths alone rather than rescaling them", () => {
		const headers = [
			{ key: "item_name", title: "Name", width: "1fr" },
			{ key: "rate", title: "Rate", width: "1fr" },
			{ key: "stock_uom", title: "UOM", width: "1fr" },
		];

		expect(getResponsiveItemsTableHeaders(headers, 330)).toEqual([
			{ key: "item_name", title: "Name", width: "1fr" },
			{ key: "rate", title: "Rate", width: "1fr" },
		]);
	});

	it("handles an empty header set", () => {
		expect(getResponsiveItemsTableHeaders([], 330)).toEqual([]);
	});
});

describe("catalog compact padding", () => {
	it("runs tight cell padding on phone and narrow-panel widths", () => {
		expect(isCompactCatalogWidth(330)).toBe(true);
		expect(isCompactCatalogWidth(600)).toBe(true);
	});

	it("keeps the roomy desktop padding on a wide panel", () => {
		expect(isCompactCatalogWidth(760)).toBe(false);
	});

	it("is not compact before the container is measured", () => {
		expect(isCompactCatalogWidth(0)).toBe(false);
	});
});
