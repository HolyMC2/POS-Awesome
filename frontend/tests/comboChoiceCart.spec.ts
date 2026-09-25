import { describe, expect, it, vi } from "vitest";

import {
	defaultSelection,
	addPick,
	normalizeChoiceCombo,
	tapPick,
	type ChoiceCombo,
} from "../src/posapp/composables/pos/combos/comboChoice";
import {
	addChoiceCombo,
	buildChoiceLines,
	removeChoiceChildren,
	replaceChoiceSelection,
	syncChoiceChildQty,
	type ChoiceCartDeps,
} from "../src/posapp/composables/pos/combos/comboChoiceCart";

const combo = normalizeChoiceCombo({
	kind: "choice",
	item_code: "PAQ",
	item_name: "Combo Desayuno",
	rate: 129,
	groups: [
		{ name: "Bebida", min: 1, max: 1, options: [
			{ item_code: "AMERICANO", item_name: "Americano", qty: 1, extra_price: 0, is_default: 1, rate: 35, uom: "Nos" },
			{ item_code: "LATTE", item_name: "Latte", qty: 1, extra_price: 10, rate: 55, uom: "Nos" },
		] },
		{ name: "Pan", min: 1, max: 2, options: [
			{ item_code: "CONCHA", item_name: "Concha", qty: 1, extra_price: 0, rate: 18, uom: "Nos", is_stock_item: 1, actual_qty: 9 },
		] },
		{ name: "Extras", min: 0, max: 1, options: [
			{ item_code: "TOCINO", item_name: "Tocino", qty: 2, extra_price: 15, rate: 8, uom: "Nos" },
		] },
	],
}) as ChoiceCombo;
const [bebida, , extras] = combo.groups as [any, any, any];

let seq = 0;
const deps = (): ChoiceCartDeps => ({
	// The register's getNewItem, reduced to what the builder relies on: a copy
	// with a fresh row id and the price fields it was given.
	getNewItem: (template: any) => ({ ...template, posa_row_id: `ROW-${++seq}` }),
	calcStockQty: (line: any, qty: number) => {
		line.stock_qty = qty * (Number(line.conversion_factor) || 1);
	},
	lookupItem: (code: string) => (code === "CONCHA" ? { item_code: "CONCHA", stock_uom: "Pza", item_group: "Panaderia" } : null),
});

const context = (extra: any = {}) => ({ pos_profile: { currency: "MXN", warehouse: "Cafe - C" }, ...extra });

// Pan has one option, so the default already holds one concha; the cashier
// swaps the coffee for a latte and adds bacon.
const selection = addPick(tapPick(defaultSelection(combo), bebida, "LATTE"), extras, "TOCINO");

describe("building the lines", () => {
	it("puts the paquete line first at its own price, then one pinned line per pick", () => {
		const [header, ...picks] = buildChoiceLines({ item_code: "PAQ", rate: 129, price_list_rate: 129 }, combo, { selection, qty: 1 }, context(), deps());
		expect(header).toMatchObject({ item_code: "PAQ", qty: 1, rate: 129, amount: 129, posa_combo_broken: 0, _needs_update: true });
		expect(header.posa_combo_components.map((c: any) => c.item_code)).toEqual(["LATTE", "CONCHA", "TOCINO"]);
		expect(picks.map((p) => [p.item_code, p.qty, p.rate, p.amount, p.posa_combo_group])).toEqual([
			["LATTE", 1, 10, 10, "Bebida"],
			["CONCHA", 1, 0, 0, "Pan"],
			// Two strips per pick at $15 the pick: $7.50 a strip.
			["TOCINO", 2, 7.5, 15, "Extras"],
		]);
		for (const pick of picks) {
			expect(pick).toMatchObject({
				posa_combo_parent: header.posa_row_id,
				locked_price: true,
				price_list_rate: pick.rate,
				discount_percentage: 0,
				discount_amount: 0,
				conversion_factor: 1,
			});
		}
	});

	it("counts picks in the stock UOM the catalogue row names", () => {
		const [, , concha] = buildChoiceLines({ item_code: "PAQ", rate: 129 }, combo, { selection, qty: 1 }, context(), deps());
		expect(concha).toMatchObject({ uom: "Pza", stock_uom: "Pza", item_group: "Panaderia", stock_qty: 1 });
	});

	it("scales every pick with the number of paquetes", () => {
		const [header, ...picks] = buildChoiceLines({ item_code: "PAQ", rate: 129 }, combo, { selection, qty: 3 }, context(), deps());
		expect(header.qty).toBe(3);
		expect(picks.map((p) => p.qty)).toEqual([3, 3, 6]);
		expect(picks.map((p) => p.amount)).toEqual([30, 0, 45]);
	});

	it("falls back to the published price for a bare {item_code} tap", () => {
		const [header] = buildChoiceLines({ item_code: "PAQ" }, combo, { selection, qty: 1 }, context(), deps());
		expect(header).toMatchObject({ rate: 129, price_list_rate: 129, item_name: "Combo Desayuno" });
	});

	it("converts company-currency extra charges into the invoice currency", () => {
		const usd = context({ selected_currency: "USD", conversion_rate: 20 });
		const [, latte] = buildChoiceLines({ item_code: "PAQ", rate: 6.45 }, combo, { selection, qty: 1 }, usd, deps());
		expect(latte).toMatchObject({ rate: 0.5, base_rate: 10, base_amount: 10, amount: 0.5 });
	});
});

