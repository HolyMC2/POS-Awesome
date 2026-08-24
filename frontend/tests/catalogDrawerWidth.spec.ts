// @vitest-environment jsdom

/**
 * How wide the anchored cajón is, and why it is now ONE number.
 *
 * It used to be two. `Cajon.dc.html` draws a 400px drawer, the right answer for
 * the register it draws: a phone-repair counter whose catalogue is an accessory
 * drawer two cards wide. `Cafeteria.dc.html` draws the case the 400px cannot
 * serve — a card MENU is the surface the cashier works from — so CARD anchored
 * wider than LIST, and the anchored width followed what the panel was SHOWING.
 *
 * Golden flow §5 collapses the branch: both views take the floating card
 * panel's footprint, `min(62%, 720px)`. What broke the old reasoning ("a list
 * packs at any width, so widening it takes room off the ticket for nothing")
 * was measuring what the ticket did with the room. At 1718x1023 on the
 * cafetería demo, with 1572px of cart, the item-name column rendered 39.3px
 * wide and its own header truncated. The width was going to eight columns
 * fighting, not to the ticket. §4's collapse ladder is what pays for this.
 *
 * `fitsAnchored` stays pure geometry, and the overlay and inline presentations
 * are untouched.
 *
 * Half of this is a source scan on purpose. The width lives in CSS — a
 * percentage of the content row is a layout fact the stylesheet can state and
 * a measurement cannot, under jsdom least of all — so the guarantee is that
 * the stylesheet and `useCatalogDrawer.ts` still name the SAME two figures.
 * `?raw` rather than `node:fs`: this file mounts, so it is jsdom, where
 * `node:fs` is shimmed.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CatalogDrawer from "../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue";
import drawerSource from "../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue?raw";
import shellSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import {
	CATALOG_DRAWER_ANCHOR_MIN_WIDTH,
	CATALOG_DRAWER_MAX_WIDTH,
	CATALOG_DRAWER_MIN_TICKET_WIDTH,
	CATALOG_DRAWER_WIDTH_SHARE,
} from "../src/posapp/composables/pos/shell/useCatalogDrawer";

const ANCHORED_WIDTH = `width: min(${Math.round(CATALOG_DRAWER_WIDTH_SHARE * 100)}%, ${CATALOG_DRAWER_MAX_WIDTH}px)`;
const ANCHORED_FLOOR = `max-width: calc(100% - ${CATALOG_DRAWER_MIN_TICKET_WIDTH}px)`;

/**
 * What the drawer resolves to on a content row of this width — the same three
 * numbers the browser computes from `width` and `max-width` together.
 */
const drawerWidthOn = (row: number) =>
	Math.min(row * CATALOG_DRAWER_WIDTH_SHARE, CATALOG_DRAWER_MAX_WIDTH, row - CATALOG_DRAWER_MIN_TICKET_WIDTH);

/**
 * Content rows measured on the cafetería demo, viewport -> row. The row is not
 * the viewport: the rail and the shell padding come off first.
 */
const ROW = { at1718: 1622, at1280: 1184, at1100: 1004 };

/**
 * What the ResizeObserver on `.posa-items-table-container` actually reports for
 * a ticket column of N row-pixels.
 *
 * The allowance is spent on the CONTENT ROW; the breakpoint is read off the
 * container's CONTENT box, and between them sit the Vuetify column gutters, the
 * invoice card and the container's own 1px borders. This is the step the
 * obvious `544` arithmetic skipped — and it is not one number: measured on the
 * demo it is 46px at 1280x900 and 50px at 1718x1023, because the shell's
 * padding is itself viewport-scaled. So the WORST case is what the guarantees
 * below are written against; asserting an exact cart width at every row would
 * be four pixels of false precision.
 */
const CART_CHROME_MAX = 50;
const cartContentFor = (row: number) => row - drawerWidthOn(row) - CART_CHROME_MAX;

/** Below this the cart stops being a table (items-table-styles.css, PHONE CARD MODE). */
const CART_TABLE_MIN = 500;

const STYLE_BLOCK = drawerSource.slice(
	drawerSource.indexOf("<style"),
	drawerSource.lastIndexOf("</style>"),
);

