// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, initPromise, memory } from "../src/offline/db";
import { readLocalMoneyExceptions } from "../src/offline/moneyExceptions";

describe("owner-scoped local money exceptions", () => {
	beforeEach(async () => {
		await initPromise;
		(globalThis as any).frappe = { session: { user: "cashier-a@example.com" } };
		document.cookie = "user_id=cashier-a%40example.com";
		memory.pos_opening_storage = { pos_profile: { name: "POS-A" }, pos_opening_shift: { user: "cashier-a@example.com", pos_profile: "POS-A" } };
		await db.table("write_queue").clear(); await db.table("invoice_outbox").clear();
	});
	it("reads only this cashier/register without mutating any queue", async () => {
		const row = { entity_type: "payment", status: "pending", payload: { amount: 20, currency: "MXN" }, created_at: "2026-09-06T12:00:00Z", queue_user: "cashier-a@example.com", queue_profile: "POS-A" };
		await db.table("write_queue").bulkAdd([row, { ...row, queue_user: "cashier-b@example.com" }, { ...row, queue_profile: "POS-B" }]);
		const before = await db.table("write_queue").toArray();
		const result = await readLocalMoneyExceptions();
		expect(result.rows).toHaveLength(1); expect(result.errors).toEqual([]);
		expect(await db.table("write_queue").toArray()).toEqual(before);
	});
	it("refuses stale authentication after another tab changes the login cookie", async () => {
		document.cookie = "user_id=cashier-b%40example.com";
		await expect(readLocalMoneyExceptions()).rejects.toThrow("original cashier");
	});
	it("keeps unverified historical acknowledgements visible", async () => {
		await db.table("invoice_outbox").add({ client_request_id: "historical-sale", status: "acknowledged", server_verified: false, created_at: "2026-09-06", queue_user: "cashier-a@example.com", queue_profile: "POS-A" });
		const result = await readLocalMoneyExceptions();
		expect(result.rows[0]).toMatchObject({ status: "review", client_request_id: "historical-sale" });
	});
});
