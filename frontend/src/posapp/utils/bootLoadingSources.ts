/**
 * Which bootstrap loading sources a POS route is actually able to complete.
 *
 * `DefaultLayout` opens a **blocking** bootstrap loading scope during `setup()`
 * and only closes it once every registered source reaches 100% (see
 * `posapp/utils/loading.ts`). The layout is keyed by layout name in `App.vue`,
 * so it mounts **once per page load** — the route the SPA boots on decides the
 * source list for the entire lifetime of that document.
 *
 * The historical list was hard-coded to `["init", "items", "customers"]`, but
 * only the `/pos` view mounts `ItemsSelector` (the sole caller of
 * `itemsStore.get_items`) and reliably runs `check_opening_entry()` — the call
 * that registers the POS profile and therefore triggers the customer load.
 * Booting straight into any other route (F5 on `/posapp/barcode`, a bookmark on
 * `/posapp/reports`, …) left `items` and `customers` pinned at 0%, the
 * bootstrap scope open, and the full-screen `LoadingOverlay`
 * (`position: fixed; inset: 0; pointer-events: all`) covering the page forever
 * at `Initializing application... 33%` (1 of 3 sources complete).
 *
 * Resolving the source list from the boot route keeps the promise that the boot
 * pipeline completes on EVERY route: routes that cannot drive the catalog /
 * customer load simply do not wait on it.
 */

export const BOOT_LOADING_SOURCE_INIT = "init";
export const BOOT_LOADING_SOURCE_ITEMS = "items";
export const BOOT_LOADING_SOURCE_CUSTOMERS = "customers";

/**
 * Router bases the SPA can be served under: the Desk page (`/app/posapp`) and
 * the standalone web route (`/posapp`). Longest first so `/app/posapp` wins.
 */
export const POSAPP_ROUTER_BASE_PATHS = ["/app/posapp", "/posapp"] as const;

/**
 * Routes whose mounted view drives the full catalog + customer preload.
 *
 * `/` is included because vue-router redirects it to `/pos`; the redirect can
 * still be in flight when the layout resolves its sources.
 */
const CATALOG_BOOT_ROUTES = new Set(["/", "/pos"]);

const FULL_BOOT_LOADING_SOURCES = [
	BOOT_LOADING_SOURCE_INIT,
	BOOT_LOADING_SOURCE_ITEMS,
	BOOT_LOADING_SOURCE_CUSTOMERS,
];

const MINIMAL_BOOT_LOADING_SOURCES = [BOOT_LOADING_SOURCE_INIT];

type RoutePathInput =
	| string
	| { path?: string | null; fullPath?: string | null }
	| null
	| undefined;

function readRoutePath(input: RoutePathInput): string {
	if (typeof input === "string") {
		return input;
	}

	if (input && typeof input === "object") {
		return input.path || input.fullPath || "";
	}

	return "";
}

/**
 * Reduce any POS URL / route object to its canonical in-router path.
 *
 * Accepts full document paths (`/app/posapp/barcode`, `/posapp/barcode?x=1`)
 * as well as router-relative paths (`/barcode`, `barcode`). Query strings,
 * hashes, trailing slashes and casing are all normalised away.
 */
export function normalizePosAppRoutePath(input: RoutePathInput): string {
	let path = readRoutePath(input).trim();
	if (!path) {
		return "/";
	}

	// Drop hash + query before anything else; `?`/`#` can carry slashes.
	path = path.split("#")[0] || "";
	path = path.split("?")[0] || "";
	if (!path) {
		return "/";
	}

	if (!path.startsWith("/")) {
		path = `/${path}`;
	}

	const lowered = path.toLowerCase();
	for (const base of POSAPP_ROUTER_BASE_PATHS) {
		if (lowered === base) {
			return "/";
		}
		if (lowered.startsWith(`${base}/`)) {
			path = path.slice(base.length);
			break;
		}
	}

	const normalized = path.toLowerCase().replace(/\/+$/, "");
	return normalized || "/";
}

/**
 * Bootstrap loading sources the given boot route can actually complete.
 *
 * Every route reports `init`; only the catalog routes additionally wait on the
 * product catalog and the customer database.
 */
export function resolveBootLoadingSources(input: RoutePathInput): string[] {
	const path = normalizePosAppRoutePath(input);
	return CATALOG_BOOT_ROUTES.has(path)
		? [...FULL_BOOT_LOADING_SOURCES]
		: [...MINIMAL_BOOT_LOADING_SOURCES];
}

/**
 * True when the boot route waits on the catalog/customer preload.
 */
export function routeRequiresCatalogBoot(input: RoutePathInput): boolean {
	return CATALOG_BOOT_ROUTES.has(normalizePosAppRoutePath(input));
}
