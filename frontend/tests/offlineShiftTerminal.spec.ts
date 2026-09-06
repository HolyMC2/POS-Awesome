// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, initPromise, memory } from "../src/offline/db";
import { enqueueWriteQueueEntry } from "../src/offline/writeQueue";
import { getPendingShiftWorkCount } from "../src/offline/shiftQueueGuard";
import { getTerminalCredentials, getShiftTerminalContext, terminalFenceKey } from "../src/offline/shiftTerminal";

import { clearLocalStorage } from "../src/utils/clearAllCaches";
import { getTerminalRecoverySales, recoverTerminalSale } from "../src/offline/terminalRecovery";

const scope = { name: "OPEN-TERMINAL", user: "cashier@example.com", pos_profile: "COUNTER" };
const sale = (id = "sale-one") => ({ invoice: { posa_pos_opening_shift: scope.name, pos_profile: scope.pos_profile,
	posa_client_request_id: id, items: [{ item_code: "ITEM", qty: 1 }] }, data: {} });

beforeEach(async () => {
	await initPromise;
	for (const name of ["write_queue", "invoice_outbox", "keyval", "queue"]) await db.table(name).clear();
	(globalThis as any).frappe = { session: { user: scope.user } };
	for (const key of ["offline_invoices", "offline_customers", "offline_payments", "offline_cash_movements"]) memory[key] = [];
	const credentials = getTerminalCredentials();
	memory.pos_opening_storage = { pos_profile: { name: scope.pos_profile }, terminal_status: { owned: true },
		pos_opening_shift: { ...scope, posa_terminal_id: credentials.terminal_id, posa_terminal_generation: 1 } };
});

describe("registered terminal and durable closing fence", () => {
	it("reuses the persisted browser proof with the cached shift while offline", () => {
		const first = getTerminalCredentials();
		expect(first.terminal_token).toHaveLength(64);
		expect(getTerminalCredentials()).toEqual(first);
		expect(getShiftTerminalContext()).toEqual({ ...first, terminal_generation: 1 });
	});

	it("does not enqueue a sale under a different browser's shift", async () => {
		memory.pos_opening_storage.terminal_status.owned = false;
		await expect(enqueueWriteQueueEntry("invoice", sale())).rejects.toThrow("Open Offline Status");
		expect(await db.table("write_queue").count()).toBe(0);
	});

	it("durably fences further money after the zero-pending close check", async () => {
		expect(await getPendingShiftWorkCount(scope, true)).toBe(0);
		expect((await db.table("keyval").get(terminalFenceKey(scope.name))).value.generation).toBe(1);
		await expect(enqueueWriteQueueEntry("invoice", sale())).rejects.toThrow("closing or being released");
		expect(await db.table("write_queue").count()).toBe(0);
	});

	it("serializes concurrent enqueue and close so they cannot both pass empty", async () => {
		const [saved, closing] = await Promise.allSettled([
			enqueueWriteQueueEntry("invoice", sale()), getPendingShiftWorkCount(scope, true),
		]);
		if (saved.status === "fulfilled") {
			expect(closing).toMatchObject({ status: "fulfilled", value: 1 });
			expect(await db.table("keyval").get(terminalFenceKey(scope.name))).toBeUndefined();
		} else {
			expect(closing).toMatchObject({ status: "fulfilled", value: 0 });
			expect(await db.table("write_queue").count()).toBe(0);
		}
	});

	it("preserves captured old-generation proof after server transfer instead of restamping queued work", async () => {
		await enqueueWriteQueueEntry("invoice", sale());
		memory.pos_opening_storage.pos_opening_shift.posa_terminal_generation = 2;
		await enqueueWriteQueueEntry("invoice", sale());
		const [row] = await db.table("write_queue").toArray();
		expect(row.payload.data.terminal_generation).toBe(1);
		expect(row.payload.data.terminal_token).toBe(getTerminalCredentials().terminal_token);
	});
});


