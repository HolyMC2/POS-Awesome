// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CARD_MAX_COLUMNS,
	DENSE_CARD_GUTTER,
	DENSE_CART_STACK_BELOW,
	DENSE_CARD_MIN_WIDTH,
	DENSE_CARD_ROW_HEIGHT,
	DENSE_DESK_MAX_HEIGHT,
	DENSE_DESK_MIN_WIDTH,
	getCardColumnWidth,
	getCardColumnsForContainer,
	getCardGap,
	getCardPadding,
	getCardRowHeight,
	isCompactCard,
	isDenseDeskViewport,
} from "../src/posapp/utils/itemSelectorLayout";
// Raw sources: the guard is about what is WRITTEN (which media query each
// tier carries), so the source is the honest thing to read — same reasoning
// as itemSelectorLayoutOwnership.spec.ts.
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import invoiceSource from "../src/posapp/components/pos/Invoice.vue?raw";
import summarySource from "../src/posapp/components/pos/invoice/InvoiceSummary.vue?raw";
import actionsSource from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue?raw";
import stripSource from "../src/posapp/components/pos/customer/CustomerStrip.vue?raw";
import drawerSource from "../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue?raw";
import headerSource from "../src/posapp/components/pos/items/ItemHeader.vue?raw";
import cardSource from "../src/posapp/components/pos/items/ItemCard.vue?raw";
import cardsSource from "../src/posapp/components/pos/items/ItemsSelectorCards.vue?raw";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import responsiveSource from "../src/posapp/composables/pos/items/useItemsTableResponsive.ts?raw";

// vitest's CSS pipeline empties a `.css?raw` import — the token sheet is read
// off disk instead (node environment on purpose: nothing here mounts).
const tokensSource = readFileSync(
	new URL("../src/posapp/styles/register-tokens.css", import.meta.url),
	"utf8",
);

/**
 * The dense desk tier (Marco, 08-30: «I want the desk view to look good on
 * horizontal tablets, not only to change into the mobile view») is ONE
 * viewport served by two stacks: CSS media queries trim the chrome (band,
 * cart column, drawer, scan bar) and the JS card-grid geometry deals mini
 * cards. A number drifting in either stack would give a tablet a dense band
 * over poster cards, or mini cards under a desk band — this spec is the
 * lockstep.
 */
const TIER_QUERY = `@media (min-width: ${DENSE_DESK_MIN_WIDTH}px) and (max-height: ${DENSE_DESK_MAX_HEIGHT}px)`;

describe("dense desk tier — one viewport, two stacks", () => {
	it("the viewport predicate is the media query: ≥1100 wide, ≤820 tall", () => {
		expect(isDenseDeskViewport(1100, 820)).toBe(true);
		expect(isDenseDeskViewport(1195, 741)).toBe(true); // Marco's window
		expect(isDenseDeskViewport(1099, 741)).toBe(false); // the movil shell's band
		expect(isDenseDeskViewport(1195, 821)).toBe(false); // desk height, desk cards
		expect(isDenseDeskViewport(1440, 900)).toBe(false);
		expect(isDenseDeskViewport(1195, 0)).toBe(false); // unmeasured
	});

	it.each([
		["register-tokens.css", tokensSource],
		["Pos.vue", posSource],
		["Invoice.vue", invoiceSource],
		["InvoiceSummary.vue", summarySource],
		["InvoiceActionButtons.vue", actionsSource],
		["CustomerStrip.vue", stripSource],
		["CatalogDrawer.vue", drawerSource],
		["ItemHeader.vue", headerSource],
	])("%s carries the tier under the SAME query the JS switches on", (_name, source) => {
		expect(source).toContain(TIER_QUERY);
		// And no sibling pair with a drifted number: every (min-width … max-height)
		// query in these files IS the tier.
		const pairs = [...source.matchAll(/@media \(min-width: (\d+)px\) and \(max-height: (\d+)px\)/g)];
		expect(pairs.length).toBeGreaterThan(0);
		for (const [, width, height] of pairs) {
			expect(Number(width)).toBe(DENSE_DESK_MIN_WIDTH);
			expect(Number(height)).toBe(DENSE_DESK_MAX_HEIGHT);
		}
	});
});

