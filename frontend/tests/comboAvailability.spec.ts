import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";

import {
	COMBO_AVAILABILITY_UNRESOLVED,
	comboAvailability,
	comboAvailabilityOrUnknown,
	isAvailabilityKnown,
	isUnboundedAvailability,
	readAvailabilityProbe,
	resetAvailabilityProbe,
	resolveComboAvailability,
} from "../src/posapp/composables/pos/combos/comboAvailability";
import type { ComboAvailabilityComponent } from "../src/posapp/composables/pos/combos/comboAvailability";

/**
 * WHAT THIS FILE USED TO ASSERT, AND WHY IT CHANGED.
 *
 * Until 2026-08-22 this suite guarded an UNRESOLVED stub: roadmap §17.6 left
 * `availability = min(components)` an open back-end decision, and these tests
 * existed to make sure it stayed open rather than being closed by accident —
 * "the stub was quietly replaced by a default" had to be a failing test rather
 * than a code review someone might skip.
 *
 * The owner decided the rule on 2026-08-22, so the old assertions
 * (`comboAvailability` throws, `isAvailabilityKnown()` is false, every
 * resolution comes back unresolved) now assert a condition that is no longer
 * true. They were not weakened — they were REPLACED by assertions on the rule
 * they were holding a place for. The choke-point traffic test survives
 * unchanged in spirit, because "no surface answers availability by itself"
 * outlived the open decision.
 *
 * THE RULE: min over STOCK ITEMS ONLY, floored to whole combos. Short stock
 * obeys the register's existing `posa_block_sale_beyond_available_qty` rather
 * than any combo-specific policy.
 */

const REFERENCE: ComboAvailabilityComponent[] = [
	{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 10, is_stock_item: 1 },
	{ item_code: "MICA", item_name: "Mica Cristal", qty: 1, rate: 80, actual_qty: 24, is_stock_item: 1 },
	// Labour. A naive min() reads its stock as 0 and would report the
	// headline combo of the whole feature permanently unavailable.
	{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0, is_stock_item: 0 },
];

beforeEach(() => resetAvailabilityProbe());

describe("the rule: min over stock items only", () => {
	it("answers instead of throwing", () => {
		expect(() => comboAvailability(REFERENCE)).not.toThrow();
	});

	it("reports itself as known through the single predicate", () => {
		expect(isAvailabilityKnown()).toBe(true);
	});

	it("does not let labour cap the headline combo", () => {
		// The whole reason the rule is not a naive min(): Instalación has
		// actual_qty 0, and including it would report 0 forever.
		const { available, limitedBy } = comboAvailability(REFERENCE);
		expect(available).toBe(10);
		expect(limitedBy).toBe("Case negro");
	});

	it("names the component that actually set the limit", () => {
		const stock = comboAvailability([
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 30, is_stock_item: 1 },
			{ item_code: "MICA", item_name: "Mica Cristal", qty: 1, rate: 80, actual_qty: 7, is_stock_item: 1 },
		]);
		expect(stock.available).toBe(7);
		expect(stock.limitedBy).toBe("Mica Cristal");
	});

	it("counts whole combos, never a fraction of one", () => {
		// Seven units of a component that appears twice is three combos.
		const { available } = comboAvailability([
			{ item_code: "MICA", item_name: "Mica", qty: 2, rate: 80, actual_qty: 7, is_stock_item: 1 },
		]);
		expect(available).toBe(3);
	});

	it("is unbounded when every component is labour", () => {
		const allLabour = comboAvailability([
			{ item_code: "SRV-A", item_name: "Diagnóstico", qty: 1, rate: 100, actual_qty: 0, is_stock_item: 0 },
			{ item_code: "SRV-B", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0, is_stock_item: 0 },
		]);
		expect(isUnboundedAvailability(allLabour)).toBe(true);
		expect(allLabour.limitedBy).toBeNull();
	});

	it("reports zero, not a negative, when a component is already oversold", () => {
		const negative = comboAvailability([
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: -3, is_stock_item: 1 },
		]);
		expect(negative.available).toBe(0);
		// The clamp must not cost the operator-facing explanation.
		expect(negative.limitedBy).toBe("Case negro");
	});
});

