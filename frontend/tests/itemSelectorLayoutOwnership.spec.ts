// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";

import { useItemSelectorLayout } from "../src/posapp/composables/pos/items/useItemSelectorLayout";
// Raw SFC text — these guards assert a property of the SOURCE (which selectors
// are written), so the source is the honest thing to read. `?raw` keeps that
// environment-agnostic; `node:fs` is shimmed away under jsdom.
import cardsSource from "../src/posapp/components/pos/items/ItemsSelectorCards.vue?raw";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

const styleBlocks = (source: string) =>
	[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

/**
 * Selectors only — declaration bodies stripped, so a property VALUE that happens
 * to contain a class name can't produce a false hit.
 */
const selectorsOf = (css: string) =>
	css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\{[^{}]*\}/g, "{}")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.includes("{"))
		.map((line) => line.slice(0, line.indexOf("{")).trim())
		.filter(Boolean);

describe("useItemSelectorLayout — geometry ownership", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/**
	 * REGRESSION (prod cafetería demo, 2026-08-13): the composable used to size
	 * the grid by reading `--container-height` off the computed style. An
	 * unregistered custom property computes to its SPECIFIED token, so that read
	 * "70vh" as the number 70 — seventy PIXELS. Minus the sticky header it wrote
	 * `max-height: 14px` and clipped every card to a sliver.
	 *
	 * The narrow lesson was "handle the unit". The load-bearing one is this:
	 * height belongs to the CSS chain (selector card → dynamic-padding →
	 * results card → .items-card-container → .virtual-scroller), and this
	 * composable measures without ever writing geometry back.
	 */
	it("never writes inline geometry onto the container", async () => {
		document.body.innerHTML = `
			<div class="items-selector-shell" style="--container-height: 70vh">
				<div class="items-card-container"><div class="virtual-scroller"></div></div>
			</div>
		`;
		const container = document.querySelector(".items-card-container") as HTMLElement;

		let layout!: ReturnType<typeof useItemSelectorLayout>;
		const wrapper = mount(
			defineComponent({
				setup() {
					layout = useItemSelectorLayout();
					return () => h("div");
				},
			}),
		);

		layout.itemsContainerRef.value = container;
		await nextTick();

		layout.scheduleCardMetricsUpdate();
		window.dispatchEvent(new Event("resize"));
		vi.advanceTimersByTime(500);
		await nextTick();

		expect(container.getAttribute("style")).toBeNull();
		wrapper.unmount();
	});
});

describe("card-view CSS ownership", () => {
	const cards = styleBlocks(cardsSource);
	const selector = styleBlocks(selectorSource);

	/**
	 * Vue stamps a component's scope attribute onto its own template nodes and
	 * onto child-component ROOT nodes — nothing deeper. RecycleScroller renders
	 * `.vue-recycle-scroller__item-wrapper` itself, so a scoped rule targeting it
	 * compiles to `…[data-v-xxxxxxxx]` and matches nothing. Two such rules sat
	 * dead here for months, and both would have broken the grid had a later
	 * `:deep()` woken them.
	 */
	it("does not target scroller internals outside :deep()", () => {
		const offenders = selectorsOf(cards).filter(
			(sel) => sel.includes("vue-recycle-scroller__") && !sel.includes(":deep("),
		);
		expect(offenders).toEqual([]);
	});

	/**
	 * Same trap, other direction: `.items-card-grid` and `.item-container` live
	 * in ItemsSelectorCards' template, so they carry THAT component's scope
	 * attribute. Five rules in ItemsSelector.vue reached for them and every one
	 * was dead. Card-view styling belongs to the card component.
	 */
	it("keeps card-view classes out of the parent's stylesheet", () => {
		const owned = ["items-card-grid", "item-container", "virtual-scroller"];
		const offenders = selectorsOf(selector).filter((sel) =>
			owned.some((cls) => sel.includes(`.${cls}`)),
		);
		expect(offenders).toEqual([]);
	});

	/**
	 * `.virtual-scroller` is the one scrollport. A second `overflow-y: auto` on
	 * the list inside it nests a scrollport in a scrollport.
	 */
	it("puts the scrollport on the scroller root, with a stable gutter", () => {
		expect(selectorsOf(cards)).toContain(".virtual-scroller");
		expect(cards).toContain("scrollbar-gutter: stable");
	});
});
