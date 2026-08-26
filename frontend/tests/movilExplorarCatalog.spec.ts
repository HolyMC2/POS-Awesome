/**
 * The phone browse screen's view model — cards, chips, footer.
 *
 * `MovilExplorar.dc.html` draws three things that can each be wrong in a way
 * the cashier acts on:
 *
 *   - a stock figure on every card (`8`, `últimas 2`, or nothing at all),
 *   - a count on every category chip, and
 *   - a footer that either claims compatibility or does not.
 *
 * The stock rules are NOT re-litigated here — `cartLineStock.spec.ts` owns
 * them. What this file checks is that this screen inherits them rather than
 * inventing a second opinion, which is the failure that puts two different
 * numbers for the same shelf on two surfaces of one register.
 *
 * No jsdom: none of this touches a DOM.
 */
import { describe, expect, it } from "vitest";

import {
	buildBrowseCards,
	buildBrowseCategories,
	buildBrowseFooter,
	comboSubtitle,
	defaultTranslate,
	filterBrowseCards,
	formatCount,
	type BrowseCatalogItem,
} from "../src/posapp/components/pos/mobile/browse/browseCatalog";
import { resolveCompatibilityScope } from "../src/posapp/components/pos/mobile/browse/browseCompatibility";
import { COMBOS_CATEGORY_ID } from "../src/posapp/composables/pos/combos/comboCatalog";
import type { ComboOffer } from "../src/posapp/composables/pos/combos/comboCatalog";

const HONOR_X8A = "IPN-HONOR-X8A";

/** See `movilExplorarCompatibility.spec.ts` for why this cast exists. */
const component = (
	item_code: string,
	item_name: string,
	rate: number,
	actual_qty: number,
	is_stock_item = 1,
) => ({ item_code, item_name, qty: 1, rate, actual_qty, is_stock_item }) as ComboOffer["components"][number];

const comboX8A: ComboOffer = {
	item_code: "COMBO-X8A",
	item_name: "Combo Protección Honor X8A",
	rate: 289,
	targets: [HONOR_X8A],
	components: [
		component("IPN002611", "Case", 200, 8),
		component("IPN003290", "Mica", 149, 31),
		component("SRV-INST", "Instalación", 0, 0, 0),
	],
};

const item = (over: Partial<BrowseCatalogItem> & { item_code: string }): BrowseCatalogItem => ({
	item_name: over.item_code,
	item_group: "Fundas",
	rate: 200,
	is_stock_item: 1,
	actual_qty: 8,
	...over,
});

const ITEMS: BrowseCatalogItem[] = [
	item({ item_code: "IPN002611", item_name: "Anillo Case Honor X8A Rojo", actual_qty: 8 }),
	item({ item_code: "IPN002587", item_name: "Anillo Case Honor 70 Gris", actual_qty: 2 }),
	item({
		item_code: "IPN003290",
		item_name: "Mica 9D Honor X8A",
		item_group: "Micas",
		rate: 149,
		actual_qty: 31,
	}),
	item({ item_code: "SRV-INST", item_name: "Instalación", item_group: "Servicios", is_stock_item: 0 }),
];

const cardsFor = (over: Parameters<typeof buildBrowseCards>[0] = {}) =>
	buildBrowseCards({ items: ITEMS, combos: [comboX8A], lowStockThreshold: 3, ...over });

const byCode = (code: string, over?: Parameters<typeof buildBrowseCards>[0]) =>
	cardsFor(over).find((card) => card.item_code === code);

