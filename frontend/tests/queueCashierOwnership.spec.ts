// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, initPromise, memory, clearAllCache } from "../src/offline/db";
import {
	claimRetryableQueueEntries, clearWriteQueueEntries, deleteWriteQueueEntry,
	enqueueWriteQueueEntry, getQueueEntries, getQueuedPayloadSnapshots,
	markWriteQueueEntryFailed, migrateLegacyOfflineQueues, refreshQueueMemory,
	requeueWriteQueueDeadLetter, updateQueuedPayloads, exportLegacyQueueRecovery,
} from "../src/offline/writeQueue";
import { saveOfflineInvoice } from "../src/offline/invoices";
import { enqueueInvoiceOutboxEntry, getInvoiceOutboxRows, syncInvoiceOutboxResource } from "../src/offline/invoiceOutbox";

function login(user: string, profile = "COUNTER-A") {
	(globalThis as any).frappe = { session: { user }, user_roles: [] };
	memory.pos_opening_storage = { pos_profile: { name: profile }, pos_opening_shift: { user, pos_profile: profile } };
}
const sale = (id = "sale-1") => ({ invoice: { posa_client_request_id: id, pos_profile: "COUNTER-A", items: [{ item_code: "ITEM", qty: 1 }] }, data: {} });

describe("cashier-owned durable queues", () => {
	beforeEach(async () => {
		await initPromise;
		await db.table("write_queue").clear();
		await db.table("invoice_outbox").clear();
		for (const key of ["offline_invoices", "offline_customers", "offline_payments", "offline_cash_movements"]) memory[key] = [];
		login("alice@example.com");
	});

	it("hides durable and already-loaded snapshots after an account or register switch", async () => {
		const entry = await enqueueWriteQueueEntry("invoice", sale());
		expect(getQueuedPayloadSnapshots("invoice")).toHaveLength(1);
		login("bob@example.com");
		expect(getQueuedPayloadSnapshots("invoice")).toEqual([]);
		expect(await getQueueEntries("invoice")).toEqual([]);
		expect(await claimRetryableQueueEntries("invoice")).toEqual([]);
		await deleteWriteQueueEntry("invoice", Number(entry.queue_id));
		await clearWriteQueueEntries("invoice");
		await updateQueuedPayloads("invoice", () => ({ overwritten: true }));
		expect((await db.table("write_queue").get(entry.queue_id)).payload).toEqual(expect.objectContaining({ invoice: sale().invoice }));
		login("alice@example.com", "COUNTER-B");
		expect(await claimRetryableQueueEntries("invoice")).toEqual([]);
		login("alice@example.com");
		await refreshQueueMemory("invoice");
		expect(getQueuedPayloadSnapshots("invoice")).toHaveLength(1);
	});

	it("does not mutate another cashier's claimed or dead-letter entry by id", async () => {
		const entry = await enqueueWriteQueueEntry("invoice", sale());
		const [claimed] = await claimRetryableQueueEntries("invoice");
		login("bob@example.com");
		expect(await markWriteQueueEntryFailed("invoice", Number(entry.queue_id), "error", claimed.last_attempt_at)).toBe(false);
		await db.table("write_queue").update(entry.queue_id, { status: "dead_letter" });
		expect(await requeueWriteQueueDeadLetter(Number(entry.queue_id))).toBeNull();
		expect((await db.table("write_queue").get(entry.queue_id)).status).toBe("dead_letter");
	});

	it("preserves pending sales even when the owner clears the queue", async () => {
		const entry = await enqueueWriteQueueEntry("invoice", sale());
		await clearWriteQueueEntries("invoice");
		await deleteWriteQueueEntry("invoice", Number(entry.queue_id));
		expect(await db.table("write_queue").count()).toBe(1);
	});

	it("quarantines unowned legacy sales without assigning the next login and allows manager recovery", async () => {
		memory.offline_invoices = [sale("historic")];
		await migrateLegacyOfflineQueues();
		const [row] = await db.table("write_queue").toArray();
		expect(row.queue_user).toBeUndefined();
		expect(row.payload.invoice.posa_client_request_id).toBe("historic");
		expect(await claimRetryableQueueEntries("invoice")).toEqual([]);
		await expect(exportLegacyQueueRecovery()).rejects.toThrow("System Manager");
		await db.table("invoice_outbox").add({ client_request_id: "unknown-ack", status: "acknowledged", invoice: {} });
		login("Administrator");
		const recovery = await exportLegacyQueueRecovery();
		expect(recovery.write_queue).toHaveLength(1);
		expect(recovery.invoice_outbox).toHaveLength(1);
		expect(await db.table("write_queue").count()).toBe(1);
	});

	it("does not coalesce another cashier's customer update", async () => {
		await enqueueWriteQueueEntry("customer", { args: { customer_id: "C-1", customer_name: "Alice edit" } });
		login("bob@example.com");
		await enqueueWriteQueueEntry("customer", { args: { customer_id: "C-1", customer_name: "Bob edit" } });
		expect(await db.table("write_queue").count()).toBe(2);
		expect((await getQueueEntries("customer"))[0].payload.args.customer_name).toBe("Bob edit");
	});

	it("prevents outbox replay and exposure under another login and stops across a mid-drain switch", async () => {
		await enqueueInvoiceOutboxEntry(sale("one"));
		await enqueueInvoiceOutboxEntry(sale("two"));
		login("bob@example.com");
		expect(await getInvoiceOutboxRows({ includeTerminal: true })).toEqual([]);
		const send = vi.fn(async () => { login("bob@example.com"); return { acknowledged: true }; });
		await syncInvoiceOutboxResource(send);
		expect(send).not.toHaveBeenCalled();
		login("alice@example.com");
		await syncInvoiceOutboxResource(send);
		expect(send).toHaveBeenCalledTimes(1);
		expect(await db.table("invoice_outbox").count()).toBe(2);
	});

	it("preserves queued sales during cache clearing even for another cashier", async () => {
		const entry = await enqueueWriteQueueEntry("invoice", sale());
		await db.table("items").put({ item_code: "cached" });
		login("bob@example.com");
		await clearAllCache();
		expect(await db.table("write_queue").get(entry.queue_id)).toBeTruthy();
		expect(await db.table("items").count()).toBe(0);
	});

	it("blocks stale-tab replay when another tab changes the login cookie", async () => {
		await enqueueWriteQueueEntry("invoice", sale());
		document.cookie = "user_id=bob%40example.com; path=/";
		try { expect(await claimRetryableQueueEntries("invoice")).toEqual([]); }
		finally { document.cookie = "user_id=; Max-Age=0; path=/"; }
	});

	it("keeps a durable sale when the browser denies eviction protection", async () => {
		Object.defineProperty(navigator, "storage", { configurable: true, value: {
			persisted: async () => false, persist: async () => false,
		} });
		const entry = await enqueueWriteQueueEntry("invoice", sale());
		expect((await db.table("write_queue").get(entry.queue_id)).status).toBe("pending");
	});

	it("retries an interrupted legacy migration without losing or duplicating rows", async () => {
		memory.offline_invoices = [sale("legacy-one"), sale("legacy-two")];
		const table = db.table("write_queue");
		const originalAdd = table.add.bind(table);
		let writes = 0;
		const failingAdd = vi.spyOn(table, "add").mockImplementation((...args: any[]) => {
			if (++writes === 2) return Promise.reject(new Error("QuotaExceededError")) as any;
			return originalAdd(...args as [any]);
		});
		await expect(migrateLegacyOfflineQueues()).rejects.toThrow("QuotaExceededError");
		failingAdd.mockRestore();
		expect(memory.offline_invoices).toHaveLength(2);
		await migrateLegacyOfflineQueues();
		expect(await table.count()).toBe(2);
		expect(await claimRetryableQueueEntries("invoice")).toEqual([]);
	});

	it("extracts payment ownership from the serialized POS Profile object", async () => {
		const entry = await enqueueWriteQueueEntry("payment", { args: { payload: {
			client_request_id: "payment-profile", pos_profile: { name: "COUNTER-A" },
		} } });
		expect(entry.queue_profile).toBe("COUNTER-A");
		login("alice@example.com", "COUNTER-B");
		expect(await claimRetryableQueueEntries("payment")).toEqual([]);
	});

	it("claims outbox work once across simultaneous drains", async () => {
		await enqueueInvoiceOutboxEntry(sale("concurrent"));
		const send = vi.fn(async () => ({ acknowledged: true }));
		await Promise.all([syncInvoiceOutboxResource(send), syncInvoiceOutboxResource(send)]);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("updates local stock once per accepted invoice and restores returned quantities", async () => {
		memory.local_stock_cache = { ITEM: { actual_qty: 20 } };
		const entry = sale("stock-dedup");
		await saveOfflineInvoice(entry);
		await saveOfflineInvoice(entry);
		expect(memory.local_stock_cache.ITEM.actual_qty).toBe(19);
		const returned = sale("stock-return");
		Object.assign(returned.invoice, { is_return: 1 });
		returned.invoice.items[0].qty = -2;
		await saveOfflineInvoice(returned);
		expect(memory.local_stock_cache.ITEM.actual_qty).toBe(21);
	});

	it("translates ownership refusals through the register translator", async () => {
		login("Guest");
		(globalThis as any).frappe._ = vi.fn(() => "Inicia sesión antes de guardar registros en esta caja.");
		await expect(enqueueWriteQueueEntry("invoice", sale())).rejects.toThrow("Inicia sesión");
		expect((globalThis as any).frappe._).toHaveBeenCalledWith("Sign in before saving work on this register.");
	});

	it("refuses unauthenticated new work", async () => {
		login("Guest");
		await expect(enqueueWriteQueueEntry("invoice", sale())).rejects.toThrow("Sign in");
		expect(await db.table("write_queue").count()).toBe(0);
	});
});
