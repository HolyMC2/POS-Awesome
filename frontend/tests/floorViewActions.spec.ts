// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { flushPromises, shallowMount } from "@vue/test-utils";

const table = {
	name: "tbl-4",
	table_label: "Mesa 4",
	floor: "salon",
	seats: 4,
	is_active: 1,
	needs_cleaning: 0,
	layout: null,
};

const order = {
	order_uid: "ord-a",
	table: table.name,
	tab_name: "Familia A",
	total: 120,
	items_count: 2,
	unsent_count: 0,
	modified: "2026-08-13 11:45:00",
};

const floorStore = reactive({
	floors: [{ name: "salon", floor_name: "Salón", layout: null }],
	tables: [table],
	orders: [order],
	activeFloor: "salon",
	activeFloorRow: { name: "salon", floor_name: "Salón", layout: null },
	activeFloorTables: [table],
	tabOrders: [],
	viewMode: "plan",
	editorMode: false,
	loading: false,
	error: null as string | null,
	activeOrder: null as any,
	transferOrder: null as any,
	isOccupied: vi.fn(() => true),
	ordersForTable: vi.fn((_name: string) => [order]),
	setActiveFloor: vi.fn(),
	setViewMode: vi.fn(),
	setEditorMode: vi.fn(),
	refresh: vi.fn(),
	activate: vi.fn(async () => undefined),
	deactivate: vi.fn(),
	cancelTransfer: vi.fn(),
	markClean: vi.fn(async () => undefined),
	openOrCreate: vi.fn(async () => order),
	openNewAccount: vi.fn(async () => order),
	resumeOrder: vi.fn(async () => order),
	openTab: vi.fn(async () => order),
	flushCartSync: vi.fn(async () => undefined),
	cancelOrder: vi.fn(async () => undefined),
	fireActiveCourse: vi.fn(async () => null),
	beginTransfer: vi.fn(),
});

vi.mock("../src/posapp/stores/floorStore", () => ({
	useFloorStore: () => floorStore,
}));

vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({ t: (key: string) => key }),
}));

vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value).toFixed(2)}` }),
}));

vi.mock("../src/posapp/components/floor/floorGeometry", () => ({
	resolveCanvas: () => ({ cols: 12, rows: 8, cell: 64 }),
}));

const trackCustomMark = vi.fn();
vi.mock("../src/posapp/utils/telemetry", () => ({
	trackCustomMark: (...args: unknown[]) => trackCustomMark(...args),
}));

vi.mock("../src/posapp/components/floor/FloorPlan.vue", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		default: defineComponent({
			emits: ["open"],
			setup(_, { emit }) {
				return () => h("button", {
					"data-test": "plan-table",
					onClick: () => emit("open", {
						name: "tbl-4", table_label: "Mesa 4", floor: "salon", seats: 4,
						is_active: 1, needs_cleaning: 0, layout: null,
					}),
				}, "Mesa 4");
			},
		}),
	};
});

vi.mock("../src/posapp/components/floor/TableActionSheet.vue", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		default: defineComponent({
			props: { modelValue: Boolean, table: Object },
			emits: ["update:modelValue", "action", "order"],
			setup(props, { emit }) {
				return () => h("div", { "data-test": "sheet", "data-open": String(props.modelValue) }, [
					h("button", { "data-test": "sheet-add", onClick: () => emit("action", "add-items", props.table) }),
					h("button", { "data-test": "sheet-view", onClick: () => emit("action", "view", props.table) }),
					h("button", { "data-test": "sheet-new-account", onClick: () => emit("action", "new-account", props.table) }),
					h("button", { "data-test": "sheet-charge", onClick: () => emit("action", "charge", props.table) }),
					h("button", { "data-test": "sheet-release", onClick: () => emit("action", "release", props.table) }),
					h("button", { "data-test": "sheet-order", onClick: () => emit("order", {
						order_uid: "ord-a", table: "tbl-4", tab_name: "Familia A", total: 120,
						items_count: 2, unsent_count: 0, modified: "2026-08-13 11:45:00",
					}) }),
				]);
			},
		}),
	};
});

vi.mock("../src/posapp/components/floor/FloorEditor.vue", () => ({
	default: { template: "<div />" },
}));
vi.mock("../src/posapp/components/floor/FloorKanban.vue", () => ({
	default: { template: "<div />" },
}));
vi.mock("../src/posapp/components/floor/JumpPad.vue", () => ({
	default: { template: "<div />" },
}));
vi.mock("../src/posapp/components/floor/TableTicketPanel.vue", () => ({
	default: { template: "<div />" },
}));
vi.mock("../src/posapp/components/floor/TabsRail.vue", () => ({
	default: { template: "<div />" },
}));

import FloorView from "../src/posapp/components/floor/FloorView.vue";

const passThrough = defineComponent({
	setup(_, { slots }) {
		return () => h("div", slots.default?.());
	},
});

function mountFloor() {
	const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
	const wrapper = shallowMount(FloorView, {
		global: {
			provide: { eventBus },
			stubs: {
				VIcon: true,
				VBtn: true,
				VMenu: passThrough,
				VList: passThrough,
				VListItem: true,
			},
		},
	});
	return { wrapper, eventBus };
}

beforeEach(() => {
	vi.clearAllMocks();
	floorStore.activeOrder = null;
	// `clearAllMocks` clears calls, not implementations — restore the default
	// the release cases override per test.
	floorStore.ordersForTable.mockReturnValue([order]);
	class ResizeObserverStub {
		observe() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

describe("FloorView action routing", () => {
	it("opens a table action sheet instead of creating an order on the tile tap", async () => {
		const { wrapper } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");

		expect(floorStore.openOrCreate).not.toHaveBeenCalled();
		expect(wrapper.find("[data-test='sheet']").attributes("data-open")).toBe("true");
	});

	it("routes Add items to the hydrated cart and item selector", async () => {
		const { wrapper, eventBus } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");
		await wrapper.find("[data-test='sheet-add']").trigger("click");

		expect(floorStore.openOrCreate).toHaveBeenCalledWith(expect.objectContaining({ name: table.name }));
		expect(eventBus.emit).toHaveBeenCalledWith("set_selector_view", "items");
	});

	it("routes View order to the cart", async () => {
		const { wrapper, eventBus } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");
		await wrapper.find("[data-test='sheet-view']").trigger("click");

		expect(eventBus.emit).toHaveBeenCalledWith("floor_order_opened", { order_uid: "ord-a" });
	});

	it("routes New account to a second cuenta, then the item list", async () => {
		const { wrapper, eventBus } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");
		await wrapper.find("[data-test='sheet-new-account']").trigger("click");
		await flushPromises();

		// The split-bill gesture: never the table's existing order.
		expect(floorStore.openNewAccount).toHaveBeenCalledWith(
			expect.objectContaining({ name: table.name }),
		);
		expect(floorStore.openOrCreate).not.toHaveBeenCalled();
		expect(eventBus.emit).toHaveBeenCalledWith("set_selector_view", "items");
	});

	it("hydrates the exact split account the operator selected", async () => {
		const { wrapper, eventBus } = mountFloor();
		await wrapper.find("[data-test='sheet-order']").trigger("click");

		expect(floorStore.resumeOrder).toHaveBeenCalledWith(expect.objectContaining({ order_uid: order.order_uid }));
		expect(eventBus.emit).toHaveBeenCalledWith("floor_order_opened", { order_uid: "ord-a" });
	});

	it("routes Charge through the invoice panel's payment validator", async () => {
		const { wrapper, eventBus } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");
		await wrapper.find("[data-test='sheet-charge']").trigger("click");
		await flushPromises();

		expect(eventBus.emit).toHaveBeenCalledWith("request_invoice_payment");
	});

	// Benchmark row floor_table_action (perf:pos:floor-action) — the busy-
	// service manifest reads this event; without it the row is NO-DATA.
	it("emits the floor-action mark when a table verb completes", async () => {
		const { wrapper } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");
		await wrapper.find("[data-test='sheet-view']").trigger("click");
		await flushPromises();

		expect(trackCustomMark).toHaveBeenCalledWith(
			"pos:floor-action",
			expect.any(Number),
		);
	});

	// «Liberar mesa» from the modal sheet — the stray-cuenta verb that had no
	// entry point outside the stage sheet and the ticket panel.
	describe("Release table", () => {
		const emptyOrder = { ...order, order_uid: "ord-empty", total: 0, items_count: 0 };
		const release = async (wrapper: any) => {
			await wrapper.find("[data-test='plan-table']").trigger("click");
			await wrapper.find("[data-test='sheet-release']").trigger("click");
			await flushPromises();
		};

		it("cancels an EMPTY stray, and does not send the operator anywhere", async () => {
			floorStore.ordersForTable.mockReturnValue([emptyOrder]);
			const { wrapper, eventBus } = mountFloor();
			await release(wrapper);

			expect(floorStore.cancelOrder).toHaveBeenCalledWith(
				expect.objectContaining({ order_uid: "ord-empty" }),
			);
			// The other sheet verbs land the operator in the cart or the item
			// list; clearing a stray leaves them on the room.
			expect(floorStore.openOrCreate).not.toHaveBeenCalled();
			expect(eventBus.emit).not.toHaveBeenCalledWith("set_selector_view", "items");
			expect(eventBus.emit).not.toHaveBeenCalledWith(
				"floor_order_opened",
				expect.anything(),
			);
		});

		it("never adopts the cuenta it is about to cancel", async () => {
			// Hydrating would put a ticket the cashier did not ask for into their
			// cart, and the ticket strip it mounts races the sheet's own closing
			// transition — a `parentNode` TypeError on demo.lab on every release.
			floorStore.ordersForTable.mockReturnValue([emptyOrder]);
			const { wrapper } = mountFloor();
			await release(wrapper);

			expect(floorStore.resumeOrder).not.toHaveBeenCalled();
		});

		it("re-reads the board before it trusts the line count", async () => {
			// The row the button was drawn from carries a count from the last
			// snapshot, and another waiter may have typed into that ticket since.
			floorStore.ordersForTable.mockReturnValue([emptyOrder]);
			const { wrapper } = mountFloor();
			await release(wrapper);

			expect(floorStore.refresh).toHaveBeenCalledWith({ silent: true });
			expect(floorStore.refresh.mock.invocationCallOrder[0]).toBeLessThan(
				floorStore.cancelOrder.mock.invocationCallOrder[0],
			);
		});

		it("REFUSES a cuenta that has lines, even when the verb reaches it", async () => {
			floorStore.ordersForTable.mockReturnValue([order]);
			const { wrapper } = mountFloor();
			await release(wrapper);

			expect(floorStore.cancelOrder).not.toHaveBeenCalled();
		});

		it("REFUSES when the re-read is the thing that finds the lines", async () => {
			// Empty on the board, occupied on the server: the refresh is what
			// catches it, and the row the sheet rendered from is never used.
			floorStore.ordersForTable
				.mockReturnValueOnce([emptyOrder])
				.mockReturnValue([{ ...emptyOrder, items_count: 3 }]);
			const { wrapper } = mountFloor();
			await release(wrapper);

			expect(floorStore.refresh).toHaveBeenCalled();
			expect(floorStore.cancelOrder).not.toHaveBeenCalled();
		});

		it("goes through the flushing path when it IS this register's open cuenta", async () => {
			// That one can have lines the cart-sync debounce has not written yet,
			// so it keeps `release()`'s flush-then-recheck.
			floorStore.ordersForTable.mockReturnValue([emptyOrder]);
			floorStore.activeOrder = emptyOrder;
			const { wrapper } = mountFloor();
			await release(wrapper);

			expect(floorStore.flushCartSync).toHaveBeenCalled();
			expect(floorStore.cancelOrder).toHaveBeenCalledWith(
				expect.objectContaining({ order_uid: "ord-empty" }),
			);
		});

		it("does nothing on a table with no cuenta at all", async () => {
			floorStore.ordersForTable.mockReturnValue([]);
			const { wrapper } = mountFloor();
			await release(wrapper);

			expect(floorStore.resumeOrder).not.toHaveBeenCalled();
			expect(floorStore.cancelOrder).not.toHaveBeenCalled();
		});
	});

	it("does not emit the mark when the verb fails to open an order", async () => {
		floorStore.openOrCreate.mockResolvedValueOnce(null as any);
		const { wrapper } = mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");
		await wrapper.find("[data-test='sheet-view']").trigger("click");
		await flushPromises();

		expect(trackCustomMark).not.toHaveBeenCalled();
	});
});
