// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import ItemsTableExpandedRow from "../src/posapp/components/pos/invoice/ItemsTableExpandedRow.vue";
import ItemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";
import SelectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

/**
 * The desk's cart-line detail, re-shaped (owner, 2026-09-05, with a screenshot
 * of the old form: «this is the view and selector that needs better ui/ux»).
 *
 * The serial / batch choice used to sit LAST, under three sections of greyed
 * inputs, as a `v-autocomplete` that could show a unit's number and nothing
 * else. It is now the FIRST card, and its one button rings the same lot
 * picker the catalogue tap and the phone's line sheet already open.
 */

const stubs = {
	"v-icon": { template: "<i />" },
	"v-btn": {
		props: ["disabled"],
		emits: ["click"],
		// The real v-btn forwards the MouseEvent; `@click.stop` needs one.
		template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
	},
	"v-text-field": { props: ["modelValue", "disabled"], template: '<input :disabled="disabled" />' },
	"v-select": { props: ["modelValue"], template: "<select />" },
	VueDatePicker: { template: "<input />" },
};

const noop = () => {};
const baseProps = {
	pos_profile: { currency: "MXN", posa_allow_user_to_edit_rate: 1 },
	hide_qty_decimals: false,
	formatFloat: (v: any) => String(Number(v) || 0),
	formatCurrency: (v: any) => `$${Number(v || 0).toFixed(2)}`,
	currencySymbol: () => "MX$",
	isNumber: () => true,
	setFormatedCurrency: noop,
	calcPrices: noop,
	calcUom: noop,
	changePriceListRate: noop,
	validateDueDate: noop,
};

const phone = (overrides: Record<string, any> = {}) => ({
	posa_row_id: "row-1",
	item_code: "IPN005381",
	item_name: "BLU G64L-Morado-128GB-4",
	qty: 1,
	rate: 2499,
	has_serial_no: 1,
	serial_no_selected: [],
	serial_no: null,
	warehouse: "Escuinapa, Hidalgo #1 DOCO - GD",
	...overrides,
});

// Emits are asserted through listener props: VTU's `emitted()` does not see
// `<script setup>` emits in this lane (see lotsSurface.spec.ts).
const onRequestClose = vi.fn();

const mountDetail = (item: Record<string, any>, bus: any = { emit: () => {} }) =>
	mount(ItemsTableExpandedRow, {
		props: { ...baseProps, item, onRequestClose } as any,
		global: { components: stubs, provide: { eventBus: bus } },
	});

beforeEach(() => onRequestClose.mockReset());

describe("ItemsTableExpandedRow — the unit comes first", () => {
	it("puts the serial card at the top, flagged while nothing is chosen", () => {
		const wrapper = mountDetail(phone());
		const sections = wrapper.findAll("section");
		expect(sections[0]!.attributes("data-testid")).toBe("line-detail-lots");
		expect(sections[0]!.attributes("data-state")).toBe("missing");
		expect(wrapper.get('[data-testid="line-detail-none"]').text()).toContain("No serial number chosen yet.");
		expect(wrapper.get('[data-testid="line-detail-pick"]').text()).toContain("Choose a serial number");
		expect(wrapper.get('[data-testid="line-detail-lots-state"]').text()).toBe("0 of 1 chosen");
	});

	it("shows the chosen IMEIs as chips and reads complete", () => {
		const wrapper = mountDetail(phone({ serial_no_selected: ["353150400443913"], serial_no: "353150400443913" }));
		expect(wrapper.get('[data-testid="line-detail-lots"]').attributes("data-state")).toBe("complete");
		expect(wrapper.get('[data-testid="line-detail-serials"]').text()).toContain("353150400443913");
		expect(wrapper.get('[data-testid="line-detail-pick"]').text()).toContain("Change serial numbers");
	});

	it("reads partial when the ticket asks for more units than were named", () => {
		const wrapper = mountDetail(phone({ qty: 2, serial_no_selected: ["353150400443913"] }));
		expect(wrapper.get('[data-testid="line-detail-lots"]').attributes("data-state")).toBe("partial");
		expect(wrapper.get('[data-testid="line-detail-lots-state"]').text()).toBe("1 of 2 chosen");
	});

	it("draws a batch line with its expiry and availability", () => {
		const wrapper = mountDetail(
			phone({ has_serial_no: 0, has_batch_no: 1, batch_no: "LOTE-A", batch_no_expiry_date: "2026-09-20", actual_batch_qty: 4 }),
		);
		const batch = wrapper.get('[data-testid="line-detail-batch"]');
		expect(batch.text()).toContain("LOTE-A");
		expect(batch.text()).toContain("2026-09-20");
		expect(batch.text()).toContain("4");
		expect(wrapper.get('[data-testid="line-detail-pick"]').text()).toContain("Change batch");
	});

	it("has no unit card for an ordinary item", () => {
		const wrapper = mountDetail(phone({ has_serial_no: 0, serial_no: null }));
		expect(wrapper.find('[data-testid="line-detail-lots"]').exists()).toBe(false);
	});
});

describe("ItemsTableExpandedRow — one picker, three doors", () => {
	it("rings the line sheet's edit-lots bell for this row and asks the dialog to step aside", async () => {
		const seen: Array<{ event: string; payload: any }> = [];
		const wrapper = mountDetail(phone(), { emit: (event: string, payload: any) => seen.push({ event, payload }) });
		await wrapper.get('[data-testid="line-detail-pick"]').trigger("click");
		expect(seen).toEqual([{ event: "movil:edit-lots", payload: { rowId: "row-1", itemCode: "IPN005381" } }]);
		expect(onRequestClose).toHaveBeenCalledTimes(1);
	});

	it("is wired: the table closes on request and the selector still answers the bell", () => {
		expect(ItemsTableSource).toContain('@request-close="detailDialogOpen = false"');
		expect(ItemsTableSource).not.toContain(":get-serial-options=");
		expect(SelectorSource).toContain('eventBus.on("movil:edit-lots", movilEditLots);');
	});

	it("locks the quantity to the count once serials are named", () => {
		const wrapper = mountDetail(phone({ serial_no_selected: ["353150400443913"] }));
		const qty = wrapper.findAll("input")[0]!;
		expect(qty.attributes("disabled")).toBeDefined();
	});
});