describe("individual manager recovery", () => {
    it("preserves original proof while acknowledging only the verified request", async () => {
        await enqueueWriteQueueEntry("invoice", sale());
        const [original] = await db.table("write_queue").toArray();
        memory.pos_opening_storage.terminal_status.can_manage = true;
        memory.pos_opening_storage.pos_opening_shift.posa_terminal_generation = 2;
        (globalThis as any).frappe.call = vi.fn().mockResolvedValue({ message: {
            client_request_id: "sale-one", invoice: { name: "SINV-RECOVERED", docstatus: 1 },
        } });
        await recoverTerminalSale(original.queue_id, "Compared collected cash with original request");
        const recovered = await db.table("write_queue").get(original.queue_id);
        expect(recovered.status).toBe("synced");
        expect(recovered.payload).toEqual(original.payload);
        expect(recovered.payload.data.terminal_generation).toBe(1);
        expect((globalThis as any).frappe.call.mock.calls[0][0].args.terminal_generation).toBe(2);
    });

    it("keeps the sale pending when the server identity does not match", async () => {
        await enqueueWriteQueueEntry("invoice", sale());
        const [original] = await db.table("write_queue").toArray();
        memory.pos_opening_storage.terminal_status.can_manage = true;
        (globalThis as any).frappe.call = vi.fn().mockResolvedValue({ message: {
            client_request_id: "another-sale", invoice: { name: "SINV-OTHER", docstatus: 1 },
        } });
        await expect(recoverTerminalSale(original.queue_id, "Compared cash and customer")).rejects.toThrow("not verified");
        expect(await db.table("write_queue").get(original.queue_id)).toEqual(original);
    });

    it("preserves the saved record if the signed-in manager changes during recovery", async () => {
        await enqueueWriteQueueEntry("invoice", sale());
        const [original] = await db.table("write_queue").toArray();
        memory.pos_opening_storage.terminal_status.can_manage = true;
        (globalThis as any).frappe.call = vi.fn().mockImplementation(async () => {
            (globalThis as any).frappe.session.user = "other-manager";
            return { message: { client_request_id: "sale-one", invoice: { name: "SINV", docstatus: 1 } } };
        });
        await expect(recoverTerminalSale(original.queue_id, "Compared cash and customer")).rejects.toThrow("user changed");
        expect(await db.table("write_queue").get(original.queue_id)).toEqual(original);
    });
});


describe("orphan outbox recovery", () => {
    it("recovers an unsent outbox-only sale without inventing an identity or queue mirror", async () => {
        const original = { client_request_id: "orphan-sale", invoice: sale("orphan-sale").invoice,
            data: { terminal_generation: 0 }, status: "dead_letter", queue_user: scope.user, queue_profile: scope.pos_profile };
        await db.table("invoice_outbox").add(original);
        memory.pos_opening_storage.terminal_status.can_manage = true;
        const [row] = await getTerminalRecoverySales();
        expect(row.queue_id).toBeLessThan(0);
        (globalThis as any).frappe.call = vi.fn().mockResolvedValue({ message: {
            client_request_id: "orphan-sale", invoice: { name: "SINV-ORPHAN", docstatus: 1 },
        } });
        await recoverTerminalSale(row.queue_id, "Reviewed orphan saved cash sale");
        const [ack] = await db.table("invoice_outbox").toArray();
        expect(ack).toMatchObject({ status: "acknowledged", server_verified: true, invoice_name: "SINV-ORPHAN" });
        expect(ack.invoice).toEqual(original.invoice);
        expect(ack.data).toEqual(original.data);
        expect(await db.table("write_queue").count()).toBe(0);
    });

    it("deduplicates the mirror and keeps historical acknowledgement recovery verify-only", async () => {
        await enqueueWriteQueueEntry("invoice", sale());
        await db.table("invoice_outbox").add({ client_request_id: "sale-one", invoice: sale().invoice, status: "pending" });
        await db.table("invoice_outbox").add({ client_request_id: "historical", invoice: sale("historical").invoice,
            status: "acknowledged", server_verified: false });
        memory.pos_opening_storage.terminal_status.can_manage = true;
        const rows = await getTerminalRecoverySales();
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.idempotency_key === "historical").verify_only).toBe(true);
    });
});


it("preserves terminal possession across account handoff and ordinary cache cleanup", async () => {
    const proof = getTerminalCredentials();
    (globalThis as any).frappe.session.user = "replacement-cashier";
    localStorage.setItem("derived-cache-fixture", "discard");
    await clearLocalStorage();
    expect(localStorage.getItem("derived-cache-fixture")).toBeNull();
    expect(getTerminalCredentials()).toEqual(proof);
    expect(await db.table("write_queue").count()).toBe(0);
});
