/**
 * The Facturas ledger, as arithmetic (build plan §15.3).
 *
 * Pure by construction — no Vue, no store, no `__()`, no `frappe`. Same
 * reasoning as `returns/findMethods.ts` and `shell/railDestinations.ts`: every
 * rule on this surface has to be reasonable about in a test, and none of them
 * is if the only way to produce it is to mount a 3,283-line component.
 *
 * This half holds the SURFACE's rules — which segments exist, which finder
 * modes exist, how an amount is matched, where the keyboard ring lands, and
 * what the footer is counting. Row shaping and the day's arithmetic live in
 * `ledgerRows.ts`, split out when this file passed the 500-line limit; it is
 * re-exported below, so every caller still has one import and the dependency
 * stays one-way (nothing in `ledgerRows.ts` imports from here).
 *
 * Two rules the artboard cannot state and this module must:
 *
 * 1. **A chip renders the BOUND chord or no chord.** The artboard prints
 *    F1–F4 on the finder. `MUELLE_DEFAULT` binds none of them here, and F4
 *    has meant `employee.switch` since before the shortcuts engine existed
 *    (R8) — so `shortcutActionId` is `null` on all four modes and
 *    `describeFindModes` resolves an empty chord list.
 * 2. **English source in, Spanish out of `es.csv`.** Labels here are source
 *    strings the view wraps in `__()`. The status labels in `ledgerRows.ts`
 *    deliberately do NOT reuse the shared `Paid` / `Overdue` / `Partly Paid`
 *    keys: those are translated masculine ("Pagado", "Vencido") because they
 *    describe a payment elsewhere in the app, and every noun on this surface
 *    is a *factura*. A two-column CSV has no context column, so the only way
 *    to get "Pagada" without breaking the other surfaces is a key of its own.
 */

import { chordsForAction } from "../returns/findMethods";
import type { ResolvedKeymap } from "../../../../shortcuts/engine";
import type { LedgerFigures, LedgerRowSource } from "./ledgerRows";

// One import for callers, one file per responsibility. See the note above.
export * from "./ledgerRows";

/* -------------------------------------------------------------------------- */
/* Segments                                                                    */
/* -------------------------------------------------------------------------- */

export const LEDGER_SEGMENT_IDS = ["today", "shift", "pending", "drafts", "returns"] as const;

export type LedgerSegmentId = (typeof LEDGER_SEGMENT_IDS)[number];

/** The four tabs the engine already loads and filters. */
export type LedgerTab = "history" | "partial" | "drafts" | "returns";

/**
 * Capability questions the surface answers for the segment.
 *
 * `shiftScoped` — can the loaded rows be told apart by opening shift? The
 * field exists on the doctype (`posa_pos_opening_shift`, written by
 * `invoice_utils/document.ts`), but `getInvoiceListFields` does not ask for
 * it and that call is inside a method this wave may not edit. So it is
 * `false` today, the Turno segment is ABSENT rather than empty (R3), and the
 * moment the field is listed this flips with no other edit.
 */
export interface LedgerSegmentGates {
	shiftScoped: boolean;
}

export interface LedgerSegment {
	id: LedgerSegmentId;
	/** English source string; the view wraps it in `__()`. */
	label: string;
	tab: LedgerTab;
	/**
	 * `true` when choosing this segment scopes the tab to TODAY. Only Hoy
	 * does: an unpaid balance from last month is the whole point of
	 * Pendientes, and a return the cashier is chasing is usually yesterday's.
	 */
	todayScoped: boolean;
	gate: keyof LedgerSegmentGates | null;
}

/**
 * Named rather than reached for by index: `noUncheckedIndexedAccess` is on in
 * this repo, and `LEDGER_SEGMENTS[0]` is `LedgerSegment | undefined` — so the
 * fallback has to be a value, not a subscript.
 */
const TODAY_SEGMENT: LedgerSegment = {
	id: "today",
	label: "Today",
	tab: "history",
	todayScoped: true,
	gate: null,
};

export const LEDGER_SEGMENTS: readonly LedgerSegment[] = [
	TODAY_SEGMENT,
	{ id: "shift", label: "Shift", tab: "history", todayScoped: false, gate: "shiftScoped" },
	{ id: "pending", label: "Pending invoices", tab: "partial", todayScoped: false, gate: null },
	{ id: "drafts", label: "Drafts", tab: "drafts", todayScoped: false, gate: null },
	{ id: "returns", label: "Returns", tab: "returns", todayScoped: false, gate: null },
] as const;

