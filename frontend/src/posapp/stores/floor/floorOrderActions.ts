/**
 * The mutating table-order actions: open, resume, fire, settle, cancel,
 * transfer.
 *
 * Held apart from the floor store because they share one shape — mark the
 * table busy, call the wrapper, reconcile, unmark — and because the store's job
 * is holding floor state, not orchestrating round-trips.
 *
 * Error contract (Agent C's wrapper): a transport failure while online does NOT
 * throw — the write queues under the same request id and the optimistic row
 * comes back. Only a validation failure throws, and that is the one the cashier
 * must see, so every catch here surfaces the message rather than swallowing it.
 *
 * @module posapp/stores/floor/floorOrderActions
 */
import type { ComputedRef, Ref } from "vue";
import * as restaurantApi from "../../api/restaurant";
import type { KotProjection, OrderRow, TableRow } from "../../api/restaurant";
import { newUid } from "./floorRuntime";

// Matches the shell convention: the Frappe boot supplies `__`; fall back to the
// literal so a missing boot degrades to Spanish copy rather than an exception.
// `globalThis`, not `window` — this module is read at import time, and a node
// -environment unit test importing the floorStore chain has no `window` to
// dereference.
const __ = (globalThis as any).__ || ((value: string) => value);

export interface OrderActionDeps {
	posProfile: ComputedRef<string>;
	company: ComputedRef<string>;
	activeOrder: Ref<OrderRow | null>;
	transferOrder: Ref<OrderRow | null>;
	markSyncing: (table: string | null, on: boolean) => void;
	setActiveOrder: (order: OrderRow | null) => void;
	upsertOrder: (order: OrderRow) => void;
	dropOrder: (orderUid: string) => void;
	loadOrderIntoCart: (order: OrderRow) => void;
	flushCartSync: () => Promise<void>;
	refresh: (options?: { silent?: boolean }) => Promise<void>;
	isOccupied: (table: string) => boolean;
	onError: (message: string) => void;
}

