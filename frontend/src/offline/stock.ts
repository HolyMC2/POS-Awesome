import { refreshBootstrapSnapshotFromCacheState } from "./cache";
import { memory, persist } from "./db";

type AnyRecord = Record<string, any>;

export async function fetchItemStockQuantities(
	items: AnyRecord[],
	pos_profile: AnyRecord,
	chunkSize = 100,
) {
	const allItems: AnyRecord[] = [];
	try {
		for (let i = 0; i < items.length; i += chunkSize) {
			const chunk = items.slice(i, i + chunkSize);
			const response = await new Promise<AnyRecord[]>(
				(resolve, reject) => {
					frappe.call({
						method: "posawesome.posawesome.api.items.get_items_details",
						args: {
							pos_profile: JSON.stringify(pos_profile),
							items_data: JSON.stringify(chunk),
						},
						freeze: false,
						callback: function (r) {
							if (r.message) {
								resolve(r.message);
							} else {
								reject(new Error("No response from server"));
							}
						},
						error: function (err) {
							reject(err);
						},
					});
				},
			);
			if (response) {
				allItems.push(...response);
			}
		}
		return allItems;
	} catch (error) {
		console.error("Failed to fetch item stock quantities:", error);
		return null;
	}
}

export async function initializeStockCache(
	items: AnyRecord[],
	pos_profile: AnyRecord,
) {
	try {
		const existingCache = memory.local_stock_cache || {};
		const missingItems = Array.isArray(items)
			? items.filter((it) => !existingCache[it.item_code])
			: [];

		if (missingItems.length === 0) {
			if (!memory.stock_cache_ready) {
				setStockCacheReady(true);
			}
			console.debug("Stock cache already initialized");
			console.info(
				"Stock cache initialized with",
				Object.keys(existingCache).length,
				"items",
			);
			return true;
		}

		console.info(
			"Initializing stock cache for",
			missingItems.length,
			"new items",
		);

		const updatedItems = await fetchItemStockQuantities(
			missingItems,
			pos_profile,
		);

		if (updatedItems && updatedItems.length > 0) {
			updatedItems.forEach((item) => {
				if (item.actual_qty !== undefined) {
					existingCache[item.item_code] = {
						actual_qty: item.actual_qty,
						last_updated: new Date().toISOString(),
					};
				}
			});

			memory.local_stock_cache = existingCache;
			persist("local_stock_cache");
			markStockCacheSynced();
			setStockCacheReady(true);
			console.info(
				"Stock cache initialized with",
				Object.keys(existingCache).length,
				"items",
			);
			return true;
		}
		return false;
	} catch (error) {
		console.error("Failed to initialize stock cache:", error);
		return false;
	}
}

// How long a server-fed stock cache stays trustworthy. After this window
// another terminal may have sold the same stock, so offline consumers stop
// treating the cache as "ready" (item fetchers then refuse the local
// fallback instead of silently overselling). Tunable per device without a
// deploy: localStorage.posa_stock_ttl_min = minutes (0 disables the TTL).
const STOCK_CACHE_TTL_MINUTES = 30;

function stockCacheTtlMinutes(): number {
	try {
		const raw = window.localStorage?.getItem("posa_stock_ttl_min");
		if (raw !== null && raw !== undefined && raw !== "") {
			const parsed = Number(raw);
			if (Number.isFinite(parsed) && parsed >= 0) return parsed;
		}
	} catch {
		/* default below */
	}
	return STOCK_CACHE_TTL_MINUTES;
}

export function markStockCacheSynced() {
	memory.stock_cache_synced_at = new Date().toISOString();
	persist("stock_cache_synced_at");
}

export function isStockCacheFresh(): boolean {
	const ttl = stockCacheTtlMinutes();
	if (!ttl) return true; // TTL disabled
	const syncedAt = memory.stock_cache_synced_at;
	if (!syncedAt) return false;
	const age = Date.now() - new Date(syncedAt).getTime();
	return Number.isFinite(age) && age >= 0 && age <= ttl * 60_000;
}

export function isStockCacheReady() {
	return (memory.stock_cache_ready || false) && isStockCacheFresh();
}

