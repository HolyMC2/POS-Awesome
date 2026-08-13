const CACHE_PREFIX = "posawesome-cache-";
const VERSION_URL = "/assets/posawesome/dist/js/version.json";
const DEFAULT_CACHE_VERSION = "default";
const MAX_CACHE_ITEMS = 1000;

// HTML shell for the web-route SPA mount (Phase 1). The Vue
// router uses /posapp as its base, so any deep-link beneath that
// (e.g. /posapp/pay) must resolve back to this same shell when
// offline. The navigation handler matches by pathname and falls
// back to the cached /posapp entry below.
const POSAPP_WEB_ROUTE = "/posapp";

const STATIC_PRECACHE_URLS = [
	"/app/posapp",
	POSAPP_WEB_ROUTE,
	"/assets/posawesome/dist/js/posapp/workers/itemWorker.js",
	"/assets/posawesome/dist/js/libs/dexie.min.js",
	// Frappe-bundled jQuery is loaded synchronously by posapp.html
	// (the SPA bundle calls `$()` at top-level assuming Desk
	// provides it). Without precaching, a cold offline reload of
	// /posapp blocks on a network 404 and the SPA never boots.
	"/assets/frappe/js/lib/jquery/jquery.min.js",
	"/manifest.json",
	"/offline.html",
];

function buildVersionedAssetUrl(url, version) {
	return `${url}?v=${encodeURIComponent(version || DEFAULT_CACHE_VERSION)}`;
}

function pickAssetUrl(assets, key, fallbackPath, version) {
	// Entries are now content-hashed at build time (see
	// build-manifest.js). The hashed filename is published in
	// version.json -> assets[key]; fall back to the legacy un-hashed
	// path for transitional rollouts where an old version.json is
	// still being served.
	const value = typeof assets?.[key] === "string" ? assets[key].trim() : "";
	if (value) {
		return value;
	}
	return buildVersionedAssetUrl(fallbackPath, version);
}

function getPrecacheUrls(version, assets = {}) {
	return [
		pickAssetUrl(assets, "loader", "/assets/posawesome/dist/js/loader.js", version),
		pickAssetUrl(assets, "css", "/assets/posawesome/dist/js/posawesome.css", version),
		pickAssetUrl(assets, "posawesome", "/assets/posawesome/dist/js/posawesome.js", version),
		pickAssetUrl(assets, "offlineIndex", "/assets/posawesome/dist/js/offline/index.js", version),
		// `web_entry` is the SPA's entry chunk for the /posapp web
		// route (Phase 1). Hashed filename comes from version.json
		// just like the other entry chunks.
		pickAssetUrl(assets, "web_entry", "/assets/posawesome/dist/js/web-entry.js", version),
		...STATIC_PRECACHE_URLS,
	];
}

function isPosappWebRouteRequest(url) {
	// Vue router uses /posapp as base, so /posapp/<anything> deep
	// links must all hit the same cached shell offline.
	const pathname = url && url.pathname ? url.pathname : "";
	return pathname === POSAPP_WEB_ROUTE || pathname.startsWith(`${POSAPP_WEB_ROUTE}/`);
}

let cachedCacheName = null;
let cacheNameInFlight = null;
let currentVersion = null;
let currentAssets = {};

async function precacheUrls(cacheName, version, assets = {}) {
	const cache = await caches.open(cacheName);
	await Promise.all(
		getPrecacheUrls(version, assets).map(async (url) => {
			try {
				const resp = await fetch(url);
				if (resp && resp.ok) {
					await cache.put(url, resp.clone());
				}
			} catch (err) {
				console.warn("SW install failed to fetch", url, err);
			}
		}),
	);
	await enforceCacheLimit(cache);
	return cache;
}

async function cleanupObsoleteCaches(activeCacheName) {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith(CACHE_PREFIX) && key !== activeCacheName)
			.map((key) => caches.delete(key)),
	);
}

function postVersionMessage(target) {
	if (!currentVersion) return;
	const message = {
		type: "SW_VERSION_INFO",
		version: currentVersion,
		timestamp: Number(currentVersion),
	};
	if (target && typeof target.postMessage === "function") {
		target.postMessage(message);
	}
}

function extractBuildVersion(payload) {
	const version = payload?.version || payload?.buildVersion;
	return typeof version === "string" && version.trim().length ? version.trim() : DEFAULT_CACHE_VERSION;
}

function extractBuildAssets(payload) {
	return payload?.assets && typeof payload.assets === "object" ? payload.assets : {};
}

