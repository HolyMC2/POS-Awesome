/**
 * Priced components for a bundle, for the cart line that sells it.
 *
 * Distinct from the neighbouring `useBundles`, which reads
 * `api.bundles.get_bundle_components` — that endpoint answers the PACKING
 * question (`item_code`, `qty`, `uom`, `is_batch`, `is_serial`) and carries no
 * rate, so it cannot feed `priceCombo()`. `api.combos.get_combo_components`
 * answers the SELLING question: the same components enriched with the active
 * price list's rate, warehouse stock and `is_stock_item`.
 *
 * Both are kept. Replacing the packing call with this one would drop
 * `is_batch`/`is_serial`, which `expandBundle` needs to build packed items,
 * and adding those to the combos read model is backend territory.
 */

import { normalizeComboComponent } from "./comboLineAttachment";
import type { ComboComponent } from "../combos/comboPricing";

declare const frappe: any;

const TTL_MS = 60_000;

/**
 * Cached per bundle AND per pricing context. A combo's components are priced
 * in the register's selling price list, and a customer with their own price
 * list gets different rates — so a cache keyed on the bundle alone would quote
 * one customer's saving to the next. Same reasoning as the sequence guard the
 * price checker uses.
 */
const cache = new Map<string, { data: ComboComponent[]; ts: number }>();

const keyFor = (bundleCode: string, posProfile: any, customer: unknown) =>
	[
		bundleCode,
		String(posProfile?.name ?? ""),
		String(posProfile?.selling_price_list ?? ""),
		String(customer ?? ""),
	].join("::");

/** Test seam — the cache is module state and would leak between specs. */
export const clearComboComponentsCache = (): void => cache.clear();

export interface ComboComponentsContext {
	pos_profile?: any;
	customer?: unknown;
}

export function useComboComponents() {
	/**
	 * Components for one bundle, or `[]` when it is not a combo.
	 *
	 * `[]` is also the answer on failure, and deliberately so: a combo whose
	 * components could not be fetched should sell as an ordinary line at the
	 * price the shop set, not refuse to sell. The row simply renders without
	 * the badge — the sale is never the thing that breaks.
	 */
	const getComboComponents = async (
		bundleCode: string,
		context: ComboComponentsContext = {},
	): Promise<ComboComponent[]> => {
		const code = String(bundleCode ?? "").trim();
		if (!code) return [];

		const key = keyFor(code, context.pos_profile, context.customer);
		const cached = cache.get(key);
		const now = Date.now();
		if (cached && now - cached.ts < TTL_MS) {
			return cached.data;
		}

		try {
			const response = await frappe.call({
				method: "posawesome.posawesome.api.combos.get_combo_components",
				args: {
					bundles: [code],
					pos_profile: context.pos_profile?.name ?? context.pos_profile,
					customer: context.customer ?? null,
				},
			});
			const raw = response?.message?.[code];
			const data = Array.isArray(raw) ? raw.map(normalizeComboComponent) : [];
			cache.set(key, { data, ts: now });
			return data;
		} catch (error) {
			console.error("Failed to fetch combo components", error);
			return [];
		}
	};

	return { getComboComponents };
}
