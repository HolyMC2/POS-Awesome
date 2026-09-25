// Which item fields the register's relevance ranking reads (utils/relevance.ts).
// The server ranks the same surfaces in item_processing/search.py
// (_ranked_item_names), so a search reads the same online and offline.

import { rank, type RankFields } from "./relevance";

type Text = string | null | undefined;

export interface RankableItem {
	item_code?: Text;
	item_name?: Text;
	item_group?: Text;
	brand?: Text;
	description?: Text;
	barcode?: Text;
	item_barcode?: unknown;
	barcodes?: unknown;
	serial_no_data?: unknown;
	batch_no_data?: unknown;
}

function pick(list: unknown, key: string): Text[] {
	if (!Array.isArray(list)) return typeof list === "string" ? [list] : [];
	return list.map((entry) =>
		entry && typeof entry === "object"
			? ((entry as Record<string, Text>)[key] ?? null)
			: (entry as Text),
	);
}

/** Name first; group, brand and description as secondary text; codes,
 *  barcodes, serial and batch numbers as identifiers. */
export function itemRankFields(item: RankableItem): RankFields {
	return {
		name: item.item_name || item.item_code,
		others: [item.item_group, item.brand, item.description],
		codes: [
			item.item_code,
			item.barcode,
			...pick(item.item_barcode, "barcode"),
			...pick(item.barcodes, "barcode"),
			...pick(item.serial_no_data, "serial_no"),
			...pick(item.batch_no_data, "batch_no"),
		],
	};
}

/** Items matching `term`, best first; equal matches keep the input order. */
export function rankItems<T extends RankableItem>(
	items: readonly T[],
	term: string,
	limit?: number,
): T[] {
	return rank(items, term, itemRankFields, limit);
}
