// @vitest-environment jsdom

import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRedemptionLogic } from "../src/posapp/composables/pos/payments/useRedemptionLogic";
import { resolveWalletSummary } from "../src/posapp/components/pos/payments/walletSummary";

/**
 * «Acumula $Y con esta compra» — the socket `walletSummary.ts` deliberately
 * left null (`Cobro.dc.html` nodes 50–54).
 *
 * The rule these cases hold is not "show an accrual": it is that the accrual
 * is READ, never derived, and that everything which is not read still renders
 * as absence. A client-side `points × conversion_factor` would agree with the
 * posted accrual right up until a customer crossed a loyalty tier, and the
 * cashier reads this number aloud.
 */

const PROFILE = { company: "Doco SA", currency: "MXN", posa_use_customer_cards: 1 };
const ENROLLED = { loyalty_program: "Puntos Doco", loyalty_points: 40, conversion_factor: 1 };

let call: ReturnType<typeof vi.fn>;

const build = (overrides: Record<string, any> = {}) => {
	const invoiceDoc = ref<any>({
		customer: "CUST-0001",
		grand_total: 1090,
		rounded_total: 1090,
		currency: "MXN",
		conversion_rate: 1,
		...(overrides.invoice || {}),
	});
	const logic = useRedemptionLogic({
		invoiceDoc,
		posProfile: ref({ ...PROFILE, ...(overrides.profile || {}) }),
		customerInfo: ref({ ...ENROLLED, ...(overrides.customerInfo || {}) }),
		currencyPrecision: ref(2),
		formatFloat: (value: any) => Number(value || 0),
	});
	return { ...logic, invoiceDoc };
};

/** The watcher debounces, then the call resolves. */
const settle = async () => {
	await nextTick();
	vi.advanceTimersByTime(300);
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
	await nextTick();
};

beforeEach(() => {
	vi.useFakeTimers();
	call = vi.fn(async () => ({
		message: { enrolled: true, program: "Puntos Doco", points: 109, value: 29.2 },
	}));
	(globalThis as any).frappe = { call };
	(window as any).serverOnline = true;
});

afterEach(() => {
	vi.useRealTimers();
	delete (window as any).serverOnline;
});

describe("who gets an accrual at all", () => {
	it("asks the server for an enrolled customer on a card-enabled register", async () => {
		const { cashback_accrual } = build();
		await settle();

		expect(call).toHaveBeenCalledTimes(1);
		expect(call.mock.calls[0][0]).toBe(
			"posawesome.posawesome.api.stored_value.get_cashback_preview",
		);
		expect(call.mock.calls[0][1]).toMatchObject({
			customer: "CUST-0001",
			company: "Doco SA",
			eligible_amount: 1090,
		});
		expect(cashback_accrual.value).toBe(29.2);
	});

	it("asks nothing, and claims nothing, when the register has cards off", async () => {
		const { cashback_accrual } = build({ profile: { posa_use_customer_cards: 0 } });
		await settle();

		expect(call).not.toHaveBeenCalled();
		expect(cashback_accrual.value).toBeNull();
	});

	it("asks nothing for a customer who is not enrolled", async () => {
		const { cashback_accrual } = build({ customerInfo: { loyalty_program: "" } });
		await settle();

		expect(call).not.toHaveBeenCalled();
		expect(cashback_accrual.value).toBeNull();
	});

	it("asks nothing on a refund — a return does not accrue", async () => {
		const { cashback_accrual } = build({ invoice: { is_return: 1, grand_total: -300 } });
		await settle();

		expect(call).not.toHaveBeenCalled();
		expect(cashback_accrual.value).toBeNull();
	});

	it("asks nothing offline, because the tier lives on the server", async () => {
		(window as any).serverOnline = false;
		const { cashback_accrual } = build();
		await settle();

		expect(call).not.toHaveBeenCalled();
		expect(cashback_accrual.value).toBeNull();
	});
});

describe("what the answer is allowed to say", () => {
	it("nets the loyalty already applied out of the eligible amount, ERPNext's way", async () => {
		const logic = build();
		await settle();
		call.mockClear();

		// `current_amount = flt(grand_total) - cint(loyalty_amount)`
		logic.loyalty_amount.value = 90.7;
		await settle();

		expect(call.mock.calls[0][1].eligible_amount).toBe(1000);
	});

	it("renders nothing when the server says the accrual is zero", async () => {
		call.mockResolvedValue({ message: { enrolled: true, points: 0, value: 0 } });
		const { cashback_accrual } = build();
		await settle();

		expect(cashback_accrual.value).toBeNull();
	});

	it("renders nothing when the server refuses — a refusal is not a zero", async () => {
		call.mockRejectedValue(new Error("Customer is required to preview cashback."));
		const { cashback_accrual } = build();
		await settle();

		expect(cashback_accrual.value).toBeNull();
	});

	it("drops a stale answer about a cart that has changed", async () => {
		let resolveFirst: (value: unknown) => void = () => {};
		call.mockImplementationOnce(
			() => new Promise((resolve) => (resolveFirst = resolve)),
		).mockImplementationOnce(async () => ({
			message: { enrolled: true, points: 20, value: 20 },
		}));

		const logic = build();
		await nextTick();
		vi.advanceTimersByTime(300);

		logic.invoiceDoc.value = { ...logic.invoiceDoc.value, grand_total: 200 };
		await settle();

		// The first request answers late, about the 1090 cart.
		resolveFirst({ message: { enrolled: true, points: 109, value: 29.2 } });
		for (let index = 0; index < 6; index += 1) await Promise.resolve();

		expect(logic.cashback_accrual.value).toBe(20);
	});

	it("only requests once for a burst of cart edits", async () => {
		const logic = build();
		await settle();
		call.mockClear();

		logic.invoiceDoc.value = { ...logic.invoiceDoc.value, grand_total: 300 };
		await nextTick();
		logic.invoiceDoc.value = { ...logic.invoiceDoc.value, grand_total: 400 };
		await nextTick();
		logic.invoiceDoc.value = { ...logic.invoiceDoc.value, grand_total: 500 };
		await settle();

		expect(call).toHaveBeenCalledTimes(1);
		expect(call.mock.calls[0][1].eligible_amount).toBe(500);
	});
});

describe("the wallet card still decides what it draws", () => {
	it("draws the accrual only on the wallet that can earn one", () => {
		expect(
			resolveWalletSummary({
				loyaltyProgram: "Puntos Doco",
				loyaltyValue: 418,
				accrual: 29.2,
			}).accrual,
		).toBe(29.2);
		// Stored value is topped up deliberately; it never accrues from a sale,
		// even when an accrual is handed in.
		expect(resolveWalletSummary({ storedValueBalance: 418, accrual: 29.2 }).accrual).toBeNull();
	});
});
