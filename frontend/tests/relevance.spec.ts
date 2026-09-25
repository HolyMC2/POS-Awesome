import { describe, expect, it } from "vitest";

import { queryTerms, rank, words } from "../src/posapp/utils/relevance";
import { itemRankFields, rankItems } from "../src/posapp/utils/itemRelevance";
import { useItemSearch } from "../src/posapp/composables/pos/items/useItemSearch";

// Real catalogue names from the doco mirror. The same cases live in
// posawesome/posawesome/api/test_item_search_relevance.py, doco's
// test_search.py and taller's utils/search.spec.ts; change them together.
const ITEMS: [string, string, string][] = [
	["MOD00131", "Pantalla iPhone XS INCELL", "Pantallas y Displays"],
	["MOD00135", "Pantalla iPhone 11 INCELL", "Pantallas y Displays"],
	["MOD00139", "Pantalla iPhone 12 INCELL", "Pantallas y Displays"],
	["MOD00154", "Pantalla iPhone 13 PRO MAX INCELL", "Pantallas y Displays"],
	["MOD00148", "Pantalla iPhone 13 INCELL", "Pantallas y Displays"],
	["IPN003214", "Bateria para iPhone 13", "Baterías"],
	["IPN003216", "Bateria para iPhone 13 Pro Max", "Baterías"],
	["IPN003215", "Bateria para iPhone 13 Pro", "Baterías"],
	["IPN000180", "Anillo Case Samsung A13 5G Azul", "Fundas y Carcasas"],
	["IPN002697", "Anillo Case Redmi 13C Gris", "Fundas y Carcasas"],
	["IPN004713", "Camara Trasera para IPhone XS MAX", "Refacciones"],
	["IPN000017", "Cable C a C IP 1m OEM", "Cargadores y Cables"],
	["IPN001339", "Adaptador para cargador Europeo", "Cargadores y Cables"],
	["IPN004720", "Flex de Carga para Equipo 13", "Refacciones"],
];

const ranked = (query: string) =>
	rank(ITEMS, query, ([code, name, group]) => ({
		name,
		others: [group],
		codes: [code],
	})).map((r) => r[1]);

describe("words", () => {
	it("splits glued model numbers and suffixes", () => {
		expect(words("iPhone13ProMax")).toEqual(["iphone", "13", "pro", "max"]);
		expect(words("Redmi Note 13Pro+")).toEqual([
			"redmi",
			"note",
			"13",
			"pro",
		]);
	});
	it("keeps short model codes whole", () => {
		expect(words("Samsung A13 5G / G13")).toEqual([
			"samsung",
			"a13",
			"5g",
			"g13",
		]);
	});
	it("folds accents", () => {
		expect(words("Batería Cámara")).toEqual(["bateria", "camara"]);
	});
});

describe("queryTerms", () => {
	it("joins a lone letter to the following number", () => {
		expect(queryTerms("sam a 13")).toEqual([["sam"], ["a13"]]);
	});
	it("lists stems and aliases as alternatives", () => {
		expect(queryTerms("fundas sm")).toEqual([
			["fundas", "funda"],
			["sm", "samsung"],
		]);
	});
});

describe("rank", () => {
	it("never matches a model number inside codes or other words", () => {
		// The technician's report: «ip 13» listed XS/11/12 screens through MOD0013x
		// codes, «Samsung A13» and «Redmi 13C» through substrings.
		expect(ranked("ip 13")).toEqual([
			"Pantalla iPhone 13 INCELL",
			"Bateria para iPhone 13",
			"Bateria para iPhone 13 Pro",
			// Equal scores keep the caller's order.
			"Pantalla iPhone 13 PRO MAX INCELL",
			"Bateria para iPhone 13 Pro Max",
		]);
	});
	it("ranks the exact model before longer variants", () => {
		expect(ranked("bateria iphone 13")).toEqual([
			"Bateria para iPhone 13",
			"Bateria para iPhone 13 Pro",
			"Bateria para iPhone 13 Pro Max",
		]);
	});
	it("matches a generic word through the group field", () => {
		expect(ranked("funda a13")).toEqual([
			"Anillo Case Samsung A13 5G Azul",
		]);
	});
	it("finds an item by code fragment", () => {
		expect(ranked("4713")).toEqual(["Camara Trasera para IPhone XS MAX"]);
		expect(ranked("MOD00148")).toEqual(["Pantalla iPhone 13 INCELL"]);
	});
	it("needs a word start for short words", () => {
		expect(ranked("ip 13")).not.toContain("Flex de Carga para Equipo 13");
		expect(ranked("ip")).not.toContain("Adaptador para cargador Europeo");
	});
	it("uses loose matches only when nothing is strict", () => {
		expect(ranked("iphone 1")).toContain("Pantalla iPhone 11 INCELL");
		expect(ranked("cable 1")).toEqual(["Cable C a C IP 1m OEM"]);
	});
	it("keeps the caller order for ties", () => {
		const rows = [
			["B", "Case iPhone 13 Azul"],
			["A", "Case iPhone 13 Rojo"],
		];
		expect(
			rank(rows, "iphone 13", ([code, name]) => ({
				name,
				codes: [code],
			})).map((r) => r[0]),
		).toEqual(["B", "A"]);
	});
	it("returns rows unchanged for an empty query", () => {
		expect(rank(ITEMS, "  ", ([, name]) => ({ name }))).toEqual(ITEMS);
	});
});

describe("register item ranking", () => {
	const items = ITEMS.map(([item_code, item_name, item_group]) => ({
		item_code,
		item_name,
		item_group,
		rate: 100,
	}));

	it("reads name, group, brand, description and every code surface", () => {
		const fields = itemRankFields({
			item_code: "IPN1",
			item_name: "Cable",
			item_group: "Cables",
			brand: "Moreka",
			description: "<p>Cable</p>",
			barcode: "750100",
			item_barcode: [{ barcode: "750200" }],
			barcodes: ["750300"],
			serial_no_data: [{ serial_no: "SN1" }],
			batch_no_data: [{ batch_no: "B1" }],
		});
		expect(fields.name).toBe("Cable");
		expect(fields.others).toEqual(["Cables", "Moreka", "<p>Cable</p>"]);
		expect(fields.codes).toEqual([
			"IPN1",
			"750100",
			"750200",
			"750300",
			"SN1",
			"B1",
		]);
	});

	it("finds an item by the tail of a barcode", () => {
		const rows = [
			{
				item_code: "IPN004037",
				item_name: "Audifonos",
				item_barcode: [{ barcode: "8605541888067" }],
			},
		];
		expect(rankItems(rows, "88067").map((r) => r.item_code)).toEqual([
			"IPN004037",
		]);
	});

	it("is what the register displays: best match first, limit after ranking", () => {
		const { filterAndPaginate } = useItemSearch();
		const shown = filterAndPaginate(items as never, {
			searchTerm: "ip 13",
			limit: 2,
		}).map((i: { item_name: string }) => i.item_name);
		expect(shown).toEqual([
			"Pantalla iPhone 13 INCELL",
			"Bateria para iPhone 13",
		]);
	});

	it("keeps the unfiltered fast path for short terms", () => {
		const { filterAndPaginate } = useItemSearch();
		expect(
			filterAndPaginate(items as never, { searchTerm: "ip", limit: 3 }),
		).toHaveLength(3);
	});

	it("never hands out a cached words array that a caller could corrupt", () => {
		const first = words("Pantalla iPhone 13");
		expect(words("Pantalla iPhone 13")).toBe(first);
		expect(first).toEqual(["pantalla", "iphone", "13"]);
	});
});
