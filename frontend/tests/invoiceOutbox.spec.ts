// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	db,
	getInvoiceOutboxRows,
	getPendingInvoiceOutboxCount,
	getPendingOfflineInvoiceCount,
	initPromise,
	memory,
	saveOfflineInvoice,
	setInvoiceOutboxMode,
} from "../src/offline/index";
import { runSupportedOfflineSyncResource } from "../src/offline/sync/resourceRunner";
import { syncInvoiceOutboxResource } from "../src/offline/invoiceOutbox";
import { getPendingShiftWorkCount } from "../src/offline/shiftQueueGuard";
import {
	getSyncResourceDefinitions,
	getSyncResourcesForTrigger,
} from "../src/offline/sync/resourceRegistry";

describe("invoice outbox sync resource", () => {
	beforeEach(async () => {
		(globalThis as any).frappe = { session: { user: "cashier@example.com" } };
		await initPromise;
		memory.pos_opening_storage = { pos_profile: { name: "Main POS" } };
		await db.table("write_queue").clear();
		await db.table("queue").clear();
		await db.table("keyval").clear();
		await db.table("invoice_outbox").clear();
		localStorage.clear();
		memory.offline_invoices = [];
		setInvoiceOutboxMode("off");
	});

	it("dual-writes offline invoices and keeps legacy/coordinator counts aligned", async () => {
		setInvoiceOutboxMode("dual_write");

		await saveOfflineInvoice({
			invoice: {
				name: "OFFLINE-SINV-OUTBOX-1",
				customer: "CUST-001",
				pos_profile: "Main POS",
				company: "Test Company",
				posa_client_request_id: "outbox-fixed-001",
				items: [{ item_code: "ITEM-1", item_name: "Item 1", qty: 1 }],
			},
			data: { idempotency_key: "outbox-fixed-001" },
		});

		expect(getPendingOfflineInvoiceCount()).toBe(1);
		expect(await getPendingInvoiceOutboxCount()).toBe(1);
		expect(await getInvoiceOutboxRows()).toEqual([
			expect.objectContaining({
				client_request_id: "outbox-fixed-001",
				status: "pending",
			}),
		]);
	});

	it("submits an outbox row once across repeated reconnect triggers", async () => {
		setInvoiceOutboxMode("dual_write");
		await saveOfflineInvoice({
			invoice: {
				name: "OFFLINE-SINV-OUTBOX-2",
				customer: "CUST-001",
				pos_profile: "Main POS",
				company: "Test Company",
				posa_client_request_id: "outbox-fixed-002",
				items: [{ item_code: "ITEM-1", item_name: "Item 1", qty: 1 }],
			},
			data: { idempotency_key: "outbox-fixed-002" },
		});

		const callOfflineSyncMethod = vi.fn(async () => ({
			acknowledged: true,
			client_request_id: "outbox-fixed-002",
			invoice: {
				name: "ACC-SINV-OUTBOX-0001",
				doctype: "Sales Invoice",
				docstatus: 1,
			},
		}));
		const resource = getSyncResourceDefinitions().find(
			(entry) => entry.id === "invoice_outbox",
		);

		await runSupportedOfflineSyncResource({
			resource: resource as any,
			posProfile: {
				name: "Main POS",
				company: "Test Company",
			},
			schemaVersion: "2026-04-09",
			getPersistedState: vi.fn(async () => null),
			callOfflineSyncMethod,
		});
		await runSupportedOfflineSyncResource({
			resource: resource as any,
			posProfile: {
				name: "Main POS",
				company: "Test Company",
			},
			schemaVersion: "2026-04-09",
			getPersistedState: vi.fn(async () => null),
			callOfflineSyncMethod,
		});

		expect(callOfflineSyncMethod).toHaveBeenCalledTimes(1);
		expect(await getPendingInvoiceOutboxCount()).toBe(0);
		expect(await getInvoiceOutboxRows({ includeTerminal: true })).toEqual([
			expect.objectContaining({
				status: "acknowledged",
				invoice_name: "ACC-SINV-OUTBOX-0001",
			}),
		]);
	});

	it("retries a failed reconnect replay without duplicating the final invoice", async () => {
		setInvoiceOutboxMode("dual_write");
		await saveOfflineInvoice({
			invoice: {
				name: "OFFLINE-SINV-OUTBOX-RETRY",
				customer: "CUST-001",
				pos_profile: "Main POS",
				company: "Test Company",
				posa_client_request_id: "outbox-fixed-retry",
				items: [{ item_code: "ITEM-1", item_name: "Item 1", qty: 1 }],
			},
			data: { idempotency_key: "outbox-fixed-retry" },
		});

		const callOfflineSyncMethod = vi
			.fn()
			.mockRejectedValueOnce(new Error("network offline"))
			.mockResolvedValueOnce({
				acknowledged: true,
				client_request_id: "outbox-fixed-retry",
				invoice: {
					name: "ACC-SINV-OUTBOX-RETRY-0001",
					doctype: "Sales Invoice",
					docstatus: 1,
				},
			});
		const resource = getSyncResourceDefinitions().find(
			(entry) => entry.id === "invoice_outbox",
		);
		const runReplay = () =>
			runSupportedOfflineSyncResource({
				resource: resource as any,
				posProfile: {
					name: "Main POS",
					company: "Test Company",
				},
				schemaVersion: "2026-04-09",
				getPersistedState: vi.fn(async () => null),
				callOfflineSyncMethod,
			});

		await runReplay();
		expect(await getInvoiceOutboxRows()).toEqual([
			expect.objectContaining({
				client_request_id: "outbox-fixed-retry",
				status: "retrying",
			}),
		]);

		const [retryRow] = await getInvoiceOutboxRows();
		await db.table("invoice_outbox").put({
			...retryRow,
			next_retry_at: new Date(Date.now() - 1_000).toISOString(),
			nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
		});
		await runReplay();
		await runReplay();

		expect(callOfflineSyncMethod).toHaveBeenCalledTimes(2);
		expect(await getPendingInvoiceOutboxCount()).toBe(0);
		expect(await getInvoiceOutboxRows({ includeTerminal: true })).toEqual([
			expect.objectContaining({
				status: "acknowledged",
				invoice_name: "ACC-SINV-OUTBOX-RETRY-0001",
			}),
		]);
	});

	it("completes a coordinator sale in both queues without touching foreign or unknown owners", async () => {
		setInvoiceOutboxMode("coordinator");
		await saveOfflineInvoice({ invoice: {
			pos_profile: "Main POS", posa_pos_opening_shift: "OPEN-1", posa_client_request_id: "coordinator-sale", items: [{ item_code: "ITEM-1", qty: 1 }],
		}, data: {} });
		const [mirror] = await db.table("write_queue").toArray();
		await db.table("write_queue").bulkAdd([
			{ ...mirror, queue_id: undefined, queue_user: "other@example.com", idempotency_key: "foreign" },
			{ ...mirror, queue_id: undefined, queue_user: undefined, idempotency_key: "unknown" },
		]);
		await syncInvoiceOutboxResource(async () => ({ acknowledged: true, invoice: { name: "SINV-1", docstatus: 1 } }));
		expect(getPendingOfflineInvoiceCount()).toBe(0);
		expect(await getPendingInvoiceOutboxCount()).toBe(0);
		const rows = await db.table("write_queue").toArray();
		expect(rows.map((row) => row.status)).toEqual(["synced", "pending", "pending"]);
		await db.table("write_queue").bulkDelete(rows.slice(1).map((row) => row.queue_id));
		expect(await getPendingShiftWorkCount({ name: "OPEN-1", pos_profile: "Main POS" })).toBe(0);
	});

	it.each([0, 2, undefined])("keeps an unverified document (%s) pending despite the acknowledgement flag", async (docstatus) => {
		setInvoiceOutboxMode("coordinator");
		await saveOfflineInvoice({ invoice: {
			pos_profile: "Main POS", posa_pos_opening_shift: "OPEN-1", posa_client_request_id: "held-sale", items: [{ item_code: "ITEM-1", qty: 1 }],
		}, data: {} });
		await syncInvoiceOutboxResource(async () => ({ acknowledged: true, invoice: { name: "SINV-HELD", docstatus } }));
		expect(getPendingOfflineInvoiceCount()).toBe(1);
		expect((await getInvoiceOutboxRows())[0].status).toBe("retrying");
		expect(await getPendingShiftWorkCount({ name: "OPEN-1", pos_profile: "Main POS" })).toBeGreaterThan(0);
	});

	async function seedHistoricalAcknowledgement() {
		setInvoiceOutboxMode("coordinator");
		await saveOfflineInvoice({ invoice: {
			doctype: "Sales Invoice", company: "Test Company", pos_profile: "Main POS",
			posa_pos_opening_shift: "OPEN-1", posa_client_request_id: "historical-sale", items: [{ item_code: "ITEM-1", qty: 1 }],
		}, data: {} });
		const [row] = await db.table("invoice_outbox").toArray();
		await db.table("invoice_outbox").put({ ...row, status: "acknowledged", invoice_name: "SINV-OLD" });
	}

	const verifiedHistoricalResponse = () => ({ acknowledged: true, client_request_id: "historical-sale",
		invoice: { name: "SINV-OLD", doctype: "Sales Invoice", docstatus: 1 } });

	it("verifies old acknowledgements using server identity before clearing their stranded mirror", async () => {
		await seedHistoricalAcknowledgement();
		expect(await getPendingInvoiceOutboxCount()).toBe(1);
		expect(await getPendingShiftWorkCount({ name: "OPEN-1", pos_profile: "Main POS" })).toBeGreaterThan(0);
		const verify = vi.fn(async () => verifiedHistoricalResponse());
		await syncInvoiceOutboxResource(verify);
		expect(verify).toHaveBeenCalledWith(expect.stringContaining(".reconcile_invoice_outbox_entry"), {
			client_request_id: "historical-sale", company: "Test Company", pos_profile: "Main POS", document_type: "Sales Invoice",
		});
		expect((await getInvoiceOutboxRows({ includeTerminal: true }))[0].server_verified).toBe(true);
		expect(getPendingOfflineInvoiceCount()).toBe(0);
		expect(await getPendingShiftWorkCount({ name: "OPEN-1", pos_profile: "Main POS" })).toBe(0);
		await syncInvoiceOutboxResource(verify);
		expect(verify).toHaveBeenCalledTimes(1);
	});

	it.each(["request", "name", "doctype", "draft"])("preserves old money when reconciliation returns a mismatched %s", async (mismatch) => {
		await seedHistoricalAcknowledgement();
		const response = verifiedHistoricalResponse();
		if (mismatch === "request") response.client_request_id = "other";
		if (mismatch === "name") response.invoice.name = "SINV-OTHER";
		if (mismatch === "doctype") response.invoice.doctype = "POS Invoice";
		if (mismatch === "draft") response.invoice.docstatus = 0;
		await syncInvoiceOutboxResource(async () => response);
		const [row] = await getInvoiceOutboxRows();
		expect(row).toMatchObject({ status: "retrying", reconcile_only: true });
		expect(row.server_verified).not.toBe(true);
		expect(getPendingOfflineInvoiceCount()).toBe(1);
	});

	it("resumes an expired historical verification lease with reconciliation, never sale submission", async () => {
		await seedHistoricalAcknowledgement();
		const [row] = await db.table("invoice_outbox").toArray();
		await db.table("invoice_outbox").put({ ...row, status: "syncing", reconcile_only: true,
			updated_at: new Date(Date.now() - 6 * 60_000).toISOString() });
		const verify = vi.fn(async () => { throw new Error("No invoice submission ledger found for this request"); });
		await syncInvoiceOutboxResource(verify);
		expect(verify.mock.calls[0][0]).toContain(".reconcile_invoice_outbox_entry");
		expect((await getInvoiceOutboxRows())[0]).toMatchObject({ status: "retrying", reconcile_only: true });
		expect(getPendingOfflineInvoiceCount()).toBe(1);
	});

	it("registers invoice_outbox as a warm reconnect resource", () => {
		expect(
			getSyncResourcesForTrigger("online_resume").map(
				(entry) => entry.id,
			),
		).toContain("invoice_outbox");
		expect(
			getSyncResourceDefinitions().find(
				(entry) => entry.id === "invoice_outbox",
			),
		).toEqual(
			expect.objectContaining({
				priority: "warm",
				storageKey: "invoice_outbox",
			}),
		);
	});
});
