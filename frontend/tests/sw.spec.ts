// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 1.G — Service worker precache for the /posapp web route.
 *
 * sw.js is a classic (non-module) service worker, so it cannot use ES
 * exports. Instead of refactoring the file for testability, we evaluate
 * its source in a `vm` sandbox with a minimal mock of the service-worker
 * globals (self, caches, fetch, URL, Response). The handlers it
 * registers via `self.addEventListener` get captured into a map we can
 * fire synthetic FetchEvents at.
 *
 * This mirrors the approach the chunk-load / bundle-version specs use
 * to drive sw-updater under jsdom; here we just bring the harness into
 * the test file itself because sw.js has no module surface.
 */

const SW_PATH = resolve(__dirname, "../../posawesome/www/sw.js");
const SW_SOURCE = readFileSync(SW_PATH, "utf8");

type Listener = (event: any) => any;

interface SwHarness {
	context: vm.Context;
	listeners: Map<string, Listener[]>;
	cache: Map<string, Response>;
	caches: {
		open: ReturnType<typeof vi.fn>;
		keys: ReturnType<typeof vi.fn>;
		match: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
	};
	fetchMock: ReturnType<typeof vi.fn>;
	getPrecacheUrls: (version?: string, assets?: Record<string, string>) => string[];
	isPosappWebRouteRequest: (url: URL) => boolean;
}

function makeResponse(body: string, init: ResponseInit = {}) {
	const status = init.status ?? 200;
	const ok = status >= 200 && status < 300;
	return {
		ok,
		status,
		type: "basic" as const,
		clone() {
			return makeResponse(body, init);
		},
		async text() {
			return body;
		},
		async json() {
			return JSON.parse(body);
		},
	} as unknown as Response;
}

