// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	claimRetryableQueueEntries,
	db,
	enqueueWriteQueueEntry,
	getQueueEntries,
	getWriteQueueDeadLetterCount,
	getWriteQueueDeadLetterRows,
	initPromise,
	markWriteQueueEntryFailed,
	requeueWriteQueueDeadLetter,
} from "../src/offline/index";

async function pushBackoffIntoPast(queueId: number) {
	await db.table("write_queue").update(queueId, {
		next_attempt_at: new Date(Date.now() - 1000).toISOString(),
	});
}

describe("write queue retry backoff", () => {
	beforeEach(async () => {
		await initPromise;
		await db.table("write_queue").clear();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("sets a backoff window on failure and skips the entry until it elapses", async () => {
		const entry = await enqueueWriteQueueEntry("cash_movement", {
			args: { payload: { client_request_id: "cm-1" } },
		});
		const [claimed] = await claimRetryableQueueEntries("cash_movement");
		expect(claimed.queue_id).toBe(entry.queue_id);

		await markWriteQueueEntryFailed(
			"cash_movement",
			claimed.queue_id as number,
			new Error("500"),
			claimed.last_attempt_at,
		);

		const [row] = await getQueueEntries("cash_movement", {
			statuses: ["failed"],
		});
		expect(row.status).toBe("failed");
		expect(row.next_attempt_at).toBeTruthy();
		expect(Date.parse(row.next_attempt_at as string)).toBeGreaterThan(Date.now());

		// Still inside the backoff window → not re-claimed (the pre-fix bug
		// burned all 5 retries here in one burst).
		expect(await claimRetryableQueueEntries("cash_movement")).toHaveLength(0);

		// Once the window elapses it is claimable again.
		await pushBackoffIntoPast(entry.queue_id as number);
		expect(await claimRetryableQueueEntries("cash_movement")).toHaveLength(1);
	});

	it("dead-letters after MAX_RETRY_COUNT, surfaces it, and requeues", async () => {
		const entry = await enqueueWriteQueueEntry("payment", {
			args: { payload: { client_request_id: "pay-1" } },
		});

		for (let i = 0; i < 5; i += 1) {
			await pushBackoffIntoPast(entry.queue_id as number);
			const [claimed] = await claimRetryableQueueEntries("payment");
			expect(claimed).toBeTruthy();
			await markWriteQueueEntryFailed(
				"payment",
				claimed.queue_id as number,
				new Error("500"),
				claimed.last_attempt_at,
			);
		}

		const [dead] = await getQueueEntries("payment", {
			statuses: ["dead_letter"],
		});
		expect(dead.status).toBe("dead_letter");
		expect(dead.next_attempt_at).toBeNull();

		// Surface: previously write_queue dead-letters were invisible.
		expect(await getWriteQueueDeadLetterCount()).toBe(1);
		const rows = await getWriteQueueDeadLetterRows();
		expect(rows[0].idempotency_key).toBe("payment:pay-1");

		// Requeue resets it to pending for a fresh drain (replay-safe by crid).
		const requeued = await requeueWriteQueueDeadLetter(entry.queue_id as number);
		expect(requeued?.status).toBe("pending");
		expect(requeued?.retry_count).toBe(0);
		expect(await getWriteQueueDeadLetterCount()).toBe(0);
	});
});
