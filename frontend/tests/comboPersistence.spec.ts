/**
 * The combo annotation must survive a draft (roadmap §17.6,
 * docs/POS-RIEL-Y-CAJON-BUILD.md).
 *
 * W25-B attaches a real ARRAY to the cart line; the doctype stores a Small
 * Text JSON string, following `posa_offers`. Both are right, so the save and
 * load paths translate — and the translation is only correct as a PAIR, which
 * is why these tests round-trip rather than checking either half alone.
 *
 * The failure being guarded is silent and it lands on the oldest data first:
 * every draft saved before this field existed loads with it absent, and a
 * parse that throws there would break resume for drafts that have nothing to
 * do with combos.
 */
import { describe, expect, it } from "vitest";

import {
	comboFieldsForPayload,
	hydrateComboFields,
	hydrateComboFieldsForItems,
} from "../src/posapp/components/pos/invoice_utils/comboPersistence";
import {
	COMBO_BROKEN_FIELD,
	COMBO_COMPONENTS_FIELD,
} from "../src/posapp/composables/pos/items/comboLineAttachment";

/**
 * `ItemsTable.vue`'s predicate, restated. Restated rather than imported
 * because it lives inside a `.vue` `<script setup>` and is not exported — and
 * because the whole point of these tests is that persistence must satisfy the
 * READER, not merely preserve bytes. A copy that drifts from the original is
 * caught by `comboFieldNames.spec` territory, not here.
 */
const isComboLine = (item: any): boolean =>
	Array.isArray(item?.[COMBO_COMPONENTS_FIELD]) &&
	item[COMBO_COMPONENTS_FIELD].length > 0 &&
	!item?.[COMBO_BROKEN_FIELD];

/** A line as the cart holds it right after `attachComboComponents`. */
const cartComboLine = () => ({
	item_code: "COMBO-CASE-MICA",
	item_name: "Case + Mica + Instalación",
	rate: 299,
	[COMBO_COMPONENTS_FIELD]: [
		{ item_code: "IPN001758", item_name: "Anillo Case", qty: 1, rate: 200, uom: "Nos", actual_qty: 8 },
		{ item_code: "MICA-001", item_name: "Mica", qty: 1, rate: 80, uom: "Nos", actual_qty: 12 },
		{ item_code: "INSTALL-01", item_name: "Instalación", qty: 1, rate: 60, uom: "Nos", actual_qty: 0 },
	],
	[COMBO_BROKEN_FIELD]: 0,
});

/** Save then load, the way `document.ts` and `loader.ts` actually do it. */
const roundTrip = (line: any) => {
	const stored = { ...line, ...comboFieldsForPayload(line) };
	// What comes back from the server is the stored shape, nothing more.
	const loaded: any = {
		item_code: stored.item_code,
		item_name: stored.item_name,
		rate: stored.rate,
		[COMBO_COMPONENTS_FIELD]: stored[COMBO_COMPONENTS_FIELD],
		[COMBO_BROKEN_FIELD]: stored[COMBO_BROKEN_FIELD],
	};
	hydrateComboFields(loaded);
	return { stored, loaded };
};

