// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

/**
 * The register must say a fact ONCE.
 *
 * `tests/bandOwnsTheLane.spec.ts` already counts across the summary/band seam,
 * and it was green while a live register showed THREE money figures stacked
 * above the band — because it counts only *undemoted* heroes
 * (`.summary-hero:not(.summary-hero--band-owns-lane) .summary-hero__amount`).
 * A figure that had been demoted with CSS was excluded from the count by
 * construction, so the demotion both caused the duplication and hid it from
 * the test meant to catch it.
 *
 * This file counts differently, and the difference is the point:
 *
 *   - it counts EVERY money figure the summary renders, not the big ones, so a
 *     fourth cannot appear unremarked;
 *   - it requires each of them to DECLARE what it is (`data-money-role`), so
 *     "it's only a breakdown" has to be stated in the markup rather than
 *     assumed by a reader;
 *   - and it holds the totals count at one across both lane states, so the
 *     lean-vertical register (which has no band) is covered by the same rule
 *     as the desktop one.
 *
 * The other two duplications the same screenshot showed — the customer named
 * twice and the line count rendered twice in two different formats — are
 * source-scanned in `registerSaysItOnceSource.spec.ts`, which runs under the
 * node environment because `node:fs` named imports do not interop under jsdom
 * (build plan §10).
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
import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

/**
 * A marker no formatter would produce, so counting occurrences in the rendered
 * HTML counts MONEY FIGURES rather than incidental digits — a `$` would also
 * match a price typed into a placeholder, and `9` matches half the document.
 */
const MONEY = "¤";

const summaryProps = {
	pos_profile: {
		currency: "MXN",
		posa_use_percentage_discount: 0,
		posa_allow_user_to_edit_additional_discount: 1,
	},
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

const mountSummary = () =>
	mount(InvoiceSummary, {
		props: { ...summaryProps },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

/**
 * Money figures on the SALE SURFACE — the card as a cashier sees it, with any
 * dialog's own subtree subtracted.
 *
 * `DiscountDialog` renders two figures of its own (the amount-mode toggle and
 * a "New total" preview). Both are right in their own surface and neither is
 * on screen while the dialog is closed, so counting them here would fail the
 * invariant for a duplication that does not exist. It is subtracted rather
 * than stubbed because VTU's string `stubs` do not reliably intercept a
 * component imported into `<script setup>` — it resolves from the setup scope,
 * not the component registry, and the real dialog rendered straight through
 * the stub.
 */
const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

const moneyOnSaleSurface = (summary: ReturnType<typeof mountSummary>) => {
	const dialog = summary.find('[data-testid="discount-dialog"]');
	return countMoney(summary.html()) - (dialog.exists() ? countMoney(dialog.html()) : 0);
};

const mountBand = () =>
	mount(ActionBand, {
		props: {
			state: resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }),
			formatCurrency: (value: number) => String(value),
		},
	});

beforeEach(() => {
	setActivePinia(createPinia());
	viewport.width = 1400;
	verticalState.lean = false;
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		datetime: { nowdate: () => "2026-08-22" },
	});
	vi.stubGlobal("__", (value: string) => value);
});

describe("every money figure declares what it is", () => {
	it("leaves no unlabelled figure on the desktop register", () => {
		const summary = mountSummary();
		const figures = moneyOnSaleSurface(summary);
		const declared = summary.findAll("[data-money-role]");

		expect(
			figures,
			"a money figure with no data-money-role is exactly how the third total got on screen",
		).toBe(declared.length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", () => {
		const summary = mountSummary();
		for (const element of summary.findAll("[data-money-role]")) {
			expect(countMoney(element.html())).toBe(1);
		}
	});

	it("shows the subtotal as a labelled breakdown, not as a second total", () => {
		const summary = mountSummary();
		const subtotal = summary.find('[data-testid="summary-subtotal"]');

		expect(subtotal.exists()).toBe(true);
		expect(subtotal.attributes("data-money-role")).toBe("breakdown");
		// The label is what makes it unmistakable; type size is not enough,
		// which is what the demoted-hero version proved on a live register.
		expect(summary.find('[data-testid="summary-breakdown"]').text()).toContain("Subtotal");
	});
});

describe("exactly one total, in either lane state", () => {
	it("desktop: the band owns it and the summary claims none", () => {
		const summary = mountSummary();
		const band = mountBand();

		const totals =
			summary.findAll('[data-money-role="total"]').length +
			band.findAll('[data-testid="band-value"]').length;

		expect(totals, "two totals on one screen is the defect").toBe(1);
	});

	it("lean-vertical: no band mounts, so the summary keeps the total", () => {
		// A lean preset runs the stacked layout at ANY width (vertical.py's
		// OVERRIDE_ALLOWLIST, merge: enable_only), so the card is the lane.
		verticalState.lean = true;
		const summary = mountSummary();

		expect(summary.findAll('[data-money-role="total"]').length).toBe(1);
		expect(summary.findAll('[data-money-role="breakdown"]').length).toBe(0);
	});
});
