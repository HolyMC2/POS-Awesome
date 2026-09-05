import api from "./api";

import type {
	BatchBucket,
	BatchSearchPayload,
	BatchStory,
	SerialBucket,
	SerialSearchPayload,
	SerialStory,
} from "../components/pos/lots/lotsModel";

/**
 * SERIES Y LOTES from the SPA's side — four reads, nothing else.
 *
 * Every call is scoped by the POS Profile the register is running: the
 * server resolves the company and the warehouse from it and never takes
 * either from here, so a cashier cannot widen their own view by editing a
 * request (`lot_lookup._profile_scope`).
 */

const READ = "posawesome.posawesome.api.lot_lookup";

export interface SerialSearchOptions {
	query?: string | null;
	status?: SerialBucket | null;
	itemCode?: string | null;
	warehouse?: string | null;
	limit?: number | null;
	offset?: number | null;
}

export async function searchSerials(
	posProfile: string,
	options: SerialSearchOptions = {},
): Promise<SerialSearchPayload> {
	return api.call<SerialSearchPayload>(`${READ}.search_serials`, {
		pos_profile: posProfile,
		query: options.query ?? null,
		status: options.status ?? null,
		item_code: options.itemCode ?? null,
		warehouse: options.warehouse ?? null,
		limit: options.limit ?? null,
		offset: options.offset ?? null,
	});
}

export async function fetchSerialStory(posProfile: string, serialNo: string): Promise<SerialStory> {
	return api.call<SerialStory>(`${READ}.get_serial_story`, {
		pos_profile: posProfile,
		serial_no: serialNo,
	});
}

export interface BatchSearchOptions {
	query?: string | null;
	bucket?: BatchBucket | null;
	itemCode?: string | null;
	limit?: number | null;
}

export async function searchBatches(
	posProfile: string,
	options: BatchSearchOptions = {},
): Promise<BatchSearchPayload> {
	return api.call<BatchSearchPayload>(`${READ}.search_batches`, {
		pos_profile: posProfile,
		query: options.query ?? null,
		bucket: options.bucket ?? null,
		item_code: options.itemCode ?? null,
		limit: options.limit ?? null,
	});
}

export async function fetchBatchStory(posProfile: string, batchNo: string): Promise<BatchStory> {
	return api.call<BatchStory>(`${READ}.get_batch_story`, {
		pos_profile: posProfile,
		batch_no: batchNo,
	});
}
