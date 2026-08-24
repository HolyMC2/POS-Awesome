import api from "./api";

import type {
	QuotationCounts,
	QuotationLine,
	QuotationRow,
} from "../components/pos/flows/cotizaciones/quotationModel";

/**
 * The Cotizaciones lane, from the SPA's side (DOCUMENTOS_GOLDEN_FLOW §1).
 *
 * Four calls, one per moment in the loop: save the cart as a quote, list them,
 * load one back into the sale, and that is the whole surface. Nothing here
 * prices anything — `create` sends the cart's own rates and `load` receives
 * whichever rates the server decided the quote still earns.
 *
 * `search_quotations` on the same backend module is NOT wrapped here on
 * purpose: it serves the old Drafts «Quote» tab (both docstatuses, no estado)
 * and the two lists would drift the moment one of them learned a filter.
 */

const READ = "posawesome.posawesome.api.quotations";
const WRITE = "posawesome.posawesome.api.quotation_conversion";

export interface QuotationListPayload {
	rows: QuotationRow[];
	counts: QuotationCounts;
	today: string;
	company: string;
}

export interface CreatedQuotation {
	name: string;
	doctype: "Quotation";
	customer: string;
	customer_name: string;
	valid_till: string;
	validity_days: number;
	grand_total: number;
	currency: string;
}

/** The cart, as little of it as the server needs to write a real Quotation. */
export interface QuotationCartPayload {
	customer: string;
	currency?: string | null;
	selling_price_list?: string | null;
	taxes_and_charges?: string | null;
	items: Array<{
		item_code: string;
		item_name?: string | null;
		description?: string | null;
		qty: number;
		uom?: string | null;
		conversion_factor?: number | null;
		rate: number;
		price_list_rate?: number | null;
		warehouse?: string | null;
	}>;
}

/**
 * A refusal is a RESULT, not an exception.
 *
 * A converted quotation comes back `allowed: false` with the invoice named, so
 * the surface can show the warning and a link to the sale that already
 * happened. Throwing would leave the client with `_server_messages` to parse
 * and no invoice to link — and it is not an error: the cashier asked a
 * reasonable question and the honest answer is "that one is already sold".
 */
export interface RefusedQuotation {
	allowed: false;
	reason: "converted";
	quotation: QuotationRow;
	invoice: string;
	invoice_doctype: string;
}

export interface LoadedQuotation {
	allowed: true;
	reason: "honoured" | "expired";
	expired: boolean;
	quotation: QuotationRow;
	lines: QuotationLine[];
	quoted_total: number;
	today_total: number;
	/** A real draft invoice, already saved. The cart adopts it as-is. */
	invoice_doc: Record<string, any>;
}

export type QuotationLoadResult = LoadedQuotation | RefusedQuotation;

export const isRefusedQuotation = (
	result: QuotationLoadResult,
): result is RefusedQuotation => result.allowed === false;

export async function fetchQuotations(
	posProfile: string,
	options: { bucket?: string | null; search?: string | null } = {},
): Promise<QuotationListPayload> {
	return api.call<QuotationListPayload>(`${READ}.get_quotations`, {
		pos_profile: posProfile,
		status_bucket: options.bucket ?? null,
		search: options.search ?? null,
	});
}

export async function createQuotationFromCart(input: {
	posProfile: string;
	payload: QuotationCartPayload;
	validityDays?: number | null;
	note?: string | null;
}): Promise<CreatedQuotation> {
	return api.call<CreatedQuotation>(`${WRITE}.create_quotation_from_cart`, {
		pos_profile: input.posProfile,
		payload: input.payload,
		validity_days: input.validityDays ?? null,
		note: input.note ?? null,
	});
}

export async function loadQuotationForSale(
	posProfile: string,
	quotation: string,
): Promise<QuotationLoadResult> {
	return api.call<QuotationLoadResult>(`${WRITE}.load_quotation_for_sale`, {
		pos_profile: posProfile,
		quotation,
	});
}
