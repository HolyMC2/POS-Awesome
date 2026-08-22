import { describe, expect, it, vi } from "vitest";

import {
	CANDIDATE_LIMIT,
	fetchSaleCashier,
	runFind,
	type FrappeCallOptions,
} from "../src/posapp/components/pos/flows/returns/findOriginalSale";
import { resolveWarrantyWindow } from "../src/posapp/components/pos/flows/returns/warrantyWindow";

const SEARCH = "posawesome.posawesome.api.invoices.search_invoices_for_return";
const LIST = "frappe.client.get_list";

const invoice = (name: string, posting_date = "2026-08-18") => ({
	name,
	customer: "CUST-01",
	customer_name: "Público en general",
	posting_date,
	grand_total: 558,
});

/**
 * A stand-in server. Every test declares what each method answers, so the
 * assertions are about the ARGUMENTS this module sends and the shape it builds
 * out of the replies — not about a live site.
 */
const fakeServer = (handlers: Record<string, (args: any) => unknown>) => {
	const calls: FrappeCallOptions[] = [];
	const call = vi.fn(async (options: FrappeCallOptions) => {
		calls.push(options);
		const handler = handlers[options.method];
		if (!handler) throw new Error(`unexpected call: ${options.method}`);
		return { message: handler(options.args) };
	});
	return { call, calls };
};

const ctx = (call: any) => ({
	call,
	company: "Doco Mexico",
	posProfileName: "Caja 2",
	doctype: "Sales Invoice",
});

describe("by ticket", () => {
	it("asks the endpoint that owns return eligibility", () => {
		const { call, calls } = fakeServer({
			[SEARCH]: () => ({ invoices: [invoice("B-04788")], has_more: false }),
		});
		return runFind(ctx(call), "ticket", " B-04788 ").then((outcome) => {
			expect(outcome.rows.map((row) => row.name)).toEqual(["B-04788"]);
			expect(calls[0]?.method).toBe(SEARCH);
			expect(calls[0]?.args).toMatchObject({
				invoice_name: "B-04788",
				company: "Doco Mexico",
				doctype: "Sales Invoice",
			});
		});
	});

	it("finds nothing for a blank term without troubling the server", async () => {
		const { call } = fakeServer({});
		expect((await runFind(ctx(call), "ticket", "   ")).rows).toEqual([]);
		expect(call).not.toHaveBeenCalled();
	});

	it("reports a failed lookup as an ERROR, not as an empty shop", async () => {
		// "No sale matched" sends the cashier to another way; "the search could
		// not run" sends them to a supervisor. Collapsing the two is how a
		// broken register looks like a customer with no receipt.
		const call = vi.fn(async () => {
			throw new Error("PermissionError");
		});
		const outcome = await runFind(ctx(call), "ticket", "B-04788");
		expect(outcome.rows).toEqual([]);
		expect(outcome.error).toBe("PermissionError");
	});
});

describe("by customer", () => {
	it("sends one typed value to all four fields the endpoint ORs", async () => {
		// The cashier holds a name, a phone or an RFC and does not know which
		// box the register wants. Asking them is asking them to know the schema.
		const { call, calls } = fakeServer({
			[SEARCH]: () => ({ invoices: [invoice("B-04788")], has_more: true }),
		});
		const outcome = await runFind(ctx(call), "customer", "5599");
		expect(calls[0]?.args).toMatchObject({
			customer_name: "5599",
			customer_id: "5599",
			mobile_no: "5599",
			tax_id: "5599",
		});
		expect(outcome.hasMore).toBe(true);
	});
});

