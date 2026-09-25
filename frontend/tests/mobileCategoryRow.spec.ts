// @vitest-environment jsdom

/**
 * The phone's category row: ONE line above the grid, never a sideways scroll
 * and never a wall of chips.
 *
 * `fitCategoryRow` decides the line from measured widths and is asserted here
 * without a DOM. The screen half needs widths jsdom does not lay out, so the
 * geometry is stubbed per chip — the same trade `cashHistoryTable.spec.ts`
 * makes with its ResizeObserver.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import MobileBrowseScreen from "../src/posapp/components/pos/mobile/browse/MobileBrowseScreen.vue";
import CategoryTiles from "../src/posapp/components/pos/items/CategoryTiles.vue";
import { defaultTranslate } from "../src/posapp/components/pos/mobile/browse/browseCatalog";
import { fitCategoryRow } from "../src/posapp/composables/pos/items/useCategoryNavigation";
import type { ComboOffer } from "../src/posapp/composables/pos/combos/comboCatalog";

const chips = (...widths: number[]) =>
	widths.map((width, index) => ({ id: `c${index}`, width }));

describe("fitCategoryRow", () => {
	it("shows everything when nothing was measured", () => {
		// jsdom, a hidden tab: guessing a layout would hide real categories.
		expect(
			fitCategoryRow({
				available: 0,
				gap: 6,
				fixedWidth: 0,
				moreWidth: 64,
				chips: chips(90, 90),
			}),
		).toBeNull();
		expect(
			fitCategoryRow({
				available: 360,
				gap: 6,
				fixedWidth: 0,
				moreWidth: 64,
				chips: chips(90, 0),
			}),
		).toBeNull();
	});

	it("shows everything, with no «+N», when it fits on one line", () => {
		expect(
			fitCategoryRow({
				available: 300,
				gap: 6,
				fixedWidth: 0,
				moreWidth: 64,
				chips: chips(96, 96, 96),
			}),
		).toBeNull();
	});

	it("lets a short menu use two lines rather than hide one chip", () => {
		const fit = {
			available: 300,
			gap: 6,
			fixedWidth: 0,
			moreWidth: 64,
			chips: chips(96, 96, 96, 96),
		};

		expect(fitCategoryRow(fit)).toEqual(new Set(["c0", "c1"]));
		expect(fitCategoryRow({ ...fit, maxLines: 2 })).toBeNull();
	});

	it("keeps chips in order and leaves room for «+N»", () => {
		// 64 (+N) + 6 + 100 + 6 + 100 = 276; a third chip would need 382.
		const shown = fitCategoryRow({
			available: 300,
			gap: 6,
			fixedWidth: 0,
			moreWidth: 64,
			chips: chips(100, 100, 100, 100),
		});

		expect(shown).toEqual(new Set(["c0", "c1"]));
	});

	it("never skips ahead to a narrower chip", () => {
		// c2 does not fit; c3 would, but showing it would reshuffle the row on
		// every width change.
		const shown = fitCategoryRow({
			available: 300,
			gap: 6,
			fixedWidth: 0,
			moreWidth: 64,
			chips: chips(100, 100, 160, 20),
		});

		expect(shown).toEqual(new Set(["c0", "c1"]));
	});

	it("keeps the selected chip in the row even when its turn comes late", () => {
		const shown = fitCategoryRow({
			available: 300,
			gap: 6,
			fixedWidth: 0,
			moreWidth: 64,
			chips: chips(100, 100, 100, 100, 100),
			activeId: "c4",
		});

		expect(shown).toEqual(new Set(["c4", "c0"]));
	});

	it("counts the back button and Compatible before any category", () => {
		const shown = fitCategoryRow({
			available: 300,
			gap: 6,
			fixedWidth: 44,
			moreWidth: 64,
			chips: chips(100, 100, 100),
		});

		expect(shown).toEqual(new Set(["c0"]));
	});
});

describe("CategoryTiles", () => {
	it("draws a count only where the caller knows one, and leads with the featured tile", async () => {
		const onSelect = vi.fn();
		const wrapper = mount(CategoryTiles, {
			props: {
				categories: [
					{ id: "combos", label: "Combos", featured: true, count: 3 },
					{ id: "Panadería", label: "Panadería", count: null },
				],
				onSelect,
			},
			global: { plugins: [createVuetify()] },
		});

		const combos = wrapper.get('[data-category="combos"]');
		expect(combos.classes()).toContain("category-tiles__tile--featured");
		expect(combos.get(".category-tiles__count").text()).toBe("3");
		expect(
			wrapper
				.get('[data-category="Panadería"]')
				.find(".category-tiles__count")
				.exists(),
		).toBe(false);

		await wrapper.get('[data-category="Panadería"]').trigger("click");
		expect(onSelect).toHaveBeenCalledWith("Panadería");
		wrapper.unmount();
	});
});

// ---- the screen ------------------------------------------------------------

const GROUPS = [
	"Bebidas",
	"Panadería",
	"Desayunos",
	"Postres",
	"Snacks",
	"Extras",
	"Temporada",
];
const ITEMS = GROUPS.map((group, index) => ({
	item_code: `CAF-${index}`,
	item_name: `${group} uno`,
	item_group: group,
	rate: 30,
}));
const COMBO: ComboOffer = {
	item_code: "COMBO-DESAYUNO",
	item_name: "Combo desayuno",
	rate: 65,
	components: [
		{
			item_code: "CAF-0",
			item_name: "Café",
			qty: 1,
			rate: 35,
			actual_qty: 0,
			is_stock_item: 0,
		},
		{
			item_code: "CAF-1",
			item_name: "Concha",
			qty: 1,
			rate: 40,
			actual_qty: 9,
			is_stock_item: 1,
		},
	] as ComboOffer["components"],
};

const setTouch = (touch: boolean) =>
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: touch,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);

/**
 * jsdom lays nothing out. Give the row a width and every chip one, so the fit
 * runs as it does on a phone: 303px of row (302 after its pixel of slack),
 * 100px chips (100.5 once the rounding allowance goes back on), a 44px back
 * button.
 */
