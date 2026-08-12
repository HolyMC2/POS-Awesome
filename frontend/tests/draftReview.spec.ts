// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, initPromise, memory, pruneOfflineStorage } from "../src/offline/db";
import { syncOfflineInvoices } from "../src/offline/invoices";
import {
	claimRetryableQueueEntries,
	enqueueWriteQueueEntry,
	ensureOfflineQueueReady,
	getQueueEntries,
	getWriteQueueDraftReviewRows,
	markWriteQueueEntryDrafted,
	markWriteQueueEntrySynced,
	refreshAllQueueMemory,
	requeueWriteQueueDraftReview,
	resolveWriteQueueDraftReview,
} from "../src/offline/writeQueue";

const frappeCall = vi.fn();
(globalThis as any).frappe = { call: frappeCall };

function invoicePayload(
	requestId: string,
	capabilityVersion?: number,
) {
	return {
		invoice: {
			doctype: "Sales Invoice",
			posa_client_request_id: requestId,
			company: "Doco",
			pos_profile: "Doco Ventas",
			customer: "CUST-001",
			customer_name: "Cliente Uno",
			currency: "MXN",
			grand_total: 125,
		},
		data:
			typeof capabilityVersion === "number"
				? { posa_capability_version: capabilityVersion }
				: {},
	};
}

async function createDraftReview(requestId = "inv-draft-review") {
	const queued = await enqueueWriteQueueEntry(
		"invoice",
		invoicePayload(requestId),
	);
	const [claimed] = await claimRetryableQueueEntries("invoice");
	await markWriteQueueEntryDrafted(
		"invoice",
		Number(claimed.queue_id),
		claimed.last_attempt_at,
		{ invoiceName: "ACC-SINV-DRAFT-1", reason: "Needs review" },
	);
	return queued;
}

