import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import { db } from "../src/offline/db";
import {
	getAllStoredItems,
	saveItems,
	searchStoredItems,
} from "../src/offline/cache";
import {
	filterCatalogItems,
	isCatalogItemVisible,
	isFlagOn,
	readCatalogVisibility,
} from "../src/offline/catalogVisibility";
import { useItemSearch } from "../src/posapp/composables/pos/items/useItemSearch";
import { useItemCreation } from "../src/posapp/composables/pos/items/addition/useItemCreation";

/**
 * ONE TILE PER DRINK — the variant leak (golden flow §6).
 *
 * ## What was actually leaking, proved rather than assumed
 *
 * Two read paths reach the register's catalogue, and only one of them applied
 * the POS Profile's `posa_hide_variants_items` / `posa_show_template_items`.
 *
 * SERVER — clean. Probed live against `demo.lab.xoloitzcuintles.com` on
 * 2026-08-23 with the `Cafeteria Demo` profile (hide_variants = 1,
 * show_templates = 1), calling `posawesome.posawesome.api.items.get_items`
 * directly through bench:
 *
 *     blank search -> ['CAFE-JUGO']
 *     "jugo"       -> ['CAFE-JUGO']
 *
 * `_build_search_plan` adds `variant_of is not set` and, when templates are
 * hidden, `has_variants = 0`. The variants never come down the wire.
 *
 * OFFLINE CACHE — leaking. `searchStoredItems` and `getAllStoredItems` read the
 * IndexedDB `items` table with a group filter, a scope filter and a text filter
 * and NO notion of templates or variants. Read out of the live register's own
 * IndexedDB in the same session:
 *
 *     posawesome_offline.items -> 21 rows, 11 with `variant_of` set
 *     (CAFE-AMERICANO-CH/GR/MD, CAFE-CAPUCHINO-CH/GR/MD, CAFE-JUGO-CH/GR,
 *      CAFE-LATTE-CH/GR/MD)
 *
 * and `itemsStore.items` / `filteredItems` held exactly those 11 as well, on a
 * profile whose hide flag is 1. The variant rows carried `_search_index`,
 * `original_rate` and `_base_actual_qty` — client-side enrichment fields the
 * server payload does not have — which is how they were traced back to
 * `handleVariantItem` pushing `get_item_variants` results into the shared
 * catalogue array, from where `useScanProcessor` persists it wholesale.
 *
 * So: the cache path leaked, the server path did not, and the writer was the
 * variant picker. All three are covered below.
 */

const PROFILE_SCOPE = "Cafeteria Demo_Stores - DS";

/** The cafetería's juice, as the demo has it: one template, two sizes. */
const TEMPLATE = {
	item_code: "CAFE-JUGO",
	item_name: "Jugo de Naranja",
	item_group: "Cafeteria Demo",
	has_variants: 1,
	variant_of: null,
	rate: 40,
};
const VARIANTS = [
	{
		item_code: "CAFE-JUGO-CH",
		item_name: "Jugo de Naranja Chico",
		item_group: "Cafeteria Demo",
		has_variants: 0,
		variant_of: "CAFE-JUGO",
		rate: 45,
	},
	{
		item_code: "CAFE-JUGO-GR",
		item_name: "Jugo de Naranja Grande",
		item_group: "Cafeteria Demo",
		has_variants: 0,
		variant_of: "CAFE-JUGO",
		rate: 58,
	},
];

/** What `Cafeteria Demo` really carries — read off the site, not invented. */
const CAFETERIA_PROFILE = {
	name: "Cafeteria Demo",
	posa_hide_variants_items: 1,
	posa_show_template_items: 1,
};

function installLocalStorageMock() {
	const storage = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		value: {
			getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
			setItem: (key: string, value: string) => void storage.set(String(key), String(value)),
			removeItem: (key: string) => void storage.delete(String(key)),
			clear: () => storage.clear(),
			key: (index: number) => Array.from(storage.keys())[index] ?? null,
			get length() {
				return storage.size;
			},
		},
		configurable: true,
	});
}

