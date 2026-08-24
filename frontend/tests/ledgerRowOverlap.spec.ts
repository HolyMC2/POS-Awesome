// @vitest-environment jsdom

/**
 * NO LEDGER CELL WRAPS — the Borradores row-overlap regression (golden flow §6).
 *
 * What Marco saw on the drafts surface: `ACC-SINV-2026-00192` sitting across
 * two lines and colliding with the ticket below it. The row is a 50px CSS grid
 * with fixed tracks, so a cell that outgrows its track has nowhere to go but
 * down — and its second line paints over the next row.
 *
 * Measured in Chromium on the cafetería demo, 1718x1023, drafts tab, table
 * 1202px wide:
 *
 *     TICKET track 176px · «ACC-SINV-2026-00192» 168.4px  -> 7.6px, 4%
 *     HORA   track  56px · «19:57»                39.8px  -> the «19:…» clip
 *
 * So it was not wrapping on that machine and was one font fallback away from
 * wrapping on any other. `.ledger-row__ticket` and `.ledger-row__amount`
 * carried no `white-space` at all — the customer and cashier cells did, which
 * is why only the id was reported.
 *
 * Two guarantees, both stated over EVERY cell rather than over the one that was
 * reported: a nowrap-ellipsis treatment, and tracks with real headroom over the
 * longest string the register can put in them.
 *
 * Source-scanned for the CSS because jsdom computes no layout: `?raw` rather
 * than `node:fs`, which is shimmed here. The grid template comes from the
 * component's own inline style, so that half IS rendered.
 */

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import InvoiceLedgerTable from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerTable.vue";
import tableSource from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerTable.vue?raw";
import {
	describeColumns,
	describeRows,
	type LedgerRowSource,
} from "../src/posapp/components/pos/flows/ledger/ledgerModel";
import { DIRECTORY, formatCurrency, row, TODAY } from "./ledgerFixtures";

const STYLE_BLOCK = tableSource.slice(tableSource.indexOf("<style"), tableSource.lastIndexOf("</style>"));

const ruleBody = (selector: string) => {
	const start = STYLE_BLOCK.indexOf(`${selector} {`);
	expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
	return STYLE_BLOCK.slice(start, STYLE_BLOCK.indexOf("}", start));
};

const tableProps = (rows: LedgerRowSource[]) => {
	const shaped = describeRows(rows, { today: TODAY, directory: DIRECTORY });
	return {
		rows: shaped,
		columns: describeColumns(shaped),
		selectedIndex: 0,
		formatCurrency,
		page: 1,
		pageCount: 1,
		total: shaped.length,
		pageSize: 25,
		loadedOnPage: shaped.length,
		footerKind: "page" as const,
	};
};

/** The real folios on the cafetería demo, not the artboard's six-character one. */
const DEMO_ROWS = [
	row({ name: "ACC-SINV-2026-00192", customer_name: "Marco (grande)", posting_time: "19:57:59" }),
	row({ name: "ACC-SINV-2026-00188", customer_name: "Sofía", posting_time: "19:24:25" }),
];

const tracksOf = (wrapper: ReturnType<typeof mount>) =>
	((wrapper.find('[data-testid="ledger-row"]').attributes("style") || "").match(
		/grid-template-columns:\s*([^;]+)/,
	) || [])[1]
		?.trim()
		.split(/\s+(?![^(]*\))/) ?? [];

