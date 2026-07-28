// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `posapp/utils/loading.ts` resolves its source messages through the Frappe
// `__()` global at module-evaluation time, so the stub has to exist before the
// static import runs.
vi.hoisted(() => {
	(globalThis as any).__ = (value: string) => value;
});

import {
	BOOT_LOADING_STALL_TIMEOUT_MS,
	getLoadingStatus,
	initLoadingSources,
	loadingState,
	markSourceLoaded,
	resetLoadingState,
	setBootLoadingStallTimeout,
	setSourceProgress,
} from "../src/posapp/utils/loading";
import { resolveBootLoadingSources } from "../src/posapp/utils/bootLoadingSources";

const STALL_MS = 200;

describe("bootstrap loading completes on every route", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetLoadingState();
		setBootLoadingStallTimeout(STALL_MS);
	});

	afterEach(() => {
		resetLoadingState();
		setBootLoadingStallTimeout();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reproduces the historical 33% deadlock when a subroute registers catalog sources", async () => {
		// The pre-fix hard-coded list. On /barcode nothing ever mounts
		// ItemsSelector, so `items` and `customers` stay at 0 forever.
		initLoadingSources(["init", "items", "customers"]);
		markSourceLoaded("init");

		// Watchdog disarmed for this assertion: prove the deadlock, not the cure.
		const status = getLoadingStatus();
		expect(status.sources).toEqual({ init: 100, items: 0, customers: 0 });
		expect(Math.round(status.completedSum / status.sourceCount)).toBe(33);
		expect(status.isCompleting).toBe(false);
		expect(loadingState.active).toBe(true);
	});

	it("finishes boot on a subroute because only init is registered", async () => {
		initLoadingSources(resolveBootLoadingSources("/app/posapp/barcode"));
		expect(getLoadingStatus().sources).toEqual({ init: 0 });

		markSourceLoaded("init");

		expect(getLoadingStatus().isCompleting).toBe(true);
		expect(loadingState.progress).toBe(100);

		await vi.advanceTimersByTimeAsync(1500);

		expect(loadingState.active).toBe(false);
		expect(loadingState.stalledSources).toEqual([]);
	});

	it("still waits for the catalog on the POS route", () => {
		initLoadingSources(resolveBootLoadingSources("/app/posapp/pos"));
		markSourceLoaded("init");

		expect(getLoadingStatus().isCompleting).toBe(false);
		expect(loadingState.active).toBe(true);
	});
});

describe("bootstrap loading stall watchdog", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetLoadingState();
		setBootLoadingStallTimeout(STALL_MS);
	});

	afterEach(() => {
		resetLoadingState();
		setBootLoadingStallTimeout();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("releases the blocking overlay and warns when a source never completes", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		initLoadingSources(["init", "items", "customers"]);
		markSourceLoaded("init");
		expect(getLoadingStatus().stallWatchdogArmed).toBe(true);

		await vi.advanceTimersByTimeAsync(STALL_MS + 10);

		expect(loadingState.stalledSources).toEqual(["items", "customers"]);
		expect(getLoadingStatus().isCompleting).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Bootstrap loading made no progress"),
			expect.objectContaining({ pendingSources: ["items", "customers"] }),
		);

		await vi.advanceTimersByTimeAsync(1500);
		expect(loadingState.active).toBe(false);
	});

	it("re-arms on every real progress step so a slow but healthy boot is never cut off", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		initLoadingSources(["init", "items", "customers"]);
		markSourceLoaded("init");

		for (let progress = 10; progress <= 90; progress += 10) {
			await vi.advanceTimersByTimeAsync(STALL_MS - 20);
			setSourceProgress("items", progress);
		}

		expect(loadingState.stalledSources).toEqual([]);
		expect(getLoadingStatus().isCompleting).toBe(false);
		expect(warn).not.toHaveBeenCalled();

		markSourceLoaded("items");
		markSourceLoaded("customers");

		expect(getLoadingStatus().isCompleting).toBe(true);
		expect(getLoadingStatus().stallWatchdogArmed).toBe(false);
	});

	it("does not fire once boot completed normally", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		initLoadingSources(["init"]);
		markSourceLoaded("init");

		await vi.advanceTimersByTimeAsync(STALL_MS * 5);

		expect(warn).not.toHaveBeenCalled();
		expect(loadingState.stalledSources).toEqual([]);
	});

	it("clears the watchdog on reset and ships a sane default window", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		initLoadingSources(["init", "items"]);
		expect(getLoadingStatus().stallWatchdogArmed).toBe(true);

		resetLoadingState();
		expect(getLoadingStatus().stallWatchdogArmed).toBe(false);

		await vi.advanceTimersByTimeAsync(STALL_MS * 5);
		expect(warn).not.toHaveBeenCalled();
		expect(BOOT_LOADING_STALL_TIMEOUT_MS).toBe(20_000);
	});
});
