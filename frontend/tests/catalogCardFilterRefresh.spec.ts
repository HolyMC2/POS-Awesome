// @vitest-environment jsdom

/**
 * The card grid must show the search's results and only the search's results.
 *
 * The bug this file exists for: on a cafetería register — the preset that
 * defaults to TARJETA — an operator browses the grid, scrolls down, types
 * «jugo», and every tile from before the search stays on screen while the two
 * matches never appear. Switching to LISTA and typing the same term filters
 * correctly, which is what made it read as a card-view problem.
 *
 * Both views are handed the SAME `displayedItems` array, so the filtering was
 * never in question. What differs is that the card view is virtualised:
 * `RecycleScroller` reuses a pool of views and prunes the stale ones only when
 * the new visible range overlaps the previous one. A search that collapses 200
 * items to 2 while the scrollport sits at 2400px produces two disjoint ranges,
 * and on that update the library both skips the prune AND skips the assignment
 * loop, because `startIndex` (derived from the stale scroll position) is past
 * the shortened list's `endIndex`. The result is a grid rendering rows that are
 * no longer in the list.
 *
 * ## Why this is the first spec to mount this component
 *
 * It could not be mounted before. `ItemsSelectorCards.vue` imported
 * `../../../utils/itemSelectorLayout.js` — a `.js` specifier for a `.ts`
 * module, from a plain-JS `<script setup>`. The production bundler rewrites
 * that; vitest's resolver does not, so any spec that imported this file failed
 * at load. Every existing test of the card view therefore reads it `?raw` or
 * stubs it out, and the rendering path shipped with no behavioural coverage —
 * which is the reason a whole-grid fault went unseen.
 *
 * jsdom reports `clientHeight` 0 for everything, so the scrollport is given a
 * real height here. Without it the scroller believes nothing is visible and
 * the range arithmetic under test never runs.
 */

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, h } from "vue";

vi.mock("../src/posapp/components/pos/items/ItemCard.vue", () => ({
	default: {
		name: "ItemCard",
		props: ["item"],
		render() {
			return h("div", { class: "probe-card" }, (this as any).item?.item_code);
		},
	},
}));

import ItemsSelectorCards from "../src/posapp/components/pos/items/ItemsSelectorCards.vue";

const fns = {
	getItemRateInfo: () => ({}),
	isItemHighlighted: () => false,
	currencySymbol: () => "$",
	formatCurrency: (value: unknown) => String(value),
	formatNumber: (value: unknown) => String(value),
	ratePrecision: () => 2,
	isNegative: () => false,
};

const ROW_HEIGHT = 120;
const COLUMNS = 4;
const VIEWPORT = 600;

const catalogue = (count: number, prefix = "IT") =>
	Array.from({ length: count }, (_, i) => ({
		item_code: `${prefix}${i}`,
		item_name: `${prefix} ${i}`,
	}));

function mountGrid(items: ReturnType<typeof catalogue>) {
	const wrapper = mount(ItemsSelectorCards, {
		attachTo: document.body,
		props: {
			displayedItems: items,
			cardSlotHeight: ROW_HEIGHT,
			cardColumns: COLUMNS,
			cardSlotWidth: 150,
			cardColumnWidth: 148,
			cardRowHeight: 110,
			...fns,
		},
	});
	const scroller = (wrapper.vm as any).scrollerRef;
	// The one jsdom concession: give the scrollport a viewport it can measure.
	Object.defineProperty(scroller.$el, "clientHeight", {
		value: VIEWPORT,
		configurable: true,
	});
	scroller.updateVisibleItems(true);
	return { wrapper, scroller };
}

/**
 * What the operator can actually see. An unused view is not removed from the
 * DOM — the library parks it at `translateY(-9999px)` — so presence in the
 * tree proves nothing and the position has to be read.
 */
const onScreen = (wrapper: ReturnType<typeof mount>) =>
	wrapper
		.findAll(".vue-recycle-scroller__item-view")
		.filter((el) => !String(el.attributes("style")).includes("-9999px"))
		.map((el) => el.text());

describe("the card grid after a search narrows the catalogue", () => {
	it("shows the matches and nothing else, even when the grid was scrolled", async () => {
		const { wrapper, scroller } = mountGrid(catalogue(200));
		await nextTick();

		// The operator browses before typing — the state in which this broke.
		scroller.$el.scrollTop = 2400;
		scroller.updateVisibleItems(false);
		await nextTick();
		expect(onScreen(wrapper).length).toBeGreaterThan(2);

		await wrapper.setProps({ displayedItems: catalogue(2, "JUGO") });
		await nextTick();
		await nextTick();

		expect(onScreen(wrapper).sort()).toEqual(["JUGO0", "JUGO1"]);
		wrapper.unmount();
	});

	it("leaves no tile from the previous catalogue on screen", async () => {
		const { wrapper, scroller } = mountGrid(catalogue(200));
		await nextTick();
		scroller.$el.scrollTop = 2400;
		scroller.updateVisibleItems(false);
		await nextTick();

		await wrapper.setProps({ displayedItems: catalogue(3, "JUGO") });
		await nextTick();
		await nextTick();

		// The failure mode was stale tiles, so name it rather than only counting.
		expect(onScreen(wrapper).filter((code) => code.startsWith("IT"))).toEqual([]);
		wrapper.unmount();
	});

	it("pulls the scrollport back inside a catalogue that got shorter", async () => {
		const { wrapper, scroller } = mountGrid(catalogue(200));
		await nextTick();
		scroller.$el.scrollTop = 2400;
		scroller.updateVisibleItems(false);
		await nextTick();

		await wrapper.setProps({ displayedItems: catalogue(2, "JUGO") });
		await nextTick();

		// Two rows of content cannot be scrolled 2400px, and a scrollport past
		// the end of its content is what strands the range in the first place.
		expect(scroller.$el.scrollTop).toBe(0);
		wrapper.unmount();
	});

	it("does not yank a browsing operator to the top when the catalogue only grows", async () => {
		const { wrapper, scroller } = mountGrid(catalogue(200));
		await nextTick();
		scroller.$el.scrollTop = 2400;
		scroller.updateVisibleItems(false);
		await nextTick();

		// Background sync widening the catalogue is not a search: the position
		// the operator chose is still a position inside the content.
		await wrapper.setProps({ displayedItems: catalogue(260) });
		await nextTick();
		await nextTick();

		expect(scroller.$el.scrollTop).toBe(2400);
		wrapper.unmount();
	});

	it("renders the whole catalogue again when the search is cleared", async () => {
		const { wrapper } = mountGrid(catalogue(200));
		await nextTick();

		await wrapper.setProps({ displayedItems: catalogue(2, "JUGO") });
		await nextTick();
		await nextTick();
		expect(onScreen(wrapper).sort()).toEqual(["JUGO0", "JUGO1"]);

		await wrapper.setProps({ displayedItems: catalogue(200) });
		await nextTick();
		await nextTick();

		const visible = onScreen(wrapper);
		expect(visible).toContain("IT0");
		expect(visible.filter((code) => code.startsWith("JUGO"))).toEqual([]);
		wrapper.unmount();
	});
});
