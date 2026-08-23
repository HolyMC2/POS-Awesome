// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * The band's horizontal void, and what closes it.
 *
 * Owner, 2026-08-22, second of two marked regions: the band is the right height
 * (134px, §17.7) but at 1440 it put `TOTAL TO CHARGE · 5 ITEMS / $0.00` hard
 * left and `PAY` hard right with about a thousand pixels of nothing between. It
 * read as an empty lane rather than as a band.
 *
 * `Main.dc.html` does not stretch two elements across that width. Its band is
 * four blocks read left to right — 430px figure · divider · 216px breakdown ·
 * divider · `Cobrar con` chips · a ~66px spacer · 252px PAGAR — so the residual
 * is 5% of the lane, not 75%. The content was not missing from the register; it
 * was one card too high, in `InvoiceSummary`, in the artboard's own order.
 *
 * So the band publishes two lanes and the summary teleports into them. This
 * file is the behavioural half: that the figures actually land in the band,
 * in the artboard's order, and that a register with no band — a phone, a
 * lean-vertical preset, any mount with no target — renders exactly what it
 * rendered before, PAY included. The geometry half is
 * `deadSpaceBandGeometry.spec.ts`.
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
import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
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
};

const BREAKDOWN_TARGET = "[data-band-lane='breakdown']";
const CONTEXT_TARGET = "[data-band-lane='context']";

/**
 * The shell's band, attached to the document so it is a real teleport target.
 * `Pos.vue` mounts it with no slots at all, which is the case under test — the
 * lanes exist precisely because nothing fills them from above.
 */
const mountBand = () =>
	mount(ActionBand, {
		attachTo: document.body,
		props: {
			state: resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }),
			formatCurrency: (value: number) => Number(value).toFixed(2),
		},
	});

const mountSummary = (extraProps: Record<string, unknown> = {}) =>
	mount(InvoiceSummary, {
		attachTo: document.body,
		props: { ...summaryProps, ...extraProps },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

const fillCart = () => {
	useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 9, rate: 125.44 }]);
};

/**
 * `<Teleport defer>` resolves its target AFTER the current render cycle — that
 * is the whole reason it is deferred, since the band mounts in a sibling
 * subtree — so the move lands a tick later than the mount.
 */
const settle = async () => {
	await nextTick();
	await nextTick();
};

beforeEach(() => {
	setActivePinia(createPinia());
	document.body.innerHTML = "";
	viewport.width = 1440;
	verticalState.lean = false;
	resetTenderSelection();
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		datetime: { nowdate: () => "2026-08-22" },
	});
	vi.stubGlobal("__", (value: string) => value);
});

