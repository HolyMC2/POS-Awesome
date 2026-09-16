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

vi.mock("../src/posapp/components/pos/closing/ClosingRecovery.vue", () => ({
	default: {
		template: "<div />",
		mounted() {
			this.$emit("ready", true);
		},
	},
}));

import ClosingDialog from "../src/posapp/components/pos/shell/ClosingDialog.vue";
import corteSource from "../src/posapp/components/pos/shell/ClosingDialog.vue?raw";
import allocationSource from "../src/posapp/components/pos/custody/CashClosingAllocation.vue?raw";
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
		{
			mode_of_payment: CASH,
			opening_amount: 1500,
			expected_amount: 5391,
			closing_amount: 0,
		},
		{
			mode_of_payment: "Tarjeta",
			opening_amount: 0,
			expected_amount: 3890,
			closing_amount: 3890,
		},
	],
});

const overviewMessage = {
	total_invoices: 31,
	company_currency: "MXN",
	cash_expected: {
		mode_of_payment: CASH,
		company_currency_total: 5391,
		by_currency: [],
	},
	payments_by_mode: [
		{
			mode_of_payment: CASH,
			currency: "MXN",
			total: 5120,
			company_currency_total: 5120,
		},
	],
	cash_movements: {
		count: 6,
		company_currency_total: 1829,
		by_currency: [],
		by_type: [],
	},
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

const find = (selector: string) =>
	dialog?.element.querySelector(selector) ?? null;

const styles = corteSource.slice(corteSource.lastIndexOf("<style"));
const rule = (selector: string) => {
	const start = styles.indexOf(`${selector} {`);
	expect(start, `${selector} has no rule`).toBeGreaterThan(-1);
	return styles.slice(start, styles.indexOf("}", start));
};

beforeEach(() => {
	// Desktop by default: the movil boundary moved to the compact band
	// (< 1100, 2026-08-26) and jsdom's 1024 default now falls inside it.
	window.innerWidth = 1440;
	setActivePinia(createPinia());
	vi.stubGlobal("__", (text: string) => text);
	vi.stubGlobal("format_number", (value: number) =>
		Number(value || 0).toFixed(2),
	);
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

describe("count and review share one closing screen", () => {
	it("keeps the count and evidence without repeating header facts in tiles", async () => {
		await mountDialog();
		expect(find(".closing-layout__tiles")).toBeNull();
		expect(find(".closing-layout__count")).not.toBeNull();
		expect(find(".closing-layout__detail")).not.toBeNull();
	});

	it("puts the reconciliation in the evidence column, beside the count and not under it", async () => {
		await mountDialog();
		const detail = find(".closing-layout__detail");
		const count = find(".closing-layout__count");
		const reconciliation = find(".reconciliation-section");
		const drawer = find('[data-testid="drawer-count"], .drawer-count');

		expect(
			reconciliation,
			"the reconciliation table is not rendered",
		).not.toBeNull();
		expect(detail?.contains(reconciliation as Node)).toBe(true);
		expect(count?.contains(reconciliation as Node)).toBe(false);
		if (drawer) {
			expect(detail?.contains(drawer)).toBe(false);
		}
	});

	it("names an area for every region, so none is auto-placed", () => {
		const layout = rule(".closing-layout");
		expect(layout).toContain("display: grid");
		for (const area of ["count", "detail"]) {
			expect(
				layout,
				`${area} is missing from grid-template-areas`,
			).toContain(area);
			expect(styles).toMatch(
				new RegExp(
					`\\.closing-layout__${area} \\{\\s*grid-area: ${area};`,
				),
			);
		}
	});

	it("drops the count column on a register with no drawer to count", () => {
		// `isCashMode` answers that from the server's own figures rather than
		// from a label, and an empty 340px column beside the evidence is dead
		// space the corte used to draw as a half-width `v-col`.
		expect(corteSource).toMatch(
			/'closing-layout--no-count': !cashRow(?:[, }])/,
		);
		const lean = rule(".closing-layout--no-count");
		expect(lean).toContain("grid-template-columns: minmax(0, 1fr)");
		const areas = /grid-template-areas:([\s\S]*?);/.exec(lean);
		expect(areas).not.toBeNull();
		expect((areas as RegExpExecArray)[1]).not.toContain("count");
	});

	it("sizes both rows to their content — the scroll model owns overflow, not the grid", () => {
		// fr rows + per-column scrollports drew THREE scrollbars on one corte
		// (Marco, 08-23). Content-sized rows mean the count and the
		// reconciliation always stand whole; the overview disclosure is the
		// only thing that can outgrow the surface, and the body's single
		// scroll carries it.
		const rows = /grid-template-rows:([^;]+);/.exec(
			rule(".closing-layout"),
		);
		expect(rows).not.toBeNull();
		expect((rows as RegExpExecArray)[1].trim()).toBe("auto");
	});
});

describe("one scroll at most, and only when the cashier asks for it", () => {
	it("gives no column a scrollport of its own", () => {
		// Three scrollbars on one corte was the report. The count and the
		// detail size to content; overflow belongs to the body's single
		// scroll (Vuetify's own `scrollable` chain), and only the opened
		// overview can create any.
		for (const column of [
			".closing-layout__count",
			".closing-layout__detail",
		]) {
			expect(
				rule(column),
				`${column} must not own a scrollport`,
			).not.toContain("overflow-y: auto");
		}
		expect(rule(".closing-body")).toContain("overflow-y: auto");
	});

	it("folds the overview behind a disclosure, closed by default, v-show not v-if", () => {
		// Closed, the corte fits whole with NO scrollbar; v-show so an
		// inspection in progress survives the fold.
		expect(corteSource).toContain('data-testid="closing-overview-toggle"');
		expect(corteSource).toMatch(/<ShiftOverview\s+v-show="overviewOpen"/);
		expect(corteSource).toContain("const overviewOpen = ref(false);");
	});

	it("keeps the difference and the close action outside the scrolling body", async () => {
		await mountDialog();
		const body = find(".closing-body");
		const difference = find(
			'[data-testid="closing-difference"], .closing-band',
		);
		const submit = find('[data-testid="closing-submit"]');

		expect(
			difference,
			"the corte draws neither a band nor a difference line",
		).not.toBeNull();
		expect(body?.contains(difference as Node)).toBe(false);
		expect(body?.contains(submit as Node)).toBe(false);
	});

	it("gives the single column back its scroll below the two-column width", () => {
		// One column that cannot scroll is worse than one that does.
		const narrow = styles.slice(
			styles.indexOf("@media (max-width: 959px)"),
		);
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
		expect(tilesSource).toMatch(
			/grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/,
		);
		expect(tilesSource).not.toContain("<v-col");
		expect(tilesSource).not.toContain("<v-row");
	});

	it("renders nothing at all until the overview has landed, and no zero padding after", () => {
		// An empty strip with padding reads as a layout bug, not as loading —
		// and a tile that says MX$ 0 is padding too. The gate reads the
		// VISIBLE lists (zero tiles hidden, `pinned` anchors kept), so the
		// two facts share one rule.
		expect(tilesSource).toContain(
			'v-if="visiblePrimary.length || visibleSecondary.length"',
		);
		expect(tilesSource).toContain("card.pinned || !card.zero");
	});

	it("leaves the overview holding only the evidence it no longer has to pin", () => {
		expect(overviewSource).not.toContain("insight-card");
		expect(overviewSource).not.toContain("primaryInsights");
	});
});

/**
 * The custody corte (roadmap §17.7 follow-up, live capture
 * `/tmp/pos-gap-wave/live/closing-count.png`): the count and the bags it is
 * divided into ran down ONE column past the fold while the whole evidence
 * column beside them stood empty and the reconciliation was a scroll away.
 *
 * jsdom computes no grid and no container query, so what this file can hold is
 * the wiring — which region owns which area, which container each query reads,
 * and that only the body scrolls. The geometry itself is measured in a real
 * browser by `tests/visual/check-closing-layout.mjs`.
 */
describe("the custody corte spends the width it is given", () => {
	const custodyServer = () =>
		vi.stubGlobal("frappe", {
			_: (text: string) => text,
			session: { user: "cashier@example.test" },
			call: ({ method }: any) => {
				const name = String(method || "");
				if (name.endsWith(".availability"))
					return Promise.resolve({ message: { enabled: true } });
				if (name.endsWith(".context"))
					return Promise.resolve({ message: { bags: [], counts: [] } });
				return Promise.resolve({ message: overviewMessage });
			},
		});

	it("puts the custody workspace in the count area and leaves the evidence its own", async () => {
		custodyServer();
		await mountDialog();
		for (let tick = 0; tick < 6; tick++) await nextTick();

		const count = find(".closing-layout__count");
		const allocation = find('[data-testid="cash-closing-allocation"]');
		expect(find(".closing-layout--custody")).not.toBeNull();
		expect(allocation, "the custody workspace is not rendered").not.toBeNull();
		expect(count?.contains(allocation as Node)).toBe(true);
		// The register draws ONE count: the ordinary drawer count stands down
		// while custody owns the drawer.
		expect(find('[data-testid="drawer-count"], .drawer-count')).toBeNull();
		expect(count?.contains(find(".reconciliation-section") as Node)).toBe(false);
	});

	it("measures the areas against the body, not the window", () => {
		// The corte is 1100px floating and full-bleed inside the destination
		// host on the same screen; a viewport breakpoint cannot tell them apart.
		expect(rule(".closing-body")).toContain("container: closing-body / inline-size");
		expect(styles).toMatch(
			/\.closing-layout__count \{[^}]*container: corte-count \/ inline-size;/,
		);
		expect(styles).toContain("@container closing-body (max-width: 1279.98px)");
	});

	it("gives count · bags · evidence a floor each instead of a starved third column", () => {
		const custody = rule(".closing-layout--custody");
		// 690px is what the count area needs to stand the count beside the bags;
		// under that the corte stacks rather than draw a column nobody can read.
		expect(custody).toContain("minmax(690px, 1.2fr)");
		expect(custody).toContain("minmax(360px, 1fr)");
		const stacked = styles.slice(
			styles.indexOf("@container closing-body (max-width: 1279.98px)"),
		);
		expect(stacked).toContain("flex-direction: column");
		// Stacked, the review that can block the close is read FIRST — the same
		// order the phone already uses.
		expect(stacked).toContain("order: 0");
	});

	it("splits the workspace only once there are bags to put beside the count", () => {
		// Before the first save there is one step, and it spreads its own
		// denomination rows across the width instead of halving it.
		expect(allocationSource).toContain("'cash-closing--split': Boolean(saved) || bags.length > 0");
		expect(allocationSource).toContain("cash-closing__step--count");
		expect(allocationSource).toContain("cash-closing__step--bags");
		const split = allocationSource.slice(
			allocationSource.indexOf("@container corte-count (min-width: 686px)"),
		);
		expect(
			allocationSource,
			"the workspace must query the area it was given",
		).toContain("@container corte-count (min-width: 686px)");
		expect(split).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
		// What reports on BOTH steps stays one full-width line.
		expect(split).toContain(".cash-closing--split > .cash-closing__todo");
		expect(split).toContain("grid-column: 1 / -1");
	});

	it("keeps the custody workspace out of the scroll business", () => {
		// The body is still the one scrollport: no column, and nothing inside
		// the custody workspace, may open a second one.
		expect(allocationSource.slice(allocationSource.lastIndexOf("<style"))).not.toContain("overflow-y: auto");
		expect(styles.slice(styles.indexOf(".closing-layout__count {"), styles.indexOf(".closing-overview-toggle"))).not.toContain("overflow-y: auto");
	});
});

describe("the overview stops drawing half a row", () => {
	it("balances the cash pair against the change table instead of stacking all three", async () => {
		await mountDialog();
		// Change Returned used to share ONE `md="6"` column with the cash
		// snapshot and the movements, so the corte drew a tall left stack
		// against an empty right half and finished it past the fold.
		const rows = Array.from(
			dialog?.element.querySelectorAll("v-row") ?? [],
		);
		const changeRow = rows.find((row) =>
			row.textContent?.includes("Change Returned"),
		);
		expect(
			changeRow,
			"the change-returned row is not rendered",
		).toBeDefined();
		expect(changeRow?.querySelectorAll("v-col")).toHaveLength(2);
	});
});