/** The segments this register offers, in artboard order. Gated-off is ABSENT. */
export const describeSegments = (gates: LedgerSegmentGates): LedgerSegment[] =>
	LEDGER_SEGMENTS.filter((segment) => segment.gate === null || gates[segment.gate]);

export const isLedgerSegmentId = (value: unknown): value is LedgerSegmentId =>
	typeof value === "string" && (LEDGER_SEGMENT_IDS as readonly string[]).includes(value);

/**
 * Where a rail destination lands. `drafts` on Borradores, `invoices` on Hoy —
 * §15.2, and the same two ids `useHostedSheet` already hands the component.
 */
export const segmentForDestination = (destinationId: string | null | undefined): LedgerSegmentId =>
	destinationId === "drafts" ? "drafts" : "today";

/**
 * Which segment a tab is showing.
 *
 * Ambiguous for `history`, which both Hoy and Turno map onto: the preferred
 * id wins when it is one of them, so re-entering the surface on Turno does
 * not silently jump to Hoy once the shift field is listed.
 */
export const segmentForTab = (tab: LedgerTab, preferred?: LedgerSegmentId | null): LedgerSegmentId => {
	if (preferred) {
		const candidate = LEDGER_SEGMENTS.find((segment) => segment.id === preferred);
		if (candidate && candidate.tab === tab) return candidate.id;
	}
	return LEDGER_SEGMENTS.find((segment) => segment.tab === tab)?.id ?? "today";
};

export const getSegment = (id: LedgerSegmentId): LedgerSegment =>
	LEDGER_SEGMENTS.find((segment) => segment.id === id) ?? TODAY_SEGMENT;

/**
 * The filter state a segment asks the engine for.
 *
 * Returned as data rather than applied here, because the fields it writes
 * (`historyDateFrom`, `partialSearch`, …) belong to `InvoiceManagement.vue`'s
 * `data()` and this module never touches a component.
 */
export interface LedgerSegmentIntent {
	segment: LedgerSegmentId;
	tab: LedgerTab;
	from: string;
	to: string;
}

export const segmentIntent = (
	id: LedgerSegmentId,
	today: string,
	options: { recent?: boolean } = {},
): LedgerSegmentIntent => {
	const segment = getSegment(id);
	// Hoy fallen back to Recientes asks the engine for history UNSCOPED — the
	// latest rows the tab already orders by — instead of an empty day.
	const scoped = segment.todayScoped && !options.recent;
	return {
		segment: id,
		tab: segment.tab,
		from: scoped ? today : "",
		to: scoped ? today : "",
	};
};

/**
 * Hoy when there is nothing to show for today becomes Recientes (owner
 * direction 2026-08-22): the latest history rows, under a label that says so.
 * A register opened at 02:02 that has sold nothing yet should not greet the
 * cashier with an empty list when yesterday's tickets are one query away.
 *
 * The decision is made only once the tab has READ (`loaded !== null`): an
 * empty array from a register that has not looked yet is not "nothing today".
 * The figures are untouched — `describeFigures` scopes `sold` to today's
 * posting date on its own, so a broader load cannot inflate "Vendido hoy".
 */
export interface TodayPresentation {
	/** Show the latest rows instead of an empty day. */
	recent: boolean;
	/** The segment's label, English source: "Today" or "Recent". */
	label: string;
}

export const todayPresentation = (input: {
	segment: LedgerSegmentId;
	/** `collections.history.loaded` — null until the tab has read. */
	historyLoaded: readonly unknown[] | null;
	/** Rows whose posting date is today, i.e. `figures.sold.count`. */
	todayCount: number | null;
	/** Already fallen back on this mount; stays until Hoy is chosen again. */
	alreadyRecent: boolean;
}): TodayPresentation => {
	if (input.segment !== "today") {
		return { recent: false, label: TODAY_SEGMENT.label };
	}
	if (input.alreadyRecent) {
		return { recent: true, label: "Recent" };
	}
	const read = input.historyLoaded !== null;
	const nothingToday = read && (input.todayCount ?? 0) === 0 && input.historyLoaded!.length === 0;
	return nothingToday ? { recent: true, label: "Recent" } : { recent: false, label: TODAY_SEGMENT.label };
};

/** The segments with Hoy relabelled while it is showing Recientes. */
export const presentSegments = (
	segments: readonly LedgerSegment[],
	presentation: TodayPresentation,
): LedgerSegment[] =>
	segments.map((segment) =>
		segment.id === "today" ? { ...segment, label: presentation.label } : segment,
	);

