import { describe, expect, it } from "vitest";

import {
	addPick,
	canPickMore,
	comboChildrenOf,
	defaultSelection,
	describeSelection,
	firstIncompleteGroup,
	foldComboChildren,
	groupStatus,
	isChoiceCombo,
	isChoiceHeaderLine,
	isComboChildLine,
	isFixedGroup,
	isOptionSoldOut,
	isSelectionComplete,
	normalizeChoiceCombo,
	normalizeChoiceGroups,
	removePick,
	selectionComponents,
	selectionExtras,
	selectionFromComponents,
	selectionListValue,
	selectionSaving,
	selectionUnitPrice,
	tapPick,
	type ChoiceCombo,
} from "../src/posapp/composables/pos/combos/comboChoice";

/** The cafetería's «Combo Desayuno», as `get_combos` publishes it. */
const RAW = {
	kind: "choice",
	item_code: "CAFE-PAQ-DESAYUNO",
	item_name: "Combo Desayuno",
	rate: "129",
	image: "/files/desayuno.jpg",
	groups: [
		{
			name: "Bebida",
			min: 1,
			max: 1,
			options: [
				{ item_code: "AMERICANO", item_name: "Americano", qty: 1, extra_price: 0, is_default: 1, rate: 35, is_stock_item: 0, actual_qty: null },
				{ item_code: "LATTE", item_name: "Latte", qty: 1, extra_price: 10, is_default: 0, rate: 55, is_stock_item: 0, actual_qty: null },
				{ item_code: "JUGO", item_name: "Jugo embotellado", qty: 1, extra_price: 0, is_default: 0, rate: 30, is_stock_item: 1, actual_qty: 2 },
			],
		},
		{
			name: "Pan",
			min: 1,
			max: 2,
			options: [
				{ item_code: "CONCHA", item_name: "Concha", qty: 1, extra_price: 0, rate: 18, is_stock_item: 1, actual_qty: 10 },
				{ item_code: "CUERNO", item_name: "Cuerno", qty: 1, extra_price: 0, rate: 22, is_stock_item: 1, actual_qty: 0 },
			],
		},
		{
			name: "Incluye",
			min: 1,
			max: 1,
			options: [{ item_code: "MOLLETES", item_name: "Molletes", qty: 1, extra_price: 0, rate: 60 }],
		},
	],
};

const combo = normalizeChoiceCombo(RAW) as ChoiceCombo;
const [bebida, pan, incluye] = combo.groups as [any, any, any];

describe("the offer", () => {
	it("normalises a paquete and refuses what is not one", () => {
		expect(combo.rate).toBe(129);
		expect(combo.groups.map((g) => g.name)).toEqual(["Bebida", "Pan", "Incluye"]);
		expect(isChoiceCombo(RAW)).toBe(true);
		expect(normalizeChoiceCombo({ ...RAW, kind: "bundle" })).toBeNull();
		expect(normalizeChoiceCombo({ ...RAW, groups: [] })).toBeNull();
	});

	it("keeps an unknown stock figure unknown — never zero", () => {
		expect(bebida.options[0].actual_qty).toBeNull();
		expect(pan.options[1].actual_qty).toBe(0);
	});

	it("drops malformed groups rather than wedging the picker", () => {
		const groups = normalizeChoiceGroups([
			{ name: "", min: 1, max: 1, options: [{ item_code: "X" }] },
			{ name: "Sin opciones", min: 1, max: 1, options: [] },
			{ name: "Max cero", min: 0, max: 0, options: [{ item_code: "X" }] },
			{ name: "Min sobre max", min: 5, max: 2, options: [{ item_code: "X" }] },
		]);
		expect(groups).toEqual([
			expect.objectContaining({ name: "Min sobre max", min: 2, max: 2 }),
		]);
	});
});

describe("selection rules", () => {
	it("opens with defaults and the included items picked", () => {
		const selection = defaultSelection(combo);
		expect(selection).toEqual({ Bebida: { AMERICANO: 1 }, Pan: {}, Incluye: { MOLLETES: 1 } });
		expect(isFixedGroup(incluye)).toBe(true);
		expect(isFixedGroup(bebida)).toBe(false);
	});

	it("is not complete until every required group is answered", () => {
		const selection = defaultSelection(combo);
		expect(isSelectionComplete(combo, selection)).toBe(false);
		expect(firstIncompleteGroup(combo, selection)?.name).toBe("Pan");
		const done = addPick(selection, pan, "CONCHA");
		expect(isSelectionComplete(combo, done)).toBe(true);
	});

	it("a single-pick group behaves like a radio: the new pick replaces the old", () => {
		const selection = tapPick(defaultSelection(combo), bebida, "LATTE");
		expect(selection.Bebida).toEqual({ LATTE: 1 });
	});

	it("tapping the chosen option of a required single group keeps it", () => {
		const selection = tapPick(defaultSelection(combo), bebida, "AMERICANO");
		expect(selection.Bebida).toEqual({ AMERICANO: 1 });
	});

	it("an optional single group can be cleared by tapping its pick again", () => {
		const optional = { ...bebida, min: 0 };
		const selection = tapPick({ Bebida: { AMERICANO: 1 } }, optional, "AMERICANO");
		expect(selection.Bebida).toEqual({});
	});

	it("a multi-pick group counts repeats and refuses past its maximum", () => {
		let selection = addPick({}, pan, "CONCHA");
		selection = addPick(selection, pan, "CONCHA");
		expect(groupStatus(selection, pan)).toMatchObject({ picked: 2, full: true, satisfied: true });
		expect(addPick(selection, pan, "CUERNO")).toBe(selection);
		selection = removePick(selection, pan, "CONCHA");
		expect(selection.Pan).toEqual({ CONCHA: 1 });
	});

	it("never moves an included group or picks an item the group does not offer", () => {
		const selection = defaultSelection(combo);
		expect(removePick(selection, incluye, "MOLLETES")).toBe(selection);
		expect(addPick(selection, pan, "DONA")).toBe(selection);
	});
});

