import { describe, expect, it, vi, beforeEach } from "vitest";

const offlineMocks = vi.hoisted(() => ({
	saveItemsBulk: vi.fn(async () => {}),
	clearStoredItems: vi.fn(async () => {}),
	setItemsLastSync: vi.fn(),
	getItemsLastSync: vi.fn(() => null),
	saveItemDetailsCache: vi.fn(),
	saveItemUOMs: vi.fn(),
	saveItemGroups: vi.fn(),
	getCachedItemGroups: vi.fn(() => []),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
	updateLocalStockCache: vi.fn(),
	setStockCacheReady: vi.fn(),
}));

vi.mock("../src/posapp/services/itemService", () => ({
	default: {
		getItemGroupsData: vi.fn(async () => []),
	},
}));

vi.mock("../src/offline/index", () => ({
	saveItemsBulk: offlineMocks.saveItemsBulk,
	clearStoredItems: offlineMocks.clearStoredItems,
	setItemsLastSync: offlineMocks.setItemsLastSync,
	getItemsLastSync: offlineMocks.getItemsLastSync,
	saveItemDetailsCache: offlineMocks.saveItemDetailsCache,
	saveItemUOMs: offlineMocks.saveItemUOMs,
	saveItemGroups: offlineMocks.saveItemGroups,
	getCachedItemGroups: offlineMocks.getCachedItemGroups,
	refreshBootstrapSnapshotFromCacheState:
		offlineMocks.refreshBootstrapSnapshotFromCacheState,
	updateLocalStockCache: offlineMocks.updateLocalStockCache,
	setStockCacheReady: offlineMocks.setStockCacheReady,
}));

const syncStateMocks = vi.hoisted(() => ({ getSyncResourceState: vi.fn(async () => null), setSyncResourceState: vi.fn(async () => {}) }));
vi.mock("../src/offline/sync/syncState", () => syncStateMocks);
vi.mock("../src/offline/cache", () => ({ getBootstrapSnapshot: vi.fn(), setBootstrapSnapshot: vi.fn() }));

import itemService from "../src/posapp/services/itemService";
import { useItemsSync } from "../src/posapp/composables/pos/items/store/useItemsSync";

describe("store useItemsSync background progress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("tracks progress from remaining catalog instead of already loaded bootstrap items", async () => {
		const sync = useItemsSync();
		const setItems = vi.fn();
		const frappeCall = vi
			.fn()
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-2", item_name: "Item 2" },
					{ item_code: "ITEM-3", item_name: "Item 3" },
				],
			})
			.mockImplementationOnce(async () => {
				expect(sync.loadProgress.value).toBe(67);
				expect((sync as any).syncedItemsCount?.value).toBe(2);
				return { message: [] };
			});
		(globalThis as any).frappe = { call: frappeCall };

		await sync.backgroundSyncItems(
			{
				initialBatch: [{ item_code: "ITEM-1", item_name: "Item 1" }],
			},
			{ name: "POS-1", warehouse: "WH-1" } as any,
			"Retail",
			"POS-1_WH-1",
			true,
			() => 2,
			setItems,
			vi.fn(async () => {}),
			{ value: 4 },
			{ value: false },
			{
				value: [{ item_code: "ITEM-1", item_name: "Item 1" }],
			},
		);

		expect(sync.loadProgress.value).toBe(100);
		expect((sync as any).syncedItemsCount?.value).toBe(2);
		expect(setItems).toHaveBeenCalledWith(
			[
				{ item_code: "ITEM-2", item_name: "Item 2" },
				{ item_code: "ITEM-3", item_name: "Item 3" },
			],
			{ append: true },
		);
	});

	it("marks stock cache ready after background item sync stores stock quantities", async () => {
		const sync = useItemsSync();
		const frappeCall = vi
			.fn()
			.mockResolvedValueOnce({
				message: [
					{
						item_code: "ITEM-2",
						item_name: "Item 2",
						actual_qty: 7,
					},
				],
			})
			.mockResolvedValueOnce({ message: [] });
		(globalThis as any).frappe = { call: frappeCall };

		await sync.backgroundSyncItems(
			{
				initialBatch: [
					{
						item_code: "ITEM-1",
						item_name: "Item 1",
						actual_qty: 3,
					},
				],
			},
			{ name: "POS-1", warehouse: "WH-1" } as any,
			"Retail",
			"POS-1_WH-1",
			true,
			() => 2,
			vi.fn(),
			vi.fn(async () => {}),
			{ value: 2 },
			{ value: false },
			{
				value: [
					{
						item_code: "ITEM-1",
						item_name: "Item 1",
						actual_qty: 3,
					},
				],
			},
		);

		expect(
			offlineMocks.refreshBootstrapSnapshotFromCacheState,
		).toHaveBeenLastCalledWith({
			itemsCount: 2,
			stockCacheReady: true,
		});
	});

	it("requests larger background batches by default", async () => {
		const sync = useItemsSync();
		const resolvePageSize = vi.fn((pageSize?: number) => pageSize || 0);
		const frappeCall = vi.fn().mockResolvedValueOnce({ message: [] });
		(globalThis as any).frappe = { call: frappeCall };

		await sync.backgroundSyncItems(
			{},
			{ name: "POS-1", warehouse: "WH-1" } as any,
			"Retail",
			"POS-1_WH-1",
			true,
			resolvePageSize,
			vi.fn(),
			vi.fn(async () => {}),
			{ value: 0 },
			{ value: false },
			{ value: [] },
		);

		expect(resolvePageSize).toHaveBeenCalledWith(1000);
		expect(frappeCall).toHaveBeenCalledWith(
			expect.objectContaining({
				args: expect.objectContaining({
					limit: 1000,
				}),
			}),
		);
	});

	it("throttles cached pagination refresh while background batches continue", async () => {
		const sync = useItemsSync();
		const updateCachedPaginationFromStorage = vi.fn(async () => {});
		const setItems = vi.fn();
		const frappeCall = vi
			.fn()
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-1", item_name: "Item 1" },
					{ item_code: "ITEM-2", item_name: "Item 2" },
				],
			})
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-3", item_name: "Item 3" },
					{ item_code: "ITEM-4", item_name: "Item 4" },
				],
			})
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-5", item_name: "Item 5" },
					{ item_code: "ITEM-6", item_name: "Item 6" },
				],
			})
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-7", item_name: "Item 7" },
					{ item_code: "ITEM-8", item_name: "Item 8" },
				],
			})
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-9", item_name: "Item 9" },
					{ item_code: "ITEM-10", item_name: "Item 10" },
				],
			})
			.mockResolvedValueOnce({
				message: [
					{ item_code: "ITEM-11", item_name: "Item 11" },
					{ item_code: "ITEM-12", item_name: "Item 12" },
				],
			})
			.mockResolvedValueOnce({ message: [] });
		(globalThis as any).frappe = { call: frappeCall };

		await sync.backgroundSyncItems(
			{},
			{ name: "POS-1", warehouse: "WH-1" } as any,
			"Retail",
			"POS-1_WH-1",
			true,
			() => 2,
			setItems,
			updateCachedPaginationFromStorage,
			{ value: 12 },
			{ value: false },
			{ value: [] },
		);

		expect(setItems).toHaveBeenCalledTimes(6);
		expect(updateCachedPaginationFromStorage).toHaveBeenCalledTimes(2);
	});
});