/* -------------------------------------------------------------------------- */
/* Finder modes                                                                */
/* -------------------------------------------------------------------------- */

export const LEDGER_FIND_MODE_IDS = ["ticket", "customer", "date", "amount"] as const;

export type LedgerFindModeId = (typeof LEDGER_FIND_MODE_IDS)[number];

/**
 * `search` feeds the tab's existing text filter, `range` swaps the box for
 * the from/to pair the tab already has, `client` narrows the rows already on
 * screen and nothing else. The last one is the only mode that does not reach
 * the engine, and the footer has to say so — see `finderFooterKind`.
 */
export type LedgerFindKind = "search" | "range" | "client";

export interface LedgerFindMode {
	id: LedgerFindModeId;
	/** English source strings; the view wraps both in `__()`. */
	label: string;
	placeholder: string;
	kind: LedgerFindKind;
	/**
	 * Action id from `shortcuts/actions.ts`, or `null` when the engine has no
	 * action for this mode — legal, and true of all four today. An INVENTED id
	 * is not legal: the cheat sheet and conflict detection both resolve ids
	 * against that registry, so a name that is not in it would draw a chip
	 * nothing can ever press. The artboard prints F1–F4; `MUELLE_DEFAULT`
	 * binds none of them here and F4 has meant `employee.switch` since before
	 * the engine existed (R8).
	 */
	shortcutActionId: string | null;
	/** Where the mode's answer comes from, as a repo-checkable name. */
	dataSource: string;
}

/** Named for the same reason `TODAY_SEGMENT` is: it is the fallback. */
const TICKET_MODE: LedgerFindMode = {
	id: "ticket",
	label: "By ticket",
	placeholder: "Ticket number",
	kind: "search",
	shortcutActionId: null,
	// `filterCollection` ORs name/customer/status/owner, so one field covers
	// the ticket without asking the cashier which one they are holding.
	dataSource: "InvoiceManagement.filterCollection(search)",
};

export const LEDGER_FIND_MODES: readonly LedgerFindMode[] = [
	TICKET_MODE,
	{
		id: "customer",
		label: "By customer",
		placeholder: "Customer name",
		kind: "search",
		shortcutActionId: null,
		dataSource: "InvoiceManagement.filterCollection(search)",
	},
	{
		id: "date",
		label: "By date",
		placeholder: "",
		kind: "range",
		shortcutActionId: null,
		dataSource: "InvoiceManagement.inRange(historyDateFrom, historyDateTo)",
	},
	{
		id: "amount",
		label: "By amount",
		placeholder: "Amount",
		kind: "client",
		shortcutActionId: null,
		// Client-side ON PURPOSE: no server filter exists for grand_total and
		// inventing one is a server change §15.3 forbids.
		dataSource: "none — matches the loaded rows, see matchesAmount",
	},
] as const;

export interface ResolvedLedgerFindMode extends LedgerFindMode {
	/** Empty when the active keymap binds nothing — render no chip. */
	chords: string[];
}

export const describeFindModes = (resolved?: ResolvedKeymap | null): ResolvedLedgerFindMode[] =>
	LEDGER_FIND_MODES.map((mode) => ({
		...mode,
		chords: chordsForAction(mode.shortcutActionId, resolved),
	}));

export const isLedgerFindModeId = (value: unknown): value is LedgerFindModeId =>
	typeof value === "string" && (LEDGER_FIND_MODE_IDS as readonly string[]).includes(value);

export const getFindMode = (id: LedgerFindModeId): LedgerFindMode =>
	LEDGER_FIND_MODES.find((mode) => mode.id === id) ?? TICKET_MODE;

/* -------------------------------------------------------------------------- */
/* Amount matching                                                             */
/* -------------------------------------------------------------------------- */

/** Cents, so a two-decimal total never loses a peso to binary floating point. */
const cents = (value: number): number => Math.round(value * 100);

/**
 * Read what a cashier types into the Monto box.
 *
 * They type what is printed on the ticket — `1,129.00`, `$1129`, `1 129` —
 * so separators come out before the parse. `null` for anything that is not a
 * number, which is what stops an empty box from matching nothing.
 */
export const parseAmountQuery = (raw: string): number | null => {
	const cleaned = String(raw ?? "")
		.replace(/[^\d.,-]/g, "")
		.replace(/,(?=\d{3}\b)/g, "")
		.replace(/\s/g, "")
		.replace(/,/g, ".");
	if (!cleaned || !/\d/.test(cleaned)) return null;
	const parsed = Number.parseFloat(cleaned);
	return Number.isFinite(parsed) ? Math.abs(parsed) : null;
};

