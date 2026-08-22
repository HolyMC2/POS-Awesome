// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `Reintentar ahora` — the one control on the offline surface, and the one
 * place on it where a mistake costs money.
 *
 * The queue already drains itself. `syncStore.syncPendingInvoices()` is what
 * the resume hook, the navbar and every dead-letter requeue call, and
 * `syncOfflineInvoices()` under it is single-flight and claims each entry
 * under a lease before it touches the server. A retry button that walked the
 * rows itself would be a SECOND writer over the same money — the failure is a
 * sale submitted twice, and it is silent.
 *
 * So these tests assert identity and arity, not just "something happened":
 * WHICH drain was dispatched, and exactly how many times.
 */

const syncPendingInvoices = vi.fn(async () => {});
vi.mock("../src/posapp/stores/syncStore", () => ({
	useSyncStore: () => ({ syncPendingInvoices }),
}));

import {
	db,
	getOfflineInvoices,
	initPromise,
	memory,
	saveOfflineInvoice,
} from "../src/offline/index";
import { useOfflineQueue } from "../src/posapp/components/pos/offline/useOfflineQueue";

const snapshot = (over: Record<string, any> = {}) => ({
	queue_id: over.queue_id ?? 1,
	status: over.status ?? "pending",
	created_at: over.created_at ?? "2026-08-22T19:44:00.000Z",
	retry_count: 0,
	idempotency_key: `inv-1755900000000-key${over.queue_id ?? 1}`,
	invoice: {
		customer_name: "Alejandra Ríos Bautista",
		grand_total: 1129,
		items: [{ item_name: "Funda", qty: 1 }],
		payments: [{ mode_of_payment: "Efectivo", amount: 1129 }],
	},
	data: {},
});

beforeEach(async () => {
	await initPromise;
	await db.table("write_queue").clear();
	await db.table("queue").clear();
	await db.table("keyval").clear();
	localStorage.clear();
	memory.offline_invoices = [];
	memory.offline_customers = [];
	memory.offline_payments = [];
	memory.offline_cash_movements = [];
	memory.local_stock_cache = {};
	syncPendingInvoices.mockClear();
	vi.spyOn(console, "error").mockImplementation(() => {});
	(globalThis as any).frappe = { call: vi.fn() };
});

describe("Reintentar reuses the drain that already exists", () => {
	it("dispatches the shared sync store drain, not one of its own", () => {
		const queue = useOfflineQueue({ readHeld: () => [] });

		return queue.retry().then(() => {
			expect(syncPendingInvoices).toHaveBeenCalledTimes(1);
		});
	});

	it("never calls the server itself", async () => {
		// The whole hazard in one assertion: a submit issued from this surface
		// bypasses the queue's lease and its idempotency bookkeeping.
		const queue = useOfflineQueue({ readHeld: () => [snapshot()] });

		await queue.retry();

		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("runs ONE drain for an impatient double press", async () => {
		let release!: () => void;
		const inFlight = new Promise<void>((resolve) => {
			release = resolve;
		});
		const drain = vi.fn(() => inFlight);
		const queue = useOfflineQueue({ readHeld: () => [], drain });

		const first = queue.retry();
		const second = queue.retry();
		expect(queue.retrying.value).toBe(true);
		release();
		await Promise.all([first, second]);

		expect(drain, "two drains over one queue is how a sale gets billed twice").toHaveBeenCalledTimes(
			1,
		);
		expect(queue.retrying.value).toBe(false);
	});

	it("re-probes the connection before draining, when the shell offers a probe", async () => {
		const order: string[] = [];
		const queue = useOfflineQueue({
			readHeld: () => [],
			probe: () => void order.push("probe"),
			drain: () => void order.push("drain"),
		});

		await queue.retry();

		expect(order).toEqual(["probe", "drain"]);
	});

	it("re-reads the queue after the drain, so the table cannot go stale", async () => {
		const readHeld = vi.fn(() => [snapshot()]);
		const queue = useOfflineQueue({ readHeld, drain: async () => {} });

		await queue.refresh();
		await queue.retry();

		expect(readHeld).toHaveBeenCalledTimes(2);
		expect(queue.rows.value).toHaveLength(1);
	});

	it("stays pressable after a drain that failed", async () => {
		const queue = useOfflineQueue({
			readHeld: () => [],
			drain: async () => {
				throw new Error("network");
			},
		});

		await queue.retry();

		expect(queue.retrying.value).toBe(false);
		// The drain owns its own error reporting; the button must not latch.
		await queue.retry();
		expect(queue.retrying.value).toBe(false);
	});

	it("only records a retry that actually reached the drain", async () => {
		const queue = useOfflineQueue({ readHeld: () => [], drain: async () => {} });

		expect(queue.lastRetryAt.value).toBeNull();
		await queue.retry();
		expect(queue.lastRetryAt.value).not.toBeNull();
	});
});

describe("the table reads the real queue", () => {
	it("builds its rows from sales the offline layer actually holds", async () => {
		await saveOfflineInvoice({
			invoice: {
				customer: "CUST-001",
				customer_name: "Rogelio Ancona Sabido",
				grand_total: 200,
				items: [{ item_code: "ITEM-1", item_name: "Anillo Case Honor X8A Rojo", qty: 1 }],
				payments: [{ mode_of_payment: "Efectivo", amount: 200 }],
			},
			data: {},
		});

		const queue = useOfflineQueue();
		await queue.refresh();

		expect(getOfflineInvoices()).toHaveLength(1);
		expect(queue.rows.value).toHaveLength(1);
		expect(queue.rows.value[0]!.customer).toBe("Rogelio Ancona Sabido");
		expect(queue.rows.value[0]!.amount).toBe(200);
		expect(queue.rows.value[0]!.tenderLabel).toBe("Efectivo");
		expect(queue.summary.value.totalHeld).toBe(200);
	});

	it("orders the real queue oldest first", async () => {
		for (const [customer, total] of [
			["Primera", 100],
			["Segunda", 200],
			["Tercera", 300],
		] as const) {
			await saveOfflineInvoice({
				invoice: {
					customer,
					customer_name: customer,
					grand_total: total,
					items: [{ item_code: `ITEM-${total}`, item_name: customer, qty: 1 }],
				},
				data: {},
			});
		}

		const queue = useOfflineQueue();
		await queue.refresh();

		expect(queue.rows.value.map((row) => row.customer)).toEqual([
			"Primera",
			"Segunda",
			"Tercera",
		]);
	});

	it("keeps the last good rows when the queue cannot be read", async () => {
		let fail = false;
		const queue = useOfflineQueue({
			readHeld: () => {
				if (fail) throw new Error("Dexie is closed");
				return [snapshot()];
			},
		});

		await queue.refresh();
		fail = true;
		await queue.refresh();

		// A queue we cannot read is not a queue that is empty, and telling a
		// shopkeeper with sales in the drawer that there is nothing to upload is
		// the worst available answer.
		expect(queue.rows.value).toHaveLength(1);
	});
});
