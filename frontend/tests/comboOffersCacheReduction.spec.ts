/**
 * The register's memory-pressure sweep has to reach the combo slot too.
 *
 * `reduceCacheUsage()` is what a register runs when IndexedDB is squeezed, and
 * it clears its slots BY NAME — a list that a new cache module joins only if
 * somebody remembers to add it. `offline/comboOffers.ts` arrived after that
 * list was written, so its contexts survived every sweep. Small (at most eight
 * pricing contexts of a handful of bundles), which is exactly why it would have
 * gone unnoticed: this is hygiene, and hygiene is what a spec is for.
 *
 * `offline/comboOffers.ts` is imported DIRECTLY here, never through
 * `offline/index.ts` — the barrel is stubbed by half the suite, and a
 * cache-clear that no-ops under a stub would pass this file while shipping
 * nothing.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { reduceCacheUsage } from "../src/offline/cache";
import {
	COMBO_OFFERS_CACHE_KEY,
	clearCachedComboOffers,
	peekCachedComboOffers,
	saveComboOffers,
} from "../src/offline/comboOffers";
import { memory } from "../src/offline/db";

const PROFILE = {
	name: "Doco Ventas",
	selling_price_list: "Standard Selling",
	warehouse: "Tienda - D",
};

const OFFER = [{ item_code: "COMBO-PROTECCION", rate: 289 }];

describe("reduceCacheUsage clears the combo offers slot", () => {
	beforeEach(() => {
		clearCachedComboOffers();
	});

	it("forgets the bundles it had cached", () => {
		saveComboOffers(PROFILE, "Sofía Ramírez", OFFER);
		expect(peekCachedComboOffers(PROFILE, "Sofía Ramírez")).toEqual(OFFER);

		reduceCacheUsage();

		expect(peekCachedComboOffers(PROFILE, "Sofía Ramírez")).toBeNull();
	});

	it("leaves the slot empty rather than deleted, so the next save has somewhere to land", () => {
		saveComboOffers(PROFILE, "Sofía Ramírez", OFFER);
		reduceCacheUsage();

		expect(memory[COMBO_OFFERS_CACHE_KEY]).toEqual({});

		// A cleared cache is a cold cache, not a broken one.
		saveComboOffers(PROFILE, null, OFFER);
		expect(peekCachedComboOffers(PROFILE, null)).toEqual(OFFER);
	});

	it("takes every pricing context with it, not just the one last written", () => {
		saveComboOffers(PROFILE, "Sofía Ramírez", OFFER);
		saveComboOffers(PROFILE, "Mostrador", OFFER);
		saveComboOffers({ ...PROFILE, selling_price_list: "Mayoreo" }, null, OFFER);

		reduceCacheUsage();

		expect(peekCachedComboOffers(PROFILE, "Sofía Ramírez")).toBeNull();
		expect(peekCachedComboOffers(PROFILE, "Mostrador")).toBeNull();
		expect(
			peekCachedComboOffers({ ...PROFILE, selling_price_list: "Mayoreo" }, null),
		).toBeNull();
	});
});
