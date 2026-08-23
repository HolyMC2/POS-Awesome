// @vitest-environment jsdom

/**
 * How wide the anchored cajón is, and why it is not one number.
 *
 * `Cajon.dc.html` draws a 400px drawer, and that is the right answer for the
 * register it draws: a phone-repair counter whose catalogue is an accessory
 * drawer two cards wide. `Cafeteria.dc.html` draws the case the 400px cannot
 * serve — a card MENU is the surface the cashier works from, and no cafetería
 * picks a drink out of a two-column column. So the anchored width follows what
 * the panel is SHOWING, and only that: `fitsAnchored` stays pure geometry, and
 * the overlay and inline presentations are untouched.
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
	CATALOG_DRAWER_CARD_MAX_WIDTH,
	CATALOG_DRAWER_CARD_WIDTH_SHARE,
	CATALOG_DRAWER_WIDTH,
} from "../src/posapp/composables/pos/shell/useCatalogDrawer";

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

	it("leaves the list on the artboard's width", () => {
		const wrapper = mountDrawer({ itemsView: "list" });
		expect(wrapper.classes()).not.toContain("catalog-drawer-layer--cards");
		expect(rule(".catalog-drawer-layer--anchored")).toContain(
			`width: ${CATALOG_DRAWER_WIDTH}px`,
		);
		wrapper.unmount();
	});

	it("defaults to the list width, so a caller that says nothing takes no room", () => {
		// A drawer that guessed "card" would take ~160px off the ticket on every
		// register that never told it otherwise.
		const wrapper = mountDrawer();
		expect(wrapper.classes()).not.toContain("catalog-drawer-layer--cards");
		wrapper.unmount();
	});

	it("sizes the card view as a share of the row, capped, exactly as the module says", () => {
		const cards = rule(".catalog-drawer-layer--anchored.catalog-drawer-layer--cards");
		const share = `${Math.round(CATALOG_DRAWER_CARD_WIDTH_SHARE * 100)}%`;
		expect(cards).toContain(`width: min(${share}, ${CATALOG_DRAWER_CARD_MAX_WIDTH}px)`);
	});

	it("keeps the cart the larger half at every width the drawer can anchor at", () => {
		// The share is the guarantee: whatever the row measures, the ticket keeps
		// 55% of it. A pixel width could not promise that at 1100 and at 1920.
		expect(CATALOG_DRAWER_CARD_WIDTH_SHARE).toBeLessThan(0.5);
		// And the cap has to be an increase over the list, or the branch is noise.
		expect(CATALOG_DRAWER_CARD_MAX_WIDTH).toBeGreaterThan(CATALOG_DRAWER_WIDTH);
	});

	it("touches neither overlay nor inline", () => {
		for (const presentation of ["overlay", "inline"] as const) {
			expect(
				rule(`.catalog-drawer-layer--${presentation}`),
				`${presentation} must not size itself off the items view`,
			).not.toContain("min(");
		}
		// The cards rule is anchored-only by construction: it is a compound
		// selector on the anchored class, so an overlay carrying the marker
		// still gets the sheet geometry.
		expect(STYLE_BLOCK).toContain(
			".catalog-drawer-layer--anchored.catalog-drawer-layer--cards",
		);
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
