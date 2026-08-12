// @vitest-environment jsdom

import "fake-indexeddb/auto";

import Dexie from "dexie/dist/dexie.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearAllCache,
	clearDerivedOfflineCaches,
	db,
	checkDbHealth,
	getPendingTransactionalWorkCounts,
	initPromise,
	isCorruptionError,
	isOfflineStorageDegraded,
	memory,
	pruneOfflineStorage,
	quickDbHealthCheck,
	repairDbAfterFailedHealthCheck,
	safeBulkPut,
} from "../src/offline/index";

describe("offline IndexedDB maintenance", () => {
	beforeEach(async () => {
		await initPromise;
		for (const table of [
			"invoice_outbox",
			"sync_state",
			"keyval",
			"queue",
			"write_queue",
		]) {
			await db.table(table).clear();
		}
		vi.useRealTimers();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("writes large batches through one bulkPut call", async () => {
		const rows = Array.from({ length: 1500 }, (_, index) => ({
			key: `telemetry:${index}`,
			value: { created_at: new Date(2026, 0, 1).toISOString(), index },
		}));
		const bulkSpy = vi.spyOn(db.table("keyval"), "bulkPut");

		await safeBulkPut("keyval", rows);

		expect(bulkSpy).toHaveBeenCalledTimes(1);
		expect(await db.table("keyval").count()).toBe(1500);
	});

	it("classifies only genuine corruption as fatal, not transient multi-tab errors", () => {
		// Transient — another tab mid-upgrade. Must NOT trigger a Dexie.delete
		// that would wipe unsynced offline sales.
		expect(isCorruptionError({ name: "InvalidStateError" })).toBe(false);
		expect(isCorruptionError({ name: "NotFoundError" })).toBe(false);
		expect(isCorruptionError({ name: "AbortError" })).toBe(false);
		expect(isCorruptionError(null)).toBe(false);
		expect(isCorruptionError("boom")).toBe(false);
		// Version skew is non-destructive; only explicit corruption is fatal.
		expect(isCorruptionError({ name: "VersionError" })).toBe(false);
		expect(
			isCorruptionError({ name: "UnknownError", message: "database is corrupt" }),
		).toBe(true);
	});

	it("counts active and dead-letter transactional work but ignores resolved rows", async () => {
		await db.table("write_queue").bulkPut([
			{
				entity_type: "invoice",
				status: "pending",
				idempotency_key: "pending-write",
			},
			{
				entity_type: "invoice",
				status: "dead_letter",
				idempotency_key: "dead-write",
			},
			{
				entity_type: "invoice",
				status: "synced",
				idempotency_key: "synced-write",
			},
		]);
		await db.table("invoice_outbox").bulkPut([
			{ client_request_id: "retry-outbox", status: "retrying" },
			{ client_request_id: "dead-outbox", status: "dead_letter" },
			{ client_request_id: "acked-outbox", status: "acknowledged" },
		]);

		await expect(getPendingTransactionalWorkCounts()).resolves.toEqual({
			writeQueue: 2,
			invoiceOutbox: 2,
			total: 4,
		});
	});

	it("clears derived catalog rows without touching transactional queues", async () => {
		await db.table("items").put({ item_code: "ITEM-1", item_name: "Cached item" });
		await db.table("write_queue").put({
			entity_type: "invoice",
			status: "pending",
			idempotency_key: "keep-write",
		});
		await db.table("invoice_outbox").put({
			client_request_id: "keep-outbox",
			status: "pending",
		});

		await clearDerivedOfflineCaches();

		expect(await db.table("items").count()).toBe(0);
		expect(await db.table("write_queue").count()).toBe(1);
		expect(await db.table("invoice_outbox").count()).toBe(1);
	});

	it("clearAllCache resets PII/financial memory caches so they can't re-persist", async () => {
		memory.stored_value_snapshot_cache = { "CUST-1": { balance: 500 } };
		memory.gift_card_snapshot_cache = { "GC-1": { code: "secret" } };
		memory.customer_addresses_cache = { "CUST-1": [{ city: "x" }] };
		memory.payment_method_currency_cache = { Cash: "MXN" };
		memory.exchange_rate_cache = { "USD:MXN": 17 };
		memory.schema_signature = "old-sig";

		await clearAllCache();

		expect(memory.stored_value_snapshot_cache).toEqual({});
		expect(memory.gift_card_snapshot_cache).toEqual({});
		expect(memory.customer_addresses_cache).toEqual({});
		expect(memory.payment_method_currency_cache).toEqual({});
		expect(memory.exchange_rate_cache).toEqual({});
		expect(memory.schema_signature).toBeNull();
	});

	it("prunes terminal outbox rows and stale metadata while retaining active rows", async () => {
		const oldIso = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
		const freshIso = new Date().toISOString();
		await db.table("invoice_outbox").bulkPut([
			{
				client_request_id: "old-ack",
				status: "acknowledged",
				invoice: {},
				data: {},
				created_at: oldIso,
				updated_at: oldIso,
				next_retry_at: null,
				retry_count: 0,
				last_error: null,
				invoice_name: "ACC-SINV-1",
				acknowledged_at: oldIso,
			},
			{
				client_request_id: "pending",
				status: "pending",
				invoice: {},
				data: {},
				created_at: oldIso,
				updated_at: oldIso,
				next_retry_at: null,
				retry_count: 0,
				last_error: null,
				invoice_name: null,
				acknowledged_at: null,
			},
			{
				client_request_id: "fresh-ack",
				status: "acknowledged",
				invoice: {},
				data: {},
				created_at: freshIso,
				updated_at: freshIso,
				next_retry_at: null,
				retry_count: 0,
				last_error: null,
				invoice_name: "ACC-SINV-2",
				acknowledged_at: freshIso,
			},
		]);
		await db.table("sync_state").bulkPut([
			{
				key: "posa_sync_state::old",
				resourceId: "old",
				status: "fresh",
				nextRetryAt: null,
				value: { resourceId: "old", lastSyncedAt: oldIso },
				updated_at: oldIso,
			},
			{
				key: "posa_sync_state::fresh",
				resourceId: "fresh",
				status: "fresh",
				nextRetryAt: null,
				value: { resourceId: "fresh", lastSyncedAt: freshIso },
				updated_at: freshIso,
			},
		]);
		await db.table("keyval").bulkPut([
			{ key: "local_telemetry:old", value: { created_at: oldIso } },
			{ key: "local_telemetry:fresh", value: { created_at: freshIso } },
		]);

		const result = await pruneOfflineStorage({ now: Date.now(), maxAgeDays: 30 });

		expect(result.invoiceOutbox).toBe(1);
		expect(result.syncState).toBe(1);
		expect(result.localTelemetry).toBe(1);
		expect(await db.table("invoice_outbox").toArray()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ client_request_id: "pending" }),
				expect.objectContaining({ client_request_id: "fresh-ack" }),
			]),
		);
		expect(await db.table("sync_state").toArray()).toEqual([
			expect.objectContaining({ key: "posa_sync_state::fresh" }),
		]);
		expect(await db.table("keyval").toArray()).toEqual([
			expect.objectContaining({ key: "local_telemetry:fresh" }),
		]);
	});

	it("keeps failed quick health checks non-destructive", async () => {
		const isOpenSpy = vi.spyOn(db, "isOpen").mockReturnValue(false);
		const openSpy = vi.spyOn(db, "open").mockRejectedValue(new Error("open failed"));

		await expect(quickDbHealthCheck()).resolves.toBe(false);

		expect(openSpy).toHaveBeenCalledTimes(1);
		isOpenSpy.mockRestore();
		openSpy.mockRestore();
	});

	it("uses the controlled repair path after a failed IndexedDB health check", async () => {
		const isOpenSpy = vi.spyOn(db, "isOpen").mockReturnValue(false);
		const openSpy = vi
			.spyOn(db, "open")
			.mockRejectedValueOnce(new Error("open failed"))
			.mockResolvedValueOnce(db);

		await expect(checkDbHealth()).resolves.toBe(true);

		expect(openSpy).toHaveBeenCalledTimes(2);
		isOpenSpy.mockRestore();
		openSpy.mockRestore();
	});

	it("allows callers to enter degraded mode when controlled repair cannot open the DB", async () => {
		const isOpenSpy = vi.spyOn(db, "isOpen").mockReturnValue(false);
		const openSpy = vi.spyOn(db, "open").mockRejectedValue(new Error("blocked"));

		await expect(repairDbAfterFailedHealthCheck()).resolves.toBe(false);

		expect(openSpy).toHaveBeenCalledTimes(1);
		isOpenSpy.mockRestore();
		openSpy.mockRestore();
	});

	it("enters Limited mode without deleting IndexedDB on VersionError", async () => {
		const deleteSpy = vi
			.spyOn(Dexie, "delete")
			.mockResolvedValue(undefined);
		const versionError = Object.assign(new Error("newer schema"), {
			name: "VersionError",
		});

		await expect(
			repairDbAfterFailedHealthCheck(versionError),
		).resolves.toBe(false);

		expect(deleteSpy).not.toHaveBeenCalled();
		expect(isOfflineStorageDegraded()).toBe(true);
		expect(memory.bootstrap_limited_mode).toBe(true);
	});
});