describe("on the cart", () => {
	const store = () => {
		const items: any[] = [{ posa_row_id: "OLD", item_code: "CAFE", qty: 1, rate: 30 }];
		return {
			items,
			addItems: vi.fn((lines: any[], index: number) => {
				items.splice(index, 0, ...lines);
				return lines;
			}),
			removeItemByRowId: vi.fn((rowId: string) => {
				const at = items.findIndex((line) => line.posa_row_id === rowId);
				if (at >= 0) items.splice(at, 1);
			}),
			updateItemWithTotals: vi.fn((rowId: string, mutate: (line: any) => void) => {
				const line = items.find((row) => row.posa_row_id === rowId);
				if (line) mutate(line);
				return line;
			}),
		};
	};

	it("adds the paquete at the top, in one batch, and asks for the detail sync", () => {
		const invoiceStore = store();
		const flush = vi.fn();
		const header = addChoiceCombo({ item_code: "PAQ", rate: 129 }, combo, { selection, qty: 1 }, context({ invoiceStore, triggerBackgroundFlush: flush }), deps());
		expect(invoiceStore.addItems).toHaveBeenCalledTimes(1);
		expect(invoiceStore.items.map((line) => line.item_code)).toEqual(["PAQ", "LATTE", "CONCHA", "TOCINO", "CAFE"]);
		expect(header.item_code).toBe("PAQ");
		expect(flush).toHaveBeenCalled();
	});

	it("takes the picks off with their paquete line and leaves the rest", () => {
		const invoiceStore = store();
		const ctx = context({ invoiceStore });
		const header = addChoiceCombo({ item_code: "PAQ", rate: 129 }, combo, { selection, qty: 1 }, ctx, deps());
		expect(removeChoiceChildren(header, ctx)).toBe(3);
		expect(invoiceStore.items.map((line) => line.item_code)).toEqual(["PAQ", "CAFE"]);
	});

	it("re-picks in place: same paquete row, new picks right after it", () => {
		const invoiceStore = store();
		const ctx = context({ invoiceStore });
		const header = addChoiceCombo({ item_code: "PAQ", rate: 129 }, combo, { selection, qty: 1 }, ctx, deps());
		const simpler = defaultSelection(combo);
		replaceChoiceSelection(header, combo, { selection: simpler, qty: 2 }, ctx, deps());
		expect(invoiceStore.items.map((line) => [line.item_code, line.qty])).toEqual([
			["PAQ", 2],
			["AMERICANO", 2],
			["CONCHA", 2],
			["CAFE", 1],
		]);
		expect(invoiceStore.items[0].posa_row_id).toBe(header.posa_row_id);
		expect(invoiceStore.items[0].posa_combo_components.map((c: any) => c.item_code)).toEqual(["AMERICANO", "CONCHA"]);
	});
});

describe("keeping picks in step", () => {
	const cart = () => {
		const [header, ...picks] = buildChoiceLines({ item_code: "PAQ", rate: 129 }, combo, { selection, qty: 1 }, context(), deps());
		return [header, ...picks];
	};
	const updater = (items: any[]) => (rowId: string, mutate: (line: any) => void) => {
		const line = items.find((row) => row.posa_row_id === rowId);
		if (line) mutate(line);
	};

	it("follows the paquete line's quantity, amounts included", () => {
		const items = cart();
		items[0].qty = 2;
		expect(syncChoiceChildQty(items, updater(items))).toBe(3);
		expect(items.slice(1).map((line) => [line.qty, line.amount])).toEqual([[2, 20], [2, 0], [4, 30]]);
	});

	it("changes nothing on a cart already in step, so a watcher cannot loop", () => {
		const items = cart();
		const update = vi.fn(updater(items));
		expect(syncChoiceChildQty(items, update)).toBe(0);
		expect(update).not.toHaveBeenCalled();
	});

	it("mirrors the sign on a return", () => {
		const items = cart();
		items[0].qty = -1;
		syncChoiceChildQty(items, updater(items));
		expect(items.slice(1).map((line) => line.qty)).toEqual([-1, -1, -2]);
	});
});
