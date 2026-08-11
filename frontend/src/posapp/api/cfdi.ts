/**
 * Typed wrappers for the POS CFDI endpoints (posawesome.posawesome.api.cfdi
 * and .cfdi_customer). Online-only by design — stamping is a live PAC call
 * and must never queue: a queued timbrado replayed later could double-stamp
 * or stamp against stale fiscal data. Transport failures surface to the
 * operator immediately via the caller's error handling.
 *
 * @module posapp/api/cfdi
 */

declare const frappe: {
	call: (options: { method: string; args?: Record<string, unknown> }) => Promise<{
		message?: unknown;
	}>;
};

const BASE = "posawesome.posawesome.api.cfdi";
const CUSTOMER_BASE = "posawesome.posawesome.api.cfdi_customer";

export interface CfdiCatalogRow {
	key: string;
	description: string;
}

export interface CfdiUseRow extends CfdiCatalogRow {
	tax_regimes: string[];
}

export interface CfdiBootstrap {
	enabled: boolean;
	reason?: string;
	company?: string;
	catalogs?: {
		tax_regimes: CfdiCatalogRow[];
		cfdi_uses: CfdiUseRow[];
		payment_options: CfdiCatalogRow[];
		payment_methods: CfdiCatalogRow[];
	};
}

export type CfdiStampStatus = "stamped" | "unstamped" | "error";

export interface CfdiInvoiceRow {
	name: string;
	posting_date: string;
	grand_total: number;
	currency: string;
	customer: string;
	customer_name: string;
	is_return: number;
	mx_uuid: string;
	sat_status: string;
	stamp_error: string;
	stamp_status: CfdiStampStatus;
}

export interface CfdiPreflightCheck {
	code: string;
	level: "error" | "warn" | "info";
	ok: boolean;
	message: string;
	field: string;
	source: string;
}

export interface CfdiInvoiceDetail {
	invoice: {
		name: string;
		posting_date: string;
		grand_total: number;
		currency: string;
		docstatus: number;
		is_return: number;
		customer: string;
		customer_name: string;
		customer_address: string;
		mx_cfdi_use: string;
		mx_payment_option: string;
		mx_payment_mode: string;
		mode_of_payment: string;
		mx_uuid: string;
		sat_status: string;
		stamp_error: string;
		is_stamped: boolean;
	};
	customer_fiscal: CustomerFiscal | Record<string, never>;
	preflight: {
		status: string;
		blocking: boolean;
		checks: CfdiPreflightCheck[];
	};
	files: { pdf?: string; xml?: string };
}

export interface CustomerFiscal {
	customer: string;
	customer_name: string;
	tax_id: string;
	mx_tax_regime: string;
	mx_cfdi_use: string;
	mobile_no: string;
	email_id: string;
	billing_address: string;
	zip_code: string;
}

export interface StampFiscalData {
	customer?: string;
	customer_name?: string;
	customer_address?: string;
	zip_code?: string;
	tax_id?: string;
	tax_regime?: string;
	mx_cfdi_use?: string;
	mx_payment_option?: string;
	mx_payment_mode?: string;
	mode_of_payment?: string;
}

export interface StampResult {
	ok: boolean;
	already_stamped: boolean;
	invoice: string;
	uuid: string;
	sat_status?: string;
	files: { pdf?: string; xml?: string };
}

export interface RfcCheckResult {
	tax_id: string;
	valid: boolean;
	is_generic: boolean;
	kind: "PF" | "PM" | "";
	issues: { code: string; level: string; message: string }[];
	existing: { customer: string; customer_name: string } | null;
}

async function call<T>(method: string, args: Record<string, unknown>): Promise<T> {
	const response = await frappe.call({ method, args });
	return response?.message as T;
}

export function getCfdiBootstrap(posProfile: string): Promise<CfdiBootstrap> {
	return call(`${BASE}.get_cfdi_bootstrap`, { pos_profile: posProfile });
}

export function searchCfdiInvoices(
	posProfile: string,
	options: { search?: string; status?: string; limit?: number; start?: number } = {},
): Promise<CfdiInvoiceRow[]> {
	return call(`${BASE}.search_cfdi_invoices`, {
		pos_profile: posProfile,
		search: options.search ?? "",
		status: options.status ?? "all",
		limit: options.limit ?? 20,
		start: options.start ?? 0,
	});
}

export function getInvoiceCfdi(invoiceName: string): Promise<CfdiInvoiceDetail> {
	return call(`${BASE}.get_invoice_cfdi`, { invoice_name: invoiceName });
}

export function stampInvoice(
	invoiceName: string,
	posProfile: string,
	fiscal: StampFiscalData,
): Promise<StampResult> {
	return call(`${BASE}.stamp_invoice`, {
		invoice_name: invoiceName,
		pos_profile: posProfile,
		...fiscal,
	});
}

export function attachCfdiFiles(
	invoiceName: string,
	posProfile: string,
): Promise<{ ok: boolean; files: { pdf?: string; xml?: string } }> {
	return call(`${BASE}.attach_cfdi_files`, {
		invoice_name: invoiceName,
		pos_profile: posProfile,
	});
}

export function emailCfdi(
	invoiceName: string,
	email: string,
	posProfile: string,
): Promise<{ ok: boolean }> {
	return call(`${BASE}.email_cfdi`, {
		invoice_name: invoiceName,
		email,
		pos_profile: posProfile,
	});
}

/** URL for the streamed CFDI file — open in a new tab to download. */
export function cfdiFileUrl(invoiceName: string, kind: "pdf" | "xml"): string {
	const params = new URLSearchParams({ invoice_name: invoiceName, kind });
	return `/api/method/${BASE}.download_cfdi_file?${params.toString()}`;
}

export function getCustomerFiscal(customer: string): Promise<CustomerFiscal> {
	return call(`${CUSTOMER_BASE}.get_customer_fiscal`, { customer });
}

export function checkCustomerRfc(
	taxId: string,
	customer?: string,
): Promise<RfcCheckResult> {
	return call(`${CUSTOMER_BASE}.check_customer_rfc`, {
		tax_id: taxId,
		customer: customer ?? "",
	});
}

export function saveCustomerFiscal(
	posProfile: string,
	data: {
		customer?: string;
		customer_name?: string;
		tax_id?: string;
		tax_regime?: string;
		mx_cfdi_use?: string;
		zip_code?: string;
		mobile_no?: string;
		email_id?: string;
	},
): Promise<CustomerFiscal> {
	return call(`${CUSTOMER_BASE}.save_customer_fiscal`, {
		pos_profile: posProfile,
		...data,
	});
}
