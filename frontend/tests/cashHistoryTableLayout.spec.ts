// @vitest-environment node
/**
 * The cash-movement history fits the surface it is drawn on.
 *
 * `tests/visual/destination-audit.spec.ts` drove all twelve rail destinations
 * at 1440x900 on a live register. Eleven were clean; Gasto reported
 *
 *     expense   table @685..1634          <- ~194px past a 1440 viewport
 *               th.v-data-table__td @1358..1460
 *
 * The cause was not a stray margin and not a missing stylesheet. Ten columns
 * — Date, Against Name, Type, Amount, Source, Target, Remarks, Journal Entry,
 * Status, Actions — have a MIN-CONTENT width of 945px at Vuetify's 16px cell
 * padding, and the history card's content box on that register is 724px.
 * `table { width: 100% }` is a floor, not a cap, under `table-layout: auto`,
 * so the table simply grew past its container and Vuetify's
 * `.v-table__wrapper` clipped what did not fit — with `Actions` on the wrong
 * side of the cut and its scrollbar at the foot of a table that is itself
 * below the fold.
 *
 * This file holds the fix to the arithmetic that produced that number:
 *
 *   available = (viewport - rail - 2*bodyPadding - gap) * historyFr/totalFr
 *               - 2*cardPadding
 *
 * Every term is READ FROM THE SOURCE that owns it, so a later change to the
 * destination's grid or the card's padding fails here instead of shipping
 * another clipped column. The per-tier `MIN_CONTENT` figures were measured in
 * a real layout engine (headless chromium, this component's own stylesheet,
 * Roboto 14px, `density="compact"`), because jsdom has no layout engine and a
 * mounted assertion would be green either way — the same reason
 * `destinationRailLayout.spec.ts` is source-scanned.
 *
 * `node:fs` named imports do not interop under jsdom (build plan §10), hence
 * the node environment and hence a file of its own; the behavioural half is
 * `cashHistoryTable.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	CASH_HISTORY_COLUMN_ORDER,
	CASH_HISTORY_CORE_COLUMNS,
	CASH_HISTORY_DIRECTION_COLUMNS,
	CASH_HISTORY_TRAIL_COLUMNS,
	hiddenCashHistoryColumns,
	visibleCashHistoryColumns,
	type CashHistoryColumnKey,
} from "../src/posapp/components/pos/cash/cashHistoryColumns";

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const HISTORY = read("../src/posapp/components/pos/cash/CashMovementHistory.vue");
const VIEW = read("../src/posapp/components/pos/cash/CashMovementView.vue");
const RAIL = read("../src/posapp/components/pos/shell/rail/RegisterRail.vue");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the rule whose selector matches, comments removed. */
const ruleBody = (source: string, selector: string) => {
	const css = stripComments(source);
	const at = css.indexOf(selector);
	if (at < 0) throw new Error(`no rule for ${selector}`);
	const open = css.indexOf("{", at);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
};

const pxIn = (body: string, property: string) => {
	const match = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(body);
	if (!match) throw new Error(`no ${property} in ${JSON.stringify(body)}`);
	const px = /(-?\d+(?:\.\d+)?)px/.exec(match[1] ?? "");
	if (!px) throw new Error(`${property} is not a px length: ${match[1]}`);
	return Number(px[1]);
};

// ── The geometry, read from whoever owns it ────────────────────────────────
const RAIL_WIDTH = pxIn(ruleBody(RAIL, ".register-rail {"), "width");
const BODY = ruleBody(VIEW, ".cash-movement-destination__body {");
const BODY_PADDING = pxIn(BODY, "padding");
const BODY_GAP = pxIn(BODY, "gap");
const CARD_PADDING = pxIn(ruleBody(HISTORY, ".cash-movement-history__card {"), "padding");

/**
 * `grid-template-columns: minmax(320px, 5fr) minmax(0, 7fr)` -> [5, 7]. Only
 * the COLUMNS declaration: `grid-template-rows` carries a `1fr` of its own and
 * folding it in silently inflates the denominator.
 */
const columnTrack = /grid-template-columns\s*:\s*([^;]+)/.exec(BODY)?.[1] ?? "";
const FRACTIONS = [...columnTrack.matchAll(/(\d+(?:\.\d+)?)fr/g)].map((m) => Number(m[1]));
const HISTORY_FR = FRACTIONS[1] ?? 0;
const TOTAL_FR = FRACTIONS.reduce((sum, value) => sum + value, 0);

/** What the history table actually gets, in px, at a desktop viewport. */
const availableTableWidth = (viewport: number) => {
	const grid = viewport - RAIL_WIDTH - 2 * BODY_PADDING - BODY_GAP;
	return (grid * HISTORY_FR) / TOTAL_FR - 2 * CARD_PADDING;
};

/**
 * Min-content width of each tier, MEASURED in headless chromium against this
 * component's stylesheet with representative rows (a supplier name, two
 * chart-of-accounts strings, a `$ 12,450.00`, a Submitted chip, the action
 * stack). Per-column, summed:
 *
 *   Date 47 · Against Name 102 · Type 70 · Amount 78 · Source 79 · Target 81
 *   · Remarks 72 · Journal Entry 62 · Status 99 · Actions 94
 */
const MIN_CONTENT: Record<number, number> = { 6: 491, 8: 651, 10: 785 };

const minContentFor = (columns: CashHistoryColumnKey[]) => {
	const width = MIN_CONTENT[columns.length];
	if (width === undefined) throw new Error(`no measured min-content for a ${columns.length}-column tier`);
	return width;
};

