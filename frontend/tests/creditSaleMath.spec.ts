import { describe, expect, it } from "vitest";
import {
	applyCreditToDoc,
	creditSubmission,
	defaultCoveredRowIds,
	creditLinesFromItems,
	injectProviderPayment,
	summarizeCredit,
	type CreditDraft,
} from "../src/posapp/composables/pos/credit/creditMath";
import {
	initializePaymentLinesForDialog,
	rebalancePreferredPaymentLine,
	resolvePreferredPaymentLine,
} from "../src/posapp/utils/paymentInitialization";

const phone = { posa_row_id: "r-phone", item_code: "PHONE", item_name: "Phone 128GB", qty: 1, rate: 4000, amount: 4000, serial_no: "IMEI-1" };
const cover = { posa_row_id: "r-case", item_code: "CASE", item_name: "Case", qty: 1, rate: 200, amount: 200 };

const draft = (overrides: Partial<CreditDraft> = {}): CreditDraft => ({
	provider: "Payjoy",
	lineRowIds: ["r-phone"],
	enganche: null,
	creditPrice: null,
	planMonths: null,
	planMonthly: null,
	...overrides,
});

describe("credit sale lines", () => {
	it("covers the serialized handset by default, else the priciest line", () => {
		const lines = creditLinesFromItems([phone, cover]);
		expect(defaultCoveredRowIds(lines)).toEqual(["r-phone"]);
		const unserialized = creditLinesFromItems([{ ...phone, serial_no: "" }, cover]);
		expect(defaultCoveredRowIds(unserialized)).toEqual(["r-phone"]);
		expect(defaultCoveredRowIds([])).toEqual([]);
	});

	it("reads qty × rate when a line has no amount yet", () => {
		const [line] = creditLinesFromItems([{ posa_row_id: "x", qty: 2, rate: 150, amount: null }]);
		expect(line?.amount).toBe(300);
	});
});

describe("split shape — ticket at the credit price, provider mode settles the rest", () => {
	it("prices the credit at the covered lines and takes the typed down payment", () => {
		const summary = summarizeCredit(draft({ enganche: 400 }), "split", [phone, cover]);
		expect(summary.valid).toBe(true);
		expect(summary.creditPrice).toBe(4000);
		expect(summary.enganche).toBe(400);
		expect(summary.financed).toBe(3600);
		// The case is collected at the counter with the down payment.
		expect(summary.providerPayment).toBe(3600);
	});

	it("refuses a missing or excessive down payment", () => {
		expect(summarizeCredit(draft(), "split", [phone]).issues).toContain("missing_enganche");
		const tooHigh = summarizeCredit(draft({ enganche: 4000 }), "split", [phone]);
		expect(tooHigh.issues).toContain("enganche_too_high");
		expect(tooHigh.providerPayment).toBe(0);
	});
});

describe("enganche shape — the ticket is the down payment", () => {
	it("takes the covered lines as the down payment and the typed credit price", () => {
		const engancheLine = { ...phone, rate: 400, amount: 400 };
		const summary = summarizeCredit(draft({ creditPrice: 4000 }), "enganche", [engancheLine, cover]);
		expect(summary.valid).toBe(true);
		expect(summary.enganche).toBe(400);
		expect(summary.creditPrice).toBe(4000);
		expect(summary.financed).toBe(3600);
		// Nothing is paid on a provider mode: the whole ticket is counter money.
		expect(summary.providerPayment).toBe(0);
	});

	it("needs a credit price above the down payment", () => {
		const engancheLine = { ...phone, rate: 400, amount: 400 };
		expect(summarizeCredit(draft(), "enganche", [engancheLine]).issues).toContain("missing_price");
		expect(
			summarizeCredit(draft({ creditPrice: 400 }), "enganche", [engancheLine]).issues,
		).toContain("price_not_above_enganche");
	});
});

describe("cart changes under a declared credit sale", () => {
	it("flags a declaration whose covered lines left the cart", () => {
		const summary = summarizeCredit(draft({ enganche: 400 }), "split", [cover]);
		expect(summary.valid).toBe(false);
		expect(summary.issues).toContain("lines_changed");
	});
});

