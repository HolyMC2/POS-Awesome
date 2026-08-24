// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";
import { flushPromises, shallowMount } from "@vue/test-utils";

/**
 * Salón with the stage to itself (CAFETERIA_GOLDEN_FLOW.md §2).
 *
 * Two things change when the floor stops being a 5/12 column: the tap's
 * question moves from a modal into a 352px sheet beside the room, and the floor
 * starts publishing the band. Both are pinned here, along with the rule that
 * makes the sheet safe — a tile still ASKS, and creates nothing on its own.
 */

const table = (over: Record<string, unknown> = {}) => ({
	name: "tbl-7",
	table_label: "Mesa 7",
	floor: "salon",
	seats: 5,
	is_active: 1,
	needs_cleaning: 0,
	layout: null,
	...over,
});

const order = {
	order_uid: "ord-a",
	table: "tbl-7",
	tab_name: "Sofía",
	total: 351,
	items_count: 6,
	unsent_count: 2,
	guest_count: 3,
	status: "Open",
	modified: "2026-08-23 08:40:00",
};

const floorStore = reactive({
	floors: [{ name: "salon", floor_name: "Salón", layout: null }],
	tables: [table(), table({ name: "tbl-1", table_label: "Mesa 1", needs_cleaning: 0 })],
	orders: [order],
	activeFloor: "salon",
	activeFloorRow: { name: "salon", floor_name: "Salón", layout: null },
	activeFloorTables: [table(), table({ name: "tbl-1", table_label: "Mesa 1" })],
	tabOrders: [],
	viewMode: "plan",
	editorMode: false,
	loading: false,
	error: null as string | null,
	activeOrder: null as any,
	transferOrder: null as any,
	floorStats: { tables: 12, occupied: 6, needsCleaning: 2, openAccounts: 7, openTotal: 2296 },
	ordersForTable: (name: string) => (name === "tbl-7" ? [order] : []),
	isOccupied: (name: string) => name === "tbl-7",
	unsentCountForTable: () => 2,
	isSyncing: () => false,
	setActiveFloor: vi.fn(),
	setViewMode: vi.fn(),
	setEditorMode: vi.fn(),
	refresh: vi.fn(),
	activate: vi.fn(async () => undefined),
	deactivate: vi.fn(),
	cancelTransfer: vi.fn(),
	markClean: vi.fn(async () => undefined),
	openOrCreate: vi.fn(async () => order),
	resumeOrder: vi.fn(async () => order),
	openTab: vi.fn(async () => order),
	flushCartSync: vi.fn(async () => undefined),
	cancelOrder: vi.fn(async () => undefined),
	fireActiveCourse: vi.fn(async () => null),
	beginTransfer: vi.fn(),
});