describe("the band's lane carries what the artboard puts in it", () => {
	it("lands the breakdown and the tender INSIDE the band", async () => {
		mountBand();
		fillCart();
		mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		const band = document.querySelector('[data-testid="action-band"]')!;
		expect(band, "the band must be on the page for any of this to mean anything").toBeTruthy();
		expect(
			band.querySelector('[data-testid="summary-breakdown"]'),
			"Subtotal · IVA · Descuento belongs in the lane, not one card above it",
		).toBeTruthy();
		expect(
			band.querySelector('[data-testid="tender-strip"]'),
			"`Cobrar con` is the band column immediately left of PAGAR",
		).toBeTruthy();
	});

	it("reads figure → breakdown → tender → PAY, the artboard's order", async () => {
		mountBand();
		fillCart();
		mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		// DOM order, never a CSS `order`: it is what the tab key and a screen
		// reader follow, and the tender's whole argument is that PAGAR completes
		// a decision already made.
		const band = document.querySelector('[data-testid="action-band"]')!;
		const marks = [
			'[data-testid="band-value"]',
			'[data-testid="summary-breakdown"]',
			'[data-testid="tender-strip"]',
			'[data-testid="band-primary"]',
		];
		const positions = marks.map((mark) => {
			const node = band.querySelector(mark);
			expect(node, `${mark} missing from the band`).toBeTruthy();
			return [...band.querySelectorAll("*")].indexOf(node!);
		});
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("puts a divider before each lane, the way the artboard separates them", async () => {
		mountBand();
		fillCart();
		mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		const band = document.querySelector('[data-testid="action-band"]')!;
		expect(band.querySelectorAll(".summary-band-divider")).toHaveLength(2);
	});

	it("still says the total exactly once (§17.7 invariant 1)", async () => {
		mountBand();
		fillCart();
		const summary = mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		// Counted on the DOCUMENT rather than on either wrapper, because the
		// figures now live in one component's subtree and another's markup —
		// which is exactly the seam a per-wrapper count would miss.
		expect(document.querySelectorAll('[data-testid="band-value"]')).toHaveLength(1);
		expect(document.querySelectorAll('[data-testid="band-primary"]')).toHaveLength(1);
		expect(
			document.querySelectorAll('[data-money-role="total"]'),
			"two totals on one screen is the defect",
		).toHaveLength(0);
		// Every figure that moved still declares what it is.
		expect(summary.html()).not.toContain('data-money-role="total"');
	});

	it("still arms a tender when the chip is clicked from inside the band", async () => {
		// Teleport moves DOM nodes and leaves the owning component alone, so the
		// handler should survive — but a silently dead control is exactly what a
		// move like this hides, and the tender is the one that decides which
		// payment screen opens. Asserted through the DOM the operator touches.
		mountBand();
		fillCart();
		mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		const band = document.querySelector('[data-testid="action-band"]')!;
		const card = band.querySelector<HTMLButtonElement>(`[data-tender-mode="${CARD}"]`)!;
		expect(card, "the register's own methods, not a fixed four").toBeTruthy();
		expect(card.getAttribute("aria-pressed")).toBe("false");

		card.click();
		await settle();

		expect(
			band.querySelector(`[data-tender-mode="${CARD}"]`)!.getAttribute("aria-pressed"),
			"the chip must arm from where it now lives",
		).toBe("true");
	});

	it("leaves the band's own geometry untouched", async () => {
		mountBand();
		fillCart();
		mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		// The 60px figure and the 134px card survived a whole programme; filling
		// the lane may not spend either. Both are declarations, so this asserts
		// the elements are still the ones `actionBandLayout.spec.ts` sizes.
		const band = document.querySelector('[data-testid="action-band"]')!;
		expect(band.querySelector(".action-band__number")).toBeTruthy();
		expect(band.querySelector(".action-band__spacer"), "PAY stays right-anchored").toBeTruthy();
	});
});

describe("a register with no band renders exactly what it rendered before", () => {
	it("keeps the money in the card when no target is given", async () => {
		fillCart();
		const summary = mountSummary();
		await settle();

		expect(summary.find('[data-testid="summary-breakdown"]').exists()).toBe(true);
		expect(summary.find('[data-testid="tender-strip"]').exists()).toBe(true);
		expect(
			summary.find(".summary-band-divider").exists(),
			"the band's divider is band chrome and has no business in the card",
		).toBe(false);
	});

	it("keeps the money in the card on a lean-vertical preset, target or not", async () => {
		// A lean preset runs the stacked layout at ANY width (vertical.py's
		// OVERRIDE_ALLOWLIST, merge: enable_only), so no band mounts and the
		// selector would resolve to nothing.
		verticalState.lean = true;
		fillCart();
		const summary = mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		expect(summary.find('[data-testid="tender-strip"]').exists()).toBe(true);
		expect(summary.findAll('[data-pos-keyboard-target="pay"]')).toHaveLength(1);
	});

	it("keeps the money in the card on a phone, target or not", async () => {
		viewport.width = 390;
		fillCart();
		const summary = mountSummary({
			bandBreakdownTarget: BREAKDOWN_TARGET,
			bandContextTarget: CONTEXT_TARGET,
		});
		await settle();

		expect(summary.find('[data-testid="tender-strip"]').exists()).toBe(true);
		expect(summary.findAll('[data-pos-keyboard-target="pay"]')).toHaveLength(1);
	});
});
