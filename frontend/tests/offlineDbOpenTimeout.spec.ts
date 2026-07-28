// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	OFFLINE_DB_OPEN_TIMEOUT_MS,
	OfflineDbOpenTimeoutError,
	hydrateMemoryFromLocalStorage,
	initPromise,
	isOfflineStorageDegraded,
	memory,
	openWithTimeout,
	setOfflineStorageDegraded,
} from "../src/offline/db";

describe("offline DB open timeout", () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await initPromise;
		setOfflineStorageDegraded(false);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		setOfflineStorageDegraded(false);
	});

	it("resolves with the opened database when the open settles in time", async () => {
		const open = vi.fn().mockResolvedValue("opened");

		await expect(openWithTimeout(open, 50)).resolves.toBe("opened");
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("rejects with OfflineDbOpenTimeoutError when the open never settles", async () => {
		vi.useFakeTimers();

		// A `blocked` IndexedDB open neither resolves nor rejects — it just
		// waits for the other connection to close. That is the tab-scoped hang
		// this guard exists for.
		const pending = openWithTimeout(() => new Promise<never>(() => {}), 100);
		const assertion = expect(pending).rejects.toBeInstanceOf(
			OfflineDbOpenTimeoutError,
		);

		await vi.advanceTimersByTimeAsync(150);
		await assertion;
	});

	it("reports the configured window on the timeout error", async () => {
		vi.useFakeTimers();

		const pending = openWithTimeout(() => new Promise<never>(() => {}), 75);
		const assertion = expect(pending).rejects.toMatchObject({
			name: "OfflineDbOpenTimeoutError",
			timeoutMs: 75,
		});

		await vi.advanceTimersByTimeAsync(120);
		await assertion;
	});

	it("propagates a genuine open failure untouched", async () => {
		const failure = new Error("VersionError");

		await expect(
			openWithTimeout(() => Promise.reject(failure), 50),
		).rejects.toBe(failure);
	});

	it("clears its timer so a fast open cannot fire the timeout later", async () => {
		vi.useFakeTimers();
		const clearSpy = vi.spyOn(globalThis, "clearTimeout");

		const result = await openWithTimeout(async () => "fast", 100);
		expect(result).toBe("fast");
		expect(clearSpy).toHaveBeenCalled();

		// Nothing pending: advancing past the window must not throw.
		await vi.advanceTimersByTimeAsync(500);
	});

	it("ships a bounded default window", () => {
		expect(OFFLINE_DB_OPEN_TIMEOUT_MS).toBeGreaterThan(0);
		expect(OFFLINE_DB_OPEN_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
	});

	it("tracks the degraded storage flag for Limited mode", () => {
		expect(isOfflineStorageDegraded()).toBe(false);
		setOfflineStorageDegraded(true);
		expect(isOfflineStorageDegraded()).toBe(true);
	});

	it("hydrates the localStorage mirror when IndexedDB is unavailable", () => {
		localStorage.setItem("posa_manual_offline", JSON.stringify(true));
		localStorage.setItem("posa_stock_cache_ready", JSON.stringify(true));
		memory.manual_offline = false;
		memory.stock_cache_ready = false;

		hydrateMemoryFromLocalStorage();

		expect(memory.manual_offline).toBe(true);
		expect(memory.stock_cache_ready).toBe(true);

		localStorage.removeItem("posa_manual_offline");
		localStorage.removeItem("posa_stock_cache_ready");
		memory.manual_offline = false;
		memory.stock_cache_ready = false;
	});

	it("keeps defaults when the localStorage mirror is corrupt", () => {
		localStorage.setItem("posa_manual_offline", "{not-json");
		memory.manual_offline = false;

		hydrateMemoryFromLocalStorage();

		expect(memory.manual_offline).toBe(false);
		localStorage.removeItem("posa_manual_offline");
	});
});
