import { describe, expect, it } from "vitest";

import { buildVersionPayload, getEntryFileName } from "../build-manifest.js";

describe("build manifest helpers", () => {
	it("hashes every entry filename so deploys cannot reuse stale URLs", () => {
		expect(getEntryFileName({ name: "posawesome" })).toBe("[name]-[hash].js");
		expect(getEntryFileName({ name: "loader" })).toBe("[name]-[hash].js");
		expect(getEntryFileName({ name: "offline/index" })).toBe(
			"[name]-[hash].js",
		);
	});

	it("publishes the actual hashed entry filenames from the rollup bundle", () => {
		const payload = buildVersionPayload("build-2000", {
			"loader-XYZ123.js": {
				type: "chunk",
				name: "loader",
				fileName: "loader-XYZ123.js",
			},
			"posawesome-AAA999.js": {
				type: "chunk",
				name: "posawesome",
				fileName: "posawesome-AAA999.js",
			},
			"offline/index-AbCd1234.js": {
				type: "chunk",
				name: "offline/index",
				fileName: "offline/index-AbCd1234.js",
			},
			"web-entry-WEB456.js": {
				type: "chunk",
				name: "web-entry",
				fileName: "web-entry-WEB456.js",
			},
			"style-Z9Z9.css": {
				type: "asset",
				name: "style.css",
				fileName: "style-Z9Z9.css",
				source: "body{}",
			},
		});

		expect(payload).toEqual({
			version: "build-2000",
			assets: {
				loader: "/assets/posawesome/dist/js/loader-XYZ123.js?v=build-2000",
				posawesome:
					"/assets/posawesome/dist/js/posawesome-AAA999.js?v=build-2000",
				css: "/assets/posawesome/dist/js/style-Z9Z9.css?v=build-2000",
				offlineIndex:
					"/assets/posawesome/dist/js/offline/index-AbCd1234.js",
				web_entry:
					"/assets/posawesome/dist/js/web-entry-WEB456.js?v=build-2000",
				// Only `posawesome` was in the fixture's bundle, so
				// only that chunk shows up in the preload list. The
				// dedicated preload spec below covers ordering +
				// skip-missing semantics.
				web_preload: [
					"/assets/posawesome/dist/js/posawesome-AAA999.js?v=build-2000",
				],
			},
		});
	});

	it("falls back to legacy shell paths + cache-busts when bundle lookup fails", () => {
		const payload = buildVersionPayload("build with spaces", {});

		expect(payload.assets.loader).toBe(
			"/assets/posawesome/dist/js/loader.js?v=build%20with%20spaces",
		);
		expect(payload.assets.posawesome).toBe(
			"/assets/posawesome/dist/js/posawesome.js?v=build%20with%20spaces",
		);
		expect(payload.assets.css).toBe(
			"/assets/posawesome/dist/js/posawesome.css?v=build%20with%20spaces",
		);
		expect(payload.assets.web_entry).toBe(
			"/assets/posawesome/dist/js/web-entry.js?v=build%20with%20spaces",
		);
		// Empty bundle → no preload list (LCP optimisation degrades
		// gracefully when manifest is missing).
		expect(payload.assets.web_preload).toEqual([]);
	});

	it("publishes hashed preload URLs in PRELOAD_CHUNK_NAMES order, skipping missing", () => {
		const payload = buildVersionPayload("v1", {
			"vue-AAA.js":    { type: "chunk", name: "vue",         fileName: "vue-AAA.js" },
			"vendor-BBB.js": { type: "chunk", name: "vendor",      fileName: "vendor-BBB.js" },
			"pinia-CCC.js":  { type: "chunk", name: "pinia",       fileName: "pinia-CCC.js" },
			"api-DDD.js":    { type: "chunk", name: "api",         fileName: "api-DDD.js" },
			"Pos-EEE.js":    { type: "chunk", name: "Pos",         fileName: "Pos-EEE.js" },
			// vue-router intentionally missing — must be skipped silently.
		});
		// Order must match PRELOAD_CHUNK_NAMES: vendor, vue, vue-router,
		// pinia, api, format, db, posawesome, Pos, DefaultLayout,
		// ItemsSelector. Missing names drop without a gap.
		expect(payload.assets.web_preload).toEqual([
			"/assets/posawesome/dist/js/vendor-BBB.js?v=v1",
			"/assets/posawesome/dist/js/vue-AAA.js?v=v1",
			"/assets/posawesome/dist/js/pinia-CCC.js?v=v1",
			"/assets/posawesome/dist/js/api-DDD.js?v=v1",
			"/assets/posawesome/dist/js/Pos-EEE.js?v=v1",
		]);
	});

	it("dedupes preload URLs if two PRELOAD names resolve to the same chunk", () => {
		// Rare but possible: a name might alias to the same fileName in
		// some Rollup configurations. The preload list must not emit
		// duplicate <link> tags (browser would warn).
		const dup = { type: "chunk", name: "vue", fileName: "vue-X.js" };
		const payload = buildVersionPayload("v1", {
			"vue-X.js": dup,
			// Force a second entry with the same fileName but different
			// name to exercise the seen-Set in buildPreloadList.
			"vue-router-X.js": { type: "chunk", name: "vue-router", fileName: "vue-X.js" },
		});
		const list = payload.assets.web_preload;
		expect(new Set(list).size).toBe(list.length);
	});
});
