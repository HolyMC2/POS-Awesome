/**
 * Targeting a combo by the shop's ENTRY ATTRIBUTE instead of by item code.
 *
 * The values here are docomexico's real ones, read from `doco-mirror` on
 * 2026-08-24: `Storefront Profile "docomexico"` names «Modelos Celulares»,
 * 4 311 sellable variants carry a value for it, and the cases and micas are
 * spelled exactly «Case Colors Samsung A01 Rojo» / «Samsung A01». Item CODES
 * on that catalogue are opaque (`IPN000130`), which is the whole argument for
 * this feature: a merchant cannot target 3 526 cases by code, and the codes
 * tell them nothing about which phone they fit.
 *
 * The rules under test, in the order `eligibilityFor` applies them: already in
 * the cart wins; no targeting of either kind is universal; otherwise code OR
 * attribute, with neither outranking the other.
 */

import { describe, expect, it } from "vitest";

import {
	buildCombosCategory,
	buildSuggestions,
	combosForCart,
	type ComboOffer,
} from "../src/posapp/composables/pos/combos/comboCatalog";
import { normalizeComboOffer } from "../src/posapp/composables/pos/combos/useComboOffers";

const ATTRIBUTE = "Modelos Celulares";

/** A cart line as the register builds it from the catalogue row. */
const line = (item_code: string, entry_attribute_value?: string) => ({
	item_code,
	...(entry_attribute_value ? { entry_attribute_value } : {}),
});

const A01_CASE = line("IPN000130", "Samsung A01");
const A01_HOLSTER = line("IPN000102", "Samsung A01");
const A10_CASE = line("IPN000137", "Samsung A10");
const UNTAGGED = line("IPN000069");

const A01_COMBO: ComboOffer = {
	item_code: "COMBO-A01",
	item_name: "Combo Protección Samsung A01",
	rate: 299,
	priority: 10,
	targets: [],
	target_attribute: ATTRIBUTE,
	target_attribute_values: ["Samsung A01", "Samsung A01 Core"],
	components: [
		{ item_code: "MICA-A01", item_name: "Mica", qty: 1, rate: 120, actual_qty: 40, is_stock_item: 1 },
		{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 50, actual_qty: 0, is_stock_item: 0 },
	],
};

const A10_COMBO: ComboOffer = {
	item_code: "COMBO-A10",
	item_name: "Combo Protección Samsung A10",
	rate: 289,
	priority: 10,
	targets: [],
	target_attribute: ATTRIBUTE,
	target_attribute_values: ["Samsung A10"],
	components: [
		{ item_code: "MICA-A10", item_name: "Mica", qty: 1, rate: 110, actual_qty: 30, is_stock_item: 1 },
	],
};

const UNIVERSAL_COMBO: ComboOffer = {
	item_code: "COMBO-CARGA",
	item_name: "Combo Carga Rápida",
	rate: 329,
	priority: 20,
	components: [
		{ item_code: "CABLE", item_name: "Cable", qty: 1, rate: 110, actual_qty: 60, is_stock_item: 1 },
	],
};

/** Both legs on one combo: a named handset AND a model. */
const BOTH_LEGS_COMBO: ComboOffer = {
	...A01_COMBO,
	item_code: "COMBO-BOTH",
	targets: ["Samsung Galaxy A15"],
};

const codes = (offers: readonly { item_code: string }[]) => offers.map((o) => o.item_code);

describe("matching a combo by the device the cart is for", () => {
	it("offers the A01 combo for an A01 case and not the A10 one", () => {
		expect(codes(combosForCart([A01_COMBO, A10_COMBO], [A01_CASE]))).toEqual(["COMBO-A01"]);
	});

	it("offers the A10 combo for an A10 case", () => {
		expect(codes(combosForCart([A01_COMBO, A10_COMBO], [A10_CASE]))).toEqual(["COMBO-A10"]);
	});

	it("matches any of several declared values", () => {
		const core = [line("IPN000135", "Samsung A01 Core")];
		expect(codes(combosForCart([A01_COMBO], core))).toEqual(["COMBO-A01"]);
	});

	it("takes the match from ANY line, not only the first", () => {
		const cart = [UNTAGGED, line("SERVICIO"), A01_CASE];
		expect(codes(combosForCart([A01_COMBO], cart))).toEqual(["COMBO-A01"]);
	});

	it("counts two lines for the same device once, not twice", () => {
		const tiles = buildSuggestions({
			combos: [A01_COMBO],
			cart: [A01_CASE, A01_HOLSTER],
		});
		expect(tiles.map((t) => t.item_code)).toEqual(["COMBO-A01"]);
	});
});

describe("what does NOT match", () => {
	it("an untagged line — not knowing the device is not a wildcard", () => {
		expect(combosForCart([A01_COMBO], [UNTAGGED])).toEqual([]);
	});

	it("a cart of bare item codes, which carry no device at all", () => {
		expect(combosForCart([A01_COMBO], ["IPN000130"])).toEqual([]);
	});

	it("a blank value on the line, which is an absent fact spelled differently", () => {
		expect(combosForCart([A01_COMBO], [line("IPN000130", "   ")])).toEqual([]);
	});

	it("the wrong device, even when the value merely looks similar", () => {
		expect(combosForCart([A01_COMBO], [line("X", "Samsung A0")])).toEqual([]);
	});

	it("values with no attribute behind them — a payload outliving its config", () => {
		// The offline cache can serve a combo captured while a storefront was
		// configured. Matching its values against a cart whose lines carry none
		// would be answering a question this register is no longer asking.
		const stale: ComboOffer = { ...A01_COMBO, target_attribute: null };
		expect(combosForCart([stale], [A01_CASE])).toEqual([]);
	});
});

