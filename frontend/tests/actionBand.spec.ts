// @vitest-environment jsdom

/**
 * ActionBand renders what the band state decided — and nothing more.
 *
 * The interesting assertions here are the NEGATIVE ones: one figure, one
 * button, and a tone that never moves the accent. Those are the properties
 * that make the canvas's raised density readable, and they are the ones a
 * well-meaning future edit ("just add a secondary button here") breaks first.
 */
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

const mountBand = (state: ReturnType<typeof resolveBandState>, slots = {}) =>
	mount(ActionBand, {
		props: { state, formatCurrency: (value: number) => `$${value.toFixed(2)}` },
		slots,
	});

describe("one number, one action", () => {
	const wrapper = mountBand(resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }));

	it("renders exactly one figure at band size", () => {
		expect(wrapper.findAll('[data-testid="band-value"]')).toHaveLength(1);
	});

	it("renders exactly one button, full stop", () => {
		expect(wrapper.findAll("button")).toHaveLength(1);
	});

	it("publishes its state as data attributes for the e2e lane", () => {
		const band = wrapper.get('[data-testid="action-band"]');
		expect(band.attributes("data-band-tone")).toBe("neutral");
		expect(band.attributes("data-band-value")).toBe("1129");
		expect(band.attributes("data-band-action")).toBe("sale.pay");
	});

	it("shows the number the state resolved", () => {
		expect(wrapper.get('[data-testid="band-value"]').text()).toBe("$1129.00");
	});

	it("emits the action id, so the shell routes without re-deriving intent", async () => {
		// Listener prop rather than wrapper.emitted(): VTU records only the
		// native click that bubbles to the root here, an idiom this repo
		// already documents in tests/changeDueDialog.spec.ts.
		const onPrimary = vi.fn();
		const listening = mount(ActionBand, {
			props: { state: resolveBandState({ kind: "sale", total: 1129 }), onPrimary },
		});
		await listening.get("button").trigger("click");
		expect(onPrimary).toHaveBeenCalledWith("sale.pay");
	});
});

describe("slots add columns, never a second number or a second button", () => {
	const wrapper = mountBand(resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }), {
		breakdown: '<div class="bd">Subtotal $973.28</div>',
		context: '<span class="chip">Efectivo</span>',
	});

	it("mounts both secondary columns", () => {
		expect(wrapper.find(".action-band__breakdown").exists()).toBe(true);
		expect(wrapper.find(".action-band__context").exists()).toBe(true);
	});

	it("still has one figure and one button", () => {
		expect(wrapper.findAll('[data-testid="band-value"]')).toHaveLength(1);
		expect(wrapper.findAll("button")).toHaveLength(1);
	});

	it("omits a divider when its column is absent", () => {
		const bare = mountBand(resolveBandState({ kind: "sale", total: 1129 }));
		expect(bare.findAll(".action-band__divider")).toHaveLength(0);
		expect(wrapper.findAll(".action-band__divider")).toHaveLength(2);
	});
});

describe("tone tints the surface, never the button", () => {
	const cases = [
		{ label: "sale", state: resolveBandState({ kind: "sale", total: 1129 }), tint: "neutral" },
		{
			label: "change",
			state: resolveBandState({ kind: "tender", total: 1129, received: 1200 }),
			tint: "positive",
		},
		{
			label: "shortfall",
			state: resolveBandState({ kind: "tender", total: 1129, received: 100 }),
			tint: "warning",
		},
		{
			label: "queued",
			state: resolveBandState({ kind: "queued", amount: 9013, ticketCount: 23 }),
			tint: "neutral",
		},
	];

	for (const { label, state, tint } of cases) {
		it(`${label} renders the ${tint} tint`, () => {
			const wrapper = mountBand(state);
			expect(wrapper.get('[data-testid="action-band"]').classes()).toContain(
				`action-band--${tint}`,
			);
		});
	}

	it("queued keeps its tone in the DOM even though it borrows the neutral tint", () => {
		const wrapper = mountBand(resolveBandState({ kind: "queued", amount: 9013 }));
		const band = wrapper.get('[data-testid="action-band"]');
		expect(band.attributes("data-band-tone")).toBe("queued");
		expect(band.classes()).toContain("action-band--neutral");
	});

	it("no tone adds a modifier class to the button", () => {
		for (const { state } of cases) {
			expect(mountBand(state).get("button").classes()).toEqual(["action-band__primary"]);
		}
	});

	it("data-band-tone keeps the four tones distinguishable to the e2e lane", () => {
		const tones = cases.map(({ state }) =>
			mountBand(state).get('[data-testid="action-band"]').attributes("data-band-tone"),
		);
		expect(tones).toEqual(["neutral", "positive", "warning", "queued"]);
	});
});

