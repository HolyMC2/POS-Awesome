// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

import ItemsTable from "../src/posapp/components/pos/invoice/ItemsTable.vue";
// Raw SFC text for the handful of guards that are properties of the SOURCE
// rather than of the render — `?raw` because `node:fs` is shimmed away under
// jsdom, the same reason `itemSelectorLayoutOwnership.spec.ts` reads this way.
import row from "../src/posapp/components/pos/invoice/CartItemRow.vue?raw";
import table from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import {
	CART_COLUMN_ALIGN,
	cartAlignClass,
	cartJustifyClass,
	resolveCartColumnAlign,
} from "../src/posapp/components/pos/invoice/cartColumnAlign";

/**
 * WHERE THE CART'S COLUMNS POINT.
 *
 * The defect: `Stock`'s header sat centred over a right-aligned figure. The
 * cause was not one column's `align` being ignored — it was that NOTHING read
 * `align`. `.posa-cart-table th` centred every header unconditionally, every
 * `<td>` restated its own alignment as a literal class, and the money cells
 * wrapped their figures in a flex box classed `right-aligned` whose rule was
 * `justify-content: center`. Three places to state one fact, and they had
 * already drifted apart in four columns before anyone looked.
 *
 * So this file does not check that `Stock` is right-aligned. It checks that
 * the header and the cell CANNOT disagree, for every column the table renders
 * — including one a later vertical adds. Mounted rather than source-scanned
 * for exactly that reason: a regex over the template proves what someone
 * wrote, and what was written was already consistent-looking and wrong.
 *
 * The direction is `Main.dc.html` nodes 32–36, and it is not a taste call:
 *
 *     Cant (center) | Descripción (left) | Existencia (right) |
 *     Precio u. (right) | Importe (right)
 */

const noop = () => {};

/** Everything `available_columns` can offer, so every branch of the row renders. */
const HEADERS = [
	{ title: "Name", key: "item_name", align: "start", required: true },
	{ title: "QTY", key: "qty", align: "center", required: true },
	{ title: "UOM", key: "uom", align: "center", required: true },
	{ title: "Price List Rate", key: "price_list_rate", align: "end", required: true },
	{ title: "Discount %", key: "discount_percentage", align: "end", required: true },
	{ title: "Discount Amount", key: "discount_amount", align: "end", required: true },
	{ title: "Rate", key: "rate", align: "center", required: true },
	{ title: "Amount", key: "amount", align: "center", required: true },
	{ title: "Offer?", key: "posa_is_offer", align: "center", required: true },
	{ title: "Actions", key: "actions", align: "center", required: true },
];

const LINE = {
	posa_row_id: "row-1",
	item_code: "IPN001545",
	item_name: "Anillo Case iPhone 12 Pro Max Negro",
	item_group: "Fundas y Carcasas",
	qty: 1,
	rate: 200,
	amount: 200,
	price_list_rate: 200,
	discount_percentage: 0,
	discount_amount: 0,
	uom: "Nos",
	item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
	is_stock_item: 1,
	actual_qty: 2,
};

beforeAll(() => {
	(globalThis as any).__ = (text: string) => text;
	(globalThis as any).frappe = {
		datetime: {
			nowdate: () => "2026-08-22",
			now_datetime: () => "2026-08-22 00:00:00",
			get_today: () => "2026-08-22",
		},
		call: () => Promise.resolve({ message: null }),
		boot: {},
	};
	(globalThis as any).ResizeObserver =
		(globalThis as any).ResizeObserver ||
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
});

beforeEach(() => {
	setActivePinia(createPinia());
});

const mountCart = (headers: any[] = HEADERS) => {
	const store = useInvoiceStore();
	store.setItems([{ ...LINE }]);
	return mount(ItemsTable, {
		props: {
			headers,
			pos_profile: { posa_low_stock_alert_threshold: 10 },
			formatFloat: (value: number) => String(value),
			formatCurrency: (value: number) => String(value),
			currencySymbol: () => "$",
			isNumber: () => true,
			setFormatedQty: noop,
			setFormatedCurrency: noop,
			calcPrices: noop,
			calcUom: noop,
			setSerialNo: noop,
			setBatchQty: noop,
			validateDueDate: noop,
			removeItem: noop,
			subtractOne: noop,
			addOne: noop,
			toggleOffer: noop,
			changePriceListRate: noop,
			isNegative: (value: number) => value < 0,
		},
		global: {
			plugins: [createVuetify()],
			// `__` is a Frappe global the templates call directly, so it has to
			// be on the instance proxy as well as on `globalThis`.
			config: { globalProperties: { __: (text: string) => text } },
		},
	});
};

