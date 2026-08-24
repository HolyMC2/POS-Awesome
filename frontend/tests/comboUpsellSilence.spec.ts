/**
 * The 2026-08-23 silent up-sell strip, replayed against the payload the
 * register actually received.
 *
 * THE REPORT. On «Demo POS» the drawer chip read «Combos 4», the cart held
 * «Cargador 20W USB-C», and `[data-testid="upsell-strip"]` drew nothing. Filed
 * as an eligibility-chain bug, with the charger named as "an EXPLICIT `POS
 * Combo` target of COMBO-CARGA".
 *
 * THE ANSWER. It is not a target and it cannot become one. «Cargador 20W
 * USB-C» is one of COMBO-CARGA's two COMPONENTS, and
 * `POSCombo.validate_targets_not_components` throws on any attempt to target a
 * component — for a reason the controller states plainly: a combo suggested
 * because its own part is in the cart is a bundle offered around a sale it was
 * meant to replace. The thirteen codes COMBO-CARGA does target are OTHER
 * chargers and cables («Cargador de pared», «Cable Lightning 1m») plus the
 * eight handsets, which is what made the report's reading an easy one.
 *
 * So the chain was intact and the silence was correct. These tests pin that,
 * because "correct" is worth nothing if the next person has to re-derive it
 * from a doctype validator; and they pin the positive case beside it, so a
 * future regression that really does break targeting fails here loudly instead
 * of looking like the same non-bug.
 *
 * The real defect the report found is one layer up and has its own suite
 * (`comboAttributeTargeting.spec.ts`): targeting by ITEM CODE cannot express
 * "for a Samsung A01" on a catalogue of 4 311 tagged variants, so a merchant
 * with real accessories has no reachable way to make the strip fire.
 */

import { describe, expect, it } from "vitest";

import {
	buildCombosCategory,
	buildSuggestions,
	combosForCart,
} from "../src/posapp/composables/pos/combos/comboCatalog";
import {
	DEMO_CABLE_TARGET,
	DEMO_CASE,
	DEMO_CHARGER,
	DEMO_COMBOS,
	DEMO_HANDSET,
} from "./fixtures/demoCombosPayload";

const codes = (offers: readonly { item_code: string }[]) => offers.map((o) => o.item_code);

describe("the charger that drew no strip", () => {
	it("draws nothing, because no combo targets a combo's own component", () => {
		expect(buildSuggestions({ combos: DEMO_COMBOS, cart: [DEMO_CHARGER] })).toEqual([]);
	});

	it("is a COMPONENT of the combo it was thought to target", () => {
		const carga = DEMO_COMBOS.find((c) => c.item_code === "COMBO-CARGA")!;
		expect(codes(carga.components)).toContain(DEMO_CHARGER);
		expect(carga.targets).not.toContain(DEMO_CHARGER);
	});

	it("keeps the Combos chip anyway, at the full shelf count", () => {
		// A ticket that matches nothing must not take the way in with it: the
		// cashier can still browse to the four combos the shop sells.
		expect(buildCombosCategory(DEMO_COMBOS, undefined, [DEMO_CHARGER])).toMatchObject({
			count: 4,
		});
	});
});

describe("what the same register does when a target IS on the ticket", () => {
	it("offers both celulares combos for a handset, leader first", () => {
		const tiles = buildSuggestions({ combos: DEMO_COMBOS, cart: [DEMO_HANDSET] });
		// priority 10 before priority 20 — «Demo POS»' own seeded ordering.
		expect(tiles.map((t) => t.item_code)).toEqual(["COMBO-PROTECCION", "COMBO-CARGA"]);
		expect(tiles.every((t) => t.reason === "targets-cart-item")).toBe(true);
	});

	it("offers only protección for a case, and only carga for a cable", () => {
		expect(codes(combosForCart(DEMO_COMBOS, [DEMO_CASE]))).toEqual(["COMBO-PROTECCION"]);
		expect(codes(combosForCart(DEMO_COMBOS, [DEMO_CABLE_TARGET]))).toEqual(["COMBO-CARGA"]);
	});

	it("never bleeds the cafetería's combos onto a phone-counter ticket", () => {
		const tiles = buildSuggestions({ combos: DEMO_COMBOS, cart: [DEMO_HANDSET] });
		expect(tiles.some((t) => t.item_code.startsWith("CAFE-"))).toBe(false);
	});

	it("narrows the drawer chip to the two that fit the device", () => {
		expect(buildCombosCategory(DEMO_COMBOS, undefined, [DEMO_HANDSET])).toMatchObject({
			count: 2,
		});
	});

	it("shows the whole shelf on an empty ticket", () => {
		// Nothing to filter by, and a fresh ticket is who `featured` is for.
		expect(buildCombosCategory(DEMO_COMBOS, undefined, [])).toMatchObject({ count: 4 });
	});
});

describe("the cafetería's own ticket, from the same payload", () => {
	it("offers the two cafetería combos for a capuchino, leader first", () => {
		const tiles = buildSuggestions({ combos: DEMO_COMBOS, cart: ["CAFE-CAPUCHINO-GR"] });
		expect(tiles.map((t) => t.item_code)).toEqual([
			"CAFE-COMBO-DESAYUNO",
			"CAFE-COMBO-CONCHA",
		]);
	});

	it("draws no stock figure on them — every component is labour-priced", () => {
		// `Instalación de mica` is the celulares version of the same rule; here
		// the whole cafetería menu is non-stock, so the tiles must show nothing
		// rather than «quedan 0».
		const tiles = buildSuggestions({ combos: DEMO_COMBOS, cart: ["CAFE-CAPUCHINO-GR"] });
		expect(tiles.map((t) => t.availability?.show)).toEqual([false, false]);
	});
});
