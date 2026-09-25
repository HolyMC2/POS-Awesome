import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: vi.fn() }),
}));
vi.mock("@saldo/useSaldoCapture", () => ({
	requireSaldoCapture: vi.fn(async () => null),
}));

import { useItemAddition } from "../src/posapp/composables/pos/items/useItemAddition";
import {
	choiceComboFor,
	requestComboChoice,
	resetComboChoiceState,
	setChoiceCombos,
	settleComboChoice,
	usePendingComboChoice,
} from "../src/posapp/composables/pos/combos/comboChoiceRequest";
import {
	addPick,
	defaultSelection,
	normalizeChoiceCombo,
	type ChoiceCombo,
} from "../src/posapp/composables/pos/combos/comboChoice";
import { comboFieldsForPayload } from "../src/posapp/components/pos/invoice_utils/comboPersistence";
import { resolveSaleSummary } from "../src/posapp/components/pos/payments/saleSummary";
import { describeMobileSaleLines } from "../src/posapp/components/pos/mobile/sale/mobileSaleLines";

/**
 * The paquete's whole path through the register, at the seams a cashier's
 * tap actually crosses: the add path asks, the picker answers, the lines land,
 * the cart draws ONE row for them, the payload carries the pick fields, and
 * removing the paquete removes its picks.
 */

const RAW_PAQUETE = {
	kind: "choice",
	item_code: "PAQ",
	item_name: "Combo Desayuno",
	rate: 129,
	groups: [
		{ name: "Bebida", min: 1, max: 1, options: [
			{ item_code: "AMERICANO", item_name: "Americano", qty: 1, extra_price: 0, is_default: 1, rate: 35, uom: "Nos" },
			{ item_code: "LATTE", item_name: "Latte", qty: 1, extra_price: 10, rate: 55, uom: "Nos" },
		] },
		{ name: "Pan", min: 1, max: 1, options: [
			{ item_code: "CONCHA", item_name: "Concha", qty: 1, extra_price: 0, rate: 18, uom: "Nos" },
			{ item_code: "CUERNO", item_name: "Cuerno", qty: 1, extra_price: 0, rate: 22, uom: "Nos" },
		] },
	],
};
const paquete = normalizeChoiceCombo(RAW_PAQUETE) as ChoiceCombo;

const context = () => ({
	new_line: false,
	items: [] as any[],
	packed_items: [] as any[],
	expanded: [] as any[],
	pos_profile: { warehouse: "Cafe - C", currency: "MXN", posa_auto_set_batch: 0 },
	stock_settings: { allow_negative_stock: 1 },
	isReturnInvoice: false,
	makeid: (() => {
		let n = 0;
		return () => `ROW${++n}`;
	})(),
});

const catalogRow = { item_code: "PAQ", item_name: "Combo Desayuno", rate: 129, price_list_rate: 129, stock_uom: "Nos", uom: "Nos", is_stock_item: 0, qty: 1 };

/** Wait until the add path has asked, then answer like the sheet would. */
const answer = async (result: Parameters<typeof settleComboChoice>[0]) => {
	const pending = usePendingComboChoice();
	await vi.waitFor(() => expect(pending.value).not.toBeNull());
	settleComboChoice(result);
};

beforeEach(() => {
	(globalThis as any).__ = (text: string) => text;
	(globalThis as any).frappe = { call: vi.fn(async () => ({ message: [] })), datetime: { nowdate: () => "2026-09-25" } };
	setActivePinia(createPinia());
	resetComboChoiceState();
	setChoiceCombos([RAW_PAQUETE, { kind: "bundle", item_code: "COMBO-FIJO", components: [] }]);
});

afterEach(() => resetComboChoiceState());

describe("the request channel", () => {
	it("registers only paquetes, by the item they sell", () => {
		expect(choiceComboFor("PAQ")?.item_name).toBe("Combo Desayuno");
		expect(choiceComboFor("COMBO-FIJO")).toBeNull();
		expect(choiceComboFor("")).toBeNull();
	});

	it("a second request dismisses the first — the newest tap is the intent", async () => {
		const first = requestComboChoice(paquete);
		const second = requestComboChoice(paquete, { qty: 2 });
		await expect(first).resolves.toBeNull();
		expect(usePendingComboChoice().value?.qty).toBe(2);
		settleComboChoice(null);
		await expect(second).resolves.toBeNull();
	});
});

