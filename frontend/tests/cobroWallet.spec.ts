// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import PaymentSaleSummary from "../src/posapp/components/pos/payments/PaymentSaleSummary.vue";
import { resolveWalletSummary } from "../src/posapp/components/pos/payments/walletSummary";

/**
 * The customer's wallet on the payment screen (§12 item B).
 *
 * The artboard makes two claims — a balance and an accrual — and only one of
 * them has a read model in this product. These cases hold the line at exactly
 * that: what is read is shown, what is not is silent, and the two wallets a
 * register can carry are never merged into one figure.
 */

const money = (value: number) => `¤${value.toFixed(2)}`;

const CART = [{ item_code: "A", item_name: "Anillo Case", qty: 1, rate: 200, amount: 200 }];

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("which wallet the card describes", () => {
	it("names the MONEDERO even when the customer is also enrolled", () => {
		// The ordering this replaces put loyalty first whenever there was a
		// programme, which on demo.lab drew «Puntos del cliente $0.00» over a
		// customer holding $200 of spendable monedero — the one number the
		// cashier cannot act on, in place of the one they can. The contact view
		// and `get_customer_wallet` have always called the monedero the headline.
		const wallet = resolveWalletSummary({
			loyaltyProgram: "Cashback Demo",
			loyaltyValue: 0,
			storedValueBalance: 200,
		});
		expect(wallet).toMatchObject({ visible: true, kind: "stored-value", balance: 200 });
	});

	it("shows stored value when there is no programme", () => {
		const wallet = resolveWalletSummary({ storedValueBalance: 418 });
		expect(wallet).toMatchObject({ visible: true, kind: "stored-value", balance: 418 });
	});

	it("falls back to the points when they are the only wallet there is", () => {
		// A register with a points programme and no stored-value ledger is a real
		// configuration, and there the points ARE the wallet.
		const wallet = resolveWalletSummary({ loyaltyProgram: "Puntos Doco", loyaltyValue: 418 });
		expect(wallet).toMatchObject({ visible: true, kind: "loyalty", balance: 418 });
	});

	it("keeps an enrolled customer's card at zero, because zero points is a fact", () => {
		expect(resolveWalletSummary({ loyaltyProgram: "P", loyaltyValue: 0 })).toMatchObject({
			visible: true,
			kind: "loyalty",
			balance: 0,
		});
	});

	it("renders nothing for a walk-in with neither wallet", () => {
		expect(resolveWalletSummary({}).visible).toBe(false);
		expect(resolveWalletSummary({ storedValueBalance: 0 }).visible).toBe(false);
	});

	it("renders nothing when the balance is UNKNOWN rather than zero", () => {
		// `stored_value_balance` is only returned when a company was passed, and
		// offline it comes from a snapshot that may be absent. A zero we
		// invented is indistinguishable from a zero we read, and the customer is
		// standing there.
		expect(resolveWalletSummary({ loyaltyProgram: "P", loyaltyValue: null }).visible).toBe(false);
		expect(resolveWalletSummary({ storedValueBalance: null }).visible).toBe(false);
	});

	it("renders nothing on a refund", () => {
		expect(
			resolveWalletSummary({ loyaltyProgram: "P", loyaltyValue: 418, isReturn: true }).visible,
		).toBe(false);
	});
});

describe("the accrual is only ever a read value", () => {
	it("is null when nothing supplied one", () => {
		// The read model exists now (`stored_value.get_cashback_preview`, wired
		// through `useRedemptionLogic.cashback_accrual`), but this module has
		// not changed its mind: it draws what it is handed and invents nothing.
		// Registers with customer cards off, unenrolled customers and offline
		// sales all still arrive here with no accrual at all.
		expect(resolveWalletSummary({ loyaltyProgram: "P", loyaltyValue: 418 }).accrual).toBeNull();
	});

	it("shows the accrual when a real one is handed in", () => {
		expect(
			resolveWalletSummary({ loyaltyProgram: "P", loyaltyValue: 418, accrual: 29.2 }).accrual,
		).toBe(29.2);
	});

	it("refuses an accrual for a customer who is not enrolled", () => {
		// The accrual is a claim about the customer's CARD, and an unenrolled
		// customer has none — `get_cashback_preview` gates on `enrolled` and
		// answers nothing else. A number arriving here for a walk-in is a fault
		// upstream, and «Acumula» beside their monedero would be a lie with a
		// number on it.
		expect(resolveWalletSummary({ storedValueBalance: 418, accrual: 29.2 }).accrual).toBeNull();
	});

	it("carries the accrual under the MONEDERO for an enrolled customer", () => {
		// The card the artboard draws, and the one demo.lab now renders: the
		// balance the till can take, and on its own line what this sale earns.
		// Two lines, never one sum.
		expect(
			resolveWalletSummary({
				loyaltyProgram: "Cashback Demo",
				loyaltyValue: 0,
				storedValueBalance: 200,
				accrual: 40,
			}),
		).toMatchObject({ visible: true, kind: "stored-value", balance: 200, accrual: 40 });
	});

	it("refuses a negative or unparseable accrual", () => {
		const base = { loyaltyProgram: "P", loyaltyValue: 418 };
		expect(resolveWalletSummary({ ...base, accrual: -5 }).accrual).toBeNull();
		expect(resolveWalletSummary({ ...base, accrual: Number.NaN }).accrual).toBeNull();
		expect(resolveWalletSummary({ ...base, accrual: 0 }).accrual).toBeNull();
	});
});

describe("what the card actually draws", () => {
	const mountSummary = (wallet: Record<string, unknown> | null) =>
		mount(PaymentSaleSummary, { props: { items: CART, formatCurrency: money, wallet } });

	it("draws the balance and omits the accrual line when there is no accrual", () => {
		const wrapper = mountSummary({ loyaltyProgram: "Puntos Doco", loyaltyValue: 418 });
		expect(wrapper.find('[data-testid="pay-summary-wallet"]').text()).toContain("¤418.00");
		expect(wrapper.find('[data-testid="pay-summary-wallet-accrual"]').exists()).toBe(false);
	});

	it("draws the accrual when the value is real", () => {
		const wrapper = mountSummary({
			loyaltyProgram: "Puntos Doco",
			loyaltyValue: 418,
			accrual: 29.2,
		});
		expect(wrapper.find('[data-testid="pay-summary-wallet-accrual"]').text()).toContain("¤29.20");
	});

	it("draws no wallet card at all for a customer without one", () => {
		expect(mountSummary(null).find('[data-testid="pay-summary-wallet"]').exists()).toBe(false);
	});

	it("draws BOTH artboard lines for an enrolled customer with a monedero", () => {
		// `Cobro.dc.html` nodes 50–54, and the demo.lab case that opened this:
		// Ana Sofía Torres, «Cashback Demo», $200 paid in, 0 points, $40 on a
		// $405 basket. The title is the monedero's, not the points'.
		const wrapper = mountSummary({
			loyaltyProgram: "Cashback Demo",
			loyaltyValue: 0,
			storedValueBalance: 200,
			accrual: 40,
		});
		const card = wrapper.find('[data-testid="pay-summary-wallet"]');
		expect(card.text()).toContain("Customer wallet");
		expect(card.text()).not.toContain("Customer points");
		expect(card.find('[data-money-role="wallet"]').text()).toBe("¤200.00");
		expect(wrapper.find('[data-testid="pay-summary-wallet-accrual"]').text()).toContain(
			"¤40.00",
		);
	});
});
