/**
 * The Cobranza panel, as arithmetic (artboard `Cobranza.dc.html`).
 *
 * Pure by construction — no Vue, no store, no `__()`, no `frappe`. The same
 * reasoning `quotationModel.ts` and `ledgerModel.ts` record: every rule on this
 * surface has to be reasonable about in a test, and none of them is if the only
 * way to produce it is to mount a component.
 *
 * Three rules the artboard cannot state and this module must:
 *
 * 1. **The aging comes from the SERVER.** `receivables.py` decides which bucket
 *    a row is in, because the decision is a date comparison against the
 *    SERVER's today and a register with a skewed clock would redden an invoice
 *    that is still inside its term. This module names the tabs and orders them;
 *    it never recomputes an aging.
 * 2. **The tab and the chip are different questions.** An invoice 24 days late
 *    that somebody already put money down on sits in the Vencidas TAB and wears
 *    the «Apartado» CHIP — what happened to the calendar and what happened to
 *    the money are both worth a column.
 * 3. **English source in, Spanish out of `es.csv`.** Three of the nouns this
 *    surface needs already exist in that file in the WRONG GENDER: `Overdue` is
 *    «Vencido» (it describes a *monto* on the stats card, which is right there)
 *    and `All` is «Todos». Every noun in the tab row is a *factura*, so the
 *    tabs take keys of their own — `Overdue invoices`, `All receivables` — and
 *    the stats card keeps the masculine one it shares with the rest of the app.
 */

/** Server-side aging ids, mirrored from `receivables.RECEIVABLE_BUCKETS`. */
export const RECEIVABLE_AGINGS = ["overdue", "due_soon", "upcoming"] as const;

export type ReceivableAging = (typeof RECEIVABLE_AGINGS)[number];

/**
 * Tab ids, in artboard order.
 *
 * `collected_today` is here and NOT in the server's bucket tuple on purpose:
 * it is the reconciliation half of the toolbox and reads a different document
 * (Payment Entry). It is a tab to the cashier and a second endpoint to the
 * server, and this is the one place those two truths meet.
 */
export const RECEIVABLE_TABS_IDS = ["overdue", "due_soon", "all", "collected_today"] as const;

export type ReceivableTabId = (typeof RECEIVABLE_TABS_IDS)[number];

export type Tone = "good" | "warn" | "bad" | "muted";

export interface ReceivableTab {
	id: ReceivableTabId;
	/** English source string; the view wraps it in `__()`. */
	label: string;
	tone: Tone;
}

export const RECEIVABLE_TABS: readonly ReceivableTab[] = [
	// See rule 3 — `Overdue` is taken, and taken in the masculine.
	{ id: "overdue", label: "Overdue invoices", tone: "bad" },
	{ id: "due_soon", label: "Due soon", tone: "warn" },
	{ id: "all", label: "All receivables", tone: "muted" },
	{ id: "collected_today", label: "Collected today", tone: "good" },
] as const;

const ALL_TAB: ReceivableTab = { id: "all", label: "All receivables", tone: "muted" };

export const isReceivableTabId = (value: unknown): value is ReceivableTabId =>
	typeof value === "string" && (RECEIVABLE_TABS_IDS as readonly string[]).includes(value);

export const getReceivableTab = (id: ReceivableTabId): ReceivableTab =>
	RECEIVABLE_TABS.find((tab) => tab.id === id) ?? ALL_TAB;

/**
 * The escalation ladder's position for one row — DERIVED server-side from the
 * reminder log (`receivables._reminder_summaries`), never stored, so the chip
 * and the history cannot disagree. `next_level` is what one press of the
 * Reminder button files; the server recomputes it rather than trusting this
 * echo.
 */
export interface ReminderSummary {
	count: number;
	/** `null` until somebody has actually reminded. */
	last_level: number | null;
	last_on: string | null;
	last_channel: string | null;
	next_level: number;
}

/** One row of the reminder log, as the detail panel prints it. */
export interface ReminderEntry {
	name: string;
	level: number;
	channel: string | null;
	note: string | null;
	/** What was owed when the reminder went out — history stays honest after partials. */
	outstanding_at_send: number;
	owner: string;
	creation: string;
}

/** One worklist row, exactly as `get_receivables` returns it. */
export interface ReceivableRow {
	name: string;
	doctype: string;
	customer: string | null;
	customer_name: string | null;
	date: string;
	due: string;
	total: number;
	outstanding: number;
	/** `null` where the invoice and the party account are in two currencies. */
	paid: number | null;
	currency: string | null;
	outstanding_currency: string | null;
	pos_profile: string | null;
	aging: ReceivableAging;
	days_until_due: number | null;
	/** The chip: an aging, or `apartado` when part of it is already paid. */
	estado: ReceivableAging | "apartado";
	/** Optional: an old server without the ladder simply grows no chips. */
	reminders?: ReminderSummary;
}

/** The counts behind the first three tabs. `all` is the whole set. */
export interface ReceivableCounts {
	overdue: number;
	due_soon: number;
	all: number;
}