function loadServiceWorker(): SwHarness {
	const listeners = new Map<string, Listener[]>();
	const cache = new Map<string, Response>();

	const cacheApi = {
		put: vi.fn(async (req: Request | string, res: Response) => {
			const key = typeof req === "string" ? req : (req as any).url;
			cache.set(key, res);
		}),
		match: vi.fn(async (req: Request | string) => {
			const key = typeof req === "string" ? req : (req as any).url;
			return cache.get(key) || undefined;
		}),
		keys: vi.fn(async () =>
			Array.from(cache.keys()).map((url) => ({ url })),
		),
		delete: vi.fn(async (req: Request | string) => {
			const key = typeof req === "string" ? req : (req as any).url;
			return cache.delete(key);
		}),
	};

	const cachesApi = {
		open: vi.fn(async (_name: string) => cacheApi),
		keys: vi.fn(async () => [] as string[]),
		match: vi.fn(async (req: Request | string) => {
			const key = typeof req === "string" ? req : (req as any).url;
			return cache.get(key) || undefined;
		}),
		delete: vi.fn(async (_name: string) => true),
	};

	const selfObj: any = {
		addEventListener(type: string, listener: Listener) {
			const list = listeners.get(type) || [];
			list.push(listener);
			listeners.set(type, list);
		},
		skipWaiting: vi.fn(async () => undefined),
		clients: {
			claim: vi.fn(async () => undefined),
			matchAll: vi.fn(async () => []),
		},
		registration: {
			unregister: vi.fn(async () => true),
		},
	};

	// Default fetch returns an empty version.json-shaped payload so the
	// SW's resolveBuildMetadata() never blows up parsing JSON in tests
	// that don't care about that path. Individual tests override via
	// mockImplementationOnce.
	const fetchMock = vi.fn(async (_url: string) =>
		makeResponse(JSON.stringify({ version: "test", assets: {} })),
	);

	const context: any = {
		self: selfObj,
		caches: cachesApi,
		fetch: fetchMock,
		URL,
		Response: {
			error: () => makeResponse("", { status: 500 }),
		},
		console,
		Promise,
		setTimeout,
		clearTimeout,
		// vm sandbox requires explicit globals
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(SW_SOURCE, context, { filename: SW_PATH });

	// Pull the pure helpers back out for direct assertions. They are
	// declared with `function ...` at top level of sw.js so they end up
	// as properties on the sandbox global.
	const getPrecacheUrls = context.getPrecacheUrls as SwHarness["getPrecacheUrls"];
	const isPosappWebRouteRequest = context.isPosappWebRouteRequest as SwHarness["isPosappWebRouteRequest"];

	return {
		context,
		listeners,
		cache,
		caches: cachesApi as any,
		fetchMock,
		getPrecacheUrls,
		isPosappWebRouteRequest,
	};
}

function fireFetch(harness: SwHarness, request: any) {
	const handlers = harness.listeners.get("fetch") || [];
	let responded: Promise<Response> | null = null;
	const event = {
		request,
		respondWith(p: Promise<Response>) {
			responded = p;
		},
		waitUntil(_p: Promise<unknown>) {},
	};
	for (const h of handlers) {
		h(event);
	}
	return responded;
}

describe("posawesome service worker — Phase 1.G precache", () => {
	let harness: SwHarness;

	beforeEach(() => {
		harness = loadServiceWorker();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("includes the /posapp web route and Frappe jQuery in the precache list", () => {
		const urls = harness.getPrecacheUrls("build-1234", {});
		expect(urls).toContain("/posapp");
		expect(urls).toContain("/assets/frappe/js/lib/jquery/jquery.min.js");
		// Legacy Desk shell precache is still present so /app/posapp
		// continues to work offline for users on the old route.
		expect(urls).toContain("/app/posapp");
	});

	it("publishes the hashed web_entry chunk when version.json supplies it", () => {
		const urls = harness.getPrecacheUrls("build-1234", {
			web_entry: "/assets/posawesome/dist/js/web-entry-ABC123.js?v=build-1234",
		});
		expect(urls).toContain(
			"/assets/posawesome/dist/js/web-entry-ABC123.js?v=build-1234",
		);
	});

	it("falls back to the un-hashed web-entry path when version.json is missing it", () => {
		const urls = harness.getPrecacheUrls("build-1234", {});
		expect(urls).toContain(
			"/assets/posawesome/dist/js/web-entry.js?v=build-1234",
		);
	});

	it("recognises /posapp deep links as web-route navigations", () => {
		expect(
			harness.isPosappWebRouteRequest(new URL("https://x.test/posapp")),
		).toBe(true);
		expect(
			harness.isPosappWebRouteRequest(new URL("https://x.test/posapp/pay")),
		).toBe(true);
		expect(
			harness.isPosappWebRouteRequest(new URL("https://x.test/posapp/items/123")),
		).toBe(true);
		expect(
			harness.isPosappWebRouteRequest(new URL("https://x.test/app/posapp")),
		).toBe(false);
		expect(
			harness.isPosappWebRouteRequest(new URL("https://x.test/posapp-other")),
		).toBe(false);
	});

	it("does not intercept mutable Frappe file images", () => {
		const request = {
			url: "https://x.test/files/item-photo.jpg",
			method: "GET",
			mode: "cors",
			destination: "image",
		};

		expect(fireFetch(harness, request)).toBeNull();
		expect(harness.fetchMock).not.toHaveBeenCalled();
	});

	it("refreshes the cached /posapp HTML shell after a successful navigation fetch", async () => {
		const liveShell = makeResponse("<html>live shell</html>");
		harness.fetchMock.mockImplementationOnce(async () => liveShell);

		const request = {
			url: "https://x.test/posapp",
			method: "GET",
			mode: "navigate",
			destination: "document",
		};
		const promise = fireFetch(harness, request);
		expect(promise).not.toBeNull();
		const result = await promise!;
		expect(result).toBe(liveShell);
		// Shell is cached under the bare /posapp key so deep-link
		// reloads (vue-router pushes under /posapp/...) all resolve
		// to the same cached document offline.
		const cached = await (harness.caches.match as any)("/posapp");
		expect(cached).toBeDefined();
		expect(await cached.text()).toBe("<html>live shell</html>");
	});

	it("serves the cached /posapp shell for deep links when offline", async () => {
		harness.cache.set("/posapp", makeResponse("<html>cached shell</html>"));
		harness.fetchMock.mockImplementationOnce(async () => {
			throw new Error("offline");
		});

		const request = {
			url: "https://x.test/posapp/pay",
			method: "GET",
			mode: "navigate",
			destination: "document",
		};
		const promise = fireFetch(harness, request);
		expect(promise).not.toBeNull();
		const result = await promise!;
		expect(await result.text()).toBe("<html>cached shell</html>");
	});

	it("does NOT poison /posapp cache with deep-link responses", async () => {
		const deepResp = makeResponse("<html>pay route shell</html>");
		harness.fetchMock.mockImplementationOnce(async () => deepResp);

		const request = {
			url: "https://x.test/posapp/pay",
			method: "GET",
			mode: "navigate",
			destination: "document",
		};
		await fireFetch(harness, request);
		// Cache key is always the bare /posapp — deep links share it.
		expect(harness.cache.get("/posapp")).toBeDefined();
		expect(await harness.cache.get("/posapp")!.text()).toBe(
			"<html>pay route shell</html>",
		);
		expect(harness.cache.has("/posapp/pay")).toBe(false);
	});
});
