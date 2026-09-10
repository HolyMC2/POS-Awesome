import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Replaying a customer queued offline keeps the promotion consent the dialog
 * recorded, as 0/1, and omits it for an entry queued without it so the server
 * leaves stored consent unchanged.
 */

const m = vi.hoisted(() => ({ entries: [] as Array<Record<string, any>> }));

vi.mock("../src/offline/db", () => ({
	checkDbHealth: vi.fn(async () => undefined),
	db: { isOpen: () => true, open: vi.fn(async () => undefined), table: vi.fn() },
	isOffline: () => false,
	memory: {},
	persist: vi.fn(),
}));

vi.mock("../src/offline/queueOwnership", () => ({ ownsQueueEntry: () => true }));

vi.mock("../src/offline/writeQueue", () => ({
	claimRetryableQueueEntries: vi.fn(async () => m.entries),
	clearWriteQueueEntries: vi.fn(async () => undefined),
	deleteWriteQueueEntryByIndex: vi.fn(async () => undefined),
	enqueueWriteQueueEntry: vi.fn(async () => undefined),
	getQueuedPayloadCount: vi.fn(() => 0),
	getQueuedPayloadSnapshots: vi.fn(() => m.entries.map((entry) => entry.payload)),
	markWriteQueueEntryFailed: vi.fn(async () => undefined),
	markWriteQueueEntrySynced: vi.fn(async () => undefined),
	refreshQueueMemory: vi.fn(async () => undefined),
	updateQueuedPayloads: vi.fn(async () => undefined),
}));

import { customerReplayArgs, syncOfflineCustomers } from "../src/offline/customers";

const queued = (args: Record<string, unknown>, queueId = 1) => ({
	queue_id: queueId,
	last_attempt_at: 0,
	payload: { args: { customer_name: "Ana Pérez", method: "create", ...args } },
});

describe("offline customer replay", () => {
	let call: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		call = vi.fn(async () => ({ message: { name: "Ana Pérez" } }));
		vi.stubGlobal("frappe", { call });
	});

	it("replays recorded consent to create_customer", async () => {
		m.entries = [queued({ marketing_opt_in: 1, mobile_no: "6691234567", email_id: "ana@example.com" })];
		await syncOfflineCustomers();
		expect(call).toHaveBeenCalledWith({
			method: "posawesome.posawesome.api.customers.create_customer",
			args: expect.objectContaining({ marketing_opt_in: 1, email_id: "ana@example.com" }),
		});
	});

	it("an entry queued without consent replays without the key", async () => {
		m.entries = [queued({})];
		await syncOfflineCustomers();
		expect(call.mock.calls[0]?.[0].args).not.toHaveProperty("marketing_opt_in");
	});

	it("normalizes stored consent values to 0/1", () => {
		for (const [value, expected] of [
			[1, 1],
			[true, 1],
			["1", 1],
			["true", 1],
			[0, 0],
			[false, 0],
			["0", 0],
		] as const) {
			expect(customerReplayArgs({ marketing_opt_in: value }).marketing_opt_in).toBe(expected);
		}
		for (const value of [undefined, null, ""]) {
			expect(customerReplayArgs({ marketing_opt_in: value })).not.toHaveProperty("marketing_opt_in");
		}
	});
});
