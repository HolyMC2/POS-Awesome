import api from "./api";
import { unwrapApiResult, type ApiEnvelope } from "./api";
import type { InvoiceDoc, POSProfile } from "../types/models";

// Submit gets a longer leash than the 30s api.ts default. The server is allowed
// 120s (gunicorn `--timeout=120`), so a 30s client timeout reported "failed" to
// the cashier while the request was still legitimately running — the fetch has
// no AbortController, so the server finished and submitted the sale anyway.
// 2026-07-24: recargas that took 60-300s (hold-until-confirm + RQ queue wait)
// showed up as false failures, and a cashier re-press stacked a second
// execution (harmless — submit is idempotent on posa_client_request_id — but it
// doubled the load that caused the stall). Matched to the server ceiling so the
// client gives up only once the server truly has.
const SUBMIT_TIMEOUT_MS = 120_000;

function getSubmitInvoiceCall(
	data: any,
	invoiceDoc: InvoiceDoc | string,
	invoiceType: string,
	posProfile: POSProfile,
) {
	const method =
		invoiceType === "Order" && posProfile.posa_create_only_sales_order
			? "posawesome.posawesome.api.sales_orders.submit_sales_order"
			: invoiceType === "Quotation"
				? "posawesome.posawesome.api.quotations.submit_quotation"
				: "posawesome.posawesome.api.invoices.submit_invoice";

	const args = {
		data,
		invoice: invoiceDoc,
		order: invoiceDoc,
		// Quotation submits need the profile for the server flag gate
		// (custom_allow_create_quotation); frappe drops unaccepted kwargs
		// for the other methods.
		pos_profile: posProfile.name,
		submit_in_background:
			posProfile.posa_allow_submissions_in_background_job,
	};

	return { method, args };
}

const invoiceService = {
	submitInvoice(
		data: any,
		invoiceDoc: InvoiceDoc | string,
		invoiceType: string,
		posProfile: POSProfile,
	): Promise<ApiEnvelope<any>> {
		const { method, args } = getSubmitInvoiceCall(
			data,
			invoiceDoc,
			invoiceType,
			posProfile,
		);
		return api.callEnvelope(method, args, { timeoutMs: SUBMIT_TIMEOUT_MS });
	},

	async submitInvoiceData(
		data: any,
		invoiceDoc: InvoiceDoc | string,
		invoiceType: string,
		posProfile: POSProfile,
	): Promise<any> {
		return unwrapApiResult(
			await this.submitInvoice(data, invoiceDoc, invoiceType, posProfile),
		);
	},
};

export default invoiceService;
