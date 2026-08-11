import { describe, expect, it } from "vitest";

import {
	buildLineDelta,
	cartAsLines,
	orderAsCartItems,
	rebaseSyncedLines,
} from "../src/posapp/stores/floor/floorCartBridge";
import type { OrderLine, OrderRow } from "../src/posapp/api/restaurant";

// The per-line union (spec §6.1) lives or dies on these two properties:
// a STABLE merge key per cart row, and a delta that never names a removal
// the operator didn't make. A regression here silently deletes another
// waiter's food — the exact failure the design exists to prevent.

const line = (overrides: Partial<OrderLine> = {}): OrderLine => ({
	line_uid: "uid-1",
	item_code: "CAFE-AMERICANO",
	item_name: "Café Americano",
	qty: 1,
	uom: "Nos",
	rate: 35,
	notes: null,
	course_idx: 1,
	...overrides,
});

describe("cartAsLines", () => {
	it("uses the cart's posa_row_id as the line_uid", () => {
		const items = [{ posa_row_id: "row-9", item_code: "X", qty: 2, rate: 10 }];
		expect(cartAsLines(items)[0]?.line_uid).toBe("row-9");
	});

	it("mints a uid for a bare row and writes it BACK so the next tick reuses it", () => {
		const item: any = { item_code: "X", qty: 1, rate: 5 };
		const first = cartAsLines([item])[0];
		const second = cartAsLines([item])[0];

		expect(first?.line_uid).toBeTruthy();
		// Stability, not just presence: a fresh uid per debounce tick would
		// upsert the same food as a new line every time.
		expect(second?.line_uid).toBe(first?.line_uid);
		expect(item.posa_row_id).toBe(first?.line_uid);
	});
});

describe("buildLineDelta", () => {
	it("upserts lines the baseline has never seen", () => {
		const delta = buildLineDelta([line()], new Map());
		expect(delta.upserts.map((l) => l.line_uid)).toEqual(["uid-1"]);
		expect(delta.removed).toEqual([]);
	});

	it("upserts only lines whose synced fields changed", () => {
		const baseline = new Map([
			["uid-1", line()],
			["uid-2", line({ line_uid: "uid-2", item_code: "PAN", qty: 3 })],
		]);
		const cart = [line({ qty: 2 }), line({ line_uid: "uid-2", item_code: "PAN", qty: 3 })];

		const delta = buildLineDelta(cart, baseline);

		expect(delta.upserts.map((l) => l.line_uid)).toEqual(["uid-1"]);
	});

	it("treats notes and course changes as changes", () => {
		const baseline = new Map([["uid-1", line()]]);
		expect(buildLineDelta([line({ notes: "sin azúcar" })], baseline).upserts).toHaveLength(1);
		expect(buildLineDelta([line({ course_idx: 2 })], baseline).upserts).toHaveLength(1);
	});

	it("names ONLY locally-dropped lines as removals", () => {
		const baseline = new Map([
			["uid-1", line()],
			["uid-2", line({ line_uid: "uid-2" })],
		]);
		const delta = buildLineDelta([line()], baseline);
		expect(delta.removed).toEqual(["uid-2"]);
	});

	it("never derives a removal from a line the baseline does not hold", () => {
		// A server line another waiter added is NOT in this device's baseline,
		// so it can never appear in `removed` — the union survives it.
		const delta = buildLineDelta([], new Map([["mine", line({ line_uid: "mine" })]]));
		expect(delta.removed).toEqual(["mine"]);
		expect(delta.upserts).toEqual([]);
	});

	it("returns the full cart as the next baseline candidate", () => {
		const cart = [line(), line({ line_uid: "uid-2" })];
		const delta = buildLineDelta(cart, new Map());
		expect([...delta.incoming.keys()].sort()).toEqual(["uid-1", "uid-2"]);
	});
});

describe("rebaseSyncedLines", () => {
	it("adopts the incoming map as the new baseline", () => {
		const incoming = new Map([["uid-1", line({ qty: 4 })]]);
		const next = rebaseSyncedLines(incoming, new Map());
		expect(next.get("uid-1")?.qty).toBe(4);
	});

	it("restores removals the server refused, so the next diff stops asking", () => {
		const previous = new Map([["fired-1", line({ line_uid: "fired-1" })]]);
		const next = rebaseSyncedLines(new Map(), previous, ["fired-1"]);
		expect(next.get("fired-1")?.line_uid).toBe("fired-1");
	});

	it("ignores a rejected removal the previous baseline never held", () => {
		const next = rebaseSyncedLines(new Map(), new Map(), ["ghost"]);
		expect(next.size).toBe(0);
	});
});

describe("orderAsCartItems", () => {
	it("round-trips a ticket line into a cart row keyed by the same uid", () => {
		const order = { lines: [line({ qty: 2, rate: 35 })] } as unknown as OrderRow;
		const rows = orderAsCartItems(order);
		expect(rows[0]?.posa_row_id).toBe("uid-1");
		expect(rows[0]?.amount).toBe(70);
	});

	it("returns an empty cart for a ticket with no lines", () => {
		expect(orderAsCartItems({} as OrderRow)).toEqual([]);
	});
});