const rule = (selector: string) => {
	const start = STYLE_BLOCK.indexOf(`${selector} {`);
	expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
	return STYLE_BLOCK.slice(start, STYLE_BLOCK.indexOf("}", start));
};

const mountDrawer = (props: Record<string, unknown> = {}) =>
	mount(CatalogDrawer, {
		props: { phase: "open", presentation: "anchored", ...props },
	});

describe("the anchored width follows the items view", () => {
	it("marks the layer when the panel is drawing cards", () => {
		const wrapper = mountDrawer({ itemsView: "card" });
		expect(wrapper.classes()).toContain("catalog-drawer-layer--cards");
		wrapper.unmount();
	});

	it("gives the list the same footprint as the cards", () => {
		const wrapper = mountDrawer({ itemsView: "list" });
		expect(wrapper.classes()).not.toContain("catalog-drawer-layer--cards");
		// The un-marked layer IS the list presentation, so this rule is what a
		// LIST drawer resolves to. Both views naming the same figures is the
		// whole point of §5 — a menu is a menu in either drawing.
		expect(rule(".catalog-drawer-layer--anchored")).toContain(ANCHORED_WIDTH);
		wrapper.unmount();
	});

	it("still marks the layer, so the branch is retired rather than lost", () => {
		const wrapper = mountDrawer();
		expect(wrapper.classes()).not.toContain("catalog-drawer-layer--cards");
		wrapper.unmount();
		expect(STYLE_BLOCK).toContain(".catalog-drawer-layer--anchored.catalog-drawer-layer--cards");
	});

	it("sizes both anchored views as a share of the row, capped, exactly as the module says", () => {
		expect(rule(".catalog-drawer-layer--anchored")).toContain(ANCHORED_WIDTH);
		expect(rule(".catalog-drawer-layer--anchored.catalog-drawer-layer--cards")).toContain(
			ANCHORED_WIDTH,
		);
	});

	it("keeps the anchored footprint a share of the row rather than a pixel promise", () => {
		// A share, so the split tracks the row at 1100 and at 1920 alike. It is
		// deliberately past half now: the ticket's own §4 ladder is what makes
		// the smaller half readable, and the floor below is what stops the share
		// taking the cart out of table mode entirely.
		expect(CATALOG_DRAWER_WIDTH_SHARE).toBeGreaterThan(0.5);
		expect(CATALOG_DRAWER_WIDTH_SHARE).toBeLessThan(0.7);
		// The ceiling has to bind on a wide register or the share is unbounded:
		// 62% of a 1920px row is ~1190px of catalogue, which is wallpaper.
		expect(CATALOG_DRAWER_MAX_WIDTH).toBeLessThan(1920 * CATALOG_DRAWER_WIDTH_SHARE);
	});
});