/**
 * Exact first, then within one per cent.
 *
 * Exact is what a cashier reading the ticket back expects. The tolerance is
 * for the other half of the job — "it was about eleven hundred" — and one per
 * cent is narrow enough that $1,129 does not drag $1,200 in with it.
 */
export const matchesAmount = (amount: number, query: number): boolean => {
	const target = cents(Math.abs(query));
	const value = cents(Math.abs(Number(amount) || 0));
	if (value === target) return true;
	return Math.abs(value - target) <= Math.round(target * 0.01);
};

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One tab's state as the engine already holds it.
 *
 * Nothing here is recomputed: `page` is `paginatedHistoryInvoices` and its
 * three siblings, `total` is the matching `filtered*.length`, `pageNo` is
 * `tabPages[tab]` and `pageCount` is `*PageCount`. The ledger re-filters
 * nothing the engine has already filtered — the only client-side narrowing on
 * this surface is the Monto mode, and it says so in the footer.
 */
export interface LedgerCollection {
	/** The rows on screen for this tab, already filtered and paginated. */
	page: readonly LedgerRowSource[];
	/** Rows in the filtered collection, before pagination. */
	total: number;
	pageNo: number;
	pageCount: number;
	/**
	 * Everything the tab has READ, for the segment counts and the figures.
	 * `null` when it has not read yet — never `[]`, which would say "no
	 * invoices today" about a register that has not looked.
	 */
	loaded: readonly LedgerRowSource[] | null;
}

export type LedgerCollections = Readonly<Record<LedgerTab, LedgerCollection>>;

export const collectionForSegment = (
	collections: LedgerCollections,
	segment: LedgerSegmentId,
): LedgerCollection => collections[getSegment(segment).tab];

/**
 * The number beside each segment name.
 *
 * Derived from the figures where the two would otherwise disagree: Hoy counts
 * today's sales, which is exactly `sold.count`, and Devoluciones counts every
 * loaded return, which is exactly `refunded.count`. Two independent counts of
 * one thing is how a header starts contradicting the list under it.
 */
export const segmentCounts = (
	collections: LedgerCollections,
	figures: LedgerFigures,
	options: { recent?: boolean } = {},
): Record<LedgerSegmentId, number | null> => ({
	// Recientes counts what the list shows — the loaded history rows — because
	// "0" beside a segment listing twenty-five tickets is the header
	// contradicting the list.
	today: options.recent
		? collections.history.loaded
			? collections.history.loaded.length
			: null
		: figures.sold
			? figures.sold.count
			: null,
	// No shift field is listed, so there is nothing to count and the segment
	// is not rendered at all — see `LedgerSegmentGates.shiftScoped`.
	shift: null,
	pending: figures.receivable ? figures.receivable.count : null,
	drafts: collections.drafts.loaded ? collections.drafts.loaded.length : null,
	returns: figures.refunded ? figures.refunded.count : null,
});

/* -------------------------------------------------------------------------- */
/* Keyboard ring                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where ↑↓ / Home / End land.
 *
 * `null` means "this key is not ours" — the handler leaves the event alone
 * rather than swallowing a chord the shortcuts engine owns. Clamped at both
 * ends rather than wrapped: a list that jumps from the last row to the first
 * makes a cashier lose their place, and this list is a ledger, not a carousel.
 */
export const nextIndex = (key: string, index: number, length: number): number | null => {
	if (length <= 0) return null;
	const last = length - 1;
	const unset = index < 0 || index > last;
	switch (key) {
		case "ArrowDown":
			return unset ? 0 : Math.min(index + 1, last);
		case "ArrowUp":
			return unset ? last : Math.max(index - 1, 0);
		case "Home":
			return 0;
		case "End":
			return last;
		default:
			return null;
	}
};

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What the row count is counting.
 *
 * `page` is the ordinary "1–8 de 31". `loaded` is what the Monto mode has to
 * say instead: the match ran over the rows already on screen, so the count is
 * a count of THOSE, and a footer that read "3 de 31" would claim a search of
 * the whole ledger that never happened.
 */
export type LedgerFooterKind = "page" | "loaded";

export const finderFooterKind = (
	mode: LedgerFindModeId,
	query: string,
): LedgerFooterKind =>
	mode === "amount" && parseAmountQuery(query) !== null ? "loaded" : "page";
