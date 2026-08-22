// @vitest-environment jsdom

/**
 * `MovilExplorar` on screen — what a thumb actually reaches.
 *
 * The rules live in `browseCatalog.ts` / `browseCompatibility.ts` and are
 * asserted in their own specs with no DOM. This file checks the two things a
 * pure test cannot: that the chrome DRAWS those answers, and that tapping a
 * card is what adds it — the promise the artboard's footer makes in words.
 *
 * The `Compatible` chip is checked from both ends. It must appear when the data
 * backs it AND be absent when it does not, because a chip that renders on an
 * empty claim is the failure with a customer on the other side of the counter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import MobileBrowseScreen from "../src/posapp/components/pos/mobile/browse/MobileBrowseScreen.vue";
import {
	defaultTranslate,
	type BrowseCatalogItem,
} from "../src/posapp/components/pos/mobile/browse/browseCatalog";
import type { ComboOffer } from "../src/posapp/composables/pos/combos/comboCatalog";

const HONOR_X8A = "IPN-HONOR-X8A";

/** See `movilExplorarCompatibility.spec.ts` for why this cast exists. */
const component = (
	item_code: string,
	item_name: string,
	rate: number,
	actual_qty: number,
	is_stock_item = 1,
) => ({ item_code, item_name, qty: 1, rate, actual_qty, is_stock_item }) as ComboOffer["components"][number];

const COMBO: ComboOffer = {
	item_code: "COMBO-X8A",
	item_name: "Combo Protección Honor X8A",
	rate: 289,
	targets: [HONOR_X8A],
	components: [
		component("IPN002611", "Case", 200, 8),
		component("IPN003290", "Mica", 149, 31),
		component("SRV-INST", "Instalación", 0, 0, 0),
	],
};

const ITEMS: BrowseCatalogItem[] = [
	{
		item_code: "IPN002611",
		item_name: "Anillo Case Honor X8A Rojo",
		item_group: "Fundas",
		rate: 200,
		is_stock_item: 1,
		actual_qty: 8,
	},
	{
		item_code: "IPN002587",
		item_name: "Anillo Case Honor 70 Gris",
		item_group: "Fundas",
		rate: 200,
		is_stock_item: 1,
		actual_qty: 2,
	},
	{
		item_code: "SRV-INST",
		item_name: "Instalación",
		item_group: "Servicios",
		rate: 0,
		is_stock_item: 0,
	},
];

const mountScreen = (props: Record<string, unknown> = {}) =>
	mount(MobileBrowseScreen, {
		props: {
			items: ITEMS,
			combos: [COMBO],
			cart: [HONOR_X8A],
			deviceNames: { [HONOR_X8A]: "Honor X8A" },
			lowStockThreshold: 3,
			catalogueCount: 1482,
			registerLabel: "Caja 2",
			online: true,
			formatCurrency: (value: number) => `$${value}`,
			// VTU does not record component emits in this repo (build plan §10);
			// listener props are how an emit is observed here.
			onAdd: vi.fn(),
			onSearch: vi.fn(),
			...props,
		},
		global: { plugins: [createVuetify()] },
	});

beforeEach(() => {
	vi.stubGlobal("__", defaultTranslate);
});

const card = (wrapper: ReturnType<typeof mountScreen>, code: string) =>
	wrapper.get(`[data-testid="browse-card-${code}"]`);

