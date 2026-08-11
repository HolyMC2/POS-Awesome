import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const itemServiceMocks = vi.hoisted(() => ({
	getItemsData: vi.fn(async () => [] as any[]),
}));

const offlineMocks = vi.hoisted(() => ({
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
	getStoredItemsCountByScope: vi.fn(async () => 0),
	getAllStoredItems: vi.fn(async () => [] as any[]),
	getCachedPriceListItems: vi.fn(async () => null),
}));

const syncState = vi.hoisted(() => ({
	backgroundSyncState: {
		value: { running: false, token: 0, lastProgressAt: null as number | null },
	},
	isBackgroundLoading: { value: false },
}));

vi.mock("../src/posapp/services/itemService", () => ({
	default: {
		getItemsData: itemServiceMocks.getItemsData,
		getItemGroupsData: vi.fn(async () => []),
		getItemsFromBarcodeData: vi.fn(async () => null),
	},
}));

vi.mock("../src/offline/index", () => ({
	refreshBootstrapSnapshotFromCacheState:
		offlineMocks.refreshBootstrapSnapshotFromCacheState,
	getStoredItemsCountByScope: offlineMocks.getStoredItemsCountByScope,
	getAllStoredItems: offlineMocks.getAllStoredItems,
	getCachedPriceListItems: offlineMocks.getCachedPriceListItems,
}));

vi.mock("../src/posapp/composables/pos/items/store/useItemsCache", () => ({
	useItemsCache: () => ({
		cache: {
			value: {
				memory: {
					searchResults: new Map(),
					priceListData: new Map(),
					itemDetails: new Map(),
				},
			},
		},
		cacheHealth: { value: { items: "healthy" } },
		assessCacheHealth: vi.fn(async () => {}),
		clearAllCaches: vi.fn(async () => {}),
		clearSearchCache: vi.fn(),
		getCachedItems: vi.fn(async () => null),
		cacheItems: vi.fn(async () => {}),
		getCachedSearchResult: vi.fn(() => null),
		setCachedSearchResult: vi.fn(),
		getCachedPriceList: vi.fn(() => null),
		setCachedPriceList: vi.fn(),
		generateCacheKey: vi.fn(
			(searchValue = "", group = "ALL", priceList = "", scope = "") =>
				`${scope}:${priceList}:${group}:${searchValue}`,
		),
	}),
}));

vi.mock("../src/posapp/composables/pos/items/store/useItemsSearch", () => ({
	useItemsSearch: () => {
		const itemsMap = { value: new Map<string, any>() };
		const barcodeIndex = { value: new Map<string, any>() };
		return {
			itemsMap,
			barcodeIndex,
			updateIndexes: (items: any[] = []) => {
				items.forEach((item) => {
					if (item?.item_code) itemsMap.value.set(item.item_code, item);
				});
			},
			resetIndexes: () => {
				itemsMap.value = new Map();
				barcodeIndex.value = new Map();
			},
			performLocalSearch: (_term: string, items: any[]) => items,
			filterItemsByGroup: (items: any[]) => items,
			getItemByCode: (code: string) => itemsMap.value.get(code),
			getItemByBarcode: (barcode: string) => barcodeIndex.value.get(barcode),
		};
	},
}));

vi.mock("../src/posapp/composables/pos/items/store/useItemsSync", () => ({
	useItemsSync: () => ({
		isLoading: { value: false },
		isBackgroundLoading: syncState.isBackgroundLoading,
		loadProgress: { value: 0 },
		syncedItemsCount: { value: 0 },
		requestToken: { value: 0 },
		abortControllers: { value: new Map<string, AbortController>() },
		backgroundSyncState: syncState.backgroundSyncState,
		itemGroups: { value: ["ALL"] },
		loadItemGroups: vi.fn(async () => {}),
		persistItemsToStorage: vi.fn(async () => {}),
		primeItemDetailsCache: vi.fn(),
		// Mirrors the real cancel: bump the token so a zombie pass drops its
		// results, and clear the running/progress state.
		cancelBackgroundSync: () => {
			syncState.backgroundSyncState.value.token += 1;
			syncState.backgroundSyncState.value.running = false;
			syncState.backgroundSyncState.value.lastProgressAt = null;
			syncState.isBackgroundLoading.value = false;
		},
		refreshModifiedItems: vi.fn(async () => ({ size: 0, count: 0, items: [] })),
		backgroundSyncItems: vi.fn(async () => []),
	}),
}));

vi.mock("../src/posapp/composables/pos/items/store/useItemsPagination", () => ({
	useItemsPagination: () => ({
		cachedPagination: {
			value: {
				enabled: false,
				offset: 0,
				total: 0,
				loading: false,
				pageSize: 50,
				search: "",
				group: "ALL",
			},
		},
		DEFAULT_PAGE_SIZE: 50,
		LARGE_CATALOG_THRESHOLD: 500,
		resolvePageSize: vi.fn(() => 50),
		resolveLimitSearchSize: vi.fn(() => 50),
		resetCachedPagination: vi.fn(),
		updateCachedPaginationFromStorage: vi.fn(async () => {}),
	}),
}));

