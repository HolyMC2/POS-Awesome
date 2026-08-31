// @vitest-environment jsdom

/**
 * «The total bumps» (native-feel round 2, owner 2026-08-30).
 *
 * A figure that changes in place is the one moment in a POS where the screen
 * has news and gives no sign of it. The pulse is one CSS class, and this file
 * holds the three things that make it correct rather than merely present:
 *
 *  1. It fires on a CHANGE, and only on a change. A parent re-render that
 *     produces the same string must not twitch the total — a register whose
 *     number moves for no reason is a register the cashier stops trusting.
 *  2. It ALTERNATES. A CSS animation restarts when its `animation-name`
 *     changes and at no other time, so a single class re-applied inside one
 *     Vue flush plays once and then never again. The bug this catches is
 *     silent: the first add pulses, every add after it does not.
 *  3. It is silent under `prefers-reduced-motion`.
 *
 * And the invariant it must not cost: §17.7's band is ONE number and ONE
 * primary, counted from the DOM. A bump implemented as a wrapper element
 * would be a second box claiming to be the figure.
 */
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";

import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import { BUMP_CLASSES, useValueBump } from "../src/posapp/composables/core/useValueBump";
import ShellSource from "../src/posapp/components/pos/shell/Pos.vue?raw";

const setReducedMotion = (reduced: boolean) => {
	window.matchMedia = ((query: string) => ({
		matches: reduced && query.includes("prefers-reduced-motion"),
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	})) as unknown as typeof window.matchMedia;
};

/** A component whose only job is to expose the class the composable produces. */
const harness = (initial: string) => {
	const value = ref(initial);
	const wrapper = mount(
		defineComponent({
			setup() {
				const bumpClass = useValueBump(value);
				return () => h("strong", { class: bumpClass.value }, value.value);
			},
		}),
	);
	return { wrapper, value };
};

describe("the pulse follows the value, not the render", () => {
	it("does not fire on the first paint", () => {
		setReducedMotion(false);
		const { wrapper } = harness("$0.00");

		// Arriving is not changing. A total that pulses on mount pulses on
		// every dock tab change, because the screen it lives on remounts.
		expect(wrapper.get("strong").classes()).toEqual([]);
	});

	it("fires when the formatted value changes", async () => {
		setReducedMotion(false);
		const { wrapper, value } = harness("$0.00");

		value.value = "$45.00";
		await nextTick();

		expect(wrapper.get("strong").classes()).toContain(BUMP_CLASSES[0]);
	});

	it("stays still on a same-value re-render", async () => {
		setReducedMotion(false);
		const { wrapper, value } = harness("$45.00");

		value.value = "$45.00";
		await nextTick();

		expect(wrapper.get("strong").classes()).toEqual([]);
	});

	it("alternates the class, so the animation actually restarts", async () => {
		setReducedMotion(false);
		const { wrapper, value } = harness("$0.00");

		value.value = "$45.00";
		await nextTick();
		const first = wrapper.get("strong").classes()[0];

		value.value = "$90.00";
		await nextTick();
		const second = wrapper.get("strong").classes()[0];

		value.value = "$135.00";
		await nextTick();
		const third = wrapper.get("strong").classes()[0];

		expect(first).toBe(BUMP_CLASSES[0]);
		expect(second).toBe(BUMP_CLASSES[1]);
		expect(third).toBe(BUMP_CLASSES[0]);
		expect(second).not.toBe(first);
	});

	it("says nothing at all under prefers-reduced-motion", async () => {
		setReducedMotion(true);
		const { wrapper, value } = harness("$0.00");

		value.value = "$45.00";
		await nextTick();

		expect(wrapper.get("strong").classes()).toEqual([]);
	});

	it("survives a environment with no matchMedia", async () => {
		delete (window as unknown as Record<string, unknown>).matchMedia;
		const { wrapper, value } = harness("$0.00");

		value.value = "$45.00";
		await nextTick();

		// Unknown is not "reduced" — the register animates, as it does today.
		expect(wrapper.get("strong").classes()).toContain(BUMP_CLASSES[0]);
	});
});

describe("the band's figure bumps without becoming two figures", () => {
	const mountBand = (total: number) =>
		mount(ActionBand, {
			props: {
				state: resolveBandState({ kind: "sale", total, itemCount: 1 }),
				formatCurrency: (value: number) => `$${value.toFixed(2)}`,
			},
		});

	it("puts the class on the figure itself", async () => {
		setReducedMotion(false);
		const wrapper = mountBand(45);

		await wrapper.setProps({
			state: resolveBandState({ kind: "sale", total: 90, itemCount: 2 }),
		});

		expect(wrapper.get('[data-testid="band-value"]').classes()).toContain(BUMP_CLASSES[0]);
	});

	it("keeps one number and one primary while it does", async () => {
		setReducedMotion(false);
		const wrapper = mountBand(45);

		await wrapper.setProps({
			state: resolveBandState({ kind: "sale", total: 90, itemCount: 2 }),
		});

		expect(wrapper.findAll('[data-testid="band-value"]')).toHaveLength(1);
		expect(wrapper.findAll('[data-testid="band-primary"]')).toHaveLength(1);
		expect(wrapper.findAll("button")).toHaveLength(1);
	});

	it("does not bump when the tone changes but the digits do not", async () => {
		setReducedMotion(false);
		const wrapper = mountBand(45);

		// Same money, re-resolved. The cashier has nothing new to read.
		await wrapper.setProps({
			state: resolveBandState({ kind: "sale", total: 45, itemCount: 4 }),
		});

		expect(wrapper.get('[data-testid="band-value"]').classes()).not.toContain(BUMP_CLASSES[0]);
		expect(wrapper.get('[data-testid="band-value"]').classes()).not.toContain(BUMP_CLASSES[1]);
	});
});

describe("the phone dock's total is wired to the same composable", () => {
	it("watches the FORMATTED total, not the number behind it", () => {
		// A rounding that leaves the same digits on screen is not news, and
		// `formattedCartTotal` is what the dock actually draws.
		expect(ShellSource).toContain("const dockTotalBump = useValueBump(formattedCartTotal);");
	});

	it("carries the class on the amount and returns the binding from setup", () => {
		expect(ShellSource).toContain(
			'<strong class="mobile-dock__amount" :class="dockTotalBump">',
		);
		// Round 5's trap: a template binding missing from Pos.vue's setup
		// RETURN reads `undefined` silently — the dock would simply never bump.
		expect(ShellSource).toMatch(/\n\t\t\tdockTotalBump,\n/);
	});
});

describe("nothing in this file leaked a spy", () => {
	it("restores matchMedia for whoever runs next", () => {
		setReducedMotion(false);
		expect(vi.isMockFunction(window.matchMedia)).toBe(false);
	});
});
