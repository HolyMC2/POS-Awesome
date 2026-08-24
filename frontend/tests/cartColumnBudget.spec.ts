// @vitest-environment jsdom

/**
 * THE CART'S WIDTH BUDGET — the arithmetic, and the collapse it drives.
 *
 * The defect this file exists to make impossible is a SUM, not a rule. The
 * column widths shipped as percentages and the sized ones added up to 95% for
 * the cafetería's column set, while `item_name` and `stock` were deliberately
 * unsized — so the ticket's two most important columns split the 5% left over.
 * Measured in Chromium on the cafetería demo at 1718x1023 on 2026-08-23:
 *
 *     cart 1572px (drawer closed)    name 39.3px · stock 39.3px
 *     cart 1014px (drawer anchored)  name 25.3px · stock 25.3px
 *
 * against a `Nombre` header that needs 47.6px to draw. That is the «one letter»
 * name and the truncated «Tasa de List» / «Descuer» / «Accione» in a single
 * addition — and no amount of per-column tuning would have found it, because
 * every individual rule looked reasonable.
 *
 * So the guarantees here are stated as invariants over the WHOLE set, at the
 * widths the register can actually produce, rather than as expected values for
 * one layout:
 *
 *   1. no column narrower than the text of its own header;
 *   2. the widths never add up to more than the box (no sideways scroll);
 *   3. the item name is the elastic column and keeps its comfort width for as
 *      long as there is an optional column left to spend.
 *
 * The header text figures below were measured in the shipped browser at the
 * real `--header-font-size` (0.8rem, weight 600) with `measureText`, not
 * estimated: a min-width table checked against guesses is a table that agrees
 * with the guesses.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { createVuetify } from "vuetify";

import ItemsTable from "../src/posapp/components/pos/invoice/ItemsTable.vue";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import {
	CART_COLUMN_COLLAPSE_ORDER,
	CART_COLUMN_MIN_WIDTH,
	CART_NAME_MIN_WIDTH,
	CART_NAME_TARGET_WIDTH,
	CART_REQUIRED_COLUMNS,
	CART_STRUCTURAL_COLUMNS,
	planCartColumnWidths,
	planCartColumns,
} from "../src/posapp/composables/pos/items/useItemsTableResponsive";

/**
 * Widest single WORD of each Spanish header, in px, measured in Chromium on the
 * live register. A word is the unit that matters: `.posa-cart-th__label` clamps
 * to two lines with `overflow-wrap: anywhere`, so a column narrower than one
 * word does not wrap — it breaks the word in half, which is the «Descuer» in
 * the bug report.
 */
const HEADER_WORD_PX: Record<string, number> = {
	qty: 53.4, // Cantidad
	item_name: 47.5, // Nombre
	stock: 58.6, // Inventario
	uom: 42.3, // Unidad
	price_list_rate: 44.5, // "Tasa de Lista de Precios" -> Precios
	discount_percentage: 63.8, // "Descuento %" -> Descuento
	discount_amount: 63.8, // Descuento
	rate: 37.8, // Precio
	amount: 45.3, // Importe
	posa_is_offer: 52.7, // ¿Oferta?
	actions: 54.2, // Acciones
};

/** `--cell-padding-x` on the header, both sides. */
const HEADER_GUTTERS = 8;

/** The operator's full registry, as `useInvoiceItems.available_columns` ships it. */
const HEADERS = [
	{ title: "Nombre", key: "item_name", align: "start", required: true },
	{ title: "Cantidad", key: "qty", align: "center", required: true },
	{ title: "Unidad", key: "uom", align: "center" },
	{ title: "Tasa de Lista de Precios", key: "price_list_rate", align: "end" },
	{ title: "Descuento %", key: "discount_percentage", align: "end" },
	{ title: "Descuento", key: "discount_amount", align: "end" },
	{ title: "Precio", key: "rate", align: "end", required: true },
	{ title: "Importe", key: "amount", align: "end", required: true },
	{ title: "¿Oferta?", key: "posa_is_offer", align: "center" },
	{ title: "Acciones", key: "actions", align: "center", required: true },
];