describe("dense desk tier — the card grid geometry", () => {
	// The anchored drawer at Marco's 1195×741: a 459px layer, a 441px results row.
	const DRAWER = 441;
	const GAP = 12;
	const PAD = 12;

	it("packs three mini columns where the roomy rule dealt two posters", () => {
		expect(getCardColumnsForContainer(DRAWER, GAP, PAD)).toBe(2);
		const dense = getCardColumnsForContainer(DRAWER, GAP, PAD, { dense: true });
		expect(dense).toBe(3);
		const width = getCardColumnWidth(DRAWER, dense, GAP, PAD);
		expect(width).toBeGreaterThanOrEqual(DENSE_CARD_MIN_WIDTH);
		// A dense column is always compact by width — the mini anatomy rides on --compact.
		expect(isCompactCard(width)).toBe(true);
	});

	it("still seats three in Marco's 1143px window (a 407px drawer, 375px of row)", () => {
		// Round 2: at a 124px floor this fell back to two 181px cards.
		expect(getCardColumnsForContainer(407, GAP, PAD)).toBe(2);
		expect(getCardColumnsForContainer(407, GAP, PAD, { dense: true })).toBe(3);
		expect(getCardColumnWidth(407, 3, GAP, PAD)).toBeGreaterThanOrEqual(DENSE_CARD_MIN_WIDTH);
		// What the scroller actually measures inside that drawer (~385px): the
		// dense gutters are what keep three columns there.
		const gutter = getCardGap(1143, { dense: true });
		expect(gutter).toBe(DENSE_CARD_GUTTER);
		expect(getCardPadding(1143, { dense: true })).toBe(DENSE_CARD_GUTTER);
		expect(getCardColumnsForContainer(385, GAP, PAD, { dense: true })).toBe(2);
		expect(getCardColumnsForContainer(385, gutter, gutter, { dense: true })).toBe(3);
		expect(getCardColumnWidth(385, 3, gutter, gutter)).toBeGreaterThanOrEqual(DENSE_CARD_MIN_WIDTH);
	});

	it("deals the 128px slot regardless of the column's roomy/compact verdict", () => {
		expect(getCardRowHeight(208, 1195)).toBe(280);
		expect(getCardRowHeight(208, 1195, { dense: true })).toBe(DENSE_CARD_ROW_HEIGHT);
		expect(getCardRowHeight(128, 1195, { dense: true })).toBe(DENSE_CARD_ROW_HEIGHT);
		expect(getCardRowHeight(128, 1195)).toBe(184);
	});

	it("never exceeds the column cap on a wide overlay drawer", () => {
		expect(getCardColumnsForContainer(1400, 16, 16, { dense: true })).toBe(CARD_MAX_COLUMNS);
	});

	it("half-and-half: the cart stacks its rows across the whole tablet band, not just below 500", () => {
		// Round 3. With the drawer at 50% the cart measures 524–592 across
		// 1143–1280 windows; the stack boundary must clear the top of that band.
		expect(DENSE_CART_STACK_BELOW).toBeGreaterThan(500);
		expect(DENSE_CART_STACK_BELOW).toBeLessThan(620); // a 1366 laptop keeps the table
		expect(responsiveSource).toContain("isDenseDeskViewport(window.innerWidth, window.innerHeight)");
		expect(responsiveSource).toContain("? DENSE_CART_STACK_BELOW");
		expect(drawerSource).toMatch(
			/\.catalog-drawer-layer--anchored,\s*\.catalog-drawer-layer--anchored\.catalog-drawer-layer--cards \{\s*width: 50%;\s*max-width: 50%;/,
		);
	});

	it("the dense flag travels selector → cards → card, and the card draws it", () => {
		expect(selectorSource).toContain(':card-dense="denseDesk"');
		expect(cardsSource).toContain(':dense="cardDense"');
		expect(cardSource).toContain("'card-item-card--dense': dense");
		expect(cardSource).toMatch(/\.card-item-card--dense \.card-item-image-container \{\s*height: 64px;/);
	});
});
