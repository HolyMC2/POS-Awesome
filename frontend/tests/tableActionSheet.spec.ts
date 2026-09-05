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
		.findAll("button[data-test^='table-sheet-']")
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
			"table-sheet-new-account",
			"table-sheet-charge",
		]);
		expect(wrapper.text()).toContain("Occupied");
		expect(wrapper.text()).toContain("$120.00");
	});

	it("offers Mark clean only on a table latched dirty", () => {
		orders.value = [];
		expect(actionIds(mountSheet(table()))).not.toContain("table-sheet-clean");
		expect(actionIds(mountSheet(table({ needs_cleaning: 1 })))).toEqual(["table-sheet-clean"]);
	});

	it("does not offer Charge until an occupied account has a line", () => {
		orders.value = [
			{ order_uid: "ord-empty", total: 0, items_count: 0, unsent_count: 0, modified: "2026-08-13 11:45:00" },
		];

		expect(actionIds(mountSheet(table()))).not.toContain("table-sheet-charge");
	});

	it("offers «Liberar mesa» on an EMPTY cuenta, so a stray can leave the board", () => {
		// The stray: an Open order with 0 partidas — an abandoned open, or a
		// cuenta whose lines went elsewhere — holding a mesa with an espera clock
		// running. `cancelOrder` has always existed in the store; until now this
		// modal was the one presentation with no way to reach it, so a cashier
		// could see the stray and not clear it.
		orders.value = [
			{ order_uid: "ord-empty", total: 0, items_count: 0, unsent_count: 0, modified: "2026-08-13 11:45:00" },
		];

		expect(actionIds(mountSheet(table()))).toEqual([
			"table-sheet-add-items",
			"table-sheet-view",
			"table-sheet-new-account",
			"table-sheet-release",
		]);
	});

	it("REFUSES to offer it the moment the cuenta has lines", () => {
		// Releasing is cancelling, and cancelling a ticket with food on it is the
		// one thing this verb must never do. Gone, not greyed out — and
		// `FloorView.release()` re-checks after flushing the cart, so a line typed
		// in the last second is caught even if the row said zero.
		orders.value = [
			{ order_uid: "ord-1", total: 120, items_count: 2, unsent_count: 1, modified: "2026-08-13 11:45:00" },
		];

		expect(actionIds(mountSheet(table()))).not.toContain("table-sheet-release");
	});

	it("never offers it on a free table, which has no cuenta to cancel", () => {
		orders.value = [];
		expect(actionIds(mountSheet(table()))).not.toContain("table-sheet-release");
		expect(actionIds(mountSheet(table({ needs_cleaning: 1 })))).not.toContain(
			"table-sheet-release",
		);
	});

	it("reports «release» upward with its table", async () => {
		orders.value = [
			{ order_uid: "ord-empty", total: 0, items_count: 0, unsent_count: 0, modified: "2026-08-13 11:45:00" },
		];
		const row = table();
		const picked: Array<[string, any]> = [];
		const Harness = defineComponent({
			components: { TableActionSheet },
			setup: () => ({ row, picked }),
			template: `<TableActionSheet :model-value="true" :table="row"
				@action="(a, t) => picked.push([a, t])" />`,
		});
		const wrapper = mount(Harness, {
			global: { components: { VDialog: PassThrough, VCard: PassThrough, VIcon: IconStub } },
		});

		(wrapper.find("[data-test='table-sheet-release']").element as HTMLElement).click();
		await wrapper.vm.$nextTick();

		expect(picked).toEqual([["release", row]]);
	});

	it("makes the operator choose a specific account when a table has split bills", async () => {
		orders.value = [
			{ order_uid: "ord-a", tab_name: "Familia A", total: 120, items_count: 2, unsent_count: 1, modified: "2026-08-13 11:45:00" },
			{ order_uid: "ord-b", tab_name: "Familia B", total: 80, items_count: 1, unsent_count: 0, modified: "2026-08-13 11:50:00" },
		];
		const selected: any[] = [];
		const row = table();
		const Harness = defineComponent({
			components: { TableActionSheet },
			setup: () => ({ row, selected }),
			template: `<TableActionSheet :model-value="true" :table="row"
				@order="(order) => selected.push(order)" />`,
		});
		const wrapper = mount(Harness, {
			global: { components: { VDialog: PassThrough, VCard: PassThrough, VIcon: IconStub } },
		});

		expect(actionIds(wrapper)).toEqual([
			"table-sheet-order-ord-a",
			"table-sheet-order-ord-b",
			// A third party can still open their own cuenta from the picker.
			"table-sheet-new-account",
		]);
		expect(wrapper.text()).toContain("2 open accounts");
		expect(wrapper.text()).not.toContain("$200.00");

		await wrapper.find("[data-test='table-sheet-order-ord-b']").trigger("click");
		expect(selected).toEqual([orders.value[1]]);
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
