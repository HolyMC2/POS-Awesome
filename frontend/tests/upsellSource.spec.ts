/**
 * Where the "se suele llevar junto" strip's tiles actually come from
 * (`docs/POS-RIEL-Y-CAJON-BUILD.md` §11 item D).
 *
 * The strip and its ranking shipped in wave 1 against a list nothing filled:
 * `Pos.vue` held `const comboOffers = ref([])` with a comment saying the read
 * model had not landed. It had — `posawesome/posawesome/api/combos.py`
 * exposes `get_combos` — and nobody called it, so the register rendered no
 * strip at all.
 *
 * These tests are about the SHAPE of that call as much as its result, because
 * the shape is the risk. The strip re-ranks on every cart change, and the sale
 * path is the hottest surface in the product (§6: scan-to-paint ≤ 50 ms p95).
 * A fetch that followed the cart instead of the register would put a round
 * trip on every scan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildSuggestions,
	type ComboOffer,
} from "../src/posapp/composables/pos/combos/comboCatalog";
import {
	clearComboOffersCache,
	normalizeComboOffer,
	useComboOffers,
} from "../src/posapp/composables/pos/combos/useComboOffers";

const PROFILE = { name: "Caja 2", selling_price_list: "Mostrador", warehouse: "Tienda - DM" };

/** One combo exactly as `get_combos` returns it, strings and all. */
const HONOR_COMBO_PAYLOAD = {
	item_code: "COMBO-X8A",
	item_name: "Combo Protección Honor X8A",
	rate: "289",
	image: "/files/combo.png",
	priority: "1",
	targets: ["IPN002611"],
	components: [
		{
			item_code: "IPN002611",
			item_name: "Case rojo",
			qty: "1",
			rate: "185",
			uom: "Nos",
			actual_qty: "9",
			is_stock_item: 1,
		},
		{
			item_code: "MICAX8A",
			item_name: "Mica",
			qty: "1",
			rate: "80",
			uom: "Nos",
			actual_qty: "40",
			is_stock_item: 1,
		},
		{
			item_code: "SRV-INST",
			item_name: "Instalación",
			qty: "1",
			rate: "60",
			uom: "Nos",
			actual_qty: "0",
			is_stock_item: 0,
		},
	],
};

const call = vi.fn();

beforeEach(() => {
	clearComboOffersCache();
	call.mockReset();
	(globalThis as any).frappe = { call };
});

afterEach(() => {
	delete (globalThis as any).frappe;
});

describe("the combo read model the register actually asks for", () => {
	it("asks combos.get_combos for the whole catalogue, not for one bundle", async () => {
		// `get_combo_components` answers the cart's narrow question about a line
		// it already holds. The strip's question is the opposite: what is on
		// offer that the ticket does NOT hold yet.
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		expect(call.mock.calls[0][0].method).toBe("posawesome.posawesome.api.combos.get_combos");
		expect(call.mock.calls[0][0].args).toMatchObject({ pos_profile: "Caja 2" });
		expect(call.mock.calls[0][0].args.bundles).toBeUndefined();
		expect(offers.value).toHaveLength(1);
	});

	it("numbers arrive as numbers, so a saving is not computed by string maths", async () => {
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		const combo = offers.value[0]!;
		expect(combo.rate).toBe(289);
		expect(combo.components[0]!.qty).toBe(1);
		expect(combo.components[0]!.rate).toBe(185);
		expect(combo.components[0]!.actual_qty).toBe(9);
	});

	it("keeps is_stock_item, so labour does not read as out of stock", async () => {
		// `Instalación` has actual_qty 0 forever. Coerced or dropped, it caps
		// every combo it belongs to at zero and the strip drops the tile.
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		const service = offers.value[0]!.components.find((c) => c.item_code === "SRV-INST")!;
		expect((service as any).is_stock_item).toBe(0);

		const suggestions = buildSuggestions({
			combos: offers.value,
			cart: ["IPN002611"],
		});
		expect(suggestions.map((s) => s.item_code)).toEqual(["COMBO-X8A"]);
		expect(suggestions[0]!.availability?.value).toBe(9);
	});

	it("normalises a payload with no components or targets at all", () => {
		// An overlay-less tenant gets every enabled bundle, and a bundle with no
		// POS Combo row carries no targets — the universal case, not an error.
		const offer = normalizeComboOffer({ item_code: "COMBO-Z", rate: 99 });
		expect(offer).toMatchObject({
			item_code: "COMBO-Z",
			item_name: "COMBO-Z",
			rate: 99,
			targets: [],
			components: [],
		});
	});
});

