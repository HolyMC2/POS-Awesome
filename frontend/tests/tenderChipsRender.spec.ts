// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

/**
 * The chip strip on the sale surface (Riel y Cajón §11 item E).
 *
 * `tenderChips.spec.ts` proves the derivation and the guard. This file proves
 * the two things only a mount can: that the chips come from THIS register's
 * profile rather than a fixed four, and that what the strip lights is exactly
 * what the payment screen would be handed — a lit chip that no longer arms
 * anything is the defect, and it is invisible to a pure test.
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
import { peekArmedTender, resetTenderSelection } from "../src/posapp/components/pos/invoice/armedTender";

const CASH = "Efectivo";
const CARD = "Tarjeta";
const WIRE = "Transferencia";

const MONEY = "¤";

const profileWith = (payments: unknown[]) => ({
	currency: "MXN",
	posa_use_percentage_discount: 0,
	posa_allow_user_to_edit_additional_discount: 1,
	payments,
});

const RETAIL = profileWith([
	{ mode_of_payment: CASH, default: 1, type: "Cash" },
	{ mode_of_payment: CARD, default: 0, type: "Bank" },
	{ mode_of_payment: WIRE, default: 0, type: "Bank" },
]);

const baseProps = {
	total_qty: 9,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 41,
	subtotal: 973.28,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => String(value),
	currencySymbol: () => MONEY,
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
};

const mountSummary = (pos_profile: unknown = RETAIL) =>
	mount(InvoiceSummary, {
		props: { ...baseProps, pos_profile },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

/** A cart with something in it — nothing arms on an empty ticket. */
const fillCart = () => {
	useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 1, rate: 289 }]);
};

const chipModes = (wrapper: ReturnType<typeof mountSummary>) =>
	wrapper.findAll('[data-testid="tender-chip"]').map((chip) => chip.attributes("data-tender-mode"));

const litChip = (wrapper: ReturnType<typeof mountSummary>) =>
	wrapper
		.findAll('[data-testid="tender-chip"]')
		.find((chip) => chip.attributes("aria-pressed") === "true");

