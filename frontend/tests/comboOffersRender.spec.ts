// @vitest-environment jsdom

/**
 * The two surfaces, drawn from a real `get_combos` payload — the acceptance
 * this round was missing (`docs/COMBOS_GOLDEN_FLOW.md` §1, §4.1).
 *
 * `comboCatalog.spec.ts` already holds the arithmetic and `upsellStrip.spec.ts`
 * already holds the tile's own rules. What neither could hold, because nothing
 * fed them, is the JOIN: that the shape `api/combos.py` actually serialises
 * reaches `buildCombosCategory` and `buildSuggestions` and comes out as a chip
 * with a count and a tile with a saving. Every previous green suite here was
 * green over `comboOffers = ref([])`.
 *
 * The payload below is transcribed from that module's serialiser — the return
 * block of `get_combos`, including the two shapes that break naive readers: a
 * Decimal-backed `rate` arriving as a STRING, and a service component
 * (`Instalación`, `is_stock_item: 0`, `actual_qty: 0`) that must not report the
 * headline combo of the whole feature as out of stock. Live HTTP is the lead's
 * browser walk after the roll; this is the shape contract until then.
 */

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import CatalogDrawer from "../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue";
import ComboSuggestionStrip from "../src/posapp/components/pos/combos/ComboSuggestionStrip.vue";
import {
	COMBOS_CATEGORY_ID,
	COMBOS_CATEGORY_TESTID,
	buildCombosCategory,
	buildSuggestions,
} from "../src/posapp/composables/pos/combos/comboCatalog";
import { normalizeComboOffer } from "../src/posapp/composables/pos/combos/useComboOffers";

/** A marker no formatter would produce, so a money figure can be counted. */
const money = (value: number) => `¤${Number(value).toFixed(2)}`;

/** Verbatim from `get_combos`'s return shape. See the file docstring. */
const GET_COMBOS_RESPONSE = [
	{
		item_code: "COMBO-PROTECCION",
		item_name: "Combo Protección Honor X8A",
		rate: "289.00",
		image: "/files/combo-proteccion.png",
		priority: 1,
		targets: ["HONOR-X8A"],
		components: [
			{
				item_code: "CASE-X8A",
				item_name: "Case negro Honor X8A",
				qty: 1,
				rate: "149.00",
				uom: "Nos",
				actual_qty: 12,
				is_stock_item: 1,
			},
			{
				item_code: "MICA-X8A",
				item_name: "Mica Cristal Honor X8A",
				qty: 1,
				rate: "99.00",
				uom: "Nos",
				actual_qty: 8,
				is_stock_item: 1,
			},
			{
				item_code: "INSTALACION",
				item_name: "Instalación",
				qty: 1,
				rate: "77.00",
				uom: "Nos",
				actual_qty: 0,
				is_stock_item: 0,
			},
		],
	},
	{
		item_code: "CAFE-COMBO-DESAYUNO",
		item_name: "Combo Desayuno",
		rate: "129.00",
		image: null,
		priority: 0,
		targets: [],
		components: [
			{
				item_code: "CAFE-AMERICANO-CH",
				item_name: "Café americano CH",
				qty: 1,
				rate: "45.00",
				uom: "Nos",
				actual_qty: 40,
				is_stock_item: 1,
			},
			{
				item_code: "CAFE-JUGO-CH",
				item_name: "Jugo de naranja CH",
				qty: 1,
				rate: "48.00",
				uom: "Nos",
				actual_qty: 22,
				is_stock_item: 1,
			},
			{
				item_code: "CAFE-MOLLETES",
				item_name: "Molletes",
				qty: 1,
				rate: "52.00",
				uom: "Nos",
				actual_qty: 15,
				is_stock_item: 1,
			},
		],
	},
];

/** What `useComboOffers` puts in `comboOffers` once the read model answers. */
const offers = GET_COMBOS_RESPONSE.map(normalizeComboOffer);

