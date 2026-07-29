// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";

// The real RecycleScroller virtualises against a measured viewport that
// jsdom never provides, so its slot renders nothing. `<script setup>`
// resolves the import directly rather than through the component
// registry, so the module is what has to be replaced — a VTU stub by
// name does not reach it.
vi.mock("vue-virtual-scroller", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		RecycleScroller: defineComponent({
			name: "RecycleScroller",
			props: { items: { type: Array, default: () => [] } },
			setup(props, { slots }) {
				return () =>
					h(
						"div",
						(props.items as unknown[]).map((item) => slots.default?.({ item })),
					);
			},
		}),
	};
});

import ItemsSelectorTable from "../src/posapp/components/pos/items/ItemsSelectorTable.vue";

if (!window.matchMedia) {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	})) as unknown as typeof window.matchMedia;
}

type ResizeCallback = (_entries: { contentRect: { width: number } }[]) => void;

const originalResizeObserver = globalThis.ResizeObserver;
let resizeCallbacks: ResizeCallback[] = [];

/**
 * Drive every live observer as if the panel had been resized, then let
 * the component's 100ms debounce settle.
 */
const resizeTo = async (width: number) => {
	for (const callback of resizeCallbacks) {
		callback([{ contentRect: { width } }]);
	}
	vi.advanceTimersByTime(150);
	await nextTick();
};

const headers = [
	{ key: "item_name", title: "Name", width: "38%", align: "start" },
	{ key: "item_code", title: "Code", width: "18%", align: "start" },
	{ key: "rate", title: "Rate", width: "18%", align: "start" },
	{ key: "actual_qty", title: "Available QTY", width: "14%", align: "start" },
	{ key: "stock_uom", title: "UOM", width: "12%", align: "start" },
];

const baseProps = {
	headers,
	displayedItems: [{ item_code: "ITEM-001", item_name: "Bocina Auricular para iPhone XR" }],
	posProfile: { posa_allow_multi_currency: false },
	currencySymbol: () => "$",
	formatCurrency: (value: number) => String(value),
	formatNumber: (value: number) => String(value),
	ratePrecision: () => 2,
	getItemRateInfo: vi.fn(() => null),
	isNegative: () => false,
	// Keeps the rate cell free of ItemRateInfoMenu's Vuetify menu.
	showRateInfo: false,
};

const mountTable = () =>
	mount(ItemsSelectorTable, {
		props: baseProps,
		global: { stubs: { Skeleton: true } },
	});

const headerKeys = (wrapper: ReturnType<typeof mountTable>) =>
	wrapper.findAll(".posa-catalog-header-cell").map((cell) => cell.text());

beforeEach(() => {
	vi.useFakeTimers();
	resizeCallbacks = [];
	globalThis.ResizeObserver = class {
		constructor(callback: ResizeCallback) {
			resizeCallbacks.push(callback);
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

afterEach(() => {
	vi.useRealTimers();
	globalThis.ResizeObserver = originalResizeObserver;
});

describe("catalog table responsive columns", () => {
	it("renders every column on a desktop-width panel", async () => {
		const wrapper = mountTable();
		await resizeTo(760);

		expect(headerKeys(wrapper)).toEqual(["Name", "Code", "Rate", "Available QTY", "UOM"]);
	});

	it("collapses to name and rate on a phone-width panel", async () => {
		const wrapper = mountTable();
		await resizeTo(330);

		expect(headerKeys(wrapper)).toEqual(["Name", "Rate"]);
	});

	it("hands the rows the same columns as the header, so the grid stays aligned", async () => {
		const wrapper = mountTable();
		await resizeTo(330);

		const row = wrapper.findComponent({ name: "CatalogItemRow" });
		expect((row.props("columns") as { key: string }[]).map((column) => column.key)).toEqual([
			"item_name",
			"rate",
		]);
	});

	it("refills the grid template so a dropped column leaves no dead track", async () => {
		const wrapper = mountTable();
		await resizeTo(330);

		const template = wrapper.get(".posa-catalog-header").attributes("style") || "";
		const percentages = [...template.matchAll(/([\d.]+)%/g)].map((match) =>
			Number.parseFloat(match[1] as string),
		);

		expect(percentages).toHaveLength(2);
		expect(percentages.reduce((total, value) => total + value, 0)).toBeCloseTo(100, 1);
	});

	it("switches the row and header to compact padding on a narrow panel", async () => {
		const wrapper = mountTable();
		await resizeTo(330);

		expect(wrapper.get(".posa-catalog-header").classes()).toContain(
			"posa-catalog-header--compact",
		);
		expect(wrapper.findComponent({ name: "CatalogItemRow" }).props("compact")).toBe(true);
	});

	it("keeps the roomy padding on a wide panel", async () => {
		const wrapper = mountTable();
		await resizeTo(760);

		expect(wrapper.get(".posa-catalog-header").classes()).not.toContain(
			"posa-catalog-header--compact",
		);
		expect(wrapper.findComponent({ name: "CatalogItemRow" }).props("compact")).toBe(false);
	});

	it("shows the full column set before the panel has been measured", () => {
		// First paint runs with width 0; narrowing then would flash a
		// two-column catalog on a desktop till.
		const wrapper = mountTable();

		expect(headerKeys(wrapper)).toEqual(["Name", "Code", "Rate", "Available QTY", "UOM"]);
	});

	it("widens back out when the operator drags the panel divider", async () => {
		const wrapper = mountTable();
		await resizeTo(330);
		expect(headerKeys(wrapper)).toEqual(["Name", "Rate"]);

		await resizeTo(760);
		expect(headerKeys(wrapper)).toEqual(["Name", "Code", "Rate", "Available QTY", "UOM"]);
	});

	it("stops observing when the catalog unmounts", async () => {
		const disconnect = vi.fn();
		globalThis.ResizeObserver = class {
			constructor(callback: ResizeCallback) {
				resizeCallbacks.push(callback);
			}
			observe() {}
			unobserve() {}
			disconnect = disconnect;
		} as unknown as typeof ResizeObserver;

		const wrapper = mountTable();
		wrapper.unmount();

		expect(disconnect).toHaveBeenCalledTimes(1);
	});
});
