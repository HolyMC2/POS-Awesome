// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SplitEvenlyPanel from "../src/posapp/components/pos/payments/SplitEvenlyPanel.vue";

// v-btn stays unresolved under vitest (the app registers Vuetify globally; the
// test env cannot, per fractionalQtyPad.spec) so a collect click is unreliable
// here — the emit + per-share-tip arithmetic are covered end to end in the
// mesa settle drill. These pins guard the tip FIELD's wiring, which is what a
// regression would silently drop.
function mountPanel(props: Record<string, unknown> = {}) {
	return mount(SplitEvenlyPanel, {
		props: {
			modelValue: 2,
			total: 200,
			collected: [],
			methods: ["Efectivo"],
			label: "Dividir cuenta",
			formatCurrency: (v: number) => `$${Number(v).toFixed(2)}`,
			...props,
		},
	});
}

describe("SplitEvenlyPanel · per-share tip field", () => {
	it("shows the current payer a tip field when tips are enabled", () => {
		const wrapper = mountPanel({ tipEnabled: true });
		expect(wrapper.find("[data-test='split-tip']").exists()).toBe(true);
		expect(wrapper.find("[data-test='split-tip-input']").exists()).toBe(true);
	});

	it("hides the tip field entirely when tips are disabled", () => {
		const wrapper = mountPanel({ tipEnabled: false });
		expect(wrapper.find("[data-test='split-tip']").exists()).toBe(false);
	});

	it("previews the tip on the payer line as it is typed", async () => {
		const wrapper = mountPanel({ tipEnabled: true });
		await wrapper.find("[data-test='split-tip-input']").setValue("15");
		// «Persona 1 de 2 · $100.00 + $15.00»
		expect(wrapper.find("[data-test='split-collect-row']").text()).toContain(
			"+ $15.00",
		);
	});
});
