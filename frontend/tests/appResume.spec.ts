// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	APP_RESUME_DEBOUNCE_MS,
	APP_RESUME_MIN_INTERVAL_MS,
	createAppResume,
	type AppResumeDeps,
} from "../src/posapp/composables/core/useAppResume";

type Calls = string[];

function buildDeps(overrides: Partial<AppResumeDeps> = {}) {
	const calls: Calls = [];
	const tracked: Array<{ event: string; value?: number; metadata?: any }> = [];
	const deps: AppResumeDeps = {
		ensureStorage: async () => {
			calls.push("storage");
			return { ok: true, reopened: false };
		},
		ensureWorker: async () => {
			calls.push("worker");
			return { healthy: true, respawned: false };
		},
		releaseStaleGuards: () => {
			calls.push("guards");
			return [];
		},
		refreshData: async () => {
			calls.push("refresh");
		},
		ensureSocket: () => {
			calls.push("socket");
			return "connected";
		},
		ensureCatalog: async () => {
			calls.push("catalog");
			return "skipped";
		},
		track: (event, value, metadata) => {
			tracked.push({ event, value, metadata });
		},
		isOnline: () => true,
		...overrides,
	};
	return { deps, calls, tracked };
}

describe("app resume coordinator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("recovers storage, worker and guards before it refreshes or judges the catalog", async () => {
		const { deps, calls } = buildDeps();
		const resume = createAppResume(deps);

		const run = resume.resume("manual");
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS);
		await run;

		expect(calls).toEqual([
			"storage",
			"worker",
			"guards",
			"refresh",
			"socket",
			"catalog",
		]);
	});

	it("coalesces the burst of events one wake produces into a single run", async () => {
		const { deps, calls } = buildDeps();
		const resume = createAppResume(deps);
		resume.start();

		// A phone unlock fires all of these within a few milliseconds.
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
		window.dispatchEvent(new Event("online"));

		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS * 2);

		expect(calls.filter((entry) => entry === "storage")).toHaveLength(1);
		resume.stop();
	});

	it("ignores a pageshow that is not a bfcache restore", async () => {
		const { deps, calls } = buildDeps();
		const resume = createAppResume(deps);
		resume.start();

		window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS * 2);

		expect(calls).toEqual([]);
		resume.stop();
	});

	it("holds a second wake to one follow-up run instead of stacking passes", async () => {
		let releaseRefresh: (() => void) | null = null;
		const { deps, calls } = buildDeps({
			refreshData: () =>
				new Promise<void>((resolve) => {
					calls.push("refresh");
					releaseRefresh = resolve;
				}),
		});
		const resume = createAppResume(deps);

		void resume.resume("manual");
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS);
		expect(resume.isRunning()).toBe(true);

		// Three more wakes while the first pass is stuck on its refresh.
		void resume.resume("visibility");
		void resume.resume("visibility");
		void resume.resume("online");

		releaseRefresh?.();
		await vi.advanceTimersByTimeAsync(APP_RESUME_MIN_INTERVAL_MS * 2);

		expect(calls.filter((entry) => entry === "storage")).toHaveLength(2);
	});

	it("skips the data refresh while offline but still repairs local state", async () => {
		const { deps, calls } = buildDeps({ isOnline: () => false });
		const resume = createAppResume(deps);

		const run = resume.resume("manual");
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS);
		await run;

		expect(calls).toEqual(["storage", "worker", "guards", "socket", "catalog"]);
	});

	it("reports and tracks each repair it actually performed", async () => {
		const { deps, tracked } = buildDeps({
			ensureStorage: async () => ({ ok: true, reopened: true }),
			ensureWorker: async () => ({ healthy: true, respawned: true }),
			releaseStaleGuards: () => ["items_background_sync"],
			ensureSocket: () => "reconnecting",
			ensureCatalog: async () => "server",
		});
		const resume = createAppResume(deps);

		const run = resume.resume("visibility");
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS);
		const result = await run;

		expect(result?.repaired).toEqual([
			"dexie-reopen",
			"worker-respawn",
			"guards-released",
			"data-refresh",
			"socket-reconnect",
			"catalog-reload",
		]);
		const events = tracked.map((entry) => entry.event);
		expect(events).toContain("pos:resume_dexie_reopened");
		expect(events).toContain("pos:resume_worker_respawned");
		expect(events).toContain("pos:resume_guards_released");
		expect(events).toContain("pos:resume_catalog_reload");
		expect(events).toContain("pos:resume");
	});

	it("reports nothing repaired on a healthy resume", async () => {
		const { deps } = buildDeps();
		const resume = createAppResume(deps);

		const run = resume.resume("manual");
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS);
		const result = await run;

		// `data-refresh` is the one step that always runs while online.
		expect(result?.repaired).toEqual(["data-refresh"]);
	});

	it("keeps running the later steps when an earlier one throws", async () => {
		const { deps, calls } = buildDeps({
			ensureStorage: async () => {
				throw new Error("IndexedDB is gone");
			},
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		const resume = createAppResume(deps);

		const run = resume.resume("manual");
		await vi.advanceTimersByTimeAsync(APP_RESUME_DEBOUNCE_MS);
		await run;

		expect(calls).toEqual(["worker", "guards", "refresh", "socket", "catalog"]);
	});

	it("stops listening after stop()", async () => {
		const { deps, calls } = buildDeps();
		const resume = createAppResume(deps);
		resume.start();
		resume.stop();

		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(APP_RESUME_MIN_INTERVAL_MS);

		expect(calls).toEqual([]);
	});
});
