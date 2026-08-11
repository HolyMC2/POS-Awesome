import { beforeEach, describe, expect, it, vi } from "vitest";

// --- module mocks -----------------------------------------------------------
// vi.hoisted so the spies exist before the hoisted vi.mock factories run.
const {
	claimRetryableQueueEntries,
	markWriteQueueEntrySynced,
	markWriteQueueEntryFailed,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	enqueueWriteQueueEntry,
} = vi.hoisted(() => ({
	claimRetryableQueueEntries: vi.fn(),
	markWriteQueueEntrySynced: vi.fn(async () => true),
	markWriteQueueEntryFailed: vi.fn(async () => true),
	getQueuedPayloadCount: vi.fn(() => 0),
	getQueuedPayloadSnapshots: vi.fn(() => [{ invoice: {} }]),
	enqueueWriteQueueEntry: vi.fn(async (_entity: string, entry: any) => entry),
}));

vi.mock("../src/offline/writeQueue", () => ({
	claimRetryableQueueEntries,
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

import {
	getOfflineCapabilityVersion,
	reconcileAlreadySubmitted,
	saveOfflineInvoice,
	syncOfflineInvoices,
} from "../src/offline/invoices";
import { memory } from "../src/offline/db";

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

describe("syncOfflineInvoices — capability version guard (plan C7)", () => {
	function versionedEntry(version: number) {
		const e = entry();
		e.payload.data = { posa_capability_version: version };
		return e;
	}

	function setOpeningVersion(version: number | null) {
		(memory as any).pos_opening_storage = {
			// capability_profile is a sibling of the opening data (plan C7).
			capability_profile: version === null ? null : { name: "p", version },
		};
	}

	it("reads the current version from the opening storage", () => {
		setOpeningVersion(3);
		expect(getOfflineCapabilityVersion()).toBe(3);
		setOpeningVersion(null);
		expect(getOfflineCapabilityVersion()).toBeUndefined();
	});

	it("drafts (does not auto-submit) an invoice built under a different version", async () => {
		setOpeningVersion(2);
		claimRetryableQueueEntries.mockResolvedValueOnce([versionedEntry(1)]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("update_invoice")) return { message: {} };
			return {};
		});

		const totals = await syncOfflineInvoices();

		expect(methodsCalled().some((m) => m.endsWith("submit_invoice"))).toBe(false);
		expect(methodsCalled().some((m) => m.endsWith("update_invoice"))).toBe(true);
		expect(totals).toMatchObject({ synced: 0, drafted: 1 });
	});

	it("submits normally when the versions match", async () => {
		setOpeningVersion(2);
		claimRetryableQueueEntries.mockResolvedValueOnce([versionedEntry(2)]);
		frappeCall.mockResolvedValue({ message: {} });

		const totals = await syncOfflineInvoices();

		expect(methodsCalled().some((m) => m.endsWith("submit_invoice"))).toBe(true);
		expect(totals).toMatchObject({ synced: 1, drafted: 0 });
	});

	it("submits normally when the register has no preset (retail default)", async () => {
		setOpeningVersion(null);
		claimRetryableQueueEntries.mockResolvedValueOnce([versionedEntry(1)]);
		frappeCall.mockResolvedValue({ message: {} });

		const totals = await syncOfflineInvoices();

		expect(methodsCalled().some((m) => m.endsWith("submit_invoice"))).toBe(true);
		expect(totals).toMatchObject({ synced: 1, drafted: 0 });
	});

	it("reconciles an ack-missed sale on a version mismatch instead of drafting a duplicate", async () => {
		// The guard used to draft before ever asking whether the sale was
		// already submitted, minting an orphan with the same request id.
		setOpeningVersion(2);
		claimRetryableQueueEntries.mockResolvedValueOnce([versionedEntry(1)]);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("reconcile_invoice_outbox_entry"))
				return { message: { acknowledged: true } };
			return { message: {} };
		});

		const totals = await syncOfflineInvoices();

		expect(methodsCalled().some((m) => m.endsWith("update_invoice"))).toBe(false);
		expect(methodsCalled().some((m) => m.endsWith("submit_invoice"))).toBe(false);
		expect(markWriteQueueEntrySynced).toHaveBeenCalledTimes(1);
		expect(totals).toMatchObject({ synced: 1, drafted: 0 });
	});
});

describe("saveOfflineInvoice — capability stamp (plan C7)", () => {
	function cartEntry() {
		return {
			invoice: {
				posa_client_request_id: "inv-9",
				doctype: "Sales Invoice",
				update_stock: 0,
				company: "Doco",
				items: [{ item_code: "ITEM-1", qty: 1 }],
			},
			data: {},
		};
	}

	function queuedEntry() {
		return enqueueWriteQueueEntry.mock.calls[0]?.[1] as any;
	}

	it("stamps the live capability version onto the queued entry", async () => {
		(memory as any).pos_opening_storage = {
			capability_profile: { name: "coffee-quickserve", version: 4 },
		};

		await saveOfflineInvoice(cartEntry());

		expect(queuedEntry().data.posa_capability_version).toBe(4);
	});

	it("leaves the entry unstamped when the register runs no preset (retail)", async () => {
		(memory as any).pos_opening_storage = {};

		await saveOfflineInvoice(cartEntry());

		expect(queuedEntry().data.posa_capability_version).toBeUndefined();
	});
});
