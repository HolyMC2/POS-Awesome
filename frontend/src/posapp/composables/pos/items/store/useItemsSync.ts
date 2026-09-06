import { ref } from "vue";
import { fetchAllSyncPages } from "../../../../../offline/sync/pagination";
import { buildScopeSignature, persistResourceSyncState } from "../../../../../offline/sync/adapters/common";
import { getSyncResourceState } from "../../../../../offline/sync/syncState";
import type { Item, POSProfile } from "../../../../types/models";
import itemService from "../../../../services/itemService";
import { withRequestTimeout } from "../../../../utils/requestTimeout";
// @ts-ignore
import {
	saveItemsBulk,
	clearStoredItems,
	setItemsLastSync,
	getItemsLastSync,
	saveItemDetailsCache,
	saveItemUOMs,
	saveItemUOMsBulk,
	saveItemGroups,
	getCachedItemGroups,
	deleteStoredItemsByCodes,
	removeItemDetailsCacheEntries,
	removeCachedPriceListItems,
	refreshBootstrapSnapshotFromCacheState,
	updateLocalStockCache,
	setStockCacheReady,
} from "../../../../../offline/index";

export interface BackgroundSyncState {
	running: boolean;
	token: number;
	/**
	 * Wall clock of the last observed progress (start of the pass, or the last
	 * batch that landed). The resume coordinator uses it to tell a sync that is
	 * genuinely working from one whose request died with the screen.
	 */
	lastProgressAt: number | null;
}

const hasStockQuantity = (item: Item) =>
	item && Object.prototype.hasOwnProperty.call(item, "actual_qty");

const containsStockQuantities = (items: Item[]) =>
	Array.isArray(items) && items.some(hasStockQuantity);

const DELTA_SYNC_LIMIT = 1000;
const BACKGROUND_SYNC_PAGE_SIZE = 1000;
const BACKGROUND_PAGINATION_REFRESH_BATCHES = 5;
/** A catalog page is big; give it room, but never forever. */
export const BACKGROUND_SYNC_TIMEOUT_MS = 90_000;
export const DELTA_SYNC_TIMEOUT_MS = 45_000;

