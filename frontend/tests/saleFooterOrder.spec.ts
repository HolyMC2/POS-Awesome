// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

/**
 * The sale footer's ORDER — `Main.dc.html` nodes 108–131, read top to bottom.
 *
 *     6 líneas · 9 piezas   ·  F3 Borrador  F5 Factura  Esc Cancelar
 *     Subtotal · IVA 16 % · Descuento              Cobrar con: …
 *                                                            → PAGAR
 *
 * What shipped first had the tender FIRST, above the totals, where it reads as
 * a filter on them. The artboard's whole argument for choosing the tender early
 * is that PAGAR then completes a decision already made — which only holds while
 * the chips sit next to the button they arm.
 *
 * So the property under test is not "chips, money, tender" as a fixed list. It
 * is: **the tender is adjacent to the primary**, wherever the primary happens
 * to be. On the desktop register the band below owns PAGAR, so the counts line
 * leads and the tender ends the card. On a phone or a lean-vertical preset no
 * band mounts, the strip carries PAY itself, and the strip moves to the bottom
 * so the tender stays above it. One rule, two arrangements, both asserted here.
 *
 * Order is read off the DOM, never off a CSS `order` property: document order
 * is what a screen reader and the tab key follow, and a footer that only LOOKS
 * right is a footer that reads wrong to the operators who need it most.
 * The height half of this change is `saleFooterHeight.spec.ts`.
 */

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

const verticalState = { lean: false };
vi.mock("../src/posapp/stores/verticalStore", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		useVerticalStore: () => ({
			get leanVerticalLayout() {
				return verticalState.lean;
			},
			has: () => false,
			t: (value: string) => value,
			layout: { dock_tabs: [], items_panel: "default", cart_style: "default" },
		}),
	};
});

import InvoiceSummary from "../src/posapp/components/pos/invoice/InvoiceSummary.vue";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import { resetTenderSelection } from "../src/posapp/components/pos/invoice/armedTender";

const CASH = "Efectivo";
const CARD = "Tarjeta";

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

const baseProps = {
	pos_profile: RETAIL,
	total_qty: 9,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	// Ticket B-04812 from the canvas — the money every band and footer spec in
	// this wave is pinned to.
	subtotal: 1129,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => Number(value).toFixed(2),
	currencySymbol: () => "$",
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
};

const mountSummary = (extraProps: Record<string, unknown> = {}) =>
	mount(InvoiceSummary, {
		props: { ...baseProps, ...extraProps },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

/**
 * The footer's landmarks, in DOM order.
 *
 * Read from the rendered markup rather than from `querySelectorAll`, because
 * this component is a FRAGMENT — the card plus the drafts surface — and
 * `wrapper.element` on a fragment is not the tree these landmarks live in
 * (build plan §10). Each marker carries its closing quote, so `action-strip`
 * cannot match `action-strip-pay`.
 */
const LANDMARKS: [marker: string, name: string][] = [
	['data-testid="action-strip"', "chips"],
	['data-testid="summary-subtotal"', "money"],
	['data-testid="tender-strip"', "tender"],
	['data-testid="action-strip-pay"', "pay"],
];

const footerOrder = (wrapper: ReturnType<typeof mountSummary>): string[] => {
	const html = wrapper.html();
	return LANDMARKS.map(([marker, name]) => ({ at: html.indexOf(marker), name }))
		.filter((hit) => hit.at >= 0)
		.sort((a, b) => a.at - b.at)
		.map((hit) => hit.name);
};

const fillCart = () => {
	useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 9, rate: 125.44 }]);
};

beforeEach(() => {
	setActivePinia(createPinia());
	viewport.width = 1400;
	verticalState.lean = false;
	resetTenderSelection();
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		datetime: { nowdate: () => "2026-08-22" },
	});
	vi.stubGlobal("__", (value: string) => value);
});

describe("the footer reads in the artboard's order", () => {
	it("puts the counts line above the money and the tender last, under the band", () => {
		fillCart();
		expect(footerOrder(mountSummary())).toEqual(["chips", "money", "tender"]);
	});

	it("states the money as Subtotal · IVA · Descuento, in that order", () => {
		fillCart();
		useInvoiceStore().setInvoiceDoc({
			name: "ACC-SINV-0001",
			taxes: [{ description: "IVA", rate: 16, included_in_print_rate: 1 }],
		});
		const labels = mountSummary()
			.findAll('[data-testid="summary-breakdown"] .summary-breakdown__label')
			.map((node) => node.text());

		expect(labels).toEqual(["Subtotal", "IVA 16 %", "Discount"]);
	});
});

describe("the tender is adjacent to the button it arms", () => {
	it("ends the card on the desktop register, directly above the band's PAGAR", () => {
		fillCart();
		const order = footerOrder(mountSummary());
		expect(order[order.length - 1]).toBe("tender");
		// The band owns the primary here, so no PAY belongs in this card at all.
		expect(order).not.toContain("pay");
	});

	it("sits immediately above PAY on a lean-vertical preset, where no band mounts", () => {
		verticalState.lean = true;
		fillCart();
		const order = footerOrder(mountSummary());

		expect(order).toEqual(["money", "tender", "chips", "pay"]);
		// Adjacency stated as the rule rather than as a literal list: only the
		// strip that CARRIES PAY may come between the tender and PAY.
		expect(order.indexOf("pay") - order.indexOf("tender")).toBe(2);
	});

	it("sits immediately above PAY on a phone", () => {
		viewport.width = 390;
		fillCart();
		// Below 1100px the money block is not rendered at all (the compact sale
		// dock), so the footer is the tender and then the strip carrying PAY.
		expect(footerOrder(mountSummary())).toEqual(["tender", "chips", "pay"]);
	});
});

describe("phone and lean-vertical keep their PAY", () => {
	it.each([
		["phone", 390, false],
		["lean-vertical at desktop width", 1400, true],
	])("%s still carries the primary", (_label, width, lean) => {
		viewport.width = width;
		verticalState.lean = lean;
		fillCart();
		const wrapper = mountSummary();

		expect(wrapper.findAll('[data-pos-keyboard-target="pay"]')).toHaveLength(1);
	});

	it("routes the moved strip's events exactly as the fixed one did", async () => {
		// The strip is bound through `v-bind`/`v-on` objects so its eleven props
		// and ten listeners are not hand-copied into two invocations. That is a
		// real change of mechanism — `toHandlers` prefixes `on` WITHOUT
		// camelizing, so a hyphenated key would produce `onSave-and-clear` — and
		// a silently dead Cancel Sale is exactly the kind of thing a reorder
		// hides. Listener props, not `emitted()`: VTU does not record component
		// emits in this repo (build plan §10).
		viewport.width = 390;
		fillCart();
		const onCancelSale = vi.fn();
		const onShowPayment = vi.fn();
		const wrapper = mountSummary({ onCancelSale, onShowPayment });

		await wrapper.find('[data-testid="action-chip-cancel-sale"]').trigger("click");
		await wrapper.find('[data-testid="action-strip-pay"]').trigger("click");

		expect(onCancelSale).toHaveBeenCalled();
		expect(onShowPayment).toHaveBeenCalled();
	});
});
