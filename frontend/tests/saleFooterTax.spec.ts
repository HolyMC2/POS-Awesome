// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

/**
 * The IVA line — the completeness half of the footer's convergence.
 *
 * `Main.dc.html` breaks the total down as `Subtotal · IVA 16 % · Descuento`;
 * ours stated only the first and the last. IVA is the line a Mexican operator
 * actually reads, and it is the one an accountant checks afterwards, so this
 * file holds it to three properties:
 *
 *   1. the RATE is derived, never a constant — 16 % is that shop's rate;
 *   2. the AMOUNT reconciles with the band's total, which means the inclusive
 *      formula cannot quietly become the exclusive one (they differ by 25 pesos
 *      on the canvas's own ticket and both look plausible in a screenshot);
 *   3. the figure DECLARES what it is, so `registerSaysItOnce.spec.ts` counts
 *      it — and the last section mutation-tests that guard rather than
 *      trusting that it still bites.
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
import { resolveTaxBreakdown } from "../src/posapp/components/pos/invoice/saleTaxBreakdown";

/** Ticket B-04812, the money every band and footer spec in this wave is pinned to. */
const TICKET_TOTAL = 1129;
const TICKET_NET = 973.28;
const TICKET_IVA = 155.72;

const IVA_INCLUSIVE = { description: "IVA", rate: 16, included_in_print_rate: 1 };

/** A marker no formatter produces, so counting it counts MONEY FIGURES. */
const MONEY = "¤";

const round = (value: number) => Number(value.toFixed(2));

const baseProps = {
	pos_profile: {
		currency: "MXN",
		posa_use_percentage_discount: 0,
		posa_allow_user_to_edit_additional_discount: 1,
	},
	total_qty: 9,
	additional_discount: 0,
	additional_discount_percentage: 0,
	total_items_discount_amount: 0,
	subtotal: TICKET_TOTAL,
	displayCurrency: "MXN",
	formatFloat: (value: number) => String(value),
	formatCurrency: (value: number) => Number(value).toFixed(2),
	currencySymbol: () => MONEY,
	discount_percentage_offer_name: "",
	isNumber: () => true,
	return_discount_meta: null,
};

const mountSummary = () =>
	mount(InvoiceSummary, {
		props: { ...baseProps },
		global: {
			stubs: { ParkedOrdersList: true, DocumentSourceSelector: true },
			mocks: { __: (value: string) => value, frappe: { _: (value: string) => value } },
		},
	});

const withTaxRows = (taxes: unknown[]) => {
	useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 9, rate: 125.44 }]);
	useInvoiceStore().setInvoiceDoc({ name: "ACC-SINV-0001", taxes });
};

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

describe("the rate comes from the ticket, not from the code", () => {
	it("reads the invoice document's own tax rows first", () => {
		const breakdown = resolveTaxBreakdown({
			docTaxes: [IVA_INCLUSIVE],
			template: { taxes: [{ description: "IVA", rate: 8, included_in_print_rate: 1 }] },
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});

		// The doc describes THIS ticket. A profile that changed mid-shift must
		// not restate an old document's tax at the new template's rate.
		expect(breakdown?.rate).toBe(16);
	});

	it("falls back to the shift's cached tax template, which is the live sale's only source", () => {
		// A fresh sale never round-trips its doc — `update_invoice` is called
		// only by `update_exchange_rate_on_server` — so without this source the
		// pair would be dark on exactly the path it exists for.
		const breakdown = resolveTaxBreakdown({
			docTaxes: [],
			template: { taxes: [IVA_INCLUSIVE] },
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});

		expect(breakdown?.rate).toBe(16);
		expect(round(breakdown?.amount ?? 0)).toBe(TICKET_IVA);
	});

	it("states whatever rate the register carries, including zero", () => {
		// §4.2's alimentos case, on a ticket that is entirely exento: `IVA 0 %`
		// is information — it tells the cashier the ticket carries no tax — while
		// no line at all would leave them guessing.
		const breakdown = resolveTaxBreakdown({
			template: { taxes: [{ description: "IVA", rate: 0, included_in_print_rate: 1 }] },
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});

		expect(breakdown?.label).toBe("IVA 0 %");
		expect(breakdown?.amount).toBe(0);
		expect(breakdown?.net).toBe(TICKET_TOTAL);
	});

	it("uses the tenant's own word for the tax, and does not print the rate twice", () => {
		const named = resolveTaxBreakdown({
			template: { taxes: [{ description: "IVA 16%", rate: 16, included_in_print_rate: 1 }] },
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});
		// The template already states it; `IVA 16% 16 %` is worse than either half.
		expect(named?.label).toBe("IVA 16%");

		const blank = resolveTaxBreakdown({
			template: { taxes: [{ description: "", rate: 16 }] },
			subtotal: TICKET_TOTAL,
			taxLabel: "Impuesto",
		});
		// Only the blank-description fallback is translated; a description is
		// DATA and never goes through `__()`.
		expect(blank?.label).toBe("Impuesto 16 %");
	});
});

