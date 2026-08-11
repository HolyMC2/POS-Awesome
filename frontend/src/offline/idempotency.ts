type AnyRecord = Record<string, any>;

const randomSuffix = () => Math.random().toString(36).slice(2, 10);

function ensureObject(value: any): AnyRecord {
	return value && typeof value === "object" ? value : {};
}

export function generateClientRequestId(prefix: string) {
	return `${prefix}-${Date.now()}-${randomSuffix()}`;
}

export function ensureInvoiceClientRequestId(invoice: AnyRecord) {
	const target = ensureObject(invoice);
	if (!String(target.posa_client_request_id || "").trim()) {
		target.posa_client_request_id = generateClientRequestId("inv");
	}
	return target.posa_client_request_id;
}

export function ensureOfflineInvoiceRequest(entry: AnyRecord) {
	const target = ensureObject(entry);
	target.invoice = ensureObject(target.invoice);
	target.data = ensureObject(target.data);

	const requestId = ensureInvoiceClientRequestId(target.invoice);
	if (!String(target.data.idempotency_key || "").trim()) {
		target.data.idempotency_key = requestId;
	}

	return requestId;
}

/**
 * Idempotency key for a table-order mutation (open / update / transfer /
 * settle / cancel). Same `<prefix>-<epoch_ms>-<8×base36>` shape as `inv-` /
 * `pay-` / `cm-`; the server dedupes on `posa_client_request_id`.
 *
 * Minted ONCE per logical request and reused on every retry and queue replay.
 * A coalesced queue entry carries NEW content, so it mints a fresh one — see
 * `offline/restaurantQueue.ts`.
 */
export function generateTableOrderRequestId() {
	return generateClientRequestId("tbl");
}

export function ensureTableOrderClientRequestId(payload: AnyRecord) {
	const target = ensureObject(payload);
	if (!String(target.client_request_id || "").trim()) {
		target.client_request_id = generateTableOrderRequestId();
	}
	return target.client_request_id;
}

export function ensurePaymentClientRequestId(payload: AnyRecord) {
	const target = ensureObject(payload);
	if (!String(target.client_request_id || "").trim()) {
		target.client_request_id = generateClientRequestId("pay");
	}
	return target.client_request_id;
}
