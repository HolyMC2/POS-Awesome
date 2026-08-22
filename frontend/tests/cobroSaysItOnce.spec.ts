// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import PaymentSaleSummary from "../src/posapp/components/pos/payments/PaymentSaleSummary.vue";

/**
 * The payment screen says a fact once — the same rule
 * `registerSaysItOnce.spec.ts` holds over the sale surface, applied to the
 * surface §12 item B adds.
 *
 * A line-by-line summary is a LOT of money figures: six lines is six more than
 * the screen had. Two properties keep that from becoming noise:
 *
 *   1. every figure DECLARES what it is (`data-money-role`), so a seventh
 *      cannot appear unremarked;
 *   2. the summary claims NO total. Our payment screen already carries the
 *      breakdown in `InvoiceTotals` one column over — Net Total, Tax and
 *      Charges, Grand Total — and the band owns the change. `Cobro.dc.html`
 *      closes its summary card with Subtotal / IVA / Total because it is
 *      drawn as a standalone screen; drawing them again here would put the
 *      ticket's total on the screen twice, which is precisely the defect
 *      W25-A removed from the sale surface.
 */

/**
 * A marker no formatter would produce, so counting occurrences in the rendered
 * HTML counts MONEY FIGURES rather than incidental digits.
 */
const MONEY = "¤";

const money = (value: number) => `${MONEY}${value.toFixed(2)}`;

const CART = [
	{
		item_code: "COMBO-IP15",
		item_name: "Combo Protección iPhone 15 Pro",
		qty: 1,
		rate: 299,
		amount: 299,
		posa_combo_components: [
			{ item_code: "CASE-15", qty: 1, rate: 200 },
			{ item_code: "MICA-15", qty: 1, rate: 80 },
			{ item_code: "INSTAL", qty: 1, rate: 60 },
		],
	},
	{ item_code: "IPN001545", item_name: "Anillo Case iPhone 12 Pro Max", qty: 1, rate: 200, amount: 200 },
	{ item_code: "IPN001880", item_name: "Adaptador Apple Lightning", qty: 2, rate: 120, amount: 240 },
];

const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

const mountSummary = (props: Record<string, unknown> = {}) =>
	mount(PaymentSaleSummary, {
		props: {
			items: CART,
			formatCurrency: money,
			wallet: { loyaltyProgram: "Puntos Doco", loyaltyValue: 418, accrual: 29.2 },
			...props,
		},
	});

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("every money figure declares what it is", () => {
	it("leaves no unlabelled figure on the summary", () => {
		const wrapper = mountSummary();
		const figures = countMoney(wrapper.html());
		const declared = wrapper.findAll("[data-money-role]");

		expect(
			figures,
			"a money figure with no data-money-role is exactly how the third total got on screen",
		).toBe(declared.length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", () => {
		for (const element of mountSummary().findAll("[data-money-role]")) {
			expect(countMoney(element.html())).toBe(1);
		}
	});

	it("declares the roles it actually renders and no others", () => {
		const roles = mountSummary()
			.findAll("[data-money-role]")
			.map((element) => element.attributes("data-money-role"));

		expect(roles.filter((role) => role === "line")).toHaveLength(3);
		expect(roles.filter((role) => role === "line-saving")).toHaveLength(1);
		expect(roles.filter((role) => role === "wallet")).toHaveLength(1);
		expect(roles.filter((role) => role === "wallet-accrual")).toHaveLength(1);
	});
});

describe("the summary claims no total", () => {
	it("renders zero figures declared as the total", () => {
		expect(mountSummary().findAll('[data-money-role="total"]')).toHaveLength(0);
	});

	it("renders no subtotal or tax line either", () => {
		// Both are already on this screen, in `InvoiceTotals`. Restating them
		// beside the lines is how one number becomes three.
		const text = mountSummary().text();
		expect(text).not.toMatch(/subtotal/i);
		expect(text).not.toMatch(/\bIVA\b|tax/i);
	});
});
