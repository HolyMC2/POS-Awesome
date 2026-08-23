import { describe, expect, it } from "vitest";

import { isSaldoItem, useItemSearch } from "../src/posapp/composables/pos/items/useItemSearch";

/**
 * Saldo items are sold from the Recargas destination only (owner direction
 * 2026-08-22). The sale catalogue and the scan field's matches must not offer
 * them: reached from there, a recharge skips the number typed twice and the
 * company chosen on purpose. The items stay in the store — the recharge
 * hand-off still resolves them by code — so the guard lives in the one
 * function every visible list goes through.
 */

const ITEMS = [
	{ item_code: "IPN001", item_name: "Anillo Case", rate: 200 },
	{ item_code: "TEL050", item_name: "Telcel $50", rate: 50, saldo_enabled: 1 },
	{ item_code: "BAI050", item_name: "Bait $50", rate: 50, saldo_enabled: "1" },
	{ item_code: "IPN002", item_name: "Adaptador", rate: 120, saldo_enabled: 0 },
];

describe("isSaldoItem", () => {
	it("reads the get_items flag as the add-to-cart guard does", () => {
		expect(isSaldoItem({ saldo_enabled: 1 })).toBe(true);
		expect(isSaldoItem({ saldo_enabled: "1" })).toBe(true);
		expect(isSaldoItem({ saldo_enabled: 0 })).toBe(false);
		expect(isSaldoItem({})).toBe(false);
		expect(isSaldoItem(null)).toBe(false);
	});
});

describe("filterAndPaginate with hideSaldo", () => {
	const { filterAndPaginate } = useItemSearch();

	it("drops saldo items from the catalogue even on the no-filter fast path", () => {
		const codes = filterAndPaginate(ITEMS as never, { hideSaldo: true }).map((i) => i.item_code);
		expect(codes).toEqual(["IPN001", "IPN002"]);
	});

	it("drops them from search hits too", () => {
		const codes = filterAndPaginate(ITEMS as never, { hideSaldo: true, searchTerm: "$50" }).map(
			(i) => i.item_code,
		);
		expect(codes).toEqual([]);
	});

	it("leaves every other caller untouched", () => {
		expect(filterAndPaginate(ITEMS as never, {}).length).toBe(4);
	});
});
