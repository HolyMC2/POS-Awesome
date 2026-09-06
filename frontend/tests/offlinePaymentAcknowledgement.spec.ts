// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/offline/customers", () => ({ syncOfflineCustomers: vi.fn(async () => undefined) }));
import { db, initPromise, memory } from "../src/offline/db";
import { saveOfflinePayment, syncOfflinePayments } from "../src/offline/payments";
import { getQueueEntries } from "../src/offline/writeQueue";
import { getTerminalCredentials, getShiftTerminalContext } from "../src/offline/shiftTerminal";
const call = vi.fn();
const submitted = (name = "PE-1", amount = 60) => ({ name, docstatus: 1, paid_amount: amount, posa_client_request_id: "ORIGINAL-PAYMENT" });
const result = (entries = [submitted()]) => ({ errors: [], new_payments_entry: entries,
	all_payments_entry: entries, reconciled_payments: [] });
const payload = () => ({ ...getShiftTerminalContext(), client_request_id: "ORIGINAL-PAYMENT", party_type: "Customer", party: "CUSTOMER",
	currency: "MXN", pos_profile_name: "COUNTER", pos_opening_shift_name: "SHIFT-PAYMENT",
	payment_methods: [{ mode_of_payment: "Cash", amount: 60 }, { mode_of_payment: "Card", amount: 40 }],
	total_payment_methods: 100 });
beforeEach(async () => {
	await initPromise;
	for (const table of ["write_queue", "invoice_outbox", "keyval", "queue"]) await db.table(table).clear();
	localStorage.clear(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
	(globalThis as any).__ = (value: string) => value;
	(globalThis as any).frappe = { session: { user: "cashier@example.com" }, call };
	const credentials = getTerminalCredentials();
	memory.pos_opening_storage = { pos_profile: { name: "COUNTER" }, terminal_status: { owned: true },
		pos_opening_shift: { name: "SHIFT-PAYMENT", pos_profile: "COUNTER", user: "cashier@example.com",
			posa_terminal_id: credentials.terminal_id, posa_terminal_generation: 1 } };
	memory.offline_payments = []; call.mockReset();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("ordinary offline payment acknowledgements", () => {
	it.each([
		["HTTP200 with errors", { ...result([]), errors: ["Account disabled"] }],
		["partial success", { ...result(), errors: ["Second tender failed"] }],
		["empty HTTP200", undefined],
		["unverified accepted status", { status: "accepted" }],
		["no recorded outcome", result([])],
		["draft receipt", result([{ ...submitted(), docstatus: 0 }])],
	])("preserves the original request after %s", async (_label, response) => {
		const original = payload(); const saved = await saveOfflinePayment({ args: { payload: original } });
		call.mockResolvedValue({ message: response });
		const outcome = await syncOfflinePayments(); const rows = await getQueueEntries("payment");
		expect(outcome.synced).toBe(0); expect(rows).toHaveLength(1);
		expect(rows[0].queue_id).toBe(saved.queue_id); expect(rows[0].status).toBe("failed");
		expect(rows[0].payload.args.payload).toEqual(original);
	});
	it("retries partial success with the identical intent and only acknowledges completed results", async () => {
		const original = payload(); const saved = await saveOfflinePayment({ args: { payload: original } });
		call.mockResolvedValueOnce({ message: { ...result(), errors: ["Second tender failed"] } });
		await syncOfflinePayments();
		await db.table("write_queue").update(saved.queue_id!, { next_attempt_at: null });
		call.mockResolvedValueOnce({ message: { ...result([submitted(), submitted("PE-2", 40)]), replayed: true } });
		const outcome = await syncOfflinePayments();
		expect(outcome.synced).toBe(1); expect(await getQueueEntries("payment")).toEqual([]);
		expect(call).toHaveBeenCalledTimes(2);
		for (const [request] of call.mock.calls) expect(request.args.payload).toEqual(original);
	});
	it("accepts native pure reconciliation and submitted replay outcomes", async () => {
		await saveOfflinePayment({ args: { payload: { ...payload(), payment_methods: [], total_payment_methods: 0,
			selected_payments: [{ name: "PE-1", allocated_amount: 40 }], total_selected_payments: 40 } } });
		call.mockResolvedValue({ message: { errors: [], new_payments_entry: [],
			all_payments_entry: [submitted()], reconciled_payments: [{ payment_entry: "PE-1", allocated_amount: 40 }], replayed: true } });
		expect((await syncOfflinePayments()).synced).toBe(1);
		expect(await getQueueEntries("payment")).toEqual([]);
	});
});