/** What the cafetería register actually registers — no UOM, no offer button. */
const CAFETERIA_HEADERS = HEADERS.filter(
	(header) => !["uom", "posa_is_offer"].includes(header.key),
);

const keysOf = (headers: typeof HEADERS) => [
	...headers.map((header) => header.key),
	...CART_STRUCTURAL_COLUMNS,
];

/**
 * Cart widths this register can actually produce, measured on the demo:
 * 1574 = drawer closed at 1718px; 854 = drawer anchored at its new 720px cap;
 * 1014 = the old 560px anchored drawer; 700/560 = the narrow end before the
 * rows reflow into cards at 500px.
 */
const CART_WIDTHS = [1574, 1014, 854, 700, 620, 560, 500];

describe("no cart column is narrower than its own header", () => {
	it("floors every column above its widest header word plus the gutters", () => {
		const short: string[] = [];
		for (const [key, wordWidth] of Object.entries(HEADER_WORD_PX)) {
			const floor = CART_COLUMN_MIN_WIDTH[key];
			expect(floor, `${key} has no floor`).toBeTypeOf("number");
			if ((floor as number) < wordWidth + HEADER_GUTTERS) {
				short.push(`${key}: floor ${floor} < word ${wordWidth} + ${HEADER_GUTTERS}`);
			}
		}
		expect(short).toEqual([]);
	});

	it("hands every surviving column at least its floor, at every cart width", () => {
		const under: string[] = [];
		for (const width of CART_WIDTHS) {
			const { visible } = planCartColumns(keysOf(HEADERS), width);
			const widths = planCartColumnWidths(visible, width);
			for (const key of visible) {
				if (key === "item_name") continue; // elastic — covered below
				if ((widths[key] as number) < (CART_COLUMN_MIN_WIDTH[key] as number)) {
					under.push(`${width}px: ${key} ${widths[key]}`);
				}
			}
		}
		expect(under).toEqual([]);
	});
});

describe("the table never outgrows the box it was measured in", () => {
	it("keeps the sum of the planned widths inside the container", () => {
		const over: string[] = [];
		for (const width of CART_WIDTHS) {
			for (const headers of [HEADERS, CAFETERIA_HEADERS]) {
				const { visible } = planCartColumns(keysOf(headers), width);
				const widths = planCartColumnWidths(visible, width);
				const total = visible.reduce((sum, key) => sum + ((widths[key] as number) || 0), 0);
				if (total > width) over.push(`${width}px: planned ${total}`);
			}
		}
		expect(over).toEqual([]);
	});

	it("plans nothing at all before the observer has measured anything", () => {
		// Width 0 is jsdom, and the frame before the ResizeObserver reports.
		// Guessing narrow there and snapping wide is worse than one honest
		// frame on the stylesheet's percentages.
		expect(planCartColumns(keysOf(HEADERS), 0).collapsed).toEqual([]);
		expect(planCartColumnWidths(keysOf(HEADERS), 0)).toEqual({});
	});
});

describe("the item name is the elastic column", () => {
	it("keeps its comfort width while any optional column is still droppable", () => {
		const thin: string[] = [];
		for (const width of CART_WIDTHS) {
			const { visible, collapsed } = planCartColumns(keysOf(HEADERS), width);
			const name = planCartColumnWidths(visible, width).item_name as number;
			const droppableLeft = CART_COLUMN_COLLAPSE_ORDER.some((key) => visible.includes(key));
			if (name < CART_NAME_TARGET_WIDTH && droppableLeft) {
				thin.push(`${width}px: name ${name} with ${collapsed.length} collapsed`);
			}
		}
		expect(thin).toEqual([]);
	});

	it("takes every pixel the sized columns did not need", () => {
		const { visible } = planCartColumns(keysOf(HEADERS), 1574);
		const widths = planCartColumnWidths(visible, 1574);
		const sized = visible
			.filter((key) => key !== "item_name")
			.reduce((sum, key) => sum + (widths[key] as number), 0);
		// 2px of slack for the header cells' right border; see the planner.
		expect((widths.item_name as number) + sized).toBe(1574 - 2);
		// And on a wide cart it is comfortably the widest column, not merely
		// present — the whole eleven-column registry at 1574px still leaves it
		// more than double what the next column takes.
		expect(widths.item_name as number).toBeGreaterThan(CART_NAME_TARGET_WIDTH);
		const widest = Math.max(
			...visible.filter((key) => key !== "item_name").map((key) => widths[key] as number),
		);
		expect(widths.item_name as number).toBeGreaterThan(widest * 2);
	});
});