describe("the grid", () => {
	it("draws a card per row, price included", () => {
		const wrapper = mountScreen({ cart: [] });

		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(4);
		expect(card(wrapper, "IPN002611").text()).toContain("$200");
	});

	it("declares every money figure it renders", () => {
		// The register says a fact once and each figure states what it is —
		// `registerSaysItOnce.spec.ts` counts on `data-money-role` existing.
		const wrapper = mountScreen({ cart: [] });
		const roles = wrapper
			.findAll("[data-money-role]")
			.map((node) => node.attributes("data-money-role"));

		expect(roles).toContain("card-price");
		expect(roles).toContain("card-saving");
		expect(roles.every(Boolean)).toBe(true);
	});

	it("draws a healthy count bare and a thin one in words", () => {
		const wrapper = mountScreen({ cart: [] });

		expect(card(wrapper, "IPN002611").find('[data-chip-kind="stock"]').text()).toBe("8");
		expect(card(wrapper, "IPN002587").find('[data-chip-kind="stock"]').text()).toBe("left 2");
	});

	it("draws NO chip where the register has no figure", () => {
		// Not an empty chip, not a 0 — no element at all.
		const wrapper = mountScreen({ cart: [] });

		expect(card(wrapper, "SRV-INST").find("[data-chip-kind]").exists()).toBe(false);
	});

	it("shows a combo's saving instead of a count", () => {
		const wrapper = mountScreen({ cart: [] });

		expect(card(wrapper, "COMBO-X8A").find('[data-chip-kind="saving"]').text()).toBe("−$60");
	});

	it("says what it is doing to a screen reader", () => {
		const wrapper = mountScreen({ cart: [] });

		expect(card(wrapper, "IPN002587").attributes("aria-label")).toBe(
			"Add Anillo Case Honor 70 Gris, $200, left 2",
		);
		expect(card(wrapper, "IPN002611").attributes("aria-label")).toBe(
			"Add Anillo Case Honor X8A Rojo, $200, 8 pcs",
		);
	});
});

describe("tapping a card adds it", () => {
	it("hands the whole card up, not just its code", () => {
		const onAdd = vi.fn();
		const wrapper = mountScreen({ cart: [], onAdd });

		card(wrapper, "IPN002611").trigger("click");

		expect(onAdd).toHaveBeenCalledTimes(1);
		expect(onAdd.mock.calls[0]?.[0]).toMatchObject({
			item_code: "IPN002611",
			kind: "item",
			rate: 200,
		});
	});

	it("is a button, so a keyboard reaches it too", () => {
		const wrapper = mountScreen({ cart: [] });

		expect(card(wrapper, "IPN002611").element.tagName).toBe("BUTTON");
	});
});

describe("the compatible filter appears only where the data backs it", () => {
	it("is offered, and on, when a targeted device is on the ticket", () => {
		const wrapper = mountScreen();
		const chip = wrapper.get('[data-testid="browse-filter-compatible"]');

		expect(chip.attributes("aria-pressed")).toBe("true");
		expect(wrapper.get('[data-testid="browse-count"]').text()).toBe(
			"3 compatible with Honor X8A",
		);
	});

	it("narrows the grid to what a merchant record says fits", () => {
		const wrapper = mountScreen();
		const codes = wrapper
			.findAll('[data-testid^="browse-card-"]')
			.map((node) => node.attributes("data-testid"));

		expect(codes).toEqual([
			"browse-card-COMBO-X8A",
			"browse-card-IPN002611",
			"browse-card-SRV-INST",
		]);
	});

	it("is ABSENT when nothing on the ticket is a device anyone authored for", () => {
		const wrapper = mountScreen({ cart: ["IPN002611"] });

		expect(wrapper.find('[data-testid="browse-filter-compatible"]').exists()).toBe(false);
	});

	it("is absent when the register has no combos at all", () => {
		const wrapper = mountScreen({ combos: [] });

		expect(wrapper.find('[data-testid="browse-filter-compatible"]').exists()).toBe(false);
	});

	it("makes no claim in the footer when it is not offered", () => {
		const wrapper = mountScreen({ cart: [] });

		expect(wrapper.get('[data-testid="browse-count"]').text()).toBe("4 items");
	});

	it("widens back to everything when the cashier turns it off", async () => {
		const wrapper = mountScreen();

		await wrapper.get('[data-testid="browse-filter-compatible"]').trigger("click");

		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(4);
		expect(wrapper.get('[data-testid="browse-count"]').text()).toBe("4 items");
	});

	it("forgets an override when the device changes", async () => {
		// A filter turned off for one customer must not persist into the next
		// sale — the next phone is a different question.
		const other: ComboOffer = {
			item_code: "COMBO-70",
			item_name: "Combo Protección Honor 70",
			rate: 269,
			targets: ["IPN-HONOR-70"],
			components: [component("IPN002587", "Case 70", 200, 2)],
		};
		const wrapper = mountScreen({ combos: [COMBO, other] });
		await wrapper.get('[data-testid="browse-filter-compatible"]').trigger("click");
		expect(
			wrapper.get('[data-testid="browse-filter-compatible"]').attributes("aria-pressed"),
		).toBe("false");

		await wrapper.setProps({ cart: [HONOR_X8A, "IPN-HONOR-70"] });

		expect(
			wrapper.get('[data-testid="browse-filter-compatible"]').attributes("aria-pressed"),
		).toBe("true");
	});
});

