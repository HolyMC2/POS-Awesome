/**
 * The Cotizaciones lane, as arithmetic (artboard `Cotizacion.dc.html`).
 *
 * Pure by construction — no Vue, no store, no `__()`, no `frappe`. The same
 * reasoning `ledgerModel.ts` and `returns/findMethods.ts` record: every rule on
 * this surface has to be reasonable about in a test, and none of them is if the
 * only way to produce it is to mount a component.
 *
 * Two rules the artboard cannot state and this module must:
 *
 * 1. **The estado comes from the SERVER.** `quotation_read_model.py` decides
 *    which bucket a row is in, because the decision is a date comparison
 *    against the SERVER's today and a register with a skewed clock would file
 *    a live quote under Vencida. This module names the buckets and orders the
 *    tabs; it never recomputes one.
 * 2. **English source in, Spanish out of `es.csv`.** `Expired` already exists
 *    in that file as «Expirado» — masculine, because it describes a *plazo*
 *    elsewhere in the app — and every noun on this surface is a *cotización*.
 *    A two-column CSV has no context column, so the only way to get «Vencida»
 *    without breaking the other surface is a key of its own: `Expired quote`.
 *    The other three source strings are unused elsewhere and stay short.
 */

/** Bucket ids, mirrored from `quotation_read_model.QUOTATION_BUCKETS`. */
export const QUOTATION_ESTADOS = ["active", "expiring", "expired", "converted"] as const;

export type QuotationEstado = (typeof QUOTATION_ESTADOS)[number];

export interface QuotationTab {
	id: QuotationEstado;
	/** English source string; the view wraps it in `__()`. */
	label: string;
	/**
	 * Presentation tone, as a token name rather than a colour: the artboard
	 * paints Vigente green, Por vencer amber, Vencida red and Convertida grey,
	 * and the component maps these four names onto its own CSS.
	 */
	tone: "good" | "warn" | "bad" | "muted";
}

export const QUOTATION_TABS: readonly QuotationTab[] = [
	{ id: "active", label: "Valid", tone: "good" },
	{ id: "expiring", label: "Expiring", tone: "warn" },
	// See rule 2 above — `Expired` is taken, and taken in the wrong gender.
	{ id: "expired", label: "Expired quote", tone: "bad" },
	{ id: "converted", label: "Converted", tone: "muted" },
] as const;

const ACTIVE_TAB: QuotationTab = {
	id: "active",
	label: "Valid",
	tone: "good",
};

export const isQuotationEstado = (value: unknown): value is QuotationEstado =>
	typeof value === "string" && (QUOTATION_ESTADOS as readonly string[]).includes(value);

export const getQuotationTab = (id: QuotationEstado): QuotationTab =>
	QUOTATION_TABS.find((tab) => tab.id === id) ?? ACTIVE_TAB;

/** One list row, exactly as `get_quotations` returns it. */
export interface QuotationRow {
	name: string;
	customer: string | null;
	customer_name: string | null;
	date: string;
	valid_till: string;
	total: number;
	currency?: string | null;
	estado: QuotationEstado;
	days_left: number | null;
	converted_invoice: string | null;
	converted_invoice_doctype: string | null;
	note?: string;
	items_count?: number;
	owner?: string | null;
}

export type QuotationCounts = Record<QuotationEstado, number>;

export const emptyCounts = (): QuotationCounts => ({
	active: 0,
	expiring: 0,
	expired: 0,
	converted: 0,
});

/**
 * The Vence column, as words rather than a date wherever words are clearer.
 *
 * Returns a `{ key, count }` pair rather than a sentence so the view can
 * translate it: `__("in {0} days", [n])` needs the number outside the key, and
 * a pre-joined string would ship "in 5 days" to a Spanish register.
 *
 * `null` days means the quotation carries no `valid_till` — the artboard draws
 * that cell as «—» and the caller renders the dash.
 */
export interface DueLabel {
	/** English source string with an optional `{0}` slot. */
	key: string;
	/** Substituted into `{0}`, or null when the key takes no argument. */
	count: number | null;
	tone: "good" | "warn" | "bad" | "muted";
}

