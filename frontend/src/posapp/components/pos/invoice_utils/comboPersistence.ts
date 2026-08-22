/**
 * Combo annotation across the save/load boundary (roadmap §17.6,
 * docs/POS-RIEL-Y-CAJON-BUILD.md).
 *
 * W25-B's `attachComboComponents` puts a real ARRAY on the cart line, because
 * `ItemsTable.vue` decides whether to render `ComboCartLine` with
 * `Array.isArray()`. The persisted field is a Small Text — a JSON string —
 * exactly like `posa_offers`, which is the established precedent for "a list
 * that rides on a POS Invoice Item".
 *
 * Those two facts are both correct and they do not match, so something has to
 * translate. This module is that translation, and it lives beside the save and
 * load paths rather than inside either, because the pair only makes sense read
 * together: a stringify with no matching parse is how a draft comes back with
 * `"[object Object]"` in it.
 *
 * THE FAILURE THIS GUARDS is quiet. Every draft saved before the field existed
 * — which is every draft on every tenant right now — loads with it absent. A
 * parse that throws on absent or malformed input would break resume for drafts
 * that have nothing to do with combos, and it would do it on the tenant's
 * oldest, most valuable drafts first. So both directions degrade to "not a
 * combo" and never throw.
 */

import {
	COMBO_BROKEN_FIELD,
	COMBO_COMPONENTS_FIELD,
	normalizeComboComponent,
} from "../../../composables/pos/items/comboLineAttachment";

/**
 * Read the annotation off a line in whatever shape it arrives.
 *
 * Accepts the in-memory array (a line the operator just built) AND the stored
 * string (a line coming back from a draft), because `get_invoice_items` runs
 * over both: a resumed draft is saved again without ever passing through the
 * add path. Same tolerance as `useInvoiceOffers`' `parseArrayField`, which is
 * the shape of this problem the repo already solved once.
 */
const readComponents = (value: unknown): any[] => {
	if (Array.isArray(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
};

/**
 * The two fields as they go to the server: components as a JSON string, broken
 * as 0/1.
 *
 * Returns `null` for both when the line is not a combo rather than omitting
 * the keys. Omitting them would leave a stale value in place on a line that
 * STOPPED being a combo — the packed-item path can drop a bundle's components
 * — and the ticket would keep claiming a combo the customer is no longer
 * buying.
 */
export function comboFieldsForPayload(item: any): Record<string, unknown> {
	const components = readComponents(item?.[COMBO_COMPONENTS_FIELD]);
	if (components.length === 0) {
		return { [COMBO_COMPONENTS_FIELD]: null, [COMBO_BROKEN_FIELD]: 0 };
	}
	return {
		[COMBO_COMPONENTS_FIELD]: JSON.stringify(components),
		[COMBO_BROKEN_FIELD]: item?.[COMBO_BROKEN_FIELD] ? 1 : 0,
	};
}

/**
 * Turn a loaded line's stored string back into the array the cart renders
 * from, in place.
 *
 * Mutates because the caller holds the line the operator is about to look at;
 * replacing the object would detach it from the reactive cart, which is the
 * same reason `attachComboComponents` mutates.
 *
 * Components are pushed through `normalizeComboComponent` rather than used
 * raw: a stored `qty` survives JSON as whatever type it was written as, and
 * `priceCombo()` would concatenate strings instead of adding numbers. That is
 * a wrong saving on a ticket, which is worse than no badge.
 */
export function hydrateComboFields(item: any): void {
	if (!item) return;

	const components = readComponents(item[COMBO_COMPONENTS_FIELD]);
	if (components.length === 0) {
		// Leave the line alone rather than writing an empty array: an empty
		// array is still an array, and `isComboLine()` would then have to
		// distinguish "no components" from "not a combo".
		delete item[COMBO_COMPONENTS_FIELD];
		item[COMBO_BROKEN_FIELD] = 0;
		return;
	}

	item[COMBO_COMPONENTS_FIELD] = components
		.filter((c) => String(c?.item_code ?? "").trim() !== "")
		.map(normalizeComboComponent);
	item[COMBO_BROKEN_FIELD] = item[COMBO_BROKEN_FIELD] ? 1 : 0;

	// Every component filtered out means the stored payload held only junk —
	// treat it as the non-combo it effectively is.
	if ((item[COMBO_COMPONENTS_FIELD] as any[]).length === 0) {
		delete item[COMBO_COMPONENTS_FIELD];
	}
}

/** Hydrate a whole loaded item list. Safe on a non-array. */
export function hydrateComboFieldsForItems(items: unknown): void {
	if (!Array.isArray(items)) return;
	items.forEach((item) => hydrateComboFields(item));
}
