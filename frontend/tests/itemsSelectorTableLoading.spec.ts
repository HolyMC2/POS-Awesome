// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";

import ItemsSelectorTable from "../src/posapp/components/pos/items/ItemsSelectorTable.vue";

// jsdom ships no matchMedia; Skeleton.vue reads it at setup for the
// prefers-reduced-motion check.
if (!window.matchMedia) {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	})) as unknown as typeof window.matchMedia;
}

const baseProps = {
	headers: [{ key: "item_name", title: "Item", width: "1fr" }],
	posProfile: { posa_allow_multi_currency: false },
	currencySymbol: () => "$",
	formatCurrency: (value: number) => String(value),
	formatNumber: (value: number) => String(value),
	ratePrecision: () => 2,
	getItemRateInfo: vi.fn(() => null),
	isNegative: () => false,
	noDataText: "No items found",
};

const mountTable = (props: Record<string, unknown> = {}) =>
	shallowMount(ItemsSelectorTable, {
		props: { ...baseProps, ...props },
	});

describe("ItemsSelectorTable loading state", () => {
	it("shows skeleton rows instead of 'no items' during the first catalog load", () => {
		const wrapper = mountTable({ isLoading: true, displayedItems: [] });

		// The bug: an empty-but-loading catalog told the operator there were
		// no items, when the rows were simply still on their way.
		expect(wrapper.find(".posa-catalog-loading").exists()).toBe(true);
		expect(wrapper.findAllComponents({ name: "Skeleton" }).length).toBe(8);
		expect(wrapper.find(".posa-catalog-empty").exists()).toBe(false);
		expect(wrapper.text()).not.toContain("No items found");
	});

	it("shows the empty message once loading finishes with nothing to show", () => {
		const wrapper = mountTable({ isLoading: false, displayedItems: [] });

		expect(wrapper.find(".posa-catalog-loading").exists()).toBe(false);
		expect(wrapper.find(".posa-catalog-empty").exists()).toBe(true);
		expect(wrapper.text()).toContain("No items found");
	});

	it("keeps rendering rows that arrived while a background sync runs", () => {
		const wrapper = mountTable({
			isLoading: true,
			displayedItems: [{ item_code: "ITEM-001", item_name: "Paracetamol" }],
		});

		// Loading must not blank out a catalog the operator can already use.
		expect(wrapper.find(".posa-catalog-loading").exists()).toBe(false);
		expect(wrapper.find(".posa-catalog-empty").exists()).toBe(false);
		expect(wrapper.findComponent({ name: "RecycleScroller" }).exists()).toBe(true);
	});

	it("defaults to the previous behaviour when no loading flag is passed", () => {
		const wrapper = mountTable({ displayedItems: [] });

		expect(wrapper.find(".posa-catalog-loading").exists()).toBe(false);
		expect(wrapper.find(".posa-catalog-empty").exists()).toBe(true);
	});
});