describe("the button reflects whether the action is actually possible", () => {
	it("an empty cart cannot be paid", () => {
		const wrapper = mountBand(resolveBandState({ kind: "sale", total: 0 }));
		expect(wrapper.get("button").attributes("disabled")).toBeDefined();
	});

	it("a shortfall cannot close the sale", () => {
		const wrapper = mountBand(resolveBandState({ kind: "tender", total: 1129, received: 100 }));
		expect(wrapper.get("button").attributes("disabled")).toBeDefined();
	});

	it("a blocked opening cannot open the shift", () => {
		const wrapper = mountBand(
			resolveBandState({ kind: "opening", float: 1500, blockingIssues: 2 }),
		);
		expect(wrapper.get("button").attributes("disabled")).toBeDefined();
	});
});

describe("the CTA cannot disagree with the figure above it", () => {
	it("formats the refund amount in the button the same way as the number", () => {
		const wrapper = mountBand(
			resolveBandState({ kind: "refund", amount: 149, ticketId: "B-04788" }),
		);
		expect(wrapper.get('[data-testid="band-value"]').text()).toBe("$149.00");
		expect(wrapper.get("button").text()).toContain("$149.00");
	});
});

describe("accessibility", () => {
	it("announces the figure region, because the tone alone is invisible to a reader", () => {
		const wrapper = mountBand(resolveBandState({ kind: "tender", total: 1129, received: 1200 }));
		const figure = wrapper.get(".action-band__figure");
		expect(figure.attributes("aria-live")).toBe("polite");
		expect(figure.attributes("aria-atomic")).toBe("true");
	});

	it("states the difference in words, not only in amber", () => {
		const short = mountBand(resolveBandState({ kind: "closing", expected: 5391, counted: 5366 }));
		const over = mountBand(resolveBandState({ kind: "closing", expected: 5391, counted: 5400 }));
		expect(short.get('[data-testid="action-band-label"]').text()).not.toBe(
			over.get('[data-testid="action-band-label"]').text(),
		);
	});

	it("hides the decorative dividers from the accessibility tree", () => {
		const wrapper = mountBand(resolveBandState({ kind: "sale", total: 1129 }), {
			breakdown: "<div>x</div>",
		});
		expect(wrapper.get(".action-band__divider").attributes("aria-hidden")).toBe("true");
	});
});

describe("standalone rendering", () => {
	it("formats without an injected formatter, so the band mounts in isolation", () => {
		const wrapper = mount(ActionBand, {
			props: { state: resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }) },
		});
		const text = wrapper.get('[data-testid="band-value"]').text();
		expect(text).toContain("1,129.00");
	});
});


describe("exactly one number and one action, counted in the DOM", () => {
	/**
	 * The second half of the invariant. `bandState.ts` guarantees only one
	 * number and one action can be PRODUCED; a pure function cannot stop a
	 * second band being MOUNTED elsewhere in the shell, and this count can.
	 * These are the same two selectors the Playwright/screenshot lane counts
	 * on a live page, so the contract is identical at both levels.
	 */
	const Shell = defineComponent({
		setup() {
			return () =>
				h("div", { class: "shell" }, [
					h("aside", { class: "rail" }, "rail"),
					h("main", {}, [
						h("div", { class: "cart" }, "cart"),
						h(ActionBand, {
							state: resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }),
						}),
					]),
				]);
		},
	});

	it("one band, one figure, one action on a mounted shell", () => {
		const wrapper = mount(Shell, { attachTo: document.body });
		expect(document.querySelectorAll('[data-testid="action-band"]')).toHaveLength(1);
		expect(document.querySelectorAll('[data-testid="band-value"]')).toHaveLength(1);
		expect(document.querySelectorAll('[data-testid="band-primary"]')).toHaveLength(1);
		wrapper.unmount();
	});

	it("would catch a second band — the failure this count exists for", () => {
		// Guarding the guard. If a future shell mounts the band twice (a
		// desktop copy and a phone copy both rendered, say) the count breaks
		// rather than the two screens quietly disagreeing about the total.
		const Doubled = defineComponent({
			setup() {
				const state = resolveBandState({ kind: "sale", total: 1129 });
				return () => h("div", {}, [h(ActionBand, { state }), h(ActionBand, { state })]);
			},
		});
		const wrapper = mount(Doubled, { attachTo: document.body });
		expect(document.querySelectorAll('[data-testid="band-value"]').length).toBe(2);
		wrapper.unmount();
	});

	it("leaves nothing behind when unmounted, so the count stays honest", () => {
		expect(document.querySelectorAll('[data-testid="action-band"]')).toHaveLength(0);
	});
});