/** The one `text-…` class on an element, or null. There must be exactly one. */
const alignmentOf = (classes: string[]) => {
	const found = classes.filter((name) => /^text-(start|center|end|left|right|justify)$/.test(name));
	expect(found.length).toBeLessThanOrEqual(1);
	return found[0] ?? null;
};

describe("the header and the cell read one answer — the column's", () => {
	it("gives every rendered column the SAME alignment above and below", () => {
		const wrapper = mountCart();
		const headers = wrapper.findAll("thead th");
		// The supplied set plus the two the table INJECTS rather than
		// registers: `stock` (structural, see STOCK_COLUMN) and the expander.
		expect(headers.length).toBe(HEADERS.length + 2);

		const mismatched: string[] = [];
		for (const th of headers) {
			const key = th.attributes("data-column-key") as string;
			const td = wrapper.find(`tbody td[data-column-key="${key}"]`);
			expect(td.exists()).toBe(true);

			const header = alignmentOf(th.classes());
			const cell = alignmentOf(td.classes());
			if (header !== cell) mismatched.push(`${key}: header ${header} vs cell ${cell}`);
		}
		expect(mismatched).toEqual([]);
	});

	it("takes that answer from the column object, not from either template", () => {
		const wrapper = mountCart();
		for (const th of wrapper.findAll("thead th")) {
			const key = th.attributes("data-column-key") as string;
			const declared = th.attributes("data-column-align");
			// The alignment the column resolved to is what BOTH sides rendered.
			expect(alignmentOf(th.classes())).toBe(cartAlignClass({ key, align: declared }));
			expect(alignmentOf(wrapper.find(`tbody td[data-column-key="${key}"]`).classes())).toBe(
				cartAlignClass({ key, align: declared }),
			);
		}
	});

	it("survives a column the operator hid — the pair still agrees", () => {
		// The responsive filter and the operator's saved preference both shrink
		// the set. Whatever survives, the two halves of a column move together.
		const wrapper = mountCart(HEADERS.filter((h) => ["item_name", "qty", "amount"].includes(h.key)));
		for (const th of wrapper.findAll("thead th")) {
			const key = th.attributes("data-column-key") as string;
			expect(alignmentOf(th.classes())).toBe(
				alignmentOf(wrapper.find(`tbody td[data-column-key="${key}"]`).classes()),
			);
		}
	});

	it("never restates an alignment as a literal class in either template", () => {
		// This is the guard against the defect COMING BACK by the same route:
		// a new `<td class="text-center">` would render correctly today and
		// silently diverge the day its column's alignment changes.
		const cells = [...row.matchAll(/<t[dh][^>]*>/g)].map((m) => m[0]);
		expect(cells.length).toBeGreaterThan(8);
		for (const cell of cells) {
			expect(cell).not.toMatch(/\bclass="[^"]*\btext-(start|center|end)\b/);
		}
		const headerTag = /<th\b[\s\S]*?>/.exec(table.replace(/<!--[\s\S]*?-->/g, ""))?.[0] ?? "";
		expect(headerTag).not.toMatch(/\bclass="[^"]*\btext-(start|center|end)\b/);
		expect(headerTag).toContain("cartAlignClass(column)");
	});
});

