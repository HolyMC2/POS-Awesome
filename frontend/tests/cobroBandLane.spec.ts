// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * The band on the Cobro surface carries the CHANGE and the action. Nothing else.
 *
 * Owner, 2026-08-23, on the hosted payment screen: «the band duplicates the
 * surface» — under a screen that already states Subtotal / IVA / Descuento in
 * its ticket column and the register's methods in its tender column, the band
 * was ALSO showing both. The subtotal block and the tender chips are
 * `InvoiceSummary`'s, teleported into the band's two lanes, and the sale is
 * still mounted (`v-show`) behind Cobro — so they kept filling a band that had
 * stopped being the sale's.
 *
 * The gate is one predicate in `InvoiceSummary` (`saleOwnsBand`) and it is
 * scoped to exactly that state: `paymentDialogOpen` is the register's word for
 * "the payment screen is up". This file is the behavioural half — that the
 * lanes actually empty when Cobro is hosted and that the SALE band is
 * untouched, which is the half a source scan cannot show.
 *
 * The mocks mirror `deadSpaceBandLane.spec.ts`: `InvoiceSummary` reads the
 * window width and the vertical preset to decide whether a band exists at all.
 */

const viewport = { width: 1440 };
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

vi.mock("../src/posapp/stores/verticalStore", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		useVerticalStore: () => ({
			leanVerticalLayout: false,
			has: () => false,
			t: (value: string) => value,
			layout: { dock_tabs: [], items_panel: "default", cart_style: "default" },
		}),
	};
});

import InvoiceSummary from "../src/posapp/components/pos/invoice/InvoiceSummary.vue";
import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { resetTenderSelection } from "../src/posapp/components/pos/invoice/armedTender";

const CASH = "Efectivo";
const CARD = "Tarjeta";

/** Ticket B-04812 from the canvas, the money every band spec is pinned to. */
const RETAIL = {
	currency: "MXN",
	posa_use_percentage_discount: 0,
	posa_allow_user_to_edit_additional_discount: 1,
	posa_allow_return: 1,
	payments: [
		{ mode_of_payment: CASH, default: 1, type: "Cash" },
		{ mode_of_payment: CARD, default: 0, type: "Bank" },
	],
};

const summaryProps = {
	pos_profile: RETAIL,
	total_qty: 9,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	subtotal: 1129,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => Number(value).toFixed(2),
	currencySymbol: () => "$",
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
	bandBreakdownTarget: "[data-band-lane='breakdown']",
	bandContextTarget: "[data-band-lane='context']",
};

/** `Pos.vue` mounts the band with no slots at all — the lanes are the case. */
const mountBand = (state = resolveBandState({ kind: "sale", total: 1129, itemCount: 9 })) =>
	mount(ActionBand, {
		attachTo: document.body,
		props: { state, formatCurrency: (value: number) => Number(value).toFixed(2) },
	});

const mountSummary = () =>
	mount(InvoiceSummary, {
		attachTo: document.body,
		props: summaryProps,
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

/** `<Teleport defer>` resolves its target AFTER the current render cycle. */
const settle = async () => {
	await nextTick();
	await nextTick();
};

const band = () => document.querySelector('[data-testid="action-band"]')!;

beforeEach(() => {
	setActivePinia(createPinia());
	document.body.innerHTML = "";
	viewport.width = 1440;
	resetTenderSelection();
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		datetime: { nowdate: () => "2026-08-22" },
	});
	vi.stubGlobal("__", (value: string) => value);
	useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 9, rate: 125.44 }]);
});

describe("while Cobro is hosted, the band says the change and nothing else", () => {
	it("empties both lanes", async () => {
		useUIStore().openPaymentDialog();
		mountBand(resolveBandState({ kind: "tender", total: 1129, received: 1200 }));
		mountSummary();
		await settle();

		expect(
			band().querySelector('[data-testid="summary-breakdown"]'),
			"the surface states Subtotal · IVA · Descuento in its ticket column",
		).toBeNull();
		expect(
			band().querySelector('[data-testid="tender-strip"]'),
			"the surface states the register's methods in its tender column",
		).toBeNull();
		expect(band().querySelectorAll(".summary-band-divider")).toHaveLength(0);
	});

	it("keeps the one number and the one action", async () => {
		useUIStore().openPaymentDialog();
		mountBand(resolveBandState({ kind: "tender", total: 1129, received: 1200 }));
		mountSummary();
		await settle();

		expect(document.querySelectorAll('[data-testid="band-value"]')).toHaveLength(1);
		expect(document.querySelectorAll('[data-testid="band-primary"]')).toHaveLength(1);
		expect(band().getAttribute("data-band-action")).toBe("sale.collectAndClose");
	});

	it("says no total twice — the hidden sale card claims none either", async () => {
		// The sale is kept MOUNTED behind Cobro (`v-show`), so its markup is
		// still in the document. Its hero total must stay unrendered, or the
		// surface's own total would have a silent twin.
		useUIStore().openPaymentDialog();
		mountBand(resolveBandState({ kind: "tender", total: 1129, received: 1200 }));
		mountSummary();
		await settle();

		expect(document.querySelectorAll('[data-money-role="total"]')).toHaveLength(0);
	});
});

describe("the sale's own band is untouched", () => {
	it("still carries the breakdown and the tender when no payment screen is up", async () => {
		mountBand();
		mountSummary();
		await settle();

		expect(band().querySelector('[data-testid="summary-breakdown"]')).toBeTruthy();
		expect(band().querySelector('[data-testid="tender-strip"]')).toBeTruthy();
		expect(band().querySelectorAll(".summary-band-divider")).toHaveLength(2);
	});

	it("gives the lanes back the moment Cobro closes", async () => {
		const ui = useUIStore();
		ui.openPaymentDialog();
		mountBand();
		mountSummary();
		await settle();
		expect(band().querySelector('[data-testid="summary-breakdown"]')).toBeNull();

		ui.closePaymentDialog();
		await settle();
		expect(
			band().querySelector('[data-testid="summary-breakdown"]'),
			"`Volver a la venta` must restore the sale band, not leave it bare",
		).toBeTruthy();
	});
});
