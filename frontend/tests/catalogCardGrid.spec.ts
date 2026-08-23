// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import ItemCard from "../src/posapp/components/pos/items/ItemCard.vue";
import cardSource from "../src/posapp/components/pos/items/ItemCard.vue?raw";
import gridSource from "../src/posapp/components/pos/items/ItemsSelectorCards.vue?raw";
import {
	CARD_MAX_COLUMNS,
	CARD_MIN_WIDTH,
	CARD_PREFERRED_WIDTH,
	CARD_SCROLLBAR_GUTTER,
	cardGridFits,
	getCardColumnWidth,
	getCardColumnsForContainer,
	getCardRowHeight,
	isCompactCard,
} from "../src/posapp/utils/itemSelectorLayout";

/**
 * THE CATALOGUE'S CARD GRID, at the widths that now exist.
 *
 * The defect: in CARD view the catalogue drew ONE oversized card. The cause was
 * not in the card — it was `getCardColumnsForContainer`, whose rule was
 * `floor(width / 216)`. That track was sized for the catalogue when it was a
 * permanent column of ~40% of a 1440 screen. The catalogue is now an anchored
 * drawer of 400px (`Cajon.dc.html`), whose `.items-card-container` measures
 * about 374px once the drawer border, the selector card's `--dynamic-sm`
 * padding and the results card's `--dynamic-xs` padding are paid: 374/216 is
 * 1.7, so the drawer got one column — and `cardColumnWidth` then divided the
 * whole container by that one column and produced a 334px card in a 300px-tall
 * slot.
 *
 * The artboards settle what it should be. `Cajon.dc.html` draws the 400px
 * drawer with `repeat(2, minmax(0,1fr))`; `MovilExplorar.dc.html` draws the
 * same two columns on a 390px phone. So: two cards per row, ~160-180px each,
 * carrying the same four things a roomy card carries.
 *
 * `Rejilla.dc.html` is the DISCARDED direction for exactly this trade-off — a
 * 440px text-only list beside the ticket — and the reason it lost is the reason
 * the answer here is "smaller cards" and never "make it a list": at a narrow
 * width a column of near-identical names is slower to hit than a wall of
 * pictures.
 */

/**
 * The real chain, measured rather than guessed:
 *   drawer 400 − 2 border − 2×`--dynamic-sm` (8) − 2×`--dynamic-xs` (4) ≈ 374
 * The v-row/v-col gutters between them are explicitly zeroed in
 * `ItemsSelector.vue` (`.selector-results-card .items`).
 */
const WIDTHS = [
	// [name, measured container, gap, padding, minimum columns expected]
	["the anchored drawer on a desktop", 374, 16, 16, 2],
	["the same drawer as an overlay below 1100px", 374, 12, 12, 2],
	["the phone's full-width catalogue tab (390)", 366, 10, 10, 2],
	["a narrow phone (360)", 336, 10, 10, 2],
	["the legacy 40% desk column", 560, 16, 16, 2],
	["a wide purchase panel", 900, 16, 16, 4],
	["a full-width register panel", 1400, 16, 16, 6],
] as const;

describe("the drawer's width yields a grid, not a poster", () => {
	it.each(WIDTHS)("gives %s more than one card per row", (_label, width, gap, padding, minimum) => {
		const columns = getCardColumnsForContainer(width, gap, padding);
		expect(columns).toBeGreaterThan(1);
		expect(columns).toBeGreaterThanOrEqual(minimum);
	});

	it("is what the old 216px track could not do", () => {
		// The regression this file exists for, stated as arithmetic: the track
		// the catalogue shipped with resolves to one column at the drawer.
		expect(Math.floor(374 / 216)).toBe(1);
		expect(getCardColumnsForContainer(374, 16, 16)).toBe(2);
	});

	it("matches the artboards' own two columns at their own widths", () => {
		// Cajon.dc.html: 400px drawer, two columns. MovilExplorar.dc.html:
		// 390px phone, two columns.
		expect(getCardColumnsForContainer(374, 16, 16)).toBe(2);
		expect(getCardColumnsForContainer(366, 10, 10)).toBe(2);
	});

	it("drops to one column when two cards genuinely will not fit", () => {
		// A 320px phone. One honest card beats two unreadable ones — the floor
		// is a floor, not a target.
		expect(getCardColumnsForContainer(296, 10, 10)).toBe(1);
	});

	it("does not shred a wide panel to fix a narrow one", () => {
		// Packing every width at CARD_MIN_WIDTH would have turned the 900px
		// purchase panel into five 159px cards. The squeeze buys the SECOND
		// column and nothing more; above that the preferred width rules.
		expect(getCardColumnsForContainer(900, 16, 16)).toBe(4);
		expect(getCardColumnWidth(900, 4, 16, 16)).toBeGreaterThanOrEqual(CARD_PREFERRED_WIDTH);
		// And the legacy column is where it always was.
		expect(getCardColumnsForContainer(560, 16, 16)).toBe(2);
	});

	it("caps out rather than turning a wide register into wallpaper", () => {
		expect(getCardColumnsForContainer(4000, 16, 16)).toBe(CARD_MAX_COLUMNS);
	});

	it("still says 'not measured' rather than guessing 1", () => {
		// The composable falls back to the window buckets on 0; returning 1
		// here would read as a decision and pin the pre-mount frame.
		expect(getCardColumnsForContainer(0, 16, 16)).toBe(0);
	});
});

