/**
 * Client wrapper around `workers/searchWorker.ts`.
 *
 * Flag-gated rollout — controlled by `localStorage.posa_search_worker
 * = on`. The default path stays the synchronous `performLocalSearch`
 * call so a broken worker can't blank the items grid. Once telemetry
 * confirms the worker shaves real ms off slow-device input lag we
 * flip the default and remove the flag.
 *
 * Lifecycle:
 *   - Worker is spawned lazily on first use.
 *   - Catalog Map is mirrored on the first call AND any time the
 *     caller signals a bulk replace (re-init on shift reload / catalog
 *     refresh).
 *   - Searches resolve via a pending-promises Map keyed by request id.
 *
 * Telemetry: every fulfilled search reports `perf:search-worker` with
 * the worker-side `took_ms` so we can compare against the existing
 * `perf:pos-search` events emitted by the main-thread path.
 */

import { trackCustomMark } from "../../../utils/telemetry";

export type SearchIndexEntry = {
	code: string;
	idx: string;
	group?: string;
};

const FLAG_KEY = "posa_search_worker";

function flagEnabled(): boolean {
	try {
		return localStorage.getItem(FLAG_KEY) === "on";
	} catch {
		return false;
	}
}

let workerPromise: Promise<Worker | null> | null = null;
let workerReady = false;
let pendingId = 0;
const pending = new Map<
	number,
	(value: { codes: string[]; took_ms: number }) => void
>();

async function getWorker(): Promise<Worker | null> {
	if (!flagEnabled()) return null;
	if (typeof Worker === "undefined") return null;
	if (workerPromise) return workerPromise;
	workerPromise = (async () => {
		try {
			const url = new URL(
				"../../../workers/searchWorker.ts",
				import.meta.url,
			);
			const w = new Worker(url, { type: "module" });
			w.onmessage = (event: MessageEvent) => {
				const data = event.data || {};
				if (data.op === "ready") {
					workerReady = true;
					return;
				}
				if (data.op === "search_result") {
					const cb = pending.get(data.id);
					if (cb) {
						pending.delete(data.id);
						cb({ codes: data.codes || [], took_ms: data.took_ms || 0 });
					}
				}
			};
			w.onerror = () => {
				// On worker failure, surface a one-time warning and
				// force the next call to fall back to the main-thread
				// path by clearing the singleton.
				console.warn("[POSA] search worker errored; falling back to main thread");
				workerPromise = null;
				workerReady = false;
			};
			return w;
		} catch (err) {
			console.warn("[POSA] search worker spawn failed", err);
			return null;
		}
	})();
	return workerPromise;
}

export function isSearchWorkerEnabled(): boolean {
	return flagEnabled() && typeof Worker !== "undefined";
}

/**
 * Replace the worker's full index. Call on bulk loads (shift open,
 * catalog refresh) — too cheap to skip even when nothing changed.
 * No-op when the flag is off.
 */
export async function setSearchIndex(entries: SearchIndexEntry[]): Promise<void> {
	const worker = await getWorker();
	if (!worker) return;
	worker.postMessage({ op: "set_index", entries });
}

/**
 * Apply a delta. `removals` is item_code strings the worker should
 * forget; `entries` is upserted. No-op when the flag is off.
 */
export async function patchSearchIndex(
	entries: SearchIndexEntry[],
	removals?: string[],
): Promise<void> {
	const worker = await getWorker();
	if (!worker) return;
	worker.postMessage({ op: "patch_index", entries, removals });
}

/**
 * Run a search through the worker. Resolves with `null` when the
 * worker is disabled / not ready, so the caller can fall back to
 * `performLocalSearch` synchronously.
 */
export async function searchViaWorker(
	term: string,
	group?: string,
	timeoutMs = 500,
): Promise<string[] | null> {
	const worker = await getWorker();
	if (!worker || !workerReady) return null;
	const id = ++pendingId;
	const result = await new Promise<{ codes: string[]; took_ms: number } | null>(
		(resolve) => {
			pending.set(id, resolve);
			const timer = setTimeout(() => {
				if (pending.delete(id)) {
					resolve(null);
				}
			}, timeoutMs);
			worker.postMessage({ op: "search", id, term, group });
			// The pending resolver wins normally; the timer is a
			// safety net so a dropped reply doesn't hang the UI.
			void timer;
		},
	);
	if (!result) return null;
	// trackCustomMark prefixes "perf:" itself — passing "perf:search-worker"
	// here double-prefixed the event ("perf:perf:search-worker"), so it never
	// matched any dashboard or benchmark manifest row.
	trackCustomMark("search-worker", result.took_ms);
	return result.codes;
}
