/**
 * Pinia Store for Items Management in POSAwesome
 * Optimized state management with multi-layer caching and performance improvements
 */

import { defineStore } from "pinia";
import { ref, shallowRef, triggerRef, markRaw, computed, watch } from "vue";
import type { Item, POSProfile } from "../types/models";
import itemService from "../services/itemService";
import { refreshBootstrapSnapshotFromCacheState } from "../../offline/index";

// Composables
import { useItemsCache } from "../composables/pos/items/store/useItemsCache";
import { useItemsSearch } from "../composables/pos/items/store/useItemsSearch";
import {
	isSearchWorkerEnabled,
	patchSearchIndex,
	searchViaWorker,
	setSearchIndex,
	type SearchIndexEntry,
} from "../composables/pos/items/useSearchWorker";
import { useItemsSync } from "../composables/pos/items/store/useItemsSync";
import { useItemsPagination } from "../composables/pos/items/store/useItemsPagination";
import { useItemsMetrics } from "../composables/pos/items/store/useItemsMetrics";
import {
	buildLoadItemsRequest,
	type LoadItemsOptions,
} from "./items/loadItemsRequest";

export const useItemsStore = defineStore("items", () => {
	type OfflineModule = Record<string, any>;
	let offlineApiPromise: Promise<OfflineModule> | null = null;

	const getOfflineApi = async (): Promise<OfflineModule> => {
		if (!offlineApiPromise) {
			offlineApiPromise = import("../../offline/index")
				.then((mod) => mod as OfflineModule)
				.catch((error) => {
					offlineApiPromise = null;
					console.warn("Failed to load offline module", error);
					return {};
				});
		}
		return await offlineApiPromise;
	};

	const getOfflineFn = async (name: string) => {
		const api = await getOfflineApi();
		return api[name];
	};

	const getStoredItemsCountByScopeCompat = async (scope = "") => {
		const scopedCountFn = await getOfflineFn("getStoredItemsCountByScope");
		if (typeof scopedCountFn === "function") {
			return await scopedCountFn(scope);
		}

		const legacyCountFn = await getOfflineFn("getStoredItemsCount");
		if (typeof legacyCountFn === "function") {
			console.warn(
				"offline/index.js missing getStoredItemsCountByScope; using legacy getStoredItemsCount fallback.",
			);
			return await legacyCountFn();
		}

		return 0;
	};

	const getAllStoredItemsCompat = async (scope = "") => {
		const scopedGetAllFn = await getOfflineFn("getAllStoredItems");
		if (typeof scopedGetAllFn === "function") {
			return await scopedGetAllFn(scope);
		}

		const legacyGetAllFn = await getOfflineFn("getStoredItems");
		if (typeof legacyGetAllFn === "function") {
			console.warn(
				"offline/index.js missing getAllStoredItems; using legacy getStoredItems fallback.",
			);
			return await legacyGetAllFn();
		}

		return [];
	};

	const searchStoredItemsCompat = async (args: any) => {
		const searchFn = await getOfflineFn("searchStoredItems");
		if (typeof searchFn !== "function") {
			return [];
		}
		return await searchFn(args);
	};

	const getCachedPriceListItemsCompat = async (priceList: string) => {
		const fn = await getOfflineFn("getCachedPriceListItems");
		if (typeof fn !== "function") {
			return null;
		}
		return await fn(priceList);
	};

	const syncBootstrapItemReadiness = (count: number | boolean) => {
		refreshBootstrapSnapshotFromCacheState({
			itemsCount: count,
		});
	};

	// Core State
	// `shallowRef` + `markRaw(item)` on insert so the catalog (often
	// 5 k+ rows on busy stores) does NOT get wrapped in per-property
	// Vue proxies. Mutations to individual `item.*` fields stop
	// firing reactivity automatically — call `triggerRef(items)` /
	// `triggerRef(filteredItems)` after a batch of mutations to
	// re-render consumers. The chunked background sync was the
	// dominant 30-60 s freeze on low-end devices because each chunk
	// re-wrapped the entire growing array as new proxies.
	const items = shallowRef<Item[]>([]);
	const filteredItems = shallowRef<Item[]>([]);
	const markRawItems = (list: Item[]): Item[] =>
		Array.isArray(list)
			? list.map((it) => (it && typeof it === "object" ? markRaw(it) : it))
			: [];
	const totalItemCount = ref(0);
	const itemsLoaded = ref(false);
	const searchTerm = ref("");
	const itemGroup = ref("ALL");
	const lastSearch = ref("");
	const posProfile = ref<POSProfile | null>(null);
	const customer = ref<string | null>(null);
	const customerPriceList = ref<string | null>(null);

	// Composables Initialization
	const {
		cache,
		cacheHealth,
		assessCacheHealth,
		clearAllCaches,
		clearSearchCache,
		getCachedItems,
		cacheItems,
		getCachedSearchResult,
		setCachedSearchResult,
		getCachedPriceList,
		setCachedPriceList,
		generateCacheKey,
	} = useItemsCache();

	const {
		itemsMap,
		barcodeIndex,
		updateIndexes,
		resetIndexes,
		performLocalSearch,
		filterItemsByGroup,
		getItemByCode,
		getItemByBarcode,
	} = useItemsSearch();

	// Phase 3: convert the catalog into the lean payload the search
	// Worker holds. Worker only needs the item_code + the precomputed
	// `_search_index` string + the item_group for group-filter
	// scoping. Cheap (single allocation per item; no deep clone).
	function toWorkerIndexEntries(list: Item[]): SearchIndexEntry[] {
		const out: SearchIndexEntry[] = [];
		for (const item of list || []) {
			if (!item?.item_code) continue;
			const idx =
				(item as any)._search_index ||
				[item.item_code, item.item_name, (item as any).barcode]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
			out.push({
				code: item.item_code,
				idx,
				group: item.item_group,
			});
		}
		return out;
	}

	const {
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
		refreshModifiedItems: syncRefreshModifiedItems,
		backgroundSyncItems: syncBackgroundSyncItems,
	} = useItemsSync();

	const {
		cachedPagination,
		DEFAULT_PAGE_SIZE,
		LARGE_CATALOG_THRESHOLD,
		resolvePageSize: paginationResolvePageSize,
		resolveLimitSearchSize,
		resetCachedPagination: paginationResetCachedPagination,
		updateCachedPaginationFromStorage,
	} = useItemsPagination();

	const {
		performanceMetrics,
		updatePerformanceMetrics,
		getEstimatedMemoryUsage,
	} = useItemsMetrics();

	// Helpers
	const normalizeBooleanSetting = (value: any): boolean => {
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			return (
				normalized === "1" ||
				normalized === "true" ||
				normalized === "yes"
			);
		}
		if (typeof value === "number") {
			return value === 1;
		}
		return Boolean(value);
	};

	const limitSearchEnabled = computed(() => {
		const rawValue =
			posProfile.value?.posa_use_limit_search ??
			posProfile.value?.pose_use_limit_search;
		return normalizeBooleanSetting(rawValue);
	});

	const resolvePageSize = (pageSize = DEFAULT_PAGE_SIZE): number => {
		return paginationResolvePageSize(
			posProfile.value,
			limitSearchEnabled.value,
			pageSize,
		);
	};

	const resetCachedPagination = (
		options: { enabled?: boolean; total?: number; pageSize?: number } = {},
	) => {
		paginationResetCachedPagination(
			options,
			posProfile.value,
			limitSearchEnabled.value,
		);
	};

	const shouldUseIndexedSearch = () => {
		if (limitSearchEnabled.value) {
			return false;
		}
		return true;
	};

	const shouldPersistItems = () => {
		if (limitSearchEnabled.value) {
			return false;
		}
		return true;
	};

	const getCacheScope = () => {
		const profileName = posProfile.value?.name || "no_profile";
		const warehouse = posProfile.value?.warehouse || "no_warehouse";
		return `${profileName}_${warehouse}`;
	};

	const getStorageScope = () => getCacheScope();

	const setItems = (
		newItems: Item[],
		options: { append?: boolean; totalCount?: number } = {},
	) => {
		const { append = false, totalCount: totalOverride } = options;
		const normalizedGroup =
			typeof itemGroup.value === "string" && itemGroup.value.length > 0
				? itemGroup.value
				: "ALL";

		if (!append) {
			items.value = markRawItems(Array.isArray(newItems) ? newItems : []);
			resetIndexes();
			updateIndexes(items.value, posProfile.value);
			// Phase 3: mirror the index into the search Worker so the
			// flag-gated worker path has matching data when it runs.
			// No-op (cheap) when the flag is off.
			if (isSearchWorkerEnabled()) {
				void setSearchIndex(toWorkerIndexEntries(items.value));
			}
		} else if (Array.isArray(newItems) && newItems.length) {
			const additions: Item[] = [];
			newItems.forEach((item) => {
				if (
					!item ||
					!item.item_code ||
					itemsMap.value.has(item.item_code)
				) {
					return;
				}
				additions.push(markRaw(item));
			});

			if (additions.length) {
				items.value = [...items.value, ...additions];
				updateIndexes(additions, posProfile.value);
				if (isSearchWorkerEnabled()) {
					void patchSearchIndex(toWorkerIndexEntries(additions));
				}
			}
		}

		if (Number.isFinite(totalOverride)) {
			totalItemCount.value = totalOverride!;
		} else if (!append) {
			totalItemCount.value = items.value.length;
		}

		if (!searchTerm.value) {
			filteredItems.value = filterItemsByGroup(
				items.value,
				normalizedGroup,
			);
		}
	};

	// Computed
	const activePriceList = computed(() => {
		return (
			customerPriceList.value ||
			posProfile.value?.selling_price_list ||
			""
		);
	});

	const hasMoreCachedItems = computed(() => {
		if (!cachedPagination.value.enabled) return false;
		if (cachedPagination.value.loading) return true;
		return cachedPagination.value.offset < cachedPagination.value.total;
	});

	const itemStats = computed(() => {
		const groups = new Set<string>();
		let withImages = 0;
		let withStock = 0;
		let lowStock = 0;

		items.value.forEach((item) => {
			if (item.item_group) {
				groups.add(item.item_group);
			}
			if (item.image) {
				withImages += 1;
			}
			const qty = item.actual_qty || 0;
			if (qty > 0) {
				withStock += 1;
			}
			if (qty < 5) {
				lowStock += 1;
			}
		});

		return {
			total: items.value.length,
			filtered: filteredItems.value.length,
			groups: groups.size,
			withImages,
			withStock,
			lowStock,
		};
	});

	const cacheStats = computed(() => {
		const memCache = cache.value.memory;
		return {
			searchCacheSize: memCache.searchResults.size,
			priceListCacheSize: memCache.priceListData.size,
			itemDetailsCacheSize: memCache.itemDetails.size,
			memoryUsage: getEstimatedMemoryUsage(
				items.value.length,
				memCache.searchResults.size,
				memCache.priceListData.size,
			),
		};
	});

	// Actions
	const initialize = async (
		profile: POSProfile,
		cust: string | null = null,
		priceList: string | null = null,
	) => {
		posProfile.value = profile;
		customer.value = cust;
		customerPriceList.value = priceList;

		await loadItemGroups(posProfile.value);
		await assessCacheHealth();
		await loadCachedItems();

		if (!itemsLoaded.value || items.value.length === 0) {
			await loadItems({ forceServer: false });
		}
		itemsLoaded.value = true;
	};

	const loadCachedItems = async () => {
		try {
			if (limitSearchEnabled.value) {
				resetCachedPagination({ enabled: false, total: 0 });
				setItems([], { totalCount: 0 });
				itemsLoaded.value = false;
				syncBootstrapItemReadiness(0);
				return;
			}

			const cachedCount = await getStoredItemsCountByScopeCompat(
				getStorageScope(),
			).catch(() => 0);
			const resolvedCount = Number.isFinite(cachedCount)
				? cachedCount
				: 0;

			totalItemCount.value = resolvedCount;

			if (resolvedCount === 0) {
				itemsLoaded.value = false;
				resetCachedPagination();
				syncBootstrapItemReadiness(0);
				return;
			}

			const shouldPaginate = resolvedCount > LARGE_CATALOG_THRESHOLD;
			resetCachedPagination({
				enabled: shouldPaginate,
				total: resolvedCount,
			});

			if (!shouldPaginate) {
				const cachedItems = await getAllStoredItemsCompat(
					getStorageScope(),
				).catch(() => []);
				if (Array.isArray(cachedItems) && cachedItems.length) {
					setItems(cachedItems, { totalCount: resolvedCount });
					cachedPagination.value.offset = cachedItems.length;
					itemsLoaded.value = true;
					syncBootstrapItemReadiness(resolvedCount);
				}
				return;
			}

			const initialItems = await searchStoredItemsCompat({
				search: "",
				itemGroup: itemGroup.value,
				limit: cachedPagination.value.pageSize,
				offset: 0,
				scope: getStorageScope(),
			});

			const safeInitial = Array.isArray(initialItems) ? initialItems : [];
			setItems(safeInitial, { totalCount: resolvedCount });
			cachedPagination.value.offset = safeInitial.length;
			cachedPagination.value.search = "";
			cachedPagination.value.group =
				typeof itemGroup.value === "string" &&
				itemGroup.value.length > 0
					? itemGroup.value
					: "ALL";
			itemsLoaded.value = true;
			syncBootstrapItemReadiness(resolvedCount);
		} catch (error) {
			console.warn("Failed to load cached items:", error);
			itemsLoaded.value = true;
		}
	};

	const triggerBackgroundSync = (options: any = {}) => {
		if (!shouldPersistItems()) return;
		if (backgroundSyncState.value.running) return;

		syncBackgroundSyncItems(
			options,
			posProfile.value,
			activePriceList.value,
			getStorageScope(),
			shouldPersistItems(),
			resolvePageSize,
			setItems,
			async () => {
				await updateCachedPaginationFromStorage(
					items.value.length,
					totalItemCount,
					posProfile.value,
					shouldUseIndexedSearch(),
					limitSearchEnabled.value,
				);
			},
			totalItemCount,
			itemsLoaded,
			items,
		).catch((error) => {
			console.error("Failed to trigger background sync:", error);
		});
	};

	const loadItems = async (options: LoadItemsOptions = {}) => {
		const startTime = performance.now();
		const currentRequestToken = ++requestToken.value;
		let cacheKey: string | null = null;

		try {
			isLoading.value = true;
			performanceMetrics.value.totalRequests++;

			const {
				forceServer,
				searchValue,
				normalizedGroup,
				priceList,
				effectivePriceList,
				isInitialBootstrapRequest,
				args,
				lean,
			} = buildLoadItemsRequest({
				options,
				posProfile: posProfile.value,
				activePriceList: activePriceList.value,
				customer: customer.value,
				itemCount: items.value.length,
				totalItemCount: totalItemCount.value,
				limitSearchEnabled: limitSearchEnabled.value,
				resolvePageSize,
				resolveLimitSearchSize: () =>
					resolveLimitSearchSize(
						posProfile.value,
						limitSearchEnabled.value,
					),
			});

			cacheKey = generateCacheKey(
				searchValue,
				normalizedGroup,
				priceList,
				getCacheScope(),
			);

			const canReadFromCache = !forceServer && !limitSearchEnabled.value;

			if (canReadFromCache) {
				const cachedResult = await getCachedItems(cacheKey);
				if (cachedResult) {
					setItems(cachedResult);
					itemsLoaded.value = true;
					cachedPagination.value.enabled = false;
					cachedPagination.value.offset = cachedResult.length;
					cachedPagination.value.total = cachedResult.length;
					cachedPagination.value.loading = false;
					if (!searchValue && shouldPersistItems()) {
						const storedCount =
							await getStoredItemsCountByScopeCompat(
								getStorageScope(),
							).catch(() => 0);
						if (!storedCount && cachedResult.length) {
							await persistItemsToStorage(
								cachedResult,
								true,
								true,
								getStorageScope(),
								async () => {
									await updateCachedPaginationFromStorage(
										cachedResult.length,
										totalItemCount,
										posProfile.value,
										shouldUseIndexedSearch(),
										limitSearchEnabled.value,
									);
								},
							);
						}
						if (normalizedGroup === "ALL") {
							syncBootstrapItemReadiness(
								Math.max(
									Number(storedCount || 0),
									cachedResult.length,
								),
							);
						}
					}
					performanceMetrics.value.cachedRequests++;
					updatePerformanceMetrics(startTime);
					return cachedResult;
				}
			}

			const abortController = new AbortController();
			abortControllers.value.set(cacheKey, abortController);

			if (!args || !posProfile.value) {
				console.warn("Attempted to load items without POS Profile");
				return [];
			}

			const fetchedItems = await itemService.getItemsData(
				args,
				abortController.signal,
			);

			if (requestToken.value !== currentRequestToken) {
				return;
			}

			if (lean) {
				// Lean search merges (de-dupe by item_code) into the
				// existing in-memory list — never replaces it. The
				// search-fallback fires once per missing-term and
				// should NOT clobber the catalog the operator has
				// already loaded.
				//
				// Skip the merge entirely when the active price list
				// has changed since the request was dispatched: the
				// items in `fetchedItems` carry prices for the old
				// list, and merging them would surface stale rates
				// in the SPA. The detail cache still gets primed so
				// the next per-item refresh can hit it.
				const currentEffectivePriceList =
					customerPriceList.value ||
					posProfile.value?.selling_price_list ||
					"";
				const priceListStillActive =
					!effectivePriceList ||
					effectivePriceList === currentEffectivePriceList;
				if (
					Array.isArray(fetchedItems) &&
					fetchedItems.length &&
					priceListStillActive
				) {
					const knownCodes = new Set(
						items.value.map((i: any) => i.item_code),
					);
					const additions = fetchedItems
						.filter((it: any) => it && !knownCodes.has(it.item_code))
						.map((it: any) => markRaw(it));
					if (additions.length) {
						items.value = [...items.value, ...additions];
						updateIndexes(additions, posProfile.value);
					}
					primeItemDetailsCache(
						fetchedItems,
						posProfile.value,
						effectivePriceList,
					);
				}
				updatePerformanceMetrics(startTime);
				return fetchedItems;
			}

			cachedPagination.value.enabled = false;
			cachedPagination.value.offset = fetchedItems.length;
			cachedPagination.value.total = fetchedItems.length;
			cachedPagination.value.loading = false;
			setItems(fetchedItems);
			itemsLoaded.value = true;

			const shouldCacheFetchedItems =
				!limitSearchEnabled.value && !isInitialBootstrapRequest;

			if (shouldCacheFetchedItems) {
				await cacheItems(cacheKey, fetchedItems);
			}

			if (!searchValue && shouldPersistItems()) {
				await persistItemsToStorage(
					fetchedItems,
					shouldPersistItems(),
					forceServer,
					getStorageScope(),
					async () => {
						await updateCachedPaginationFromStorage(
							items.value.length,
							totalItemCount,
							posProfile.value,
							shouldUseIndexedSearch(),
							limitSearchEnabled.value,
						);
					},
				);
				if (normalizedGroup === "ALL") {
					const storedCount = await getStoredItemsCountByScopeCompat(
						getStorageScope(),
					).catch(() => fetchedItems.length);
					syncBootstrapItemReadiness(
						Math.max(Number(storedCount || 0), fetchedItems.length),
					);
				}
				triggerBackgroundSync({
					groupFilter: normalizedGroup,
					initialBatch: fetchedItems,
					reset: false,
				});
			} else if (!searchValue && normalizedGroup === "ALL") {
				syncBootstrapItemReadiness(0);
			}

			if (fetchedItems.length > 0) {
				// `get_items` already returns detail-enriched rows. Seed the offline
				// detail cache from that response and keep the visible-item refresh path
				// as the single place that decides whether a live recheck is still needed.
				primeItemDetailsCache(
					fetchedItems,
					posProfile.value,
					effectivePriceList,
				);
			}

			updatePerformanceMetrics(startTime);
			return fetchedItems;
		} catch (error: any) {
			if (error.name !== "AbortError") {
				console.error("Failed to load items:", error);
				throw error;
			}
		} finally {
			isLoading.value = false;
			if (cacheKey) {
				abortControllers.value.delete(cacheKey);
			}
		}
	};

	const clearLimitSearchResults = ({ preserveItems = false } = {}) => {
		if (!limitSearchEnabled.value) {
			return filteredItems.value;
		}

		cancelBackgroundSync();

		searchTerm.value = "";
		lastSearch.value = "";
		cachedPagination.value.enabled = false;
		cachedPagination.value.offset = 0;
		cachedPagination.value.total = 0;
		cachedPagination.value.loading = false;
		cachedPagination.value.search = "";
		cachedPagination.value.group =
			typeof itemGroup.value === "string" && itemGroup.value.length > 0
				? itemGroup.value
				: "ALL";

		clearSearchCache();
		if (preserveItems) {
			filteredItems.value = filterItemsByGroup(
				items.value,
				itemGroup.value,
			);
			return filteredItems.value;
		}

		setItems([], { totalCount: 0 });
		loadProgress.value = 0;
		return filteredItems.value;
	};

	const searchItems = async (term: string) => {
		const previousTerm = searchTerm.value || "";
		const canRefineSearch =
			!shouldUseIndexedSearch() &&
			term &&
			previousTerm.length > 0 &&
			term.length > previousTerm.length &&
			term.toLowerCase().startsWith(previousTerm.toLowerCase()) &&
			filteredItems.value.length > 0 &&
			filteredItems.value.length < items.value.length;

		searchTerm.value = term;
		lastSearch.value = term;

		if (!term || term.length < 2) {
			if (limitSearchEnabled.value) {
				return clearLimitSearchResults({ preserveItems: true });
			}

			if (!cachedPagination.value.enabled) {
				filteredItems.value = filterItemsByGroup(
					items.value,
					itemGroup.value,
				);
			} else {
				cachedPagination.value.search = "";
				cachedPagination.value.offset = Math.min(
					cachedPagination.value.offset,
					items.value.length,
				);
				filteredItems.value = filterItemsByGroup(
					items.value,
					itemGroup.value,
				);
			}
			return filteredItems.value;
		}

		if (limitSearchEnabled.value) {
			try {
				await loadItems({
					searchValue: term,
					groupFilter: itemGroup.value,
					forceServer: true,
				});

				const serverResults = filterItemsByGroup(
					items.value,
					itemGroup.value,
				);
				filteredItems.value = serverResults;
				performanceMetrics.value.searchMisses++;

				return serverResults;
			} catch (error) {
				console.error("Search failed:", error);
				performanceMetrics.value.searchMisses++;
				return [];
			}
		}

		const cacheKey = `search_${getCacheScope()}_${activePriceList.value || "default"}_${term}_${itemGroup.value}`;
		const cached = getCachedSearchResult(cacheKey);
		if (cached) {
			filteredItems.value = cached;
			performanceMetrics.value.searchHits++;
			return cached;
		}

		try {
			const shouldUseIndexed = shouldUseIndexedSearch();
			let searchResults: Item[] = [];

			if (shouldUseIndexed) {
				const normalizedGroup =
					typeof itemGroup.value === "string" &&
					itemGroup.value.length > 0
						? itemGroup.value
						: "ALL";
				const results = await searchStoredItemsCompat({
					search: term,
					itemGroup: normalizedGroup,
					limit: cachedPagination.value.pageSize,
					offset: 0,
					scope: getStorageScope(),
				});

				searchResults = Array.isArray(results) ? results : [];
				cachedPagination.value.search = term;
				cachedPagination.value.offset = searchResults.length;
				cachedPagination.value.total = Math.max(
					cachedPagination.value.total,
					searchResults.length,
				);
			} else {
				const sourceItems = canRefineSearch
					? filteredItems.value
					: items.value;

				// Phase 3: try the search Worker first (flag-gated). The
				// worker returns matching item_codes; map them back via
				// the existing itemsMap so we still hand the caller real
				// Item objects. If the worker is off, not ready, errored,
				// or times out, `searchViaWorker` resolves null and we
				// fall through to the main-thread filter.
				let workerCodes: string[] | null = null;
				if (isSearchWorkerEnabled()) {
					workerCodes = await searchViaWorker(term, itemGroup.value);
				}
				if (Array.isArray(workerCodes)) {
					const lookup = canRefineSearch
						? new Map(
								(sourceItems as Item[]).map(
									(item: Item) => [item.item_code, item] as const,
								),
							)
						: itemsMap.value;
					searchResults = [];
					for (const code of workerCodes) {
						const hit = lookup.get(code);
						if (hit) searchResults.push(hit);
					}
				} else {
					searchResults = performLocalSearch(
						term,
						sourceItems,
						itemGroup.value,
					);
				}

				if (searchResults.length === 0 && term.length >= 3) {
					await loadItems({
						searchValue: term,
						groupFilter: itemGroup.value,
						forceServer: true,
					});
					// Server reload widened items.value; re-run local
					// filter against the fresh set. We deliberately skip
					// the worker here — the worker still holds the old
					// index until the loadItems append above mirrors the
					// delta, and the main-thread filter is fast enough
					// on a freshly hydrated slice.
					searchResults = performLocalSearch(
						term,
						items.value,
						itemGroup.value,
					);
				}

				searchResults = filterItemsByGroup(
					searchResults,
					itemGroup.value,
				);
			}

			setCachedSearchResult(cacheKey, searchResults);

			filteredItems.value = searchResults;
			performanceMetrics.value.searchMisses++;

			if (shouldUseIndexed) {
				updateIndexes(searchResults, posProfile.value);
			}

			return searchResults;
		} catch (error) {
			console.error("Search failed:", error);
			performanceMetrics.value.searchMisses++;
			return [];
		}
	};

	const filterByGroup = async (group: string) => {
		itemGroup.value = group;

		if (searchTerm.value) {
			await searchItems(searchTerm.value);
		} else {
			if (cachedPagination.value.enabled && shouldUseIndexedSearch()) {
				await resetCachedItemsForGroup(group);
			} else {
				filteredItems.value = filterItemsByGroup(items.value, group);
			}
		}
	};

	const appendCachedItemsPage = async () => {
		if (limitSearchEnabled.value) return [];
		if (!cachedPagination.value.enabled || cachedPagination.value.loading)
			return [];
		if (searchTerm.value && searchTerm.value.length >= 2) return [];
		if (cachedPagination.value.offset >= cachedPagination.value.total)
			return [];

		cachedPagination.value.loading = true;

		try {
			const nextPage = await searchStoredItemsCompat({
				search: cachedPagination.value.search || "",
				itemGroup: cachedPagination.value.group,
				limit: cachedPagination.value.pageSize,
				offset: cachedPagination.value.offset,
				scope: getStorageScope(),
			});

			const safePage = Array.isArray(nextPage) ? nextPage : [];

			if (safePage.length === 0) {
				cachedPagination.value.offset = cachedPagination.value.total;
				return [];
			}

			setItems(safePage, {
				append: true,
				totalCount: cachedPagination.value.total,
			});
			cachedPagination.value.offset += safePage.length;

			if (safePage.length < cachedPagination.value.pageSize) {
				cachedPagination.value.offset = cachedPagination.value.total;
			}

			return safePage;
		} catch (error) {
			console.warn("Failed to append cached items:", error);
			return [];
		} finally {
			cachedPagination.value.loading = false;
		}
	};

	const resetCachedItemsForGroup = async (group: string) => {
		if (
			limitSearchEnabled.value ||
			!cachedPagination.value.enabled ||
			!shouldUseIndexedSearch()
		) {
			filteredItems.value = filterItemsByGroup(items.value, group);
			return;
		}

		const normalizedGroup =
			typeof group === "string" && group.length > 0 ? group : "ALL";
		cachedPagination.value.group = normalizedGroup;
		cachedPagination.value.offset = 0;
		cachedPagination.value.search = "";

		const firstPage = await searchStoredItemsCompat({
			search: "",
			itemGroup: normalizedGroup,
			limit: cachedPagination.value.pageSize,
			offset: 0,
			scope: getStorageScope(),
		});

		const safePage = Array.isArray(firstPage) ? firstPage : [];
		setItems(safePage, { totalCount: cachedPagination.value.total });
		cachedPagination.value.offset = safePage.length;
	};

	const updatePriceList = async (newPriceList: string) => {
		if (!newPriceList || newPriceList === customerPriceList.value) return;

		customerPriceList.value = newPriceList;

		try {
			const cacheKey = `price_list_${getCacheScope()}_${newPriceList}`;
			let priceData = getCachedPriceList(cacheKey);

			if (!priceData) {
				priceData = await getCachedPriceListItemsCompat(newPriceList);
				if (priceData && priceData.length > 0) {
					setCachedPriceList(cacheKey, priceData);
				}
			}

			if (priceData && priceData.length > 0) {
				applyPriceListToItems(priceData);
				return;
			}

			// No cached price-list snapshot for this list. Previously we
			// fell back to `loadItems({ forceServer: true })` here, which
			// re-pulled the entire item catalog from the server and froze
			// the UI for 10-60s when the catalog is large + the customer
			// happens to be on a price list the cache has not seen.
			//
			// Drop the eager full reload: the watcher in invoiceWatchers
			// already marks every cart line `_detailSynced = false` and
			// clears the per-item detail/stock caches, so the next render
			// (or the next user interaction with each line) will lazily
			// fetch fresh prices via `useItemDetailFetcher` for just the
			// items the operator actually touches. The catalog list keeps
			// its previous prices on screen for a moment, then converges
			// as detail fetches resolve.
		} catch (error) {
			console.error("Failed to update price list:", error);
		}
	};

	let applyPriceListInflight: number | null = null;
	let applyPriceListGeneration = 0;
	const CHUNK_SIZE = 400;

	const applyPriceListToItems = (priceListItems: any[]) => {
		const _phaseStart =
			typeof performance !== "undefined" && performance.now
				? performance.now()
				: 0;
		const _recordPhase = (label: string, start: number) => {
			if (typeof window === "undefined") return;
			const dur =
				typeof performance !== "undefined" && performance.now
					? performance.now() - start
					: 0;
			const w = window as any;
			w.__pricelistPhases = w.__pricelistPhases || [];
			w.__pricelistPhases.push({ label, dur, at: Date.now() });
			if (w.__pricelistPhases.length > 200)
				w.__pricelistPhases.shift();
			if (dur > 1000) {
				console.warn(
					`[POSA][PriceList] slow phase ${label}: ${Math.round(dur)}ms`,
				);
			}
		};
		// Chunk + yield to the event loop between slices so big
		// catalogs don't block the main thread long enough
		// for Firefox to show the "page slowing down" banner.
		const priceMap = new Map<string, any>();
		priceListItems.forEach((item) => {
			priceMap.set(item.item_code, item);
		});
		_recordPhase("buildPriceMap", _phaseStart);

		// Bump generation. Any in-flight chunk loop captures the
		// previous generation in `myGeneration` and bails on the
		// next iteration when it sees the bump. This prevents the
		// previous price-list's partial mutations from continuing
		// to land after a newer price-list has taken over (which
		// would leave the cart in a mixed-rate state until the
		// next full apply cycle).
		const myGeneration = ++applyPriceListGeneration;

		if (applyPriceListInflight != null) {
			const cancel =
				(window as any).cancelIdleCallback ||
				((id: number) =>
					clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
			cancel(applyPriceListInflight);
			applyPriceListInflight = null;
		}

		const itemsRef = items.value;
		const total = itemsRef.length;
		let cursor = 0;

		const processChunk = () => {
			applyPriceListInflight = null;
			if (myGeneration !== applyPriceListGeneration) {
				return;
			}
			const end = Math.min(cursor + CHUNK_SIZE, total);
			for (let i = cursor; i < end; i++) {
				const item = itemsRef[i];
				if (!item) continue;
				const priceItem = priceMap.get(item.item_code);
				if (!priceItem) continue;
				const nextRate =
					priceItem.price_list_rate || priceItem.rate || 0;
				const nextCurrency =
					priceItem.currency ||
					item.original_currency ||
					item.currency ||
					posProfile.value?.currency;

				item.rate = nextRate;
				item.price_list_rate = nextRate;
				item.original_rate = nextRate;
				item.original_currency = nextCurrency;
				item.currency = nextCurrency;
			}
			cursor = end;
			if (cursor < total) {
				const idle = (window as any).requestIdleCallback as
					| ((cb: () => void, opts?: { timeout?: number }) => number)
					| undefined;
				applyPriceListInflight = idle
					? idle(processChunk, { timeout: 200 })
					: (setTimeout(
							processChunk,
							0,
						) as unknown as number);
				return;
			}
			// Done — items are markRaw, so per-property mutations
			// inside the chunk loop don't fire reactivity. Replace
			// the array reference + clearSearchCache once at the end
			// so virtual scrollers + filteredItems re-evaluate.
			const _finalStart =
				typeof performance !== "undefined" && performance.now
					? performance.now()
					: 0;
			items.value = [...items.value];
			_recordPhase("finalArraySwap", _finalStart);
			const _cacheStart =
				typeof performance !== "undefined" && performance.now
					? performance.now()
					: 0;
			clearSearchCache();
			_recordPhase("clearSearchCache", _cacheStart);
			const _filterStart =
				typeof performance !== "undefined" && performance.now
					? performance.now()
					: 0;
			if (searchTerm.value) {
				filteredItems.value = performLocalSearch(
					searchTerm.value,
					items.value,
					itemGroup.value,
				);
				_recordPhase("performLocalSearch", _filterStart);
			} else {
				filteredItems.value = filterItemsByGroup(
					items.value,
					itemGroup.value,
				);
				_recordPhase("filterItemsByGroup", _filterStart);
			}
			_recordPhase("total", _phaseStart);
		};

		processChunk();
	};

	const refreshItems = async () => {
		await clearAllCaches();
		itemsLoaded.value = false;
		resetCachedPagination();
		await loadItems({ forceServer: true });
	};

	const addScannedItem = async (barcode: string) => {
		let item = getItemByBarcode(barcode);
		if (item) return item;

		try {
			const newItem: any = await itemService.getItemsFromBarcodeData({
				selling_price_list: activePriceList.value,
				currency: posProfile.value?.currency || "",
				barcode: barcode,
			});

			if (newItem) {
				if (
					newItem.scale_qty !== undefined &&
					newItem.scale_qty !== null
				) {
					const parsedQty = parseFloat(newItem.scale_qty);
					if (!Number.isNaN(parsedQty)) {
						newItem._scale_qty = parsedQty;
					}
				}

				if (
					newItem.scale_price !== undefined &&
					newItem.scale_price !== null
				) {
					const parsedPrice = parseFloat(newItem.scale_price);
					if (!Number.isNaN(parsedPrice)) {
						newItem._scale_price = parsedPrice;
					}
				}

				const rawItem = markRaw(newItem);
				items.value = [...items.value, rawItem];
				updateIndexes([rawItem], posProfile.value);

				if (searchTerm.value) {
					await searchItems(searchTerm.value);
				} else {
					filteredItems.value = filterItemsByGroup(
						items.value,
						itemGroup.value,
					);
				}

				clearSearchCache();
				return newItem as Item;
			}
			return null;
		} catch (error) {
			console.error("Failed to fetch item by barcode:", error);
			return null;
		}
	};

	const refreshModifiedItems = async (
		priceListOverride: string | null = null,
	) => {
		if (!itemsLoaded.value) return { size: 0, count: 0, items: [] };
		const resolvedPriceList =
			typeof priceListOverride === "string" &&
			priceListOverride.trim().length > 0
				? priceListOverride.trim()
				: activePriceList.value;

		return await syncRefreshModifiedItems(
			posProfile.value,
			resolvedPriceList,
			customer.value,
			getStorageScope(),
			(updates) => updateItemsInPlace(updates),
			itemsMap.value,
		);
	};

	const updateItemsInPlace = (updates: Item[]) => {
		if (!Array.isArray(updates) || updates.length === 0) {
			return;
		}

		const additions: Item[] = [];
		const touchedItems: Item[] = [];
		const canonicalItemsByCode = new Map<string, Item>();
		items.value.forEach((item) => {
			if (item?.item_code) {
				canonicalItemsByCode.set(item.item_code, item);
			}
		});

		updates.forEach((update) => {
			if (!update?.item_code) {
				return;
			}

			const existing = canonicalItemsByCode.get(update.item_code);
			if (existing) {
				Object.assign(existing, update);
				const syncedRate = update.price_list_rate ?? update.rate;
				if (syncedRate !== undefined && syncedRate !== null) {
					existing.original_rate = syncedRate as any;
				}
				if (update.currency) {
					existing.original_currency = update.currency as any;
				}
				touchedItems.push(existing);
			} else {
				const syncedRate = update.price_list_rate ?? update.rate;
				if (
					syncedRate !== undefined &&
					syncedRate !== null &&
					update.original_rate === undefined
				) {
					(update as any).original_rate = syncedRate;
				}
				if (update.currency && update.original_currency === undefined) {
					(update as any).original_currency = update.currency;
				}
				additions.push(update);
			}
		});

		if (additions.length > 0) {
			const rawAdditions = additions.map((it: any) => markRaw(it));
			items.value = [...items.value, ...rawAdditions];
			updateIndexes(rawAdditions, posProfile.value);
		}

		if (touchedItems.length > 0) {
			// In-place mutations on `markRaw`'d items don't trigger
			// the shallowRef. Replace the array reference so virtual
			// scrollers + computed `filteredItems` re-evaluate.
			items.value = [...items.value];
			updateIndexes(touchedItems, posProfile.value);
		}

		clearSearchCache();
		if (searchTerm.value) {
			filteredItems.value = performLocalSearch(
				searchTerm.value,
				items.value,
				itemGroup.value,
			);
		} else {
			filteredItems.value = filterItemsByGroup(
				items.value,
				itemGroup.value,
			);
		}
	};

	// Watchers
	watch(customerPriceList, (newPriceList) => {
		if (newPriceList && itemsLoaded.value) {
			updatePriceList(newPriceList);
		}
	});

	return {
		// State
		items,
		filteredItems,
		itemsMap,
		barcodeIndex,
		itemGroups,
		isLoading,
		isBackgroundLoading,
		loadProgress,
		syncedItemsCount,
		totalItemCount,
		itemsLoaded,
		searchTerm,
		itemGroup,
		lastSearch,
		posProfile,
		customer,
		customerPriceList,
		cacheHealth,
		performanceMetrics,
		cachedPagination,
		hasMoreCachedItems,

		// Computed
		activePriceList,
		itemStats,
		cacheStats,

		// Actions
		initialize,
		loadItems,
		loadItemGroups,
		loadCachedItems,
		searchItems,
		filterByGroup,
		updatePriceList,
		refreshItems,
		appendCachedItemsPage,
		resetCachedItemsForGroup,
		backgroundSyncItems: triggerBackgroundSync, // mapped
		getItemByCode,
		getItemByBarcode,
		addScannedItem,
		refreshModifiedItems,
		clearLimitSearchResults,
		clearAllCaches,
		clearSearchCache,
		assessCacheHealth,
	};
});

export default useItemsStore;
