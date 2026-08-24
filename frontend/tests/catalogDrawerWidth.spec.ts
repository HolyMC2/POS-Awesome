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
	CATALOG_DRAWER_MAX_WIDTH,
	CATALOG_DRAWER_WIDTH_SHARE,
} from "../src/posapp/composables/pos/shell/useCatalogDrawer";

const ANCHORED_WIDTH = `width: min(${Math.round(CATALOG_DRAWER_WIDTH_SHARE * 100)}%, ${CATALOG_DRAWER_MAX_WIDTH}px)`;

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
		// the smaller half readable, and below a 500px cart the rows reflow into
		// cards (items-table-styles.css, PHONE CARD MODE).
		expect(CATALOG_DRAWER_WIDTH_SHARE).toBeGreaterThan(0.5);
		expect(CATALOG_DRAWER_WIDTH_SHARE).toBeLessThan(0.7);
		// The ceiling has to bind on a wide register or the share is unbounded:
		// 62% of a 1920px row is ~1190px of catalogue, which is wallpaper.
		expect(CATALOG_DRAWER_MAX_WIDTH).toBeLessThan(1920 * CATALOG_DRAWER_WIDTH_SHARE);
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
