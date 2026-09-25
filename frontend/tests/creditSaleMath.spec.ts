import { describe, expect, it } from "vitest";
import {
	applyCreditToDoc,
	creditLineRates,
	creditLinesFromItems,
	creditSubmission,
	defaultCoveredRowIds,
	injectProviderPayment,
	planCreditReprice,
	planCreditRestore,
	snapshotLinePrice,
	summarizeCredit,
	type CreditDraft,
} from "../src/posapp/composables/pos/credit/creditMath";
import {
	initializePaymentLinesForDialog,
	rebalancePreferredPaymentLine,
	resolvePreferredPaymentLine,
} from "../src/posapp/utils/paymentInitialization";

const phone = {
	posa_row_id: "r-phone",
	item_code: "PHONE",
	item_name: "Phone 128GB",
	qty: 1,
	rate: 4000,
	price_list_rate: 4000,
	amount: 4000,
	serial_no: "IMEI-1",
};
const cover = { posa_row_id: "r-case", item_code: "CASE", item_name: "Case", qty: 1, rate: 200, price_list_rate: 200, amount: 200 };

const draft = (overrides: Partial<CreditDraft> = {}): CreditDraft => ({
	provider: "Payjoy",
	lineRowIds: ["r-phone"],
	creditPrice: null,
	enganche: null,
	planMonths: null,
	planMonthly: null,
	originalPrices: {},
	...overrides,
});

/** The phone as the cart carries it once the credit priced it. */
const pricedPhone = (rate: number) => ({ ...phone, rate, price_list_rate: rate, amount: rate });

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

describe("what the cashier types — the provider's approval", () => {
	it("needs a credit price and a down payment below it; 0 is a valid down payment", () => {
		expect(summarizeCredit(draft(), "split", [phone]).issues).toEqual(["missing_price", "missing_enganche"]);
		expect(summarizeCredit(draft({ creditPrice: 4000, enganche: 4000 }), "split", [phone]).issues).toEqual([
			"enganche_too_high",
		]);
		const noDownPayment = summarizeCredit(draft({ creditPrice: 4000, enganche: 0 }), "split", [phone]);
		expect(noDownPayment.valid).toBe(true);
		expect(noDownPayment.providerPayment).toBe(4000);
	});

	it("flags a declaration whose covered lines left the cart", () => {
		const summary = summarizeCredit(draft({ creditPrice: 4000, enganche: 400 }), "split", [cover]);
		expect(summary.valid).toBe(false);
		expect(summary.issues).toContain("lines_changed");
	});
});

describe("split shape — the covered lines carry the credit price", () => {
	it("waits for the ticket to carry the credit price before it can close", () => {
		const d = draft({ creditPrice: 4800, enganche: 800 });
		const pending = summarizeCredit(d, "split", [phone, cover]);
		expect(pending.issues).toEqual(["ticket_pending"]);
		expect(pending.providerPayment).toBe(0);

		const priced = summarizeCredit(d, "split", [pricedPhone(4800), cover]);
		expect(priced.valid).toBe(true);
		expect(priced.ticketTarget).toBe(4800);
		expect(priced.financed).toBe(4000);
		// The case is collected with the down payment; the provider pays the rest.
		expect(priced.collectToday).toBe(1000);
		expect(priced.othersTotal).toBe(200);
		expect(priced.providerPayment).toBe(4000);
	});
});

describe("enganche shape — the covered lines carry the down payment", () => {
	it("charges the down payment on the ticket and records the credit price", () => {
		const d = draft({ creditPrice: 4800, enganche: 800 });
		expect(summarizeCredit(d, "enganche", [phone, cover]).issues).toEqual(["ticket_pending"]);
		const priced = summarizeCredit(d, "enganche", [pricedPhone(800), cover]);
		expect(priced.valid).toBe(true);
		expect(priced.ticketTarget).toBe(800);
		expect(priced.financed).toBe(4000);
		expect(priced.collectToday).toBe(1000);
		// Nothing is paid on a provider mode: the whole ticket is counter money.
		expect(priced.providerPayment).toBe(0);
	});

	it("accepts no down payment: the covered line is charged at 0", () => {
		const priced = summarizeCredit(draft({ creditPrice: 4800, enganche: 0 }), "enganche", [pricedPhone(0)]);
		expect(priced.valid).toBe(true);
		expect(priced.collectToday).toBe(0);
	});
});