vi.mock("../src/posapp/stores/floorStore", () => ({ useFloorStore: () => floorStore }));
vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value).toFixed(2)}` }),
}));
vi.mock("../src/posapp/components/floor/floorGeometry", () => ({
	resolveCanvas: () => ({ cols: 12, rows: 8, cell: 64 }),
}));
vi.mock("../src/posapp/utils/telemetry", () => ({ trackCustomMark: vi.fn() }));

vi.mock("../src/posapp/components/floor/FloorPlan.vue", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		default: defineComponent({
			props: { availableWidth: Number, fit: Boolean, selectedTable: String },
			emits: ["open"],
			setup(props, { emit }) {
				return () =>
					h(
						"button",
						{
							"data-test": "plan-table",
							"data-available-width": String(props.availableWidth),
							"data-selected": props.selectedTable || "",
							onClick: () =>
								emit("open", {
									name: "tbl-7",
									table_label: "Mesa 7",
									floor: "salon",
									seats: 5,
									is_active: 1,
									needs_cleaning: 0,
									layout: null,
								}),
						},
						"Mesa 7",
					);
			},
		}),
	};
});
vi.mock("../src/posapp/components/floor/FloorEditor.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/posapp/components/floor/FloorKanban.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/posapp/components/floor/JumpPad.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/posapp/components/floor/TableTicketPanel.vue", () => ({
	default: { name: "TableTicketPanel", template: "<div data-test='ticket-rail' />" },
}));
vi.mock("../src/posapp/components/floor/TabsRail.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/posapp/components/floor/TableActionSheet.vue", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		default: defineComponent({
			props: { modelValue: Boolean, table: Object },
			emits: ["update:modelValue", "action", "order"],
			setup(props) {
				return () => h("div", { "data-test": "modal-sheet", "data-open": String(props.modelValue) });
			},
		}),
	};
});
vi.mock("../src/posapp/components/floor/MesaSheet.vue", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		default: defineComponent({
			props: { table: Object, orders: Array, selectedUid: String, firing: Boolean, releasing: Boolean },
			emits: ["select", "add-items", "fire", "view", "transfer", "release", "open", "clean"],
			setup(props, { emit }) {
				return () =>
					h("div", { "data-test": "stage-sheet", "data-table": props.table?.name }, [
						h("button", { "data-test": "sheet-add", onClick: () => emit("add-items") }),
						h("button", { "data-test": "sheet-view", onClick: () => emit("view") }),
					]);
			},
		}),
	};
});

import FloorView from "../src/posapp/components/floor/FloorView.vue";

const passThrough = defineComponent({
	setup(_, { slots }) {
		return () => h("div", slots.default?.());
	},
});

/**
 * jsdom measures every element at 0, and this component's whole layout branches
 * on a MEASURED width. The observer stub reports one on `observe()`, which is
 * also how the real one behaves on the first frame.
 */
const stubResizeObserver = (width: number) => {
	class Stub {
		constructor(private cb: (entries: any[]) => void) {}
		observe() {
			this.cb([{ contentRect: { width } }]);
		}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", Stub);
};

const mountFloor = async (props: Record<string, unknown> = {}) => {
	const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
	const onBand = vi.fn();
	const wrapper = shallowMount(FloorView, {
		props: { ownsStage: true, ownsBand: true, onBand, ...props },
		global: {
			provide: { eventBus },
			stubs: { VIcon: true, VBtn: true, VMenu: passThrough, VList: passThrough, VListItem: true },
		},
	});
	await nextTick();
	return { wrapper, eventBus, onBand };
};

beforeEach(() => {
	vi.clearAllMocks();
	floorStore.activeOrder = null;
	floorStore.transferOrder = null;
	stubResizeObserver(1400);
});

describe("Salón on the full stage", () => {
	it("answers a tile tap with the sheet beside the room, not a modal", async () => {
		const { wrapper } = await mountFloor();

		await wrapper.find("[data-test='plan-table']").trigger("click");

		expect(wrapper.find("[data-test='stage-sheet']").exists()).toBe(true);
		expect(wrapper.find("[data-test='stage-sheet']").attributes("data-table")).toBe("tbl-7");
		expect(wrapper.find("[data-test='modal-sheet']").attributes("data-open")).toBe("false");
	});

	it("still creates nothing on the tap itself", async () => {
		const { wrapper } = await mountFloor();

		await wrapper.find("[data-test='plan-table']").trigger("click");

		expect(floorStore.openOrCreate).not.toHaveBeenCalled();
		expect(floorStore.resumeOrder).not.toHaveBeenCalled();
	});

	it("keeps the modal where there is no width for a 352px column", async () => {
		stubResizeObserver(700);
		const { wrapper } = await mountFloor();

		await wrapper.find("[data-test='plan-table']").trigger("click");

		expect(wrapper.find("[data-test='stage-sheet']").exists()).toBe(false);
		expect(wrapper.find("[data-test='modal-sheet']").attributes("data-open")).toBe("true");
	});

	it("hands the plan the width the sheet is not using", async () => {
		const { wrapper } = await mountFloor();
		const plan = () => wrapper.find("[data-test='plan-table']");

		expect(plan().attributes("data-available-width")).toBe("1400");

		await plan().trigger("click");

		// 1400 − 352 (sheet) − 12 (stage gap) = 1036, comfortably above the
		// ~616px the demo room is authored at, so no horizontal scroll.
		expect(plan().attributes("data-available-width")).toBe("1036");
	});

	it("tells the plan which tile the sheet is talking about", async () => {
		const { wrapper } = await mountFloor();

		await wrapper.find("[data-test='plan-table']").trigger("click");

		expect(wrapper.find("[data-test='plan-table']").attributes("data-selected")).toBe("tbl-7");
	});

	it("hydrates the cuenta before any sheet verb acts on it", async () => {
		// The board's rows carry counts and no lines; a verb run against the row
		// would fire an empty ticket.
		const { wrapper, eventBus } = await mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");

		await wrapper.find("[data-test='sheet-add']").trigger("click");
		await flushPromises();

		expect(floorStore.resumeOrder).toHaveBeenCalledWith(
			expect.objectContaining({ order_uid: "ord-a" }),
		);
		expect(eventBus.emit).toHaveBeenCalledWith("set_selector_view", "items");
	});
});

describe("the salón band", () => {
	it("publishes a floor band, never the sale's", async () => {
		const { onBand } = await mountFloor();

		const state = onBand.mock.calls.at(-1)?.[0];
		expect(state.kind).toBe("floorAccount");
		expect(state.primaryAction.id).toBe("floor.chargeAccount");
	});

	it("names the selected cuenta and carries its OWN total", async () => {
		const { wrapper, onBand } = await mountFloor();

		await wrapper.find("[data-test='plan-table']").trigger("click");
		await nextTick();

		const state = onBand.mock.calls.at(-1)?.[0];
		expect(state.value).toBe(351);
		expect(state.labelParams).toEqual(["Mesa 7 · Sofía"]);
		expect(state.primaryEnabled).toBe(true);
	});

	it("publishes nothing while the shell's band is not the floor's", async () => {
		const { onBand } = await mountFloor({ ownsBand: false });

		expect(onBand.mock.calls.at(-1)?.[0]).toBeNull();
	});

	it("reports the room into the band's own lane", async () => {
		// The lanes are published by ActionBand as empty `display: contents`
		// divs; the floor fills them by teleport, the way InvoiceSummary fills
		// them on the sale screen. Stand the targets up so the teleport has
		// somewhere real to land.
		const breakdown = document.createElement("div");
		breakdown.setAttribute("data-band-lane", "breakdown");
		const context = document.createElement("div");
		context.setAttribute("data-band-lane", "context");
		document.body.append(breakdown, context);

		await mountFloor();
		await nextTick();

		expect(context.textContent).toContain("6 / 12");
		expect(context.querySelector('[data-testid="floor-band-stats"]')).toBeTruthy();
		expect(breakdown.textContent).toContain("$2296.00");

		breakdown.remove();
		context.remove();
	});

	it("charges through the invoice panel's validator, never from the floor", async () => {
		const { wrapper, eventBus } = await mountFloor();
		await wrapper.find("[data-test='plan-table']").trigger("click");

		// The band press arrives as a bus event; FloorView hydrates and hands off.
		const handler = eventBus.on.mock.calls.find(
			([name]) => name === "floor_charge_selected_account",
		)?.[1] as () => void;
		expect(handler).toBeTypeOf("function");
		handler();
		await flushPromises();

		expect(floorStore.resumeOrder).toHaveBeenCalled();
		expect(eventBus.emit).toHaveBeenCalledWith("request_invoice_payment");
	});
});
