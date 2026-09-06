import type { SyncResponse, SyncChangeRecord, SyncDeleteRecord } from "./adapters/common";

/** Finish a bounded server window before advancing its durable watermark. */
export async function fetchAllSyncPages(
	fetchPage: (pageCursor: string | null) => Promise<SyncResponse>,
): Promise<SyncResponse> {
	const changes: SyncChangeRecord[] = [];
	const deleted: SyncDeleteRecord[] = [];
	const seen = new Set<string>();
	let cursor: string | null = null;
	for (;;) {
		const response = await fetchPage(cursor);
		if (response.full_resync_required) return response;
		changes.push(...(response.changes || []));
		deleted.push(...(response.deleted || []));
		if (changes.length + deleted.length > 50_000) {
			throw new Error("Offline sync exceeds the 50,000-record device limit; watermark preserved");
		}
		if (!response.has_more) return { ...response, changes, deleted };
		const next = response.next_cursor;
		if (!next || seen.has(next)) {
			throw new Error("Offline sync page did not advance; watermark preserved");
		}
		seen.add(next);
		cursor = next;
	}
}
