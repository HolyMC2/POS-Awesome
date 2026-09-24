/**
 * Provider-financed credit sale — the figures the register shows and sends.
 *
 * Two shapes, decided by the provider's configuration on this register (the
 * server answers it in `mercado.api.pos_credit.get_context`):
 *
 *  - `split`: the provider's Mode of Payment is one of the register's payment
 *    methods. The ticket carries the full credit price of the covered lines;
 *    the customer pays the down payment at the counter and the provider's
 *    share lands on that Mode of Payment at submit.
 *  - `enganche`: the ticket IS the down payment (the covered lines are priced
 *    at their down payment, usually through the customer's price list); the
 *    full credit price is captured as data on the invoice.
 *
 * The server re-derives every stored figure from the submitted document
 * (mercado `financing_detect.normalize_declared`), so nothing here is trusted
 * for money: these numbers drive the screen, the validation that keeps an
 * incomplete credit sale from closing, and the provider payment row the split
 * shape adds to the submitted copy.
 *
 * Pure: no Vue, no store, no `__()`.
 */

export type CreditShape = "split" | "enganche";

/** The invoice item fields this module reads. */
export interface CreditLineSource {
	posa_row_id?: string | null;
	item_code?: string | null;
	item_name?: string | null;
	qty?: number | string | null;
	rate?: number | string | null;
	amount?: number | string | null;
	serial_no?: string | null;
	has_serial_no?: number | string | boolean | null;
	mercado_financed?: number | string | boolean | null;
}

export interface CreditLine {
	rowId: string;
	itemCode: string;
	itemName: string;
	qty: number;
	amount: number;
	serialNo: string;
	serialized: boolean;
}

/** What the cashier declared in the credit sheet for the current sale. */
export interface CreditDraft {
	provider: string;
	/** `posa_row_id` of the cart lines the credit covers. */
	lineRowIds: string[];
	/** Split shape: the down payment the provider asked for. */
	enganche: number | null;
	/** Enganche shape: the full credit price on the provider's contract. */
	creditPrice: number | null;
	planMonths: number | null;
	planMonthly: number | null;
}

export type CreditIssue =
	| "no_lines"
	| "lines_changed"
	| "missing_enganche"
	| "enganche_too_high"
	| "missing_price"
	| "price_not_above_enganche";

export interface CreditSummary {
	shape: CreditShape;
	lines: CreditLine[];
	covered: CreditLine[];
	coveredTotal: number;
	creditPrice: number;
	enganche: number;
	/** What the provider finances: credit price − down payment. */
	financed: number;
	/** The share settled on the provider's Mode of Payment (split only). */
	providerPayment: number;
	issues: CreditIssue[];
	valid: boolean;
}

export interface CreditProviderRef {
	name: string;
	shape: CreditShape;
	mode_of_payment?: string | null;
}

export interface CreditSubmission {
	fields: {
		is_financed: 1;
		credit_provider: string;
		customer_offered_price: number;
		enganche: number;
		plan_months: number;
		plan_monthly: number;
	};
	rowIds: string[];
	/** The provider row the split shape adds to the SUBMITTED copy only. */
	payment: { mode_of_payment: string; amount: number } | null;
}

const toNumber = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

export const roundMoney = (value: number, precision = 2): number => {
	const factor = Math.pow(10, Math.max(precision, 0));
	return Math.round((value + Number.EPSILON) * factor) / factor;
};

const truthy = (value: unknown): boolean => value === 1 || value === "1" || value === true;

const lineAmount = (item: CreditLineSource): number => {
	const raw = item.amount;
	if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) {
		return Number(raw);
	}
	return toNumber(item.qty) * toNumber(item.rate);
};

/** The invoice's lines, in cart order, keyed by their stable row id. */
export const creditLinesFromItems = (
	items: readonly (CreditLineSource | null | undefined)[] | null | undefined,
): CreditLine[] =>
	(Array.isArray(items) ? items : [])
		.filter((item): item is CreditLineSource => Boolean(item?.posa_row_id))
		.map((item) => {
			const serialNo = String(item.serial_no || "").trim();
			return {
				rowId: String(item.posa_row_id),
				itemCode: String(item.item_code || ""),
				itemName: String(item.item_name || item.item_code || ""),
				qty: toNumber(item.qty),
				amount: lineAmount(item),
				serialNo,
				serialized: Boolean(serialNo) || truthy(item.has_serial_no),
			};
		});

/**
 * The lines a new credit sale covers until the cashier says otherwise: the
 * serialized ones (the handset), else the priciest line.
 */
export const defaultCoveredRowIds = (lines: readonly CreditLine[]): string[] => {
	const serialized = lines.filter((line) => line.serialized && line.amount > 0);
	if (serialized.length) return serialized.map((line) => line.rowId);
	const priced = lines.filter((line) => line.amount > 0);
	if (!priced.length) return [];
	const priciest = priced.reduce((best, line) => (line.amount > best.amount ? line : best));
	return [priciest.rowId];
};

