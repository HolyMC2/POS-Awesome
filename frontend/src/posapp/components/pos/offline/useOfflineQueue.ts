/**
 * Reactive half of the desktop offline queue (build plan §12 item E).
 *
 * `offlineQueueModel.ts` is pure and knows nothing about where the rows come
 * from; this is the seam that reads the REAL queue and owns the one side
 * effect on the screen — Reintentar.
 *
 * **Reintentar is not a second drain path.** The queue already drains itself:
 * `syncStore.syncPendingInvoices()` is what the resume hook, the navbar and
 * the dead-letter requeue all call, and `syncOfflineInvoices()` behind it is
 * single-flight (`invoiceSyncInProgress`) and claims each entry under a lease
 * before touching the server. A button that walked the rows itself would be a
 * second writer over the same money, and the failure mode is a sale submitted
 * twice. So this composable dispatches the EXISTING drain and adds only a
 * local guard so an impatient double-click cannot even queue two calls.
 *
 * Dependencies are injected with lazy defaults, which is what keeps a spec (or
 * a component tree) from dragging Dexie and the toast store in just by
 * importing this file — the same `import()`-at-the-call-site shape
 * `syncStore.ts` uses for telemetry.
 */

import { computed, ref, shallowRef } from "vue";

import {
	buildHeldSales,
	summariseHeldSales,
	type HeldSale,
} from "./offlineQueueModel";

type AnyRecord = Record<string, any>;

export interface UseOfflineQueueOptions {
	/** Reads the queue. Defaults to the invoice write queue's own snapshots. */
	readHeld?: () => AnyRecord[] | Promise<AnyRecord[]>;
	/**
	 * Drains it. Defaults to the shared drain — never a loop of its own.
	 * Injectable so a spec can prove WHICH drain was dispatched.
	 */
	drain?: () => Promise<unknown> | unknown;
	/**
	 * Optional connection re-probe, run before the drain. The shell owns
	 * `checkNetworkConnectivity`; without it a retry taken while the register
	 * is still offline would be dispatched into a drain that correctly refuses
	 * to run, and the operator would learn nothing.
	 */
	probe?: () => Promise<unknown> | unknown;
	locale?: string | null;
}

/** The invoice queue's public snapshots — `memory.offline_invoices`. */
async function readInvoiceQueue(): Promise<AnyRecord[]> {
	const { getOfflineInvoices } = await import("../../../../offline/index");
	return getOfflineInvoices() as AnyRecord[];
}

/**
 * THE existing drain. Deliberately reached through the store rather than by
 * importing `syncOfflineInvoices` directly: the store also handles coordinator
 * mode, the pending-count refresh and the toasts, and duplicating that choice
 * here is how the two paths start to disagree about what a retry does.
 */
async function drainThroughSyncStore(): Promise<void> {
	const { useSyncStore } = await import("../../../stores/syncStore");
	await useSyncStore().syncPendingInvoices();
}

export function useOfflineQueue(options: UseOfflineQueueOptions = {}) {
	const readHeld = options.readHeld ?? readInvoiceQueue;
	const drain = options.drain ?? drainThroughSyncStore;

	const snapshots = shallowRef<AnyRecord[]>([]);
	const retrying = ref(false);
	const loading = ref(false);
	/** Last retry that actually reached the drain — the view shows nothing else. */
	const lastRetryAt = ref<string | null>(null);

	const rows = computed<HeldSale[]>(() =>
		buildHeldSales(snapshots.value, { locale: options.locale ?? null }),
	);
	const summary = computed(() => summariseHeldSales(rows.value));

	async function refresh(): Promise<void> {
		loading.value = true;
		try {
			const held = await readHeld();
			snapshots.value = Array.isArray(held) ? held : [];
		} catch (error) {
			// A queue we cannot read is not a queue that is empty. Keep the last
			// good rows on screen rather than telling a shopkeeper with sales in
			// the drawer that there is nothing to upload.
			console.error("Failed to read the offline sale queue", error);
		} finally {
			loading.value = false;
		}
	}

	async function retry(): Promise<void> {
		if (retrying.value) {
			return;
		}
		retrying.value = true;
		try {
			await options.probe?.();
			await drain();
			lastRetryAt.value = new Date().toISOString();
		} catch (error) {
			// The drain owns its own error reporting (toast + telemetry). Losing
			// the button's spinner is not worth swallowing the queue with it.
			console.error("Offline queue retry failed", error);
		} finally {
			retrying.value = false;
			await refresh();
		}
	}

	return { rows, summary, snapshots, loading, retrying, lastRetryAt, refresh, retry };
}

export default useOfflineQueue;