describe("the ticket keeps a table, whatever the drawer wants", () => {
	it("states the floor once, on the rule both views read", () => {
		expect(rule(".catalog-drawer-layer--anchored")).toContain(ANCHORED_FLOOR);
	});

	it("does not let the card view restate — or drop — the floor", () => {
		// This compound out-specifies the single-class rule, so a `max-width`
		// here would be a second copy that drifts, and a `max-width: none` here
		// would delete the floor for card view alone while every test above
		// still passed.
		expect(rule(".catalog-drawer-layer--anchored.catalog-drawer-layer--cards")).not.toContain(
			"max-width",
		);
	});

	it("lets the CEILING bind on a wide register — nothing changes at 1718", () => {
		// The floor would allow 982px here; the 720px ceiling is the smaller of
		// the two, so this round's widening is exactly what it was, and the cart
		// is the 854px measured in the browser.
		expect(drawerWidthOn(ROW.at1718)).toBe(CATALOG_DRAWER_MAX_WIDTH);
		expect(ROW.at1718 - CATALOG_DRAWER_MIN_TICKET_WIDTH).toBeGreaterThan(CATALOG_DRAWER_MAX_WIDTH);
	});

	it("lets the FLOOR bind at 1280, which is the whole point of it", () => {
		// Without the floor this row gave the drawer min(734, 720) = 720 and the
		// cart 418px of content — under the threshold, so the ticket reflowed
		// into phone card rows on a desktop. Measured with the floor in the
		// browser: drawer 544px, cart 594px, breakpoint-sm, 10 header cells.
		expect(Math.min(ROW.at1280 * CATALOG_DRAWER_WIDTH_SHARE, CATALOG_DRAWER_MAX_WIDTH)).toBe(720);
		expect(drawerWidthOn(ROW.at1280)).toBe(544);
	});

	it("keeps the cart a table at every width the drawer can anchor at", () => {
		const tooNarrow: string[] = [];
		for (const row of [ROW.at1100, ROW.at1280, ROW.at1718, 1920, CATALOG_DRAWER_ANCHOR_MIN_WIDTH]) {
			if (cartContentFor(row) < CART_TABLE_MIN) tooNarrow.push(`row ${row}: ${cartContentFor(row)}`);
		}
		expect(tooNarrow).toEqual([]);
	});

	it("leaves the item name clear of its own floor, not a pixel over it", () => {
		// The measured trap: an allowance of 544 puts the cart at 498 (card
		// rows) and 620 puts the name at 148 against a 150px floor. Both clear
		// their thresholds on paper and neither clears it in a browser.
		const CART_REQUIRED_PX = 424; // qty + rate + amount + actions + expand
		const CART_NAME_MIN = 150;
		const nameAt = (row: number) => cartContentFor(row) - 2 - CART_REQUIRED_PX;
		expect(nameAt(ROW.at1280)).toBeGreaterThanOrEqual(CART_NAME_MIN);
		expect(nameAt(ROW.at1100)).toBeGreaterThanOrEqual(CART_NAME_MIN);
	});

	it("does not charge the overlay for the anchored floor", () => {
		// Un-anchoring is how a register gives the catalogue the room back, so
		// the overlay must not inherit the ticket's claim on the row.
		expect(rule(".catalog-drawer-layer--overlay")).not.toContain("max-width");
		expect(rule(".catalog-drawer-layer--overlay .catalog-drawer")).not.toContain("max-width");
	});

	it("leaves inline and the overlay exactly as they were", () => {
		expect(
			rule(".catalog-drawer-layer--inline"),
			"inline must not size itself off the items view",
		).not.toContain("min(");
		// The overlay is untouched by §5 — it was already the footprint the
		// anchored presentation has now adopted, and its card rule is where the
		// 62%/720px pair came from in the first place.
		expect(rule(".catalog-drawer-layer--overlay .catalog-drawer")).toContain(
			"width: min(52%, 560px)",
		);
		expect(
			rule(".catalog-drawer-layer--overlay.catalog-drawer-layer--cards .catalog-drawer"),
		).toContain(ANCHORED_WIDTH);
	});

	it("keeps the floating panel ABOVE its scrim", () => {
		// At z 1 under the z 11 scrim, elementFromPoint anywhere in the panel
		// answered "scrim": every tap in the floating catalogue was a close.
		const panelZ = Number(
			rule(".catalog-drawer-layer--overlay .catalog-drawer").match(/z-index:\s*(\d+)/)?.[1],
		);
		const scrimZ = Number(rule(".catalog-drawer__scrim").match(/z-index:\s*(\d+)/)?.[1]);
		expect(panelZ).toBeGreaterThan(scrimZ);
	});
});

describe("the drawer is told, never told to look", () => {
	it("takes the view as a prop and reads no store for it", () => {
		expect(drawerSource).toMatch(/itemsView\?: CatalogItemsView/);
		expect(drawerSource).not.toMatch(/useItemsStore|verticalStore|loadItemsViewPreference/);
	});

	it("publishes the selector's own choice upward instead of leaving the shell to guess", () => {
		expect(selectorSource).toContain('const emit = defineEmits(["add-item", "update:itemsView"]);');
		expect(selectorSource).toMatch(
			/watch\(items_view, \(view\) => emit\("update:itemsView", view\), \{ immediate: true \}\)/,
		);
	});

	it("wires the selector's view to the drawer through the shell", () => {
		expect(shellSource).toContain('@update:items-view="catalogItemsView = $event"');
		expect(shellSource).toContain(':items-view="catalogItemsView"');
		// Seeded narrow: a first frame at 560px that snaps back to 400 is a
		// worse answer than one that never moved.
		expect(shellSource).toContain('const catalogItemsView = ref("list");');
	});
});