describe("the destination's own arithmetic, read from source", () => {
	it("reproduces the width the audit measured on the live register", () => {
		// The audit's `table @685..1634` starts at 685; rail 96 + body padding
		// 16 + form column + gap 16 + card padding 16 puts the table's left edge
		// there, and the card's content box is what the table has to live in.
		expect(RAIL_WIDTH).toBe(96);
		expect(availableTableWidth(1440)).toBeCloseTo(724, 0);
		expect(availableTableWidth(1280)).toBeCloseTo(630.67, 1);
	});

	it("still describes a two-column grid whose second half is the history", () => {
		// If the grid ever becomes one column, or the fractions flip, the
		// budget below is measuring the wrong box and should say so loudly.
		expect(FRACTIONS.length).toBe(2);
		expect(HISTORY_FR).toBeGreaterThan(FRACTIONS[0] ?? 0);
	});
});

describe("nothing in this destination extends past its container", () => {
	it.each([
		[1440, 8],
		[1280, 6],
	])("fits the table inside the history card at %ipx", (viewport, expectedColumns) => {
		const available = availableTableWidth(viewport);
		const columns = visibleCashHistoryColumns(available);

		expect(columns).toHaveLength(expectedColumns);
		expect(minContentFor(columns)).toBeLessThanOrEqual(available);
	});

	// THE REGRESSION. This is the state the audit found: ten columns in a 724px
	// card. Kept as an explicit assertion so the number that broke is on the
	// record next to the number that fixed it.
	it("would not have fitted the ten columns the audit found", () => {
		expect(MIN_CONTENT[10]).toBeGreaterThan(availableTableWidth(1440));
		expect(MIN_CONTENT[10]).toBeGreaterThan(availableTableWidth(1280));
	});

	it("keeps a tier's own headroom above its measured floor", () => {
		// A threshold that sits exactly on the measured min-content leaves no
		// room for a longer supplier name, and the first long one overflows.
		for (const width of [680, 820]) {
			expect(minContentFor(visibleCashHistoryColumns(width))).toBeLessThan(width);
		}
	});
});

describe("the horizontal scroller is the safety net, and only that", () => {
	const scroller = ruleBody(HISTORY, ".cash-movement-history__scroller {");

	it("scrolls sideways", () => {
		expect(scroller).toMatch(/overflow-x:\s*auto/);
	});

	// The mutation guard the fix is worth nothing without: an `overflow-x`
	// box that can SHRINK has an automatic minimum size of zero and starts
	// scrolling VERTICALLY the moment anything squeezes it — measured at
	// 719 > 196 under a 300px grid row. That is the second scrollport commit
	// 59c5fe1ad removed from this register.
	it("cannot become a second vertical scrollport", () => {
		expect(scroller).toMatch(/flex:\s*1\s+0\s+auto/);
		expect(scroller).not.toMatch(/min-height:\s*0/);
	});

	it("does not open a vertical scrollport anywhere in the card", () => {
		const style = stripComments(HISTORY.slice(HISTORY.indexOf("<style")));
		expect(style).not.toMatch(/overflow-y:\s*(auto|scroll)/);
		expect(style).not.toMatch(/overflow:\s*(auto|scroll)/);
	});

	it("hands Vuetify's own wrapper's overflow to it, so there is exactly one", () => {
		// `.v-table__wrapper` ships `overflow: auto` on both axes. Left alone
		// it clips first (the scroller never engages) and it is shrinkable.
		expect(stripComments(HISTORY)).toMatch(
			/\.cash-movement-history__scroller\s+:deep\(\.v-table__wrapper\)\s*\{[^}]*overflow:\s*visible/,
		);
	});

	it("sizes no column with a function `table-layout: fixed` silently drops", () => {
		// A width written as `max(44px, 6%)` is discarded in a fixed-layout
		// table and every column ends up sharing the space equally — measured
		// once already in this workspace at 133.5px per "sized" column. This
		// table sets no widths at all; the guard is that it stays that way.
		expect(HISTORY).not.toMatch(/width:\s*(?:max|min|clamp)\(/);
	});
});

describe("a shed column is moved, never deleted", () => {
	it("accounts for every column at every width", () => {
		for (const width of [0, 320, 631, 679, 680, 724, 819, 820, 1200]) {
			const seen = [...visibleCashHistoryColumns(width), ...hiddenCashHistoryColumns(width)].sort();
			expect(seen).toEqual([...CASH_HISTORY_COLUMN_ORDER].sort());
		}
	});

	it("never sheds a core column, and never sheds the controls", () => {
		for (const width of [0, 320, 631, 724, 1200]) {
			expect(hiddenCashHistoryColumns(width)).not.toContain("actions");
			for (const key of CASH_HISTORY_CORE_COLUMNS) {
				expect(visibleCashHistoryColumns(width)).toContain(key);
			}
		}
	});

	it("adds direction before the paper trail, because Source and Target are not noise", () => {
		// 649f2ba66 made the create payload role-based and the form now states
		// which way money moves; these two are how an operator checks a
		// movement that looks wrong, so they outrank the reconciliation trail.
		const atDirection = visibleCashHistoryColumns(680);
		for (const key of CASH_HISTORY_DIRECTION_COLUMNS) expect(atDirection).toContain(key);
		for (const key of CASH_HISTORY_TRAIL_COLUMNS) expect(atDirection).not.toContain(key);
	});

	it("keeps the rendered order stable as tiers change", () => {
		// A column that moves sideways when the window is resized costs the
		// cashier the position they had learned.
		for (const width of [0, 724, 1200]) {
			const columns = visibleCashHistoryColumns(width);
			const positions = columns.map((key) => CASH_HISTORY_COLUMN_ORDER.indexOf(key));
			expect(positions).toEqual([...positions].sort((a, b) => a - b));
		}
	});
});
