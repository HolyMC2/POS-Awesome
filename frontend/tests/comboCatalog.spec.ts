import { describe, expect, it } from "vitest";

import {
	COMBOS_CATEGORY_ID,
	COMBOS_CATEGORY_TESTID,
	SUGGESTION_LIMIT,
	buildCombosCategory,
	buildSuggestions,
	combosForCart,
	suggestionAddPayload,
	type ComboOffer,
	type ComboSuggestion,
} from "../src/posapp/composables/pos/combos/comboCatalog";

const IPHONE_COMBO: ComboOffer = {
	item_code: "COMBO-IP15P",
	item_name: "Combo Protección iPhone 15 Pro",
	rate: 299,
	targets: ["IPN001758"],
	components: [
		{ item_code: "IPN001758", item_name: "Case negro", qty: 1, rate: 200 },
		{ item_code: "MICA15P", item_name: "Mica Cristal", qty: 1, rate: 80 },
		{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60 },
	],
};

const HONOR_COMBO: ComboOffer = {
	item_code: "COMBO-X8A",
	item_name: "Combo Protección Honor X8A",
	rate: 289,
	targets: ["IPN002611"],
	components: [
		{ item_code: "IPN002611", item_name: "Case rojo", qty: 1, rate: 185 },
		{ item_code: "MICAX8A", item_name: "Mica", qty: 1, rate: 80 },
		{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60 },
	],
};

const UNIVERSAL_COMBO: ComboOffer = {
	item_code: "COMBO-CARGA",
	item_name: "Combo Carga Rápida",
	rate: 349,
	components: [
		{ item_code: "CABLE", item_name: "Cable USB-C", qty: 1, rate: 90 },
		{ item_code: "CUBO", item_name: "Cubo 20W", qty: 1, rate: 289 },
	],
};

describe("the Combos category handed to the drawer", () => {
	it("matches the drawer's CatalogCategory contract", () => {
		const category = buildCombosCategory([IPHONE_COMBO, HONOR_COMBO]);
		expect(category).toEqual({
			id: COMBOS_CATEGORY_ID,
			label: "Combos",
			count: 2,
			featured: true,
		});
	});

	it("is featured, so an empty-cart open lands on bundles", () => {
		expect(buildCombosCategory([IPHONE_COMBO])?.featured).toBe(true);
	});

	it("offers no chip at all when the register sells no combos", () => {
		// An empty category chip promises content that is not there.
		expect(buildCombosCategory([])).toBeNull();
	});

	it("uses the caller's translator", () => {
		const category = buildCombosCategory([IPHONE_COMBO], () => "Paquetes");
		expect(category?.label).toBe("Paquetes");
	});

	it("resolves to the selector the drawer actually renders", () => {
		// The drawer owns the prefix, this module owns the id.
		expect(COMBOS_CATEGORY_TESTID).toBe("catalog-drawer-category-combos");
	});
});

describe("filtering combos by what the customer is buying", () => {
	it("suggests the combo for the device in the cart, not the other one", () => {
		const eligible = combosForCart([IPHONE_COMBO, HONOR_COMBO], ["IPN002611"]);
		expect(eligible.map((c) => c.item_code)).toEqual(["COMBO-X8A"]);
	});

	it("always offers a combo that targets nothing", () => {
		const eligible = combosForCart([UNIVERSAL_COMBO], ["ANYTHING"]);
		expect(eligible).toHaveLength(1);
	});

	it("never suggests a combo already on the ticket", () => {
		const eligible = combosForCart([UNIVERSAL_COMBO], ["COMBO-CARGA"]);
		expect(eligible).toEqual([]);
	});
});