describe("what a card draws about stock", () => {
	it("renders the figure the register enforces against", () => {
		expect(byCode("IPN002611")?.chip).toEqual({ kind: "stock", value: 8, low: false });
	});

	it("draws NOTHING when the register has no figure — never a 0", () => {
		// `Instalación` has no shelf to be counted on. A `0` here would tell the
		// cashier the shop cannot install, and they would repeat it.
		expect(byCode("SRV-INST")?.chip).toBeNull();
	});

	it("a TEMPLATE draws the variants chip, never its aggregate stock", () => {
		// The tap on a template opens the picker, not the cart — the chip is
		// the affordance saying so, and the template's own stock figure (a sum
		// over its variants) would mislead beside it.
		const card = byCode("TPL-MICA", {
			items: [
				...ITEMS,
				{ item_code: "TPL-MICA", item_name: "Mica templada", has_variants: 1, actual_qty: 30 },
			],
		});
		expect(card?.chip).toEqual({ kind: "variants" });
	});

	it("draws nothing when the payload carries no quantity at all", () => {
		const unknown = byCode("IPN002611", {
			items: [item({ item_code: "IPN002611", actual_qty: undefined })],
			combos: [],
			lowStockThreshold: 3,
		});

		expect(unknown?.chip).toBeNull();
	});

	it("tints low against the register's own threshold", () => {
		expect(byCode("IPN002587")?.chip).toEqual({ kind: "stock", value: 2, low: true });
	});

	it("stops tinting when the register sets a tighter threshold", () => {
		const relaxed = byCode("IPN002587", { items: ITEMS, combos: [], lowStockThreshold: 1 });

		expect(relaxed?.chip).toEqual({ kind: "stock", value: 2, low: false });
	});

	it("draws an empty shelf low even where the shop never warns", () => {
		// A threshold of 0 means "never warn about a thin shelf". It does not
		// mean an empty one should read green.
		const empty = byCode("IPN002611", {
			items: [item({ item_code: "IPN002611", actual_qty: 0 })],
			combos: [],
			lowStockThreshold: 0,
		});

		expect(empty?.chip).toEqual({ kind: "stock", value: 0, low: true });
	});

	it("prefers the base quantity over the line's own on a multi-UOM row", () => {
		// The same preference `describeLineStock` makes, for the same reason:
		// the number shown and the number the stock gate enforces must be one.
		const boxed = byCode("IPN002611", {
			items: [
				item({ item_code: "IPN002611", _base_actual_qty: 24, conversion_factor: 12, actual_qty: 24 }),
			],
			combos: [],
			lowStockThreshold: 3,
		});

		expect(boxed?.chip).toEqual({ kind: "stock", value: 2, low: true });
	});
});

describe("what a combo card draws", () => {
	it("names its parts, in table order", () => {
		expect(byCode("COMBO-X8A")?.subtitle).toBe("Case + Mica + Instalación");
		expect(comboSubtitle({ ...comboX8A, components: [] })).toBe("");
	});

	it("shows the saving rather than a stock count", () => {
		// 200 + 149 + 0 = 349 list, sold at 289.
		expect(byCode("COMBO-X8A")?.chip).toEqual({ kind: "saving", amount: 60 });
	});

	it("shows no chip at all when the bundle is not actually cheaper", () => {
		const convenience = byCode("COMBO-X8A", {
			items: [],
			combos: [{ ...comboX8A, rate: 349 }],
			lowStockThreshold: 3,
		});

		expect(convenience?.chip).toBeNull();
	});

	it("drops a combo the shelves cannot cover even once", () => {
		// Tapping it is a dead end, and the footer promises a tap adds the card.
		const outOfStock = cardsFor({
			items: [],
			combos: [{ ...comboX8A, components: [component("IPN002611", "Case", 200, 0)] }],
		});

		expect(outOfStock).toEqual([]);
	});

	it("keeps an all-labour combo, whose ceiling is time rather than shelves", () => {
		const labour = cardsFor({
			items: [],
			combos: [{ ...comboX8A, components: [component("SRV-INST", "Instalación", 250, 0, 0)] }],
		});

		expect(labour).toHaveLength(1);
		expect(labour[0]?.chip).toBeNull();
	});

	it("leads the grid, ahead of the loose accessories", () => {
		expect(cardsFor()[0]?.kind).toBe("combo");
	});
});

describe("an out-of-stock ITEM is kept, unlike an out-of-stock combo", () => {
	it("still renders, with its zero", () => {
		// The up-sell strip drops these because it binds Enter to its first
		// tile. This is the catalogue: a cashier hunting a case has to learn
		// the shop has none, not conclude it never carried one.
		const none = cardsFor({
			items: [item({ item_code: "IPN002611", actual_qty: 0 })],
			combos: [],
		});

		expect(none).toHaveLength(1);
		expect(none[0]?.chip).toEqual({ kind: "stock", value: 0, low: true });
	});
});

