import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	describeLineStock,
	describeLineIdentity,
} from "../src/posapp/components/pos/invoice/cartLineStock";

/**
 * The cart line's anatomy, against `Main.dc.html` nodes 32–92:
 *
 *     Cant | Descripción | Existencia | Precio u. | Importe
 *
 * The derivation is unit-tested directly because it is pure; the wiring is
 * source-scanned because `ItemsTable` mounts the whole cart stack (formatters,
 * drag-drop, merge, responsive columns, Vuetify dialogs) and what matters here
 * is a layout decision rather than the behaviour of those parts — the same
 * reasoning `comboCartLineMounted.spec.ts` records.
 */
// Node env (no jsdom pragma): `node:fs` named imports do not interop under
// jsdom in this repo — the same reason cartActionBarLayout.spec.ts is node.
const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const table = read("../src/posapp/components/pos/invoice/ItemsTable.vue");
const row = read("../src/posapp/components/pos/invoice/CartItemRow.vue");

describe("Existencia — what the column may claim", () => {
	it("draws the figure for an ordinary stocked line", () => {
		const stock = describeLineStock({ is_stock_item: 1, actual_qty: 5 });
		expect(stock).toMatchObject({ show: true, value: 5, reason: "bounded" });
	});

	it("prefers the figure the stock gate itself enforces", () => {
		// `useItemAddition` clamps against `_base_actual_qty / conversion_factor`.
		// Reading `actual_qty` first would quietly disagree with the refusal a
		// cashier just saw: 24 singles sold by the 12-box is 2 boxes, not 24.
		const stock = describeLineStock({
			is_stock_item: 1,
			_base_actual_qty: 24,
			conversion_factor: 12,
			actual_qty: 24,
		});
		expect(stock.value).toBe(2);
	});

	it("falls back to the line's own figure when there is no conversion", () => {
		const stock = describeLineStock({ is_stock_item: 1, actual_qty: 7, conversion_factor: 0 });
		expect(stock.value).toBe(7);
	});

	// THE GUARD. Absence is not zero. A rendered 0 says "this shop has none of
	// this", and a cashier who reads it will tell a customer so — while the
	// shelf may be full and the register simply offline.
	it.each([
		["absent", {}],
		["null", { actual_qty: null }],
		["empty string", { actual_qty: "" }],
		["not a number", { actual_qty: "abc" }],
		["NaN", { actual_qty: Number.NaN }],
	])("renders NOTHING, not 0, when stock is %s", (_label, extra) => {
		const stock = describeLineStock({ is_stock_item: 1, ...extra });
		expect(stock.show).toBe(false);
		expect(stock.value).toBeNull();
		expect(stock.reason).toBe("unknown");
	});

	it("says nothing about a line that has no shelf", () => {
		// `Instalación` is the standing example — the combo availability rule
		// excludes non-stock components for exactly this reason.
		const stock = describeLineStock({ is_stock_item: 0, actual_qty: 0 });
		expect(stock.show).toBe(false);
		expect(stock.reason).toBe("not-stocked");
	});

	it('reads the string "0" as not stocked, the way a Check field arrives', () => {
		expect(describeLineStock({ is_stock_item: "0", actual_qty: 4 }).reason).toBe("not-stocked");
	});

	it("DOES render a real zero, because that is a genuine answer", () => {
		const stock = describeLineStock({ is_stock_item: 1, actual_qty: 0 }, { lowStockThreshold: 10 });
		expect(stock.show).toBe(true);
		expect(stock.value).toBe(0);
		expect(stock.isLow).toBe(true);
	});
});

describe("Existencia — the low tint rides the register's own threshold", () => {
	it("tints at or under posa_low_stock_alert_threshold", () => {
		expect(describeLineStock({ is_stock_item: 1, actual_qty: 10 }, { lowStockThreshold: 10 }).isLow).toBe(true);
		expect(describeLineStock({ is_stock_item: 1, actual_qty: 11 }, { lowStockThreshold: 10 }).isLow).toBe(false);
	});

	it.each([[0], [undefined], [null], [""]])(
		"treats a threshold of %s as never warn, not always warn",
		(threshold) => {
			const stock = describeLineStock({ is_stock_item: 1, actual_qty: 1 }, { lowStockThreshold: threshold });
			expect(stock.show).toBe(true);
			expect(stock.isLow).toBe(false);
		},
	);
});

describe("the identity subtitle confirms WHICH variant was scanned", () => {
	it("joins code and group", () => {
		expect(describeLineIdentity({ item_code: "IPN001545", item_group: "Fundas y Carcasas" })).toBe(
			"IPN001545 · Fundas y Carcasas",
		);
	});

	it("degrades to the code alone rather than inventing a category", () => {
		// A fabricated parent would confirm the WRONG thing confidently, which
		// on a mis-scan is worse than confirming nothing.
		expect(describeLineIdentity({ item_code: "IPN001545" })).toBe("IPN001545");
		expect(describeLineIdentity({ item_code: "IPN001545", item_group: "  " })).toBe("IPN001545");
	});

	it("renders nothing at all when there is nothing to say", () => {
		expect(describeLineIdentity({})).toBe("");
	});
});