export const createOrderActions = (deps: OrderActionDeps) => {
	/**
	 * Guarantee an order carries its lines before it reaches the cart.
	 *
	 * The floor snapshot is one grouped query returning COUNTS, not children
	 * (§F9) — so a row picked off the board has no `lines`, and handing it to
	 * the cart straight would load an empty ticket over a table that has food on
	 * it. Single-order responses carry them; the local mirror carries them for
	 * orders this device opened; anything else has to be asked for, and
	 * `open_table_order` is that ask — it dedupes on `order_uid` and answers
	 * with the existing order.
	 */
	const withLines = async (order: OrderRow): Promise<OrderRow> => {
		if (order.lines) return order;
		if (!order.items_count) return { ...order, lines: [] };
		const stored = await restaurantApi.getTableOrder(order.order_uid);
		// The mirror keeps THIS device's lines across a snapshot refresh but
		// takes counts from the server, so a count that disagrees with the line
		// list means another waiter edited the ticket and our copy is stale.
		// Trusting it would show the cashier a ticket missing someone's food.
		if (stored?.lines && stored.lines.length === stored.items_count) {
			return stored;
		}
		return (await restaurantApi.openTableOrder({
			posProfile: deps.posProfile.value,
			company: deps.company.value,
			orderUid: order.order_uid,
			table: order.table,
		})) as OrderRow;
	};

	/**
	 * A ticket whose settle is in flight must not come back into the cart.
	 * Editing it would race the drain: the queued settle already carries the
	 * line set it will submit, so lines added here would either be lost or
	 * ring up on a second invoice. `Settling` is the precise test — an ordinary
	 * offline order carries `pending_sync` too and MUST stay resumable, because
	 * a waiter with no signal still has to keep adding to the tab.
	 */
	const refuseIfSettling = (order: OrderRow): boolean => {
		if (order.status !== "Settling") return false;
		deps.onError(__("Cuenta en cola de cobro — esperando conexión"));
		return true;
	};

	const adopt = (order: OrderRow) => {
		deps.upsertOrder(order);
		deps.setActiveOrder(order);
		deps.loadOrderIntoCart(order);
	};

	/**
	 * Tap-to-open (§4): one open order → open it, none → create one. The server
	 * resolves the race — it returns the existing order with `existing: true`
	 * when a second waiter tapped first.
	 */
	const openOrCreate = async (table: TableRow): Promise<OrderRow | null> => {
		deps.markSyncing(table.name, true);
		try {
			const opened = (await restaurantApi.openTableOrder({
				posProfile: deps.posProfile.value,
				company: deps.company.value,
				orderUid: newUid("ord"),
				table: table.name,
				guestCount: table.seats || null,
			})) as OrderRow;
			if (refuseIfSettling(opened)) return null;
			const order = await withLines(opened);
			adopt(order);
			return order;
		} catch (err: any) {
			deps.onError(err?.message || String(err));
			return null;
		} finally {
			deps.markSyncing(table.name, false);
		}
	};

	/**
	 * Open a SECOND cuenta on an already-busy table (split bill). Unlike
	 * `openOrCreate`, it never resolves to the table's existing order — the
	 * server mints a new one because `newAccount` skips the table dedupe. The
	 * optional label rides on `tab_name` so the account picker can name it.
	 */
	const openNewAccount = async (
		table: TableRow,
		tabName?: string | null,
	): Promise<OrderRow | null> => {
		deps.markSyncing(table.name, true);
		try {
			const opened = (await restaurantApi.openTableOrder({
				posProfile: deps.posProfile.value,
				company: deps.company.value,
				orderUid: newUid("ord"),
				table: table.name,
				guestCount: table.seats || null,
				tabName: tabName || null,
				newAccount: true,
			})) as OrderRow;
			if (refuseIfSettling(opened)) return null;
			const order = await withLines(opened);
			adopt(order);
			return order;
		} catch (err: any) {
			deps.onError(err?.message || String(err));
			return null;
		} finally {
			deps.markSyncing(table.name, false);
		}
	};

	/** Table-less order for the cafetería tab rail. */
	const openTab = async (tabName: string): Promise<OrderRow | null> => {
		try {
			const opened = (await restaurantApi.openTableOrder({
				posProfile: deps.posProfile.value,
				company: deps.company.value,
				orderUid: newUid("ord"),
				table: null,
				tabName,
			})) as OrderRow;
			if (refuseIfSettling(opened)) return null;
			const order = await withLines(opened);
			adopt(order);
			return order;
		} catch (err: any) {
			deps.onError(err?.message || String(err));
			return null;
		}
	};

	/**
	 * Resume an order picked off the board or the tabs rail. Separate from
	 * `openOrCreate` because it must never create: the order exists and the
	 * operator chose it by name.
	 */
	const resumeOrder = async (row: OrderRow): Promise<OrderRow | null> => {
		if (refuseIfSettling(row)) return null;
		deps.markSyncing(row.table, true);
		try {
			const order = await withLines(row);
			adopt(order);
			return order;
		} catch (err: any) {
			deps.onError(err?.message || String(err));
			return null;
		} finally {
			deps.markSyncing(row.table, false);
		}
	};

	/**
	 * Settle: the payment view's submit, rerouted. Returns the wrapper's result
	 * unchanged so the caller's post-submit handling stays as it is. Throws on
	 * failure — the payment view already has the catch that tells the cashier.
	 */
	const settleActiveOrder = async (
		invoicePayload: Record<string, unknown>,
		tipAmount = 0,
	) => {
		const order = deps.activeOrder.value;
		if (!order) throw new Error("No table order is open");
		await deps.flushCartSync();
		deps.markSyncing(order.table, true);
		try {
			const result = await restaurantApi.settleTableOrder({
				orderUid: order.order_uid,
				invoicePayload,
				tipAmount,
			});
			if (result.queued) {
				// Offline: the write is queued and NOTHING is submitted yet.
				//
				// Detach the cart FIRST and synchronously. The seam frees the
				// register for the next customer right after this returns, and
				// that cart-clear bumps `metadata.changeVersion`; if this order
				// were still the active one, the cart-sync watcher would fire and
				// queue a line-removal update against a ticket whose settle is
				// already in the drain queue. Clearing the active order also
				// resets the sync baseline and cancels any pending debounce.
				deps.setActiveOrder(null);
				// The order itself stays on the board — dropping it would hide a
				// sale that has not happened. The mirror already holds it as
				// Settling + pending_sync, and `listStoredTableOrders` counts
				// Settling as open (OPEN_STATUSES = ["Open", "Settling"]), so it
				// survives this refresh and repaints with the pending badge.
				await deps.refresh({ silent: true });
				return result;
			}
			// Past this point the server gave a verdict, so the order really is
			// settled — including the `idempotent` case, where the invoice landed
			// on an earlier attempt and only the response was lost. Do NOT move
			// these above the await, and do NOT add a `catch` that turns a failed
			// settle into a retry: a retry mints a new client_request_id, which
			// bypasses the submission ledger's dedupe.
			deps.dropOrder(order.order_uid);
			await deps.refresh({ silent: true });
			return result;
		} finally {
			deps.markSyncing(order.table, false);
		}
	};

	/** ONLINE ONLY — throws `RestaurantOfflineError`, surfaced as its message. */
	const fireActiveCourse = async (courseIdx?: number): Promise<KotProjection | null> => {
		const order = deps.activeOrder.value;
		if (!order) return null;
		await deps.flushCartSync();
		deps.markSyncing(order.table, true);
		try {
			const projection = await restaurantApi.fireCourse(order.order_uid, courseIdx);
			await deps.refresh({ silent: true });
			return projection;
		} catch (err: any) {
			deps.onError(err?.message || String(err));
			return null;
		} finally {
			deps.markSyncing(order.table, false);
		}
	};

	const cancelOrder = async (order: OrderRow) => {
		deps.markSyncing(order.table, true);
		try {
			await restaurantApi.cancelTableOrder(order.order_uid);
			deps.dropOrder(order.order_uid);
		} catch (err: any) {
			deps.onError(err?.message || String(err));
		} finally {
			deps.markSyncing(order.table, false);
		}
	};

	// ---- transfer (§4 modal gesture) ----------------------------------------

	const beginTransfer = (order: OrderRow) => {
		deps.transferOrder.value = order;
	};

	const cancelTransfer = () => {
		deps.transferOrder.value = null;
	};

	const completeTransfer = async (target: TableRow): Promise<boolean> => {
		const order = deps.transferOrder.value;
		if (!order) return false;
		// An occupied target is a merge, and merge is phase 2 (§6.5) — the tile
		// is disabled, this is the second gate.
		if (deps.isOccupied(target.name)) return false;
		deps.markSyncing(target.name, true);
		try {
			await restaurantApi.transferTableOrder(order.order_uid, target.name);
			deps.transferOrder.value = null;
			await deps.refresh({ silent: true });
			return true;
		} catch (err: any) {
			deps.onError(err?.message || String(err));
			return false;
		} finally {
			deps.markSyncing(target.name, false);
		}
	};

	return {
		openOrCreate,
		openNewAccount,
		openTab,
		resumeOrder,
		settleActiveOrder,
		fireActiveCourse,
		cancelOrder,
		beginTransfer,
		cancelTransfer,
		completeTransfer,
	};
};