const codesOf = (rows: any[]) => rows.map((item) => item.item_code).sort();

describe("the profile's rules, read once and read the same way everywhere", () => {
	it("reads a Check field the way a cache round-trip can leave it", () => {
		// A profile that has been through JSON and back can carry "0", which is
		// a truthy string — and a hide flag that reads truthy stops hiding.
		expect(isFlagOn(1)).toBe(true);
		expect(isFlagOn("1")).toBe(true);
		expect(isFlagOn(0)).toBe(false);
		expect(isFlagOn("0")).toBe(false);
		expect(isFlagOn("false")).toBe(false);
		expect(isFlagOn("")).toBe(false);
		expect(isFlagOn(undefined)).toBe(false);
	});

	it("has no opinion at all until a profile has loaded", () => {
		// Before the profile arrives, "templates are not shown" and "we have
		// not been told" are indistinguishable, and acting on the first would
		// empty the catalogue of every template on the first frame.
		expect(readCatalogVisibility(null)).toBeNull();
		expect(isCatalogItemVisible(TEMPLATE, null)).toBe(true);
		expect(filterCatalogItems([TEMPLATE, ...VARIANTS], null)).toHaveLength(3);
	});

	it("mirrors the server plan: templates gated by one flag, variants by the other", () => {
		const flags = readCatalogVisibility(CAFETERIA_PROFILE);
		expect(codesOf(filterCatalogItems([TEMPLATE, ...VARIANTS], flags))).toEqual(["CAFE-JUGO"]);

		const retail = readCatalogVisibility({ posa_hide_variants_items: 0, posa_show_template_items: 0 });
		expect(codesOf(filterCatalogItems([TEMPLATE, ...VARIANTS], retail))).toEqual([
			"CAFE-JUGO-CH",
			"CAFE-JUGO-GR",
		]);
	});
});

describe("the offline cache read — the path that leaked", () => {
	beforeEach(async () => {
		installLocalStorageMock();
		if (!db.isOpen()) await db.open();
		for (const table of db.tables) await table.clear();
		// Seed the table exactly as the live register's was found: the template
		// AND its variants, on a profile that hides variants.
		await saveItems([TEMPLATE, ...VARIANTS], PROFILE_SCOPE);
	});

	afterEach(async () => {
		for (const table of db.tables) await table.clear();
	});

	it("returned the variants when nobody told it the rules", async () => {
		// The unguarded call is still the unguarded call: this is the shape of
		// the read that shipped, kept so the fix is visibly a fix.
		const rows = await searchStoredItems({ search: "jugo", scope: PROFILE_SCOPE, limit: 50 });
		expect(codesOf(rows)).toEqual(["CAFE-JUGO", "CAFE-JUGO-CH", "CAFE-JUGO-GR"]);
	});

	it("offers one tile per drink once it is told", async () => {
		const rows = await searchStoredItems({
			search: "jugo",
			scope: PROFILE_SCOPE,
			limit: 50,
			visibility: readCatalogVisibility(CAFETERIA_PROFILE),
		});
		expect(codesOf(rows)).toEqual(["CAFE-JUGO"]);
	});

	it("holds on a blank term too — the grid is the same read", async () => {
		const rows = await searchStoredItems({
			search: "",
			scope: PROFILE_SCOPE,
			limit: 50,
			visibility: readCatalogVisibility(CAFETERIA_PROFILE),
		});
		expect(codesOf(rows)).toEqual(["CAFE-JUGO"]);
	});

	it("holds on the full-catalogue read as well", async () => {
		expect(codesOf(await getAllStoredItems(PROFILE_SCOPE))).toHaveLength(3);
		expect(
			codesOf(await getAllStoredItems(PROFILE_SCOPE, readCatalogVisibility(CAFETERIA_PROFILE))),
		).toEqual(["CAFE-JUGO"]);
	});

	it("counts the page AFTER the rules, so the pager does not hand out short pages", async () => {
		// Filtering a page after slicing it is the classic version of this fix
		// and it is wrong: `limit: 2` would come back with one row and the
		// caller's `offset` would drift by one on every page.
		const page = await searchStoredItems({
			search: "",
			scope: PROFILE_SCOPE,
			limit: 2,
			visibility: readCatalogVisibility({
				posa_hide_variants_items: 0,
				posa_show_template_items: 0,
			}),
		});
		expect(codesOf(page)).toEqual(["CAFE-JUGO-CH", "CAFE-JUGO-GR"]);
	});
});

