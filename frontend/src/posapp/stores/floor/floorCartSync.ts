/**
 * The debounced cart → table-order sync (spec §6.1).
 *
 * Held apart from the floor store because it owns one piece of state nothing
 * else may touch: `syncedLines`, the baseline of **what the server last
 * accepted**. That baseline is what makes the per-line union correct — without
 * it the only available diff is "the whole cart", which silently deletes the
 * lines another waiter added between two of this device's writes.
 *
 * @module posapp/stores/floor/floorCartSync
 */
import { ref, watch, type ComputedRef, type Ref } from "vue";
import * as restaurantApi from "../../api/restaurant";
import type { OrderLine, OrderRow } from "../../api/restaurant";
import { buildLineDelta, cartAsLines, orderAsCartItems, rebaseSyncedLines } from "./floorCartBridge";

export interface CartSyncDeps {
	/**
	 * Resolves the invoice store — a GETTER, not the instance.
	 *
	 * The floor store must be constructible without dragging the cart in with
	 * it: `invoiceStore`'s setup calls `frappe.datetime.nowdate()` at
	 * instantiation, so eagerly requiring it makes every consumer of the floor
	 * store (including the payment seam, on retail sales that never touch a
	 * table) depend on a live Frappe boot. Resolved on first cart contact
	 * instead, which is the first moment a table order can exist.
	 */
	invoiceStore: () => any;
	activeOrder: Ref<OrderRow | null>;
	/** Only Record-Only mode has a POS Table Order to sync into (§2.3). */
	isRecordOnly: ComputedRef<boolean>;
	markSyncing: (table: string | null, on: boolean) => void;
	/** The server's fresh row, for the floor list and the active order. */
	onOrderUpdated: (order: OrderRow) => void;
	onError: (message: string) => void;
}

export interface CartSync {
	/** Order → cart, seeding the baseline from the same lines. */
	loadOrderIntoCart: (order: OrderRow) => void;
	/** Push whatever is queued right now (before fire / settle). */
	flush: () => Promise<void>;
	/** Forget the baseline — the cart no longer represents a table order. */
	reset: () => void;
}

const DEBOUNCE_MS = 800;

export const createCartSync = (deps: CartSyncDeps): CartSync => {
	const syncedLines = ref<Map<string, OrderLine>>(new Map());
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: OrderLine[] | null = null;
	let watching = false;

	/**
	 * Register the cart watcher on first cart contact. Safe to defer: nothing
	 * can sync without an active order, and an order becomes active only by
	 * passing through here.
	 */
	const ensureWatcher = (invoiceStore: any) => {
		if (watching) return;
		watching = true;
		// Every cart mutation bumps `metadata.changeVersion`, so one watcher
		// covers add / qty / remove / rate without the cart knowing a floor
		// exists. Inert unless a Record-Only table order is open, which keeps
		// retail and the counter cafetería on exactly their shipped paths. A
		// burst of qty taps costs one round-trip.
		watch(
			() => invoiceStore.metadata.changeVersion,
			() => {
				if (!deps.isRecordOnly.value || !deps.activeOrder.value) return;
				pending = cartAsLines(invoiceStore.items);
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => void push(), DEBOUNCE_MS);
			},
		);
	};

	const loadOrderIntoCart = (order: OrderRow) => {
		const invoiceStore = deps.invoiceStore();
		ensureWatcher(invoiceStore);
		invoiceStore.clear({ preserveStickies: true });
		invoiceStore.setItems(orderAsCartItems(order));
		// Identity rides the shipped cafetería fields rather than a second set
		// of refs — one place the tab name can live.
		invoiceStore.posaTabName = order.tab_name || null;
		invoiceStore.posaGuestCount = order.guest_count ?? null;
		invoiceStore.posaServiceType = order.service_type ?? null;
		syncedLines.value = new Map((order.lines || []).map((line) => [line.line_uid, line]));
	};

	const reset = () => {
		syncedLines.value = new Map();
		pending = null;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const push = async () => {
		timer = null;
		const order = deps.activeOrder.value;
		const cartLines = pending;
		pending = null;
		if (!order || !cartLines) return;
		const { upserts, removed, incoming } = buildLineDelta(cartLines, syncedLines.value);
		if (!upserts.length && !removed.length) return;
		const invoiceStore = deps.invoiceStore();
		deps.markSyncing(order.table, true);
		try {
			const updated = (await restaurantApi.updateTableOrder({
				orderUid: order.order_uid,
				lines: upserts,
				removedLineUids: removed,
				tabName: invoiceStore.posaTabName,
				guestCount: invoiceStore.posaGuestCount,
				serviceType: invoiceStore.posaServiceType,
			})) as OrderRow;
			syncedLines.value = rebaseSyncedLines(
				incoming,
				syncedLines.value,
				updated.rejected_removals || [],
			);
			deps.onOrderUpdated(updated);
		} catch (err: any) {
			deps.onError(err?.message || String(err));
		} finally {
			deps.markSyncing(order.table, false);
		}
	};

	const flush = async () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		await push();
	};

	return { loadOrderIntoCart, flush, reset };
};
