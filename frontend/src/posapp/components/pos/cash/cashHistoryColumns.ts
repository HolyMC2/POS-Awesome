/**
 * What the cash-movement history shows, at what width.
 *
 * Ten columns — Date · Against Name · Type · Amount · Source · Target ·
 * Remarks · Journal Entry · Status · Actions — do not fit the history card.
 * On a 1440×900 register the card's content box is 724px and the ten-column
 * table's MIN-CONTENT width is 945px, so `Actions` sat 221px outside it. The
 * destination audit measured `table @685..1634` on the live register; the
 * numbers below were measured the same way, in a real layout engine, against
 * this component's own stylesheet.
 *
 * Min-content width of each set, at this table's 8px cell padding:
 *
 *   core (6)                       491px
 *   core + direction (8)           651px
 *   core + direction + trail (10)  785px
 *
 * The thresholds carry ~30px of headroom over those figures, because
 * min-content is measured against representative account names and a longer
 * one moves the floor.
 *
 * The tiers are a judgement about what a cashier reviewing today's drawer
 * actually reads, not about which columns are cheapest to drop:
 *
 * - CORE is the question the surface exists to answer — when, what, how much,
 *   who, did it post, and what can I do about it. `Status` keeps its colour
 *   AND its word, so it is never the tier that goes.
 * - DIRECTION (`Source`, `Target`) is not noise. Commit 649f2ba66 made the
 *   create payload role-based and the form now states which way money moves
 *   ("Register Drawer Account (money arrives here)"), so these two are how an
 *   operator checks a movement that looks wrong. They are the first thing
 *   ADDED once there is room, and they survive at 1440.
 * - TRAIL (`Remarks`, `Journal Entry`) is the paper trail. It is read when
 *   reconciling, not when reviewing, so it is the last thing added.
 *
 * Nothing is deleted: whatever a tier sheds is rendered in the row's expanded
 * detail, reachable from every row at every width (`hiddenCashHistoryColumns`
 * is what that panel iterates). Below the narrowest tier the card's own
 * horizontal scroller is the safety net — see `.cash-movement-history__scroller`.
 */

export type CashHistoryColumnKey =
	| "posting_date"
	| "against_name"
	| "movement_type"
	| "amount"
	| "source_account"
	| "target_account"
	| "remarks"
	| "journal_entry"
	| "docstatus"
	| "actions";

/** When · what · how much · who · did it post · what can I do. */
export const CASH_HISTORY_CORE_COLUMNS: CashHistoryColumnKey[] = [
	"posting_date",
	"against_name",
	"movement_type",
	"amount",
	"docstatus",
	"actions",
];

/** Which way the money moved (`649f2ba66`). Added first once there is room. */
export const CASH_HISTORY_DIRECTION_COLUMNS: CashHistoryColumnKey[] = ["source_account", "target_account"];

/** The paper trail. Added last; read when reconciling, not when reviewing. */
export const CASH_HISTORY_TRAIL_COLUMNS: CashHistoryColumnKey[] = ["remarks", "journal_entry"];

/**
 * Column order as rendered. Building the visible list by filtering this keeps
 * the order stable no matter which tier is in play — a column must not move
 * sideways when the window is resized past a threshold.
 */
export const CASH_HISTORY_COLUMN_ORDER: CashHistoryColumnKey[] = [
	"posting_date",
	"against_name",
	"movement_type",
	"amount",
	"source_account",
	"target_account",
	"remarks",
	"journal_entry",
	"docstatus",
	"actions",
];

/** Table width at or above which the paper trail is affordable (785px + headroom). */
export const CASH_HISTORY_TRAIL_MIN_WIDTH = 820;

/** Table width at or above which Source and Target are affordable (651px + headroom). */
export const CASH_HISTORY_DIRECTION_MIN_WIDTH = 680;

/**
 * The keys this table renders in `width` px of table container.
 *
 * A width of 0 means "not measured yet" — the first frame before the
 * ResizeObserver reports, or a jsdom mount with no layout engine. That falls
 * to CORE on purpose: the narrow set never overflows, so the table cannot
 * flash a too-wide layout before it settles.
 */
export function visibleCashHistoryColumns(width: number): CashHistoryColumnKey[] {
	const allowed = new Set<CashHistoryColumnKey>(CASH_HISTORY_CORE_COLUMNS);
	if (width >= CASH_HISTORY_DIRECTION_MIN_WIDTH) {
		for (const key of CASH_HISTORY_DIRECTION_COLUMNS) allowed.add(key);
	}
	if (width >= CASH_HISTORY_TRAIL_MIN_WIDTH) {
		for (const key of CASH_HISTORY_TRAIL_COLUMNS) allowed.add(key);
	}
	return CASH_HISTORY_COLUMN_ORDER.filter((key) => allowed.has(key));
}

/**
 * The keys this width sheds — the contents of the row's detail panel.
 *
 * `actions` can never appear here: it is core, and a shed column that carried
 * controls rather than values would put those controls out of reach.
 */
export function hiddenCashHistoryColumns(width: number): CashHistoryColumnKey[] {
	const visible = new Set(visibleCashHistoryColumns(width));
	return CASH_HISTORY_COLUMN_ORDER.filter((key) => !visible.has(key));
}