describe("the chips", () => {
	it("carry the counts of what they open onto", async () => {
		const wrapper = mountScreen({ cart: [] });

		expect(wrapper.get('[data-testid="browse-category-Fundas"]').attributes("data-count")).toBe(
			"2",
		);

		await wrapper.get('[data-testid="browse-category-Fundas"]').trigger("click");

		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(2);
	});

	it("toggle off on a second tap", async () => {
		const wrapper = mountScreen({ cart: [] });
		const chip = () => wrapper.get('[data-testid="browse-category-Fundas"]');

		await chip().trigger("click");
		await chip().trigger("click");

		expect(chip().attributes("aria-pressed")).toBe("false");
		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(4);
	});

	it("select nothing when the remembered category leaves the scope", async () => {
		// Narrowing to Fundas and then switching to a phone with no cases must
		// show the other accessories, not a blank grid under an invisible chip.
		const wrapper = mountScreen({ cart: [] });
		await wrapper.get('[data-testid="browse-category-Servicios"]').trigger("click");
		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(1);

		await wrapper.setProps({ items: [ITEMS[0]!] });

		// The chip is gone, so the grid falls back to everything still in scope
		// rather than to nothing.
		expect(wrapper.find('[data-testid="browse-category-Servicios"]').exists()).toBe(false);
		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(2);
	});
});

describe("the header and footer", () => {
	it("counts the whole catalogue, not the current page of it", () => {
		expect(mountScreen().get('[data-testid="browse-meta"]').text()).toBe(
			"1,482 items · Caja 2",
		);
	});

	it("reports the connection as state", () => {
		expect(mountScreen().get('[data-testid="browse-connection"]').text()).toBe("Online");
		expect(mountScreen({ online: false }).get('[data-testid="browse-connection"]').text()).toBe(
			"Offline",
		);
	});

	it("offers a way out only while something is hidden", async () => {
		const wrapper = mountScreen();
		expect(wrapper.get('[data-testid="browse-see-all"]').text()).toBe("See all 4");

		await wrapper.get('[data-testid="browse-see-all"]').trigger("click");

		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(4);
		expect(wrapper.find('[data-testid="browse-see-all"]').exists()).toBe(false);
	});

	it("says so rather than drawing an empty grid", () => {
		const wrapper = mountScreen({ items: [], combos: [], cart: [] });

		expect(wrapper.find('[data-testid="browse-grid"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="browse-empty"]').text()).toBe("No items found");
	});
});

describe("the search row hands focus back rather than owning a field", () => {
	it("is a button that asks the register to focus its one input", () => {
		const onSearch = vi.fn();
		const wrapper = mountScreen({ onSearch });
		const search = wrapper.get('[data-testid="browse-search"]');

		expect(search.element.tagName).toBe("BUTTON");
		search.trigger("click");

		expect(onSearch).toHaveBeenCalledTimes(1);
	});

	it("echoes the live query, and prompts when there is none", () => {
		expect(mountScreen({ query: "honor x8a" }).get('[data-testid="browse-query"]').text()).toBe(
			"honor x8a",
		);
		expect(mountScreen().get('[data-testid="browse-query"]').text()).toBe("Search");
	});
});
