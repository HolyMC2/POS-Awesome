// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
	db,
	exportDeadLetterEntry,
	getDeadLetterCount,
	getDeadLetterRows,
	getPendingInvoiceOutboxCount,
	initPromise,
	memory,
	requeueDeadLetterEntry,
	setInvoiceOutboxMode,
} from "../src/offline/index";

const TABLE = "invoice_outbox";

async function seedDeadLetter(crid: string) {
	await db.table(TABLE).add({
		client_request_id: crid,
		resource: "invoice_outbox",
		status: "dead_letter",
		invoice: {
			customer: "CUST-DL",
			customer_name: "Cliente Muerto",
			grand_total: 123,
			currency: "MXN",
		},
		data: { idempotency_key: crid },
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		next_retry_at: null,
		retry_count: 5,
		last_error: "server exploded",
		invoice_name: null,
		acknowledged_at: null,
	});
}

describe("invoice outbox dead-letter surface", () => {
	beforeEach(async () => {
		await initPromise;
		await db.table(TABLE).clear();
		localStorage.clear();
		memory.offline_invoices = [];
		setInvoiceOutboxMode("dual_write");
	});

	it("dead-letter rows are excluded from the pending count but countable", async () => {
		await seedDeadLetter("dl-001");
		expect(await getPendingInvoiceOutboxCount()).toBe(0);
		expect(await getDeadLetterCount()).toBe(1);
		const rows = await getDeadLetterRows();
		expect(rows[0].client_request_id).toBe("dl-001");
		expect(rows[0].last_error).toBe("server exploded");
	});

	it("requeue flips a dead-letter row back to retrying and re-enters the pending count", async () => {
		await seedDeadLetter("dl-002");
		const updated = await requeueDeadLetterEntry("dl-002");
		expect(updated?.status).toBe("retrying");
		expect(updated?.requeue_count).toBe(1);
		expect(await getDeadLetterCount()).toBe(0);
		expect(await getPendingInvoiceOutboxCount()).toBe(1);
		// retry history preserved
		expect(updated?.retry_count).toBe(5);
	});

	it("requeue on a non-dead-letter id is a no-op", async () => {
		expect(await requeueDeadLetterEntry("nope")).toBeNull();
	});

	it("export returns the rescue payload", async () => {
		await seedDeadLetter("dl-003");
		const payload = await exportDeadLetterEntry("dl-003");
		expect(payload?.client_request_id).toBe("dl-003");
		expect(payload?.invoice?.grand_total).toBe(123);
		expect(payload?.data?.idempotency_key).toBe("dl-003");
	});
});
