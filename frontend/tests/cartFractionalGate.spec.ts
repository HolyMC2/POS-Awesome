// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

/**
 * Who gets the weighing affordances, and — the part that matters more — who
 * keeps exactly the register they had yesterday.
 *
 * Venta fraccionada adds a pad to the quantity cell. Three populations must not
 * notice: a register without the `fractional` capability, a line whose UOM only
 * takes whole numbers, and any line whose eligibility is simply UNKNOWN because
 * the payload predates the fact. All three are pinned here, because "the phone
 * shop's cart is unchanged" is the claim this feature is most likely to break
 * silently.
 */
const capabilities = new Set<string>();

vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({
		has: (capability: string) => capabilities.has(capability),
		t: (key: string) => key,
	}),
}));

import CartItemRow from "../src/posapp/components/pos/invoice/CartItemRow.vue";

const COLUMNS = [
	{ key: "qty", align: "center" },
	{ key: "amount", align: "end" },
];

const KG_LINE = {
	item_code: "JAMON",
	item_name: "Jamón de pierna",
	qty: 1,
	rate: 160,
	uom: "Kg",
	must_be_whole_number: 0,
	posa_row_id: "row-1",
};

const PIECE_LINE = { ...KG_LINE, item_code: "CASE", item_name: "Case negro", uom: "Nos", must_be_whole_number: 1 };

const money = (value: any) => Number(value ?? 0).toFixed(2);
const float = (value: any, precision?: number) =>
	Number(value ?? 0).toFixed(precision === undefined ? 3 : precision);

beforeEach(() => {
	capabilities.clear();
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args?.length ? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m)) : text,
	);
});

const mountRow = (item: Record<string, any>, props: Record<string, any> = {}) =>
	mount(CartItemRow, {
		props: {
			item,
			visibleColumns: COLUMNS,
			posProfile: { posa_decimal_precision: 3 },
			displayCurrency: "MXN",
			formatFloat: float,
			formatCurrency: money,
			currencySymbol: () => "$",
			isNumber: () => true,
			isNegative: (value: any) => Number(value) < 0,
			hideQtyDecimals: false,
			isRTL: false,
			isExpanded: false,
			...props,
		},
		global: { plugins: [createVuetify()] },
		attachTo: document.body,
	});

const qtyCell = (wrapper: any) => wrapper.get('[data-pos-keyboard-target="cart-qty"]');

describe("a register that weighs", () => {
	beforeEach(() => capabilities.add("fractional"));

	it("marks an eligible line's quantity as weighable", () => {
		const wrapper = mountRow(KG_LINE);

		expect(qtyCell(wrapper).attributes("data-weighable")).toBe("true");
		expect(qtyCell(wrapper).attributes("aria-label")).toBe("Weigh or set amount");
	});

	it("opens the pad instead of the inline number field", async () => {
		const wrapper = mountRow(KG_LINE);
		await qtyCell(wrapper).trigger("click");

		expect(wrapper.find('[data-testid="fractional-qty-pad"]').exists()).toBe(true);
		expect(wrapper.find(".posa-cart-table__qty-input").exists()).toBe(false);
	});

	it("keeps the ± buttons — a whole kilo is still a legitimate gesture", () => {
		const wrapper = mountRow(KG_LINE);

		expect(wrapper.find(".posa-cart-table__qty-btn--minus").exists()).toBe(true);
		expect(wrapper.find(".posa-cart-table__qty-btn--plus").exists()).toBe(true);
	});

	it("does NOT offer it on a line sold by the piece", async () => {
		const wrapper = mountRow(PIECE_LINE);

		expect(qtyCell(wrapper).attributes("data-weighable")).toBeUndefined();
		expect(qtyCell(wrapper).attributes("aria-label")).toBe("Edit quantity");
		await qtyCell(wrapper).trigger("click");
		expect(wrapper.find('[data-testid="fractional-qty-pad"]').exists()).toBe(false);
		expect(wrapper.find(".posa-cart-table__qty-input").exists()).toBe(true);
	});

	it("does NOT offer it when the payload never carried the fact", async () => {
		// An offline row cached before `must_be_whole_number` shipped. Guessing
		// "eligible" here builds a cart the server refuses at save; guessing
		// "not" costs an affordance and nothing else.
		const wrapper = mountRow({ ...KG_LINE, must_be_whole_number: undefined });

		expect(qtyCell(wrapper).attributes("data-weighable")).toBeUndefined();
		await qtyCell(wrapper).trigger("click");
		expect(wrapper.find(".posa-cart-table__qty-input").exists()).toBe(true);
	});

	it("does NOT offer it on a returned free line, which has no editable qty", async () => {
		const wrapper = mountRow({ ...KG_LINE, is_free_item: 1 }, { isReturnInvoice: true });

		expect(qtyCell(wrapper).attributes("data-weighable")).toBeUndefined();
		await qtyCell(wrapper).trigger("click");
		expect(wrapper.find('[data-testid="fractional-qty-pad"]').exists()).toBe(false);
	});

	it('reads the Check field the way Frappe sends it, including the string "0"', () => {
		expect(qtyCell(mountRow({ ...KG_LINE, must_be_whole_number: "0" })).attributes("data-weighable")).toBe(
			"true",
		);
		expect(
			qtyCell(mountRow({ ...KG_LINE, must_be_whole_number: "1" })).attributes("data-weighable"),
		).toBeUndefined();
	});
});