describe("a combo line survives save and resume", () => {
	it("is stored as a JSON string, not an array", () => {
		const { stored } = roundTrip(cartComboLine());
		expect(typeof stored[COMBO_COMPONENTS_FIELD]).toBe("string");
		expect(JSON.parse(stored[COMBO_COMPONENTS_FIELD] as string)).toHaveLength(3);
	});

	it("comes back as an array the reader accepts", () => {
		const { loaded } = roundTrip(cartComboLine());
		expect(Array.isArray(loaded[COMBO_COMPONENTS_FIELD])).toBe(true);
		expect(isComboLine(loaded)).toBe(true);
	});

	it("keeps every component, with numbers still numbers", () => {
		const { loaded } = roundTrip(cartComboLine());
		const components = loaded[COMBO_COMPONENTS_FIELD];
		expect(components.map((c: any) => c.item_code)).toEqual([
			"IPN001758",
			"MICA-001",
			"INSTALL-01",
		]);
		// A stored qty survives JSON as whatever type it was written as, and
		// priceCombo() would concatenate strings instead of adding numbers —
		// a wrong saving on a ticket is worse than no badge.
		for (const c of components) {
			expect(typeof c.qty).toBe("number");
			expect(typeof c.rate).toBe("number");
		}
		expect(components.reduce((sum: number, c: any) => sum + c.rate * c.qty, 0)).toBe(340);
	});

	it("round-trips the broken flag", () => {
		const broken = { ...cartComboLine(), [COMBO_BROKEN_FIELD]: 1 };
		const { stored, loaded } = roundTrip(broken);
		expect(stored[COMBO_BROKEN_FIELD]).toBe(1);
		expect(loaded[COMBO_BROKEN_FIELD]).toBe(1);
		// Still carries its components, but a partially-returned combo must
		// stop rendering as a whole one (T6).
		expect(loaded[COMBO_COMPONENTS_FIELD]).toHaveLength(3);
		expect(isComboLine(loaded)).toBe(false);
	});

	it("survives a second save without re-passing through the add path", () => {
		// A resumed draft is saved again; `get_invoice_items` then sees the
		// hydrated array. Re-serialising must not double-encode it.
		const { loaded } = roundTrip(cartComboLine());
		const restored = comboFieldsForPayload(loaded);
		expect(typeof restored[COMBO_COMPONENTS_FIELD]).toBe("string");
		expect(JSON.parse(restored[COMBO_COMPONENTS_FIELD] as string)).toHaveLength(3);
	});
});

describe("everything that is not a combo stays that way", () => {
	it("a plain line is marked as no combo rather than left stale", () => {
		const plain = { item_code: "IPN000774", rate: 70 };
		const fields = comboFieldsForPayload(plain);
		expect(fields[COMBO_COMPONENTS_FIELD]).toBeNull();
		expect(fields[COMBO_BROKEN_FIELD]).toBe(0);
	});

	it("a line that STOPPED being a combo clears the stored value", () => {
		// Omitting the key would leave the old string in place and the ticket
		// would keep claiming a combo the customer is no longer buying.
		const wasCombo = { ...cartComboLine(), [COMBO_COMPONENTS_FIELD]: [] };
		expect(comboFieldsForPayload(wasCombo)[COMBO_COMPONENTS_FIELD]).toBeNull();
	});

	it.each([
		["absent", undefined],
		["null", null],
		["empty string", ""],
		["malformed JSON", "{not json"],
		["a JSON object rather than an array", '{"item_code":"X"}'],
		["a JSON array of junk", '[{"item_code":"   "}]'],
		["a number", 42],
	])("loads a %s value as a plain line without throwing", (_label, value) => {
		const item: any = { item_code: "IPN000774", [COMBO_COMPONENTS_FIELD]: value };
		expect(() => hydrateComboFields(item)).not.toThrow();
		expect(isComboLine(item)).toBe(false);
	});

	it("leaves a pre-existing draft — the field never set — untouched", () => {
		// This is every draft on every tenant today.
		const legacy: any = { item_code: "IPN000774", qty: 2, rate: 70 };
		hydrateComboFields(legacy);
		expect(isComboLine(legacy)).toBe(false);
		expect(legacy.item_code).toBe("IPN000774");
		expect(legacy.qty).toBe(2);
	});

	it("hydrates a mixed list and tolerates a non-array", () => {
		const items = [cartComboLine(), { item_code: "IPN000774" }];
		hydrateComboFieldsForItems(items);
		expect(isComboLine(items[0])).toBe(true);
		expect(isComboLine(items[1])).toBe(false);
		expect(() => hydrateComboFieldsForItems(undefined)).not.toThrow();
		expect(() => hydrateComboFieldsForItems(null)).not.toThrow();
	});
});
