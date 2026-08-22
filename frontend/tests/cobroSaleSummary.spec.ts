// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import PaymentSaleSummary from "../src/posapp/components/pos/payments/PaymentSaleSummary.vue";
import {
	isComboSummaryLine,
	resolveSaleSummary,
} from "../src/posapp/components/pos/payments/saleSummary";

/**
 * The sale, line by line, on the payment screen (§12 item B).
 *
 * Two things are under test. The module decides WHAT the cashier is told the
 * money is for; the component decides whether they are told it twice. The
 * second one is the reason this file also mounts — the desk keeps the cart on
 * screen beside the payment column, and a summary there would be the same six
 * lines rendered a second time.
 */

const money = (value: number) => `¤${value.toFixed(2)}`;

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
	{ item_code: "IPN001545", item_name: "Anillo Case iPhone 12 Pro Max Negro", qty: 1, rate: 200, amount: 200 },
	{ item_code: "IPN001880", item_name: "Adaptador Apple Lightning a Jack 3.5 mm", qty: 2, rate: 120, amount: 240 },
];

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("what the cashier is told the money is for", () => {
	it("renders every cart line, in cart order", () => {
		const summary = resolveSaleSummary(CART);
		expect(summary.lines.map((line) => line.itemCode)).toEqual([
			"COMBO-IP15",
			"IPN001545",
			"IPN001880",
		]);
		expect(summary.lineCount).toBe(3);
		expect(summary.pieceCount).toBe(4);
	});

	it("carries a combo as one line, with its parts and what they saved", () => {
		const [combo] = resolveSaleSummary(CART).lines;
		expect(combo?.isCombo).toBe(true);
		expect(combo?.componentCount).toBe(3);
		// 200 + 80 + 60 = 340 at list, sold at 299.
		expect(combo?.saving).toBe(41);
	});

	it("multiplies a combo's saving by the number of combos on the line", () => {
		// Two of the same combo saved twice. A per-combo figure on a qty-2 line
		// understates the discount the shop actually gave.
		const [combo] = resolveSaleSummary([{ ...CART[0], qty: 2, amount: 598 }]).lines;
		expect(combo?.saving).toBe(82);
	});

	it("claims no saving for a combo priced at or above its parts", () => {
		// A shop may bundle for convenience. "ahorró $0" is noise, and a
		// negative saving reads as a surcharge nobody agreed to.
		const [combo] = resolveSaleSummary([{ ...CART[0], rate: 400, amount: 400 }]).lines;
		expect(combo?.saving).toBe(0);
	});

	it("treats a BROKEN combo as an ordinary line", () => {
		// Its components no longer resolve, so "3 artículos · ahorró $41" is a
		// claim about a bundle the register can no longer describe. Same
		// predicate the cart uses, so the two surfaces cannot disagree.
		const broken = { ...CART[0], posa_combo_broken: 1 };
		expect(isComboSummaryLine(broken)).toBe(false);
		expect(resolveSaleSummary([broken]).lines[0]?.isCombo).toBe(false);
	});

	it("prefers the line's own amount over its own multiplication", () => {
		// The repricing pipeline wrote 180 after a line discount; qty × rate is
		// 200. Preferring the multiplication is how a summary quietly disagrees
		// with the total the customer is being charged.
		const [line] = resolveSaleSummary([
			{ item_code: "A", item_name: "A", qty: 1, rate: 200, amount: 180 },
		]).lines;
		expect(line?.amount).toBe(180);
	});

	it("falls back to qty × rate only when the line carries no amount", () => {
		const [line] = resolveSaleSummary([{ item_code: "A", item_name: "A", qty: 3, rate: 25 }]).lines;
		expect(line?.amount).toBe(75);
	});

	it("drops a half-built row rather than printing a blank line and a zero", () => {
		expect(resolveSaleSummary([{ qty: 1, rate: 10 }, null, undefined]).lines).toEqual([]);
	});

	it("survives an absent cart", () => {
		expect(resolveSaleSummary(null).lineCount).toBe(0);
		expect(resolveSaleSummary(undefined).pieceCount).toBe(0);
	});
});

describe("the summary renders where the cart is not", () => {
	const mountSummary = (props: Record<string, unknown> = {}) =>
		mount(PaymentSaleSummary, {
			props: { items: CART, formatCurrency: money, ...props },
		});

	it("draws one row per cart line, including the combo", () => {
		const wrapper = mountSummary();
		expect(
			wrapper.findAll('[data-testid="pay-summary-line"], [data-testid="pay-summary-line-combo"]'),
		).toHaveLength(3);
		expect(wrapper.findAll('[data-testid="pay-summary-line-combo"]')).toHaveLength(1);
		expect(wrapper.find('[data-testid="pay-summary-combo-meta"]').text()).toContain("3 items");
		expect(wrapper.find('[data-testid="pay-summary-combo-meta"]').text()).toContain("saved");
	});

	it("prints the unit rate only where there is more than one", () => {
		const rows = mountSummary().findAll('[data-testid="pay-summary-line"]');
		// `IPN001545 · 1 ×` — the rate would restate the amount on the same row.
		expect(rows[0]?.text()).toContain("IPN001545 · 1 ×");
		expect(rows[1]?.text()).toContain("IPN001880 · 2 × ¤120.00");
	});

	it("states the line and piece count once", () => {
		expect(mountSummary().find('[data-testid="pay-summary-count"]').text()).toBe(
			"3 lines · 4 pcs",
		);
	});

	it("does NOT render while the cart is on screen beside it", () => {
		// The desk's anchored layout keeps the cart column. Two copies of the
		// same six lines is duplication, not convergence — the defect W25-A
		// removed from the sale surface.
		expect(mountSummary({ cartOnScreen: true }).find('[data-testid="pay-sale-summary"]').exists()).toBe(
			false,
		);
	});

	it("does not render an empty card on an empty cart", () => {
		expect(mountSummary({ items: [] }).find('[data-testid="pay-sale-summary"]').exists()).toBe(
			false,
		);
	});

	it("renders no warranty block, because no read model exists for one", () => {
		// `Cobro.dc.html` promises "Fundas y adaptadores · 30 días". Nothing in
		// posawesome reads `Item.warranty_period`, no warranty reaches a cart
		// line, and no per-category policy exists. A printed promise the system
		// cannot honour is worse than a silent one — see the task report.
		// `.text()` rather than `.html()`: the component's own source comment
		// explains the absence, and scanning the markup would match the
		// explanation instead of the render.
		expect(mountSummary().text()).not.toMatch(/warrant|garant/i);
	});
});