describe("the drawer's Combos category", () => {
	it("counts what the read model returned", () => {
		const category = buildCombosCategory(offers);
		expect(category).toMatchObject({
			id: COMBOS_CATEGORY_ID,
			count: 2,
			// A fresh ticket is exactly who should see bundles first.
			featured: true,
		});
	});

	it("renders as a selectable chip in the drawer", () => {
		const wrapper = mount(CatalogDrawer, {
			props: {
				phase: "open",
				presentation: "anchored",
				categories: [buildCombosCategory(offers)!],
			},
		});

		const chip = wrapper.find(`[data-testid="${COMBOS_CATEGORY_TESTID}"]`);
		expect(chip.exists()).toBe(true);
		expect(chip.text()).toContain("2");
		wrapper.unmount();
	});

	it("draws no chip row at all for a register with no bundles", () => {
		// The abarrotes golden flow: combos exist in the code and nowhere on the
		// screen. `null` rather than an empty chip — a chip is a promise of
		// content.
		expect(buildCombosCategory([])).toBeNull();

		const wrapper = mount(CatalogDrawer, {
			props: { phase: "open", presentation: "anchored", categories: [] },
		});
		expect(wrapper.find(".catalog-drawer__chips").exists()).toBe(false);
		wrapper.unmount();
	});
});

describe("the up-sell strip", () => {
	const strip = (cart: string[]) => {
		const onAdd = vi.fn();
		const wrapper = mount(ComboSuggestionStrip, {
			attachTo: document.body,
			props: {
				suggestions: buildSuggestions({ combos: offers, cart }),
				formatCurrency: money,
				onAdd,
			},
		});
		return { wrapper, onAdd };
	};

	it("offers the protección combo when its target is on the ticket", async () => {
		const { wrapper, onAdd } = strip(["HONOR-X8A"]);

		const tile = wrapper.find('[data-testid="upsell-tile-COMBO-PROTECCION"]');
		expect(tile.exists()).toBe(true);
		expect(tile.text()).toContain("Combo Protección Honor X8A");
		// 149 + 99 + 77 = 325 list, sold at 289. The saving is a number the
		// shopkeeper says out loud, and a string `rate` would have subtracted
		// as text.
		expect(tile.find('[data-testid="combo-saving"]').text()).toContain(money(36));
		expect(tile.text()).toContain(money(289));

		// Targeted beats universal: the artboard binds Enter to the first tile,
		// so the ranking decides which combo a keystroke adds.
		const tiles = wrapper.findAll('[data-testid^="upsell-tile-"]');
		expect(tiles[0]?.attributes("data-testid")).toBe("upsell-tile-COMBO-PROTECCION");

		await tile.trigger("click");
		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({ item_code: "COMBO-PROTECCION", kind: "combo" }),
		);
		wrapper.unmount();
	});

	it("does not read the service component as out of stock", () => {
		const { wrapper } = strip(["HONOR-X8A"]);
		const tile = wrapper.find('[data-testid="upsell-tile-COMBO-PROTECCION"]');

		// `Instalación` is labour with actual_qty 0. A min() over every
		// component would report the headline combo permanently unavailable and
		// `buildSuggestions` would drop the tile entirely.
		expect(tile.exists()).toBe(true);
		expect(tile.attributes("data-availability")).not.toBe("out");
		wrapper.unmount();
	});

	it("keeps universal combos and drops what is already on the ticket", () => {
		const { wrapper } = strip([]);
		// No target in the cart: the protección combo is not relevant, the
		// cafetería's untargeted breakfast combo always is.
		expect(wrapper.find('[data-testid="upsell-tile-CAFE-COMBO-DESAYUNO"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="upsell-tile-COMBO-PROTECCION"]').exists()).toBe(false);
		wrapper.unmount();
	});

	it("renders nothing at all when the register has no combos", () => {
		const wrapper = mount(ComboSuggestionStrip, {
			props: {
				suggestions: buildSuggestions({ combos: [], cart: ["HONOR-X8A"] }),
				formatCurrency: money,
				onAdd: vi.fn(),
			},
		});
		// Not an empty frame with a heading — the strip's ABSENCE is the
		// degraded state, offline and on a register with no bundles alike.
		expect(wrapper.find('[data-testid="upsell-strip"]').exists()).toBe(false);
		wrapper.unmount();
	});
});
