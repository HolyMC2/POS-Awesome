// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import PaymentSaleSummary from "../src/posapp/components/pos/payments/PaymentSaleSummary.vue";
import CobroTotalsFooter from "../src/posapp/components/pos/payments/cobro/CobroTotalsFooter.vue";
import CobroTenderPad from "../src/posapp/components/pos/payments/cobro/CobroTenderPad.vue";
import CobroMethodRows from "../src/posapp/components/pos/payments/cobro/CobroMethodRows.vue";
import CobroChangeCard from "../src/posapp/components/pos/payments/cobro/CobroChangeCard.vue";

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
		// The lines card states the LINES. Subtotal, IVA and Total are the
		// card BELOW it on the Cobro surface (`CobroTotalsFooter`) and
		// `InvoiceTotals` everywhere else; restating them among the lines is
		// how one number becomes three.
		const text = mountSummary().text();
		expect(text).not.toMatch(/subtotal/i);
		expect(text).not.toMatch(/\bIVA\b|tax/i);
	});
});

/**
 * ── The Cobro surface, column by column ──────────────────────────────────
 *
 * Owner, 2026-08-23: «every figure said once». The surface has four columns'
 * worth of money on it, so the rule is stated as an INVENTORY — mount each
 * column, collect what it declares, and assert the union has no duplicates.
 *
 * What is deliberately NOT a declared figure: the amount input on a method
 * row. It is a CONTROL — the field a cashier types into — and the same
 * reasoning exempts `PaymentSummary`'s read-only fields, which declare no
 * role either. A figure is a statement the screen makes; an input is a
 * statement the cashier makes.
 */
const CASH = { mode_of_payment: "Efectivo", amount: 1200, default: 1, type: "Cash" };
const CARD_ROW = { mode_of_payment: "Tarjeta", amount: 0, default: 0, type: "Bank" };

const rolesOf = (wrapper: { findAll: (_selector: string) => any[] }) =>
	wrapper.findAll("[data-money-role]").map((element) => element.attributes("data-money-role"));

const mountTotals = () =>
	mount(CobroTotalsFooter, {
		props: {
			subtotal: 973.28,
			taxLabel: "IVA 16 %",
			tax: 155.72,
			discount: 41,
			total: 1129,
			formatCurrency: money,
			currencySymbol: "$",
		},
	});

const mountPad = () =>
	mount(CobroTenderPad, {
		props: {
			payments: [{ ...CASH }, { ...CARD_ROW }],
			currency: "MXN",
			formatCurrency: (value: number) => money(value),
			getVisibleDenominations: () => [1150, 1200],
		},
	});

const mountMethods = () =>
	mount(CobroMethodRows, {
		props: {
			payments: [{ ...CASH }, { ...CARD_ROW }],
			currency: "MXN",
			currencySymbol: () => "$",
			formatCurrency: (value: number) => money(value),
			isNumber: () => true,
			isCashLikePayment: (payment: { type?: string }) => payment?.type === "Cash",
			isMpesaC2bPayment: () => false,
		},
	});

const mountChange = () =>
	mount(CobroChangeCard, {
		props: {
			total: 1129,
			tendered: 1200,
			currency: "MXN",
			formatCurrency: (value: number) => money(value),
		},
	});

describe("the Cobro columns state each figure once", () => {
	it("puts the ticket's totals in column one, and only there", () => {
		expect(rolesOf(mountTotals()).sort()).toEqual(["discount", "subtotal", "tax", "total"]);
		for (const column of [mountPad(), mountMethods(), mountChange()]) {
			for (const role of ["subtotal", "tax", "discount", "total"]) {
				expect(rolesOf(column)).not.toContain(role);
			}
		}
	});

	it("puts the outcome in column three, and only there", () => {
		// `Recibido`, `Falta por cubrir` and `Cambio a entregar` — the three
		// figures a cashier reads to know where the sale stands. The band
		// repeats the change alone, as its ONE number, which is the band's job.
		const roles = rolesOf(mountChange());
		expect(roles).toContain("change");
		expect(roles).toContain("received");
		expect(roles).toContain("shortfall");
		for (const column of [mountPad(), mountMethods(), mountTotals()]) {
			for (const role of ["change", "received", "shortfall"]) {
				expect(rolesOf(column)).not.toContain(role);
			}
		}
	});

	it("leaves column two with the amount being keyed and the shortcuts", () => {
		// The pad states nothing about the sale. Its display is the ENTRY
		// buffer — 0.00 until a digit is pressed — and the presets are offers,
		// not facts.
		expect(new Set(rolesOf(mountPad()))).toEqual(new Set(["keyed", "preset"]));
		// The chips carry the amount that sits on each tender, and it declares
		// no role for the same reason the input it replaced declared none: it
		// is a restatement of the cashier's own entry, not a fact the screen is
		// asserting about the sale. What the sale comes to is column one's, and
		// where it stands is column three's.
		expect(rolesOf(mountMethods())).toEqual([]);
		// NO INPUT AT ALL (2026-08-30). Focusing one on a tablet summoned the
		// OS keyboard over the numpad — `cobroControlPanel.spec.ts` carries the
		// full reasoning and the `payment-action` focus target.
		expect(mountMethods().findAll("input").length).toBe(0);
	});

	it("declares no role twice across the whole surface", () => {
		const declared = [mountTotals(), mountPad(), mountMethods(), mountChange()].flatMap(rolesOf);
		// Roles that legitimately repeat are the per-ROW ones: a line, a preset
		// chip, a denomination note. Everything else is a fact about the sale
		// and may appear exactly once.
		const perRow = new Set(["line", "line-saving", "preset", "change-note"]);
		const singular = declared.filter((role) => !perRow.has(role as string));
		expect(new Set(singular).size, `duplicated: ${singular.join(", ")}`).toBe(singular.length);
	});
});
