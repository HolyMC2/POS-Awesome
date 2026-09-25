/**
 * Provider-financed credit sale — the figures the register shows and sends.
 *
 * The cashier copies two figures from the provider's approval — the total
 * credit price and the down payment («enganche») the customer pays today — and
 * the register prices the covered lines of the ticket itself. How it prices
 * them depends on the provider's configuration on this register (the server
 * answers it in `mercado.api.pos_credit.get_context`):
 *
 *  - `split`: the provider's Mode of Payment is one of the register's payment
 *    methods. The covered lines carry the credit price; the customer pays the
 *    down payment at the counter and the provider's share lands on that Mode of
 *    Payment at submit.
 *  - `enganche`: the covered lines carry the down payment; the credit price is
 *    recorded on the invoice and the provider settles the rest later.
 *
 * Either way the customer pays the same today: the down payment plus any line
 * outside the credit. The cart keeps each covered line's own price so removing
 * the credit restores it.
 *
 * The server re-derives every stored figure from the submitted document
 * (mercado `financing_detect.normalize_declared`), so nothing here is trusted
 * for money: these numbers drive the screen, the checks that keep an
 * incomplete credit sale from closing, the ticket prices and the provider
 * payment row the split shape adds to the submitted copy.
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
	price_list_rate?: number | string | null;
	base_rate?: number | string | null;
	base_price_list_rate?: number | string | null;
	discount_percentage?: number | string | null;
	discount_amount?: number | string | null;
	base_discount_amount?: number | string | null;
	locked_price?: unknown;
	_manual_rate_set?: unknown;
	_manual_rate_set_from_uom?: unknown;
	posa_px_skip_rate_band?: number | string | boolean | null;
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

/** A cart line's price before the credit repriced it, restored on removal. */
export interface CreditLinePrice {
	rate: number;
	base_rate: number | null;
	price_list_rate: number;
	base_price_list_rate: number | null;
	discount_percentage: number;
	discount_amount: number;
	base_discount_amount: number | null;
	locked_price: boolean;
	_manual_rate_set: boolean;
	_manual_rate_set_from_uom: boolean;
	posa_px_skip_rate_band: number;
}

/** What the cashier declared in the credit sheet for the current sale. */
export interface CreditDraft {
	provider: string;
	/** `posa_row_id` of the cart lines the credit covers. */
	lineRowIds: string[];
	/** The total credit price on the provider's approval. */
	creditPrice: number | null;
	/** What the customer pays today for the covered items; 0 when the provider asks none. */
	enganche: number | null;
	planMonths: number | null;
	planMonthly: number | null;
	/** Covered lines' prices before the credit repriced them, by row id. */
	originalPrices: Record<string, CreditLinePrice>;
}

export type CreditIssue =
	| "no_lines"
	| "lines_changed"
	| "missing_price"
	| "missing_enganche"
	| "enganche_too_high"
	| "ticket_pending";

