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

// No invoice_doc prop — the identity inputs bind to the invoiceStore, which is
// live from cart-start. This mount IS the fresh-cart state (F1 regression: the
// inputs used to gate on invoice_doc, which is null until a server round-trip,
// so they never showed while building a new ticket).
const mountSummary = () =>
	mount(InvoiceSummary, {
		props: { ...summaryProps },
		global: {
			stubs: summaryStubs,
			// The template resolves __ and frappe as render-context globals.
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

describe("tab_identity input gating (InvoiceSummary)", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		// invoiceStore reads frappe.datetime.nowdate() at setup (postingDate).
		vi.stubGlobal("frappe", {
			_: (value: string) => value,
			datetime: { nowdate: () => "2026-08-10" },
		});
		vi.stubGlobal("__", (value: string) => value);
	});

	it("hides the tab-name input for retail (capability off)", () => {
		// retail-phones preset has no tab_identity capability
		const wrapper = mountSummary();
		expect(wrapper.find('[data-test="tab-name-field"]').exists()).toBe(false);
	});

	it("shows the tab-name + guest-count inputs when the tab_identity capability is on", () => {
		useUIStore().setCapabilityPayload({
			name: "coffee-quickserve",
			capabilities: ["tab_identity"],
		});
		const wrapper = mountSummary();
		expect(wrapper.find('[data-test="tab-name-field"]').exists()).toBe(true);
		expect(wrapper.find('[data-test="guest-count-field"]').exists()).toBe(true);
	});

	it("gates the service-type select on the orthogonal service_types capability", () => {
		useUIStore().setCapabilityPayload({ name: "taqueria", capabilities: ["service_types"] });
		const wrapper = mountSummary();
		expect(wrapper.find('[data-test="service-type-field"]').exists()).toBe(true);
		// tab-name identity is a separate capability and must stay hidden
		expect(wrapper.find('[data-test="tab-name-field"]').exists()).toBe(false);
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
						posa_rt_guest_count: 4,
						posa_rt_service_type: "Takeout",
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
		// guest count + service type surface in the row meta when present
		expect(wrapper.get(".drafts-list__meta").text()).toContain("4 guests");
		expect(wrapper.get(".drafts-list__meta").text()).toContain("Takeout");
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
