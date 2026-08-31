/**
 * THE HOSTED LEDGER ON A PHONE — two layout guarantees, source-pinned.
 *
 * 1. Nothing pans the hosted sheet sideways. `.destination-host` and the
 *    ledger card clip with `overflow: clip`, which is NOT a scroll container:
 *    a hidden-overflow box still scrolls programmatically, and focusing a chip
 *    or an input that sits past its edge pans it with no way back. The
 *    `hidden` line stays first as the fallback for engines without `clip`.
 *
 * 2. The hosted sheet does not paint over the navigation drawer. It is a
 *    contained Vuetify overlay carrying the dialog z-index (2400); the drawer
 *    is a layout item at 1004. `isolation: isolate` on the host keeps the
 *    overlay's z-index inside the host.
 *
 * And the ledger's own phone layout: below `useResponsive().isPhone` (768) the
 * head wraps to rows none wider than the surface, the figures pack two to a
 * row and the table rows re-lay as two lines. Every file carries the same
 * breakpoint, read from the composable so the number lives in one place.
 *
 * Source-scanned (`?raw`) because jsdom computes no layout.
 */

import { describe, expect, it } from "vitest";

import hostSource from "../src/posapp/components/pos/shell/destinations/DestinationHost.vue?raw";
import managementSource from "../src/posapp/components/pos/flows/InvoiceManagement.vue?raw";
import headerSource from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerHeader.vue?raw";
import figuresSource from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerFigures.vue?raw";
import tableSource from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerTable.vue?raw";
import surfaceSource from "../src/posapp/components/pos/flows/ledger/InvoiceLedgerSurface.vue?raw";
import responsiveSource from "../src/posapp/composables/core/useResponsive.ts?raw";

const styleOf = (source: string) =>
	source.slice(source.indexOf("<style"), source.lastIndexOf("</style>"));

const ruleBody = (style: string, selector: string) => {
	const start = style.indexOf(`${selector} {`);
	expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
	return style.slice(start, style.indexOf("}", start));
};

/** The `@media (max-width: …)` block's body, from its brace to the matching one. */
const phoneBlock = (style: string, breakpoint: number) => {
	const marker = `@media (max-width: ${breakpoint - 0.02}px) {`;
	const start = style.indexOf(marker);
	expect(start, `no phone media block at ${breakpoint}`).toBeGreaterThan(-1);
	let depth = 0;
	for (let i = start + marker.length - 1; i < style.length; i += 1) {
		if (style[i] === "{") depth += 1;
		if (style[i] === "}") depth -= 1;
		if (depth === 0) return style.slice(start, i);
	}
	throw new Error("unterminated media block");
};

const PHONE = Number(/isPhone = computed\(\(\) => windowWidth\.value < (\d+)\)/.exec(responsiveSource)?.[1]);

describe("the hosted sheet cannot be panned and does not cover the drawer", () => {
	it("clips the destination host with `clip` after the `hidden` fallback", () => {
		const body = ruleBody(styleOf(hostSource), ".destination-host");
		expect(body).toMatch(/overflow:\s*hidden;[\s\S]*overflow:\s*clip;/);
	});

	it("isolates the host so the contained overlay's z-index stays inside it", () => {
		expect(ruleBody(styleOf(hostSource), ".destination-host")).toMatch(/isolation:\s*isolate/);
	});

	it("clips the ledger card the same way, over Vuetify's scrollable-dialog card", () => {
		// `!important` is load-bearing: `.v-dialog > .v-overlay__content > .v-card`
		// sets `overflow-y: auto`, and `clip` beside `auto` computes to `hidden`.
		const body = ruleBody(styleOf(managementSource), ".invoice-ledger-card");
		expect(body).toMatch(/overflow:\s*hidden !important;[\s\S]*overflow:\s*clip !important;/);
	});
});

describe("the ledger has a phone layout, on one breakpoint", () => {
	it("reads the phone boundary from useResponsive", () => {
		expect(PHONE).toBe(768);
	});

	it("wraps the head into rows none wider than the surface", () => {
		const block = phoneBlock(styleOf(headerSource), PHONE);
		// The finder dissolves so its modes and its box/range can be ordered
		// among the head's own children.
		expect(ruleBody(block, ".ledger-finder")).toMatch(/display:\s*contents/);
		// The segment, the modes and the source switch are one-line scrollers
		// — an intended scroller, which a swipe can bring back.
		expect(ruleBody(block, ".ledger-seg,\n\t.ledger-source,\n\t.ledger-finder__modes")).toMatch(
			/overflow-x:\s*auto/,
		);
		// The box and the range take the full width, the range inputs share it.
		expect(ruleBody(block, ".ledger-finder__box,\n\t.ledger-finder__range")).toMatch(/flex:\s*1 1 100%/);
		expect(ruleBody(block, ".ledger-finder__date")).toMatch(/min-width:\s*0/);
		// A date input has an intrinsic floor `min-width: 0` does not remove,
		// so the pair wraps rather than overflowing a 320px phone.
		// The standalone rule, not the shared `.ledger-finder__box, .ledger-finder__range` one.
		expect(/\n\t\.ledger-finder__range \{[^}]*flex-wrap:\s*wrap/.test(block)).toBe(true);
		expect(ruleBody(block, ".ledger-finder__range-label")).toMatch(/flex:\s*1 1 150px/);
		// The range chip hides while Fecha is armed: the two fields say it.
		expect(ruleBody(block, ".ledger-daterange--on")).toMatch(/display:\s*none/);
	});

	it("packs the figures two to a row and never splits money", () => {
		const block = phoneBlock(styleOf(figuresSource), PHONE);
		expect(ruleBody(block, ".ledger-figures")).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
		expect(ruleBody(block, ".ledger-figure:nth-child(odd):last-child")).toMatch(/grid-column:\s*1 \/ -1/);
		expect(
			ruleBody(block, ".ledger-figure__label,\n\t.ledger-figure__number,\n\t.ledger-figure__meta"),
		).toMatch(/white-space:\s*nowrap/);
	});

	it("re-lays the rows as two lines over the inline desk columns", () => {
		const block = phoneBlock(styleOf(tableSource), PHONE);
		// `!important` because the desk tracks arrive as an inline style.
		expect(ruleBody(block, ".ledger-row")).toMatch(
			/grid-template-columns:\s*auto minmax\(0, 1fr\) auto !important/,
		);
		expect(ruleBody(block, ".ledger-row__ticket")).toMatch(/grid-column:\s*1 \/ 3/);
		expect(ruleBody(block, ".ledger-row__status")).toMatch(/grid-row:\s*2/);
		// No header row on a list; no cashier cell (the panel shows it).
		expect(
			ruleBody(block, ".ledger-table__head,\n\t.ledger-table__hint,\n\t.ledger-row__customer + .ledger-row__muted"),
		).toMatch(/display:\s*none/);
	});

	it("tightens the surface and lets the panel take half the body", () => {
		const block = phoneBlock(styleOf(surfaceSource), PHONE);
		expect(ruleBody(block, ".ledger-surface__body :deep(.ledger-panel)")).toMatch(/max-height:\s*50%/);
	});
});