export interface CreditSummary {
	shape: CreditShape;
	lines: CreditLine[];
	covered: CreditLine[];
	/** The covered lines as the ticket carries them now. */
	coveredTotal: number;
	/** Every line outside the credit, paid at the counter as usual. */
	othersTotal: number;
	creditPrice: number;
	enganche: number;
	/** What the provider finances: credit price − down payment. */
	financed: number;
	/** The covered lines' total the ticket must carry for this shape. */
	ticketTarget: number;
	/** What the customer pays today: the down payment plus the other lines. */
	collectToday: number;
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

/** The cart edits one credit declaration needs: new prices and restored ones. */
export interface CreditReprice {
	set: { rowId: string; rate: number }[];
	/** `price: null` — no snapshot (a resumed draft): refetch from the price list. */
	restore: { rowId: string; price: CreditLinePrice | null }[];
	/** The draft's snapshot after this plan runs. */
	originalPrices: Record<string, CreditLinePrice>;
}

/**
 * What the credit asks of the cart (bus `credit:line-prices`): `set` pins a
 * line at a new unit price, `restore` puts back its own price, `lock` pins
 * lines at the price they already carry. Unless `refresh` is false the cart
 * then re-sends the payment screen its document and answers `credit:repriced`.
 */
export interface CreditLinePricesIntent {
	set: CreditReprice["set"];
	restore: CreditReprice["restore"];
	lock?: string[];
	refresh?: boolean;
}

const toNumber = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

const numberOrNull = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
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

/** A line's price fields, as the cart holds them, for a later restore. */
export const snapshotLinePrice = (item: CreditLineSource): CreditLinePrice => ({
	rate: toNumber(item.rate),
	base_rate: numberOrNull(item.base_rate),
	price_list_rate: toNumber(item.price_list_rate),
	base_price_list_rate: numberOrNull(item.base_price_list_rate),
	discount_percentage: toNumber(item.discount_percentage),
	discount_amount: toNumber(item.discount_amount),
	base_discount_amount: numberOrNull(item.base_discount_amount),
	locked_price: truthy(item.locked_price),
	_manual_rate_set: item._manual_rate_set === true,
	_manual_rate_set_from_uom: item._manual_rate_set_from_uom === true,
	posa_px_skip_rate_band: truthy(item.posa_px_skip_rate_band) ? 1 : 0,
});

/**
 * Unit rates that make the covered lines total `target`, shared in proportion
 * to their own prices before the credit (the last line absorbs the rounding).
 */
export const creditLineRates = (
	covered: readonly CreditLine[],
	originals: Readonly<Record<string, CreditLinePrice>>,
	target: number,
	precision = 2,
): { rowId: string; rate: number }[] => {
	if (!covered.length) return [];
	const weights = covered.map((line) => {
		const original = originals[line.rowId];
		const qty = Math.abs(line.qty) || 1;
		return original ? Math.max(original.rate, 0) * qty : Math.max(line.amount, 0);
	});
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	const quantities = covered.map((line) => Math.abs(line.qty) || 1);
	const totalQty = quantities.reduce((sum, qty) => sum + qty, 0);
	let allocated = 0;
	return covered.map((line, index) => {
		const qty = quantities[index] ?? 1;
		const last = index === covered.length - 1;
		const share = last
			? target - allocated
			: roundMoney(target * (totalWeight > 0 ? (weights[index] ?? 0) / totalWeight : qty / totalQty), precision);
		allocated += share;
		return { rowId: line.rowId, rate: roundMoney(Math.max(share, 0) / qty, precision) };
	});
};

/** The covered lines' total the ticket carries for a provider's shape. */
export const creditTicketTarget = (shape: CreditShape, creditPrice: number, enganche: number): number =>
	shape === "split" ? creditPrice : enganche;

/**
 * The cart edits that make the ticket carry `draft`: new prices for the covered
 * lines (captured once, before their first repricing) and restored prices for
 * lines the credit no longer covers.
 */
export const planCreditReprice = (
	draft: CreditDraft,
	shape: CreditShape,
	cartItems: readonly (CreditLineSource | null | undefined)[] | null | undefined,
	precision = 2,
	previousRowIds: readonly string[] = [],
): CreditReprice => {
	const rows = (Array.isArray(cartItems) ? cartItems : []).filter(
		(item): item is CreditLineSource => Boolean(item?.posa_row_id),
	);
	const byRow = new Map(rows.map((item) => [String(item.posa_row_id), item]));
	const wanted = new Set(draft.lineRowIds || []);
	const originalPrices: Record<string, CreditLinePrice> = {};
	const restore: CreditReprice["restore"] = [];
	const snapshots = draft.originalPrices || {};
	for (const rowId of new Set([...Object.keys(snapshots), ...previousRowIds])) {
		const price = snapshots[rowId] || null;
		if (wanted.has(rowId)) {
			if (price) originalPrices[rowId] = price;
		} else if (byRow.has(rowId)) {
			restore.push({ rowId, price });
		}
	}
	for (const rowId of wanted) {
		const item = byRow.get(rowId);
		if (item && !originalPrices[rowId]) originalPrices[rowId] = snapshotLinePrice(item);
	}
	const covered = creditLinesFromItems(rows).filter((line) => wanted.has(line.rowId));
	const creditPrice = roundMoney(Math.max(numberOrNull(draft.creditPrice) ?? 0, 0), precision);
	const enganche = roundMoney(Math.max(numberOrNull(draft.enganche) ?? 0, 0), precision);
	return {
		set: creditLineRates(covered, originalPrices, creditTicketTarget(shape, creditPrice, enganche), precision),
		restore,
		originalPrices,
	};
};

/** The cart edits that put every covered line back at its own price. */
export const planCreditRestore = (
	draft: CreditDraft | null | undefined,
	cartItems: readonly (CreditLineSource | null | undefined)[] | null | undefined,
): CreditReprice => {
	const present = new Set(
		(Array.isArray(cartItems) ? cartItems : [])
			.map((item) => String(item?.posa_row_id || ""))
			.filter(Boolean),
	);
	const snapshots = draft?.originalPrices || {};
	const rows = new Set([...Object.keys(snapshots), ...(draft?.lineRowIds || [])]);
	return {
		set: [],
		restore: [...rows].filter((rowId) => present.has(rowId)).map((rowId) => ({ rowId, price: snapshots[rowId] || null })),
		originalPrices: {},
	};
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
	const othersTotal = roundMoney(
		lines.filter((line) => !wanted.has(line.rowId)).reduce((sum, line) => sum + line.amount, 0),
		precision,
	);
	const issues: CreditIssue[] = [];
	if (!covered.length) {
		issues.push(wanted.size ? "lines_changed" : "no_lines");
	}

	const typedPrice = numberOrNull(draft.creditPrice);
	const typedEnganche = numberOrNull(draft.enganche);
	if (typedPrice === null || typedPrice <= 0) issues.push("missing_price");
	if (typedEnganche === null || typedEnganche < 0) issues.push("missing_enganche");
	else if (typedPrice !== null && typedPrice > 0 && typedEnganche >= typedPrice) issues.push("enganche_too_high");

	const creditPrice = roundMoney(Math.max(typedPrice ?? 0, 0), precision);
	const enganche = roundMoney(Math.max(typedEnganche ?? 0, 0), precision);
	const ticketTarget = creditTicketTarget(shape, creditPrice, enganche);
	// Until the cart carries the declared prices (just applied, or a covered line
	// edited afterwards) the sale cannot close: the ticket would not match.
	const tolerance = Math.pow(10, -Math.max(precision, 0)) * Math.max(covered.length, 1) + 1e-9;
	if (!issues.length && Math.abs(coveredTotal - ticketTarget) > tolerance) issues.push("ticket_pending");

	const valid = issues.length === 0;
	return {
		shape,
		lines,
		covered,
		coveredTotal,
		othersTotal,
		creditPrice,
		enganche,
		financed: roundMoney(Math.max(creditPrice - enganche, 0), precision),
		ticketTarget,
		collectToday: roundMoney(enganche + othersTotal, precision),
		providerPayment:
			valid && shape === "split" ? roundMoney(Math.max(coveredTotal - enganche, 0), precision) : 0,
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
	const split = summary.shape === "split";
	const payment =
		split && provider.mode_of_payment
			? { mode_of_payment: provider.mode_of_payment, amount: summary.providerPayment }
			: null;
	return {
		fields: {
			is_financed: 1,
			credit_provider: provider.name,
			// The ticket's own figures, which the server derives the same way.
			customer_offered_price: split ? summary.coveredTotal : summary.creditPrice,
			enganche: split ? roundMoney(summary.coveredTotal - summary.providerPayment) : summary.coveredTotal,
			plan_months: Math.max(0, Math.trunc(numberOrNull(draft.planMonths) ?? 0)),
			plan_monthly: Math.max(numberOrNull(draft.planMonthly) ?? 0, 0),
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
