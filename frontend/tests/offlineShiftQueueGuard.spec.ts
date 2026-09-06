// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, initPromise, memory } from "../src/offline/db";
import { getPendingShiftWorkCount } from "../src/offline/shiftQueueGuard";

const scope = { name: "OPEN-1", user: "cashier@example.com", pos_profile: "COUNTER" };
const invoice = (id: string, status = "pending", shift = "OPEN-1") => ({
	entity_type: "invoice", status, idempotency_key: id,
	queue_user: scope.user, queue_profile: scope.pos_profile,
	payload: { invoice: { posa_pos_opening_shift: shift, pos_profile: scope.pos_profile } },
});

beforeEach(async () => {
	await initPromise;
	await db.table("write_queue").clear();
	await db.table("invoice_outbox").clear();
	(globalThis as any).frappe = { session: { user: scope.user } };
	memory.pos_opening_storage = { pos_profile: { name: scope.pos_profile }, pos_opening_shift: scope };
	for (const key of ["offline_invoices", "offline_customers", "offline_payments", "offline_cash_movements"]) memory[key] = [];
});

describe("durable closing queue guard", () => {
	it("finds a persisted sale even before the in-memory queue was hydrated", async () => {
		await db.table("write_queue").add(invoice("sale"));
		expect(memory.offline_invoices).toEqual([]);
		expect(await getPendingShiftWorkCount(scope)).toBe(1);
	});

	it("counts cash, payment and outbox records with their actual payload nesting", async () => {
		await db.table("write_queue").bulkAdd([
			{ ...invoice("cash"), entity_type: "cash_movement", payload: { args: { payload: { pos_opening_shift: "OPEN-1" } } } },
			{ ...invoice("payment"), entity_type: "payment", payload: { args: { payload: { pos_opening_shift_name: "OPEN-1" } } } },
		]);
		await db.table("invoice_outbox").add({ client_request_id: "outbox", status: "pending", invoice: { posa_pos_opening_shift: "OPEN-1" } });
		expect(await getPendingShiftWorkCount(scope)).toBe(3);
	});

	it("includes dead letters, review drafts and matching legacy records without adopting them", async () => {
		await db.table("write_queue").bulkAdd([
			invoice("dead", "dead_letter"), invoice("draft", "draft_review"),
			{ entity_type: "invoice", status: "pending", idempotency_key: "legacy", payload: {} },
		]);
		expect(await getPendingShiftWorkCount(scope)).toBe(3);
		expect((await db.table("write_queue").where("idempotency_key").equals("legacy").first()).queue_user).toBeUndefined();
	});

	it("does not block for acknowledged work, unrelated shifts, cashiers, profiles or customers", async () => {
		await db.table("write_queue").bulkAdd([
			invoice("synced", "synced"), invoice("resolved", "resolved"), invoice("other-shift", "pending", "OPEN-2"),
			{ ...invoice("other-profile"), queue_profile: "OTHER", payload: {} },
			{ ...invoice("other-cashier"), queue_user: "other@example.com", payload: {} },
			{ ...invoice("customer"), entity_type: "customer" },
		]);
		await db.table("invoice_outbox").add({ client_request_id: "ack", status: "acknowledged", server_verified: true, invoice: { posa_pos_opening_shift: "OPEN-1" } });
		expect(await getPendingShiftWorkCount(scope)).toBe(0);
	});

	it("does not hide exact-shift money merely because its cashier is no longer logged in", async () => {
		await db.table("write_queue").add({ ...invoice("original-owner"), queue_user: "original@example.com" });
		expect(await getPendingShiftWorkCount(scope)).toBe(1);
	});
});