describe("every cell on a ledger row stays on one line", () => {
	it("gives the whole row nowrap, ellipsis and a zero minimum", () => {
		// `min-width: 0` matters as much as the nowrap: a grid item's automatic
		// minimum size is its CONTENT, so without it a long id widens its own
		// track and shoves the row sideways instead of truncating. It applies to
		// EVERY cell; the truncation skips only the flex status cell.
		expect(ruleBody(".ledger-row > *")).toMatch(/min-width:\s*0/);
		const body = ruleBody(".ledger-row > *:not(.ledger-row__status)");
		expect(body).toMatch(/white-space:\s*nowrap/);
		expect(body).toMatch(/overflow:\s*hidden/);
		expect(body).toMatch(/text-overflow:\s*ellipsis/);
	});

	it("does not clip the status chip from its own start", () => {
		// `.ledger-row__status` is `justify-content: flex-end`, so clipping it
		// hides the FIRST word of a long label rather than the last. It cannot
		// wrap anyway — `.ledger-chip` is nowrap — so it takes the minimum and
		// not the truncation.
		expect(ruleBody(".ledger-row__status")).toMatch(/justify-content:\s*flex-end/);
		expect(ruleBody(".ledger-chip")).toMatch(/white-space:\s*nowrap/);
	});

	it("covers the two cells that had no treatment at all, not just the reported one", () => {
		// The ticket and the amount were the bare ones. A rule scoped to
		// `.ledger-row__ticket` would have fixed the report and left the amount
		// one long currency away from the same defect.
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps(DEMO_ROWS) });
		const classes = wrapper
			.findAll('[data-testid="ledger-row"]:first-child > *')
			.map((cell) => cell.classes().join(" "));
		expect(classes.some((value) => value.includes("ledger-row__ticket"))).toBe(true);
		expect(classes.some((value) => value.includes("ledger-row__amount"))).toBe(true);
		// The child selector is what reaches both without naming either.
		expect(STYLE_BLOCK).toContain(".ledger-row > *:not(.ledger-row__status)");
	});
});

describe("the tracks have room for what the register actually prints", () => {
	it("gives the ticket track real headroom over a 19-character folio", () => {
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps(DEMO_ROWS) });
		const ticket = Number.parseFloat(tracksOf(wrapper)[0] as string);
		// 168.4px is the measured width of `ACC-SINV-2026-00192`. The old 176px
		// cleared it by 4%; anything under ~10% is a track waiting for a font
		// fallback to overflow it.
		expect(ticket).toBeGreaterThanOrEqual(168.4 * 1.1);
	});

	it("gives the hour track room for a clock plus its header", () => {
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps(DEMO_ROWS) });
		const hour = Number.parseFloat(tracksOf(wrapper)[1] as string);
		expect(hour).toBeGreaterThanOrEqual(39.8 * 1.1);
	});

	it("keeps the customer column elastic and every other track fixed", () => {
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps(DEMO_ROWS) });
		const tracks = tracksOf(wrapper);
		expect(tracks).toHaveLength(6);
		// The elastic track has to start at ZERO. A `minmax(96px, 1fr)` would
		// overflow `.ledger-table`'s `overflow: hidden` on a narrow surface
		// rather than letting the customer name ellipsise.
		expect(tracks[2]).toBe("minmax(0, 1fr)");
		expect(tracks.slice(3).every((track) => /^\d+px$/.test(track))).toBe(true);
	});

	it("takes the ticket's extra width from the other tracks, not from the customer", () => {
		// The elastic column is the one that pays for every fixed track, so
		// widening TICKET and HORA without trimming anything would have made
		// CLIENTE 20px narrower on a 764px surface — trading a rendering fault
		// for a truncated customer name.
		const wrapper = mount(InvoiceLedgerTable, { props: tableProps(DEMO_ROWS) });
		const fixed = tracksOf(wrapper)
			.filter((track) => /^\d+px$/.test(track))
			.reduce((sum, track) => sum + Number.parseFloat(track), 0);
		// 176 + 56 + 96 + 112 + 132, the sum this surface shipped with.
		expect(fixed).toBe(572);
	});

	it("keeps the header labels on one line too", () => {
		const body = ruleBody(".ledger-table__col");
		expect(body).toMatch(/white-space:\s*nowrap/);
		expect(body).toMatch(/text-overflow:\s*ellipsis/);
	});

	it("drops one fixed track with the cashier column, and no more", () => {
		const withCashier = mount(InvoiceLedgerTable, { props: tableProps(DEMO_ROWS) });
		const withoutCashier = mount(InvoiceLedgerTable, {
			props: tableProps([row({ name: "ACC-SINV-2026-00192", owner: "someone@else.mx" })]),
		});
		expect(tracksOf(withCashier)).toHaveLength(6);
		expect(tracksOf(withoutCashier)).toHaveLength(5);
		// The ticket track is the same either way — the id does not get to be
		// narrower on a register with no cashier column.
		expect(tracksOf(withoutCashier)[0]).toBe(tracksOf(withCashier)[0]);
	});
});