describe("a card fits inside the panel it was measured from", () => {
	it.each(WIDTHS)("does not overflow %s", (_label, width, gap, padding) => {
		const columns = getCardColumnsForContainer(width, gap, padding);
		const columnWidth = getCardColumnWidth(width, columns, gap, padding);
		expect(cardGridFits(width, columns, columnWidth, gap, padding)).toBe(true);
	});

	it("pays for the scrollbar gutter the scrollport reserves", () => {
		// `.virtual-scroller` sets `scrollbar-gutter: stable` unconditionally.
		// The old arithmetic handed the grid the full container width, so the
		// right-hand card sat 8px outside its own scrollport.
		expect(CARD_SCROLLBAR_GUTTER).toBeGreaterThan(0);
		const naive = Math.floor((374 - 16 * 1 - 32) / 2);
		expect(cardGridFits(374, 2, naive, 16, 16)).toBe(false);
		expect(cardGridFits(374, 2, getCardColumnWidth(374, 2, 16, 16), 16, 16)).toBe(true);
	});

	it.each(WIDTHS)("keeps %s at or above the readable floor", (_label, width, gap, padding) => {
		const columns = getCardColumnsForContainer(width, gap, padding);
		expect(getCardColumnWidth(width, columns, gap, padding)).toBeGreaterThanOrEqual(
			CARD_MIN_WIDTH,
		);
	});

	it("no longer floors the width above what the container can hold", () => {
		// The old `Math.max(180, width)` is how a container narrower than one
		// card still produced a card wider than the container.
		expect(getCardColumnWidth(200, 1, 16, 16)).toBeLessThan(180);
	});
});

describe("the slot is as tall as the card in it, not as tall as the window", () => {
	it("reserves the compact height for a drawer-width card on a desktop", () => {
		const columnWidth = getCardColumnWidth(374, 2, 16, 16);
		expect(isCompactCard(columnWidth)).toBe(true);
		// The window says 1440 — "desktop" — and used to buy a 300px row for a
		// 159px card.
		expect(getCardRowHeight(columnWidth, 1440)).toBe(184);
		expect(getCardRowHeight(columnWidth, 1440)).toBeLessThan(300);
	});

	it("leaves the roomy card's height exactly where it was", () => {
		expect(getCardRowHeight(getCardColumnWidth(560, 2, 16, 16), 1440)).toBe(300);
		expect(getCardRowHeight(240, 1100)).toBe(280);
		expect(getCardRowHeight(240, 700)).toBe(260);
	});
});

/* ------------------------------------------------------------------------ */

