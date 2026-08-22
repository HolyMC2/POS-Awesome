// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

/**
 * §17.7 invariant 1 — ONE number and ONE primary action — across the seam
 * where it was actually broken.
 *
 * `ActionBand` and `InvoiceSummary` each passed their own suite while a
 * cashier saw two totals and two PAY buttons on the same screen, because
 * neither component can see the other. That is the whole point of this file:
 * it mounts the surfaces TOGETHER and counts. A per-component test cannot
 * catch a duplication that only exists between components.
 */

// Mutable so one module-level mock can serve both sides of the boundary; the
// band mounts at >=1100px and must not below it.
const viewport = { width: 1400 };
vi.mock("../src/posapp/composables/core/useResponsive", () => ({
	useResponsive: () => ({
		windowWidth: {
			get value() {
				return viewport.width;
			},
		},
		isDesktop: { value: true },
		isTablet: { value: false },
		isPhone: { value: false },
		isCompact: { value: false },
	}),
}));

import InvoiceSummary from "../src/posapp/components/pos/invoice/InvoiceSummary.vue";
import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { bandOwnsLane } from "../src/posapp/components/pos/invoice/bandLaneOwnership";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

const summaryProps = {
	pos_profile: {
		currency: "MXN",
		posa_use_percentage_discount: 0,
		posa_allow_user_to_edit_additional_discount: 1,
	},
	total_qty: 9,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	subtotal: 973.28,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: () => "$",
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
};

// InvoiceActionButtons is deliberately NOT stubbed — its PAY button is half of
// what is being counted.
const mountSummary = () =>
	mount(InvoiceSummary, {
		props: { ...summaryProps },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

const mountBand = () =>
	mount(ActionBand, {
		props: {
			// Ticket B-04812 from the canvas, the same money bandState.spec.ts uses.
			state: resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }),
			formatCurrency: (value: number) => String(value),
		},
	});

beforeEach(() => {
	setActivePinia(createPinia());
	viewport.width = 1400;
	// invoiceStore reads frappe.datetime.nowdate() at store setup, and the
	// band's `__` falls back to the raw string when window.__ is absent.
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		datetime: { nowdate: () => "2026-08-22" },
	});
	vi.stubGlobal("__", (value: string) => value);
});

describe("bandOwnsLane", () => {
	it("is true only on the desktop two-column register", () => {
		expect(bandOwnsLane(false, 1440)).toBe(true);
		expect(bandOwnsLane(false, 1100)).toBe(true);
	});

	it("is false below 1100px, where no band mounts", () => {
		expect(bandOwnsLane(false, 1099)).toBe(false);
		expect(bandOwnsLane(false, 390)).toBe(false);
	});

	it("is false on a lean-vertical preset at ANY width", () => {
		// The register cannot strip what its mode pins on (vertical.py's
		// OVERRIDE_ALLOWLIST, merge: enable_only), so a 1440px restaurant
		// register runs the stacked layout and has no band to yield to.
		expect(bandOwnsLane(true, 1440)).toBe(false);
	});
});

describe("the summary yields the lane to the band", () => {
	it("demotes its figure and drops PAY on the desktop register", () => {
		const wrapper = mountSummary();
		const hero = wrapper.find('[data-band-owns-lane]');
		expect(hero.attributes("data-band-owns-lane")).toBe("true");
		expect(wrapper.find('[data-pos-keyboard-target="pay"]').exists()).toBe(false);
		// Demoted, not deleted — the subtotal is still readable.
		expect(wrapper.find('[data-testid="summary-subtotal"]').exists()).toBe(true);
	});

	it("keeps its own total and PAY where no band mounts", () => {
		viewport.width = 1024;
		const wrapper = mountSummary();
		// Below 1100 the hero block itself is not rendered (useCompactSaleDock),
		// so what matters is that PAY survives — nothing else is offering it.
		expect(wrapper.find('[data-pos-keyboard-target="pay"]').exists()).toBe(true);
	});
});

describe("counted across both surfaces, as a cashier sees them", () => {
	it("shows exactly one undemoted figure and one primary action", () => {
		const summary = mountSummary();
		const band = mountBand();

		const figures =
			summary.findAll(".summary-hero:not(.summary-hero--band-owns-lane) .summary-hero__amount")
				.length + band.findAll('[data-testid="band-value"]').length;
		const primaries =
			summary.findAll('[data-pos-keyboard-target="pay"]').length +
			band.findAll('[data-testid="band-primary"]').length;

		expect(figures, "two big numbers on one screen is the defect").toBe(1);
		expect(primaries, "two primary actions on one screen is the defect").toBe(1);
	});
});