export function useItemsSync() {
	const isLoading = ref(false);
	const isBackgroundLoading = ref(false);
	const loadProgress = ref(0);
	const syncedItemsCount = ref(0);
	const requestToken = ref(0);
	const abortControllers = ref(new Map<string, AbortController>());
	const backgroundSyncState = ref<BackgroundSyncState>({
		running: false,
		token: 0,
		lastProgressAt: null,
	});

	const itemGroups = ref<string[]>(["ALL"]);

	let itemGroupsRequest = 0;
	const loadItemGroups = async (posProfile: POSProfile | null) => {
		const request = ++itemGroupsRequest;
		const scope = JSON.stringify([posProfile?.name || null, posProfile?.modified || null]);
		const configured = posProfile?.item_groups || [];
		if (configured.length && !configured.some((row: any) => row.item_group === "All Item Groups")) {
			const groups = ["ALL", ...configured.map((row: any) => row.item_group).filter(Boolean)];
			itemGroups.value = groups;
			saveItemGroups(groups, scope);
			return;
		}
		const cached = getCachedItemGroups(scope);
		itemGroups.value = Array.isArray(cached) && cached.length ? cached : ["ALL"];
		if (typeof navigator !== "undefined" && navigator.onLine === false) return;
		// Hydration resolves immediately. A late response from the old profile
		// must never overwrite the currently selected profile or its cache.
		void withRequestTimeout(itemService.getItemGroupsData(), "items.get_items_groups", DELTA_SYNC_TIMEOUT_MS)
			.then((response) => {
				if (request !== itemGroupsRequest || !Array.isArray(response)) return;
				const groups = ["ALL", ...response.map((row) => row.name)];
				// A warm response commonly repeats the scoped cache. Preserve its
				// reactive identity and avoid another persistence/snapshot refresh.
				if (Array.isArray(cached) && cached.length &&
					groups.length === itemGroups.value.length &&
					groups.every((group, index) => group === itemGroups.value[index])) return;
				itemGroups.value = groups;
				saveItemGroups(groups, scope);
			})
			.catch((error) => console.error("Failed to refresh item groups:", error));
	};

	const persistItemsToStorage = async (
		itemsBatch: Item[],
		shouldPersist: boolean,
		replaceExisting: boolean,
		scope: string,
		updateCachedPaginationCallback: () => Promise<void>,
	) => {
		if (!shouldPersist) {
			return;
		}

		if (!Array.isArray(itemsBatch) || itemsBatch.length === 0) {
			return;
		}

		try {
			if (replaceExisting) {
				await clearStoredItems(scope);
			}

			await saveItemsBulk(itemsBatch, scope);
			await updateCachedPaginationCallback();
		} catch (error) {
			console.error("Failed to persist items batch:", error);
		}
	};

	const primeItemDetailsCache = (
		itemList: Item[],
		posProfile: POSProfile | null,
		activePriceList: string,
	) => {
		if (
			!Array.isArray(itemList) ||
			itemList.length === 0 ||
			!posProfile?.name
		) {
			return;
		}

		const detailItems = itemList.filter((item): item is Item =>
			Boolean(item?.item_code),
		);
		if (!detailItems.length) {
			return;
		}

		saveItemDetailsCache(
			posProfile.name,
			typeof activePriceList === "string" ? activePriceList : "",
			detailItems,
		);

		// Batch UOM cache writes. The per-item `saveItemUOMs` path calls
		// `persist("uom_cache")` after every entry, and `persist` clones
		// the WHOLE growing cache with `JSON.parse(JSON.stringify(...))`
		// to hand to the persistence worker. On the Doco Ventas 6 645-
		// item catalog this turned the call below into a 30+ second
		// main-thread freeze (Page Unresponsive). Collect the entries
		// and persist once via `saveItemUOMsBulk`.
		const uomEntries: Array<{ itemCode: string; uoms: any }> = [];
		for (const item of detailItems) {
			if (Array.isArray(item.item_uoms) && item.item_uoms.length > 0) {
				uomEntries.push({ itemCode: item.item_code, uoms: item.item_uoms });
			}
		}
		if (uomEntries.length) {
			saveItemUOMsBulk(uomEntries);
		}
	};

	const cancelBackgroundSync = () => {
		backgroundSyncState.value.token += 1;
		backgroundSyncState.value.running = false;
		backgroundSyncState.value.lastProgressAt = null;
		isBackgroundLoading.value = false;
		loadProgress.value = 0;
		syncedItemsCount.value = 0;
	};

	const refreshModifiedItems = async (
		posProfile: POSProfile | null,
		activePriceList: string,
		customer: string | null,
		scope: string,
		updateItemsInPlace: (_items: Item[]) => void,
		itemsMap: Map<string, Item>,
	) => {
		const lastSync = getItemsLastSync();
		if (!lastSync || !posProfile?.name) return { size: 0, count: 0, items: [] };

		try {
			const priorState = await getSyncResourceState("items");
			const watermark = priorState?.scopeSignature === buildScopeSignature(posProfile) ? lastSync : null;
			const response = await fetchAllSyncPages(async (pageCursor) => {
				const result = await withRequestTimeout<any>(
					frappe.call({
						method: "posawesome.posawesome.api.offline_sync.items.sync_items",
						args: { pos_profile: JSON.stringify(posProfile), price_list: activePriceList,
							customer, watermark, limit: DELTA_SYNC_LIMIT, paginated: 1, page_cursor: pageCursor },
						freeze: false,
					}),
					"offline_sync.items.sync_items", DELTA_SYNC_TIMEOUT_MS,
				);
				return result.message;
			});
			const fetchedItems: Item[] = (response.changes || []).map((row) => row.data).filter(Boolean);

			const size = JSON.stringify(fetchedItems).length;
			let resolvedItems: Item[] = [];

			if (fetchedItems.length > 0) {
				const saved = await saveItemsBulk(fetchedItems, scope);
				if (saved && saved.ok === false) throw new Error("Offline item delta write incomplete");
				updateItemsInPlace(fetchedItems);
				resolvedItems = fetchedItems
					.map((item) => itemsMap.get(item.item_code))
					.filter((item): item is Item => !!item);

			}
			const deletedItemCodes = (response.deleted || [])
				.filter((row) => row.key.startsWith("item::"))
				.map((row) => row.key.slice(6));
			if (deletedItemCodes.length) {
				await deleteStoredItemsByCodes(deletedItemCodes, scope);
				removeItemDetailsCacheEntries(posProfile?.name, deletedItemCodes, activePriceList);
				removeCachedPriceListItems(deletedItemCodes, activePriceList);
				for (const code of deletedItemCodes) itemsMap.delete(code);
			}
			if (response.next_watermark) setItemsLastSync(response.next_watermark);
			await persistResourceSyncState({ resourceId: "items", status: "fresh", posProfile, response, watermark });

			return { size, count: fetchedItems.length, items: resolvedItems, deletedItemCodes };
		} catch (error) {
			console.error("Failed to refresh modified items:", error);
			return { size: 0, count: 0, items: [], error };
		}
	};

	const backgroundSyncItems = async (
		options: {
			reset?: boolean;
			groupFilter?: string;
			searchValue?: string;
			initialBatch?: Item[];
		} = {},
		posProfile: POSProfile | null,
		activePriceList: string,
		scope: string,
		shouldPersistItems: boolean,
		resolvePageSize: (_pageSize?: number) => number,
		setItems: (_items: Item[], _options?: any) => void,
		updateCachedPaginationFromStorage: () => Promise<void>,
		totalItemCount: { value: number },
		itemsLoaded: { value: boolean },
		items: { value: Item[] },
	) => {
		const {
			reset = false,
			groupFilter = "",
			searchValue = "",
			initialBatch = [],
		} = options;

		if (!shouldPersistItems) {
			return [];
		}

		if (searchValue && searchValue.trim().length > 0) {
			return [];
		}

		const normalizedGroup =
			typeof groupFilter === "string" && groupFilter.length > 0
				? groupFilter
				: "ALL";

		const token = ++backgroundSyncState.value.token;
		backgroundSyncState.value.running = true;
		backgroundSyncState.value.lastProgressAt = Date.now();
		isBackgroundLoading.value = true;
		loadProgress.value = 0;
		syncedItemsCount.value = 0;

		const appended: Item[] = [];
		const bootstrapCount = Array.isArray(initialBatch)
			? initialBatch.length
			: items.value.length;
		let stockCacheReady = false;
		let batchesSincePaginationRefresh = 0;
		const remainingCatalogEstimate =
			totalItemCount.value > bootstrapCount
				? totalItemCount.value - bootstrapCount
				: 0;

		try {
			if (reset) {
				await clearStoredItems(scope);
				if (Array.isArray(initialBatch) && initialBatch.length) {
					await saveItemsBulk(initialBatch, scope);
					if (containsStockQuantities(initialBatch)) {
						updateLocalStockCache(initialBatch);
						stockCacheReady = true;
					}
					await updateCachedPaginationFromStorage();
				}
			} else if (Array.isArray(initialBatch) && initialBatch.length) {
				if (containsStockQuantities(initialBatch)) {
					updateLocalStockCache(initialBatch);
					stockCacheReady = true;
				}
			}

			let loaded = items.value.length;
			let syncedCount = 0;
			let lastItemName = items.value.length
				? items.value[items.value.length - 1]?.item_name || null
				: null;

			const limit = resolvePageSize(BACKGROUND_SYNC_PAGE_SIZE);

			while (
				backgroundSyncState.value.token === token &&
				shouldPersistItems
			) {
				// Clone posProfile and disable caching for this specific request
				const requestProfile = JSON.parse(JSON.stringify(posProfile));
				if (reset) {
					requestProfile.posa_use_server_cache = 0;
					requestProfile.posa_force_reload_items = 1;
				}

				// @ts-ignore
				const pageCall = frappe.call({
					method: "posawesome.posawesome.api.items.get_items",
					args: {
						pos_profile: JSON.stringify(requestProfile),
						price_list: activePriceList,
						item_group:
							normalizedGroup !== "ALL"
								? normalizedGroup.toLowerCase()
								: "",
						start_after: lastItemName,
						limit,
					},
				});
				// Bounded: an unbounded await here parked `running = true`
				// forever when the request died with the screen, and
				// `triggerBackgroundSync` then refused every later pass.
				const response = await withRequestTimeout<any>(
					pageCall,
					"items.get_items",
					BACKGROUND_SYNC_TIMEOUT_MS,
				);

				if (backgroundSyncState.value.token !== token) {
					break;
				}
				backgroundSyncState.value.lastProgressAt = Date.now();

				const batch = Array.isArray(response.message)
					? response.message
					: [];
				if (batch.length === 0) {
					break;
				}

				primeItemDetailsCache(batch, posProfile, activePriceList);
				if (containsStockQuantities(batch)) {
					updateLocalStockCache(batch);
					stockCacheReady = true;
				}
				await saveItemsBulk(batch, scope);
				setItems(batch, { append: true });
				appended.push(...batch);
				loaded += batch.length;
				syncedCount += batch.length;
				syncedItemsCount.value = syncedCount;
				lastItemName =
					batch[batch.length - 1]?.item_name || lastItemName;
				batchesSincePaginationRefresh += 1;

				if (remainingCatalogEstimate > 0) {
					loadProgress.value = Math.min(
						99,
						Math.round(
							(syncedCount / remainingCatalogEstimate) * 100,
						),
					);
				} else if (syncedCount > 0) {
					loadProgress.value = Math.min(
						99,
						Math.round((syncedCount / (syncedCount + limit)) * 100),
					);
				}

				const reachedEnd = batch.length < limit;
				if (
					reachedEnd ||
					batchesSincePaginationRefresh >=
						BACKGROUND_PAGINATION_REFRESH_BATCHES
				) {
					await updateCachedPaginationFromStorage();
					batchesSincePaginationRefresh = 0;
				}

				if (batch.length < limit) {
					break;
				}

				// Yield to the main thread between batches so user-input
				// event handlers (search keystrokes, cart clicks) can run.
				// Without this, the rapid sync loop monopolizes the JS
				// thread on slow CPUs and the catalog search input eats
				// keystrokes. requestIdleCallback gives us the longest
				// pause when the user is actively interacting; setTimeout
				// fallback for Safari which still doesn't ship rIC.
				await new Promise<void>((resolve) => {
					if (typeof requestIdleCallback === "function") {
						requestIdleCallback(() => resolve(), { timeout: 250 });
					} else {
						setTimeout(resolve, 0);
					}
				});
			}

			if (backgroundSyncState.value.token === token) {
				loadProgress.value = 100;
				itemsLoaded.value = true;
				await updateCachedPaginationFromStorage();
				setItemsLastSync(new Date().toISOString());
				if (stockCacheReady) {
					setStockCacheReady(true);
				}
				const snapshotState: Record<string, unknown> = {
					itemsCount: loaded,
				};
				if (stockCacheReady) {
					snapshotState.stockCacheReady = true;
				}
				refreshBootstrapSnapshotFromCacheState(snapshotState);
			}

			return appended;
		} catch (error) {
			console.error("Background item sync failed:", error);
			return appended;
		} finally {
			if (backgroundSyncState.value.token === token) {
				backgroundSyncState.value.running = false;
				isBackgroundLoading.value = false;
			}
		}
	};

	return {
		isLoading,
		isBackgroundLoading,
		loadProgress,
		syncedItemsCount,
		requestToken,
		abortControllers,
		backgroundSyncState,
		itemGroups,
		loadItemGroups,
		persistItemsToStorage,
		primeItemDetailsCache,
		cancelBackgroundSync,
		refreshModifiedItems,
		backgroundSyncItems,
	};
}
