import type { MoneyException } from "../../../../services/moneyExceptionsService";

type RecordData = Record<string, any>;
const finite = (value: unknown): number | null => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const retryable = new Set(["pending", "failed", "syncing", "retrying"]);

/** Whitelist display fields; queue payloads, terminal proofs and raw errors never leave this mapper. */
export function browserMoneyExceptions(entries: RecordData[], outbox: RecordData[]): MoneyException[] {
	const rows: MoneyException[] = [];
	const invoiceIds = new Set<string>();
	for (const entry of entries) {
		if (["synced", "resolved"].includes(entry.status) || entry.entity_type === "customer") continue;
		const invoice = entry.payload?.invoice;
		const data = invoice || entry.payload?.args?.payload || entry.payload?.payload || entry.payload || {};
		const requestId = text(data.client_request_id || data.posa_client_request_id || entry.idempotency_key);
		if (entry.entity_type === "invoice" && requestId) invoiceIds.add(requestId);
		const refund = data.operation === "refund_customer_advance";
		const reviewing = ["draft_review", "dead_letter"].includes(entry.status);
		rows.push({
			id: `browser:${entry.entity_type}:${entry.queue_id}`, origin: "browser", entity_type: entry.entity_type,
			kind: refund ? "advance_refund" : entry.entity_type, status: entry.status,
			severity: reviewing || entry.status === "failed" ? "warning" : "info",
			modified: text(entry.created_at), client_request_id: requestId,
			message_key: reviewing ? "Saved work needs review before it can finish." : "Saved on this browser; server confirmation is still pending.",
			next_action_key: refund ? "Check the original refund request before handing out cash or starting another refund." : "Keep the original request. Do not enter this transaction again.",
			document: entry.draft_invoice_name ? { doctype: "Sales Invoice", name: entry.draft_invoice_name } : null,
			amount: finite(data.grand_total ?? data.rounded_total ?? data.amount), currency: text(data.currency),
			actions: [{ type: !reviewing && retryable.has(entry.status) ? "retry_saved_queue" : "open_saved_work" }],
		});
	}
	for (const entry of outbox) {
		if (entry.status === "acknowledged" && entry.server_verified === true) continue;
		const review = entry.status === "dead_letter" || entry.status === "acknowledged";
		if (invoiceIds.has(entry.client_request_id)) {
			if (!review) continue;
			const existing = rows.findIndex(row => row.entity_type === "invoice" && row.client_request_id === entry.client_request_id);
			if (existing >= 0) rows.splice(existing, 1);
		}
		rows.push({
			id: `browser:outbox:${entry.outbox_id}`, origin: "browser", entity_type: "invoice",
			kind: "invoice", status: review ? "review" : entry.status, severity: review ? "warning" : "info",
			modified: text(entry.created_at), client_request_id: text(entry.client_request_id),
			message_key: review ? "The saved sale needs a verified server confirmation." : "Saved on this browser; server confirmation is still pending.",
			next_action_key: "Keep the original request. Do not enter this transaction again.",
			document: entry.invoice_name ? { doctype: "Sales Invoice", name: entry.invoice_name } : null,
			amount: finite(entry.invoice?.grand_total), currency: text(entry.invoice?.currency),
			actions: [{ type: review ? "open_saved_work" : "retry_saved_queue" }],
		});
	}
	return rows.sort((a, b) => (a.modified || "").localeCompare(b.modified || ""));
}

export function exceptionDocumentHref(doctype?: string, name?: string): string | null {
	if (!doctype || !name || [".", ".."].includes(name) || doctype.length > 140 || name.length > 280) return null;
	return `/app/${encodeURIComponent(doctype.toLowerCase().replace(/ /g, "-"))}/${encodeURIComponent(name)}`;
}

export const exceptionKindLabel = (kind: string): string => (({
	invoice: "Saved sale", invoice_submission: "Invoice submission", payment: "Saved payment",
	advance_refund: "Advance refund", cash_movement: "Cash movement", restaurant_order: "Saved order",
	charge_callback: "Paid order follow-up", financial_request: "Payment request", processor: "Payment provider", fiscal: "Fiscal document",
} as Record<string, string>)[kind] || "Money exception");

export const exceptionSourceLabel = (kind: string): string => (({
	charge_callbacks: "Paid order follow-up", invoice_submissions: "Invoice submissions",
	financial_receipts: "Payment requests", financial_requests: "Payment requests", processor: "Payment provider", fiscal: "Fiscal documents",
} as Record<string, string>)[kind] || kind);
