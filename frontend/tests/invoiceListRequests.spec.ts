import { describe, expect, it } from "vitest";
import { beginInvoiceListRequest } from "../src/posapp/utils/invoiceListRequests";

describe("invoice list request ownership", () => {
	it("keeps loading until every independent list completes", () => {
		const owner: any = { loading: false, listRequests: {} };
		const history = beginInvoiceListRequest(owner, "history");
		const drafts = beginInvoiceListRequest(owner, "drafts");
		history.finish();
		expect(owner.loading).toBe(true);
		drafts.finish();
		expect(owner.loading).toBe(false);
	});
	it("ignores a superseded failure and completion", () => {
		const owner: any = {};
		const old = beginInvoiceListRequest(owner, "drafts");
		const current = beginInvoiceListRequest(owner, "drafts");
		old.fail("Old failure");
		old.finish();
		expect(old.current()).toBe(false);
		expect(owner.loading).toBe(true);
		expect(owner.listRequests.drafts.error).toBe("");
		current.finish();
		expect(owner.loading).toBe(false);
	});
	it("retains a failure until that list is retried", () => {
		const owner: any = {};
		const history = beginInvoiceListRequest(owner, "history");
		history.fail("Cannot fetch invoices");
		history.finish();
		beginInvoiceListRequest(owner, "drafts").finish();
		expect(owner.listRequests.history.error).toBe("Cannot fetch invoices");
		beginInvoiceListRequest(owner, "history");
		expect(owner.listRequests.history.error).toBe("");
	});
});