export interface ReceivableTotals {
	outstanding: number;
	outstanding_count: number;
	overdue: number;
	overdue_count: number;
	/** `null`, never `0`: zero days overdue is a real state (due today). */
	oldest_overdue_days: number | null;
}

export interface ReceivablesPayload {
	rows: ReceivableRow[];
	counts: ReceivableCounts;
	totals: ReceivableTotals;
	bucket: string;
	today: string;
	company: string;
	currency: string | null;
	limit: number;
	capped: boolean;
}

/** One invoice line, as the detail panel summarises it. */
export interface ReceivableLine {
	item_code: string;
	item_name?: string | null;
	qty: number;
	uom?: string | null;
	rate: number;
	amount: number;
}

/** One payment already made against the selected invoice. */
export interface ReceivablePayment {
	name: string;
	date: string;
	mode_of_payment: string | null;
	reference_no: string | null;
	amount: number;
	/**
	 * Tendered at the counter when the invoice was written, rather than
	 * collected afterwards as a Payment Entry.
	 *
	 * Worth saying on screen: it shares the invoice's date, so without the
	 * qualifier the panel shows a payment dated the day of a sale the customer
	 * did not finish paying for, and the cashier has to guess why.
	 */
	at_the_counter?: boolean;
}

export interface ReceivableContact {
	customer: string | null;
	customer_name: string | null;
	phone: string | null;
	email: string | null;
}

/** The whole right column, as `get_receivable_detail` returns it. */
export interface ReceivableDetail {
	row: ReceivableRow;
	lines: ReceivableLine[];
	lines_shown: number;
	payments: ReceivablePayment[];
	contact: ReceivableContact;
	/** `null` — never `0` — when the customer has no credit. See §2. */
	store_credit: number | null;
	/** The ladder's receipts, latest first. Optional like `row.reminders`. */
	reminders?: ReminderEntry[];
	currency: string | null;
	company: string;
}

/** One «Cobrado hoy» row, as `get_collected_today` returns it. */
export interface CollectedRow {
	name: string;
	party: string | null;
	party_name: string | null;
	party_type: string | null;
	mode_of_payment: string | null;
	reference_no: string | null;
	date: string;
	amount: number;
	currency: string | null;
	tendered_amount: number;
	tendered_currency: string | null;
}

export interface CollectedPayload {
	rows: CollectedRow[];
	total: number;
	count: number;
	date: string;
	company: string;
	currency: string | null;
	limit: number;
	capped: boolean;
}

export const emptyCounts = (): ReceivableCounts => ({ overdue: 0, due_soon: 0, all: 0 });

export const emptyTotals = (): ReceivableTotals => ({
	outstanding: 0,
	outstanding_count: 0,
	overdue: 0,
	overdue_count: 0,
	oldest_overdue_days: null,
});

/**
 * The Vence column, as words rather than a date wherever words are clearer.
 *
 * Returns a `{ key, count }` pair rather than a sentence so the view can
 * translate it: `__("in {0} days", [n])` needs the number outside the key, and
 * a pre-joined string would ship "in 5 days" to a Spanish register.
 *
 * `null` means the row carries no usable date — the surface prints «—» and,
 * crucially, claims nothing about how late it is.
 */
export interface DueLabel {
	/** English source string with an optional `{0}` slot. */
	key: string;
	/** Substituted into `{0}`, or null when the key takes no argument. */
	count: number | null;
	tone: Tone;
}

export const describeDue = (
	row: Pick<ReceivableRow, "days_until_due" | "due">,
): DueLabel | null => {
	if (!row.due) return null;
	const days = row.days_until_due;
	if (days === null || days === undefined) return null;
	if (days < 0) {
		// Magnitude, not the negative: "hace 24 días" is what a cashier says on
		// the phone, and "-24 días" is what a spreadsheet says.
		return { key: "{0} days ago", count: Math.abs(days), tone: "bad" };
	}
	if (days === 0) return { key: "due today", count: null, tone: "warn" };
	if (days === 1) return { key: "tomorrow", count: null, tone: "warn" };
	return { key: "in {0} days", count: days, tone: days <= 7 ? "warn" : "muted" };
};

/** The Estado chip: the label and the colour the artboard paints it. */
export interface EstadoChip {
	/** English source string. */
	label: string;
	tone: Tone;
}

const ESTADO_CHIPS: Record<ReceivableRow["estado"], EstadoChip> = {
	// «Apartado» — the layaway shape. This panel is where apartados stop being
	// invisible (§2), so the chip names the arrangement rather than the aging.
	apartado: { label: "Layaway", tone: "warn" },
	// Singular and feminine: it describes ONE factura. The tab above it is
	// plural («Vencidas») and the stats card is masculine («Vencido», a monto).
	overdue: { label: "Overdue invoice", tone: "bad" },
	due_soon: { label: "Due soon", tone: "warn" },
	upcoming: { label: "Due soon", tone: "muted" },
};

export const estadoChip = (row: Pick<ReceivableRow, "estado">): EstadoChip =>
	ESTADO_CHIPS[row.estado] ?? ESTADO_CHIPS.upcoming;