const styleBlock = (source: string) =>
	[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
		.map((match) => match[1])
		.join("\n")
		.replace(/\/\*[\s\S]*?\*\//g, "");

const cardCss = styleBlock(cardSource);
const gridCss = styleBlock(gridSource);

/** Value of `property` inside the rule whose selector is exactly `selector`. */
const declaration = (css: string, selector: string, property: string): string => {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
	const rule = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
	if (!rule) throw new Error(`no rule for ${selector}`);
	const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule[1]);
	if (!found) throw new Error(`no ${property} on ${selector}`);
	return found[1].trim();
};

const px = (value: string) => Number.parseFloat(value);
/** rem → px at the register's 16px root, which `theme.css` does not change. */
const rem = (value: string) => Number.parseFloat(value) * 16;

describe("what a card carries at the drawer's width", () => {
	const baseProps = {
		item: {
			item_code: "IPN002611",
			item_name: "Anillo Case Honor X8A Rojo",
			rate: 200,
			actual_qty: 8,
			stock_uom: "Nos",
			is_stock_item: 1,
		},
		posProfile: { currency: "MXN", posa_allow_multi_currency: false },
		context: "pos",
		selectedCurrency: "",
		hideQtyDecimals: true,
		showRateInfo: false,
		getItemRateInfo: () => null,
		isItemHighlighted: false,
		currencySymbol: () => "$",
		formatCurrency: (value: number) => String(value),
		formatNumber: (value: number) => String(value),
		ratePrecision: () => 2,
		isNegative: (value: number) => value < 0,
		compact: true,
		lowStockThreshold: 10,
	};

	const mountCard = (overrides: Record<string, unknown> = {}) =>
		mount(ItemCard, {
			props: { ...baseProps, ...overrides },
			global: {
				// `createVuetify()` registers no components, so `v-icon` stays an
				// unresolved element rather than a stub — which is all this file
				// needs, and one fewer stub to keep honest.
				plugins: [createVuetify()],
				stubs: { ItemRateInfoMenu: { template: "<span />" } },
			},
		});

	it("drops nothing — picture, name, code, price and stock, all four", () => {
		// This is the answer to "what must a card carry at 400px": the same
		// things, smaller. Both artboards draw exactly these on a ~180px card.
		const wrapper = mountCard();
		expect(wrapper.attributes("data-card-anatomy")).toBe("compact");
		expect(wrapper.find(".card-item-image-container").exists()).toBe(true);
		expect(wrapper.get(".card-item-name").text()).toBe("Anillo Case Honor X8A Rojo");
		expect(wrapper.get(".card-item-code").text()).toBe("IPN002611");
		expect(wrapper.get(".primary-price").text()).toContain("200");
		expect(wrapper.get('[data-testid="card-item-stock"]').text()).toContain("8");
	});

	it("spends the one thing that is decoration — the package glyph", () => {
		expect(mountCard().find('[data-testid="card-item-stock"] .stock-icon').exists()).toBe(false);
		expect(
			mountCard({ compact: false }).find('[data-testid="card-item-stock"] .stock-icon').exists(),
		).toBe(true);
	});

	it("renders NOTHING, not 0, when the register does not know the stock", () => {
		// The rule `cartLineStock.ts` exists for. A rendered 0 says the shop has
		// none of this, and a cashier repeats it to a customer.
		for (const missing of [{}, { actual_qty: null }, { actual_qty: "" }, { actual_qty: "abc" }]) {
			const wrapper = mountCard({
				item: { ...baseProps.item, actual_qty: undefined, ...missing },
			});
			expect(wrapper.find('[data-testid="card-item-stock"]').exists()).toBe(false);
		}
	});

	it("says nothing about an item that has no shelf", () => {
		const wrapper = mountCard({ item: { ...baseProps.item, is_stock_item: 0, actual_qty: 0 } });
		expect(wrapper.find('[data-testid="card-item-stock"]').exists()).toBe(false);
	});

	it("DOES draw a real zero, tinted, because that is a genuine answer", () => {
		const wrapper = mountCard({ item: { ...baseProps.item, actual_qty: 0 } });
		const stock = wrapper.get('[data-testid="card-item-stock"]');
		expect(stock.text()).toContain("0");
		expect(stock.classes()).toContain("card-item-stock--low");
	});

	it("tints low stock from the register's own threshold, and only then", () => {
		expect(
			mountCard({ item: { ...baseProps.item, actual_qty: 9 } })
				.get('[data-testid="card-item-stock"]')
				.classes(),
		).toContain("card-item-stock--low");
		expect(
			mountCard({ item: { ...baseProps.item, actual_qty: 40 } })
				.get('[data-testid="card-item-stock"]')
				.classes(),
		).not.toContain("card-item-stock--low");
		// A threshold of 0 means never warn, not always warn.
		expect(
			mountCard({ lowStockThreshold: 0, item: { ...baseProps.item, actual_qty: 1 } })
				.get('[data-testid="card-item-stock"]')
				.classes(),
		).not.toContain("card-item-stock--low");
	});

	it("still shows an over-sold item rather than clamping it to none", () => {
		const wrapper = mountCard({ item: { ...baseProps.item, actual_qty: -3 } });
		expect(wrapper.get('[data-testid="card-item-stock"]').text()).toContain("-3");
	});

	it("spends no saturated fill on the low tint", () => {
		// §17.7 invariant 2 — the one accent belongs to the primary action.
		const lowRule = /\.card-item-stock--low[^{]*\{([^}]*)\}/.exec(cardCss)?.[1] ?? "";
		expect(lowRule).toMatch(/color:/);
		expect(lowRule).not.toMatch(/background/);
	});
});

describe("the compact card fits the slot the grid reserves for it", () => {
	it("budgets its declared heights under the reserved row height", () => {
		// jsdom has no layout engine, so this is a BUDGET against the declared
		// values rather than a measurement — the same reasoning
		// `emptyCartState.spec.ts` records. Line-height 1.4 where none is
		// declared is the browser's normal for this stack.
		const plate = px(declaration(cardCss, ".card-item-card--compact .card-item-image-container", "height"));
		const pad = px(declaration(cardCss, ".card-item-card--compact .card-item-content", "padding"));
		const contentGap = px(declaration(cardCss, ".card-item-card--compact .card-item-content", "gap"));
		const headerGap = px(declaration(cardCss, ".card-item-card--compact .card-item-header", "gap"));
		const nameSize = rem(declaration(cardCss, ".card-item-card--compact .card-item-name", "font-size"));
		const nameLine = Number.parseFloat(
			declaration(cardCss, ".card-item-card--compact .card-item-name", "line-height"),
		);
		const codeSize = rem(declaration(cardCss, ".card-item-card--compact .card-item-code", "font-size"));
		const priceSize = rem(declaration(cardCss, ".card-item-card--compact .primary-price", "font-size"));

		const budget =
			plate +
			pad * 2 +
			nameSize * nameLine * 2 + // the name is clamped to two lines
			headerGap +
			codeSize * 1.4 +
			contentGap +
			priceSize * 1.4;

		const columnWidth = getCardColumnWidth(374, 2, 16, 16);
		expect(budget).toBeLessThanOrEqual(getCardRowHeight(columnWidth, 1440));
	});

	it("clamps the name and truncates the price rather than growing the card", () => {
		expect(cardCss).toMatch(/\.card-item-name\s*\{[^}]*line-clamp:\s*2/);
		const price = /\.card-item-card--compact \.price-amount\s*\{([^}]*)\}/.exec(cardCss)?.[1] ?? "";
		expect(price).toMatch(/text-overflow:\s*ellipsis/);
		expect(price).toMatch(/white-space:\s*nowrap/);
	});

	it("never truncates the stock figure, because a clipped quantity is a wrong one", () => {
		expect(declaration(cardCss, ".card-item-card--compact .card-item-stock", "flex")).toBe(
			"0 0 auto",
		);
	});

	it("keeps the small-window tuning ABOVE the compact block", () => {
		// A media query adds no specificity. Below the compact rules, the ≤768
		// block's 112px plate would win on a portrait phone — which IS compact —
		// and overflow the 184px slot by 24px.
		expect(cardCss.indexOf("@media (max-width: 768px)")).toBeLessThan(
			cardCss.indexOf(".card-item-card--compact"),
		);
	});
});

