import { beforeEach, describe, expect, it, vi } from "vitest";

const { memory, persist } = vi.hoisted(() => ({ memory: { local_stock_cache: {} as Record<string, any> }, persist: vi.fn() }));
vi.mock("../src/offline/db", () => ({ memory, persist }));
vi.mock("../src/offline/cache", () => ({ refreshBootstrapSnapshotFromCacheState: vi.fn() }));
import { updateLocalStock, updateLocalStockWithActualQuantities } from "../src/offline/stock";

beforeEach(() => { memory.local_stock_cache = { A: { actual_qty: 12 } }; persist.mockClear(); });

describe("offline stock UOM accounting", () => {
	it("consumes all 12 stock units when selling one box", () => {
		updateLocalStock([{ item_code: "A", qty: 1, stock_qty: 12, conversion_factor: 12 }]);
		expect(memory.local_stock_cache.A.actual_qty).toBe(0);
	});
	it("falls back to the conversion factor if stock_qty is absent", () => {
		updateLocalStock([{ item_code: "A", qty: 2, conversion_factor: 3 }]);
		expect(memory.local_stock_cache.A.actual_qty).toBe(6);
	});
	it("restores stock on a signed return and respects explicit zero stock_qty", () => {
		updateLocalStock([{ item_code: "A", qty: -1, stock_qty: -12 }, { item_code: "A", qty: 1, stock_qty: 0 }]);
		expect(memory.local_stock_cache.A.actual_qty).toBe(24);
	});
	it("uses the same units when applying a server quantity before decrementing", () => {
		updateLocalStockWithActualQuantities([{ item_code: "A", qty: 1, stock_qty: 12 }], [{ item_code: "A", actual_qty: 12 }]);
		expect(memory.local_stock_cache.A.actual_qty).toBe(0);
	});
	it("does not invent stock for uncached items", () => {
		updateLocalStock([{ item_code: "unknown", qty: -1 }]);
		expect(memory.local_stock_cache.unknown).toBeUndefined();
	});
});