export function setStockCacheReady(ready: boolean) {
	memory.stock_cache_ready = ready;
	persist("stock_cache_ready");
	refreshBootstrapSnapshotFromCacheState({
		stockCacheReady: isStockCacheReady(),
	});
}

export function updateLocalStock(items: AnyRecord[]) {
	try {
		const stockCache = memory.local_stock_cache || {};

		items.forEach((item) => {
			const key = item.item_code;

			// Only update if the item already exists in cache
			// Don't create new entries without knowing the actual stock
			if (stockCache[key]) {
				// Reduce quantity by sold amount
				const soldQty = Math.abs(item.qty || 0);
				stockCache[key].actual_qty = Math.max(
					0,
					stockCache[key].actual_qty - soldQty,
				);
				stockCache[key].last_updated = new Date().toISOString();
			}
			// If item doesn't exist in cache, we don't create it
			// because we don't know the actual stock quantity
		});

		memory.local_stock_cache = stockCache;
		persist("local_stock_cache");
	} catch (e) {
		console.error("Failed to update local stock", e);
	}
}

export function getLocalStock(itemCode: string) {
	try {
		const stockCache = memory.local_stock_cache || {};
		return stockCache[itemCode]?.actual_qty || null;
	} catch {
		return null;
	}
}

export function updateLocalStockCache(items: AnyRecord[]) {
	try {
		const stockCache = memory.local_stock_cache || {};

		items.forEach((item) => {
			if (!item || !item.item_code) return;

			if (item.actual_qty !== undefined) {
				stockCache[item.item_code] = {
					actual_qty: item.actual_qty,
					last_updated: new Date().toISOString(),
				};
			}
		});

		memory.local_stock_cache = stockCache;
		persist("local_stock_cache");
		// Server-fed quantities — refresh the whole-cache freshness marker
		// the TTL gate in isStockCacheReady() checks.
		markStockCacheSynced();
	} catch (e) {
		console.error("Failed to refresh local stock cache", e);
	}
}

export function clearLocalStockCache() {
	memory.local_stock_cache = {};
	persist("local_stock_cache");
	setStockCacheReady(false);
}

export function removeLocalStockEntries(itemCodes: string[]) {
	try {
		const normalizedCodes = Array.from(
			new Set(
				(Array.isArray(itemCodes) ? itemCodes : [])
					.map((code) => String(code || "").trim())
					.filter(Boolean),
			),
		);
		if (!normalizedCodes.length) {
			return;
		}
		const stockCache = memory.local_stock_cache || {};
		normalizedCodes.forEach((code) => {
			delete stockCache[code];
		});
		memory.local_stock_cache = stockCache;
		persist("local_stock_cache");
	} catch (e) {
		console.error("Failed to remove local stock entries", e);
	}
}

export function updateLocalStockWithActualQuantities(
	invoiceItems: AnyRecord[],
	serverItems: AnyRecord[],
) {
	try {
		const stockCache = memory.local_stock_cache || {};

		invoiceItems.forEach((invoiceItem) => {
			const key = invoiceItem.item_code;

			// Find corresponding server item with actual quantity
			const serverItem = serverItems.find(
				(item) => item.item_code === invoiceItem.item_code,
			);

			if (serverItem && serverItem.actual_qty !== undefined) {
				// Initialize or update cache with actual server quantity
				if (!stockCache[key]) {
					stockCache[key] = {
						actual_qty: serverItem.actual_qty,
						last_updated: new Date().toISOString(),
					};
				} else {
					// Update with server quantity if it's more recent
					stockCache[key].actual_qty = serverItem.actual_qty;
					stockCache[key].last_updated = new Date().toISOString();
				}

				// Now reduce quantity by sold amount
				const soldQty = Math.abs(invoiceItem.qty || 0);
				stockCache[key].actual_qty = Math.max(
					0,
					stockCache[key].actual_qty - soldQty,
				);
			}
		});

		memory.local_stock_cache = stockCache;
		persist("local_stock_cache");
	} catch (e) {
		console.error("Failed to update local stock with actual quantities", e);
	}
}

export function getLocalStockCache() {
	return memory.local_stock_cache || {};
}

export function setLocalStockCache(cache: AnyRecord) {
	memory.local_stock_cache = cache || {};
	persist("local_stock_cache");
}
