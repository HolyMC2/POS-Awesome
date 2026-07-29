// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";

import ItemCard from "../src/posapp/components/pos/items/ItemCard.vue";

const baseProps = {
	item: {
		item_code: "ITEM-001",
		item_name: "Paracetamol",
		image: "/files/paracetamol.png",
		actual_qty: 12,
		rate: 25,
	},
	posProfile: {
		currency: "PKR",
		posa_allow_multi_currency: false,
	},
	context: "pos",
	selectedCurrency: "",
	hideQtyDecimals: false,
	showRateInfo: false,
	getItemRateInfo: vi.fn(() => null),
	isItemHighlighted: false,
	currencySymbol: () => "Rs ",
	formatCurrency: (value: number) => String(value),
	formatNumber: (value: number) => String(value),
	ratePrecision: () => 2,
	isNegative: (value: number) => value < 0,
};

const mountCard = (item: Record<string, unknown> = {}) =>
	shallowMount(ItemCard, {
		props: { ...baseProps, item: { ...baseProps.item, ...item } },
		global: {
			stubs: {
				VIcon: { template: "<span />" },
				ItemRateInfoMenu: { template: "<span />" },
			},
		},
	});

describe("ItemCard item image", () => {
	it("defers off-screen fetches and decodes off the main thread", () => {
		const img = mountCard().get("img.card-item-image");

		expect(img.attributes("loading")).toBe("lazy");
		expect(img.attributes("decoding")).toBe("async");
		expect(img.attributes("src")).toBe("/files/paracetamol.png");
		expect(img.attributes("alt")).toBe("Paracetamol");
	});

	it("reveals the image only once it has decoded", async () => {
		const wrapper = mountCard();
		const img = wrapper.get("img.card-item-image");

		expect(img.classes()).not.toContain("is-loaded");
		expect(wrapper.find(".image-placeholder").exists()).toBe(true);

		await img.trigger("load");

		expect(wrapper.get("img.card-item-image").classes()).toContain("is-loaded");
	});

	it("falls back to the bundled placeholder when the attachment 404s", async () => {
		const wrapper = mountCard();
		const img = wrapper.get("img.card-item-image");

		await img.trigger("error");

		const src = wrapper.get("img.card-item-image").attributes("src");
		expect(src).not.toBe("/files/paracetamol.png");
		expect(src).toBeTruthy();
	});

	it("uses the placeholder for items that carry no image at all", () => {
		const wrapper = mountCard({ image: undefined });

		expect(wrapper.get("img.card-item-image").attributes("src")).toBeTruthy();
		expect(wrapper.get("img.card-item-image").attributes("src")).not.toBe(
			"/files/paracetamol.png",
		);
	});

	// RecycleScroller reuses card instances as the grid scrolls. A boolean
	// "loaded" flag would leave the previous item's photo showing as decoded.
	it("returns to the placeholder when the card is recycled for another item", async () => {
		const wrapper = mountCard();
		await wrapper.get("img.card-item-image").trigger("load");
		expect(wrapper.get("img.card-item-image").classes()).toContain("is-loaded");

		await wrapper.setProps({
			item: {
				...baseProps.item,
				item_code: "ITEM-002",
				item_name: "Ibuprofeno",
				image: "/files/ibuprofeno.png",
			},
		});

		const img = wrapper.get("img.card-item-image");
		expect(img.attributes("src")).toBe("/files/ibuprofeno.png");
		expect(img.classes()).not.toContain("is-loaded");
	});
});
