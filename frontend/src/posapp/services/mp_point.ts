// MP-INTEGRATION-POINT — MercadoPago Point (push-to-terminal) connector client.
// Pure UX trigger; the connector owns the money + auto-matches the payment to
// the invoice via external_reference. Frozen contract: see
// MERCADOPAGO_POINT_INTEGRATION.md §2. Flag-gated — no-op when disabled.

declare const frappe: any;

export interface PointOrder {
	name: string;
	order_status: string;
	mp_order_id?: string;
	error_message?: string;
}
export interface PointPayment {
	status: string;
	amount_gross?: number;
}
export interface PointStatus {
	order_status: string;
	error?: string;
	payment: PointPayment | null;
}
export interface PointTerminal {
	terminal_id: string;
	pos_id?: string;
	store_id?: string;
	operating_mode?: string;
}

const BASE = "mercadopago_connector.api.point.";

async function call<T>(
	method: string,
	args: Record<string, unknown>,
	type: "GET" | "POST",
): Promise<T> {
	const res = await frappe.call({ method: BASE + method, type, args });
	return (res && res.message) as T;
}

export function createPointOrder(args: {
	pos_invoice?: string | null;
	amount: number;
	terminal_id?: string;
	// Dynamic-Link target: "POS Invoice" or "Sales Invoice" (POSAwesome's
	// invoice doctype). Optional — the backend auto-detects when omitted.
	invoice_doctype?: string;
}): Promise<{ ok: boolean; order: PointOrder }> {
	return call("create_point_order", args, "POST");
}

export function pointOrderStatus(order: string): Promise<PointStatus> {
	return call("point_order_status", { order }, "GET");
}

export function cancelPointOrder(order: string): Promise<{ ok: boolean }> {
	return call("cancel_point_order", { order }, "POST");
}

export function listEnabledTerminals(): Promise<PointTerminal[]> {
	return call("list_enabled_terminals", {}, "GET");
}
