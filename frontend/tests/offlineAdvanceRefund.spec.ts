// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, initPromise, memory } from "../src/offline/db";
import { getTerminalCredentials, getShiftTerminalContext } from "../src/offline/shiftTerminal";
import { getPendingShiftWorkCount } from "../src/offline/shiftQueueGuard";
import { getPendingAdvanceRefund, submitAdvanceRefund } from "../src/offline/payments";

const shift = { name: "SHIFT-REFUND", user: "cashier@example.com", pos_profile: "COUNTER" };
const call = vi.fn();
const intent = () => ({ operation: "refund_customer_advance", original_payment_entry: "RECEIPT-1",
	client_request_id: "pay-refund-1", customer: "CUSTOMER", amount: 40, mode_of_payment: "Cash",
	expected_paid_amount: 40, expected_paid_currency: "MXN", pos_profile: shift.pos_profile,
	pos_opening_shift_name: shift.name, reason: "Customer requested unused cash back", ...getShiftTerminalContext() });
const confirmation = { docstatus: 1, client_request_id: "pay-refund-1", original_payment_entry: "RECEIPT-1",
	refund_payment_entry: "REFUND-1", refunded_amount: 40, remaining_amount: 60 };

beforeEach(async () => {
	await initPromise;
	for (const table of ["write_queue", "invoice_outbox", "keyval", "queue"]) await db.table(table).clear();
	localStorage.clear();
	Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
	(globalThis as any).__ = (value: string) => value;
	(globalThis as any).frappe = { session: { user: shift.user }, call };
	call.mockReset();
	for (const key of ["offline_invoices", "offline_customers", "offline_payments", "offline_cash_movements"]) memory[key] = [];
	const credentials = getTerminalCredentials();
	memory.pos_opening_storage = { pos_profile: { name: shift.pos_profile }, terminal_status: { owned: true },
		pos_opening_shift: { ...shift, posa_terminal_id: credentials.terminal_id, posa_terminal_generation: 1 } };
});

describe("durable advance refund intent", () => {
	it("persists before HTTP, survives lost response, and replays the original proof once", async () => {
		const original = intent();
		call.mockImplementationOnce(async () => {
			expect(await db.table("write_queue").count()).toBe(1);
			throw new Error("response lost");
		});
		await expect(submitAdvanceRefund(original)).rejects.toThrow("response lost");
		expect(await getPendingShiftWorkCount(shift)).toBe(1);
		const saved = await getPendingAdvanceRefund("RECEIPT-1");
		expect(saved?.payload.args.payload.pos_profile).toBe("COUNTER");
		memory.pos_opening_storage.pos_opening_shift.posa_terminal_generation = 2;
		call.mockResolvedValueOnce({ message: confirmation });
		await expect(submitAdvanceRefund(original)).resolves.toEqual(confirmation);
		expect(call.mock.calls[1]?.[0].args.payload.terminal_generation).toBe(1);
		expect(await getPendingAdvanceRefund("RECEIPT-1")).toBeNull();
		expect(await getPendingShiftWorkCount(shift)).toBe(0);
	});

	it.each([{ ...confirmation, client_request_id: "OTHER" }, { ...confirmation, docstatus: 0 },
		{ ...confirmation, original_payment_entry: "OTHER" }, { ...confirmation, refunded_amount: 400 }])(
		"retains pending work for an unverified response", async (response) => {
			call.mockResolvedValue({ message: response });
			await expect(submitAdvanceRefund(intent())).rejects.toThrow("not confirmed");
			expect(await getPendingShiftWorkCount(shift)).toBe(1);
		},
	);

	it("does not start a second request while the original refund remains uncertain", async () => {
		call.mockRejectedValue(new Error("response lost"));
		await expect(submitAdvanceRefund(intent())).rejects.toThrow();
		await expect(submitAdvanceRefund({ ...intent(), client_request_id: "pay-new" })).rejects.toThrow("existing pending refund");
		expect(call).toHaveBeenCalledTimes(1);
	});

	it("requires a connection before saving a new refund intent", async () => {
		Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
		await expect(submitAdvanceRefund(intent())).rejects.toThrow("Reconnect");
		expect(await db.table("write_queue").count()).toBe(0);
		expect(call).not.toHaveBeenCalled();
	});
});
