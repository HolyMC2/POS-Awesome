// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

/**
 * The sale surface under a mesa-owned ticket, and the rail that must stop
 * contradicting it.
 *
 * Two small truths with outsized consequences: «Cancelar venta» does not cancel
 * a cuenta (and the copy has to say so, because a waiter who reads it wrong
 * either loses a round or never presses it), and the cup rail may not announce
 * «sin cuentas abiertas» a few pixels above a room with four occupied tables.
 */

vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({
		windowWidth: { value: 1718 },
		isDesktop: { value: true },
		isTablet: { value: false },
		isPhone: { value: false },
		isCompact: { value: false },
	}),
}));

import InvoiceSummary from "../src/posapp/components/pos/invoice/InvoiceSummary.vue";
import InvoiceActionButtons from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue";

const summaryProps = {
	pos_profile: {
		currency: "MXN",
		posa_use_percentage_discount: 0,
		posa_allow_user_to_edit_additional_discount: 1,
	},
	total_qty: 4,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	subtotal: 191,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: () => "$",
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
	bandBreakdownTarget: "[data-band-lane='breakdown']",
	bandContextTarget: "[data-band-lane='context']",
};

/**
 * `InvoiceActionButtons` is left REAL: `<script setup>` exposes nothing on the
 * vm, so the only honest way to assert a label override is to read the word the
 * waiter reads.
 */
const mountSummary = (extra: Record<string, unknown> = {}) =>
	mount(InvoiceSummary, {
		props: { ...summaryProps, ...extra },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

/** The band's two lanes, so a teleport has somewhere real to land. */
const standUpBandLanes = () => {
	const breakdown = document.createElement("div");
	breakdown.setAttribute("data-band-lane", "breakdown");
	const context = document.createElement("div");
	context.setAttribute("data-band-lane", "context");
	document.body.append(breakdown, context);
	return {
		breakdown,
		context,
		tearDown: () => {
			breakdown.remove();
			context.remove();
		},
	};
};

beforeEach(() => {
	setActivePinia(createPinia());
	vi.stubGlobal("__", (value: string) => value);
	// `invoiceStore`'s setup calls `frappe.datetime.nowdate()` at instantiation.
	vi.stubGlobal("frappe", {
		datetime: { nowdate: () => "2026-08-23", now_time: () => "10:00:00" },
		_: (value: string) => value,
	});
});

describe("the sale summary under a mesa ticket", () => {
	it("fills the band's breakdown lane on an ordinary sale", () => {
		const lanes = standUpBandLanes();

		mountSummary({ bandOwnedElsewhere: false });

		expect(lanes.breakdown.querySelector('[data-testid="summary-breakdown"]')).toBeTruthy();
		lanes.tearDown();
	});

	it("stands that lane down when another surface owns it", () => {
		// Salón publishes the room's figures and a mesa sale publishes the
		// round's. Teleporting Subtotal · IVA · Descuento AND the tender chips
		// into the same lane would put three statements where §17.7 allows one.
		const lanes = standUpBandLanes();

		const wrapper = mountSummary({ bandOwnedElsewhere: true });

		expect(lanes.breakdown.querySelector('[data-testid="summary-breakdown"]')).toBeNull();
		// Not dropped — rendered in place, exactly as it does on a phone, so the
		// card is still correct standing alone.
		expect(wrapper.find('[data-testid="summary-breakdown"]').exists()).toBe(true);
		lanes.tearDown();
	});

	it("renames «Cancelar venta» on a mesa sale — it discards the cart, not the cuenta", () => {
		const mesa = mountSummary({ mesaOrderActive: true });
		const retail = mountSummary({ mesaOrderActive: false });

		expect(mesa.find('[data-testid="action-chip-cancel-sale"]').text()).toContain(
			"Discard cart changes",
		);
		expect(retail.find('[data-testid="action-chip-cancel-sale"]').text()).toContain("Cancel Sale");
	});
});

describe("the action strip's label overrides", () => {
	it("prints the override instead of the registry label", () => {
		const wrapper = mount(InvoiceActionButtons, {
			props: {
				pos_profile: {},
				bandOwnsPrimary: true,
				labelOverrides: { "cancel-sale": "Discard cart changes" },
			},
			global: { mocks: { __: (value: string) => value } },
		});

		const chip = wrapper.find('[data-testid="action-chip-cancel-sale"]');
		expect(chip.text()).toContain("Discard cart changes");
		expect(chip.text()).not.toContain("Cancel Sale");
	});

	it("leaves every other chip on its registry label", () => {
		const wrapper = mount(InvoiceActionButtons, {
			props: {
				pos_profile: {},
				bandOwnsPrimary: true,
				labelOverrides: { "cancel-sale": "Discard cart changes" },
			},
			global: { mocks: { __: (value: string) => value } },
		});

		expect(wrapper.find('[data-testid="action-chip-save-and-clear"]').text()).toContain(
			"Save & Clear",
		);
	});
});

describe("the cup rail", () => {
	const floorStore = reactive({
		tabOrders: [] as any[],
		activeOrder: null as any,
	});

	beforeEach(() => {
		floorStore.tabOrders = [];
		floorStore.activeOrder = null;
	});

	it("says it is the TABLE-LESS rail, not that the register has no accounts", async () => {
		vi.doMock("../src/posapp/stores/floorStore", () => ({ useFloorStore: () => floorStore }));
		vi.doMock("../src/posapp/stores/verticalStore", () => ({
			useVerticalStore: () => ({ t: (key: string) => key }),
		}));
		vi.doMock("../src/posapp/format", () => ({
			useFormat: () => ({ formatCurrency: (value: number) => String(value) }),
		}));
		const TabsRail = (await import("../src/posapp/components/floor/TabsRail.vue")).default;

		const wrapper = mount(TabsRail, {
			props: { showNew: true },
			global: { stubs: { VBtn: true } },
		});

		const empty = wrapper.find(".tabs-rail__empty").text();
		expect(empty).toContain("No tabs without a table");
		// The claim that broke the screen: printed above a room with open mesas.
		expect(empty).not.toContain("No open tabs");
	});
});
