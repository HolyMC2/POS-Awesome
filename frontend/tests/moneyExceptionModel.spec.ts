import { describe, expect, it, vi } from "vitest";
import { browserMoneyExceptions, exceptionDocumentHref } from "../src/posapp/components/pos/payments/exceptions/moneyExceptionModel";
import { fetchMoneyExceptions } from "../src/posapp/services/moneyExceptionsService";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../src/posapp/services/api", () => ({ default: { call } }));
const entry = (overrides = {}) => ({ queue_id: 1, entity_type: "invoice", status: "pending", idempotency_key: "original-request", payload: { invoice: { grand_total: 10, currency: "MXN" } }, ...overrides });

describe("money exception display projection", () => {
	it("redacts payloads and raw errors, including refund terminal proofs", () => {
		const rows = browserMoneyExceptions([entry({ entity_type: "payment", last_error: "PRIVATE ERROR", payload: { args: { payload: { operation: "refund_customer_advance", client_request_id: "refund-original", amount: 40, currency: "MXN", terminal_token: "SECRET" } } } })], []);
		expect(rows[0]).toMatchObject({ kind: "advance_refund", amount: 40, client_request_id: "refund-original" });
		expect(JSON.stringify(rows)).not.toMatch(/SECRET|PRIVATE ERROR|terminal_token|payload/);
	});
	it("deduplicates dual writes but preserves an unverified acknowledgement as review", () => {
		const outbox = { outbox_id: 3, client_request_id: "original-request", status: "pending" };
		expect(browserMoneyExceptions([entry()], [outbox])).toHaveLength(1);
		const rows = browserMoneyExceptions([entry()], [{ ...outbox, status: "acknowledged", server_verified: false }]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: "review", severity: "warning", actions: [{ type: "open_saved_work" }] });
	});
	it("omits verified acknowledgements, resolved work and customer creation", () => {
		expect(browserMoneyExceptions([entry({ status: "resolved" }), entry({ status: "synced" }), entry({ entity_type: "customer" })], [{ status: "acknowledged", server_verified: true }])).toEqual([]);
	});
	it("does not offer immediate replay for draft review or dead letters", () => {
		for (const status of ["draft_review", "dead_letter"]) expect(browserMoneyExceptions([entry({ status })], [])[0].actions).toEqual([{ type: "open_saved_work" }]);
	});
	it("does not invent amounts and keeps document navigation on the local Desk route", () => {
		expect(browserMoneyExceptions([entry({ payload: { amount: "NaN" } })], [])[0].amount).toBeNull();
		expect(exceptionDocumentHref("Sales Invoice", "javascript:alert(1)/other")).toBe("/app/sales-invoice/javascript%3Aalert(1)%2Fother");
		expect(exceptionDocumentHref("Sales Invoice", "..")).toBeNull();
	});
});

describe("exception feed boundary", () => {
	const valid = () => ({ version: 1, pos_profile: "POS-A", opening_shift: "SHIFT-A", rows: [], sources: Object.fromEntries(["invoice_submissions", "financial_receipts", "charge_callbacks", "processor", "fiscal"].map(key => [key, { status: "supported", count: 0, has_more: false }])) });
	it("checks the selected profile and shift before accepting results", async () => {
		call.mockResolvedValue(valid());
		await expect(fetchMoneyExceptions("POS-A", "SHIFT-A")).resolves.toMatchObject({ rows: [] });
		expect(call).toHaveBeenLastCalledWith(expect.stringContaining("get_money_exceptions"), { pos_profile: "POS-A", opening_shift: "SHIFT-A", limit: 50 });
		await expect(fetchMoneyExceptions("POS-B", "SHIFT-A")).rejects.toThrow("could not be verified");
		await expect(fetchMoneyExceptions("POS-A", "SHIFT-B")).rejects.toThrow("could not be verified");
	});
	it("does not turn missing source coverage into an all-clear report", async () => {
		const result = valid(); delete result.sources.fiscal;
		call.mockResolvedValue(result);
		await expect(fetchMoneyExceptions("POS-A", "SHIFT-A")).rejects.toThrow("could not be verified");
	});
	it("rejects malformed navigation targets before they reach the renderer", async () => {
		call.mockResolvedValue({ ...valid(), rows: [{ id: "bad", kind: "invoice", status: "pending", message_key: "Review", next_action_key: "open_document", document: { doctype: 42, name: "INV" }, actions: [] }] });
		await expect(fetchMoneyExceptions("POS-A", "SHIFT-A")).rejects.toThrow("could not be verified");
	});
});
