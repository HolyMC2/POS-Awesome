/**
 * WHERE A CART COLUMN POINTS — one answer, read by the header and the cell.
 *
 * ## The defect this exists to make impossible
 *
 * The `Stock` header sat centred over a right-aligned figure. The obvious
 * explanation — "the column declares `align: end` and the header ignores it" —
 * is only half of it, and the missing half is the part that matters:
 *
 *   1. The HEADER never read `align` at all. `.posa-cart-table th` in
 *      `items-table-styles.css` centres every header unconditionally, so the
 *      `align` on a column object was decoration on both sides of the table.
 *   2. The CELLS never read it either. Each `<td>` in `CartItemRow.vue`
 *      restated its own alignment as a literal `class="text-…"`, and three of
 *      them already disagreed with the column that declared them
 *      (`discount_percentage`, `discount_amount` — declared `end`, drawn
 *      centred).
 *   3. Worse, the money cells wrap their content in a flex box whose class is
 *      literally named `right-aligned` and whose rule was
 *      `justify-content: center`. So `price_list_rate` carried `text-end` on
 *      the cell AND centred its figure. `stock` looked like the odd one out
 *      only because a bare `<span>` is the one thing in this table that
 *      actually honours the cell's `text-align`.
 *
 * Restating an alignment in three places is how three places drift. The column
 * object is now the ONLY place a cart column says where it points; the header,
 * the cell and the cell's inner flex box all read it from there.
 *
 * ## Which way the table reads, and why
 *
 * Right, for every figure. This is not a taste call — `Main.dc.html` nodes
 * 32–36 settle it, and §17.7 makes the canvas the reference of record:
 *
 *     Cant (center) | Descripción (left) | Existencia (right) | Precio u.
 *     (right) | Importe (right)
 *
 * with the values under them drawn `text-align: right` on every row. The
 * cheaper answer was to centre `Stock` to match `Rate` and `Amount` as they
 * shipped — but those two are centred against the artboard, so matching them
 * would have spread one column's defect across three. A cashier scans a column
 * of figures down; right-alignment lines the units up under each other, which
 * is the whole reason the artboard draws it that way.
 *
 * `QTY` is a `− 1 +` stepper and `Actions`/`Offer?`/the expander are controls:
 * they centre, because centring is where a control sits in its cell, not an
 * opinion about digits. `Name` is prose and starts.
 *
 * ## Why the contract lives here and not in `available_columns`
 *
 * Same reason `CART_COLUMN_ORDER` does, and the argument is already written
 * out in `ItemsTable.vue`: `useInvoiceItems.available_columns` is the
 * OPERATOR's registry — which optional columns a register shows, persisted to
 * localStorage. The artboard owns how the table draws the set that survives.
 * `available_columns` still carries stale `align` values (`rate` and `amount`
 * say `center`); they are now inert. Reconciling them is a one-line follow-up
 * in a file this task does not own — REPORTED, not done.
 */

export type CartColumnAlign = "start" | "center" | "end";

interface AlignableColumn {
	key?: unknown;
	value?: unknown;
	align?: unknown;
}

const VALID: readonly CartColumnAlign[] = ["start", "center", "end"];

/**
 * The artboard's answer, by column key. A key absent from this map falls back
 * to whatever the column itself declared, and finally to `center` — a custom
 * column added by a later vertical keeps its own opinion rather than being
 * silently reassigned.
 */
export const CART_COLUMN_ALIGN: Readonly<Record<string, CartColumnAlign>> = {
	item_name: "start",
	qty: "center",
	uom: "center",
	stock: "end",
	price_list_rate: "end",
	discount_percentage: "end",
	discount_amount: "end",
	rate: "end",
	amount: "end",
	posa_is_offer: "center",
	actions: "center",
	"data-table-expand": "center",
};

const columnKey = (column: AlignableColumn | null | undefined): string =>
	String(column?.key ?? column?.value ?? "");

/** Where this column points. Applied once, in `finalVisibleColumns`. */
export const resolveCartColumnAlign = (
	column: AlignableColumn | null | undefined,
): CartColumnAlign => {
	const fromContract = CART_COLUMN_ALIGN[columnKey(column)];
	if (fromContract) return fromContract;
	const declared = column?.align;
	return VALID.includes(declared as CartColumnAlign) ? (declared as CartColumnAlign) : "center";
};

/**
 * The `<th>`/`<td>` alignment class — Vuetify's utilities, which carry
 * `!important` and are therefore the one thing that beats the blanket
 * `text-align: center` on `.posa-cart-table th` and `td` in a stylesheet this
 * task does not own.
 *
 * The header and the cell call THIS, both passing the same column object. That
 * is the whole guarantee: they cannot disagree, because there is nothing left
 * for them to disagree about.
 */
export const cartAlignClass = (column: AlignableColumn | null | undefined): string =>
	`text-${resolveCartColumnAlign(column)}`;

/**
 * The same answer for a cell whose content is a FLEX box rather than inline
 * text — the money cells and the inline editors. `text-align` does not move a
 * flex child, which is exactly how `price_list_rate` came to carry `text-end`
 * on the cell and still centre its figure.
 */
export const cartJustifyClass = (column: AlignableColumn | null | undefined): string =>
	`posa-cart-cell--${resolveCartColumnAlign(column)}`;