describe("ranking the se-suele-llevar-junto strip", () => {
	const accessories = [
		{ item_code: "MICA15P", item_name: "Mica Cristal iPhone 15 Pro", rate: 80, actual_qty: 24 },
		{ item_code: "CABLE", item_name: "Cable USB-C 1 m Reforzado", rate: 90, actual_qty: 41 },
	];

	it("puts a combo targeting the cart ahead of a universal one", () => {
		const suggestions = buildSuggestions({
			combos: [UNIVERSAL_COMBO, HONOR_COMBO],
			cart: ["IPN002611"],
		});
		expect(suggestions[0]?.item_code).toBe("COMBO-X8A");
		expect(suggestions[0]?.reason).toBe("targets-cart-item");
		expect(suggestions[1]?.reason).toBe("universal");
	});

	it("carries the saving on combo tiles and the stock count on item tiles", () => {
		const suggestions = buildSuggestions({
			combos: [HONOR_COMBO],
			accessories,
			cart: ["IPN002611"],
		});
		const combo = suggestions.find((s) => s.kind === "combo");
		const item = suggestions.find((s) => s.kind === "item");
		expect(combo?.saving).toBe(36);
		expect(item?.availableQty).toBe(24);
	});

	it("is stable across renders, because Enter adds the first tile", () => {
		const args = {
			combos: [UNIVERSAL_COMBO, HONOR_COMBO],
			accessories,
			cart: ["IPN002611"],
		};
		expect(buildSuggestions(args)).toEqual(buildSuggestions(args));
	});

	it("honours the register's priority before the larger saving", () => {
		const suggestions = buildSuggestions({
			combos: [
				{ ...UNIVERSAL_COMBO, item_code: "A", priority: 5 },
				{ ...UNIVERSAL_COMBO, item_code: "B", priority: 1 },
			],
		});
		expect(suggestions.map((s) => s.item_code)).toEqual(["B", "A"]);
	});

	it("fills to four tiles, the width the artboard draws", () => {
		expect(SUGGESTION_LIMIT).toBe(4);
		const suggestions = buildSuggestions({ combos: [HONOR_COMBO], accessories });
		expect(suggestions.length).toBeLessThanOrEqual(SUGGESTION_LIMIT);
	});

	it("drops a combo the shelves cannot cover even once", () => {
		// The strip binds Enter to its first tile; an unsellable leader costs
		// the cashier the primary keyboard action.
		const outOfStock: ComboOffer = {
			...HONOR_COMBO,
			components: [
				{ item_code: "IPN002611", item_name: "Case rojo", qty: 1, rate: 185, actual_qty: 0 },
				{ item_code: "MICAX8A", item_name: "Mica", qty: 1, rate: 80, actual_qty: 40 },
			],
		};
		const suggestions = buildSuggestions({ combos: [outOfStock], cart: ["IPN002611"] });
		expect(suggestions.map((s) => s.item_code)).not.toContain("COMBO-X8A");
	});

	it("keeps a combo whose stock is merely UNKNOWN", () => {
		// Absence of a reading is not absence of stock — an offline register
		// must still be able to suggest.
		const suggestions = buildSuggestions({ combos: [HONOR_COMBO], cart: ["IPN002611"] });
		expect(suggestions.map((s) => s.item_code)).toContain("COMBO-X8A");
		expect(suggestions[0]?.availability?.reason).toBe("unknown");
	});

	it("keeps an all-labour combo, which is unbounded rather than empty", () => {
		const labour: ComboOffer = {
			item_code: "COMBO-SRV",
			item_name: "Combo Instalación",
			rate: 150,
			components: [
				{ item_code: "SRV-A", item_name: "Instalación", qty: 1, rate: 100, actual_qty: 0, is_stock_item: 0 },
			],
		} as ComboOffer;
		const suggestions = buildSuggestions({ combos: [labour] });
		expect(suggestions.map((s) => s.item_code)).toContain("COMBO-SRV");
		expect(suggestions[0]?.availability?.reason).toBe("unbounded");
	});

	it("drops anything already in the cart from both halves", () => {
		const suggestions = buildSuggestions({
			combos: [HONOR_COMBO],
			accessories,
			cart: ["CABLE", "COMBO-X8A"],
		});
		expect(suggestions.map((s) => s.item_code)).not.toContain("CABLE");
		expect(suggestions.map((s) => s.item_code)).not.toContain("COMBO-X8A");
	});

	it("reads the ticket as LINES as well as as codes", () => {
		// The shell holds `invoiceDoc.items`, every spec here holds codes, and
		// the one call site in the product got that difference wrong: it passed
		// the cart's lines into the accessories slot, so the strip would have
		// offered the cashier the items they had just scanned.
		const fromLines = buildSuggestions({
			combos: [IPHONE_COMBO, HONOR_COMBO],
			cart: [{ item_code: "IPN002611", qty: 1 }],
		});
		expect(fromLines.map((s) => s.item_code)).toEqual(["COMBO-X8A"]);
		expect(fromLines).toEqual(
			buildSuggestions({ combos: [IPHONE_COMBO, HONOR_COMBO], cart: ["IPN002611"] }),
		);
	});

	it("suggests nothing when the register has no combos and no accessories", () => {
		// The honest empty state: the strip does not render at all.
		expect(buildSuggestions({})).toEqual([]);
		expect(buildSuggestions({ combos: [], accessories: [], cart: ["IPN002611"] })).toEqual([]);
	});
});

