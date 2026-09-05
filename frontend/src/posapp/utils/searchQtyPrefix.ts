/**
 * The multiplier in the search box: `3*coca` or `3*` then a scan.
 *
 * The oldest habit on a Mexican counter (SICAR, Eleventa, Aspel all read
 * it): the cashier types the quantity, an asterisk, and then the product —
 * by name, by code or by beep — and the line lands with that quantity. The
 * register's «Cantidad» field does the same job with a mouse; this is the
 * same field driven from the box the hands already live in.
 *
 * Pure. Three seams read it: the live filter (`displayedItems` strips the
 * prefix so `3*coca` still matches Coca), the search/scan dispatch
 * (`_performSearch` strips it and sets the selector's qty) and the scan
 * primer (`isSearchFieldPrimedForScan` accepts a box holding only `3*`).
 */

export interface QtyPrefixParse {
	/** `null` when the text carries no multiplier. */
	qty: number | null;
	/** The text after the multiplier — what the search actually asks for. */
	term: string;
	/** True when the box holds ONLY a multiplier (`3*`), waiting for a scan. */
	armed: boolean;
}

const PREFIX = /^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/s;

export const parseQtyPrefix = (raw: string | null | undefined): QtyPrefixParse => {
	const text = String(raw ?? "");
	const match = PREFIX.exec(text);
	if (!match) {
		return { qty: null, term: text, armed: false };
	}
	const qty = Number(String(match[1]).replace(",", "."));
	if (!Number.isFinite(qty) || qty <= 0) {
		return { qty: null, term: text, armed: false };
	}
	const term = match[2] ?? "";
	return { qty, term, armed: term.trim() === "" };
};

/** The search term with any multiplier removed. */
export const stripQtyPrefix = (raw: string | null | undefined): string => parseQtyPrefix(raw).term;