/**
 * The ladder's names, by level. English source; `es.csv` renders the register's
 * own words («Recordatorio amable» · «Recordatorio firme» · «Aviso final»).
 * The ladder caps at 3 server-side (`receivables.MAX_REMINDER_LEVEL`), so an
 * out-of-range level reads as the final notice rather than as a blank.
 */
export const REMINDER_LEVEL_LABELS: Record<number, string> = {
	1: "Gentle reminder",
	2: "Firm reminder",
	3: "Final notice",
};

export const reminderLevelLabel = (level: number): string =>
	REMINDER_LEVEL_LABELS[level] ?? "Final notice";

/**
 * The worklist's escalation chip: `R1`/`R2`/`R3` beside the estado, toned by
 * how far up the ladder the customer already is. `null` when nobody has
 * reminded — absence renders as absence, the same honesty rule the monedero
 * chip follows.
 */
export interface ReminderChip {
	/** `R{level}` — compact, the row has no room for the level's name. */
	label: string;
	/** The level's full name, for the title/aria of the compact chip. */
	levelLabel: string;
	tone: Tone;
}

const REMINDER_TONES: Record<number, Tone> = { 1: "muted", 2: "warn", 3: "bad" };

export const reminderChip = (
	row: Pick<ReceivableRow, "reminders">,
): ReminderChip | null => {
	const summary = row.reminders;
	if (!summary || !summary.count || !summary.last_level) return null;
	const level = summary.last_level;
	return {
		label: `R${Math.min(level, 3)}`,
		levelLabel: reminderLevelLabel(level),
		tone: REMINDER_TONES[Math.min(level, 3)] ?? "bad",
	};
};

/**
 * Where the panel lands when it opens: Vencidas when it has rows, «Todas»
 * otherwise (§1).
 *
 * The whole premise of the surface is that it is a worklist and not a search
 * box, so landing on an EMPTY tab beside a full one would recreate the problem
 * it was built to solve — the cashier would have to go looking again.
 */
export const defaultTab = (counts: ReceivableCounts): ReceivableTabId =>
	counts.overdue > 0 ? "overdue" : "all";

/**
 * Client-side narrowing of the loaded rows.
 *
 * The server searches too (`get_receivables(search=…)`) and is the authority;
 * this exists so typing into the box narrows what is already on screen without
 * a round trip per keystroke. Same fields, same rule — folio or cliente.
 */
export const matchesQuery = (
	row: Pick<ReceivableRow, "name" | "customer" | "customer_name">,
	query: string,
): boolean => {
	const needle = String(query ?? "").trim().toLowerCase();
	if (!needle) return true;
	return [row.name, row.customer, row.customer_name]
		.map((value) => String(value ?? "").toLowerCase())
		.some((value) => value.includes(needle));
};

/** The same rule over a «Cobrado hoy» row: the folio here is the payment's. */
export const matchesCollectedQuery = (
	row: Pick<CollectedRow, "name" | "party" | "party_name" | "reference_no">,
	query: string,
): boolean => {
	const needle = String(query ?? "").trim().toLowerCase();
	if (!needle) return true;
	return [row.name, row.party, row.party_name, row.reference_no]
		.map((value) => String(value ?? "").toLowerCase())
		.some((value) => value.includes(needle));
};

/**
 * Tabs with their counts, in artboard order. Every tab is rendered even at
 * zero: a row of tabs that changes shape between one search and the next moves
 * under the cashier's finger.
 */
export interface ResolvedReceivableTab extends ReceivableTab {
	count: number;
	active: boolean;
}

export const describeTabs = (
	counts: ReceivableCounts,
	collectedCount: number,
	active: ReceivableTabId,
): ResolvedReceivableTab[] =>
	RECEIVABLE_TABS.map((tab) => ({
		...tab,
		count: tab.id === "collected_today" ? collectedCount : (counts[tab.id] ?? 0),
		active: tab.id === active,
	}));

/**
 * What an empty tab says.
 *
 * One sentence per tab, because the four emptinesses mean four different
 * things and a shared "no hay resultados" would tell a cashier with a clean
 * register the same thing it tells one whose search matched nothing. The
 * `searching` variant is separate for exactly that reason: a filtered-to-zero
 * list is the SEARCH being empty, not the register.
 */
export const emptyStateKey = (tab: ReceivableTabId, searching: boolean): string => {
	if (searching) {
		return "Nothing in this list matches what you typed.";
	}
	switch (tab) {
		case "overdue":
			return "Nothing is overdue. Every invoice on this register is still inside its term.";
		case "due_soon":
			return "Nothing falls due in the next 7 days.";
		case "collected_today":
			return "No payments received yet today.";
		default:
			return "Nothing is pending payment on this register.";
	}
};

/**
 * Where ↑↓ / Home / End land — the ledger's ring, imported rather than
 * re-derived, so every list in the register behaves identically under the same
 * fingers. A second implementation of "clamped, not wrapped" is a second place
 * for it to stop being true.
 */
export { nextIndex } from "../../flows/ledger/ledgerModel";