describe("the 44px target survives the smaller card", () => {
	it("is the card itself, which is far larger than 44px at the drawer", () => {
		const columnWidth = getCardColumnWidth(374, 2, 16, 16);
		expect(columnWidth).toBeGreaterThanOrEqual(44);
		expect(getCardRowHeight(columnWidth, 1440)).toBeGreaterThanOrEqual(44);
	});

	it("keeps the whole card as the control, not a small button inside it", () => {
		expect(cardSource).toMatch(/role="button"/);
		expect(cardSource).toMatch(/tabindex="0"/);
		expect(cardSource).toMatch(/@click="onClick"/);
	});

	it("does not shrink the one control that IS inside the card", () => {
		// `.item-rate-info-trigger` carries its own 44px coarse-pointer box, bled
		// out on negative margin (guarded by touchTargetSweep.spec.ts). Nothing
		// in the compact block may reach it.
		expect(cardCss).not.toMatch(/\.card-item-card--compact[^{]*\.item-rate-info-trigger/);
	});
});

describe("the skeleton promises the grid the scroller then delivers", () => {
	it("uses the same minimum card width as the column arithmetic", () => {
		const track = declaration(gridCss, ".items-card-grid", "grid-template-columns");
		const minimum = /minmax\((\d+)px/.exec(track)?.[1];
		expect(Number(minimum)).toBe(CARD_MIN_WIDTH);
	});

	it("decides the card's anatomy with the same predicate that sizes its slot", () => {
		// Two thresholds — one here, one in the composable — is how a compact
		// card ends up in a roomy slot with dead space under it.
		expect(gridSource).toContain("isCompactCard");
		expect(gridSource).toContain(':compact="isCompact"');
	});

	it("hands the card the register's own low-stock threshold", () => {
		expect(gridSource).toContain("posa_low_stock_alert_threshold");
	});
});
