// @vitest-environment jsdom

/**
 * The margin row as the cashier meets it (convergence checklist item F,
 * `Main.dc.html` nodes 113–116).
 *
 * `cartMargin.spec.ts` proves the arithmetic and the gate as a pure function.
 * This file covers the half that only exists once mounted: that a `hidden`
 * verdict puts NO cost anywhere in the DOM, that `incomplete` says so in words
 * instead of showing a figure, and that the row spends a state tone rather than
 * the screen's one accent (§17.7 invariant 2 — `actionBand.spec.ts` guards the
 * band's single primary, and this row must not become a second one).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import InvoiceActionButtons from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue";

const mountStrip = (cartMargin?: Record<string, unknown>) =>
	mount(InvoiceActionButtons, {
		props: {
			pos_profile: {},
			bandOwnsPrimary: true,
			lineSummary: "3 lines · 5 pcs",
			...(cartMargin ? { cartMargin } : {}),
		},
		global: { mocks: { __: (value: string) => value } },
	});

const READY = {
	state: "ready",
	margin: "$301.28",
	cost: "$672.00",
	negative: false,
};

describe("the margin row's gate", () => {
	beforeEach(() => {
		(window as any).innerWidth = 1440;
		(window as any).innerHeight = 900;
		(window as any).__ = (value: string) => value;
		vi.stubGlobal("__", (value: string) => value);
	});

	it("renders nothing at all when the acting cashier is not a supervisor", () => {
		const wrapper = mountStrip({ state: "hidden", margin: "", cost: "", negative: false });
		expect(wrapper.find('[data-testid="cart-margin"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="cart-cost"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="cart-margin-incomplete"]').exists()).toBe(false);
	});

	it("leaks no cost figure into the markup when hidden", () => {
		// Absent is not the same as invisible: a `v-show`ed cost is still a cost
		// in the page, and this row exists precisely because that matters.
		const wrapper = mountStrip({
			state: "hidden",
			margin: "$301.28",
			cost: "$672.00",
			negative: false,
		});
		expect(wrapper.html()).not.toContain("672");
		expect(wrapper.html()).not.toContain("301");
	});

	it("defaults to hidden for any caller that does not pass the row", () => {
		// A phone, a lean-vertical preset, or any mount written before this
		// existed. A component that cannot tell who is at the till shows no cost.
		const wrapper = mountStrip();
		expect(wrapper.find('[data-testid="cart-margin"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="cart-cost"]').exists()).toBe(false);
	});
});

describe("partial cost data", () => {
	beforeEach(() => {
		(window as any).__ = (value: string) => value;
		vi.stubGlobal("__", (value: string) => value);
	});

	it("says the cost is incomplete rather than showing a wrong margin", () => {
		const wrapper = mountStrip({
			state: "incomplete",
			margin: "",
			cost: "",
			negative: false,
		});
		const note = wrapper.find('[data-testid="cart-margin-incomplete"]');
		expect(note.exists()).toBe(true);
		expect(note.text()).toBe("Cost incomplete");
		expect(wrapper.find('[data-testid="cart-margin"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="cart-cost"]').exists()).toBe(false);
	});
});

describe("the happy path", () => {
	beforeEach(() => {
		(window as any).__ = (value: string) => value;
		vi.stubGlobal("__", (value: string) => value);
	});

	it("prints margin and cost as the artboard labels them", () => {
		const wrapper = mountStrip(READY);
		expect(wrapper.find('[data-testid="cart-margin"]').text()).toContain("Estimated margin");
		expect(wrapper.find('[data-testid="cart-margin"]').text()).toContain("$301.28");
		expect(wrapper.find('[data-testid="cart-cost"]').text()).toContain("Cost");
		expect(wrapper.find('[data-testid="cart-cost"]').text()).toContain("$672.00");
		expect(wrapper.find('[data-testid="cart-margin-incomplete"]').exists()).toBe(false);
	});

	it("marks a below-cost ticket as such instead of tinting it a smaller green", () => {
		const positive = mountStrip(READY)
			.find('[data-testid="cart-margin"] [data-margin-sign]')
			.attributes("data-margin-sign");
		expect(positive).toBe("positive");

		const negative = mountStrip({ ...READY, margin: "-$40.00", negative: true })
			.find('[data-testid="cart-margin"] [data-margin-sign]')
			.attributes("data-margin-sign");
		expect(negative).toBe("negative");
	});

	it("spends no accent — the row is text, never a filled control", () => {
		const wrapper = mountStrip(READY);
		const row = wrapper.find('[data-testid="cart-margin"]');
		expect(row.element.tagName.toLowerCase()).toBe("span");
		expect(row.attributes("color")).toBeUndefined();
		// The band's PAGAR is the screen's one primary; this strip must not put
		// a second filled control beside it.
		expect(wrapper.find('[data-testid="action-strip-pay"]').exists()).toBe(false);
	});

	it("renders the figures in tabular figures, so they do not jitter per keystroke", () => {
		const wrapper = mountStrip(READY);
		expect(
			wrapper.find('[data-testid="cart-margin"] [data-margin-sign]').classes(),
		).toContain("mono");
		expect(wrapper.find('[data-testid="cart-cost"] span').classes()).toContain("mono");
	});
});
