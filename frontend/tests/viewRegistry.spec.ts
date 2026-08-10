import { describe, expect, it, vi } from "vitest";

// The registry statically imports the real view components; stub them so
// this unit test exercises resolution logic without the whole SFC graph.
vi.mock("../src/posapp/components/pos/Invoice.vue", () => ({ default: { name: "Invoice" } }));
vi.mock("../src/posapp/components/pos/items/ItemsSelector.vue", () => ({
	default: { name: "ItemsSelector" },
}));

import {
	registeredViewKeys,
	resolveCartView,
	resolveItemsView,
} from "../src/posapp/vertical/viewRegistry";
import {
	CART_VIEW_REQUIRED_EVENTS,
	ITEMS_VIEW_REQUIRED_EVENTS,
} from "../src/posapp/vertical/viewContracts";

describe("viewRegistry", () => {
	it("resolves the retail entries for every context they serve", () => {
		expect(resolveCartView("table", "pos")).toBeTruthy();
		expect(resolveItemsView("standard", "pos")).toBeTruthy();
		expect(resolveItemsView("standard", "purchase")).toBeTruthy();
		expect(resolveItemsView("standard", "barcode")).toBeTruthy();
	});

	it("throws loudly on unknown (layout, context) pairs — never a blank counter", () => {
		// @ts-expect-error deliberately invalid layout key
		expect(() => resolveCartView("ticket", "pos")).toThrow(/no cart view registered/);
		// @ts-expect-error deliberately invalid context
		expect(() => resolveCartView("table", "kiosk")).toThrow(/context "kiosk"/);
	});

	it("keys every entry on (layout, context), never layout alone", () => {
		const keys = registeredViewKeys();
		for (const key of [...keys.cart, ...keys.items]) {
			expect(key).toMatch(/^[a-z-]+:(pos|purchase|barcode)$/);
		}
	});

	it("contract event lists stay non-empty and bus-typed", () => {
		// The `satisfies (keyof Events)[]` in viewContracts is the real
		// check (compile-time); this guards against emptying the lists.
		expect(CART_VIEW_REQUIRED_EVENTS.length).toBeGreaterThan(0);
		expect(ITEMS_VIEW_REQUIRED_EVENTS.length).toBeGreaterThan(0);
	});
});