describe("the artboard's direction — figures right, controls centred", () => {
	it.each([
		["stock", "end"],
		["price_list_rate", "end"],
		["discount_percentage", "end"],
		["discount_amount", "end"],
		["rate", "end"],
		["amount", "end"],
	])("points %s at the right, the way Main.dc.html draws it", (key, expected) => {
		expect(resolveCartColumnAlign({ key })).toBe(expected);
	});

	it.each([
		["qty", "center"],
		["uom", "center"],
		["posa_is_offer", "center"],
		["actions", "center"],
		["data-table-expand", "center"],
	])("leaves %s centred, because it is a control and not a figure", (key, expected) => {
		expect(resolveCartColumnAlign({ key })).toBe(expected);
	});

	it("starts the description, which is prose", () => {
		expect(resolveCartColumnAlign({ key: "item_name" })).toBe("start");
	});

	it("overrides a stale align rather than inheriting it", () => {
		// `useInvoiceItems.available_columns` still says `center` for rate and
		// amount. The table draws the artboard, not the registry — the same
		// division CART_COLUMN_ORDER already makes for column ORDER.
		expect(resolveCartColumnAlign({ key: "rate", align: "center" })).toBe("end");
		expect(resolveCartColumnAlign({ key: "amount", align: "center" })).toBe("end");
	});

	it("lets a column the contract has never heard of keep its own opinion", () => {
		expect(resolveCartColumnAlign({ key: "posa_custom_serial", align: "start" })).toBe("start");
		expect(resolveCartColumnAlign({ key: "posa_custom_serial" })).toBe("center");
		expect(resolveCartColumnAlign({ key: "posa_custom_serial", align: "middle" })).toBe("center");
		expect(resolveCartColumnAlign(null)).toBe("center");
	});

	it("covers every column the cart can render", () => {
		// A key in CART_COLUMN_ORDER with no entry here would fall through to
		// whatever `available_columns` happened to say — which is where the
		// four drifted alignments came from.
		const order = /const CART_COLUMN_ORDER = \[([\s\S]*?)\]/.exec(table)?.[1] ?? "";
		const keys = [...order.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
		expect(keys.length).toBeGreaterThan(8);
		for (const key of keys) expect(CART_COLUMN_ALIGN[key]).toBeDefined();
	});
});

describe("a flex cell points where the column does, not where the flex box feels like", () => {
	it("gives the money and editor cells a justify class from the same column", () => {
		const wrapper = mountCart();
		for (const key of ["price_list_rate", "amount", "rate", "discount_amount", "uom"]) {
			const td = wrapper.find(`tbody td[data-column-key="${key}"]`);
			const inner = td.find("div");
			expect(inner.classes()).toContain(cartJustifyClass({ key }));
		}
	});

	it("resolves those classes to a real edge", () => {
		const styles = /<style scoped>([\s\S]*?)<\/style>/.exec(row)?.[1] ?? "";
		expect(styles).toMatch(/\.posa-cart-cell--end\s*\{[^}]*justify-content:\s*flex-end/);
		expect(styles).toMatch(/\.posa-cart-cell--center\s*\{[^}]*justify-content:\s*center/);
		expect(styles).toMatch(/\.posa-cart-cell--start\s*\{[^}]*justify-content:\s*flex-start/);
	});

	it("has retired the class named right-aligned that centred", () => {
		// `.currency-display.right-aligned { justify-content: center }` is why
		// `price_list_rate` carried `text-end` on its cell and still drew the
		// figure in the middle. A name that lies is worse than no name.
		// Comments stripped: the reason it went is written down right where it
		// used to be, and that prose names the class.
		expect(row.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain(
			"right-aligned",
		);
	});

	it("keeps the justify rules below .currency-display, which ties on specificity", () => {
		const styles = /<style scoped>([\s\S]*?)<\/style>/.exec(row)?.[1] ?? "";
		expect(styles.indexOf(".posa-cart-cell--end")).toBeGreaterThan(
			styles.indexOf(".currency-display {"),
		);
	});
});

describe("the memoised row cannot cache a stale side", () => {
	it("keys the v-memo on align as well as on the column key", () => {
		// The row is `v-memo`'d on its column list. With only the keys in the
		// deps, a re-aligned column that kept its key would leave every cell
		// pinned to the side it was first rendered on.
		const deps = /const memoDeps = computed\(\(\) => \{([\s\S]*?)\];/.exec(row)?.[1] ?? "";
		expect(deps).toMatch(/column\?\.align/);
	});
});