const stubRowGeometry = () => {
	const originals = ["clientWidth", "offsetWidth"].map(
		(key) =>
			[
				key,
				Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
			] as const,
	);
	Object.defineProperty(HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get() {
			return (this as HTMLElement).dataset?.testid === "browse-categories"
				? 303
				: 0;
		},
	});
	Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
		configurable: true,
		get() {
			const el = this as HTMLElement;
			if (el.hasAttribute("data-strip-chip")) return 100;
			return el.hasAttribute("data-strip-fixed") ? 44 : 0;
		},
	});
	return () => {
		for (const [key, descriptor] of originals) {
			// jsdom keeps `clientWidth` on Element.prototype: nothing of its own
			// to put back, so the stub is removed and the inherited one returns.
			if (descriptor)
				Object.defineProperty(HTMLElement.prototype, key, descriptor);
			else Reflect.deleteProperty(HTMLElement.prototype, key);
		}
	};
};

const wrappers: ReturnType<typeof mount>[] = [];
let restoreGeometry: (() => void) | null = null;

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal("__", defaultTranslate);
});

afterEach(() => {
	wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
	restoreGeometry?.();
	restoreGeometry = null;
	vi.unstubAllGlobals();
});

const mountScreen = (props: Record<string, unknown> = {}) => {
	const wrapper = mount(MobileBrowseScreen, {
		props: {
			items: ITEMS,
			formatCurrency: (value: number) => `$${value}`,
			...props,
		},
		global: { plugins: [createVuetify()] },
	});
	wrappers.push(wrapper);
	return wrapper;
};

const shownChips = (wrapper: ReturnType<typeof mountScreen>) =>
	wrapper
		.findAll('[data-testid^="browse-category-"]')
		.map((node) => node.attributes("data-strip-chip"));