const positiveOrNull = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const summarizeCredit = (
	draft: CreditDraft,
	shape: CreditShape,
	items: readonly (CreditLineSource | null | undefined)[] | null | undefined,
	precision = 2,
): CreditSummary => {
	const lines = creditLinesFromItems(items);
	const wanted = new Set(draft.lineRowIds || []);
	const covered = lines.filter((line) => wanted.has(line.rowId));
	const coveredTotal = roundMoney(
		covered.reduce((sum, line) => sum + line.amount, 0),
		precision,
	);
	const issues: CreditIssue[] = [];
	if (!covered.length) {
		issues.push(wanted.size ? "lines_changed" : "no_lines");
	}

	let creditPrice: number;
	let enganche: number;
	if (shape === "split") {
		creditPrice = coveredTotal;
		const typed = positiveOrNull(draft.enganche);
		enganche = roundMoney(typed ?? 0, precision);
		if (typed === null) issues.push("missing_enganche");
		else if (covered.length && enganche >= creditPrice) issues.push("enganche_too_high");
	} else {
		enganche = coveredTotal;
		const typed = positiveOrNull(draft.creditPrice);
		creditPrice = roundMoney(typed ?? 0, precision);
		if (covered.length && enganche <= 0) issues.push("missing_enganche");
		if (typed === null) issues.push("missing_price");
		else if (covered.length && creditPrice <= enganche) issues.push("price_not_above_enganche");
	}

	const financed = roundMoney(Math.max(creditPrice - enganche, 0), precision);
	const valid = issues.length === 0;
	return {
		shape,
		lines,
		covered,
		coveredTotal,
		creditPrice,
		enganche,
		financed,
		providerPayment: valid && shape === "split" ? financed : 0,
		issues,
		valid,
	};
};

export const creditSubmission = (
	draft: CreditDraft,
	provider: CreditProviderRef,
	summary: CreditSummary,
): CreditSubmission | null => {
	if (!summary.valid) return null;
	const payment =
		summary.shape === "split" && provider.mode_of_payment
			? { mode_of_payment: provider.mode_of_payment, amount: summary.providerPayment }
			: null;
	return {
		fields: {
			is_financed: 1,
			credit_provider: provider.name,
			customer_offered_price: summary.creditPrice,
			enganche: summary.enganche,
			plan_months: Math.max(0, Math.trunc(positiveOrNull(draft.planMonths) ?? 0)),
			plan_monthly: positiveOrNull(draft.planMonthly) ?? 0,
		},
		rowIds: summary.covered.map((line) => line.rowId),
		payment,
	};
};

interface CreditDoc {
	items?: CreditLineSource[] | null;
	payments?: { mode_of_payment?: string | null; amount?: number; base_amount?: number }[] | null;
	conversion_rate?: number | string | null;
	[key: string]: any;
}

/**
 * Write (or clear) the credit sale's header fields and line flags on the live
 * document. The provider payment row is deliberately NOT touched here: it stays
 * at 0 on the live document so the tender helpers never fight it, and is added
 * to the submitted copy by `injectProviderPayment`.
 */
export const applyCreditToDoc = (doc: CreditDoc | null | undefined, submission: CreditSubmission | null): void => {
	if (!doc) return;
	const covered = new Set(submission?.rowIds || []);
	if (submission) {
		Object.assign(doc, submission.fields);
	} else if (truthy(doc.is_financed)) {
		doc.is_financed = 0;
		doc.credit_provider = null;
		doc.customer_offered_price = 0;
		doc.enganche = 0;
		doc.financed_amount = 0;
		doc.plan_months = 0;
		doc.plan_monthly = 0;
	}
	for (const item of Array.isArray(doc.items) ? doc.items : []) {
		if (!item) continue;
		const flag = covered.has(String(item.posa_row_id || "")) ? 1 : 0;
		if (flag || truthy(item.mercado_financed)) item.mercado_financed = flag;
	}
};

/** Put the provider's share on its payment row of a document copy. */
export const injectProviderPayment = (
	doc: CreditDoc | null | undefined,
	payment: CreditSubmission["payment"],
	precision = 2,
): boolean => {
	if (!doc || !payment) return false;
	const row = (Array.isArray(doc.payments) ? doc.payments : []).find(
		(candidate) => candidate?.mode_of_payment === payment.mode_of_payment,
	);
	if (!row) return false;
	const rate = toNumber(doc.conversion_rate) || 1;
	row.amount = roundMoney(payment.amount, precision);
	row.base_amount = roundMoney(payment.amount * rate, precision);
	return true;
};