// Listen for version check messages
self.addEventListener("message", (event) => {
	const payload = event.data || {};
	if (payload.type === "CHECK_VERSION") {
		if (event.ports && event.ports[0]) {
			postVersionMessage(event.ports[0]);
		} else if (event.source) {
			postVersionMessage(event.source);
		}
		return;
	}
	if (payload.type === "SKIP_WAITING") {
		self.skipWaiting();
		return;
	}
	if (payload.type === "REFRESH_CACHE_VERSION") {
		const target = (event.ports && event.ports[0]) || event.source || null;
		const task = refreshCacheVersion(target);
		if (typeof event.waitUntil === "function") {
			event.waitUntil(task);
		}
		return;
	}
	if (payload.type === "CLIENT_FORCE_UNREGISTER") {
		const task = forceUnregisterServiceWorker();
		if (typeof event.waitUntil === "function") {
			event.waitUntil(task);
		}
	}
});

async function resolveBuildMetadata(forceRefresh = false) {
	if (forceRefresh) {
		currentVersion = null;
		currentAssets = {};
	}
	try {
		const response = await fetch(VERSION_URL, { cache: "no-store" });
		if (response && response.ok) {
			const payload = await response.json();
			currentVersion = extractBuildVersion(payload);
			currentAssets = extractBuildAssets(payload);
			return {
				version: currentVersion,
				assets: currentAssets,
			};
		}
	} catch (err) {
		console.warn("SW: failed to fetch build version", err);
	}
	return {
		version: DEFAULT_CACHE_VERSION,
		assets: currentAssets || {},
	};
}

async function getCacheName(forceRefresh = false, resolvedMetadata = null) {
	if (forceRefresh) {
		cachedCacheName = null;
		cacheNameInFlight = null;
	}
	if (cachedCacheName) {
		return cachedCacheName;
	}
	if (cacheNameInFlight) {
		return cacheNameInFlight;
	}
	cacheNameInFlight = (async () => {
		const metadata = resolvedMetadata || (await resolveBuildMetadata(forceRefresh));
		const version = metadata?.version || DEFAULT_CACHE_VERSION;
		const name = `${CACHE_PREFIX}${version}`;
		if (version !== DEFAULT_CACHE_VERSION) {
			cachedCacheName = name;
		}
		cacheNameInFlight = null;
		return name;
	})();
	return cacheNameInFlight;
}

async function enforceCacheLimit(cache) {
	const keys = await cache.keys();
	if (keys.length <= MAX_CACHE_ITEMS) {
		return;
	}
	let excess = keys.length - MAX_CACHE_ITEMS;
	// Evict oldest-first but NEVER the install-time precache (the boot shell +
	// entry chunks). The old FIFO evicted keys[0..] blindly, so a long shift of
	// runtime-cached assets pushed the precache out and broke offline cold-boot.
	const protectedUrls = new Set(
		getPrecacheUrls(currentVersion, currentAssets).map(
			(url) => new URL(url, self.location.origin).href,
		),
	);
	for (const request of keys) {
		if (excess <= 0) {
			break;
		}
		if (protectedUrls.has(request.url)) {
			continue;
		}
		await cache.delete(request);
		excess -= 1;
	}
}

async function refreshCacheVersion(target) {
	const metadata = await resolveBuildMetadata(true);
	const activeCacheName = await getCacheName(true, metadata);
	await precacheUrls(activeCacheName, metadata.version, metadata.assets);
	await cleanupObsoleteCaches(activeCacheName);
	postVersionMessage(target);
	const clients = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	clients.forEach(postVersionMessage);
	return activeCacheName;
}

async function forceUnregisterServiceWorker() {
	cachedCacheName = null;
	cacheNameInFlight = null;
	currentVersion = null;
	currentAssets = {};
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith(CACHE_PREFIX))
			.map((key) => caches.delete(key)),
	);
	await self.registration.unregister();
}