const tapTender = async (wrapper: ReturnType<typeof mountSummary>, mode: string) => {
	await wrapper.find(`[data-testid="tender-chip"][data-tender-mode="${mode}"]`).trigger("click");
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

describe("the chips are this register's tenders", () => {
	it("renders the profile's payment methods, in order", () => {
		fillCart();
		expect(chipModes(mountSummary())).toEqual([CASH, CARD, WIRE]);
	});

	it("renders ONE chip on a cash-only register", () => {
		fillCart();
		const wrapper = mountSummary(profileWith([{ mode_of_payment: CASH, default: 1 }]));
		expect(chipModes(wrapper)).toEqual([CASH]);
	});

	it("renders no strip at all when the profile configures no method", () => {
		fillCart();
		expect(mountSummary(profileWith([])).find('[data-testid="tender-strip"]').exists()).toBe(false);
		// The shape the rest of the suite mounts with — no `payments` key at all.
		expect(
			mountSummary({ currency: "MXN" }).find('[data-testid="tender-strip"]').exists(),
		).toBe(false);
	});

	it("groups the chips for a screen reader rather than leaving loose buttons", () => {
		fillCart();
		const strip = mountSummary().find('[data-testid="tender-strip"]');
		expect(strip.attributes("role")).toBe("group");
		expect(strip.attributes("aria-label")).toBeTruthy();
	});
});

describe("selecting a chip arms the payment screen", () => {
	it("opens on the register's default, so PAY is unchanged until the cashier says so", () => {
		fillCart();
		const wrapper = mountSummary();
		expect(litChip(wrapper)?.attributes("data-tender-mode")).toBe(CASH);
		expect(peekArmedTender()).toBe(CASH);
	});

	it("arms the tapped tender, and lights only that one", async () => {
		fillCart();
		const wrapper = mountSummary();
		await tapTender(wrapper, CARD);

		expect(peekArmedTender()).toBe(CARD);
		expect(litChip(wrapper)?.attributes("data-tender-mode")).toBe(CARD);
		expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(1);
	});

	it("arms nothing on an empty ticket", () => {
		const wrapper = mountSummary();
		expect(peekArmedTender()).toBeNull();
		expect(litChip(wrapper)).toBeUndefined();
	});

	it("arms nothing on a return — a refund is not a tender choice", () => {
		fillCart();
		useInvoiceStore().setInvoiceDoc({ name: "ACC-SINV-0001", is_return: 1 });
		const wrapper = mountSummary();
		expect(peekArmedTender()).toBeNull();
		expect(litChip(wrapper)).toBeUndefined();
	});
});

describe("MIXED is the empty selection, not a fifth chip", () => {
	it("offers no chip called mixed — every chip is a real Mode of Payment", () => {
		fillCart();
		const wrapper = mountSummary();
		expect(chipModes(wrapper)).toEqual([CASH, CARD, WIRE]);
	});

	it("tapping the lit chip clears the arm, which is what mixed means", async () => {
		fillCart();
		const wrapper = mountSummary();
		await tapTender(wrapper, CARD);
		await tapTender(wrapper, CARD);

		// Unarmed is exactly today's behaviour: the payment screen opens with
		// every method listed and every amount open, which IS the split surface.
		expect(peekArmedTender()).toBeNull();
		expect(litChip(wrapper)).toBeUndefined();
	});

	it("does not let a one-tender register deselect into a mix it cannot make", async () => {
		fillCart();
		const wrapper = mountSummary(profileWith([{ mode_of_payment: CASH, default: 1 }]));
		await tapTender(wrapper, CASH);
		await tapTender(wrapper, CASH);

		expect(peekArmedTender()).toBe(CASH);
	});
});

describe("a pre-selection cannot survive its context", () => {
	it("un-arms and un-lights when the method disappears from the profile", async () => {
		fillCart();
		const wrapper = mountSummary();
		await tapTender(wrapper, WIRE);
		expect(peekArmedTender()).toBe(WIRE);

		// The register's profile reloads without Transferencia. Arming the
		// DEFAULT here would silently substitute a tender the cashier never
		// chose; nothing lit says "pick again", which is the honest answer.
		await wrapper.setProps({
			pos_profile: profileWith([
				{ mode_of_payment: CASH, default: 1 },
				{ mode_of_payment: CARD },
			]),
		});

		expect(peekArmedTender()).toBeNull();
		expect(litChip(wrapper)).toBeUndefined();
		expect(chipModes(wrapper)).toEqual([CASH, CARD]);
	});

	it("does not carry one customer's tender into the next sale", async () => {
		fillCart();
		const wrapper = mountSummary();
		await tapTender(wrapper, CARD);
		expect(peekArmedTender()).toBe(CARD);

		// Sale submitted: the cart empties, then the next ticket begins.
		const invoiceStore = useInvoiceStore();
		invoiceStore.setItems([]);
		await wrapper.vm.$nextTick();
		expect(peekArmedTender()).toBeNull();

		invoiceStore.setItems([{ item_code: "IPN001902", qty: 1, rate: 50 }]);
		await wrapper.vm.$nextTick();
		expect(peekArmedTender()).toBe(CASH);
	});

	it("keeps the tender through an ordinary cart edit", async () => {
		fillCart();
		const wrapper = mountSummary();
		await tapTender(wrapper, CARD);

		useInvoiceStore().setItems([
			{ item_code: "IPN001545", qty: 2, rate: 289 },
			{ item_code: "IPN001902", qty: 1, rate: 50 },
		]);
		await wrapper.vm.$nextTick();

		// Adding a line is not a new sale. Clearing here would make the strip
		// unusable: the cashier would have to re-choose after every scan.
		expect(peekArmedTender()).toBe(CARD);
	});
});

describe("the strip adds no number to the sale surface", () => {
	it("leaves the money-figure count exactly where it was", () => {
		fillCart();
		const wrapper = mountSummary();
		const dialog = wrapper.find('[data-testid="discount-dialog"]');
		const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;
		const figures = countMoney(wrapper.html()) - (dialog.exists() ? countMoney(dialog.html()) : 0);

		// Same rule as registerSaysItOnce.spec.ts: every figure declares its
		// role. Chips carry a Mode of Payment name and never an amount, so this
		// row must not move the count at all.
		expect(figures).toBe(wrapper.findAll("[data-money-role]").length);
		expect(wrapper.find('[data-testid="tender-strip"]').findAll("[data-money-role]")).toHaveLength(0);
	});

	it("adds no second primary action", () => {
		fillCart();
		const wrapper = mountSummary();
		expect(wrapper.findAll('[data-pos-keyboard-target="pay"]')).toHaveLength(0);
	});
});
