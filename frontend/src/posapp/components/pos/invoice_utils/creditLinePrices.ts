/**
 * Cart side of a provider-financed credit sale (bus `credit:line-prices`).
 *
 * The credit store decides the prices (`creditMath.planCreditReprice`); this
 * writes them onto the cart lines the way a typed price lands — rate, base rate,
 * amount — except that the line is PINNED: `locked_price` keeps every repricing
 * pass (price list, pricing rules, item refresh) off it and the price-list rate
 * moves with it, so the line carries no discount. The rate-band preview stays
 * quiet on it (`posa_px_skip_rate_band`, a row-only flag the server never
 * reads); the server's price guards learn about these lines from mercado's
 * exemption hook, not from anything on the row.
 */
import { toBaseCurrency } from "../../../utils/currencyConversion";
import type { CreditLinePricesIntent } from "../../../composables/pos/credit/creditMath";

const pin = (item: any) => {
	item.locked_price = true;
	item._manual_rate_set = true;
	item._manual_rate_set_from_uom = false;
	item.posa_px_skip_rate_band = 1;
};

/**
 * Apply `intent` to `context.items`. Returns the lines whose own price has to
 * come back from the price list (restored without a snapshot).
 */
export function applyCreditLinePrices(context: any, intent: CreditLinePricesIntent): any[] {
	const rows: any[] = Array.isArray(context?.items) ? context.items : [];
	const byRow = new Map(rows.filter(Boolean).map((row) => [String(row.posa_row_id || ""), row]));
	const round = (value: number) =>
		typeof context?.flt === "function" ? context.flt(value, context.currency_precision) : value;
	const toBase = (value: number) => {
		const converted = toBaseCurrency(context, value);
		return converted == null ? value : converted;
	};
	const writeAmounts = (item: any) => {
		const qty = Number(item.qty) || 0;
		item.amount = round(qty * (Number(item.rate) || 0));
		item.base_amount = round(qty * (Number(item.base_rate) || 0));
	};

	const refetch: any[] = [];
	for (const entry of intent?.restore || []) {
		const item = byRow.get(entry.rowId);
		if (!item) continue;
		if (entry.price) {
			Object.assign(item, entry.price);
			if (item.base_rate == null) item.base_rate = toBase(Number(item.rate) || 0);
			if (item.base_price_list_rate == null) item.base_price_list_rate = toBase(Number(item.price_list_rate) || 0);
			if (item.base_discount_amount == null) item.base_discount_amount = toBase(Number(item.discount_amount) || 0);
		} else {
			item.locked_price = false;
			item._manual_rate_set = false;
			item._manual_rate_set_from_uom = false;
			item.posa_px_skip_rate_band = 0;
			refetch.push(item);
		}
		writeAmounts(item);
	}
	for (const entry of intent?.set || []) {
		const item = byRow.get(entry.rowId);
		if (!item) continue;
		const rate = round(Math.max(Number(entry.rate) || 0, 0));
		const baseRate = toBase(rate);
		item.price_list_rate = rate;
		item.base_price_list_rate = baseRate;
		item.rate = rate;
		item.base_rate = baseRate;
		item.discount_percentage = 0;
		item.discount_amount = 0;
		item.base_discount_amount = 0;
		pin(item);
		writeAmounts(item);
	}
	for (const rowId of intent?.lock || []) {
		const item = byRow.get(rowId);
		if (item) pin(item);
	}
	return refetch;
}
