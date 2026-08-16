/**
 * "Reintentar" on a dead-letter / draft-review row must eagerly run the drain
 * that OWNS the requeued entity. The drains are scattered by design (invoices
 * + cash on resume, payments in the pay view, table orders on the
 * coordinator), so dispatching everything at the invoice drain — the old
 * behaviour — left a requeued payment sitting `pending` until the operator
 * happened to open the pay screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const requeueWriteQueueDeadLetter = vi.fn();
const requeueWriteQueueDraftReview = vi.fn();
const syncOfflineInvoices = vi.fn(async () => ({ synced: 0, drafted: 0 }));
const syncOfflinePayments = vi.fn(async () => ({}));
const syncOfflineCashMovements = vi.fn(async () => ({}));
const syncOfflineCustomers = vi.fn(async () => ({}));
const syncRestaurantOrders = vi.fn(async () => ({}));

vi.mock("../src/offline/index", () => ({
	getDeadLetterCount: vi.fn(async () => 0),
	getInvoiceOutboxMode: vi.fn(() => "off"),
	getPendingInvoiceOutboxCount: vi.fn(async () => 0),
	getPendingOfflineInvoiceCount: vi.fn(async () => 0),
	getWriteQueueDeadLetterCount: vi.fn(async () => 0),
	getWriteQueueDraftReviewCount: vi.fn(async () => 0),
	requeueDeadLetterEntry: vi.fn(),
	requeueWriteQueueDeadLetter: (...args: unknown[]) =>
		requeueWriteQueueDeadLetter(...args),
	requeueWriteQueueDraftReview: (...args: unknown[]) =>
		requeueWriteQueueDraftReview(...args),
	resolveWriteQueueDraftReview: vi.fn(),
	syncOfflineInvoices: (...args: unknown[]) => syncOfflineInvoices(...args),
	syncOfflinePayments: (...args: unknown[]) => syncOfflinePayments(...args),
	syncOfflineCashMovements: (...args: unknown[]) =>
		syncOfflineCashMovements(...args),
	syncOfflineCustomers: (...args: unknown[]) => syncOfflineCustomers(...args),
	syncRestaurantOrders: (...args: unknown[]) => syncRestaurantOrders(...args),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/offline/sync/useSyncCoordinator", () => ({
	useSyncCoordinator: vi.fn(() => ({ runTrigger: vi.fn(async () => ({})) })),
}));

import { useSyncStore } from "../src/posapp/stores/syncStore";

describe("syncStore requeue dispatches the owning drain", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.clearAllMocks();
	});

	it.each([
		["payment", syncOfflinePayments],
		["cash_movement", syncOfflineCashMovements],
		["customer", syncOfflineCustomers],
		["restaurant_order", syncRestaurantOrders],
	] as const)(
		"requeued %s dead-letter drains its own queue, not the invoice one",
		async (entityType, ownDrain) => {
			requeueWriteQueueDeadLetter.mockResolvedValue({
				queue_id: 7,
				entity_type: entityType,
			});

			await useSyncStore().requeueWriteQueueDeadLetter(7);

			expect(ownDrain).toHaveBeenCalledTimes(1);
			expect(syncOfflineInvoices).not.toHaveBeenCalled();
		},
	);

	it("requeued invoice dead-letter keeps the historical invoice drain", async () => {
		requeueWriteQueueDeadLetter.mockResolvedValue({
			queue_id: 7,
			entity_type: "invoice",
		});

		await useSyncStore().requeueWriteQueueDeadLetter(7);

		expect(syncOfflineInvoices).toHaveBeenCalled();
		expect(syncOfflinePayments).not.toHaveBeenCalled();
	});

	it("requeued draft-review row also dispatches by entity type", async () => {
		requeueWriteQueueDraftReview.mockResolvedValue({
			queue_id: 9,
			entity_type: "payment",
		});

		await useSyncStore().requeueDraftReview(9);

		expect(syncOfflinePayments).toHaveBeenCalledTimes(1);
		expect(syncOfflineInvoices).not.toHaveBeenCalled();
	});

	it("a failed eager drain still leaves the requeue committed", async () => {
		requeueWriteQueueDeadLetter.mockResolvedValue({
			queue_id: 7,
			entity_type: "payment",
		});
		syncOfflinePayments.mockRejectedValueOnce(new Error("offline again"));

		const row = await useSyncStore().requeueWriteQueueDeadLetter(7);

		expect(row).toMatchObject({ queue_id: 7 });
	});
});