describe("item group cache hydration", () => {
	it("preserves the hydrated reference and avoids writes when background groups match", async () => {
		vi.clearAllMocks();
		let finish: (groups: any) => void = () => {};
		const response = new Promise<any>((resolve) => { finish = resolve; });
		vi.mocked(itemService.getItemGroupsData).mockReturnValueOnce(response);
		offlineMocks.getCachedItemGroups.mockReturnValueOnce(["ALL", "Cached"] as never[]);
		const sync = useItemsSync();
		await sync.loadItemGroups({ name: "POS-1" } as any);
		const hydrated = sync.itemGroups.value;
		finish([{ name: "Cached" }]);
		await response;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sync.itemGroups.value).toBe(hydrated);
		expect(offlineMocks.saveItemGroups).not.toHaveBeenCalled();
	});
	it("returns cached groups immediately without awaiting the online refresh", async () => {
		let finish: (groups: any) => void = () => {};
		vi.mocked(itemService.getItemGroupsData).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
		offlineMocks.getCachedItemGroups.mockReturnValueOnce(["ALL", "Cached"] as never[]);
		const sync = useItemsSync();
		await sync.loadItemGroups({ name: "POS-1" } as any);
		expect(sync.itemGroups.value).toEqual(["ALL", "Cached"]);
		finish([{ name: "Fresh" }]);
		await vi.waitFor(() => expect(sync.itemGroups.value).toEqual(["ALL", "Fresh"]));
		expect(offlineMocks.saveItemGroups).toHaveBeenCalledWith(["ALL", "Fresh"], JSON.stringify(["POS-1", null]));
	});
	it("ignores a late response from a previously selected profile", async () => {
		let finish: (groups: any) => void = () => {};
		vi.mocked(itemService.getItemGroupsData).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
		const sync = useItemsSync();
		await sync.loadItemGroups({ name: "POS-1" } as any);
		await sync.loadItemGroups({ name: "POS-2", item_groups: [{ item_group: "Restricted" }] } as any);
		finish([{ name: "Old profile" }]);
		await Promise.resolve(); await Promise.resolve();
		expect(sync.itemGroups.value).toEqual(["ALL", "Restricted"]);
	});
});

describe("legacy delta pagination migration", () => {
	it("repairs an old cursor with a full scan and persists only after the last page", async () => {
		vi.clearAllMocks();
		offlineMocks.getItemsLastSync.mockReturnValue("2026-09-06 11:00:00" as never);
		const frappeCall = vi.fn().mockResolvedValueOnce({ message: {
			changes: [{ key: "item::A", data: { item_code: "A" } }], has_more: true, next_cursor: "page2",
		} }).mockImplementationOnce(async () => {
			expect(offlineMocks.saveItemsBulk).not.toHaveBeenCalled();
			expect(offlineMocks.setItemsLastSync).not.toHaveBeenCalled();
			return { message: { changes: [{ key: "item::B", data: { item_code: "B" } }], next_watermark: "2026-09-06 12:00:00" } };
		});
		(globalThis as any).frappe = { call: frappeCall };
		const sync = useItemsSync();
		const result = await sync.refreshModifiedItems({ name: "POS-1" } as any, "Retail", null, "scope", vi.fn(), new Map());
		expect(result.count).toBe(2);
		expect(frappeCall.mock.calls[0][0].args.watermark).toBeNull();
		expect(frappeCall.mock.calls[1][0].args.page_cursor).toBe("page2");
		expect(offlineMocks.setItemsLastSync).toHaveBeenCalledWith("2026-09-06 12:00:00");
	});
});