describe("repricing the cart", () => {
	it("keeps each covered line's own price once and shares the target by it", () => {
		const two = [phone, { ...cover, posa_row_id: "r-watch", item_name: "Watch", rate: 1000, price_list_rate: 1000, amount: 1000 }];
		const plan = planCreditReprice(
			draft({ lineRowIds: ["r-phone", "r-watch"], creditPrice: 6000, enganche: 500 }),
			"split",
			two,
		);
		expect(plan.originalPrices["r-phone"]).toMatchObject({ rate: 4000, price_list_rate: 4000 });
		expect(plan.set).toEqual([
			{ rowId: "r-phone", rate: 4800 },
			{ rowId: "r-watch", rate: 1200 },
		]);
		expect(plan.restore).toEqual([]);
	});

	it("prices the enganche shape at the down payment", () => {
		const plan = planCreditReprice(draft({ creditPrice: 4800, enganche: 800 }), "enganche", [phone, cover]);
		expect(plan.set).toEqual([{ rowId: "r-phone", rate: 800 }]);
	});

	it("reuses the first snapshot when the credit is applied again", () => {
		const first = planCreditReprice(draft({ creditPrice: 4800, enganche: 800 }), "enganche", [phone]);
		const again = planCreditReprice(
			draft({ creditPrice: 5000, enganche: 1000, originalPrices: first.originalPrices }),
			"enganche",
			[pricedPhone(800)],
		);
		expect(again.originalPrices["r-phone"]?.rate).toBe(4000);
		expect(again.set).toEqual([{ rowId: "r-phone", rate: 1000 }]);
	});

	it("restores a line the credit no longer covers, from its snapshot or the price list", () => {
		const snapshot = snapshotLinePrice(phone);
		const plan = planCreditReprice(
			draft({ lineRowIds: ["r-case"], creditPrice: 300, enganche: 100, originalPrices: { "r-phone": snapshot } }),
			"split",
			[pricedPhone(4800), cover],
		);
		expect(plan.restore).toEqual([{ rowId: "r-phone", price: snapshot }]);
		const resumed = planCreditReprice(
			draft({ lineRowIds: ["r-case"], creditPrice: 300, enganche: 100 }),
			"split",
			[pricedPhone(4800), cover],
			2,
			["r-phone"],
		);
		expect(resumed.restore).toEqual([{ rowId: "r-phone", price: null }]);
	});

	it("puts every covered line back when the credit is removed", () => {
		const snapshot = snapshotLinePrice(phone);
		const plan = planCreditRestore(
			draft({ lineRowIds: ["r-phone", "r-case"], originalPrices: { "r-phone": snapshot } }),
			[pricedPhone(800), cover],
		);
		expect(plan.restore).toEqual([
			{ rowId: "r-phone", price: snapshot },
			{ rowId: "r-case", price: null },
		]);
		expect(planCreditRestore(null, [phone]).restore).toEqual([]);
	});

	it("shares by quantity when the lines had no price, and lands on the target", () => {
		const rates = creditLineRates(
			creditLinesFromItems([
				{ posa_row_id: "a", qty: 1, rate: 0, amount: 0 },
				{ posa_row_id: "b", qty: 2, rate: 0, amount: 0 },
			]),
			{},
			900,
		);
		expect(rates).toEqual([
			{ rowId: "a", rate: 300 },
			{ rowId: "b", rate: 300 },
		]);
	});
});

describe("what reaches the server", () => {
	const provider = { name: "Payjoy", shape: "split" as const, mode_of_payment: "Saldo proveedores" };

	it("carries header fields, covered rows and the provider payment for the split shape", () => {
		const d = draft({ creditPrice: 4800, enganche: 800, planMonths: 12, planMonthly: 400 });
		const submission = creditSubmission(d, provider, summarizeCredit(d, "split", [pricedPhone(4800), cover]));
		expect(submission).toEqual({
			fields: {
				is_financed: 1,
				credit_provider: "Payjoy",
				customer_offered_price: 4800,
				enganche: 800,
				plan_months: 12,
				plan_monthly: 400,
			},
			rowIds: ["r-phone"],
			payment: { mode_of_payment: "Saldo proveedores", amount: 4000 },
		});
	});

	it("records the credit price with the enganche shape and pays nothing on a provider mode", () => {
		const d = draft({ provider: "Paguitos", creditPrice: 4800, enganche: 800 });
		const submission = creditSubmission(
			d,
			{ name: "Paguitos", shape: "enganche", mode_of_payment: null },
			summarizeCredit(d, "enganche", [pricedPhone(800), cover]),
		);
		expect(submission?.fields).toMatchObject({ customer_offered_price: 4800, enganche: 800 });
		expect(submission?.payment).toBeNull();
	});

	it("sends nothing while the declaration is incomplete or the ticket not repriced", () => {
		const d = draft();
		expect(creditSubmission(d, provider, summarizeCredit(d, "split", [phone]))).toBeNull();
		const pending = draft({ creditPrice: 4800, enganche: 800 });
		expect(creditSubmission(pending, provider, summarizeCredit(pending, "split", [phone]))).toBeNull();
	});

	it("writes the fields and line flags on the live doc, and clears them when removed", () => {
		const d = draft({ creditPrice: 4000, enganche: 400 });
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
