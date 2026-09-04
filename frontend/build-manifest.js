const DIST_BASE_URL = "/assets/posawesome/dist/js/";

// Every emitted entry is now content-hashed. The Page controller
// (posapp.js) and the Service Worker (sw.js) read the actual hashed
// filenames from version.json's `assets` map at runtime, so the
// browser cannot pin a stale cached `posawesome.js` across deploys.
export function getEntryFileName() {
	return "[name]-[hash].js";
}

function toPublicAssetUrl(fileName) {
	return `${DIST_BASE_URL}${String(fileName || "").replace(/^\/+/, "")}`;
}

function toVersionedPublicAssetUrl(fileName, version) {
	const url = toPublicAssetUrl(fileName);
	return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

function getChunkFileName(bundle, chunkName) {
	const match = Object.values(bundle || {}).find(
		(entry) => entry?.type === "chunk" && entry?.name === chunkName,
	);
	return match?.fileName || null;
}

function getCssAssetFileName(bundle) {
	// `cssCodeSplit: false` emits a single combined stylesheet (Vite
	// names it `style-<hash>.css` by default). Pick the largest CSS
	// asset to be robust to either naming scheme.
	const cssAssets = Object.values(bundle || {}).filter(
		(entry) =>
			entry?.type === "asset" &&
			typeof entry?.fileName === "string" &&
			entry.fileName.endsWith(".css"),
	);
	if (!cssAssets.length) return null;
	cssAssets.sort((a, b) => (b.source?.length || 0) - (a.source?.length || 0));
	return cssAssets[0].fileName;
}

// Critical-path chunks the SPA needs BEFORE it can render its first
// frame. Emitting `<link rel=modulepreload>` for these in posapp.html
// lets the browser fetch them in parallel with the web_entry chunk
// rather than waiting for web_entry's parser to discover the imports.
// LCP win on cold loads measured at ~3-5 s on slow networks.
//
// Names must match Vite's manualChunks() output. Adding a name here
// that doesn't exist is harmless — getChunkFileName returns null and
// the entry is dropped.
const PRELOAD_CHUNK_NAMES = [
	"vendor",        // shared vendor split
	"vuetify",       // UI framework — the LARGEST chunk (531kB/164kB gz);
	                 // was missing here, so it fetched serially only after
	                 // posawesome.js parsed its imports (audit: LCP path)
	"vue",           // vue runtime
	"vue-router",    // router
	"pinia",         // state
	"api",           // API service + envelope + telemetry timing
	"format",        // currency / date helpers used early
	"db",            // IDB layer (offline cache)
	"posawesome",    // main SPA shell
	"Pos",           // first-screen route view
	"DefaultLayout", // shell layout
	"ItemsSelector", // first-screen grid (lazy but immediate)
];

function buildPreloadList(bundle, version) {
	const seen = new Set();
	const out = [];
	for (const name of PRELOAD_CHUNK_NAMES) {
		const f = getChunkFileName(bundle, name);
		if (!f || seen.has(f)) continue;
		seen.add(f);
		out.push(toVersionedPublicAssetUrl(f, version));
	}
	return out;
}

// The service worker precaches these at install (sw.js getPrecacheUrls), so
// EVERY code-split surface is on disk before the network is needed — the Pay
// panel, the offline queue, the connectivity prober. Before this only the
// entry chunks were precached and a lazy chunk the register had not opened
// yet was fetched on first use; offline, that fetch failed and the
// chunk-recovery path reloaded the app mid-sale (live drill 2026-09-04).
// Bare URLs on purpose: Vite's static imports between chunks resolve to the
// un-versioned filename, which is what the fetch handler must match.
function buildChunkList(bundle) {
	const seen = new Set();
	const out = [];
	for (const entry of Object.values(bundle || {})) {
		if (entry?.type !== "chunk" || typeof entry?.fileName !== "string") continue;
		if (!entry.fileName.endsWith(".js") || seen.has(entry.fileName)) continue;
		seen.add(entry.fileName);
		out.push(toPublicAssetUrl(entry.fileName));
	}
	return out.sort();
}

export function buildVersionPayload(version, bundle = {}) {
	const loaderFile = getChunkFileName(bundle, "loader");
	const posawesomeFile = getChunkFileName(bundle, "posawesome");
	const offlineIndexFile = getChunkFileName(bundle, "offline/index");
	const webEntryFile = getChunkFileName(bundle, "web-entry");
	const cssFile = getCssAssetFileName(bundle);

	return {
		version,
		assets: {
			loader: loaderFile
				? toVersionedPublicAssetUrl(loaderFile, version)
				: toVersionedPublicAssetUrl("loader.js", version),
			posawesome: posawesomeFile
				? toVersionedPublicAssetUrl(posawesomeFile, version)
				: toVersionedPublicAssetUrl("posawesome.js", version),
			css: cssFile
				? toVersionedPublicAssetUrl(cssFile, version)
				: toVersionedPublicAssetUrl("posawesome.css", version),
			offlineIndex: offlineIndexFile
				? toPublicAssetUrl(offlineIndexFile)
				: toPublicAssetUrl("offline/index.js"),
			// Web-route entry (Phase 1). Hashed-stable across deploys
			// of the same git SHA, just like every other entry chunk.
			web_entry: webEntryFile
				? toVersionedPublicAssetUrl(webEntryFile, version)
				: toVersionedPublicAssetUrl("web-entry.js", version),
			// Hashed URLs for `<link rel=modulepreload>` in posapp.html.
			// Ordered roughly by criticality so the browser's network
			// scheduler hits the boot-blockers first.
			web_preload: buildPreloadList(bundle, version),
			// Every emitted chunk, for the service worker's install precache.
			chunks: buildChunkList(bundle),
		},
	};
}
