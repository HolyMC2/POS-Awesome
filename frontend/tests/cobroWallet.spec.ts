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
	it("shows the loyalty value when the customer is enrolled", () => {
		const wallet = resolveWalletSummary({
			loyaltyProgram: "Puntos Doco",
			loyaltyValue: 418,
			storedValueBalance: 999,
		});
		expect(wallet).toMatchObject({ visible: true, kind: "loyalty", balance: 418 });
	});

	it("shows stored value when there is no programme", () => {
		const wallet = resolveWalletSummary({ storedValueBalance: 418 });
		expect(wallet).toMatchObject({ visible: true, kind: "stored-value", balance: 418 });
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

	it("refuses to attach an accrual to a stored-value wallet", () => {
		// Stored value is topped up deliberately at the counter; it does not
		// accrue from a purchase. "Acumula" beside it would be a lie with a
		// number on it.
		expect(resolveWalletSummary({ storedValueBalance: 418, accrual: 29.2 }).accrual).toBeNull();
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
});
