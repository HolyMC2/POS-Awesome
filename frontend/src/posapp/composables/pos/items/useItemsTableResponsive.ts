import { ref, computed, onMounted, onBeforeUnmount, type Ref } from "vue";
import * as _ from "lodash";

export interface TableHeader {
	title: string;
	key: string;
	required?: boolean;
	sortable?: boolean;
	align?: "start" | "center" | "end";
	width?: string | number;
	minWidth?: string | number;
	[key: string]: any;
}

export const DATA_TABLE_EXPAND_COLUMN: TableHeader = {
	title: "",
	key: "data-table-expand",
	sortable: false,
	align: "center",
	width: 48,
	minWidth: 48,
};

/**
 * THE CART'S WIDTH BUDGET — measured, not guessed.
 *
 * ## What was wrong
 *
 * The column widths ship as percentages in `items-table-styles.css`, and the
 * sized ones added up to 95%: qty 15 + price-list 13 + disc% 9 + disc-amt 13 +
 * rate 16 + amount 16 + actions 8 + expand 5. `item_name` and `stock` are
 * deliberately unsized (the elastic pair), so the two most important columns in
 * the ticket split the 5% that was left over. Measured on the cafetería demo at
 * 1718x1023 on 2026-08-23, drawer CLOSED, cart 1572px wide:
 *
 *     qty 235.6 · name 39.3 · stock 39.3 · price-list 204.2 · disc% 141.4
 *     · disc-amt 204.2 · rate 251.4 · amount 251.4 · actions 125.7 · expand 78.5
 *
 * 39.3px for a column whose own header text needs 50.5px — that is the "one
 * letter" name and the truncated «Tasa de List» / «Descuer» / «Accione» in one
 * arithmetic mistake. With the drawer anchored open (cart 1014px) the name fell
 * to 25.3px against a 47.6px header.
 *
 * ## What replaces it
 *
 * A budget, resolved in JS against the table's MEASURED box (ResizeObserver —
 * the cart's width follows the catalogue drawer, so the window is not a proxy)
 * and emitted as px widths on the `<th>` row. Under `table-layout: fixed` the
 * first row decides every column, so one honest set of numbers there settles
 * the whole table. The percentages stay in the stylesheet as the no-header
 * fallback and are re-balanced to leave the name real room.
 *
 * Two rules, in order:
 *
 * 1. NO COLUMN NARROWER THAN ITS OWN HEADER. `CART_COLUMN_MIN_WIDTH` is the
 *    floor: the wider of what the cell's content needs and what the header's
 *    longest WORD needs, plus the 4px gutters. A header that breaks mid-word
 *    reads as a rendering fault (the label clamps to two lines with
 *    `overflow-wrap: anywhere`, so a word wider than its column splits).
 * 2. THE NAME IS THE ELASTIC COLUMN. It takes whatever the sized columns leave.
 *    When that remainder falls under `CART_NAME_TARGET_WIDTH` the optional
 *    columns leave the row grid, cheapest first, until it does not — they are
 *    all still editable in the expanded row (`ItemsTableExpandedRow.vue` already
 *    carries price-list rate, discount %, discount amount, rate and amount), so
 *    collapsing costs reach, not access.
 *
 * NO `max()` ANYWHERE. Measured 2026-08-18 in the shipped browser: a cell given
 * `width: max(44px, 6%)` under `table-layout: fixed` resolves to NEITHER
 * operand and joins the equal-share pool. Plain px and plain % only.
 */

/** Floor per column, in px, gutters included. Anything not listed falls back. */
export const CART_COLUMN_MIN_WIDTH: Readonly<Record<string, number>> = {
	// Two 24px buttons + two 4px gaps + the 32px display + 3px inner padding
	// each side + the column's fixed 4px gutters.
	qty: 108,
	// Not a content measurement — a legibility one. See CART_NAME_MIN_WIDTH.
	item_name: 150,
	// «quedan 12» at 12.5px tabular, nowrap; header «Inventario» needs 59.
	stock: 84,
	// Two arrows plus a readable unit.
	uom: 76,
	// MX$ 12,345.00 in the pill (~96px measured) beats the header's longest
	// word («Precios», 45px).
	price_list_rate: 104,
	// Header word «Descuento» is 64px; the value «100.00%» is narrower.
	discount_percentage: 78,
	discount_amount: 104,
	rate: 104,
	amount: 108,
	posa_is_offer: 96,
	// 34px button + gutters would be 46 — but «Acciones» needs 54px of text.
	actions: 64,
	"data-table-expand": 40,
};

/** Where a column stops taking width it cannot use. */
export const CART_COLUMN_MAX_WIDTH: Readonly<Record<string, number>> = {
	qty: 132,
	stock: 104,
	uom: 96,
	price_list_rate: 132,
	discount_percentage: 96,
	discount_amount: 132,
	rate: 136,
	amount: 144,
	posa_is_offer: 116,
	actions: 72,
	"data-table-expand": 48,
};

const CART_COLUMN_MIN_WIDTH_FALLBACK = 88;

