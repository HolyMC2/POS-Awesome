// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	PERSIST_ACK_TIMEOUT_MS,
	PERSIST_WORKER_PING_TIMEOUT_MS,
	ensurePersistWorkerHealthy,
	getPendingPersistKeys,
	initPersistWorker,
	isPersistWorkerHealthy,
	pingPersistWorker,
	postPersist,
	resetPersistWorkerForTests,
} from "../src/offline/persistWorkerBridge";

/**
 * Stand-in for `posapp/workers/itemWorker.js`. `alive: false` reproduces the
 * worker the OS reclaimed while the screen was off: `postMessage` is accepted
 * and nothing ever comes back.
 */
class FakeWorker {
	static instances: FakeWorker[] = [];

	alive = true;

	/** Mirrors a worker whose own IndexedDB handle is dead: answers, writes nothing. */
	writesLand = true;

	terminated = false;

	received: any[] = [];

	onmessage: ((event: any) => void) | null = null;

	onerror: ((event: any) => void) | null = null;

	constructor() {
		FakeWorker.instances.push(this);
	}

	postMessage(data: any) {
		this.received.push(data);
		if (!this.alive) {
			return;
		}
		if (data?.type === "ping") {
			queueMicrotask(() => this.onmessage?.({ data: { type: "pong", id: data.id } }));
			return;
		}
		if (data?.type === "persist") {
			queueMicrotask(() =>
				this.onmessage?.({
					data: { type: "persisted", key: data.key, ok: this.writesLand },
				}),
			);
		}
	}

	terminate() {
		this.terminated = true;
	}
}

function latestWorker() {
	return FakeWorker.instances[FakeWorker.instances.length - 1]!;
}

describe("persist worker supervision", () => {
	let fallbackWrites: Array<{ key: string; value: unknown }>;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeWorker.instances = [];
		fallbackWrites = [];
		resetPersistWorkerForTests(() => new FakeWorker() as any);
		initPersistWorker((key, value) => {
			fallbackWrites.push({ key, value });
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		resetPersistWorkerForTests();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("hands the write to the worker and clears it on the acknowledgement", async () => {
		expect(postPersist("cache_ready", true)).toBe(true);
		expect(getPendingPersistKeys()).toEqual(["cache_ready"]);

		await vi.advanceTimersByTimeAsync(0);

		expect(getPendingPersistKeys()).toEqual([]);
		expect(fallbackWrites).toEqual([]);
	});

	it("writes from the main thread when the worker never acknowledges", async () => {
		latestWorker().alive = false;

		expect(postPersist("items_last_sync", "2026-08-11")).toBe(true);
		await vi.advanceTimersByTimeAsync(PERSIST_ACK_TIMEOUT_MS);

		expect(fallbackWrites).toEqual([
			{ key: "items_last_sync", value: "2026-08-11" },
		]);
		expect(isPersistWorkerHealthy()).toBe(false);
		// Once the worker is suspect the caller owns the write directly.
		expect(postPersist("items_last_sync", "later")).toBe(false);
	});

	it("re-writes from the main thread when the worker reports its own store is dead", async () => {
		// The worker survived the sleep; its IndexedDB connection did not.
		latestWorker().writesLand = false;

		expect(postPersist("stock_cache_ready", true)).toBe(true);
		await vi.advanceTimersByTimeAsync(0);

		expect(fallbackWrites).toEqual([{ key: "stock_cache_ready", value: true }]);
		expect(getPendingPersistKeys()).toEqual([]);
	});

	it("pings alive and reports a reclaimed worker as dead", async () => {
		const alivePing = pingPersistWorker();
		await vi.advanceTimersByTimeAsync(0);
		await expect(alivePing).resolves.toBe(true);

		latestWorker().alive = false;
		const deadPing = pingPersistWorker();
		await vi.advanceTimersByTimeAsync(PERSIST_WORKER_PING_TIMEOUT_MS);
		await expect(deadPing).resolves.toBe(false);
	});

	it("leaves a healthy worker alone", async () => {
		const check = ensurePersistWorkerHealthy();
		await vi.advanceTimersByTimeAsync(0);
		const result = await check;

		expect(result).toEqual({ healthy: true, respawned: false, replayed: 0 });
		expect(FakeWorker.instances).toHaveLength(1);
	});

	it("respawns a dead worker and replays what it never acknowledged", async () => {
		const dead = latestWorker();
		dead.alive = false;
		postPersist("bootstrap_snapshot", { profile: "Cafeteria" });

		const check = ensurePersistWorkerHealthy();
		await vi.advanceTimersByTimeAsync(PERSIST_WORKER_PING_TIMEOUT_MS);
		const result = await check;

		expect(result.respawned).toBe(true);
		expect(result.replayed).toBe(1);
		expect(dead.terminated).toBe(true);
		expect(FakeWorker.instances).toHaveLength(2);

		const replacement = latestWorker();
		expect(replacement.received).toEqual([
			{ type: "persist", key: "bootstrap_snapshot", value: { profile: "Cafeteria" } },
		]);

		// The replay is acknowledged, so the main thread never double-writes.
		await vi.advanceTimersByTimeAsync(PERSIST_ACK_TIMEOUT_MS);
		expect(getPendingPersistKeys()).toEqual([]);
		expect(fallbackWrites).toEqual([]);
	});

	it("falls back to the main thread when no worker can be spawned", async () => {
		resetPersistWorkerForTests(() => null);
		initPersistWorker((key, value) => {
			fallbackWrites.push({ key, value });
		});

		expect(postPersist("manual_offline", true)).toBe(false);
		const result = await ensurePersistWorkerHealthy();
		expect(result.healthy).toBe(false);
	});
});