describe("availability", () => {
	it("only a register that blocks overselling refuses a short stock pick", () => {
		const jugo = bebida.options[2];
		expect(canPickMore(jugo, 0, {})).toBe(true);
		expect(canPickMore(jugo, 1, { blockSaleBeyondAvailable: true })).toBe(true);
		expect(canPickMore(jugo, 2, { blockSaleBeyondAvailable: true })).toBe(false);
		// Two paquetes need two juices per pick.
		expect(canPickMore(jugo, 1, { blockSaleBeyondAvailable: true, comboQty: 2 })).toBe(false);
	});

	it("a service and an unknown figure are never sold out", () => {
		expect(isOptionSoldOut(bebida.options[0], { blockSaleBeyondAvailable: true })).toBe(false);
		expect(isOptionSoldOut(pan.options[1], { blockSaleBeyondAvailable: true })).toBe(true);
	});
});

describe("arithmetic", () => {
	const selection = addPick(tapPick(defaultSelection(combo), bebida, "LATTE"), pan, "CONCHA");

	it("prices one paquete as its price plus the picks' extra charges", () => {
		expect(selectionExtras(combo, selection)).toBe(10);
		expect(selectionUnitPrice(combo, selection)).toBe(139);
	});

	it("measures the saving against what the picks cost one by one", () => {
		// Latte 55 + Concha 18 + Molletes 60 = 133 < 139: no saving to claim.
		expect(selectionListValue(combo, selection)).toBe(133);
		expect(selectionSaving(combo, selection)).toBe(0);
		const two = addPick(selection, pan, "CONCHA");
		expect(selectionListValue(combo, two)).toBe(151);
		expect(selectionSaving(combo, two)).toBe(12);
	});

	it("lists the picks for the cart row in group order, extras per paquete", () => {
		expect(selectionComponents(combo, selection)).toEqual([
			expect.objectContaining({ item_code: "LATTE", qty: 1, rate: 55, extra_price: 10, group: "Bebida" }),
			expect.objectContaining({ item_code: "CONCHA", qty: 1, rate: 18, extra_price: 0, group: "Pan" }),
			expect.objectContaining({ item_code: "MOLLETES", qty: 1, rate: 60, extra_price: 0, group: "Incluye" }),
		]);
		expect(describeSelection(combo, addPick(selection, pan, "CONCHA"))).toBe("Latte · 2 × Concha · Molletes");
	});

	it("rebuilds the selection from a paquete line's components (the edit)", () => {
		const components = selectionComponents(combo, addPick(selection, pan, "CONCHA"));
		expect(selectionFromComponents(combo, components)).toEqual({
			Bebida: { LATTE: 1 },
			Pan: { CONCHA: 2 },
			Incluye: { MOLLETES: 1 },
		});
	});
});

describe("the paquete on the cart", () => {
	const header = { posa_row_id: "H1", item_code: "CAFE-PAQ-DESAYUNO", qty: 1, rate: 129, amount: 129,
		posa_combo_components: [{ item_code: "LATTE", group: "Bebida", qty: 1 }] };
	const latte = { posa_row_id: "P1", item_code: "LATTE", qty: 1, rate: 10, amount: 10, posa_combo_parent: "H1" };
	const concha = { posa_row_id: "P2", item_code: "CONCHA", qty: 1, rate: 0, amount: 0, posa_combo_parent: "H1" };
	const plain = { posa_row_id: "X1", item_code: "CAFE", qty: 2, rate: 30 };

	it("folds picks into their paquete line and keeps its amount", () => {
		const folded = foldComboChildren([header, latte, concha, plain]);
		expect(folded.visible).toEqual([header, plain]);
		expect(folded.childAmountByParent.get("H1")).toBe(10);
		expect(folded.childCountByParent.get("H1")).toBe(2);
	});

	it("keeps a pick visible when its paquete line is not in the list", () => {
		const orphan = { ...latte, posa_combo_parent: "GONE" };
		expect(foldComboChildren([orphan, plain]).visible).toEqual([orphan, plain]);
	});

	it("names picks and paquete lines", () => {
		expect(isComboChildLine(latte)).toBe(true);
		expect(isComboChildLine(plain)).toBe(false);
		expect(comboChildrenOf([header, latte, plain, concha], header)).toEqual([latte, concha]);
		expect(isChoiceHeaderLine(header)).toBe(true);
		// A bundle's components carry no group: it stays a bundle line.
		expect(isChoiceHeaderLine({ posa_combo_components: [{ item_code: "MICA" }] })).toBe(false);
	});
});
