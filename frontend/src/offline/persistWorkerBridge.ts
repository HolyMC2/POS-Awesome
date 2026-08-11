/**
 * Supervised bridge to the persistence Web Worker (`posapp/workers/itemWorker.js`).
 *
 * `db.persist()` offloads its IndexedDB write to a worker so a heavy sync pass
 * does not block the main thread. The naive version of that hand-off — post the
 * message and return — loses data silently in two situations that a POS on a
 * phone hits routinely:
 *
 * - the browser reclaims the worker while the screen is off (mobile Chrome/Safari
 *   kill background workers under memory pressure). `postMessage` to a dead
 *   worker throws NOTHING; every later write evaporates.
 * - the worker's own `db.open()` failed at boot, so its `persist()` catches and
 *   logs while the main thread believes the value is durable.
 *
 * So every post is tracked until the worker acknowledges it (`{type:"persisted"}`).
 * An unacknowledged write falls back to the main-thread writer after
 * `PERSIST_ACK_TIMEOUT_MS`, and the worker is marked unhealthy so the resume
 * coordinator (`composables/core/useAppResume`) can ping/respawn it and replay
 * whatever is still outstanding.
 *
 * @module offline/persistWorkerBridge
 */

export const PERSIST_WORKER_URL =
	"/assets/posawesome/dist/js/posapp/workers/itemWorker.js";

/** How long a worker write may stay unacknowledged before the main thread takes over. */
export const PERSIST_ACK_TIMEOUT_MS = 5_000;

/** How long `ping` may take before the worker counts as dead. */
export const PERSIST_WORKER_PING_TIMEOUT_MS = 2_000;

type WorkerLike = Pick<Worker, "postMessage" | "terminate"> & {
	onmessage: ((_event: MessageEvent) => void) | null;
	onerror: ((_event: any) => void) | null;
};

type PersistFallbackWriter = (_key: string, _value: unknown) => void;

type PendingWrite = {
	value: unknown;
	timer: ReturnType<typeof setTimeout> | null;
};

let worker: WorkerLike | null = null;
let workerHealthy = false;
let fallbackWriter: PersistFallbackWriter | null = null;
let pingSequence = 0;
const pingWaiters = new Map<number, (_alive: boolean) => void>();
const pendingWrites = new Map<string, PendingWrite>();

let workerFactory: () => WorkerLike | null = () => {
	if (typeof Worker === "undefined") {
		return null;
	}
	try {
		// Plain URL (not `new URL(..., import.meta.url)`) so the service-worker
		// cache entry matches the request the app makes while offline.
		return new Worker(PERSIST_WORKER_URL, {
			type: "classic",
		}) as unknown as WorkerLike;
	} catch (error) {
		console.error("[posa][offline] Failed to init persist worker", error);
		return null;
	}
};

function clearPending(key: string) {
	const entry = pendingWrites.get(key);
	if (entry?.timer) {
		clearTimeout(entry.timer);
	}
	pendingWrites.delete(key);
}

function handleMessage(event: MessageEvent) {
	const data = (event?.data || {}) as {
		type?: string;
		key?: string;
		id?: number;
		ok?: boolean;
	};
	if (data.type === "persisted" && typeof data.key === "string") {
		// The worker answered, so it is alive — but it also reports whether the
		// write landed. Its IndexedDB handle can be dead while the worker is
		// not (the same unexpected-close trap the main thread has), and that
		// value must not be considered durable.
		workerHealthy = true;
		const entry = pendingWrites.get(data.key);
		clearPending(data.key);
		if (data.ok === false && entry && fallbackWriter) {
			try {
				fallbackWriter(data.key, entry.value);
			} catch (error) {
				console.error(
					"[posa][offline] persist fallback failed",
					data.key,
					error,
				);
			}
		}
		return;
	}
	if (data.type === "pong") {
		workerHealthy = true;
		const resolve =
			typeof data.id === "number" ? pingWaiters.get(data.id) : undefined;
		if (resolve && typeof data.id === "number") {
			pingWaiters.delete(data.id);
			resolve(true);
		}
	}
}

function handleError(error: unknown) {
	console.error("[posa][offline] persist worker error", error);
	workerHealthy = false;
	// Everything still outstanding is now the main thread's problem.
	flushPendingToFallback();
}

function attach(nextWorker: WorkerLike | null) {
	worker = nextWorker;
	workerHealthy = !!nextWorker;
	if (!nextWorker) {
		return;
	}
	nextWorker.onmessage = handleMessage;
	nextWorker.onerror = handleError;
}

function flushPendingToFallback() {
	if (!fallbackWriter) {
		pendingWrites.clear();
		return;
	}
	const entries = Array.from(pendingWrites.entries());
	for (const [key, entry] of entries) {
		clearPending(key);
		try {
			fallbackWriter(key, entry.value);
		} catch (error) {
			console.error("[posa][offline] persist fallback failed", key, error);
		}
	}
}