describe("offline invoice draft-review lifecycle", () => {
	beforeEach(async () => {
		await initPromise;
		await ensureOfflineQueueReady();
		await db.table("write_queue").clear();
		await db.table("invoice_outbox").clear();
		(memory as any).invoice_outbox_mode = "off";
		(memory as any).manual_offline = false;
		(memory as any).pos_opening_storage = {};
		(window as any).serverOnline = true;
		await refreshAllQueueMemory();
		frappeCall.mockReset();
		vi.restoreAllMocks();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("keeps a submit-failure fallback visible as draft_review with the server draft name", async () => {
		await enqueueWriteQueueEntry(
			"invoice",
			invoicePayload("inv-submit-failure"),
		);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("submit_invoice")) {
				throw new Error("validation failed: missing account");
			}
			if (method.endsWith("reconcile_invoice_outbox_entry")) {
				return { message: { acknowledged: false } };
			}
			if (method.endsWith("update_invoice")) {
				return { message: { name: "ACC-SINV-DRAFT-101" } };
			}
			return {};
		});

		const totals = await syncOfflineInvoices();
		const active = await getQueueEntries("invoice");
		const draftRows = await getWriteQueueDraftReviewRows("invoice");
		const synced = await getQueueEntries("invoice", { statuses: ["synced"] });

		expect(totals).toMatchObject({ synced: 0, drafted: 1 });
		expect(active).toHaveLength(1);
		expect(active[0]).toMatchObject({
			status: "draft_review",
			draft_invoice_name: "ACC-SINV-DRAFT-101",
			draft_reason: "validation failed: missing account",
			last_error: "validation failed: missing account",
		});
		expect(draftRows).toHaveLength(1);
		expect(draftRows[0]).toMatchObject({
			invoice: expect.objectContaining({
				posa_client_request_id: "inv-submit-failure",
			}),
			draft_invoice_name: "ACC-SINV-DRAFT-101",
		});
		expect(synced).toHaveLength(0);
	});

	it("routes a capability-version mismatch to draft_review with its audit reason", async () => {
		(memory as any).pos_opening_storage = {
			capability_profile: { name: "retail-v2", version: 2 },
		};
		await enqueueWriteQueueEntry(
			"invoice",
			invoicePayload("inv-capability-mismatch", 1),
		);
		frappeCall.mockImplementation(async ({ method }: any) => {
			if (method.endsWith("reconcile_invoice_outbox_entry")) {
				return { message: { acknowledged: false } };
			}
			if (method.endsWith("update_invoice")) {
				return { name: "ACC-SINV-DRAFT-102" };
			}
			return {};
		});

		const totals = await syncOfflineInvoices();
		const [row] = await getWriteQueueDraftReviewRows("invoice");

		expect(totals).toMatchObject({ synced: 0, drafted: 1 });
		expect(row).toMatchObject({
			status: "draft_review",
			draft_invoice_name: "ACC-SINV-DRAFT-102",
			draft_reason: "capability_version_mismatch: v1 → v2",
		});
		expect(
			frappeCall.mock.calls.some(([options]) =>
				String(options.method).endsWith("submit_invoice"),
			),
		).toBe(false);
	});

	it("rejects a stale drafted transition through the syncing lease CAS", async () => {
		await enqueueWriteQueueEntry("invoice", invoicePayload("inv-stale-cas"));
		const [claimed] = await claimRetryableQueueEntries("invoice");
		const before = structuredClone(claimed);

		const updated = await markWriteQueueEntryDrafted(
			"invoice",
			Number(claimed.queue_id),
			"2026-01-01T00:00:00.000Z",
			{ invoiceName: "ACC-SINV-STALE", reason: "stale writer" },
		);
		const [after] = await getQueueEntries("invoice", { statuses: ["syncing"] });

		expect(updated).toBe(false);
		expect(after).toEqual(before);
	});

	it("requeues for replay while retaining draft trace, then can sync normally", async () => {
		const queued = await createDraftReview("inv-requeue");

		const requeued = await requeueWriteQueueDraftReview(Number(queued.queue_id));
		expect(requeued).toMatchObject({
			status: "pending",
			retry_count: 0,
			last_attempt_at: null,
			next_attempt_at: null,
			last_error: null,
			draft_invoice_name: "ACC-SINV-DRAFT-1",
			draft_reason: "Needs review",
		});
		expect(requeued?.drafted_at).toBeTruthy();

		const [claimed] = await claimRetryableQueueEntries("invoice");
		expect(claimed.queue_id).toBe(queued.queue_id);
		expect(
			await markWriteQueueEntrySynced(
				"invoice",
				Number(claimed.queue_id),
				claimed.last_attempt_at,
			),
		).toBe(true);
		const [synced] = await getQueueEntries("invoice", { statuses: ["synced"] });
		expect(synced).toMatchObject({
			status: "synced",
			draft_invoice_name: "ACC-SINV-DRAFT-1",
		});
	});

	it("resolves only draft_review rows and records the terminal timestamp", async () => {
		const drafted = await createDraftReview("inv-resolve");
		const pending = await enqueueWriteQueueEntry(
			"invoice",
			invoicePayload("inv-not-drafted"),
		);

		const resolved = await resolveWriteQueueDraftReview(Number(drafted.queue_id));
		expect(resolved).toMatchObject({ status: "resolved" });
		expect(resolved?.resolved_at).toBeTruthy();
		expect(await getWriteQueueDraftReviewRows("invoice")).toHaveLength(0);

		expect(
			await resolveWriteQueueDraftReview(Number(pending.queue_id)),
		).toBeNull();
		const [stillPending] = await getQueueEntries("invoice", {
			statuses: ["pending"],
		});
		expect(stillPending.queue_id).toBe(pending.queue_id);
	});

	it("re-drafts a failed retry onto the SAME server draft instead of minting a sibling", async () => {
		// Two drafts with one posa_client_request_id are both submittable from
		// Desk (core submit skips the request-id idempotency) — a double-bill.
		const queued = await createDraftReview("inv-redraft-adopt");
		await requeueWriteQueueDraftReview(Number(queued.queue_id));

		const updateCalls: any[] = [];
		frappeCall.mockImplementation(async ({ method, args }: any) => {
			if (method.endsWith("submit_invoice")) {
				throw new Error("still failing");
			}
			if (method.endsWith("reconcile_invoice_outbox_entry")) {
				return { message: { acknowledged: false } };
			}
			if (method.endsWith("update_invoice")) {
				updateCalls.push(args);
				return { message: { name: args?.data?.name || "ACC-SINV-NEW" } };
			}
			return {};
		});

		const totals = await syncOfflineInvoices();
		const [row] = await getWriteQueueDraftReviewRows("invoice");

		expect(totals).toMatchObject({ synced: 0, drafted: 1 });
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0]?.data?.name).toBe("ACC-SINV-DRAFT-1");
		expect(row).toMatchObject({
			status: "draft_review",
			draft_invoice_name: "ACC-SINV-DRAFT-1",
		});
	});

	it("never age-prunes draft_review and prunes only stale resolved rows", async () => {
		const now = Date.parse("2026-08-12T12:00:00.000Z");
		const oldIso = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
		const freshIso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
		await db.table("write_queue").bulkPut([
			{
				entity_type: "invoice",
				payload: invoicePayload("inv-old-draft"),
				created_at: oldIso,
				last_attempt_at: oldIso,
				retry_count: 0,
				status: "draft_review",
				idempotency_key: "invoice:inv-old-draft",
				last_error: "review",
				drafted_at: oldIso,
			},
			{
				entity_type: "invoice",
				payload: invoicePayload("inv-old-resolved"),
				created_at: oldIso,
				last_attempt_at: oldIso,
				retry_count: 0,
				status: "resolved",
				idempotency_key: "invoice:inv-old-resolved",
				last_error: null,
				resolved_at: oldIso,
			},
			{
				entity_type: "invoice",
				payload: invoicePayload("inv-fresh-resolved"),
				created_at: freshIso,
				last_attempt_at: freshIso,
				retry_count: 0,
				status: "resolved",
				idempotency_key: "invoice:inv-fresh-resolved",
				last_error: null,
				resolved_at: freshIso,
			},
		]);

		const result = await pruneOfflineStorage({ now, maxAgeDays: 30 });
		const remaining = await db.table("write_queue").toArray();

		expect(result.writeQueue).toBe(1);
		expect(remaining).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ idempotency_key: "invoice:inv-old-draft" }),
				expect.objectContaining({ idempotency_key: "invoice:inv-fresh-resolved" }),
			]),
		);
		expect(remaining).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ idempotency_key: "invoice:inv-old-resolved" }),
			]),
		);
	});
});
