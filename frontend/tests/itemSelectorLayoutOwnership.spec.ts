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

describe("scoped CSS across the POS app", () => {
	const sfcs = import.meta.glob("../src/posapp/**/*.vue", {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>;

	/** Markup + script; styles removed, so a class never self-matches its rule. */
	const authored = Object.values(sfcs)
		.map((src) => src.replace(/<style[\s\S]*?<\/style>/g, " "))
		.join("\n");

	/** The rightmost compound is the one Vue stamps the scope attribute onto. */
	const rightmostClasses = (sel: string) => {
		if (/:deep\(|::v-deep|>>>|\/deep\/|:global\(/.test(sel)) return [];
		const parts = sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
		const last = (parts[parts.length - 1] ?? "").replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "");
		return [...last.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
	};

	/**
	 * A class composed at runtime (`class="foo-card"` +
	 * `:class="\`foo-card--${tone}\`"`) still counts as authored, so accept a
	 * separator-aligned prefix — as a whole token, never a bare substring.
	 */
	const isAuthored = (cls: string) => {
		if (authored.includes(cls)) return true;
		for (const sep of [...cls.matchAll(/[-_]/g)]) {
			const prefix = cls.slice(0, sep.index);
			if (prefix.length < 3) continue;
			if (new RegExp(`[\\s"'\`]${prefix}[-_\\w]*[\\s"'\`]`).test(authored)) return true;
		}
		return false;
	};

	/**
	 * 62 rules across five components styled classes that no element anywhere
	 * carried — an abandoned "compact menu" design in NavbarMenu, a "revamped"
	 * button family in OpeningDialog, and so on. Dead CSS is not inert: the two
	 * in the card view would have broken the grid the moment someone "fixed"
	 * them with :deep(). Vuetify-generated classes are exempt — they appear at
	 * runtime, and some land on component roots, which DO carry the attribute.
	 */
	it("has no rule targeting a class that exists nowhere in the app", () => {
		const dead: string[] = [];
		for (const [path, src] of Object.entries(sfcs)) {
			const scoped = [...src.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)]
				.filter((m) => /\bscoped\b/.test(m[1]))
				.map((m) => m[2])
				.join("\n");
			if (!scoped) continue;
			for (const sel of selectorsOf(scoped)) {
				for (const cls of new Set(rightmostClasses(sel))) {
					if (cls.startsWith("v-") || isAuthored(cls)) continue;
					dead.push(`${path.replace("../src/posapp/", "")}  →  ${sel}`);
				}
			}
		}
		expect(dead).toEqual([]);
	});
});