describe("the awkward inputs", () => {
	it("does not divide by a component that needs zero units", () => {
		const { available, limitedBy } = comboAvailability([
			{ item_code: "FREEBIE", item_name: "Sticker", qty: 0, rate: 0, actual_qty: 0, is_stock_item: 1 },
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 4, is_stock_item: 1 },
		]);
		// A component needing none of itself cannot be the limit.
		expect(available).toBe(4);
		expect(limitedBy).toBe("Case negro");
	});

	it("breaks ties on the first component in bundle order", () => {
		const tie = comboAvailability([
			{ item_code: "A", item_name: "Primero", qty: 1, rate: 10, actual_qty: 5, is_stock_item: 1 },
			{ item_code: "B", item_name: "Segundo", qty: 1, rate: 10, actual_qty: 5, is_stock_item: 1 },
		]);
		expect(tie.available).toBe(5);
		expect(tie.limitedBy).toBe("Primero");
	});

	it("treats an unknown is_stock_item as constraining, not as free", () => {
		// Asymmetric on purpose: a wrong "constrains" shows a smaller number a
		// cashier will query; a wrong "does not constrain" oversells silently.
		const unknown = comboAvailability([
			{ item_code: "MYSTERY", item_name: "Sin bandera", qty: 1, rate: 10, actual_qty: 2 },
		]);
		expect(unknown.available).toBe(2);
		expect(unknown.limitedBy).toBe("Sin bandera");
	});

	it("prefers a caller-supplied stock reading over the component's own", () => {
		const fresher = comboAvailability(
			[{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 10, is_stock_item: 1 }],
			{ stockByItem: { CASE: 2 } },
		);
		expect(fresher.available).toBe(2);
	});

	it("falls back to the context's stock-item flags when the component has none", () => {
		const viaContext = comboAvailability(
			[
				{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 6 },
				{ item_code: "SRV", item_name: "Instalación", qty: 1, rate: 60, actual_qty: 0 },
			],
			{ stockItemFlags: { CASE: true, SRV: false } },
		);
		expect(viaContext.available).toBe(6);
		expect(viaContext.limitedBy).toBe("Case negro");
	});

	it("ignores blank rows rather than counting them as a limit", () => {
		const withBlank = comboAvailability([
			{ item_code: "", item_name: "", qty: 1, rate: 0, actual_qty: 0, is_stock_item: 1 },
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 9, is_stock_item: 1 },
		]);
		expect(withBlank.available).toBe(9);
	});
});

describe("ignorance is not scarcity", () => {
	it("stays unresolved when no constraining component reports stock", () => {
		const resolution = resolveComboAvailability([
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, is_stock_item: 1 },
		]);
		expect(resolution.resolved).toBe(false);
		expect(resolution).toEqual({
			resolved: false,
			reason: COMBO_AVAILABILITY_UNRESOLVED,
		});
	});

	it("renders nothing rather than a zero a cashier would believe", () => {
		// 0 would read as "quedan 0" and stop a sale the shop can assemble.
		expect(
			comboAvailabilityOrUnknown([
				{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, is_stock_item: 1 },
			]),
		).toBeNull();
	});

	it("resolves once any constraining component knows its stock", () => {
		const resolution = resolveComboAvailability([
			{ item_code: "CASE", item_name: "Case negro", qty: 1, rate: 200, actual_qty: 4, is_stock_item: 1 },
			{ item_code: "MICA", item_name: "Mica", qty: 1, rate: 80, is_stock_item: 1 },
		]);
		expect(resolution.resolved).toBe(true);
	});

	it("resolves an all-labour combo even with no stock readings at all", () => {
		// Nothing constrains, so there is nothing to be ignorant about.
		const resolution = resolveComboAvailability([
			{ item_code: "SRV", item_name: "Instalación", qty: 1, rate: 60, is_stock_item: 0 },
		]);
		expect(resolution.resolved).toBe(true);
	});
});

describe("every availability question goes through the choke point", () => {
	it("counts the traffic and answers through one path", () => {
		comboAvailabilityOrUnknown(REFERENCE);
		comboAvailabilityOrUnknown([]);
		resolveComboAvailability(REFERENCE);

		const probe = readAvailabilityProbe();
		expect(probe.calls).toBe(3);
		expect(probe.resolved).toBe(3);
		expect(probe.unresolved).toBe(0);
	});
});

/**
 * Source scan rather than a mounted assertion, because the guarantee is
 * "no such code path exists" — the same reasoning `PriceCheckDialog`'s
 * no-path-to-the-cart test uses (§17.2). This one OUTLIVED the open decision:
 * the danger was never only a placeholder, it was a second implementation.
 */
describe("no surface answers availability on its own", () => {
	const read = (relative: string) =>
		readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

	it("keeps the rule in the one module that owns it", () => {
		const source = read("../src/posapp/composables/pos/combos/comboAvailability.ts");
		// The decision is recorded where the rule lives, so the next reader
		// finds the argument and not just the arithmetic.
		expect(source).toContain("DECIDED 2026-08-22");
		expect(source).toContain("posa_block_sale_beyond_available_qty");
	});

	it("has no combo surface computing stock from components itself", () => {
		const surfaces = [
			"../src/posapp/components/pos/combos/ComboCartLine.vue",
			"../src/posapp/components/pos/combos/ComboSuggestionStrip.vue",
			"../src/posapp/composables/pos/combos/comboCatalog.ts",
			"../src/posapp/composables/pos/combos/comboPricing.ts",
			"../src/posapp/composables/pos/items/comboLineAttachment.ts",
		];
		for (const surface of surfaces) {
			const source = read(surface);
			expect(source, `${surface} must not implement availability`).not.toMatch(
				/Math\.min\s*\([^)]*actual_qty/,
			);
			expect(source, `${surface} must not floor a stock ratio`).not.toMatch(
				/Math\.floor\s*\([^)]*actual_qty/,
			);
		}
	});
});