describe("category chips carry real counts", () => {
	it("counts what each chip will actually open onto", () => {
		const categories = buildBrowseCategories(cardsFor());

		expect(categories).toEqual([
			{ id: COMBOS_CATEGORY_ID, label: "Combos", count: 1, featured: true },
			{ id: "Fundas", label: "Fundas", count: 2, featured: false },
			{ id: "Micas", label: "Micas", count: 1, featured: false },
			{ id: "Servicios", label: "Servicios", count: 1, featured: false },
		]);
	});

	it("counts over the SCOPE, so a chip cannot promise cards it will not show", () => {
		const scope = resolveCompatibilityScope({ combos: [comboX8A], cart: [HONOR_X8A] });
		const scoped = filterBrowseCards(cardsFor({ scope }), { compatibleOnly: true, scope });

		expect(buildBrowseCategories(scoped)).toEqual([
			{ id: COMBOS_CATEGORY_ID, label: "Combos", count: 1, featured: true },
			{ id: "Fundas", label: "Fundas", count: 1, featured: false },
			{ id: "Micas", label: "Micas", count: 1, featured: false },
			{ id: "Servicios", label: "Servicios", count: 1, featured: false },
		]);
	});

	it("offers no Combos chip when the register sells none", () => {
		const categories = buildBrowseCategories(cardsFor({ combos: [] }));

		expect(categories.some((c) => c.id === COMBOS_CATEGORY_ID)).toBe(false);
	});

	it("gives an ungrouped item no chip, rather than inventing a bucket for it", () => {
		const categories = buildBrowseCategories(
			cardsFor({ items: [item({ item_code: "X", item_group: "" })], combos: [] }),
		);

		expect(categories).toEqual([]);
	});

	it("leaves the merchant's own group names untranslated", () => {
		// `Fundas` is a row in their Item Group tree, not a UI string.
		const shout = (text: string) => text.toUpperCase();
		const categories = buildBrowseCategories(cardsFor(), shout);

		expect(categories.map((c) => c.label)).toEqual(["COMBOS", "Fundas", "Micas", "Servicios"]);
	});

	it("ranks the busiest group first and breaks ties by name", () => {
		const categories = buildBrowseCategories(cardsFor({ combos: [] }));

		expect(categories.map((c) => c.id)).toEqual(["Fundas", "Micas", "Servicios"]);
	});
});

describe("the chips compose", () => {
	const scope = resolveCompatibilityScope({ combos: [comboX8A], cart: [HONOR_X8A] });
	const all = cardsFor({ scope });

	it("narrows to the compatible set", () => {
		expect(
			filterBrowseCards(all, { compatibleOnly: true, scope }).map((c) => c.item_code),
		).toEqual(["COMBO-X8A", "IPN002611", "IPN003290", "SRV-INST"]);
	});

	it("narrows further by category", () => {
		expect(
			filterBrowseCards(all, { compatibleOnly: true, scope, categoryId: "Fundas" }).map(
				(c) => c.item_code,
			),
		).toEqual(["IPN002611"]);
	});

	it("ignores the compatible flag when the scope cannot back it", () => {
		// Not "shows everything under the chip" — the screen never draws the
		// chip in this state. This asserts the filter degrades to the full
		// catalogue only when nobody is claiming anything about it.
		const unsupported = resolveCompatibilityScope({ combos: [], cart: [] });

		expect(filterBrowseCards(all, { compatibleOnly: true, scope: unsupported })).toHaveLength(
			all.length,
		);
	});

	it("marks each card with what the scope says", () => {
		expect(all.find((c) => c.item_code === "IPN002611")?.compatible).toBe(true);
		expect(all.find((c) => c.item_code === "IPN002587")?.compatible).toBe(false);
	});
});

describe("the footer", () => {
	const scope = resolveCompatibilityScope({
		combos: [comboX8A],
		cart: [HONOR_X8A],
		deviceNames: { [HONOR_X8A]: "Honor X8A" },
	});

	it("names the device only while it is actually filtering by it", () => {
		expect(
			buildBrowseFooter({ shownCount: 18, totalCount: 128, scope, compatibleOnly: true }).countLine,
		).toBe("18 compatible with Honor X8A");
	});

	it("makes no claim when the filter is off", () => {
		expect(
			buildBrowseFooter({ shownCount: 128, totalCount: 128, scope, compatibleOnly: false })
				.countLine,
		).toBe("128 items");
	});

	it("makes no claim when the scope cannot back one, whatever the flag says", () => {
		const unsupported = resolveCompatibilityScope({ combos: [], cart: [] });

		expect(
			buildBrowseFooter({ shownCount: 128, totalCount: 128, scope: unsupported, compatibleOnly: true })
				.countLine,
		).toBe("128 items");
	});

	it("offers a way out only while something is hidden", () => {
		expect(buildBrowseFooter({ shownCount: 18, totalCount: 128 }).seeAllLabel).toBe("See all 128");
		expect(buildBrowseFooter({ shownCount: 128, totalCount: 128 }).seeAllLabel).toBeNull();
	});

	it("groups thousands the way the artboard does", () => {
		expect(formatCount(1482)).toBe("1,482");
	});

	it("substitutes placeholders even with no translator present", () => {
		// A default that dropped `{0}` would print braces at a customer.
		expect(defaultTranslate("{0} of {1}", [3, 9])).toBe("3 of 9");
	});
});
