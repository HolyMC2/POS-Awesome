// @vitest-environment jsdom

/**
 * The corte's LAYOUT — what is on screen at once, and what is allowed to
 * scroll (roadmap §17.7, `Corte.dc.html`).
 *
 * The artboard draws columns that fill the height with the band across the
 * bottom. The screen it replaced was one column: the shift overview's seven
 * tables, then the drawer count, then the reconciliation, all in the single
 * scrollport `v-dialog scrollable` hands to `.v-card-text`. Counting a drawer
 * against a figure you have to scroll back to is how a cashier retypes it.
 *
 * So the property this file holds is not "it looks like the artboard" — it is:
 *
 *   1. the count, the headline figures and the evidence are separate regions;
 *   2. only the evidence scrolls;
 *   3. the difference and the close action are outside the scrolling body
 *      entirely, so neither can leave the screen.
 *
 * `createVuetify()` registers no components, so `v-dialog` stays an unknown
 * element and renders its children inline — which is what makes the dialog
 * assertable without dragging the whole Vuetify graph into a unit spec.
 * Same harness as `corteClosingSeam.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

import ClosingDialog from "../src/posapp/components/pos/shell/ClosingDialog.vue";
import corteSource from "../src/posapp/components/pos/shell/ClosingDialog.vue?raw";
import tilesSource from "../src/posapp/components/pos/closing/ShiftInsightTiles.vue?raw";
import overviewSource from "../src/posapp/components/pos/closing/ShiftOverview.vue?raw";

const makeBus = () => {
	const handlers: Record<string, Array<(_payload?: any) => void>> = {};
	return {
		on: (event: string, fn: (_payload?: any) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string) => {
			delete handlers[event];
		},
		emit: (event: string, payload?: any) => {
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

const CASH = "Efectivo";

const closingShift = () => ({
	pos_opening_shift: "POS-OPEN-0001",
	period_start_date: "2026-08-22 09:02:00",
	period_end_date: "2026-08-22 20:05:00",
	payment_reconciliation: [
		{ mode_of_payment: CASH, opening_amount: 1500, expected_amount: 5391, closing_amount: 0 },
		{ mode_of_payment: "Tarjeta", opening_amount: 0, expected_amount: 3890, closing_amount: 3890 },
	],
});

const overviewMessage = {
	total_invoices: 31,
	company_currency: "MXN",
	cash_expected: { mode_of_payment: CASH, company_currency_total: 5391, by_currency: [] },
	payments_by_mode: [
		{ mode_of_payment: CASH, currency: "MXN", total: 5120, company_currency_total: 5120 },
	],
	cash_movements: { count: 6, company_currency_total: 1829, by_currency: [], by_type: [] },
	draft_invoices: { count: 0 },
};

let dialog: ReturnType<typeof mount> | null = null;

const mountDialog = async () => {
	const eventBus = makeBus();
	const wrapper = mount(ClosingDialog, {
		global: {
			plugins: [createVuetify()],
			provide: { eventBus },
			mocks: { __: window.__, frappe: { _: (text: string) => text } },
		},
	});

	dialog = wrapper;
	eventBus.emit("open_ClosingDialog", closingShift());
	await nextTick();
	await nextTick();
	await nextTick();
	return wrapper;
};

const find = (selector: string) => dialog?.element.querySelector(selector) ?? null;

const styles = corteSource.slice(corteSource.lastIndexOf("<style"));
const rule = (selector: string) => {
	const start = styles.indexOf(`${selector} {`);
	expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
	return styles.slice(start, styles.indexOf("}", start));
};

beforeEach(() => {
	setActivePinia(createPinia());
	vi.stubGlobal("__", (text: string) => text);
	vi.stubGlobal("format_number", (value: number) => Number(value || 0).toFixed(2));
	vi.stubGlobal("flt", (value: number) => Number(value) || 0);
	vi.stubGlobal("get_currency_symbol", () => "$");
	vi.stubGlobal("frappe", {
		_: (text: string) => text,
		call: () => Promise.resolve({ message: overviewMessage }),
	});
});

afterEach(() => {
	dialog?.unmount();
	dialog = null;
	vi.unstubAllGlobals();
});

describe("three regions, not one column", () => {
	it("draws the headline figures, the count and the evidence as separate regions", async () => {
		await mountDialog();
		expect(find(".closing-layout__tiles")).not.toBeNull();
		expect(find(".closing-layout__count")).not.toBeNull();
		expect(find(".closing-layout__detail")).not.toBeNull();
	});

	it("puts the reconciliation in the evidence column, beside the count and not under it", async () => {
		await mountDialog();
		const detail = find(".closing-layout__detail");
		const count = find(".closing-layout__count");
		const reconciliation = find(".reconciliation-section");
		const drawer = find('[data-testid="drawer-count"], .drawer-count');

		expect(reconciliation, "the reconciliation table is not rendered").not.toBeNull();
		expect(detail?.contains(reconciliation as Node)).toBe(true);
		expect(count?.contains(reconciliation as Node)).toBe(false);
		if (drawer) {
			expect(detail?.contains(drawer)).toBe(false);
		}
	});

	it("names an area for every region, so none is auto-placed", () => {
		const layout = rule(".closing-layout");
		expect(layout).toContain("display: grid");
		for (const area of ["tiles", "count", "detail"]) {
			expect(layout, `${area} is missing from grid-template-areas`).toContain(area);
			expect(styles).toMatch(
				new RegExp(`\\.closing-layout__${area} \\{\\s*grid-area: ${area};`),
			);
		}
	});

	it("drops the count column on a register with no drawer to count", () => {
		// `isCashMode` answers that from the server's own figures rather than
		// from a label, and an empty 340px column beside the evidence is dead
		// space the corte used to draw as a half-width `v-col`.
		expect(corteSource).toContain(`:class="{ 'closing-layout--no-count': !cashRow }"`);
		const lean = rule(".closing-layout--no-count");
		expect(lean).toContain("grid-template-columns: minmax(0, 1fr)");
		const areas = /grid-template-areas:([\s\S]*?);/.exec(lean);
		expect(areas).not.toBeNull();
		expect((areas as RegExpExecArray)[1]).not.toContain("count");
	});

	it("gives the columns the height the tiles leave — but never less than a working table", () => {
		// `auto` for the tiles, `fr` for the columns, and a FLOOR on the fr:
		// hosted beside the rail, header + tiles could spend the surface down
		// to ~135px of columns (Marco, 08-23) — a count you cannot read. Under
		// the floor the body scrolls; above it the columns divide what is left.
		const rows = /grid-template-rows:([^;]+);/.exec(rule(".closing-layout"));
		expect(rows).not.toBeNull();
		expect((rows as RegExpExecArray)[1].trim()).toBe("auto minmax(280px, 1fr)");
	});
});

describe("only the evidence scrolls", () => {
	it("hands the scroll to the two columns instead of to the card's body", () => {
		// `min-height: 0` is the load-bearing half — a flex child defaults to
		// `min-height: auto` and would refuse to shrink below seven tables,
		// which is how the card's own scrollport came to own the whole corte.
		const body = rule(".closing-body");
		expect(body).toContain("display: flex");
		expect(body).toContain("min-height: 0");
		expect(body).not.toContain("overflow-y: auto");

		for (const column of [".closing-layout__count", ".closing-layout__detail"]) {
			const region = rule(column);
			expect(region, `${column} must own its scrollport`).toContain("overflow-y: auto");
			expect(region).toContain("min-height: 0");
		}
	});

	it("keeps the difference and the close action outside the scrolling body", async () => {
		await mountDialog();
		const body = find(".closing-body");
		const difference = find('[data-testid="closing-difference"], .closing-band');
		const submit = find('[data-testid="closing-submit"]');

		expect(difference, "the corte draws neither a band nor a difference line").not.toBeNull();
		expect(body?.contains(difference as Node)).toBe(false);
		expect(body?.contains(submit as Node)).toBe(false);
	});

	it("gives the single column back its scroll below the two-column width", () => {
		// One column that cannot scroll is worse than one that does.
		const narrow = styles.slice(styles.indexOf("@media (max-width: 959px)"));
		expect(narrow).toContain(".closing-body {");
		expect(narrow).toContain("display: block");
		expect(narrow).toMatch(/overflow: visible/);
	});
});

describe("the tiles answer to the width they are given", () => {
	it("packs them with auto-fit rather than viewport breakpoints", () => {
		// They used to be `cols="6" md="3"`, and Vuetify breakpoints read the
		// WINDOW — while this strip is 1100px wide in a dialog on a 1920 screen
		// and full-bleed inside the destination host.
		// 150px min: eleven tiles must pack ONE row on a ~1650px surface —
		// at 190 they wrapped to two and starved the columns below.
		expect(tilesSource).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
		expect(tilesSource).not.toContain("<v-col");
		expect(tilesSource).not.toContain("<v-row");
	});

	it("renders nothing at all until the overview has landed", () => {
		// An empty strip with padding reads as a layout bug, not as loading.
		expect(tilesSource).toContain(
			'v-if="primaryInsights.length || secondaryInsights.length"',
		);
	});

	it("leaves the overview holding only the evidence it no longer has to pin", () => {
		expect(overviewSource).not.toContain("insight-card");
		expect(overviewSource).not.toContain("primaryInsights");
	});
});

describe("the overview stops drawing half a row", () => {
	it("balances the cash pair against the change table instead of stacking all three", async () => {
		await mountDialog();
		// Change Returned used to share ONE `md="6"` column with the cash
		// snapshot and the movements, so the corte drew a tall left stack
		// against an empty right half and finished it past the fold.
		const rows = Array.from(dialog?.element.querySelectorAll("v-row") ?? []);
		const changeRow = rows.find((row) => row.textContent?.includes("Change Returned"));
		expect(changeRow, "the change-returned row is not rendered").toBeDefined();
		expect(changeRow?.querySelectorAll("v-col")).toHaveLength(2);
	});
});
