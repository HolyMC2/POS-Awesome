import api from "./api";

export interface ExceptionAction {
	type: string;
	doctype?: string;
	name?: string;
	client_request_id?: string;
}
export interface MoneyException {
	id: string;
	kind: string;
	status: string;
	severity: string;
	modified: string | null;
	message_key: string;
	next_action_key: string;
	document: { doctype: string; name: string } | null;
	invoice?: { doctype: string; name: string } | null;
	client_request_id?: string | null;
	amount: number | null;
	currency: string | null;
	actions: ExceptionAction[];
	origin?: "browser" | "server";
	entity_type?: string;
}
export interface ExceptionSource {
	status: "supported" | "unavailable" | "error";
	count: number;
	has_more: boolean;
}
export interface MoneyExceptionFeed {
	version: number;
	company: string;
	pos_profile: string;
	opening_shift: string | null;
	as_of: string;
	rows: MoneyException[];
	has_more: boolean;
	sources: Record<string, ExceptionSource>;
}

export async function fetchMoneyExceptions(profile: string, openingShift?: string): Promise<MoneyExceptionFeed> {
	const response = await api.call<MoneyExceptionFeed>(
		"posawesome.posawesome.api.money_exceptions.get_money_exceptions",
		{ pos_profile: profile, opening_shift: openingShift || undefined, limit: 50 },
	);
	const document = (value: unknown) => value == null || (typeof value === "object" &&
		typeof (value as any).doctype === "string" && typeof (value as any).name === "string");
	if (!response || response.version !== 1 || response.pos_profile !== profile ||
		(response.opening_shift || "") !== (openingShift || "") || !Array.isArray(response.rows) ||
		!response.sources || ["invoice_submissions", "financial_receipts", "charge_callbacks", "processor", "fiscal"].some(key =>
			!response.sources[key] || !["supported", "unavailable", "error"].includes(response.sources[key].status)) ||
		response.rows.some(row => !row || ![row.id, row.kind, row.status, row.message_key, row.next_action_key].every(value => typeof value === "string") ||
			!document(row.document) || !document(row.invoice) ||
			!Array.isArray(row.actions) || row.actions.some(action => !action || typeof action.type !== "string" ||
				(action.doctype != null && typeof action.doctype !== "string") ||
				(action.name != null && typeof action.name !== "string")))) {
		throw new Error("The exception report could not be verified. Refresh to check again.");
	}
	return response;
}
