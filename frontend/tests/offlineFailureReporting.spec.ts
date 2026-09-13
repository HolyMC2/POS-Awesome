/**
 * The offline queue's failure branches report off-device (LOGGING_MAP gap G10).
 *
 * Until now the whole offline layer answered its own failures with
 * `console.error`: ~100 calls across cache/db/customers/persistWorkerBridge,
 * none of which leave the operator's browser. A sale that could not be queued,
 * a replay the server refused, a dead-lettered entry and a corrupt IndexedDB
 * were therefore invisible to anyone not standing at that register with DevTools
 * open. These specs pin that the branches which LOSE OR DELAY A SALE now also
 * go through `posapp/utils/errorReporting.ts`, and that informational logging
 * was left alone.
 *
 * Volume is bounded server-side, not here: `api/utilities.py::log_client_error`
 * dedupes by signature, budgets 20 inserts per site per minute and latches a
 * storm for an hour. The `filename` these reports carry is the scope, which is
 * part of that signature, so one recurring failure is one row with a count.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- module mocks -----------------------------------------------------------
const {
	claimRetryableQueueEntries,
	ensureOfflineQueueReady,
	markWriteQueueEntryDrafted,
	markWriteQueueEntrySynced,
	markWriteQueueEntryFailed,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	enqueueWriteQueueEntry,
	reportOfflineFailure,
} = vi.hoisted(() => ({
	claimRetryableQueueEntries: vi.fn(),
	ensureOfflineQueueReady: vi.fn(async () => {}),
	markWriteQueueEntryDrafted: vi.fn(async () => true),
	markWriteQueueEntrySynced: vi.fn(async () => true),
	markWriteQueueEntryFailed: vi.fn(async () => true),
	getQueuedPayloadCount: vi.fn(() => 0),
	getQueuedPayloadSnapshots: vi.fn(() => [{ invoice: {} }]),
	enqueueWriteQueueEntry: vi.fn(async (_entity: string, entry: any) => entry),
	reportOfflineFailure: vi.fn(),
}));

vi.mock("../src/offline/writeQueue", () => ({
	claimRetryableQueueEntries,
	ensureOfflineQueueReady,
	markWriteQueueEntryDrafted,
	markWriteQueueEntrySynced,
	markWriteQueueEntryFailed,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	clearWriteQueueEntries: vi.fn(),
	deleteWriteQueueEntryByIndex: vi.fn(),
	enqueueWriteQueueEntry,
}));
vi.mock("../src/offline/customers", () => ({
	syncOfflineCustomers: vi.fn(async () => {}),
	updateOfflineInvoicesCustomer: vi.fn(),
}));
vi.mock("../src/offline/cache", () => ({ reduceCacheUsage: vi.fn() }));
vi.mock("../src/offline/stock", () => ({ updateLocalStock: vi.fn() }));
vi.mock("../src/offline/idempotency", () => ({
	ensureOfflineInvoiceRequest: vi.fn(),
}));
vi.mock("../src/offline/invoiceOutbox", () => ({
	getInvoiceOutboxMode: () => "off",
	syncInvoiceOutboxResource: vi.fn(),
	shouldWriteInvoiceOutbox: () => false,
	enqueueInvoiceOutboxEntry: vi.fn(),
}));
vi.mock("../src/offline/db", () => ({
	isOffline: () => false,
	memory: { pos_last_sync_totals: null, pos_opening_storage: {} },
	persist: vi.fn(),
}));
vi.mock("../src/posapp/utils/errorReporting", () => ({ reportOfflineFailure }));

import { syncOfflineInvoices } from "../src/offline/invoices";
import { memory } from "../src/offline/db";

const frappeCall = vi.fn();
(globalThis as any).frappe = {
	session: { user: "cashier@example.com" },
	call: frappeCall,
};

function entry(overrides: Record<string, any> = {}) {
	return {
		queue_id: 77,
		queue_user: "cashier@example.com",
		queue_profile: null,
		last_attempt_at: "2026-09-12T10:00:00Z",
		payload: {
			invoice: {
				posa_client_request_id: "inv-offline-1",
				company: "Doco",
				pos_profile: "Doco Ventas",
				doctype: "Sales Invoice",
			},
			data: {},
		},
		...overrides,
	};
}

/** The report for one scope, or undefined. */
function reportFor(scope: string) {
	return reportOfflineFailure.mock.calls.find((call) => call[0] === scope);
}