self.addEventListener("install", (event) => {
	self.skipWaiting();
	event.waitUntil(
		(async () => {
			const metadata = await resolveBuildMetadata();
			const cacheName = await getCacheName(false, metadata);
			await precacheUrls(cacheName, metadata.version, metadata.assets);
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const metadata = await resolveBuildMetadata();
			const activeCacheName = await getCacheName(false, metadata);
			await precacheUrls(activeCacheName, metadata.version, metadata.assets);
			await cleanupObsoleteCaches(activeCacheName);
			const cache = await caches.open(activeCacheName);
			await enforceCacheLimit(cache);
			await self.clients.claim();
			const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			clients.forEach(postVersionMessage);
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const url = new URL(event.request.url);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;

	if (event.request.url.includes("socket.io")) return;

	// Never cache the version manifest. It is fetched fresh (no-store) with a
	// unique `?t=<ts>` per call, so each fetch minted a new cache entry — those
	// accreted past MAX_CACHE_ITEMS and evicted the precache. Let it pass
	// straight to the network.
	if (url.pathname === VERSION_URL) return;

	// Recurring "broken font" pathology: SW caches the hashed CSS
	// chunk, which embeds absolute `url(/assets/.../<hash>.woff2)`
	// references to fonts. Old caches deleted on activate, but the
	// browser may already be reading old CSS from its own memory or
	// disk cache, asking for font hashes that no longer exist on
	// disk → CSS @font-face fails → Vuetify/Roboto/MDI glyphs fall
	// back to system fonts (tofu icons + chunky text).
	//
	// Fix: don't intercept font requests. Fonts are content-hashed,
	// so URL collisions are impossible; the browser's HTTP cache
	// (Cache-Control: max-age + Etag from Frappe) keeps them warm
	// without our SW being able to wedge stale entries.
	if (event.request.destination === "font") return;
	const isFontByPath = /\.(woff2?|ttf|eot|otf)(\?|$)/i.test(url.pathname);
	if (isFontByPath) return;

	// Item photos and other uploaded files are mutable URLs owned by Frappe,
	// not versioned POS assets. Intercepting `/files/*` caused a stale worker to
	// return broken item pictures on /posapp. Leave them to the network/browser
	// cache while preserving the service worker that makes the POS shell and
	// content-hashed application assets available during backend restarts.
	if (url.pathname.startsWith("/files/")) return;

	const assetDestinations = ["style", "script", "worker", "image"];
	const isAssetRequest = assetDestinations.includes(event.request.destination);
	const isPosawesomeAsset = url.pathname.startsWith("/assets/posawesome/");
	const isNavigation = event.request.mode === "navigate";

	if (!isNavigation && !isAssetRequest && !isPosawesomeAsset) {
		return;
	}

	if (isNavigation) {
		const isPosappWebRoute = isPosappWebRouteRequest(url);
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(event.request);
					// Stale-while-revalidate the /posapp HTML shell.
					// The boot payload is seeded server-side, so the
					// shell MUST be re-fetched while online; we only
					// keep the cached copy as an offline fallback.
					if (isPosappWebRoute && response && response.ok) {
						try {
							const cacheName = await getCacheName();
							const cache = await caches.open(cacheName);
							// Always store under the bare /posapp key so
							// deep-link reloads (vue-router pushes under
							// /posapp/<sub>) all resolve to the same shell
							// offline.
							await cache.put(POSAPP_WEB_ROUTE, response.clone());
						} catch (cacheError) {
							console.warn("SW posapp shell cache put failed", cacheError);
						}
					}
					return response;
				} catch (err) {
					// Offline path. Order: exact URL → /posapp shell
					// (covers deep links) → /app/posapp Desk shell →
					// /offline.html → network error.
					const cached = await caches.match(event.request, { ignoreSearch: true });
					if (cached) {
						return cached;
					}

					if (isPosappWebRoute) {
						const posappShell = await caches.match(POSAPP_WEB_ROUTE);
						if (posappShell) {
							return posappShell;
						}
					}

					const appShell = await caches.match("/app/posapp");
					if (appShell) {
						return appShell;
					}

					const offlinePage = await caches.match("/offline.html");
					if (offlinePage) {
						return offlinePage;
					}

					return Response.error();
				}
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			const cacheName = await getCacheName();
			const hasVersionQuery = url.searchParams.has("v");
			try {
				const response = await fetch(event.request);
				const cacheableTypes = ["basic", "default", "cors"];
				if (
					response &&
					response.ok &&
					response.status === 200 &&
					cacheableTypes.includes(response.type)
				) {
					try {
						const cache = await caches.open(cacheName);
						await cache.put(event.request, response.clone());
						await enforceCacheLimit(cache);
					} catch (cacheError) {
						console.warn("SW cache put failed", cacheError);
					}
				}
				return response;
			} catch (networkError) {
				const cached = await caches.match(event.request);
				if (cached) {
					return cached;
				}

				if (!hasVersionQuery) {
					const fallback = await caches.match(event.request, {
						ignoreSearch: true,
					});
					if (fallback) {
						return fallback;
					}
				}
				return Response.error();
			}
		})(),
	);
});