describe("a register that does not weigh", () => {
	it("shows exactly today's quantity cell for a kilo item", async () => {
		// The capability is absent — a phone shop whose catalogue happens to
		// contain something sold by weight still gets the plain field.
		const wrapper = mountRow(KG_LINE);

		expect(qtyCell(wrapper).attributes("data-weighable")).toBeUndefined();
		expect(qtyCell(wrapper).attributes("aria-label")).toBe("Edit quantity");
		expect(wrapper.find('[data-testid="fractional-qty-pad"]').exists()).toBe(false);

		await qtyCell(wrapper).trigger("click");
		expect(wrapper.find(".posa-cart-table__qty-input").exists()).toBe(true);
	});

	it("never mounts the pad at all", () => {
		// Not merely hidden: `v-if` keeps it out of the tree, so a register
		// that does not weigh pays nothing for the feature.
		expect(mountRow(KG_LINE).find('[data-testid="fractional-qty-pad"]').exists()).toBe(false);
	});
});

describe("what the pad puts on the line", () => {
	beforeEach(() => capabilities.add("fractional"));

	it("emits a plain quantity through the SAME event a typed one uses", async () => {
		const onUpdateQty = vi.fn();
		const wrapper = mountRow(KG_LINE, { onUpdateQty });
		await qtyCell(wrapper).trigger("click");

		await wrapper.get('[data-testid="fracc-mode-importe"]').trigger("click");
		await wrapper.get('[data-testid="fracc-importe"]').setValue("50");
		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");

		expect(onUpdateQty).toHaveBeenCalledTimes(1);
		expect(onUpdateQty.mock.calls[0]?.[1]).toBe(0.312);
	});

	it("writes the weighing onto the line's note", async () => {
		const onUpdateLineNote = vi.fn();
		const wrapper = mountRow(KG_LINE, { onUpdateLineNote });
		await qtyCell(wrapper).trigger("click");

		await wrapper.get('[data-testid="fracc-gross"]').setValue("0.495");
		await wrapper.get('[data-testid="fracc-tara"]').setValue("0.020");
		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");

		expect(onUpdateLineNote.mock.calls[0]?.[1]).toBe("Weighed 0.475 Kg · gross 0.495 Kg · tare 0.020 Kg");
	});

	it("does not overwrite a note the line already carries", async () => {
		const onUpdateLineNote = vi.fn();
		const wrapper = mountRow({ ...KG_LINE, posa_notes: "sin grasa" }, { onUpdateLineNote });
		await qtyCell(wrapper).trigger("click");

		await wrapper.get('[data-testid="fracc-gross"]').setValue("0.495");
		await wrapper.get('[data-testid="fracc-tara"]').setValue("0.020");
		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");

		expect(onUpdateLineNote).not.toHaveBeenCalled();
	});
});
