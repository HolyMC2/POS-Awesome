// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import PaymentActionButtons from "../src/posapp/components/pos/payments/PaymentActionButtons.vue";

// The component reads `window.__` at setup; Vuetify tags render as unknown
// custom elements (no plugin), so the data-pos-keyboard-target attributes and
// the cancel class survive for assertions.
beforeEach(() => {
	(window as any).__ = (value: string) => value;
	vi.stubGlobal("__", (value: string) => value);
});

const mountButtons = (props: Record<string, unknown> = {}) =>
	mount(PaymentActionButtons, {
		props,
		global: { mocks: { __: (value: string) => value } },
	});

describe("PaymentActionButtons", () => {
	it("renders all three actions with their keyboard targets", () => {
		const wrapper = mountButtons();
		expect(
			wrapper.find('[data-pos-keyboard-target="payment-submit"]').exists(),
		).toBe(true);
		expect(
			wrapper.find('[data-pos-keyboard-target="payment-submit-print"]').exists(),
		).toBe(true);
		expect(
			wrapper.find('[data-pos-keyboard-target="payment-cancel"]').exists(),
		).toBe(true);
	});

	it("keeps Cancel de-emphasised (slim text, not a full red bar)", () => {
		const wrapper = mountButtons();
		const cancel = wrapper.find('[data-pos-keyboard-target="payment-cancel"]');
		expect(cancel.classes()).toContain("payment-cancel-btn--slim");
		// It must NOT carry the money-button footer class (that's the full bar).
		expect(cancel.classes()).not.toContain("payment-footer-btn");
	});

	it("puts the compact marker on the root the sizing rule descends from", () => {
		// The surviving rule is `.compact :deep(.v-btn)`, which only reaches
		// the buttons while `.compact` is on this component's root element.
		expect(mountButtons({ compact: true }).classes()).toContain("compact");
		expect(mountButtons().classes()).not.toContain("compact");
	});

	it("Submit and Submit & Print sit in half-width columns (one row)", () => {
		const wrapper = mountButtons();
		const cols = wrapper.findAll("v-col");
		// two cols=6 (submit + print) then one cols=12 (cancel)
		const widths = cols.map((c) => c.attributes("cols"));
		expect(widths).toContain("6");
		expect(widths.filter((w) => w === "6").length).toBe(2);
	});
});