describe("one fetch per register, never one per cart change", () => {
	it("serves the second ask from cache", async () => {
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const first = useComboOffers();
		await first.load({ pos_profile: PROFILE });
		const second = useComboOffers();
		await second.load({ pos_profile: PROFILE });

		expect(call).toHaveBeenCalledTimes(1);
		expect(second.offers.value).toHaveLength(1);
	});

	it("deduplicates two surfaces that mount in the same tick", async () => {
		// The drawer wants the category chip and the strip wants the tiles, and
		// they ask together on register open — the worst possible moment for a
		// duplicate round trip.
		call.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ message: [HONOR_COMBO_PAYLOAD] }), 0)),
		);
		const drawer = useComboOffers();
		const strip = useComboOffers();
		await Promise.all([drawer.load({ pos_profile: PROFILE }), strip.load({ pos_profile: PROFILE })]);

		expect(call).toHaveBeenCalledTimes(1);
		expect(drawer.offers.value).toEqual(strip.offers.value);
	});

	it("re-ranks against a changing cart with NO further calls", async () => {
		// The whole argument for a catalogue-shaped fetch: five scans, one call.
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		for (const cart of [[], ["IPN002611"], ["IPN002611", "MICAX8A"], ["COMBO-X8A"]]) {
			buildSuggestions({ combos: offers.value, cart });
		}
		expect(call).toHaveBeenCalledTimes(1);
	});

	it("refetches for a different customer, whose price list changes the saving", async () => {
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load } = useComboOffers();
		await load({ pos_profile: PROFILE, customer: "Mostrador" });
		await load({ pos_profile: PROFILE, customer: "Mayoreo SA" });

		expect(call).toHaveBeenCalledTimes(2);
	});

	it("refetches for a different register, whose warehouse changes the stock", async () => {
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load } = useComboOffers();
		await load({ pos_profile: PROFILE });
		await load({ pos_profile: { ...PROFILE, name: "Caja 1", warehouse: "Bodega - DM" } });

		expect(call).toHaveBeenCalledTimes(2);
	});
});

describe("failure is an empty strip, never a broken sale", () => {
	it("returns nothing when the call rejects", async () => {
		call.mockRejectedValue(new Error("network"));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { load, offers } = useComboOffers();

		await expect(load({ pos_profile: PROFILE })).resolves.toEqual([]);
		expect(offers.value).toEqual([]);
		errors.mockRestore();
	});

	it("does not cache a failure, so the next shift is not blank for five minutes", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		call.mockRejectedValueOnce(new Error("network"));
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		await load({ pos_profile: PROFILE });
		expect(offers.value).toHaveLength(1);
		errors.mockRestore();
	});

	it("asks nothing at all before the shift opens", async () => {
		// No profile means no price list and no warehouse: there is no honest
		// answer to fetch, so there is no call to make.
		const { load, offers } = useComboOffers();
		await load({});
		expect(call).not.toHaveBeenCalled();
		expect(offers.value).toEqual([]);
	});

	it("survives a message that is not a list", async () => {
		call.mockResolvedValue({ message: { unexpected: true } });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });
		expect(offers.value).toEqual([]);
	});
});

describe("the strip renders from the real source, end to end", () => {
	it("turns a get_combos payload into the tiles the artboard draws", async () => {
		call.mockResolvedValue({ message: [HONOR_COMBO_PAYLOAD] });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		const suggestions = buildSuggestions({
			combos: offers.value as ComboOffer[],
			cart: [{ item_code: "IPN002611", qty: 1 }],
		});

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			item_code: "COMBO-X8A",
			kind: "combo",
			rate: 289,
			// 185 + 80 + 60 = 325 list, sold at 289.
			saving: 36,
			reason: "targets-cart-item",
		});
	});

	it("renders nothing when the register offers no combos", async () => {
		call.mockResolvedValue({ message: [] });
		const { load, offers } = useComboOffers();
		await load({ pos_profile: PROFILE });

		expect(buildSuggestions({ combos: offers.value, cart: ["IPN002611"] })).toEqual([]);
	});
});