export const describeDue = (row: Pick<QuotationRow, "estado" | "days_left" | "valid_till">): DueLabel | null => {
	if (row.estado === "converted") {
		return null;
	}
	if (!row.valid_till) {
		return null;
	}
	const days = row.days_left;
	if (days === null || days === undefined) {
		return null;
	}
	if (days < 0) {
		// Magnitude, not the negative: "expired 3 days ago" is what a cashier
		// says, and "-3 days" is what a spreadsheet says.
		return { key: "expired {0} days ago", count: Math.abs(days), tone: "bad" };
	}
	if (days === 0) {
		return { key: "expires today", count: null, tone: "warn" };
	}
	if (days === 1) {
		return { key: "tomorrow", count: null, tone: "warn" };
	}
	return { key: "{0} days left", count: days, tone: days <= 2 ? "warn" : "good" };
};

/**
 * The line under a quoted-rate line: «precio cotizado · lista hoy $X».
 *
 * `null` when there is nothing to say. The server already decided that — it
 * sends `provenance` only where today's list rate disagrees with the quoted one
 * — and this function refuses to invent a second opinion about it, so the
 * detail panel and the hydrated cart cannot disagree about which lines moved.
 */
export interface LineProvenance {
	quoted_rate: number;
	today_rate: number;
}

export interface QuotationLine {
	item_code: string;
	item_name?: string | null;
	qty: number;
	uom?: string | null;
	rate: number;
	quoted_rate: number;
	today_rate: number | null;
	provenance: LineProvenance | null;
}

export const hasProvenance = (line: Pick<QuotationLine, "provenance">): boolean =>
	Boolean(line.provenance);

/**
 * Whether the expiry warning is shown, and what it has to name.
 *
 * The golden flow is specific: *an expired quote loads at TODAY's prices with a
 * visible warning naming both totals*. Naming both is the whole point — "prices
 * may have changed" tells a cashier nothing they can repeat to the customer
 * standing in front of them.
 */
export interface ExpiryWarning {
	quotedTotal: number;
	todayTotal: number;
	/** True when the two agree — the quote expired but nothing repriced. */
	unchanged: boolean;
}

export const expiryWarning = (input: {
	expired: boolean;
	quoted_total: number;
	today_total: number;
}): ExpiryWarning | null => {
	if (!input.expired) {
		return null;
	}
	const quoted = Number(input.quoted_total) || 0;
	const today = Number(input.today_total) || 0;
	return {
		quotedTotal: quoted,
		todayTotal: today,
		unchanged: Math.round(quoted * 100) === Math.round(today * 100),
	};
};

/**
 * Where ↑↓ / Home / End land — the ledger's ring, reused rather than
 * re-derived, so the two lists behave identically under the same fingers.
 *
 * Imported instead of copied: a second implementation of "clamped, not
 * wrapped" is a second place for it to stop being true.
 */
export { nextIndex } from "../ledger/ledgerModel";

/**
 * Client-side narrowing of the loaded rows.
 *
 * The server searches too (`get_quotations(search=…)`), and it is the
 * authority; this exists so typing into the box narrows what is already on
 * screen without a round trip per keystroke. Same fields, same rule — folio or
 * customer, the two things printed on the paper the customer brings back.
 */
export const matchesQuery = (row: QuotationRow, query: string): boolean => {
	const needle = String(query ?? "").trim().toLowerCase();
	if (!needle) return true;
	return [row.name, row.customer, row.customer_name]
		.map((value) => String(value ?? "").toLowerCase())
		.some((value) => value.includes(needle));
};

/**
 * Tabs with their counts, in artboard order. Every tab is rendered even at
 * zero: a row of tabs that changes shape between one search and the next moves
 * under the cashier's finger.
 */
export interface ResolvedQuotationTab extends QuotationTab {
	count: number;
	active: boolean;
}

export const describeTabs = (
	counts: QuotationCounts,
	active: QuotationEstado,
): ResolvedQuotationTab[] =>
	QUOTATION_TABS.map((tab) => ({
		...tab,
		count: counts[tab.id] ?? 0,
		active: tab.id === active,
	}));