beforeEach(() => {
	vi.clearAllMocks();
	getQueuedPayloadCount.mockReturnValue(0);
	getQueuedPayloadSnapshots.mockReturnValue([{ invoice: {} }]);
	memory.pos_opening_storage = {};
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a replay the server refuses", () => {
	it("reports the rejection that turns the sale into a draft", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice"))
				throw new Error("validation failed");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: false } };
			if (method.endsWith("update_invoice"))
				return { message: { name: "ACC-SINV-2026-00001" } };
			return {};
		});

		await syncOfflineInvoices();

		const report = reportFor("offline.invoice.replay_rejected");
		expect(report).toBeTruthy();
		expect(report?.[2]).toMatchObject({
			clientId: "inv-offline-1",
			queueId: 77,
			entityType: "invoice",
		});
	});

	it("does not report an ack-miss: that sale is already safe on the server", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice"))
				throw new Error("network lost");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: true } };
			return {};
		});

		await syncOfflineInvoices();

		expect(markWriteQueueEntrySynced).toHaveBeenCalledTimes(1);
		expect(reportOfflineFailure).not.toHaveBeenCalled();
	});

	it("reports nothing at all when the replay simply succeeds", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockResolvedValue({ message: {} });

		await syncOfflineInvoices();

		expect(reportOfflineFailure).not.toHaveBeenCalled();
	});
});

describe("an entry that reaches the dead letter", () => {
	it("reports when the draft fallback fails too", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice"))
				throw new Error("validation failed");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: false } };
			if (method.endsWith("update_invoice"))
				throw new Error("draft refused too");
			return {};
		});

		await syncOfflineInvoices();

		expect(markWriteQueueEntryFailed).toHaveBeenCalledTimes(1);
		const report = reportFor("offline.invoice.dead_letter");
		expect(report).toBeTruthy();
		expect(report?.[2]).toMatchObject({
			clientId: "inv-offline-1",
			reason: "draft_fallback_failed",
		});
	});

	it("reports the capability-mismatch draft failure that used to be silent", async () => {
		// This branch had no console line either: the entry dead-lettered with
		// no trace anywhere.
		// The register's CURRENT capability version comes off the opening
		// storage mirror; the queued sale carries the one it was built under.
		memory.pos_opening_storage = { capability_profile: { version: 7 } };
		const queued = entry();
		queued.payload.data = { posa_capability_version: 3 };
		claimRetryableQueueEntries.mockResolvedValueOnce([queued]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: false } };
			if (method.endsWith("update_invoice"))
				throw new Error("draft refused");
			return {};
		});

		await syncOfflineInvoices();

		const report = reportFor("offline.invoice.dead_letter");
		expect(report).toBeTruthy();
		expect(report?.[2]).toMatchObject({ reason: "capability_draft_failed" });
	});
});

describe("payload hygiene", () => {
	it("carries no customer data into the report", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([
			entry({
				payload: {
					invoice: {
						posa_client_request_id: "inv-offline-9",
						customer: "CUST-0042",
						customer_name: "Maria Perez",
						contact_mobile: "6691234567",
						doctype: "Sales Invoice",
					},
					data: {},
				},
			}),
		]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice")) throw new Error("refused");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: false } };
			return { message: {} };
		});

		await syncOfflineInvoices();

		const serialised = JSON.stringify(reportOfflineFailure.mock.calls);
		expect(serialised).not.toContain("Maria Perez");
		expect(serialised).not.toContain("6691234567");
		expect(serialised).not.toContain("CUST-0042");
		expect(serialised).toContain("inv-offline-9");
	});

	it("keeps the context to the documented scalar keys", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice")) throw new Error("refused");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: false } };
			return { message: {} };
		});

		await syncOfflineInvoices();

		const allowed = new Set([
			"queueLength",
			"clientId",
			"queueId",
			"entityType",
			"key",
			"reason",
		]);
		for (const call of reportOfflineFailure.mock.calls) {
			for (const key of Object.keys(call[2] ?? {})) {
				expect(allowed.has(key)).toBe(true);
			}
		}
	});
});