describe("the category row folds to one line", () => {
	beforeEach(() => {
		setTouch(false);
		restoreGeometry = stubRowGeometry();
	});

	it("shows what fits and counts the rest behind «+N»", async () => {
		const wrapper = mountScreen();
		await flushPromises();

		// Seven groups need three lines at 302px, so the row folds: 64 (+N) +
		// two chips fits, a third does not. Unlisted groups rank by count, then
		// name (`buildBrowseCategories`).
		expect(shownChips(wrapper)).toEqual(["Bebidas", "Desayunos"]);
		const more = wrapper.get('[data-testid="browse-categories-more"]');
		expect(more.text()).toBe("+5");
		expect(more.attributes("aria-expanded")).toBe("false");
		expect(more.attributes("aria-label")).toBe("Show 5 more categories");
	});

	it("opens the whole set in place, and a pick folds it back around the choice", async () => {
		const wrapper = mountScreen();
		await flushPromises();

		await wrapper
			.get('[data-testid="browse-categories-more"]')
			.trigger("click");
		expect(shownChips(wrapper)).toEqual(
			[...GROUPS].sort((a, b) => a.localeCompare(b)),
		);
		expect(
			wrapper
				.get('[data-testid="browse-categories-more"]')
				.attributes("aria-expanded"),
		).toBe("true");

		await wrapper
			.get('[data-testid="browse-category-Snacks"]')
			.trigger("click");
		await flushPromises();

		// The choice is pinned into the folded line, in its own place in the order.
		expect(shownChips(wrapper)).toEqual(["Bebidas", "Snacks"]);
		expect(
			wrapper
				.get('[data-testid="browse-category-Snacks"]')
				.attributes("aria-pressed"),
		).toBe("true");
		expect(wrapper.findAll('[data-testid^="browse-card-"]')).toHaveLength(
			1,
		);
	});

	it("shows every chip again when the row is wide enough", async () => {
		const wrapper = mountScreen({ items: ITEMS.slice(0, 3) });
		await flushPromises();

		expect(shownChips(wrapper)).toEqual([
			"Bebidas",
			"Desayunos",
			"Panadería",
		]);
		expect(
			wrapper.find('[data-testid="browse-categories-more"]').exists(),
		).toBe(false);
	});
});

describe("inside a category", () => {
	it("keeps the other categories one tap away instead of a trip back to the tiles", async () => {
		setTouch(true);
		const onSelectGroup = vi.fn();
		const wrapper = mountScreen({
			itemGroups: ["ALL", ...GROUPS],
			itemGroup: "Bebidas",
			items: [ITEMS[0]],
			onSelectGroup,
		});
		await flushPromises();

		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			false,
		);
		expect(
			wrapper
				.get('[data-testid="browse-category-Bebidas"]')
				.attributes("aria-pressed"),
		).toBe("true");

		await wrapper
			.get('[data-testid="browse-category-Postres"]')
			.trigger("click");
		expect(onSelectGroup).toHaveBeenLastCalledWith("Postres");

		await wrapper
			.get('[data-testid="browse-categories-back"]')
			.trigger("click");
		expect(onSelectGroup).toHaveBeenLastCalledWith("ALL");
	});

	it("shows the group's own rows, not the combos above them", () => {
		// The store narrows the ROWS to the group; the combos arrive whatever
		// is open, and used to lead every category the phone opened.
		setTouch(true);
		const wrapper = mountScreen({
			itemGroups: ["ALL", ...GROUPS],
			itemGroup: "Bebidas",
			items: [ITEMS[0]],
			combos: [COMBO],
		});

		const codes = wrapper
			.findAll('[data-testid^="browse-card-"]')
			.map((node) => node.attributes("data-testid"));
		expect(codes).toEqual(["browse-card-CAF-0"]);
		// Nothing is hidden inside the group, so there is no «See all» to offer.
		expect(wrapper.find('[data-testid="browse-footer"]').exists()).toBe(
			false,
		);
	});

	it("still opens the combos from their own chip", async () => {
		setTouch(true);
		const onSelectGroup = vi.fn();
		const wrapper = mountScreen({
			itemGroups: ["ALL", ...GROUPS],
			itemGroup: "Bebidas",
			items: [ITEMS[0]],
			combos: [COMBO],
			onSelectGroup,
		});

		await wrapper
			.get('[data-testid="browse-category-combos"]')
			.trigger("click");
		expect(onSelectGroup).toHaveBeenLastCalledWith("ALL");
		await wrapper.setProps({ itemGroup: "ALL", items: ITEMS });

		const codes = wrapper
			.findAll('[data-testid^="browse-card-"]')
			.map((node) => node.attributes("data-testid"));
		expect(codes).toEqual(["browse-card-COMBO-DESAYUNO"]);
	});
});
