import { beforeEach, describe, expect, it, vi } from "vitest";

// --- module mocks -----------------------------------------------------------
// vi.hoisted so the spies exist before the hoisted vi.mock factories run.
const {
	claimRetryableQueueEntries,
	markWriteQueueEntrySynced,
	markWriteQueueEntryFailed,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
} = vi.hoisted(() => ({
	claimRetryableQueueEntries: vi.fn(),
	markWriteQueueEntrySynced: vi.fn(async () => true),
	markWriteQueueEntryFailed: vi.fn(async () => true),
	getQueuedPayloadCount: vi.fn(() => 0),
	getQueuedPayloadSnapshots: vi.fn(() => [{ invoice: {} }]),
}));

vi.mock("../src/offline/writeQueue", () => ({
	claimRetryableQueueEntries,
	markWriteQueueEntrySynced,
	markWriteQueueEntryFailed,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	clearWriteQueueEntries: vi.fn(),
	deleteWriteQueueEntryByIndex: vi.fn(),
	enqueueWriteQueueEntry: vi.fn(),
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
	memory: { pos_last_sync_totals: null },
	persist: vi.fn(),
}));

import {
	reconcileAlreadySubmitted,
	syncOfflineInvoices,
} from "../src/offline/invoices";

const frappeCall = vi.fn();
(globalThis as any).frappe = { call: frappeCall };

function entry() {
	return {
		queue_id: 1,
		last_attempt_at: "2026-07-11T10:00:00Z",
		payload: {
			invoice: {
				posa_client_request_id: "inv-1",
				company: "Doco",
				pos_profile: "Doco Ventas",
				doctype: "Sales Invoice",
			},
			data: {},
		},
	};
}

function methodsCalled() {
	return frappeCall.mock.calls.map((c) => String(c[0].method));
}

beforeEach(() => {
	vi.clearAllMocks();
	getQueuedPayloadCount.mockReturnValue(0);
	getQueuedPayloadSnapshots.mockReturnValue([{ invoice: {} }]);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reconcileAlreadySubmitted", () => {
	it("returns true when the server confirms an already-submitted invoice", async () => {
		frappeCall.mockResolvedValueOnce({ message: { acknowledged: true } });
		expect(
			await reconcileAlreadySubmitted({ posa_client_request_id: "inv-1" }),
		).toBe(true);
	});

	it("returns false when nothing is submitted for the request id", async () => {
		frappeCall.mockResolvedValueOnce({ message: { acknowledged: false } });
		expect(
			await reconcileAlreadySubmitted({ posa_client_request_id: "inv-1" }),
		).toBe(false);
	});

	it("returns false (no server call) when there is no request id", async () => {
		expect(await reconcileAlreadySubmitted({})).toBe(false);
		expect(frappeCall).not.toHaveBeenCalled();
	});

	it("returns false when the reconcile call throws", async () => {
		frappeCall.mockRejectedValueOnce(new Error("no ledger"));
		expect(
			await reconcileAlreadySubmitted({ posa_client_request_id: "inv-1" }),
		).toBe(false);
	});
});

describe("syncOfflineInvoices — ack-miss does not orphan a duplicate", () => {
	it("marks synced (no update_invoice draft) when submit fails but the sale is already submitted", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice")) throw new Error("network lost");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: true } };
			if (method.endsWith("update_invoice")) return { message: {} };
			return {};
		});

		const totals = await syncOfflineInvoices();

		expect(methodsCalled().some((m) => m.endsWith("update_invoice"))).toBe(false);
		expect(markWriteQueueEntrySynced).toHaveBeenCalledTimes(1);
		expect(markWriteQueueEntryFailed).not.toHaveBeenCalled();
		expect(totals).toMatchObject({ synced: 1, drafted: 0 });
	});

	it("still drafts a genuinely-failed sale (not an ack-miss) for operator visibility", async () => {
		claimRetryableQueueEntries.mockResolvedValueOnce([entry()]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice")) throw new Error("validation failed");
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: false } };
			if (method.endsWith("update_invoice")) return { message: {} };
			return {};
		});

		const totals = await syncOfflineInvoices();

		expect(methodsCalled().some((m) => m.endsWith("update_invoice"))).toBe(true);
		expect(totals).toMatchObject({ synced: 0, drafted: 1 });
	});
});
