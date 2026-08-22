// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { update_qty_limits } from "../src/posapp/components/pos/invoice_utils/stock";
import {
	attachComboComponents,
	COMBO_COMPONENTS_FIELD,
} from "../src/posapp/composables/pos/items/comboLineAttachment";
import { resetAvailabilityProbe } from "../src/posapp/composables/pos/combos/comboAvailability";

/**
 * The combo ceiling has to survive the SECOND interaction.
 *
 * `expandBundle` sets `is_stock_item = 0` on a combo parent — correctly, since
 * the substrate decrements its components rather than it — and
 * `update_qty_limits` early-returns on exactly that, resetting
 * `max_qty = undefined`. So the clamp held on the initial add, where the
 * attach wrote `max_qty` directly, and was cleared by the next qty edit.
 *
 * That is the worst shape a stock bug can take: correct on the screen the
 * cashier checks, gone by the time they finish. These specs test the edit, not
 * the add.
 */

// The artboard's combo. Instalación is labour: `is_stock_item: 0`, so it never
// caps the combo no matter how little "stock" it reports.
const CASE = { item_code: "IPN001758", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 7, is_stock_item: 1 };
const MICA = { item_code: "IPN002611", item_name: "Mica Cristal", qty: 2, rate: 80, actual_qty: 9, is_stock_item: 1 };
const INSTALL = { item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0, is_stock_item: 0 };
const COMPONENTS = [CASE, MICA, INSTALL];

/** min over stock components of floor(free / per-combo) → min(7/1, 9/2) = 4. */
const EXPECTED_CEILING = 4;

const blockingProfile = { posa_block_sale_beyond_available_qty: 1 };
const permissiveProfile = { posa_block_sale_beyond_available_qty: 0 };

const addCombo = (posProfile: any) => {
	// Mirrors expandBundle: attach, then mark the parent non-stock.
	const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299, conversion_factor: 1 };
	attachComboComponents(line, COMPONENTS, { posProfile });
	line.is_stock_item = 0;
	line.warehouse = null;
	line.stock_qty = 0;
	return line;
};

beforeEach(() => {
	resetAvailabilityProbe();
	(globalThis as any).flt = (v: unknown) => {
		const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
		return Number.isFinite(n) ? n : 0;
	};
	(globalThis as any).__ = (s: string) => s;
});

describe("the combo ceiling survives the second interaction", () => {
	it("is applied on the initial add", () => {
		const line = addCombo(blockingProfile);
		expect(line.max_qty).toBe(EXPECTED_CEILING);
	});

	it("SURVIVES a quantity edit — the bug", () => {
		const line = addCombo(blockingProfile);
		line.qty = 3;
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(
			line.max_qty,
			"the non-stock early-return wiped the combo's ceiling on edit",
		).toBe(EXPECTED_CEILING);
	});

	it("survives repeated edits, not just the first", () => {
		const line = addCombo(blockingProfile);
		for (const qty of [2, 3, 4, 1]) {
			line.qty = qty;
			update_qty_limits({ pos_profile: blockingProfile }, line);
			expect(line.max_qty).toBe(EXPECTED_CEILING);
		}
	});

	it("survives a UOM change, clamping in the unit being typed", () => {
		const line = addCombo(blockingProfile);
		// A combo sold by a box of two: four combos is two boxes.
		line.conversion_factor = 2;
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.max_qty).toBe(EXPECTED_CEILING / 2);
	});

	it("keeps is_stock_item at 0 — packed items and the server read it", () => {
		const line = addCombo(blockingProfile);
		line.qty = 3;
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.is_stock_item).toBe(0);
	});

	it("disables increment once the ceiling is reached", () => {
		const line = addCombo(blockingProfile);
		line.qty = EXPECTED_CEILING;
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.disable_increment).toBe(true);
	});

	it("still allows increment below the ceiling", () => {
		const line = addCombo(blockingProfile);
		line.qty = 2;
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.disable_increment).toBe(false);
	});
});

describe("a register that chose warn-and-sell gets no combo ceiling", () => {
	it("has none on the add", () => {
		expect(addCombo(permissiveProfile).max_qty).toBeUndefined();
	});

	it("has none after an edit either", () => {
		const line = addCombo(permissiveProfile);
		line.qty = 99;
		update_qty_limits({ pos_profile: permissiveProfile }, line);
		expect(line.max_qty).toBeUndefined();
		expect(line.disable_increment).toBe(false);
	});

	it("does not block on the flag being absent entirely", () => {
		const line = addCombo({});
		line.qty = 50;
		update_qty_limits({ pos_profile: {} }, line);
		expect(line.max_qty).toBeUndefined();
	});
});

describe("ordinary lines are untouched by the combo branch", () => {
	it("a non-stock line still has its ceiling cleared", () => {
		// The original reasoning holds for everything that is not a combo: a row
		// hydrated without is_stock_item must not inherit max_qty = 0.
		const line: any = { item_code: "SRV-LABOUR", qty: 1, is_stock_item: 0, max_qty: 0 };
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.max_qty).toBeUndefined();
		expect(line.disable_increment).toBe(false);
	});

	it("a stock line still clamps from _base_actual_qty", () => {
		const line: any = {
			item_code: "IPN001758",
			qty: 1,
			is_stock_item: 1,
			_base_actual_qty: 7,
			conversion_factor: 1,
		};
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.max_qty).toBe(7);
	});

	it("an empty component list is not a combo", () => {
		const line: any = { item_code: "X", qty: 1, is_stock_item: 0, [COMBO_COMPONENTS_FIELD]: [] };
		update_qty_limits({ pos_profile: blockingProfile }, line);
		expect(line.max_qty).toBeUndefined();
	});
});
