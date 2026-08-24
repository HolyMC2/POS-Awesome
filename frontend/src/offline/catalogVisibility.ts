/**
 * WHICH ITEMS THE REGISTER'S CATALOGUE IS ALLOWED TO SHOW.
 *
 * ## The leak this exists to close
 *
 * The POS Profile carries two flags that decide whether a template, a variant,
 * or both appear in the catalogue: `posa_show_template_items` and
 * `posa_hide_variants_items`. The SERVER honours both — `_build_search_plan` in
 * `api/item_processing/search.py` adds `has_variants = 0` when templates are
 * hidden and `variant_of is not set` when variants are. Probed live against the
 * cafetería demo on 2026-08-23 (`Cafeteria Demo`, hide_variants = 1,
 * show_templates = 1), `get_items` returned exactly `['CAFE-JUGO']` for both a
 * blank and a typed search: no variants, ever.
 *
 * The OFFLINE cache honoured neither. `searchStoredItems` and
 * `getAllStoredItems` read the IndexedDB `items` table with a group filter, a
 * scope filter and a text filter — and no notion of templates or variants at
 * all. Read back on the same register:
 *
 *     posawesome_offline.items -> 21 rows, 11 of them with `variant_of` set
 *     (CAFE-AMERICANO-CH/GR/MD, CAFE-CAPUCHINO-CH/GR/MD, CAFE-JUGO-CH/GR,
 *     CAFE-LATTE-CH/GR/MD), on a profile whose hide flag is 1
 *
 * and those same 11 rows were sitting in `itemsStore.items` and in
 * `filteredItems`. So the register's in-memory catalogue disagreed with its own
 * profile on every boot, and the ONLY thing keeping the variant tiles off the
 * grid was a single truthiness read inside `ItemsSelector.displayedItems`.
 * Anything else that consumes `items` or `filteredItems` — and a future surface
 * that forgets that one read — saw «Jugo de Naranja Chico» beside «Jugo de
 * Naranja».
 *
 * How the variants got in there is the other half, fixed at
 * `useItemCreation.handleVariantItem`: the variant PICKER fetches them (via
 * `get_item_variants`, which must keep ignoring the hide filter — that dialog
 * is where sizes live) and pushed them straight into the shared catalogue
 * array, from where `useScanProcessor` persisted the whole array to IndexedDB.
 * One picker open contaminated the cache permanently.
 *
 * ## Why the rule lives here
 *
 * `offline/` has no dependency on `posapp/`, and the SPA already imports from
 * `offline/`, so a pure predicate here can be read by the cache, by the search
 * filter and by anything else that grows a catalogue read later. Filtering
 * inside the Dexie chain (before `.offset()/.limit()`) rather than after it also
 * keeps the page sizes honest — filtering a page after slicing it hands the
 * pager short pages and drifts its offset.
 *
 * The filter is applied on READ, not on write, on purpose: it is what heals the
 * caches that are already contaminated in the field. Nothing migrates the
 * browsers that have those 11 rows; a read-side rule fixes them on next boot.
 */

export interface CatalogVisibilityFlags {
	/** POS Profile `posa_hide_variants_items`. */
	hideVariants?: unknown;
	/** POS Profile `posa_show_template_items`. */
	showTemplates?: unknown;
}

export interface CatalogVisibilityItem {
	variant_of?: unknown;
	has_variants?: unknown;
	[key: string]: unknown;
}

/**
 * Frappe Check fields arrive as `1`/`0`, but a profile that has round-tripped
 * through a cache or a form can carry `"1"`, `"0"` or `"false"`. `"0"` is
 * truthy as a string, which is exactly how a hide flag silently stops hiding.
 */
export const isFlagOn = (value: unknown): boolean => {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized || normalized === "0" || normalized === "false" || normalized === "no") {
			return false;
		}
		return true;
	}
	return !!value;
};

/**
 * The profile's answer, or `null` when there is no profile to ask.
 *
 * `null` matters: before the profile loads, "templates are not shown" would be
 * indistinguishable from "we have not been told yet", and applying it would
 * empty the catalogue of every template on the first frame. No profile means no
 * opinion, and the read passes through untouched.
 */
export const readCatalogVisibility = (
	posProfile: Record<string, unknown> | null | undefined,
): CatalogVisibilityFlags | null => {
	if (!posProfile || typeof posProfile !== "object") return null;
	return {
		hideVariants: posProfile.posa_hide_variants_items,
		showTemplates: posProfile.posa_show_template_items,
	};
};

/**
 * Does this row belong on a catalogue surface?
 *
 * Mirrors the server plan exactly, and in the same order:
 *   - templates (`has_variants`) are excluded unless `posa_show_template_items`
 *   - variants (`variant_of`) are excluded when `posa_hide_variants_items`
 *
 * The variant PICKER deliberately does not go through here — `get_item_variants`
 * is the one read that must return the rows this hides.
 */
export const isCatalogItemVisible = (
	item: CatalogVisibilityItem | null | undefined,
	flags: CatalogVisibilityFlags | null | undefined,
): boolean => {
	if (!item || !flags) return true;
	if (isFlagOn(flags.hideVariants) && item.variant_of) return false;
	if (!isFlagOn(flags.showTemplates) && item.has_variants) return false;
	return true;
};

/** Whether these flags can exclude anything at all — lets a hot read skip the pass. */
export const catalogVisibilityFilters = (
	flags: CatalogVisibilityFlags | null | undefined,
): boolean => !!flags && (isFlagOn(flags.hideVariants) || !isFlagOn(flags.showTemplates));

export const filterCatalogItems = <T extends CatalogVisibilityItem>(
	items: readonly T[] | null | undefined,
	flags: CatalogVisibilityFlags | null | undefined,
): T[] => {
	const list = Array.isArray(items) ? items : [];
	if (!catalogVisibilityFilters(flags)) return [...list];
	return list.filter((item) => isCatalogItemVisible(item, flags));
};