describe("the display filter — the one read that was already holding", () => {
	it("drops variants when the flag arrives as a number", () => {
		const { filterAndPaginate } = useItemSearch();
		const rows = filterAndPaginate([TEMPLATE, ...VARIANTS] as any[], {
			searchTerm: "jugo",
			hideVariants: 1 as any,
			limit: 50,
		});
		expect(codesOf(rows)).toEqual(["CAFE-JUGO"]);
	});

	it("does not invert itself when the flag arrives as the string \"0\"", () => {
		const { filterAndPaginate } = useItemSearch();
		const rows = filterAndPaginate([TEMPLATE, ...VARIANTS] as any[], {
			searchTerm: "jugo",
			hideVariants: "0" as any,
			limit: 50,
		});
		expect(codesOf(rows)).toEqual(["CAFE-JUGO", "CAFE-JUGO-CH", "CAFE-JUGO-GR"]);
	});
});

describe("the variant picker stops writing into the shared catalogue", () => {
	const mockFrappe = () => {
		(globalThis as any).__ = (text: string) => text;
		(globalThis as any).frappe = {
			call: vi.fn(async () => ({
				message: { variants: VARIANTS.map((v) => ({ ...v })), attributes_meta: { Tamaño: ["Chico", "Grande"] } },
			})),
		};
	};

	const context = (profile: Record<string, unknown>, items: any[]) => ({
		pos_profile: profile,
		items,
		toastStore: { show: vi.fn() },
		uiStore: { openVariants: vi.fn() },
		customer: "Público en General",
		active_price_list: "Standard Selling",
	});

	it("keeps them out of the register's item list when the profile hides variants", async () => {
		mockFrappe();
		const items = [{ ...TEMPLATE }];
		const ctx = context(CAFETERIA_PROFILE, items);
		await useItemCreation().handleVariantItem({ ...TEMPLATE }, ctx);

		// The picker still gets them — that dialog IS where the sizes live, and
		// `get_item_variants` must keep ignoring the hide filter.
		expect(ctx.uiStore.openVariants).toHaveBeenCalledTimes(1);
		expect(codesOf(ctx.uiStore.openVariants.mock.calls[0][0].items)).toEqual([
			"CAFE-JUGO-CH",
			"CAFE-JUGO-GR",
		]);
		// The shared array is untouched — which is what used to reach IndexedDB
		// through `useScanProcessor`'s `saveItems(items.value, scope)`.
		expect(codesOf(items)).toEqual(["CAFE-JUGO"]);
	});

	it("still warms the catalogue on a register that shows variants", async () => {
		mockFrappe();
		const items = [{ ...TEMPLATE }];
		const ctx = context({ ...CAFETERIA_PROFILE, posa_hide_variants_items: 0 }, items);
		await useItemCreation().handleVariantItem({ ...TEMPLATE }, ctx);
		expect(codesOf(items)).toEqual(["CAFE-JUGO", "CAFE-JUGO-CH", "CAFE-JUGO-GR"]);
	});

	it("reuses variants already in the list instead of fetching again", async () => {
		mockFrappe();
		const items = [{ ...TEMPLATE }, ...VARIANTS.map((v) => ({ ...v }))];
		const ctx = context({ ...CAFETERIA_PROFILE, posa_hide_variants_items: 0 }, items);
		await useItemCreation().handleVariantItem({ ...TEMPLATE }, ctx);
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
		expect(codesOf(items)).toEqual(["CAFE-JUGO", "CAFE-JUGO-CH", "CAFE-JUGO-GR"]);
	});
});
