/**
 * App-level RESUME protocol for the POS shell.
 *
 * The offline layer already covers "the network went away". What it never had
 * is a story for "the process came back": a phone that locks mid-sale, a tab
 * the browser froze or bfcached, a laptop lid closed over a shift. Coming back
 * from that is not the same event as coming online — nothing fires `online`,
 * `navigator.onLine` never flipped, and the SPA returns holding whatever state
 * the freeze caught it in:
 *
 * - IndexedDB may be closed under us (`db.on("close")`), while `db.isOpen()`
 *   keeps answering `true` and every read rejects;
 * - the persistence worker may have been reclaimed, so writes vanish silently;
 * - requests that were in flight can be killed without ever settling, parking
 *   the guards their callers hold (`backgroundSyncState.running`, the customer
 *   fetch dedupe promise, the offline-invoice drain flag) forever;
 * - socket rooms are gone, and the socket carries NO replay
 *   (RESTAURANT_TABLES_SPEC §6.7) — so every resume needs an authoritative pull.
 *
 * This composable is the one place that reacts to `visibilitychange → visible`,
 * `pageshow` with `persisted` (the bfcache restore, a distinct path), the Page
 * Lifecycle `resume` event, and `online`. Runs are coalesced (one at a time,
 * debounced, with a floor between runs) and every step is an idempotent no-op
 * when nothing is broken, so a chatty browser cannot turn resume into load.
 *
 * Recovery order matters and is asserted by `tests/appResume.spec.ts`:
 *   storage → worker → wedged guards → data refresh → socket → catalog watchdog.
 * Storage first because every later step writes through it; the catalog
 * watchdog last because it must judge the state the earlier steps produced.
 *
 * @module posapp/composables/core/useAppResume
 */

export type AppResumeReason =
	| "visibility"
	| "pageshow"
	| "lifecycle-resume"
	| "online"
	| "manual";

export type AppResumeStep =
	| "dexie-reopen"
	| "worker-respawn"
	| "guards-released"
	| "data-refresh"
	| "socket-reconnect"
	| "catalog-reload";

export type AppResumeRunResult = {
	reason: AppResumeReason;
	/** Steps that actually did something. A healthy resume reports none. */
	repaired: AppResumeStep[];
	durationMs: number;
};

export type AppResumeDeps = {
	/** Reopen the offline store when the browser closed it. */
	ensureStorage: () => Promise<{ ok: boolean; reopened: boolean }>;
	/** Ping/respawn the persistence worker and replay unacknowledged writes. */
	ensureWorker: () => Promise<{ healthy: boolean; respawned: boolean }>;
	/** Release in-flight guards whose request died. Returns the ones released. */
	releaseStaleGuards: () => string[];
	/** Authoritative refresh of the volatile data (sync coordinator kick). */
	refreshData: () => Promise<void>;
	/** Verify the realtime transport. */
	ensureSocket: () => "connected" | "reconnecting" | "unavailable";
	/** Catalog watchdog. Reports how the catalog was recovered, if at all. */
	ensureCatalog: () => Promise<"skipped" | "cache" | "server" | "failed">;
	/** Emit a telemetry breadcrumb. */
	track?: (
		_event: string,
		_value?: number,
		_metadata?: Record<string, unknown>,
	) => void;
	isOnline?: () => boolean;
	now?: () => number;
	/** Debounce applied to the trigger burst a single wake produces. */
	debounceMs?: number;
	/** Floor between two full runs; triggers inside it coalesce into one rerun. */
	minIntervalMs?: number;
	setTimeoutFn?: (_callback: () => void, _delayMs: number) => any;
	clearTimeoutFn?: (_handle: any) => void;
};

/** One wake fires visibilitychange, pageshow and sometimes online together. */
export const APP_RESUME_DEBOUNCE_MS = 250;

/** Two resumes closer than this are one resume. */
export const APP_RESUME_MIN_INTERVAL_MS = 3_000;

export type AppResumeController = {
	start: () => void;
	stop: () => void;
	/** Runs the sequence now (still coalesced). Resolves when the run settles. */
	resume: (_reason?: AppResumeReason) => Promise<AppResumeRunResult | null>;
	isRunning: () => boolean;
	getLastRun: () => AppResumeRunResult | null;
};

function noopTrack() {
	/* telemetry is optional */
}