describe("the add path", () => {
	it("asks for the picks and lands the paquete line plus one line per pick", async () => {
		const api = useItemAddition();
		const ctx = context();
		const adding = api.addItem({ ...catalogRow }, ctx);
		const selection = addPick(addPick(defaultSelection(paquete), paquete.groups[0]!, "LATTE"), paquete.groups[1]!, "CUERNO");
		await answer({ selection, qty: 1 });
		const header = await adding;

		expect(ctx.items.map((line) => line.item_code)).toEqual(["PAQ", "LATTE", "CUERNO"]);
		expect(header.posa_row_id).toBe(ctx.items[0].posa_row_id);
		expect(ctx.items[1]).toMatchObject({ rate: 10, locked_price: true, posa_combo_parent: header.posa_row_id, posa_combo_group: "Bebida" });
		expect(ctx.items[2]).toMatchObject({ rate: 0, posa_combo_group: "Pan" });
	});

	it("adds nothing when the cashier closes the picker", async () => {
		const api = useItemAddition();
		const ctx = context();
		const adding = api.addItem({ ...catalogRow }, ctx);
		await answer(null);
		await expect(adding).resolves.toBeUndefined();
		expect(ctx.items).toEqual([]);
	});

	it("refuses a paquete on a Sales Order or Quotation — its picks could not name it there", async () => {
		const api = useItemAddition();
		for (const invoiceType of ["Order", "Quotation"]) {
			const ctx = { ...context(), invoiceType };
			await api.addItem({ ...catalogRow }, ctx);
			expect(usePendingComboChoice().value).toBeNull();
			expect(ctx.items).toEqual([]);
		}
	});

	it("a return keeps the ordinary path — nothing is re-sold", async () => {
		const api = useItemAddition();
		const ctx = { ...context(), isReturnInvoice: true };
		await api.addItem({ ...catalogRow, qty: -1 }, ctx);
		expect(usePendingComboChoice().value).toBeNull();
		expect(ctx.items.map((line) => line.item_code)).toEqual(["PAQ"]);
	});

	it("never merges a later plain coffee into a $0 pick, nor a paquete into another", async () => {
		const api = useItemAddition();
		const ctx = context();
		const adding = api.addItem({ ...catalogRow }, ctx);
		await answer({ selection: addPick(defaultSelection(paquete), paquete.groups[1]!, "CONCHA"), qty: 1 });
		await adding;

		await api.addItem({ item_code: "AMERICANO", item_name: "Americano", rate: 35, price_list_rate: 35, uom: "Nos", stock_uom: "Nos", qty: 1, is_stock_item: 0 }, ctx);
		const coffees = ctx.items.filter((line) => line.item_code === "AMERICANO");
		expect(coffees).toHaveLength(2);
		expect(coffees.map((line) => line.rate).sort()).toEqual([0, 35]);
	});

	it("removing the paquete line removes its picks", async () => {
		const api = useItemAddition();
		const ctx = context();
		const adding = api.addItem({ ...catalogRow }, ctx);
		await answer({ selection: addPick(defaultSelection(paquete), paquete.groups[1]!, "CONCHA"), qty: 1 });
		const header = await adding;
		ctx.items.push({ posa_row_id: "OTHER", item_code: "JUGO", qty: 1, rate: 30 });

		api.removeItem(ctx.items[0], ctx);
		expect(ctx.items.map((line) => line.item_code)).toEqual(["JUGO"]);
		expect(header.item_code).toBe("PAQ");
	});

	it("re-picks a paquete already on the ticket", async () => {
		const api = useItemAddition();
		const ctx = context();
		const adding = api.addItem({ ...catalogRow }, ctx);
		await answer({ selection: addPick(defaultSelection(paquete), paquete.groups[1]!, "CONCHA"), qty: 1 });
		await adding;

		const editing = api.editChoiceCombo(ctx.items[0], ctx);
		const pending = usePendingComboChoice();
		await vi.waitFor(() => expect(pending.value?.editing).toBe(true));
		// The sheet opens on what the line already carries.
		expect(pending.value?.selection).toEqual({ Bebida: { AMERICANO: 1 }, Pan: { CONCHA: 1 } });
		settleComboChoice({ selection: addPick(addPick(defaultSelection(paquete), paquete.groups[0]!, "LATTE"), paquete.groups[1]!, "CUERNO"), qty: 1 });
		await expect(editing).resolves.toBe(true);
		expect(ctx.items.map((line) => line.item_code)).toEqual(["PAQ", "LATTE", "CUERNO"]);
	});
});

describe("what the cart and the server see", () => {
	const cart = () => [
		{ posa_row_id: "H1", item_code: "PAQ", item_name: "Combo Desayuno", qty: 1, rate: 129, amount: 129,
			posa_combo_components: [
				{ item_code: "LATTE", item_name: "Latte", qty: 1, rate: 55, extra_price: 10, group: "Bebida" },
				{ item_code: "CONCHA", item_name: "Concha", qty: 1, rate: 18, extra_price: 0, group: "Pan" },
			] },
		{ posa_row_id: "P1", item_code: "LATTE", item_name: "Latte", qty: 1, rate: 10, amount: 10, posa_combo_parent: "H1", posa_combo_group: "Bebida" },
		{ posa_row_id: "P2", item_code: "CONCHA", item_name: "Concha", qty: 1, rate: 0, amount: 0, posa_combo_parent: "H1", posa_combo_group: "Pan" },
		{ posa_row_id: "X1", item_code: "JUGO", item_name: "Jugo", qty: 2, rate: 30, amount: 60 },
	];

	it("the summary draws one row per paquete, with its extra charges in the amount", () => {
		const summary = resolveSaleSummary(cart());
		expect(summary.lines.map((line) => [line.itemCode, line.amount, line.isPaquete])).toEqual([
			["PAQ", 139, true],
			["JUGO", 60, false],
		]);
		expect(summary.lineCount).toBe(2);
		expect(summary.pieceCount).toBe(3);
	});

	it("the phone's cart pairs stock and row ids with the folded rows", () => {
		const lines = describeMobileSaleLines(cart()).lines;
		expect(lines.map((line) => line.rowId)).toEqual(["H1", "X1"]);
	});

	it("every line carries the pick fields to the server, null where they do not apply", () => {
		const [header, latte] = cart();
		expect(comboFieldsForPayload(latte)).toMatchObject({ posa_combo_parent: "H1", posa_combo_group: "Bebida" });
		expect(comboFieldsForPayload(header)).toMatchObject({ posa_combo_parent: null, posa_combo_group: null });
		expect(JSON.parse(String(comboFieldsForPayload(header).posa_combo_components))[0]).toMatchObject({ group: "Bebida", extra_price: 10 });
	});
});
