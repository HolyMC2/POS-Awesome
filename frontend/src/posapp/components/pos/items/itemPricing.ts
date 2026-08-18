/**
 * Cost / price / margin arithmetic for quick item creation (roadmap §17.2).
 *
 * Pure and separately tested because it is MONEY a shopkeeper will trust
 * without re-checking: "le gano 30%" has to mean the same thing every time,
 * and a rounding slip here becomes a mispriced shelf.
 *
 * MARGIN HERE IS MARKUP OVER COST — (sell − cost) / cost — which is what a
 * Mexican retailer means by "margen" at the counter ("me cuesta 10, le gano
 * 50%, lo vendo en 15"). The other convention (margin over PRICE) exists and
 * gives a different number for the same pair, so the UI labels it explicitly
 * and shows the resulting profit in currency next to it. Never silently
 * switch conventions: the same word meaning two things is how a shop loses a
 * point of margin per item without noticing.
 */

/** Money rounded the way a price tag is: 2 decimals, half away from zero. */
export const roundMoney = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.round((value + Number.EPSILON) * 100) / 100;
};

const roundPercent = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.round((value + Number.EPSILON) * 100) / 100;
};

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/**
 * Sell price implied by a cost and a markup percentage.
 * Returns null when it cannot be computed honestly — a zero cost has no
 * markup (any price is an infinite gain), so the UI must leave the field
 * alone rather than write a confident 0.
 */
export const sellFromMargin = (cost: unknown, marginPct: unknown): number | null => {
	const c = toNumber(cost);
	if (c <= 0) return null;
	return roundMoney(c * (1 + toNumber(marginPct) / 100));
};

/**
 * Markup percentage implied by a cost and a sell price. Null when the cost
 * is zero or absent (see above). Negative is legitimate and preserved: a
 * clearance item sold under cost should SAY −20%, not hide it.
 */
export const marginFromSell = (cost: unknown, sell: unknown): number | null => {
	const c = toNumber(cost);
	if (c <= 0) return null;
	return roundPercent(((toNumber(sell) - c) / c) * 100);
};

/** Currency profit per unit. Meaningful even when cost is 0. */
export const profitAmount = (cost: unknown, sell: unknown): number =>
	roundMoney(toNumber(sell) - toNumber(cost));

/**
 * What blocks creating this item, as operator-facing reasons.
 *
 * Opening stock is the one that bites: ERPNext throws "Valuation Rate is
 * mandatory if Opening Stock entered" from deep inside the Item controller,
 * and it needs a warehouse to post into. Both are caught here so the cashier
 * reads a sentence about their form instead of a server traceback.
 */
export interface QuickItemDraft {
	item_code?: string;
	item_name?: string;
	item_group?: string;
	stock_uom?: string;
	valuation_rate?: unknown;
	opening_stock?: unknown;
}

export const quickItemBlockers = (
	draft: QuickItemDraft,
	context: { warehouse?: string | null } = {},
): string[] => {
	const blockers: string[] = [];
	if (!String(draft.item_code || "").trim()) blockers.push("item_code");
	if (!String(draft.item_name || "").trim()) blockers.push("item_name");
	if (!String(draft.item_group || "").trim()) blockers.push("item_group");
	if (!String(draft.stock_uom || "").trim()) blockers.push("stock_uom");

	const qty = toNumber(draft.opening_stock);
	if (qty > 0) {
		if (toNumber(draft.valuation_rate) <= 0) blockers.push("opening_needs_cost");
		if (!context.warehouse) blockers.push("opening_needs_warehouse");
	}
	if (qty < 0) blockers.push("opening_negative");
	return blockers;
};

/**
 * The Item doc for `frappe.client.insert`.
 *
 * Only sends what the operator filled: an empty description or a zero
 * opening stock must not appear in the payload, because a present-but-empty
 * field overwrites an ERPNext default that would otherwise apply.
 */
export const buildQuickItemPayload = (
	draft: Record<string, unknown>,
	context: { company?: string | null; warehouse?: string | null },
): Record<string, unknown> => {
	const payload: Record<string, unknown> = {
		item_code: String(draft.item_code || "").trim(),
		item_name: String(draft.item_name || "").trim(),
		item_group: draft.item_group,
		stock_uom: draft.stock_uom,
		standard_rate: roundMoney(toNumber(draft.standard_rate)),
	};

	const barcode = String(draft.barcode || "").trim();
	if (barcode) payload.barcode = barcode;

	const description = String(draft.description || "").trim();
	if (description) payload.description = description;

	const cost = toNumber(draft.valuation_rate);
	if (cost > 0) payload.valuation_rate = roundMoney(cost);

	const taxTemplate = String(draft.item_tax_template || "").trim();
	if (taxTemplate) {
		payload.taxes = [{ item_tax_template: taxTemplate }];
	}

	const qty = toNumber(draft.opening_stock);
	if (qty > 0) {
		payload.opening_stock = qty;
		// Explicit defaults row: ERPNext otherwise guesses a warehouse from
		// Stock Settings or a "Stores" lookup, and stock landing in a
		// warehouse the register cannot sell from looks like the item was
		// created broken.
		if (context.company && context.warehouse) {
			payload.item_defaults = [
				{ company: context.company, default_warehouse: context.warehouse },
			];
		}
	}

	return payload;
};