/**
 * Spawns the worker and registers the main-thread writer used whenever the
 * worker is missing, dead, or too slow to acknowledge. Safe to call twice.
 */
export function initPersistWorker(writer: PersistFallbackWriter) {
	fallbackWriter = writer;
	if (worker) {
		return worker;
	}
	attach(workerFactory());
	return worker;
}

/** True when a worker exists and has not been observed failing. */
export function isPersistWorkerHealthy() {
	return !!worker && workerHealthy;
}

/** Keys whose worker write has not been acknowledged yet. Test/telemetry seam. */
export function getPendingPersistKeys() {
	return Array.from(pendingWrites.keys());
}

/**
 * Hands one `persist()` write to the worker.
 *
 * @returns `true` when the worker accepted the message (the caller must NOT
 *   write again — the ack timer owns the fallback), `false` when the caller
 *   should perform the write itself.
 */
export function postPersist(key: string, value: unknown): boolean {
	if (!worker || !workerHealthy) {
		return false;
	}

	try {
		worker.postMessage({ type: "persist", key, value });
	} catch (error) {
		console.error("[posa][offline] Failed to persist via worker", key, error);
		workerHealthy = false;
		return false;
	}

	clearPending(key);
	const timer = setTimeout(() => {
		const entry = pendingWrites.get(key);
		pendingWrites.delete(key);
		// Silence for this long means the worker is gone or its IndexedDB
		// handle is broken; write from here so the value is not lost, and let
		// the next health check respawn it.
		workerHealthy = false;
		if (entry && fallbackWriter) {
			try {
				fallbackWriter(key, entry.value);
			} catch (error) {
				console.error(
					"[posa][offline] persist fallback failed",
					key,
					error,
				);
			}
		}
	}, PERSIST_ACK_TIMEOUT_MS);
	if (typeof (timer as any)?.unref === "function") {
		(timer as any).unref();
	}
	pendingWrites.set(key, { value, timer });
	return true;
}

/**
 * Round-trips a `ping` through the worker. Resolves `false` on timeout — a
 * worker the OS reclaimed accepts `postMessage` without ever answering.
 */
export function pingPersistWorker(
	timeoutMs = PERSIST_WORKER_PING_TIMEOUT_MS,
): Promise<boolean> {
	if (!worker) {
		return Promise.resolve(false);
	}
	const id = ++pingSequence;
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const settle = (alive: boolean) => {
			if (settled) return;
			settled = true;
			pingWaiters.delete(id);
			clearTimeout(timer);
			resolve(alive);
		};
		const timer = setTimeout(() => settle(false), timeoutMs);
		if (typeof (timer as any)?.unref === "function") {
			(timer as any).unref();
		}
		pingWaiters.set(id, settle);
		try {
			worker!.postMessage({ type: "ping", id });
		} catch {
			settle(false);
		}
	});
}

export type PersistWorkerHealthResult = {
	healthy: boolean;
	respawned: boolean;
	replayed: number;
};

/**
 * Resume-path health check: ping, and when the worker does not answer, replace
 * it and replay every write it never acknowledged.
 */
export async function ensurePersistWorkerHealthy(
	options: { pingTimeoutMs?: number } = {},
): Promise<PersistWorkerHealthResult> {
	if (typeof Worker === "undefined" && !worker) {
		return { healthy: false, respawned: false, replayed: 0 };
	}

	if (worker) {
		const alive = await pingPersistWorker(
			options.pingTimeoutMs ?? PERSIST_WORKER_PING_TIMEOUT_MS,
		);
		if (alive) {
			return { healthy: true, respawned: false, replayed: 0 };
		}
		try {
			worker.terminate();
		} catch {
			/* already gone */
		}
		worker = null;
		workerHealthy = false;
	}

	// Whatever the corpse never acknowledged is replayed through the fresh
	// worker; the values are still in `pendingWrites` with their timers armed.
	const outstanding = Array.from(pendingWrites.entries());
	attach(workerFactory());
	if (!worker) {
		flushPendingToFallback();
		return { healthy: false, respawned: false, replayed: 0 };
	}

	let replayed = 0;
	for (const [key, entry] of outstanding) {
		clearPending(key);
		if (postPersist(key, entry.value)) {
			replayed += 1;
		} else if (fallbackWriter) {
			fallbackWriter(key, entry.value);
		}
	}

	return { healthy: true, respawned: true, replayed };
}

/** Test seam: swap the worker constructor and drop all bridge state. */
export function resetPersistWorkerForTests(
	factory?: () => WorkerLike | null,
) {
	for (const key of Array.from(pendingWrites.keys())) {
		clearPending(key);
	}
	pingWaiters.clear();
	if (worker) {
		try {
			worker.terminate();
		} catch {
			/* ignore */
		}
	}
	worker = null;
	workerHealthy = false;
	fallbackWriter = null;
	if (factory) {
		workerFactory = factory;
	}
}
