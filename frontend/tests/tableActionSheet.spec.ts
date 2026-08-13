// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";

/**
 * The tap sheet is the floor's answer to "what can I do with this table?".
 * A tap used to open an order silently, and the two verbs a service actually
 * runs on — add food, charge — had no route from the floor at all. These
 * assertions are about the OFFER: which verbs a free table and an occupied
 * table each present, and that picking one reports it upward.
 */

const orders = ref<any[]>([]);

vi.mock("../src/posapp/stores/floorStore", () => ({
	useFloorStore: () => ({
		ordersForTable: () => orders.value,
	}),
}));

vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({ t: (key: string) => key }),
}));

vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value).toFixed(2)}` }),
}));

vi.mock("../src/posapp/components/floor/floorClock", () => ({
	useFloorClock: () => ({ now: ref(Date.parse("2026-08-13T12:00:00Z")) }),
	idleMinutes: () => 5,
	formatIdleShort: (minutes: number) => `${minutes}'`,
	ageStep: () => "fresh",
	ageTurn: () => 0,
}));

import TableActionSheet from "../src/posapp/components/floor/TableActionSheet.vue";

const PassThrough = defineComponent({
	props: { modelValue: { type: Boolean, default: false } },
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const IconStub = defineComponent({
	props: { icon: { type: String, default: "" } },
	setup(props) {
		return () => h("i", { "data-icon": props.icon });
	},
});

const table = (over: Record<string, unknown> = {}) => ({
	name: "tbl-4",
	table_label: "Mesa 4",
	floor: "salon",
	seats: 4,
	is_active: 1,
	needs_cleaning: 0,
	layout: null,
	...over,
});

const mountSheet = (tableRow: any) =>
	mount(TableActionSheet, {
		props: { modelValue: true, table: tableRow },
		global: {
			components: { VDialog: PassThrough, VCard: PassThrough, VIcon: IconStub },
		},
	});

const actionIds = (wrapper: any) =>
	wrapper
		.findAll("[data-test^='table-sheet-']")
		.map((node: any) => node.attributes("data-test"))
		.filter((id: string) => id !== "table-sheet-cancel");

describe("TableActionSheet", () => {
	it("offers a free table exactly one verb: open it", () => {
		orders.value = [];
		const wrapper = mountSheet(table());

		expect(actionIds(wrapper)).toEqual(["table-sheet-open"]);
		expect(wrapper.text()).toContain("Free table");
		// The seat count is the fact that decides whether the party fits.
		expect(wrapper.text()).toContain("4 seats");
	});

	it("offers an occupied table the verbs a service runs on", () => {
		orders.value = [
			{ order_uid: "ord-1", total: 120, items_count: 2, unsent_count: 1, modified: "2026-08-13 11:45:00" },
		];
		const wrapper = mountSheet(table());

		// Add items first: it is what the waiter came back to the table for.
		// "view" rather than "open" — the caller lands that verb on the cart.
		expect(actionIds(wrapper)).toEqual([
			"table-sheet-add-items",
			"table-sheet-view",
			"table-sheet-charge",
		]);
		expect(wrapper.text()).toContain("Occupied");
		expect(wrapper.text()).toContain("$120.00");
	});

	it("offers Mark clean only on a table latched dirty", () => {
		orders.value = [];
		expect(actionIds(mountSheet(table()))).not.toContain("table-sheet-clean");
		expect(actionIds(mountSheet(table({ needs_cleaning: 1 })))).toContain("table-sheet-clean");
	});

	it("reports the picked verb with its table, then closes itself", async () => {
		orders.value = [];
		const row = table();
		const picked: Array<[string, any]> = [];
		const closed: boolean[] = [];

		// Mounted under a parent rather than asserting on `emitted()`: the sheet's
		// root IS the dialog stub, and events raised inside a stubbed root's slot
		// do not land in the wrapper's own emit log. The parent is also the real
		// contract — FloorView is what has to hear this.
		const Harness = defineComponent({
			components: { TableActionSheet },
			setup: () => ({ row, picked, closed }),
			template: `<TableActionSheet :model-value="true" :table="row"
				@action="(a, t) => picked.push([a, t])"
				@update:model-value="(v) => closed.push(v)" />`,
		});

		const wrapper = mount(Harness, {
			global: { components: { VDialog: PassThrough, VCard: PassThrough, VIcon: IconStub } },
		});
		(wrapper.find("[data-test='table-sheet-open']").element as HTMLElement).click();
		await wrapper.vm.$nextTick();

		expect(picked).toEqual([["open", row]]);
		expect(closed).toEqual([false]);
	});
});