/**
 * The `Existencia` vocabulary, on a tile instead of a cart row.
 *
 * `cartLineStock.ts` settled this for the cart and the strip must not settle it
 * differently: an ABSENT figure is not a zero. A cashier who reads `0 pzas`
 * tells the customer the shop has none — so absence draws nothing and lets
 * them look.
 */
describe("what a plain accessory tile says about stock", () => {
	const base = { item_code: "MICA15P", item_name: "Mica Cristal", rate: 80 };

	it("carries the count when the register knows it", () => {
		const [tile] = buildSuggestions({ accessories: [{ ...base, actual_qty: 24 }] });
		expect(tile?.availableQty).toBe(24);
	});

	it("carries NULL, not 0, when no figure was supplied", () => {
		const [tile] = buildSuggestions({ accessories: [base] });
		expect(tile?.availableQty).toBeNull();
		expect(tile?.availableQty).not.toBe(0);
	});

	it("carries NULL for a service, which has no shelf to be counted on", () => {
		const [tile] = buildSuggestions({
			accessories: [{ ...base, item_code: "SRV-INST", is_stock_item: 0, actual_qty: 0 }],
		});
		expect(tile?.item_code).toBe("SRV-INST");
		expect(tile?.availableQty).toBeNull();
	});

	it("prefers the figure the stock gate enforces on a multi-UOM item", () => {
		// A line sold by the box must not be told it has twelve when twelve is
		// the count of singles — same preference `describeLineStock` applies.
		const [tile] = buildSuggestions({
			accessories: [{ ...base, _base_actual_qty: 24, conversion_factor: 12, actual_qty: 24 }],
		});
		expect(tile?.availableQty).toBe(2);
	});

	it("drops an accessory that is KNOWN to be out of stock", () => {
		// Same rule as the combos, same reason: Enter binds to the first tile.
		const suggestions = buildSuggestions({
			accessories: [
				{ ...base, item_code: "GONE", actual_qty: 0 },
				{ ...base, item_code: "HERE", actual_qty: 3 },
			],
		});
		expect(suggestions.map((s) => s.item_code)).toEqual(["HERE"]);
	});
});

/**
 * Accepting a tile has to produce a line the cart can actually sell.
 *
 * The strip draws code, name and price. `useItemAddition.addItem` builds the
 * line from whatever object it is handed — so a payload made of those three
 * fields yields a line with no uom, no stock flags and, for a combo, nothing
 * for `expandBundle` to build a packing list from: the parent would sell and
 * no component would decrement.
 */
describe("what the shell adds when a tile is accepted", () => {
	const TILE: ComboSuggestion = {
		item_code: "COMBO-X8A",
		item_name: "Combo Protección Honor X8A",
		rate: 289,
		kind: "combo",
		reason: "targets-cart-item",
	};

	/** A catalogue row as `itemsStore.getItemByCode` returns it. */
	const CATALOG_ITEM = {
		item_code: "COMBO-X8A",
		item_name: "Combo Protección Honor X8A",
		rate: 289,
		stock_uom: "Nos",
		uom: "Nos",
		is_stock_item: 1,
		has_batch_no: 0,
		actual_qty: 9,
		_base_actual_qty: 9,
		conversion_factor: 1,
		item_group: "Combos",
	};

	it("hands over the CATALOGUE row, not the tile", () => {
		const payload = suggestionAddPayload(TILE, () => CATALOG_ITEM);
		expect(payload).toMatchObject({
			item_code: "COMBO-X8A",
			stock_uom: "Nos",
			is_stock_item: 1,
			_base_actual_qty: 9,
			qty: 1,
		});
	});

	it("copies rather than handing over the catalogue's own row", () => {
		// `addItem` mutates what it is given — uom defaulting, batch selection.
		// The grid's row must not acquire a qty because someone tapped a tile.
		const payload = suggestionAddPayload(TILE, () => CATALOG_ITEM);
		expect(payload).not.toBe(CATALOG_ITEM);
		expect((CATALOG_ITEM as any).qty).toBeUndefined();
	});

	it("declines rather than guessing when the catalogue does not carry it", () => {
		// A fabricated line prices at the tile's rate and decrements nothing.
		expect(suggestionAddPayload(TILE, () => null)).toBeNull();
		expect(suggestionAddPayload(TILE, () => ({}))).toBeNull();
		expect(suggestionAddPayload(TILE, undefined as any)).toBeNull();
	});

	it("declines a tile with no code at all", () => {
		expect(suggestionAddPayload({ ...TILE, item_code: "  " }, () => CATALOG_ITEM)).toBeNull();
		expect(suggestionAddPayload(null, () => CATALOG_ITEM)).toBeNull();
	});
});