describe("by item, and by serial or IMEI", () => {
	it("resolves in two hops, and the second is the eligibility endpoint", async () => {
		const { call, calls } = fakeServer({
			[LIST]: () => [{ parent: "B-04788" }, { parent: "B-04788" }, { parent: "B-04101" }],
			[SEARCH]: (args: any) => ({
				invoices: [invoice(String(args.invoice_name))],
				has_more: false,
			}),
		});
		const outcome = await runFind(ctx(call), "item", "IPN003282");

		expect(calls[0]?.method).toBe(LIST);
		expect(calls[0]?.args).toMatchObject({
			doctype: "Sales Invoice Item",
			parent: "Sales Invoice",
			fields: ["parent"],
		});
		// Distinct parents only, and each one goes through the endpoint that
		// decides whether it is still returnable.
		expect(calls.filter((c) => c.method === SEARCH)).toHaveLength(2);
		expect(outcome.rows.map((row) => row.name).sort()).toEqual(["B-04101", "B-04788"]);
	});

	it("matches a serial with LIKE, because a row can carry several", async () => {
		// `serial_no` on an invoice row is newline-separated when the line moved
		// more than one unit; equality would find only the singles.
		const { call, calls } = fakeServer({
			[LIST]: () => [{ parent: "B-04788" }],
			[SEARCH]: (args: any) => ({ invoices: [invoice(String(args.invoice_name))] }),
		});
		await runFind(ctx(call), "serial", "356938035643809");
		expect(calls[0]?.args.or_filters).toEqual([
			["serial_no", "like", "%356938035643809%"],
		]);
	});

	it("never widens the result set the LIKE was supposed to narrow", async () => {
		// `invoice_name` is a LIKE, so candidate `B-047` also drags in `B-0478`.
		const { call } = fakeServer({
			[LIST]: () => [{ parent: "B-047" }],
			[SEARCH]: () => ({ invoices: [invoice("B-047"), invoice("B-0478")] }),
		});
		const outcome = await runFind(ctx(call), "item", "IPN003282");
		expect(outcome.rows.map((row) => row.name)).toEqual(["B-047"]);
	});

	it("stops at the candidate cap rather than opening the whole ledger", async () => {
		const many = Array.from({ length: 40 }, (_, i) => ({ parent: `B-${1000 + i}` }));
		const { call, calls } = fakeServer({
			[LIST]: () => many,
			[SEARCH]: (args: any) => ({ invoices: [invoice(String(args.invoice_name))] }),
		});
		await runFind(ctx(call), "item", "MICA");
		expect(calls.filter((c) => c.method === SEARCH)).toHaveLength(CANDIDATE_LIMIT);
	});

	it("surfaces a failure of the first hop instead of reporting no sales", async () => {
		const call = vi.fn(async (options: FrappeCallOptions) => {
			if (options.method === LIST) throw new Error("PermissionError");
			return { message: {} };
		});
		const outcome = await runFind(ctx(call), "serial", "35693803");
		expect(outcome.rows).toEqual([]);
		expect(outcome.error).toBe("PermissionError");
	});

	it("returns the newest sale first", async () => {
		const { call } = fakeServer({
			[LIST]: () => [{ parent: "B-01" }, { parent: "B-02" }],
			[SEARCH]: (args: any) => ({
				invoices: [
					invoice(String(args.invoice_name), args.invoice_name === "B-01" ? "2026-01-04" : "2026-08-18"),
				],
			}),
		});
		const outcome = await runFind(ctx(call), "item", "MICA");
		expect(outcome.rows.map((row) => row.name)).toEqual(["B-02", "B-01"]);
	});
});

describe("the supervised path does not search", () => {
	it("finds nothing, and does not quietly fall back to a ticket search", async () => {
		const { call } = fakeServer({});
		expect((await runFind(ctx(call), "noReceipt", "B-04788")).rows).toEqual([]);
		expect((await runFind(ctx(call), "por-serie", "B-04788")).rows).toEqual([]);
		expect(call).not.toHaveBeenCalled();
	});
});

describe("who rang the original sale", () => {
	it("reads `owner`, the closest true answer without a backend change", async () => {
		const { call, calls } = fakeServer({
			"frappe.client.get_value": () => ({ owner: "rosa@doco.mx" }),
		});
		expect(await fetchSaleCashier(ctx(call), "B-04788")).toBe("rosa@doco.mx");
		expect(calls[0]?.args).toMatchObject({ fieldname: ["owner"] });
	});

	it("stays silent on failure rather than taking the return down with it", async () => {
		const call = vi.fn(async () => {
			throw new Error("nope");
		});
		expect(await fetchSaleCashier(ctx(call), "B-04788")).toBeNull();
		expect(await fetchSaleCashier(ctx(call), "")).toBeNull();
	});
});

describe("the warranty window and who has to authorise", () => {
	it("reads the server's own dates rather than recomputing the rule", () => {
		const within = resolveWarrantyWindow(
			{ posa_return_valid_upto: "2026-09-17", posa_return_expired: 0 },
			"2026-08-22",
		);
		expect(within.verdict).toBe("within");
		expect(within.daysLeft).toBe(26);
		expect(within.requiresAuthorisation).toBe(false);
	});

	it("summons a supervisor once the window has closed", () => {
		const expired = resolveWarrantyWindow(
			{ posa_return_valid_upto: "2026-07-17", posa_return_expired: 1 },
			"2026-08-22",
		);
		expect(expired.verdict).toBe("expired");
		expect(expired.requiresAuthorisation).toBe(true);
	});

	it("lets the SERVER decide expiry, because only it knows if the profile enforces one", () => {
		// A past date with the flag clear means the profile does not enforce the
		// window. Recomputing locally would refuse a return the server allows.
		const notEnforced = resolveWarrantyWindow(
			{ posa_return_valid_upto: "2026-07-17", posa_return_expired: 0 },
			"2026-08-22",
		);
		expect(notEnforced.verdict).toBe("within");
		expect(notEnforced.requiresAuthorisation).toBe(false);
	});

	it("treats an unrecorded window as ordinary, not as an exception", () => {
		const none = resolveWarrantyWindow({ posa_return_valid_upto: null }, "2026-08-22");
		expect(none.verdict).toBe("unrecorded");
		// null, not 0 — 0 would read as "expires today", the opposite of what an
		// absent window means.
		expect(none.daysLeft).toBeNull();
		expect(none.requiresAuthorisation).toBe(false);
		expect(resolveWarrantyWindow(null, "2026-08-22").verdict).toBe("unrecorded");
	});
});