/**
 * The name's comfort width. The ladder below drops optional columns until the
 * name can have this much; it is a TARGET, not a guarantee, because the
 * required set alone (qty + rate + amount + actions + expand = 424px) leaves
 * less than this on a cart narrower than ~645px. Under 500px the table is not a
 * table at all — the PHONE CARD MODE block in `items-table-styles.css` reflows
 * each row into a 2-row grid card where the name gets a full line — so the band
 * where the name sits under its comfort width is 500-645px, and it still holds
 * ~13 characters per line across two clamped lines there.
 */
export const CART_NAME_TARGET_WIDTH = 220;

/** Below this the name stops being readable at all; it is never sized down to
 *  buy another column room. */
export const CART_NAME_MIN_WIDTH = 150;

/**
 * Columns the row grid keeps at every width. The expand chevron is on this list
 * on purpose: at narrow widths the discount and price-list fields move INTO the
 * expanded editor, so the control that opens it matters more there, not less.
 */
export const CART_REQUIRED_COLUMNS: readonly string[] = [
	"item_name",
	"qty",
	"rate",
	"amount",
	"actions",
	"data-table-expand",
];

/**
 * The order optional columns leave the row grid as the cart narrows — cheapest
 * first. `posa_is_offer` is a button that repeats what the line's chip already
 * says; the two discount columns and the price-list rate are the artboard's
 * "collapse into the expanded row editor" set; `uom` and `stock` go last
 * because they change what the cashier is selling rather than what it costs.
 */
export const CART_COLUMN_COLLAPSE_ORDER: readonly string[] = [
	"posa_is_offer",
	"discount_amount",
	"discount_percentage",
	"price_list_rate",
	"uom",
	"stock",
];

/**
 * Columns this table injects itself rather than reading from the operator's
 * registry (`useInvoiceItems.available_columns`): `stock` is pushed in
 * `ItemsTable.finalVisibleColumns`, the expander is appended from
 * `DATA_TABLE_EXPAND_COLUMN`. The budget has to know about both or it plans a
 * table that is 124px wider than the one that renders.
 */
export const CART_STRUCTURAL_COLUMNS: readonly string[] = ["stock", "data-table-expand"];

const minWidthOf = (key: string) => CART_COLUMN_MIN_WIDTH[key] ?? CART_COLUMN_MIN_WIDTH_FALLBACK;
const maxWidthOf = (key: string) => CART_COLUMN_MAX_WIDTH[key] ?? minWidthOf(key);

/**
 * What the columns may actually add up to.
 *
 * 2px of slack: the header cells carry a 1px right border, and a fixed layout
 * that adds up to exactly the box rounds into a horizontal scrollbar. Both the
 * collapse decision and the width plan spend from THIS number — planning
 * against the raw width and sizing against the trimmed one is how a column set
 * gets kept on the promise of 220px and then handed 218.
 */
const usableWidth = (width: number) => Math.floor(width) - 2;

/**
 * Which columns survive at this measured width, and which collapse into the
 * expanded row editor.
 *
 * `keys` must be the FULL set the table would draw, structural columns
 * included. A width of 0 (jsdom, or the frame before the observer reports)
 * collapses nothing — guessing narrow and snapping wide is worse than one
 * honest frame.
 */
export function planCartColumns(
	keys: readonly string[],
	width: number,
): { visible: string[]; collapsed: string[] } {
	const present = keys.filter((key): key is string => typeof key === "string" && !!key);
	const budget = usableWidth(width);
	if (!(budget > 0)) return { visible: [...present], collapsed: [] };

	const nameRoom = (kept: string[]) =>
		budget -
		kept.reduce((total, key) => (key === "item_name" ? total : total + minWidthOf(key)), 0);

	const kept = [...present];
	const collapsed: string[] = [];
	for (const key of CART_COLUMN_COLLAPSE_ORDER) {
		if (nameRoom(kept) >= CART_NAME_TARGET_WIDTH) break;
		const index = kept.indexOf(key);
		if (index === -1) continue;
		kept.splice(index, 1);
		collapsed.push(key);
	}

	return { visible: kept, collapsed };
}

/**
 * The px width of every surviving column, summing to no more than the measured
 * box so the table never scrolls sideways inside the cart.
 *
 * Every column starts at its floor; the surplus over the name's target is then
 * shared out toward the per-column ceilings, and whatever is still left goes to
 * the name. That ordering is the whole point: the money columns can only grow
 * with width the name did not need, never with width it did.
 */
export function planCartColumnWidths(
	keys: readonly string[],
	width: number,
): Record<string, number> {
	const widths: Record<string, number> = {};
	const budget = usableWidth(width);
	if (!(budget > 0)) return widths;

	const present = keys.filter((key): key is string => typeof key === "string" && !!key);
	const sized = present.filter((key) => key !== "item_name");

	let used = 0;
	for (const key of sized) {
		widths[key] = minWidthOf(key);
		used += widths[key] as number;
	}

	const spare = budget - used - CART_NAME_TARGET_WIDTH;
	if (spare > 0) {
		const room = sized.map((key) => Math.max(0, maxWidthOf(key) - (widths[key] as number)));
		const total = room.reduce((sum, value) => sum + value, 0);
		if (total > 0) {
			const share = Math.min(1, spare / total);
			sized.forEach((key, index) => {
				const add = Math.floor((room[index] as number) * share);
				widths[key] = (widths[key] as number) + add;
				used += add;
			});
		}
	}

	if (present.includes("item_name")) {
		widths.item_name = Math.max(0, budget - used);
	}

	return widths;
}

