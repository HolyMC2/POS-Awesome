import api, { type ApiEnvelope } from "./api";

/**
 * Client for doco's scan-to-catalog service
 * (`doco.docoutils.catalog_items`). doco is optional on POS sites: when the
 * module is not installed the first call fails with a "method not found"
 * shape and the service stays disabled for the rest of the session, so the
 * unknown-scan path falls back to the stock POS behavior.
 */

const CATALOG_METHOD_BASE = "doco.docoutils.catalog_items";
// Scan-loop friendly: an unknown barcode should never hang the register.
const PREFILL_TIMEOUT_MS = 5000;

export interface CatalogSatKeySuggestion {
	key: string;
	description?: string;
}

export interface CatalogPrefill {
	barcode: string;
	found_in: "item" | "reference" | "central" | "none";
	item_code?: string | null;
	product_name?: string | null;
	brand?: string | null;
	size?: string | null;
	category?: string | null;
	item_group?: string | null;
	stock_uom?: string | null;
	suggested_sat_keys?: CatalogSatKeySuggestion[];
	can_create: boolean;
	selling_price_list?: string | null;
	buying_price_list?: string | null;
}

export interface CreateItemFromScanArgs {
	barcode: string;
	item_name: string;
	item_group?: string | null;
	stock_uom?: string | null;
	brand?: string | null;
	selling_price?: number | null;
	buying_price?: number | null;
	mx_product_service_key?: string | null;
	opening_qty?: number | null;
	warehouse?: string | null;
	company?: string | null;
}

export interface CreateItemFromScanResult {
	item_code: string;
	item_name: string;
	created: boolean;
}

export interface RequestItemResult {
	name: string;
	status: string;
}

let catalogUnavailable = false;

const MISSING_METHOD_PATTERN =
	/failed to get method|no module named|has no attribute|not whitelisted|http 404/i;

function isMissingMethod(envelope: ApiEnvelope<unknown>) {
	if (envelope.ok) return false;
	return MISSING_METHOD_PATTERN.test(envelope.error.message || "");
}

function compactArgs(args: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (value === null || value === undefined || value === "") continue;
		out[key] = value;
	}
	return out;
}

const catalogScanService = {
	isAvailable() {
		return !catalogUnavailable;
	},

	/** Test hook: forget a previous "doco absent" verdict. */
	resetAvailability() {
		catalogUnavailable = false;
	},

	/**
	 * Returns the prefill payload, or null when doco is absent or the call
	 * failed for any reason (callers keep the stock not-found behavior).
	 */
	async prefillForBarcode(barcode: string): Promise<CatalogPrefill | null> {
		const code = String(barcode || "").trim();
		if (!code || catalogUnavailable) return null;
		const envelope = await api.callEnvelope<CatalogPrefill>(
			`${CATALOG_METHOD_BASE}.prefill_for_barcode`,
			{ barcode: code },
			{ timeoutMs: PREFILL_TIMEOUT_MS },
		);
		if (!envelope.ok) {
			if (isMissingMethod(envelope)) catalogUnavailable = true;
			return null;
		}
		const data = envelope.data;
		if (!data || typeof data !== "object") return null;
		return data;
	},

	createItemFromScan(
		args: CreateItemFromScanArgs,
	): Promise<ApiEnvelope<CreateItemFromScanResult>> {
		return api.callEnvelope<CreateItemFromScanResult>(
			`${CATALOG_METHOD_BASE}.create_item_from_scan`,
			compactArgs(args as unknown as Record<string, unknown>),
		);
	},

	requestItemForBarcode(
		barcode: string,
		note: string | null = null,
	): Promise<ApiEnvelope<RequestItemResult>> {
		return api.callEnvelope<RequestItemResult>(
			`${CATALOG_METHOD_BASE}.request_item_for_barcode`,
			compactArgs({ barcode, note, source_app: "pos" }),
		);
	},
};

export default catalogScanService;
