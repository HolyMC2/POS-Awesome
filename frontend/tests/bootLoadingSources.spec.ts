import { describe, expect, it } from "vitest";

import {
	BOOT_LOADING_SOURCE_CUSTOMERS,
	BOOT_LOADING_SOURCE_INIT,
	BOOT_LOADING_SOURCE_ITEMS,
	normalizePosAppRoutePath,
	resolveBootLoadingSources,
	routeRequiresCatalogBoot,
} from "../src/posapp/utils/bootLoadingSources";

describe("boot loading sources", () => {
	it("normalizes Desk, web-route and router-relative paths to the same route", () => {
		expect(normalizePosAppRoutePath("/app/posapp/barcode")).toBe("/barcode");
		expect(normalizePosAppRoutePath("/posapp/barcode")).toBe("/barcode");
		expect(normalizePosAppRoutePath("/barcode")).toBe("/barcode");
		expect(normalizePosAppRoutePath("barcode")).toBe("/barcode");
	});

	it("strips query strings, hashes, trailing slashes and casing", () => {
		expect(normalizePosAppRoutePath("/posapp/barcode/?item=X#zoom")).toBe(
			"/barcode",
		);
		expect(normalizePosAppRoutePath("/app/posapp/POS")).toBe("/pos");
		expect(normalizePosAppRoutePath("/app/posapp/pos/")).toBe("/pos");
	});

	it("treats the bare mount points as the root route", () => {
		expect(normalizePosAppRoutePath("/app/posapp")).toBe("/");
		expect(normalizePosAppRoutePath("/posapp")).toBe("/");
		expect(normalizePosAppRoutePath("/posapp/")).toBe("/");
		expect(normalizePosAppRoutePath("")).toBe("/");
		expect(normalizePosAppRoutePath(null)).toBe("/");
	});

	it("accepts a vue-router route object", () => {
		expect(normalizePosAppRoutePath({ path: "/barcode" })).toBe("/barcode");
		expect(
			normalizePosAppRoutePath({ fullPath: "/reports?range=today" }),
		).toBe("/reports");
	});

	it("waits on the catalog + customer preload only on the POS route", () => {
		expect(resolveBootLoadingSources("/app/posapp/pos")).toEqual([
			BOOT_LOADING_SOURCE_INIT,
			BOOT_LOADING_SOURCE_ITEMS,
			BOOT_LOADING_SOURCE_CUSTOMERS,
		]);
		expect(resolveBootLoadingSources("/app/posapp")).toEqual([
			BOOT_LOADING_SOURCE_INIT,
			BOOT_LOADING_SOURCE_ITEMS,
			BOOT_LOADING_SOURCE_CUSTOMERS,
		]);
		expect(routeRequiresCatalogBoot("/posapp/pos")).toBe(true);
	});

	it("only waits on init for routes that never mount ItemsSelector", () => {
		for (const path of [
			"/app/posapp/barcode",
			"/posapp/barcode",
			"/posapp/reports",
			"/posapp/dashboard",
			"/posapp/orders",
			"/posapp/gift-cards",
			"/posapp/cash-movement",
			"/posapp/closing",
			"/posapp/payments",
			"/posapp/offline-route-unavailable",
		]) {
			expect(resolveBootLoadingSources(path)).toEqual([
				BOOT_LOADING_SOURCE_INIT,
			]);
			expect(routeRequiresCatalogBoot(path)).toBe(false);
		}
	});

	it("returns a fresh array so callers cannot mutate the shared list", () => {
		const first = resolveBootLoadingSources("/pos");
		first.push("mutated");
		expect(resolveBootLoadingSources("/pos")).toEqual([
			BOOT_LOADING_SOURCE_INIT,
			BOOT_LOADING_SOURCE_ITEMS,
			BOOT_LOADING_SOURCE_CUSTOMERS,
		]);
	});
});