describe("the amount reconciles with the band's total", () => {
	it("divides the tax OUT of a tax-inclusive ticket", () => {
		const breakdown = resolveTaxBreakdown({
			docTaxes: [IVA_INCLUSIVE],
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});

		expect(round(breakdown?.net ?? 0)).toBe(TICKET_NET);
		expect(round(breakdown?.amount ?? 0)).toBe(TICKET_IVA);
		// The canvas's own arithmetic: 973.28 + 155.72 = 1,129.00.
		expect(round((breakdown?.net ?? 0) + (breakdown?.amount ?? 0))).toBe(TICKET_TOTAL);
	});

	it("does not confuse it with the exclusive formula, which is 25 pesos out", () => {
		// `subtotal × rate / 100` on an inclusive ticket over-states a 16 % IVA
		// by 16 % of itself — 180.64 instead of 155.72. Both are plausible
		// two-decimal figures on a screenshot; only one is the tax.
		const inclusive = resolveTaxBreakdown({
			docTaxes: [IVA_INCLUSIVE],
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});
		expect(round(inclusive?.amount ?? 0)).not.toBe(round((TICKET_TOTAL * 16) / 100));
	});

	it("adds it ON TOP of a tax-exclusive ticket, and leaves the base alone", () => {
		const breakdown = resolveTaxBreakdown({
			docTaxes: [{ description: "IVA", rate: 16, included_in_print_rate: 0 }],
			subtotal: 973.28,
			taxLabel: "Tax",
		});

		expect(breakdown?.inclusive).toBe(false);
		expect(breakdown?.net).toBe(973.28);
		expect(round(breakdown?.amount ?? 0)).toBe(TICKET_IVA);
	});

	it("tracks the live cart rather than the row's stored tax_amount", () => {
		// The doc is built once and the cart keeps moving. A tax figure that has
		// stopped tracking the cart, beside a band that has not, is worse than no
		// figure: it makes the register look like it disagrees with itself.
		const stale = resolveTaxBreakdown({
			docTaxes: [{ ...IVA_INCLUSIVE, tax_amount: 9999 }],
			subtotal: TICKET_TOTAL,
			taxLabel: "Tax",
		});

		expect(round(stale?.amount ?? 0)).toBe(TICKET_IVA);
	});
});

describe("it refuses to state a tax it cannot work out", () => {
	it.each([
		["no tax source at all", { subtotal: TICKET_TOTAL }],
		["an empty template", { template: { taxes: [] }, subtotal: TICKET_TOTAL }],
		[
			"a composed charge type it cannot reproduce from a subtotal",
			{
				docTaxes: [{ description: "IVA", rate: 16, charge_type: "On Previous Row Amount" }],
				subtotal: TICKET_TOTAL,
			},
		],
		[
			"two rates on one ticket, which needs a per-item tax category",
			{
				template: {
					taxes: [
						{ description: "IVA", rate: 16, included_in_print_rate: 1 },
						{ description: "IVA", rate: 0, included_in_print_rate: 1 },
					],
				},
				subtotal: TICKET_TOTAL,
			},
		],
		["a subtotal that is not a number", { docTaxes: [IVA_INCLUSIVE], subtotal: "" }],
	])("renders nothing for %s", (_case, input) => {
		// Null, never a zero: `IVA $0.00` is a claim about the ticket, and "we
		// cannot work this out from here" is not that claim.
		expect(resolveTaxBreakdown({ ...(input as object), taxLabel: "Tax" })).toBeNull();
	});
});