vi.mock("../src/posapp/composables/pos/items/store/useItemsMetrics", () => ({
	useItemsMetrics: () => ({
		performanceMetrics: {
			value: {
				totalRequests: 0,
				cachedRequests: 0,
				searchHits: 0,
				searchMisses: 0,
			},
		},
		updatePerformanceMetrics: vi.fn(),
		getEstimatedMemoryUsage: vi.fn(() => 0),
	}),
}));

import { useItemsStore } from "../src/posapp/stores/itemsStore";

const PROFILE = {
	name: "POS-1",
	warehouse: "Main WH",
	selling_price_list: "Retail",
	currency: "MXN",
	item_groups: [],
} as any;

const ITEM = {
	item_code: "CAFE-1",
	item_name: "Café Americano",
	item_group: "All Item Groups",
	stock_uom: "Nos",
	rate: 45,
	price_list_rate: 45,
};

describe("itemsStore resume recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setActivePinia(createPinia());
		syncState.backgroundSyncState.value = {
			running: false,
			token: 0,
			lastProgressAt: null,
		};
		syncState.isBackgroundLoading.value = false;
		offlineMocks.getStoredItemsCountByScope.mockResolvedValue(0);
		offlineMocks.getAllStoredItems.mockResolvedValue([]);
		itemServiceMocks.getItemsData.mockResolvedValue([]);
	});

	describe("resetStaleLoadGuards", () => {
		it("does nothing when no background sync is running", () => {
			const store = useItemsStore();
			expect(store.resetStaleLoadGuards()).toBe(false);
		});

		it("leaves a sync that is still making progress alone", () => {
			const store = useItemsStore();
			syncState.backgroundSyncState.value.running = true;
			syncState.backgroundSyncState.value.lastProgressAt = Date.now() - 1_000;

			expect(store.resetStaleLoadGuards()).toBe(false);
			expect(syncState.backgroundSyncState.value.running).toBe(true);
		});

		it("cancels a sync whose request died with the screen", () => {
			const store = useItemsStore();
			syncState.backgroundSyncState.value.running = true;
			syncState.backgroundSyncState.value.lastProgressAt =
				Date.now() - 10 * 60_000;
			const tokenBefore = syncState.backgroundSyncState.value.token;

			expect(store.resetStaleLoadGuards()).toBe(true);
			expect(syncState.backgroundSyncState.value.running).toBe(false);
			// Token bumped, so the zombie pass discards whatever it wakes up with.
			expect(syncState.backgroundSyncState.value.token).toBe(tokenBefore + 1);
		});
	});

	describe("ensureCatalogLoaded watchdog", () => {
		it("stays out of the way when no profile is registered", async () => {
			const store = useItemsStore();
			await expect(store.ensureCatalogLoaded()).resolves.toBe("skipped");
			expect(itemServiceMocks.getItemsData).not.toHaveBeenCalled();
		});

		it("stays out of the way when the catalog is populated", async () => {
			const store = useItemsStore();
			store.posProfile = PROFILE;
			itemServiceMocks.getItemsData.mockResolvedValue([ITEM]);
			await store.loadItems({ forceServer: true });
			itemServiceMocks.getItemsData.mockClear();

			await expect(store.ensureCatalogLoaded()).resolves.toBe("skipped");
			expect(itemServiceMocks.getItemsData).not.toHaveBeenCalled();
		});

		it("stays out of the way for a server-side-search profile that shows nothing by design", async () => {
			const store = useItemsStore();
			store.posProfile = { ...PROFILE, posa_use_limit_search: 1 };

			await expect(store.ensureCatalogLoaded()).resolves.toBe("skipped");
			expect(itemServiceMocks.getItemsData).not.toHaveBeenCalled();
		});

		it("rehydrates from local storage without touching the server", async () => {
			const store = useItemsStore();
			store.posProfile = PROFILE;
			offlineMocks.getStoredItemsCountByScope.mockResolvedValue(1);
			offlineMocks.getAllStoredItems.mockResolvedValue([ITEM]);

			await expect(store.ensureCatalogLoaded({ online: true })).resolves.toBe(
				"cache",
			);
			expect(store.items).toHaveLength(1);
			expect(itemServiceMocks.getItemsData).not.toHaveBeenCalled();
		});

		it("reloads from the server when local storage came back empty too", async () => {
			const store = useItemsStore();
			store.posProfile = PROFILE;
			itemServiceMocks.getItemsData.mockResolvedValue([ITEM]);

			await expect(store.ensureCatalogLoaded({ online: true })).resolves.toBe(
				"server",
			);
			expect(itemServiceMocks.getItemsData).toHaveBeenCalledTimes(1);
			expect(store.items).toHaveLength(1);
		});

		it("never reaches for the server while offline", async () => {
			const store = useItemsStore();
			store.posProfile = PROFILE;

			await expect(store.ensureCatalogLoaded({ online: false })).resolves.toBe(
				"failed",
			);
			expect(itemServiceMocks.getItemsData).not.toHaveBeenCalled();
		});
	});
});