describe("the two legs together", () => {
	it("keeps item targeting working untouched", () => {
		expect(codes(combosForCart([BOTH_LEGS_COMBO], [line("Samsung Galaxy A15")]))).toEqual([
			"COMBO-BOTH",
		]);
	});

	it("matches the same combo by model when the handset is not on the ticket", () => {
		expect(codes(combosForCart([BOTH_LEGS_COMBO], [A01_CASE]))).toEqual(["COMBO-BOTH"]);
	});

	it("labels an attribute match as targeted, so it outranks a universal tile", () => {
		const tiles = buildSuggestions({
			combos: [UNIVERSAL_COMBO, A01_COMBO],
			cart: [A01_CASE],
		});
		expect(tiles.map((t) => t.item_code)).toEqual(["COMBO-A01", "COMBO-CARGA"]);
		expect(tiles[0].reason).toBe("targets-cart-item");
		expect(tiles[1].reason).toBe("universal");
	});

	it("still never suggests a combo already on the ticket", () => {
		const cart = [A01_CASE, line("COMBO-A01", "Samsung A01")];
		expect(combosForCart([A01_COMBO], cart)).toEqual([]);
	});
});

describe("a combo that declares attribute values is not universal", () => {
	it("stays silent on a ticket it does not fit", () => {
		// The failure that matters. If `target_attribute_values` did not count
		// as targeting, a device-specific combo would fall through to
		// "universal" and be offered on every ticket in the shop.
		expect(combosForCart([A01_COMBO], [A10_CASE])).toEqual([]);
	});

	it("stays silent on an empty ticket", () => {
		expect(combosForCart([A01_COMBO], [])).toEqual([]);
	});

	it("while a combo with neither kind of target is offered on both", () => {
		expect(codes(combosForCart([UNIVERSAL_COMBO], []))).toEqual(["COMBO-CARGA"]);
		expect(codes(combosForCart([UNIVERSAL_COMBO], [A10_CASE]))).toEqual(["COMBO-CARGA"]);
	});
});

describe("absence — a tenant with no storefront", () => {
	const NO_ATTRIBUTE: ComboOffer = {
		...A01_COMBO,
		target_attribute: null,
		target_attribute_values: [],
		targets: ["Samsung Galaxy A15"],
	};

	it("behaves exactly as before: item targets decide", () => {
		expect(codes(combosForCart([NO_ATTRIBUTE], [line("Samsung Galaxy A15")]))).toEqual([
			"COMBO-A01",
		]);
		expect(combosForCart([NO_ATTRIBUTE], [A01_CASE])).toEqual([]);
	});

	it("and a payload predating the fields is universal when it targets nothing", () => {
		const legacy = { item_code: "OLD", item_name: "Old", rate: 10, components: [] };
		expect(codes(combosForCart([legacy as ComboOffer], [A01_CASE]))).toEqual(["OLD"]);
	});
});

describe("the drawer's Combos chip follows the same rule", () => {
	it("narrows to the combos that fit the device on the ticket", () => {
		const category = buildCombosCategory(
			[A01_COMBO, A10_COMBO, UNIVERSAL_COMBO],
			undefined,
			[A01_CASE],
		);
		expect(category).toMatchObject({ count: 2 }); // A01 + the universal one
	});

	it("shows the whole shelf when the ticket is empty", () => {
		const category = buildCombosCategory([A01_COMBO, A10_COMBO, UNIVERSAL_COMBO], undefined, []);
		expect(category).toMatchObject({ count: 3 });
	});
});

describe("the wire, through the normaliser the register actually uses", () => {
	it("carries both halves of the attribute leg off the read model", () => {
		const offer = normalizeComboOffer({
			item_code: "COMBO-A01",
			item_name: "Combo Protección Samsung A01",
			rate: "299.00",
			priority: "10",
			targets: [],
			target_attribute: ATTRIBUTE,
			target_attribute_values: ["Samsung A01", "Samsung A01 Core"],
			components: [],
		});
		expect(offer.target_attribute).toBe(ATTRIBUTE);
		expect(offer.target_attribute_values).toEqual(["Samsung A01", "Samsung A01 Core"]);
	});

	it("normalises an unconfigured shop to null and an empty list", () => {
		const offer = normalizeComboOffer({
			item_code: "C",
			target_attribute: null,
			target_attribute_values: [],
		});
		expect(offer.target_attribute).toBeNull();
		expect(offer.target_attribute_values).toEqual([]);
	});

	it("survives a payload that predates the fields", () => {
		const offer = normalizeComboOffer({ item_code: "C", targets: ["X"] });
		expect(offer.target_attribute).toBeNull();
		expect(offer.target_attribute_values).toEqual([]);
		expect(offer.targets).toEqual(["X"]);
	});

	it("drops a blank value rather than letting it match an untagged line", () => {
		const offer = normalizeComboOffer({
			item_code: "C",
			target_attribute: ATTRIBUTE,
			target_attribute_values: ["Samsung A01", "", null],
		});
		expect(offer.target_attribute_values).toEqual(["Samsung A01"]);
	});
});