describe("the footer renders it as a labelled, declared figure", () => {
	it("shows the rate beside the tenant's word for the tax", () => {
		withTaxRows([IVA_INCLUSIVE]);
		const wrapper = mountSummary();

		expect(wrapper.find('[data-testid="summary-tax-label"]').text()).toBe("IVA 16 %");
		expect(wrapper.find('[data-testid="summary-tax"]').text()).toBe(`${MONEY}${TICKET_IVA}`);
	});

	it("restates the subtotal as the pre-tax base, so the three figures reconcile", () => {
		withTaxRows([IVA_INCLUSIVE]);
		const wrapper = mountSummary();

		// Without a tax line beside it, "Subtotal 1,129.00" under a band reading
		// 1,129.00 is only redundant. With one, it would be wrong.
		expect(wrapper.find('[data-testid="summary-subtotal"]').text()).toBe(
			`${MONEY}${TICKET_NET}`,
		);
	});

	it("declares its money role, which is what makes it countable", () => {
		withTaxRows([IVA_INCLUSIVE]);
		const wrapper = mountSummary();

		expect(wrapper.find('[data-testid="summary-tax"]').attributes("data-money-role")).toBe("tax");
		// A breakdown figure, emphatically not a second total.
		expect(wrapper.findAll('[data-money-role="total"]')).toHaveLength(0);
	});

	it("leaves the breakdown at two pairs on a register with no tax template", () => {
		useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 9, rate: 125.44 }]);
		const wrapper = mountSummary();

		expect(wrapper.find('[data-testid="summary-tax"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="summary-subtotal"]').text()).toBe(
			`${MONEY}${TICKET_TOTAL.toFixed(2)}`,
		);
	});
});

/* --------------------------------------------------------- the guard itself */

const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;
const countRoles = (html: string) => (html.match(/data-money-role=/g) || []).length;
/** The rule `registerSaysItOnce.spec.ts` enforces, restated so it can be broken. */
const everyFigureDeclaresItself = (figures: number, declared: number) => figures === declared;

describe("the money-role guard still bites", () => {
	/**
	 * This guard caught a THIRD total on a live register once already, and a
	 * guard is only worth what its sensitivity is. Adding a figure to the
	 * breakdown is precisely the change that could leave it counting a constant
	 * against itself, so the mutations below break the rendered output in the
	 * two ways a real regression would and require it to go red for both.
	 */
	/**
	 * The sale surface, with `DiscountDialog`'s own subtree subtracted by COUNT
	 * rather than by string surgery. Both figures in that dialog are right in
	 * their own surface, neither is on screen while it is closed, and VTU
	 * re-indents a nested `html()` so a substring replace silently removes
	 * nothing — a trap this file walked into once already.
	 */
	const surface = () => {
		withTaxRows([IVA_INCLUSIVE]);
		const wrapper = mountSummary();
		const dialog = wrapper.find('[data-testid="discount-dialog"]');
		return { html: wrapper.html(), aside: dialog.exists() ? dialog.html() : "" };
	};

	const guardHolds = ({ html, aside }: { html: string; aside: string }) =>
		everyFigureDeclaresItself(countMoney(html) - countMoney(aside), countRoles(html) - countRoles(aside));

	it("holds on the real footer, with the IVA figure in it", () => {
		const rendered = surface();
		expect(guardHolds(rendered)).toBe(true);
		// And it is counting something: three declared figures, not zero.
		expect(countRoles(rendered.html) - countRoles(rendered.aside)).toBe(3);
	});

	it("goes red when a figure appears with no role — how the third total got on screen", () => {
		const rendered = surface();
		expect(guardHolds({ ...rendered, html: `${rendered.html}<span>${MONEY}457.00</span>` })).toBe(
			false,
		);
	});

	it("goes red when a declared figure loses its declaration", () => {
		// `replace` with a string hits the FIRST occurrence only: exactly one
		// figure stops declaring itself, which is the smallest possible break.
		const rendered = surface();
		expect(
			guardHolds({ ...rendered, html: rendered.html.replace("data-money-role=", "data-role=") }),
		).toBe(false);
	});

	it("counts the IVA figure, rather than being blind to the new one", () => {
		const withTax = countRoles(surface().html);

		setActivePinia(createPinia());
		useInvoiceStore().setItems([{ item_code: "IPN001545", qty: 9, rate: 125.44 }]);
		const withoutTax = countRoles(mountSummary().html());

		expect(withTax - withoutTax).toBe(1);
	});
});