export function getResponsiveVisibleHeaders(headers: TableHeader[], width: number) {
	const candidateKeys = [
		...headers.map((header) => header.key),
		...CART_STRUCTURAL_COLUMNS,
	];
	const { visible } = planCartColumns(candidateKeys, width);
	const survives = new Set(visible);
	const widths = planCartColumnWidths(visible, width);

	return headers
		.filter((header) => CART_REQUIRED_COLUMNS.includes(header.key) || survives.has(header.key))
		.map((header) => ({
			...header,
			width: widths[header.key] ?? minWidthOf(header.key),
			minWidth: minWidthOf(header.key),
		}));
}

/**
 * Whether the cart table should render its header row.
 *
 * At breakpoint-xs the rows render as 2-row grid cards (see the
 * PHONE CARD MODE block in items-table-styles.css), so there are no
 * columns for a header to label — filled or empty, the header row is
 * dead weight there. On an empty phone cart it was also what forced
 * the table wider than the panel (`table-layout: fixed` takes column
 * widths from the first row), pushing the empty-state block off the
 * visible width. Wider panels keep the header always.
 */
export function shouldShowColumnHeaders(_rowCount: number, breakpoint: string): boolean {
	return breakpoint !== "xs";
}

export function buildFinalVisibleColumns(
	headers: TableHeader[],
	width: number,
	options: { showExpand?: boolean } = {},
) {
	const visibleHeaders = getResponsiveVisibleHeaders(headers, width);

	if (options.showExpand === false) {
		return visibleHeaders;
	}

	return [...visibleHeaders, DATA_TABLE_EXPAND_COLUMN];
}

export function useItemsTableResponsive(
	containerRef: Ref<HTMLElement | null>,
	headers: Ref<TableHeader[]>,
) {
	const containerWidth = ref(0);
	const containerHeight = ref(0);
	const breakpoint = ref("xl");
	let resizeObserver: ResizeObserver | null = null;

	const updateBreakpoint = (width: number) => {
		if (width < 500) return "xs";
		if (width < 700) return "sm";
		if (width < 900) return "md";
		if (width < 1200) return "lg";
		return "xl";
	};

	const responsiveHeaders = computed(() => {
		const width = containerWidth.value;
		if (!headers.value || headers.value.length === 0) return [];

		return getResponsiveVisibleHeaders(headers.value, width);
	});

	const isColumnVisible = (key: string) => {
		return responsiveHeaders.value.some((h) => h.key === key);
	};

	const containerStyles = computed(() => ({
		height: "100%",
		maxHeight: "100%",
		minHeight: "0",
		"--container-width": containerWidth.value + "px",
		"--container-height": containerHeight.value + "px",
	}));

	const containerClasses = computed(() => ({
		[`breakpoint-${breakpoint.value}`]: true,
		"compact-view": containerWidth.value < 600,
		"medium-view":
			containerWidth.value >= 600 && containerWidth.value < 900,
		"large-view": containerWidth.value >= 900,
	}));

	const tableClasses = computed(() => ({
		[`container-${breakpoint.value}`]: true,
		"responsive-table": true,
	}));

	const expandedContentClasses = computed(() => ({
		[`expanded-${breakpoint.value}`]: true,
		"compact-expanded": containerWidth.value < 600,
	}));

	const tableDensity = computed(() => {
		if (containerWidth.value < 500) return "compact";
		if (containerWidth.value < 800) return "default";
		return "comfortable";
	});

	const setupResizeObserver = () => {
		if (typeof ResizeObserver !== "undefined" && containerRef.value) {
			const debouncedResizeHandler = _.debounce(
				(entries: ResizeObserverEntry[]) => {
					for (let entry of entries) {
						const { width, height } = entry.contentRect;
						if (
							containerWidth.value !== width ||
							containerHeight.value !== height
						) {
							containerWidth.value = width;
							containerHeight.value = height;
							breakpoint.value = updateBreakpoint(width);
						}
					}
				},
				100,
			);

			resizeObserver = new ResizeObserver(debouncedResizeHandler);
			resizeObserver.observe(containerRef.value);
			// Initial call
			const rect = containerRef.value.getBoundingClientRect();
			containerWidth.value = rect.width;
			containerHeight.value = rect.height;
			breakpoint.value = updateBreakpoint(rect.width);
		}
	};

	onMounted(() => {
		setupResizeObserver();
	});

	onBeforeUnmount(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	return {
		containerWidth,
		containerHeight,
		breakpoint,
		responsiveHeaders,
		isColumnVisible,
		containerStyles,
		containerClasses,
		tableClasses,
		expandedContentClasses,
		tableDensity,
	};
}
