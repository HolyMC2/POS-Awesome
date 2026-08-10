// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({
		windowWidth: { value: 1400 },
		isDesktop: { value: true },
		isTablet: { value: false },
		isPhone: { value: false },
		isCompact: { value: false },
	}),
}));

import InvoiceSummary from "../src/posapp/components/pos/invoice/InvoiceSummary.vue";
import ParkedOrdersList from "../src/posapp/components/pos/invoice/ParkedOrdersList.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

// Let Vuetify tags render as unknown custom elements (no plugin installed) so
// the tab-name wrapper's data-test survives; only stub the child Vue components.
const summaryStubs = {
	InvoiceActionButtons: true,
	ParkedOrdersList: true,
	DocumentSourceSelector: true,
};

const summaryProps = {
	pos_profile: {
		currency: "MXN",
		posa_use_percentage_discount: 0,
		posa_allow_user_to_edit_additional_discount: 1,
	},
	invoice_doc: { name: "SINV-TAB-1", posa_rt_tab_name: "" },
	total_qty: 1,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	subtotal: 45,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: () => "$",
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
};

const mountSummary = () =>
	mount(InvoiceSummary, {
		props: { ...summaryProps, invoice_doc: { ...summaryProps.invoice_doc } },
		global: {
			stubs: summaryStubs,
			// The template resolves __ and frappe as render-context globals.
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

describe("tab_identity input gating (InvoiceSummary)", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.stubGlobal("frappe", { _: (value: string) => value });
		vi.stubGlobal("__", (value: string) => value);
	});

	it("hides the tab-name input for retail (capability off)", () => {
		// retail-phones preset has no tab_identity capability
		const wrapper = mountSummary();
		expect(wrapper.find('[data-test="tab-name-field"]').exists()).toBe(false);
	});

	it("shows the tab-name input when the tab_identity capability is on", () => {
		useUIStore().setCapabilityPayload({
			name: "coffee-quickserve",
			capabilities: ["tab_identity"],
		});
		const wrapper = mountSummary();
		expect(wrapper.find('[data-test="tab-name-field"]').exists()).toBe(true);
	});
});

describe("parked-order row identity (ParkedOrdersList)", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
	});

	it("prefers posa_rt_tab_name over customer_name for the row title", () => {
		const wrapper = mount(ParkedOrdersList, {
			props: {
				parkedOrders: [
					{
						name: "ACC-SINV-0001",
						posa_rt_tab_name: "Marco (grande)",
						customer_name: "Walk-in Customer",
						posting_date: "2026-08-10",
						posting_time: "10:15:00.000000",
						grand_total: 45,
						currency: "MXN",
					},
				],
				formatCurrency: (value: number) => String(value),
				currencySymbol: () => "$",
			},
			global: {
				stubs: {
					VBtn: { template: '<button type="button"><slot /></button>' },
					VProgressCircular: { template: "<span />" },
				},
			},
		});

		const title = wrapper.get(".drafts-list__card-top strong");
		expect(title.text()).toBe("Marco (grande)");
		expect(title.text()).not.toBe("Walk-in Customer");
	});

	it("falls back to customer_name when no tab name is present (retail)", () => {
		const wrapper = mount(ParkedOrdersList, {
			props: {
				parkedOrders: [
					{
						name: "ACC-SINV-0002",
						customer_name: "Ali Traders",
						posting_date: "2026-08-10",
						posting_time: "10:45:00.000000",
						grand_total: 820,
						currency: "MXN",
					},
				],
				formatCurrency: (value: number) => String(value),
				currencySymbol: () => "$",
			},
			global: {
				stubs: {
					VBtn: { template: '<button type="button"><slot /></button>' },
					VProgressCircular: { template: "<span />" },
				},
			},
		});

		expect(wrapper.get(".drafts-list__card-top strong").text()).toBe("Ali Traders");
	});
});
