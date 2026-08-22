import { describe, expect, it, beforeEach } from "vitest";

import {
	comboQtyCeiling,
	resetAvailabilityProbe,
	readAvailabilityProbe,
} from "../src/posapp/composables/pos/combos/comboAvailability";
import type { ComboAvailabilityComponent } from "../src/posapp/composables/pos/combos/comboAvailability";
import {
	attachComboComponents,
	normalizeComboComponent,
	COMBO_COMPONENTS_FIELD,
} from "../src/posapp/composables/pos/items/comboLineAttachment";

/**
 * Short stock on a combo obeys the register's EXISTING setting.
 *
 * The owner's instruction was "this already is a setting on pos profile,
 * extend it as recommended" — so there is no combo-specific toggle here, and
 * no hardcoded block-or-warn. `posa_block_sale_beyond_available_qty` (Check,
 * default 1) is the same field `invoice_utils/stock.ts` reads to clamp a plain
 * line, and a combo is not a special case.
 *
 * `invoice_utils/stock.ts` computes `allowNegativeStock = !blockSale && (…)`,
 * so on the blocking branch it is false by construction. There is no
 * allow-negative escape to re-check on this path, which is why none appears
 * below.
 */

const SHORT: ComboAvailabilityComponent[] = [
	{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 2, is_stock_item: 1 },
	{ item_code: "MICA", item_name: "Mica Cristal", qty: 1, rate: 80, actual_qty: 9, is_stock_item: 1 },
	{ item_code: "SRV", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0, is_stock_item: 0 },
];

const blocking = { posProfile: { posa_block_sale_beyond_available_qty: 1 } };
const warning = { posProfile: { posa_block_sale_beyond_available_qty: 0 } };

beforeEach(() => resetAvailabilityProbe());

describe("the ceiling follows posa_block_sale_beyond_available_qty", () => {
	it("caps the line at what the shelves cover when the register blocks", () => {
		expect(comboQtyCeiling(SHORT, blocking)).toBe(2);
	});

	it("imposes no ceiling when the register chose warn-and-sell", () => {
		// null means "no ceiling", which is what lets the cashier keep selling
		// — the same choice the shop already made for every plain line.
		expect(comboQtyCeiling(SHORT, warning)).toBeNull();
	});

	it("treats an absent profile as warn-and-sell rather than guessing", () => {
		expect(comboQtyCeiling(SHORT, {})).toBeNull();
	});

	it("reads the string form the doctype actually stores", () => {
		// Frappe Check fields arrive as "1"/"0" over the wire often enough that
		// a bare Boolean() would silently block on "0".
		expect(comboQtyCeiling(SHORT, { posProfile: { posa_block_sale_beyond_available_qty: "1" } })).toBe(2);
		expect(
			comboQtyCeiling(SHORT, { posProfile: { posa_block_sale_beyond_available_qty: "0" } }),
		).toBeNull();
	});

	it("honours the document-type escape hatch beside the profile field", () => {
		// Order and Quotation flows disable blocking through this, exactly as
		// `invoice_utils/stock.ts` accepts it beside the profile field.
		expect(comboQtyCeiling(SHORT, { blockSaleBeyondAvailableQty: 1 })).toBe(2);
	});

	it("returns a real zero rather than null when nothing can be sold", () => {
		const none: ComboAvailabilityComponent[] = [
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 0, is_stock_item: 1 },
		];
		expect(comboQtyCeiling(none, blocking)).toBe(0);
	});

	it("imposes no ceiling on an all-labour combo even when blocking", () => {
		const labour: ComboAvailabilityComponent[] = [
			{ item_code: "SRV", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0, is_stock_item: 0 },
		];
		expect(comboQtyCeiling(labour, blocking)).toBeNull();
	});

	it("imposes no ceiling when stock is unknown", () => {
		// Ignorance must not read as scarcity: capping at 0 here would refuse a
		// sale the shop can make, on no evidence at all.
		const unknown: ComboAvailabilityComponent[] = [
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, is_stock_item: 1 },
		];
		expect(comboQtyCeiling(unknown, blocking)).toBeNull();
	});
});

describe("the add path applies the answer without computing one", () => {
	const raw = [
		{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 2, is_stock_item: 1 },
		{ item_code: "SRV", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0, is_stock_item: 0 },
	];

	it("carries is_stock_item through normalisation", () => {
		// Dropping it here is what would resurrect the Instalación bug one
		// layer down, where it would look like an availability bug.
		expect(normalizeComboComponent(raw[0]).is_stock_item).toBe(1);
		expect(normalizeComboComponent(raw[1]).is_stock_item).toBe(0);
	});

	it("leaves is_stock_item undefined when the payload omits it", () => {
		expect(normalizeComboComponent({ item_code: "X", qty: 1 }).is_stock_item).toBeUndefined();
	});

	it("sets a max_qty on the line when the register blocks", () => {
		const line: any = { item_code: "COMBO-1", qty: 1 };
		attachComboComponents(line, raw, blocking);
		expect(line.max_qty).toBe(2);
	});

	it("leaves max_qty alone when the register chose warn-and-sell", () => {
		const line: any = { item_code: "COMBO-1", qty: 1 };
		attachComboComponents(line, raw, warning);
		expect(line.max_qty).toBeUndefined();
	});

	it("records the figure and the culprit for display, client-side only", () => {
		const line: any = { item_code: "COMBO-1", qty: 1 };
		attachComboComponents(line, raw, blocking);
		expect(line._combo_available).toBe(2);
		expect(line._combo_limited_by).toBe("Case negro");
		// Underscore-prefixed: these must never reach the document. Only the
		// two fixture fields persist.
		expect(Object.keys(line).filter((k) => k.startsWith("posa_combo"))).toEqual([
			"posa_combo_components",
			"posa_combo_broken",
		]);
	});

	it("still attaches the components it was called for", () => {
		const line: any = { item_code: "COMBO-1", qty: 1 };
		expect(attachComboComponents(line, raw, blocking)).toBe(true);
		expect(line[COMBO_COMPONENTS_FIELD]).toHaveLength(2);
	});

	it("asks through the choke point exactly once per attach", () => {
		// Once whether or not the register blocks: display and policy are two
		// uses of one answer. A count of 2 here would mean a surface started
		// asking the availability question on its own.
		const blocked: any = { item_code: "COMBO-1", qty: 1 };
		attachComboComponents(blocked, raw, blocking);
		expect(readAvailabilityProbe().calls).toBe(1);

		resetAvailabilityProbe();
		const warned: any = { item_code: "COMBO-2", qty: 1 };
		attachComboComponents(warned, raw, warning);
		expect(readAvailabilityProbe().calls).toBe(1);
	});
});