export function createAppResume(deps: AppResumeDeps): AppResumeController {
	const track = deps.track || noopTrack;
	const now = deps.now || (() => Date.now());
	const isOnline =
		deps.isOnline ||
		(() => (typeof navigator === "undefined" ? true : navigator.onLine));
	const debounceMs = deps.debounceMs ?? APP_RESUME_DEBOUNCE_MS;
	const minIntervalMs = deps.minIntervalMs ?? APP_RESUME_MIN_INTERVAL_MS;
	const setTimeoutFn =
		deps.setTimeoutFn || ((callback, delayMs) => setTimeout(callback, delayMs));
	const clearTimeoutFn = deps.clearTimeoutFn || ((handle) => clearTimeout(handle));

	let started = false;
	let running: Promise<AppResumeRunResult> | null = null;
	let pendingReason: AppResumeReason | null = null;
	let pendingResolvers: Array<(_result: AppResumeRunResult | null) => void> = [];
	let debounceHandle: any = null;
	let lastRunAt = 0;
	let lastRun: AppResumeRunResult | null = null;

	async function runSequence(reason: AppResumeReason) {
		const startedAt = now();
		const repaired: AppResumeStep[] = [];

		// 1. Storage. Everything below writes through it.
		try {
			const storage = await deps.ensureStorage();
			if (storage.reopened) {
				repaired.push("dexie-reopen");
				track("pos:resume_dexie_reopened", 1, { reason });
			}
		} catch (error) {
			console.error("[posa][resume] storage recovery failed", error);
		}

		// 2. Persistence worker — a corpse accepts writes and drops them.
		try {
			const worker = await deps.ensureWorker();
			if (worker.respawned) {
				repaired.push("worker-respawn");
				track("pos:resume_worker_respawned", 1, { reason });
			}
		} catch (error) {
			console.error("[posa][resume] worker recovery failed", error);
		}

		// 3. Guards whose request will never settle. Must precede the refresh:
		//    a held guard makes every kick below a silent no-op.
		try {
			const released = deps.releaseStaleGuards();
			if (released.length) {
				repaired.push("guards-released");
				track("pos:resume_guards_released", released.length, {
					reason,
					guards: released,
				});
			}
		} catch (error) {
			console.error("[posa][resume] guard release failed", error);
		}

		// 4. Authoritative pull. Offline, the local data is already the truth.
		if (isOnline()) {
			try {
				await deps.refreshData();
				repaired.push("data-refresh");
			} catch (error) {
				console.error("[posa][resume] data refresh failed", error);
			}
		}

		// 5. Socket. After the pull, so a reconnect burst lands on fresh state.
		try {
			if (deps.ensureSocket() === "reconnecting") {
				repaired.push("socket-reconnect");
				track("pos:resume_socket_reconnect", 1, { reason });
			}
		} catch (error) {
			console.error("[posa][resume] socket check failed", error);
		}

		// 6. Watchdog last: it judges the state the steps above produced.
		try {
			const outcome = await deps.ensureCatalog();
			if (outcome === "cache" || outcome === "server") {
				repaired.push("catalog-reload");
				track("pos:resume_catalog_reload", 1, { reason, source: outcome });
			} else if (outcome === "failed") {
				track("warn:resume_catalog_empty", 1, { reason });
			}
		} catch (error) {
			console.error("[posa][resume] catalog watchdog failed", error);
		}

		const result: AppResumeRunResult = {
			reason,
			repaired,
			durationMs: now() - startedAt,
		};
		lastRun = result;
		lastRunAt = now();
		track("pos:resume", repaired.length, {
			reason,
			repaired,
			duration_ms: result.durationMs,
		});
		return result;
	}

	function settlePending(result: AppResumeRunResult | null) {
		const resolvers = pendingResolvers;
		pendingResolvers = [];
		resolvers.forEach((resolve) => resolve(result));
	}

	function launch(reason: AppResumeReason) {
		running = runSequence(reason)
			.catch((error) => {
				console.error("[posa][resume] run failed", error);
				const failed: AppResumeRunResult = {
					reason,
					repaired: [],
					durationMs: 0,
				};
				lastRunAt = now();
				return failed;
			})
			.then((result) => {
				running = null;
				settlePending(result);
				// A trigger that arrived mid-run gets exactly one follow-up.
				if (pendingReason) {
					const nextReason = pendingReason;
					pendingReason = null;
					schedule(nextReason);
				}
				return result;
			});
		return running;
	}

	function schedule(reason: AppResumeReason) {
		if (running) {
			pendingReason = reason;
			return;
		}
		if (debounceHandle !== null) {
			clearTimeoutFn(debounceHandle);
		}
		const sinceLastRun = now() - lastRunAt;
		const delay =
			lastRunAt && sinceLastRun < minIntervalMs
				? Math.max(debounceMs, minIntervalMs - sinceLastRun)
				: debounceMs;
		debounceHandle = setTimeoutFn(() => {
			debounceHandle = null;
			void launch(reason);
		}, delay);
	}

	const onVisibilityChange = () => {
		if (typeof document !== "undefined" && document.visibilityState === "visible") {
			schedule("visibility");
		}
	};

	// bfcache restore. `persisted === false` is an ordinary load, which boot
	// already covers; running the sequence there would duplicate the boot sync.
	const onPageShow = (event: any) => {
		if (event?.persisted) {
			schedule("pageshow");
		}
	};

	const onLifecycleResume = () => schedule("lifecycle-resume");
	const onOnline = () => schedule("online");

	function start() {
		if (started || typeof window === "undefined") {
			return;
		}
		started = true;
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("pageshow", onPageShow);
		window.addEventListener("online", onOnline);
		// Chrome's Page Lifecycle API: fires when a FROZEN page thaws, which is
		// the discard-adjacent path where visibilitychange alone can be missed.
		document.addEventListener("resume", onLifecycleResume);
	}

	function stop() {
		if (!started) {
			return;
		}
		started = false;
		document.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("pageshow", onPageShow);
		window.removeEventListener("online", onOnline);
		document.removeEventListener("resume", onLifecycleResume);
		if (debounceHandle !== null) {
			clearTimeoutFn(debounceHandle);
			debounceHandle = null;
		}
		pendingReason = null;
		settlePending(null);
	}

	function resume(reason: AppResumeReason = "manual") {
		return new Promise<AppResumeRunResult | null>((resolve) => {
			pendingResolvers.push(resolve);
			schedule(reason);
		});
	}

	return {
		start,
		stop,
		resume,
		isRunning: () => running !== null,
		getLastRun: () => lastRun,
	};
}