describe("the collapse ladder, at the widths this register produces", () => {
	it("keeps every column on a cart with the drawer closed", () => {
		expect(planCartColumns(keysOf(CAFETERIA_HEADERS), 1574).collapsed).toEqual([]);
	});

	it("drops the two discount columns once the 720px drawer is anchored", () => {
		// 1718px viewport, drawer at its min(62%, 720px) cap -> ~854px of cart.
		const { visible, collapsed } = planCartColumns(keysOf(CAFETERIA_HEADERS), 854);
		expect(collapsed).toEqual(["discount_amount", "discount_percentage"]);
		expect(visible).toContain("price_list_rate");
		expect(planCartColumnWidths(visible, 854).item_name as number).toBeGreaterThanOrEqual(
			CART_NAME_TARGET_WIDTH,
		);
	});

	it("drops the price-list rate next, then stock, as the cart narrows further", () => {
		expect(planCartColumns(keysOf(CAFETERIA_HEADERS), 700).collapsed).toContain(
			"price_list_rate",
		);
		expect(planCartColumns(keysOf(CAFETERIA_HEADERS), 560).collapsed).toContain("stock");
	});

	it("never collapses a column the ticket cannot be read without", () => {
		const survivors = new Set<string>();
		for (const width of [...CART_WIDTHS, 320, 200]) {
			for (const key of planCartColumns(keysOf(HEADERS), width).visible) survivors.add(key);
			for (const key of CART_REQUIRED_COLUMNS) {
				expect(
					planCartColumns(keysOf(HEADERS), width).visible,
					`${key} left the row grid at ${width}px`,
				).toContain(key);
			}
		}
		expect(survivors.size).toBeGreaterThan(0);
	});

	it("collapses only what the expanded row editor can still edit", () => {
		// Nothing becomes unreachable: `ItemsTableExpandedRow.vue` carries
		// price-list rate, discount % and discount amount as fields, and the
		// expander that opens it is on the never-collapse list.
		for (const key of ["price_list_rate", "discount_percentage", "discount_amount"]) {
			expect(CART_COLUMN_COLLAPSE_ORDER).toContain(key);
		}
		expect(CART_REQUIRED_COLUMNS).toContain("data-table-expand");
	});
});

// --- and the same thing, rendered ------------------------------------------

const noop = () => {};

const LINE = {
	posa_row_id: "row-1",
	item_code: "CAFE-CAPUCHINO",
	item_name: "Capuchino grande con leche de avena",
	item_group: "Cafeteria Demo",
	qty: 2,
	rate: 48,
	amount: 96,
	price_list_rate: 48,
	discount_percentage: 0,
	discount_amount: 0,
	uom: "Nos",
	item_uoms: [{ uom: "Nos", conversion_factor: 1 }],
	is_stock_item: 1,
	actual_qty: 12,
};