describe("the artboard's column anatomy", () => {
	it("puts quantity first and stock beside the description", () => {
		const order = /const CART_COLUMN_ORDER = \[([\s\S]*?)\]/.exec(table)?.[1] ?? "";
		const keys = [...order.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
		expect(keys.slice(0, 4)).toEqual(["qty", "item_name", "uom", "stock"]);
		expect(keys.indexOf("rate")).toBeGreaterThan(keys.indexOf("stock"));
		expect(keys.indexOf("amount")).toBeGreaterThan(keys.indexOf("rate"));
	});

	it("injects Existencia rather than registering it, like the expand column", () => {
		// Registering it in `available_columns` would make it hideable AND
		// invisible to every register with a saved preference, since that list
		// is a closed set of keys.
		expect(table).toContain('key: "stock"');
		expect(table).toMatch(/columns\.push\(STOCK_COLUMN\)/);
	});

	it("only shows stock alongside something to identify it by", () => {
		expect(table).toMatch(/hasName[\s\S]{0,120}columns\.push\(STOCK_COLUMN\)/);
	});

	it("keeps an unrecognised column at the end instead of sorting it first", () => {
		// `indexOf` returns -1 for anything not in the list, which would sort
		// ahead of `qty` and put a stray column in the most valuable position.
		expect(table).toMatch(/index === -1 \? CART_COLUMN_ORDER\.length : index/);
	});

	it("sizes the column with plain numbers, not max()", () => {
		// Under `table-layout: fixed` a `max()` width is silently dropped and
		// every column collapses to equal width — documented at
		// items-table-styles.css:135.
		const column = /const STOCK_COLUMN = \{([\s\S]*?)\};/.exec(table)?.[1] ?? "";
		expect(column).toMatch(/width: \d+/);
		expect(column).not.toContain("max(");
	});
});

describe("the row renders both, and neither lies", () => {
	it("draws the stock cell only when the derivation permits it", () => {
		expect(row).toMatch(/v-else-if="column\.key === 'stock'"/);
		expect(row).toMatch(/v-if="lineStock\.show"/);
	});

	it("exposes the reason so a silent hide is debuggable", () => {
		expect(row).toContain(':data-stock-reason="lineStock.reason"');
	});

	it("draws the subtitle only when there is something to say", () => {
		expect(row).toContain('v-if="lineIdentity"');
	});

	it("feeds the tint from the profile, not a number of its own", () => {
		expect(row).toContain("posa_low_stock_alert_threshold");
	});

	it("keeps stock and identity in the v-memo deps", () => {
		// The row is `v-memo`'d. Without these a UOM change moves the figure
		// (it divides by conversion_factor) while the cell stays pinned to the
		// old one — a stale stock claim is exactly the failure this file exists
		// to prevent.
		const deps = /const memoDeps = computed\(\(\) => \{([\s\S]*?)\];/.exec(row)?.[1] ?? "";
		for (const dep of ["actual_qty", "_base_actual_qty", "conversion_factor", "item_group"]) {
			expect(deps).toContain(dep);
		}
	});

	it("spends no saturated fill on the line", () => {
		// §17.7 invariant 2: amber is state, and state is a tint on text.
		const styles = /<style scoped>([\s\S]*?)<\/style>/.exec(row)?.[1] ?? "";
		expect(styles).toMatch(/\.posa-cart-item-row__stock--low\s*\{[^}]*color:/);
		expect(styles).not.toMatch(/\.posa-cart-item-row__stock--low\s*\{[^}]*background/);
	});
});

describe("the artwork thumbnail on the line", () => {
	it("reserves the slot unconditionally and draws the photo inside it", () => {
		// The slot div carries no v-if; only the <img> does. Rows with and
		// without photos share one table, and a collapsing slot would ripple
		// every name to a different x per line.
		expect(row).toMatch(/class="posa-cart-item-row__thumb"[^>]*aria-hidden="true"/);
		expect(row).toMatch(/v-if="lineThumbSrc"/);
	});

	it("walks the catalogue card's degradation chain: thumb, photo, nothing", () => {
		// Same order as ItemCard.vue — the server's 300px `posa_image_thumb`
		// first, the full-size photo second. Both already ride the line
		// (`getNewItem` spreads the search row); nothing is fetched.
		expect(row).toMatch(/posa_image_thumb[\s\S]{0,80}props\.item\.image/);
	});

	it("knocks a broken src out rather than showing the broken-image glyph", () => {
		expect(row).toContain('@error="onThumbError"');
		expect(row).toMatch(/failedThumbSrcs/);
	});

	it("keeps the resolved src in the v-memo deps", () => {
		// Without it a late-arriving or newly-broken picture stays pinned.
		const deps = /const memoDeps = computed\(\(\) => \{([\s\S]*?)\];/.exec(row)?.[1] ?? "";
		expect(deps).toContain("lineThumbSrc.value");
	});

	it("letterboxes, never crops, on the muted surface token", () => {
		// `object-fit: contain` is the catalogue card's call — a 32px crop of
		// a phone case is a different-looking product. The empty box follows
		// the theme through the token, not a literal.
		const styles = /<style scoped>([\s\S]*?)<\/style>/.exec(row)?.[1] ?? "";
		expect(styles).toMatch(/\.posa-cart-item-row__thumb-img\s*\{[^}]*object-fit: contain/);
		expect(styles).toMatch(/\.posa-cart-item-row__thumb\s*\{[^}]*var\(--pos-surface-muted/);
	});
});

describe("the stepper keeps the touch target it was given", () => {
	const css = read("../src/posapp/components/pos/invoice/items-table-styles.css");

	it("still carries the coarse-pointer rule", () => {
		// 32 x 44 rather than 44 x 44, deliberately: three 44px boxes plus gaps
		// need 148px and the Cantidad column is 120px, so square targets push
		// "+" out of its cell. Reordering the columns must not disturb this.
		expect(css).toMatch(/@media \(pointer: coarse\)/);
		expect(css).toMatch(/@media \(pointer: fine\)/);
	});
});
