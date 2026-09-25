/**
 * The register's reads and writes for provider-financed credit sales.
 *
 * Every call goes to `mercado.api.pos_credit` (the mercado app owns the
 * credit records) except the expense list, which is posawesome's own POS Cash
 * Movement read. Reads are GET and writes POST, matching how the server
 * whitelists them. `api.call` throws an `ApiEnvelopeError` whose `message` is
 * the server's readable reason.
 *
 * The payloads never carry the provider's commission, the expected
 * settlement, the bonus or the seller commission: those are management
 * figures, and no type here has a field for them.
 */
import api from "../../../services/api";
import cashMovementService from "../../../services/cashMovementService";

const METHOD = "mercado.api.pos_credit";
const READ = { type: "GET" as const };

export type CreditShape = "split" | "enganche";
/** `financing_compliance` on the Sales Invoice. `Completo` is set by the lock. */
export type CreditCompliance = "Faltante" | "Completo" | "Bloqueado";
export type CreditListStatus = "pending" | "all";

export interface CreditDocumentKind {
	kind: string;
	label: string;
}

export interface CreditProviderOption {
	name: string;
	label: string;
	shape: CreditShape;
	mode_of_payment: string | null;
	default_plan_months: number | null;
	documents: CreditDocumentKind[];
	print_format: string | null;
	console_url: string | null;
}

export interface CreditContext {
	enabled: boolean;
	/** Why credit sales are unavailable on this register, when they are. */
	reason: string | null;
	can_lock: boolean;
	providers: CreditProviderOption[];
	/** `File.attachment_kind` options, for documents outside the checklist. */
	document_kinds: string[];
	max_upload_mb: number;
}

export interface CreditFile {
	name: string;
	file_name: string;
	file_url: string;
	is_image: boolean;
	can_remove: boolean;
}

export interface CreditExtraFile extends CreditFile {
	attachment_kind: string | null;
}

export interface CreditRequiredDocument {
	kind: string;
	label: string;
	satisfied: boolean;
	/** Satisfied by the serial number (IMEI) on the financed line, not a file. */
	via_serial: boolean;
	file: CreditFile | null;
}

export interface CreditDocuments {
	required: CreditRequiredDocument[];
	extra: CreditExtraFile[];
	missing: number;
	total: number;
	complete: boolean;
}

export interface CreditSaleItem {
	item_code: string;
	item_name: string;
	qty: number;
	serial_no: string | null;
	financed: boolean;
}

export interface CreditSale {
	name: string;
	docstatus: number;
	pos_profile: string;
	company: string;
	currency: string;
	posting_date: string;
	customer: string;
	customer_name: string;
	owner_name: string;
	is_financed: boolean | number;
	credit_provider: string;
	provider_label: string;
	shape: CreditShape;
	/** «Credit price»: the total on the provider's contract. */
	customer_offered_price: number;
	/** «Down payment». */
	enganche: number;
	/** What was settled on the provider's Mode of Payment (0 in the enganche shape). */
	financed_amount: number;
	/** «Financed by {provider}»: credit price less down payment. */
	credit_amount: number;
	plan_months: number | null;
	plan_monthly: number | null;
	notes: string | null;
	compliance: CreditCompliance;
	items: CreditSaleItem[];
	documents: CreditDocuments;
	can_edit: boolean;
	can_lock: boolean;
}

export interface CreditSaleRow {
	name: string;
	posting_date: string;
	customer_name: string;
	credit_provider: string;
	customer_offered_price: number;
	enganche: number;
	/** Attached over required, e.g. `2/4`. */
	documents: string;
	missing: number;
	compliance: CreditCompliance;
	owner_name: string;
	/** Not in the contract yet; used when the server starts sending it. */
	currency?: string | null;
}

export interface CreditSaleList {
	rows: CreditSaleRow[];
	counts: { pending: number; all: number };
}

export interface CreditSaleChanges {
	plan_months?: number | null;
	plan_monthly?: number | null;
	notes?: string | null;
}

export interface CreditAttachment {
	invoice: string;
	kind: string;
	filename: string;
	/** Base64 bytes (a data URL is accepted too). */
	content: string;
}

/** A POS Cash Movement of type Expense linked to the sale. */
export interface CreditExpenseRow {
	name: string;
	posting_date: string;
	amount: number;
	expense_account: string;
	remarks: string | null;
	/** 1 submitted, 2 cancelled. */
	docstatus: 1 | 2;
	user: string;
	user_name: string;
	pos_profile: string;
	pos_opening_shift: string;
	journal_entry: string | null;
	creation: string;
}

export const getCreditContext = (posProfile: string) =>
	api.call<CreditContext>(`${METHOD}.get_context`, { pos_profile: posProfile }, READ);

const contextCache = new Map<string, Promise<CreditContext>>();

/**
 * The context of one profile, fetched once per page life. Document kinds and
 * the upload limit are configuration, so a detail opened twelve times from the
 * queue asks once; a failed read is forgotten so the next caller retries.
 */
export function loadCreditContext(posProfile: string, { force = false } = {}): Promise<CreditContext> {
	const cached = contextCache.get(posProfile);
	if (cached && !force) return cached;
	const request = getCreditContext(posProfile);
	contextCache.set(posProfile, request);
	request.catch(() => {
		if (contextCache.get(posProfile) === request) contextCache.delete(posProfile);
	});
	return request;
}

export const getCreditSale = (invoice: string) =>
	api.call<CreditSale>(`${METHOD}.get_credit_sale`, { invoice }, READ);

export const listCreditSales = (args: {
	posProfile: string;
	status: CreditListStatus;
	search?: string;
	limit?: number;
}) =>
	api.call<CreditSaleList>(
		`${METHOD}.list_credit_sales`,
		{
			pos_profile: args.posProfile,
			status: args.status,
			search: args.search || "",
			limit: args.limit ?? 50,
		},
		READ,
	);

export const attachCreditDocument = (attachment: CreditAttachment) =>
	api.call<CreditDocuments>(`${METHOD}.attach_document`, { ...attachment });

export const removeCreditDocument = (invoice: string, file: string) =>
	api.call<CreditDocuments>(`${METHOD}.remove_document`, { invoice, file });

export const updateCreditSale = (invoice: string, changes: CreditSaleChanges) =>
	api.call<CreditSale>(`${METHOD}.update_credit_sale`, { invoice, ...changes });

export const lockCreditSale = (invoice: string) =>
	api.call<CreditSale>(`${METHOD}.lock_credit_sale`, { invoice });

export const getCreditSaleExpenses = (invoice: string) =>
	cashMovementService.getSalesInvoiceExpenses(invoice) as Promise<CreditExpenseRow[]>;