describe("what reaches the server", () => {
	const provider = { name: "Payjoy", shape: "split" as const, mode_of_payment: "Saldo proveedores" };

	it("carries header fields, covered rows and the provider payment for the split shape", () => {
		const d = draft({ enganche: 400, planMonths: 12, planMonthly: 350 });
		const submission = creditSubmission(d, provider, summarizeCredit(d, "split", [phone, cover]));
		expect(submission).toEqual({
			fields: {
				is_financed: 1,
				credit_provider: "Payjoy",
				customer_offered_price: 4000,
				enganche: 400,
				plan_months: 12,
				plan_monthly: 350,
			},
			rowIds: ["r-phone"],
			payment: { mode_of_payment: "Saldo proveedores", amount: 3600 },
		});
	});

	it("sends nothing while the declaration is incomplete", () => {
		const d = draft();
		expect(creditSubmission(d, provider, summarizeCredit(d, "split", [phone]))).toBeNull();
	});

	it("writes the fields and line flags on the live doc, and clears them when removed", () => {
		const d = draft({ enganche: 400 });
		const submission = creditSubmission(d, provider, summarizeCredit(d, "split", [phone, cover]));
		const doc: any = { items: [{ ...phone }, { ...cover }], payments: [] };
		applyCreditToDoc(doc, submission);
		expect(doc.is_financed).toBe(1);
		expect(doc.items.map((item: any) => item.mercado_financed)).toEqual([1, undefined]);
		applyCreditToDoc(doc, null);
		expect(doc.is_financed).toBe(0);
		expect(doc.credit_provider).toBeNull();
		expect(doc.items[0].mercado_financed).toBe(0);
	});

	it("puts the provider share on its row of the submitted copy only when the row exists", () => {
		const doc: any = {
			conversion_rate: 1,
			payments: [
				{ mode_of_payment: "Cash", amount: 600 },
				{ mode_of_payment: "Saldo proveedores", amount: 0 },
			],
		};
		expect(injectProviderPayment(doc, { mode_of_payment: "Saldo proveedores", amount: 3600 })).toBe(true);
		expect(doc.payments[1]).toMatchObject({ amount: 3600, base_amount: 3600 });
		expect(injectProviderPayment({ payments: [] }, { mode_of_payment: "X", amount: 1 })).toBe(false);
	});
});

describe("payment lines never pick the provider row", () => {
	const isCashLike = (payment: any) => String(payment?.type || "").toLowerCase() === "cash";
	const isProvider = (payment: any) => payment?.mode_of_payment === "Saldo proveedores";

	it("skips an excluded cash-typed row when choosing the preferred tender", () => {
		const doc = {
			grand_total: 4200,
			payments: [
				{ mode_of_payment: "Saldo proveedores", type: "Cash", amount: 0 },
				{ mode_of_payment: "Efectivo", type: "Cash", amount: 0 },
			],
		};
		expect(resolvePreferredPaymentLine(doc, isCashLike)?.mode_of_payment).toBe("Saldo proveedores");
		expect(resolvePreferredPaymentLine(doc, isCashLike, isProvider)?.mode_of_payment).toBe("Efectivo");
		initializePaymentLinesForDialog(doc, 2, isCashLike, isProvider);
		expect(doc.payments[0]?.amount).toBe(0);
		expect(doc.payments[1]?.amount).toBe(4200);
	});

	it("rebalances the counter tender net of the financed share", () => {
		const doc = {
			grand_total: 4200,
			payments: [
				{ mode_of_payment: "Efectivo", type: "Cash", amount: 4200, default: 1 },
				{ mode_of_payment: "Saldo proveedores", type: "Cash", amount: 0 },
			],
		};
		rebalancePreferredPaymentLine(doc, {
			precision: 2,
			isCashLikePayment: isCashLike,
			financedAmount: 3600,
			isExcluded: isProvider,
		});
		expect(doc.payments[0]?.amount).toBe(600);
	});
});
