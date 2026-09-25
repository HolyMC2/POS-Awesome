// @vitest-environment jsdom
/**
 * The payment screen's credit card says what each figure means: what the
 * counter collects now, who pays the financed part and when, and what the
 * remove button does to the prices. Display only, so it mounts with plain
 * stubs for the two Vuetify pieces it draws.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import CobroFinancedSale, {
	type FinancedSaleCardSummary,
} from "../src/posapp/components/pos/payments/cobro/CobroFinancedSale.vue";

// Frappe's __(): positional {0}, {1}… filled from the args array.
beforeAll(() => {
	(window as any).__ = (text: string, args: unknown[] = []) =>
		text.replace(/\{(\d+)\}/g, (_match, index) => String(args[Number(index)] ?? ""));
});

const Stub = defineComponent({ setup: () => () => h("i") });
const money = (value: number) => `$${value.toFixed(2)}`;
const summary = (over: Partial<FinancedSaleCardSummary> = {}): FinancedSaleCardSummary => ({
	providerLabel: "Payjoy",
	shape: "split",
	modeOfPayment: "Saldo proveedores",
	creditPrice: 4800,
	enganche: 800,
	financed: 4000,
	collectToday: 800,
	othersTotal: 0,
	valid: true,
	issueText: "",
	repricing: false,
	repriceFailed: false,
	...over,
});
const mountCard = (value: FinancedSaleCardSummary | null) =>
	mount(CobroFinancedSale, {
		props: { summary: value, providerNames: "Payjoy · Paguitos", formatMoney: money },
		global: { stubs: { "v-icon": Stub, "v-progress-circular": Stub } },
	});

describe("the payment screen's credit card", () => {
	it("says the provider pays its share through its payment method when the split sale is charged", () => {
		const wrapper = mountCard(summary());
		expect(wrapper.get('[data-testid="cobro-financed-note"]').text()).toBe(
			"Payjoy pays $4000.00 through Saldo proveedores when you charge. The printed ticket shows only the down payment.",
		);
		expect(wrapper.text()).toContain("The down payment the customer pays at the counter now.");
	});

	it("says a down-payment provider settles later, and names the other items when there are some", () => {
		const wrapper = mountCard(
			summary({ providerLabel: "Paguitos", shape: "enganche", modeOfPayment: "", collectToday: 1000, othersTotal: 200 }),
		);
		expect(wrapper.get('[data-testid="cobro-financed-note"]').text()).toBe(
			"Paguitos settles $4000.00 with the store later. The printed ticket shows only the down payment.",
		);
		expect(wrapper.text()).toContain("Down payment $800.00 + other items $200.00");
		expect(wrapper.text()).not.toContain("pays at the counter now");
	});

	it("names what editing and removing do", () => {
		const wrapper = mountCard(summary());
		expect(wrapper.get('[data-testid="cobro-financed-edit"]').text()).toBe("Edit credit");
		expect(wrapper.get('[data-testid="cobro-financed-remove"]').text()).toBe("Remove credit and restore prices");
	});
});