beforeAll(() => {
	(globalThis as any).__ = (text: string) => text;
	(globalThis as any).frappe = {
		datetime: {
			nowdate: () => "2026-08-23",
			now_datetime: () => "2026-08-23 00:00:00",
			get_today: () => "2026-08-23",
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

/**
 * Mount the cart in a box of a known width.
 *
 * `useItemsTableResponsive` seeds itself from the container's
 * `getBoundingClientRect()` in `onMounted` — the same measurement the
 * ResizeObserver keeps up to date — so stubbing that is how a jsdom test gets a
 * real width. The window is NOT a proxy for it: the cart's width follows the
 * catalogue drawer, which is the whole reason this is measured rather than
 * queried.
 *
 * The `await nextTick()` is not ceremony. `mount()` returns as soon as the
 * component is mounted; the width the observer just wrote is a reactive change
 * queued for the next flush, so reading the DOM synchronously reads the frame
 * BEFORE the measurement — which looks exactly like a container of width 0 and
 * would have passed this file against a table that never sized itself.
 */
const mountCartAt = async (containerWidth: number, headers: any[] = CAFETERIA_HEADERS) => {
	const original = Element.prototype.getBoundingClientRect;
	Element.prototype.getBoundingClientRect = function () {
		return {
			width: containerWidth,
			height: 600,
			top: 0,
			left: 0,
			right: containerWidth,
			bottom: 600,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect;
	};
	let wrapper;
	try {
		const store = useInvoiceStore();
		store.setItems([{ ...LINE }]);
		wrapper = mount(ItemsTable, {
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
				config: { globalProperties: { __: (text: string) => text } },
			},
		});
	} finally {
		Element.prototype.getBoundingClientRect = original;
	}
	await nextTick();
	return wrapper;
};

type CartWrapper = Awaited<ReturnType<typeof mountCartAt>>;

const renderedColumns = (wrapper: CartWrapper) =>
	wrapper.findAll("thead th").map((th) => ({
		key: th.attributes("data-column-key") as string,
		width: Number.parseFloat(
			((th.attributes("style") || "").match(/width:\s*([\d.]+)px/) || [])[1] ?? "NaN",
		),
	}));

describe("the rendered header row carries the budget", () => {
	it("puts a px width on every column once the container has been measured", async () => {
		const wrapper = await mountCartAt(854);
		const columns = renderedColumns(wrapper);
		expect(columns.length).toBeGreaterThan(0);
		for (const column of columns) {
			expect(column.width, `${column.key} has no px width`).toBeGreaterThan(0);
		}
		wrapper.unmount();
	});

	it("renders the same set the planner planned, drawer open and closed", async () => {
		for (const width of [1574, 854, 620]) {
			const wrapper = await mountCartAt(width);
			const rendered = renderedColumns(wrapper).map((column) => column.key);
			// Sets, not sequences: the ORDER is `CART_COLUMN_ORDER`'s (qty
			// first, the artboard's answer) and is `cartColumnAlign.spec.ts`'s
			// business, not the budget's.
			expect([...rendered].sort()).toEqual(
				[...planCartColumns(keysOf(CAFETERIA_HEADERS), width).visible].sort(),
			);
			wrapper.unmount();
		}
	});

	it("gives the name more than any other column, at every width it is planned for", async () => {
		for (const width of [1574, 1014, 854]) {
			const wrapper = await mountCartAt(width);
			const columns = renderedColumns(wrapper);
			const name = columns.find((column) => column.key === "item_name");
			expect(name?.width, `no name column at ${width}px`).toBeGreaterThanOrEqual(
				CART_NAME_MIN_WIDTH,
			);
			for (const column of columns) {
				if (column.key === "item_name") continue;
				expect(
					name?.width,
					`${column.key} is wider than the name at ${width}px`,
				).toBeGreaterThan(column.width);
			}
			wrapper.unmount();
		}
	});

	it("stops injecting the stock column once the budget cannot pay for it", async () => {
		const wide = await mountCartAt(1574);
		expect(renderedColumns(wide).map((column) => column.key)).toContain("stock");
		wide.unmount();

		const narrow = await mountCartAt(560);
		expect(renderedColumns(narrow).map((column) => column.key)).not.toContain("stock");
		narrow.unmount();
	});
});
