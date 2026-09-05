<template>
	<div
		ref="tableContainer"
		data-perf-tag="cart-table"
		class="my-0 py-0 overflow-y-auto posa-items-table-container posa-responsive-table-container pos-themed-card"
		:style="containerStyles"
		:class="containerClasses"
		@dragover="onDragOverFromSelector($event)"
		@drop="onDropFromSelector($event)"
		@dragenter="onDragEnterFromSelector"
		@dragleave="onDragLeaveFromSelector"
	>
		<!--
			Phase 2: native <table> instead of Vuetify's <v-data-table-virtual>.
			The cart never holds more than ~15 rows; the virtual table's
			per-row dynamic CSS rules + deep watchers + scroll machinery
			are pure overhead on every cart edit. See 3-SIGMA.md §3.
		-->
		<table
			class="posa-cart-table posa-cart-table--native elevation-2 pos-themed-card"
			:class="[tableClasses, `density-${tableDensity}`]"
		>
			<thead v-if="showColumnHeaders" :class="`responsive-header container-${breakpoint}`">
				<tr>
					<!-- The header reads its alignment from the SAME column object
					     the cell does (`cartColumnAlign.ts`). It used to read
					     nothing at all: `.posa-cart-table th` centres every
					     header, so `Stock` sat centred over a right-aligned
					     figure. Never restate an alignment here. -->
					<!-- The px width comes from the measured budget in
					     `useItemsTableResponsive.ts`, not from the stylesheet.
					     Under `table-layout: fixed` the FIRST row decides every
					     column, so one honest set of numbers on the header row
					     settles the whole table; the percentages in
					     `items-table-styles.css` stay as the fallback for the
					     one case with no header row (breakpoint-xs, where the
					     rows are grid cards and column widths are moot). -->
					<th
						v-for="column in finalVisibleColumns"
						:key="(column as any).key || (column as any).value || column.title"
						class="posa-cart-th"
						:class="[(column as any).cellClass || null, cartAlignClass(column)]"
						:style="cartColumnStyle(column)"
						:data-column-key="(column as any).key || (column as any).value"
						:data-column-align="(column as any).align"
						:title="column.title || undefined"
					>
						<span class="posa-cart-th__label">{{ column.title }}</span>
					</th>
				</tr>
			</thead>
			<tbody>
				<!--
					An empty ticket says that it is empty, and nothing else.

					What stood here was a 78 px illustration inside a 140 px
					panel — some 270 px of cart — over the line "add items from
					the selector to start building this sale". Both halves were
					wrong by 2026-08-22. There is no selector: the catalogue is
					a drawer, opened from the rail, from the chord, or from the
					"Explorar catálogo" button that sits in the scan bar
					directly above this table (`#register-scan-bar`,
					`shell/Pos.vue`). Copy naming a control that no longer
					exists is worse than silence — it sends the cashier hunting
					for a panel that will never appear.

					`Main.dc.html` is SILENT here rather than opposed: it never
					draws an empty cart, so it rules on this region's density
					and not on whether it speaks. The choice is ours, and it is
					one descriptive line — not one instructional line.

					Descriptive on purpose. The control an instruction would
					name is already on screen, with its resolved chord chip, a
					few pixels above this table on every viewport of the sale
					screen; saying it a third time is the "everything twice"
					defect in miniature. It is also the half that rots — this
					copy needed fixing precisely BECAUSE it named a control,
					while "No items in cart" would have come through the whole
					redesign untouched.

					What nothing else on the screen says is the state itself.
					Zero rows is ambiguous — empty ticket, failed render, or a
					cart search that hid every line — and the filtered case is
					the dangerous one: read as an empty ticket, a cashier
					re-rings a sale on top of six lines they cannot see. One
					line separates the three, gives a screen reader something
					to announce where zero rows announce nothing, and spends no
					accent (§1 invariant 2 — the accent is the band's).
				-->
				<tr v-if="!visibleItems.length" class="posa-cart-empty-row">
					<td :colspan="finalVisibleColumns.length">
						<p class="posa-cart-empty-note" data-testid="cart-empty-note">
							{{ emptyStateTitle }}
						</p>
					</td>
				</tr>
				<template v-for="item in visibleItems" :key="item.posa_row_id">
					<!-- A combo is several items sold as one, so it gets one row
					     that says so (§17.6, promoted into Scan Retail and
					     Repair+Retail). ComboCartLine is a flex row, not a
					     <tr> — a bare <div> inside <tbody> is hoisted out of
					     the table by the parser, so it is wrapped in a spanning
					     cell. The colspan tracks the visible column count
					     because the profile decides how many there are.

					     A partially-returned combo is deliberately NOT drawn
					     this way: `comboReturns` marks it `broken` precisely
					     because "COMBO · 3" beside two surviving components is
					     a lie about what the customer still has. It falls
					     through to the ordinary row. -->
					<tr v-if="isComboLine(item)" class="posa-cart-combo-row">
						<td :colspan="finalVisibleColumns.length || 1" class="pa-0">
							<ComboCartLine
								:line="comboLineFor(item)"
								:format-currency="memoizedFormatCurrency"
								@remove="removeItem(item)"
							/>
						</td>
					</tr>
					<CartItemRow
						v-else
						:item="item"
						:visible-columns="finalVisibleColumns"
						:posProfile="pos_profile"
						:isReturnInvoice="isReturnInvoice"
						:invoiceType="invoiceType"
						:displayCurrency="displayCurrency"
						:formatFloat="memoizedFormatFloat"
						:formatCurrency="memoizedFormatCurrency"
						:currencySymbol="currencySymbol"
						:isNumber="isNumber"
						:isNegative="memoizedIsNegative"
						:hideQtyDecimals="hide_qty_decimals"
						:isRTL="isRtl"
						:is-expanded="isItemExpanded(item.posa_row_id)"
						@update-qty="handleQtyUpdate"
						@update-line-note="handleLineNoteUpdate"
						@update-line-meta="handleLineMetaUpdate"
						@qty-edit-submitted="handleQtyEditSubmitted"
						@minus-click="handleMinusClick"
						@add-one="addOne"
						@calc-uom="calcUom"
						@update-rate="handleRateUpdate"
						@update-discount-percent="handleDiscountPercentUpdate"
						@discount-percent-edit-submitted="handleDiscountEditSubmitted"
						@update-discount-amount="handleDiscountAmountUpdate"
						@open-name-dialog="openNameDialog"
						@reset-item-name="resetItemName"
						@toggle-offer="toggleOffer"
						@toggle-expand="toggleExpanded(item.posa_row_id)"
						@remove-item="removeItem"
						@click="toggleExpanded(item.posa_row_id)"
					/>
				</template>
			</tbody>
		</table>

		<!-- Item detail — a bounded, scrollable dialog. Replaces the inline
			 expanded <tr>, whose ~800px panel could not scroll inside the
			 table/flex chain and painted over the header. v-dialog teleports to
			 body, so `scrollable` gives a reliable viewport-bounded scroller. -->
		<v-dialog v-model="detailDialogOpen" v-bind="detailDialogProps" scrollable>
			<v-card v-if="detailItem" class="posa-item-detail-dialog">
				<v-card-title class="d-flex align-center pa-3 bg-primary text-white">
					<v-icon class="mr-2">mdi-information-outline</v-icon>
					<span class="text-truncate">{{ detailItem.item_name || detailItem.item_code }}</span>
					<v-spacer />
					<v-btn icon="mdi-close" variant="text" density="comfortable" @click="detailDialogOpen = false" />
				</v-card-title>
				<v-divider />
				<v-card-text class="pa-3">
					<ItemsTableExpandedRow
						:item="detailItem"
						:pos_profile="pos_profile"
						:invoice-type="invoiceType"
						:is-return-invoice="isReturnInvoice"
						:invoice_doc="invoice_doc"
						:hide_qty_decimals="hide_qty_decimals"
						:expanded-content-classes="expandedContentClasses"
						:format-float="memoizedFormatFloat"
						:format-currency="memoizedFormatCurrency"
						:currency-symbol="currencySymbol"
						:is-number="isNumber"
						:set-formated-currency="setFormatedCurrency"
						:calc-prices="calcPrices"
						:calc-uom="calcUom"
						:change-price-list-rate="changePriceListRate"
						:validate-due-date="validateDueDate"
						@qty-change="handleQtyChange"
						@request-close="detailDialogOpen = false"
					/>
				</v-card-text>
			</v-card>
		</v-dialog>

		<!-- Edit name dialog -->
		<v-dialog v-model="editNameDialog" max-width="400">
			<v-card>
				<v-card-title>{{ __("Item Name") }}</v-card-title>
				<v-card-text>
					<v-text-field v-model="editedName" :maxlength="140" />
				</v-card-text>
				<v-card-actions>
					<v-btn
						v-if="editNameTarget && editNameTarget.name_overridden"
						variant="text"
						@click="resetItemName(editNameTarget)"
						>{{ __("Reset") }}</v-btn
					>
					<v-spacer></v-spacer>
					<v-btn variant="text" @click="editNameDialog = false">{{ __("Cancel") }}</v-btn>
					<v-btn color="primary" variant="text" @click="saveItemName">{{ __("Save") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch, getCurrentInstance } from "vue";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { loadItemSelectorSettings } from "../../../utils/itemSelectorSettings";
import { logComponentRender } from "../../../utils/perf";
import CartItemRow from "./CartItemRow.vue";
import ComboCartLine from "../combos/ComboCartLine.vue";
import ItemsTableExpandedRow from "./ItemsTableExpandedRow.vue";

import { cartAlignClass, resolveCartColumnAlign } from "./cartColumnAlign";

import { useItemsTableSearch } from "../../../composables/pos/items/useItemsTableSearch";
import { useItemsTableDragDrop } from "../../../composables/pos/items/useItemsTableDragDrop";
import {
	CART_STRUCTURAL_COLUMNS,
	DATA_TABLE_EXPAND_COLUMN,
	planCartColumnWidths,
	planCartColumns,
	shouldShowColumnHeaders,
	useItemsTableResponsive,
} from "../../../composables/pos/items/useItemsTableResponsive";
import { useItemsTableMerge } from "../../../composables/pos/items/useItemsTableMerge";
import { useItemsTableNameEdit } from "../../../composables/pos/items/useItemsTableNameEdit";
import { useFormatters } from "../../../composables/core/useFormatters";
import { useRtl } from "../../../composables/core/useRtl";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import {
	focusCartItemField,
	type CartFieldFocusOptions,
	type CartShortcutField,
} from "../../../utils/cartFieldFocus";
import "./items-table-styles.css";

// Global declarations for Frappe
declare const __: (_str: string, _args?: any[]) => string;

interface Props {
	headers?: any[];
	expanded?: any[];
	itemsPerPage?: number;
	itemSearch?: string;
	pos_profile?: any;
	invoiceType?: string;
	stock_settings?: any;
	displayCurrency?: string;
	formatFloat: (_value: number, _precision?: number | string) => string;
	formatCurrency: (_value: number, _precision?: number | string) => string;
	currencySymbol: (_currency?: string) => string;
	isNumber: (_value: any) => boolean;
	setFormatedQty: (_item: any, _field: string, _value: any, _force?: boolean, _event?: any) => void;
	setFormatedCurrency: (_item: any, _field: string, _value: any, _force?: boolean, _event?: any) => void;
	calcPrices: (_item: any, _value: any, _event?: any) => void;
	calcUom: (_item: any, _uom: string) => void;
	setSerialNo: (_item: any) => void;
	setBatchQty: (_item: any, _event: any) => void;
	validateDueDate: (_item: any) => void;
	removeItem: (_item: any) => void;
	subtractOne: (_item: any) => void;
	addOne: (_item: any) => void;
	isReturnInvoice?: boolean;
	toggleOffer: (_item: any) => void;
	changePriceListRate: (_item: any) => void;
	isNegative: (_value: any) => boolean;
}

const props = withDefaults(defineProps<Props>(), {
	headers: () => [],
	expanded: () => [],
	isReturnInvoice: false,
});

const emit = defineEmits<{
	"update:expanded": [val: any[]];
	"show-drop-feedback": [val: boolean];
	"item-dropped": [val: boolean];
}>();

const { proxy } = getCurrentInstance() as any;
const eventBus = proxy?.eventBus;
const invoiceStore = useInvoiceStore();
const tableContainer = ref<HTMLElement | null>(null);

// Composables
const { customItemFilter } = useItemsTableSearch();
const dragDropHandlers = useItemsTableDragDrop(emit, eventBus);
const { isRtl } = useRtl();
const { memoizedFormatFloat, memoizedFormatCurrency, clearFormatCache } = useFormatters({
	formatFloat: props.formatFloat,
	formatCurrency: props.formatCurrency,
});

/**
 * Is this cart line a combo?
 *
 * The marker is `posa_combo_components` — a non-empty component list on the
 * invoice item, following the `posa_` prefix every POS-owned field on this
 * doctype already uses. A line without it is an ordinary item and renders the
 * ordinary row, which is every line in the product today.
 *
 * ⚠ NOTHING POPULATES THIS FIELD YET. Wave 1 built the combo arithmetic
 * (`comboPricing`, `comboReturns`, `comboCatalog`) and the row component; the
 * add-to-cart path that attaches a bundle's components to the line it creates
 * is not built, and it does not live in this file. So this predicate is
 * currently false for every line — the render path is proven by tests, not by
 * traffic. See the report accompanying this change.
 */
const isComboLine = (item: any): boolean =>
	Array.isArray(item?.posa_combo_components) &&
	item.posa_combo_components.length > 0 &&
	!item?.posa_combo_broken;

/** Shape the invoice item into the line `ComboCartLine` declares. */
const comboLineFor = (item: any) => ({
	item_code: String(item?.item_code ?? ""),
	item_name: String(item?.item_name ?? item?.item_code ?? ""),
	qty: Number(item?.qty) || 0,
	rate: Number(item?.rate) || 0,
	image: item?.image ?? null,
	components: item?.posa_combo_components ?? [],
});

const responsive = useItemsTableResponsive(
	tableContainer,
	computed(() => props.headers || []),
);
const merge = useItemsTableMerge(computed(() => invoiceStore.items));
const nameEdit = useItemsTableNameEdit();

// Computed
const items = computed(() => invoiceStore.items);
const invoice_doc = computed(() => invoiceStore.invoiceDoc || {});
const hasItemSearch = computed(() => !!props.itemSearch?.trim());
const visibleItems = computed(() => {
	const list = items.value || [];
	const term = props.itemSearch?.trim();
	if (!term) return list;
	return list.filter((row: any) => customItemFilter(row, term, row));
});
// The empty cart's whole vocabulary: which of the two states it is in. Both
// strings already ship translated; the instructional third one was retired
// with the illustration (see the note on the empty row). `hasItemSearch` is
// the only distinction worth drawing here, and it is the one that matters —
// "no matching" tells the cashier a filter is on, which "no items" would hide.
const emptyStateTitle = computed(() =>
	hasItemSearch.value ? __("No matching items in cart") : __("No items in cart"),
);

const memoizedIsNegative = computed(() => {
	return (value: any) => {
		if (typeof value === "number") return value < 0;
		return props.isNegative(value);
	};
});

const {
	breakpoint,
	containerWidth,
	responsiveHeaders,
	containerStyles,
	containerClasses,
	tableClasses,
	expandedContentClasses,
	tableDensity,
} = responsive;

/**
 * Which columns the cart's measured width can afford, and how wide each one is.
 *
 * Planned from `props.headers` — the operator's registry — plus the two columns
 * this component injects itself (`stock`, the expander). The plan has to see
 * the full set or it budgets a table 124px narrower than the one that renders,
 * which is how the name ended up with 5% of the row (see the block comment in
 * `useItemsTableResponsive.ts`).
 */
const cartColumnPlan = computed(() =>
	planCartColumns(
		[...(props.headers || []).map((header: any) => header?.key), ...CART_STRUCTURAL_COLUMNS],
		containerWidth.value,
	),
);

const cartColumnWidths = computed(() =>
	planCartColumnWidths(cartColumnPlan.value.visible, containerWidth.value),
);

/**
 * The header cell's own width. Absent (width 0, before the observer's first
 * report) the stylesheet's percentages take over rather than a guessed number.
 */
const cartColumnStyle = (column: any) => {
	const width = cartColumnWidths.value[column?.key || column?.value];
	return width ? { width: `${width}px` } : undefined;
};

/**
 * The cart's column anatomy, from `Main.dc.html` nodes 32–36:
 *
 *     Cant | Descripción | Existencia | Precio u. | Importe
 *
 * Two things happen here that do not happen in `available_columns`, and both
 * belong to the TABLE rather than to the operator's column preferences.
 *
 * ORDER. Quantity comes first. It is the most-touched control on the row — a
 * `− 1 +` stepper the cashier reaches for on most lines — and it sat third,
 * behind the name. The operator chooses WHICH optional columns appear
 * (`useInvoiceItems.available_columns`, persisted to localStorage); the
 * artboard chooses the order they appear in, and a saved preference from
 * before this change must not pin the old sequence. So the order is applied
 * here, over whatever set survives the responsive filter.
 *
 * STOCK. `Existencia` is injected rather than registered, the same way
 * `DATA_TABLE_EXPAND_COLUMN` is: it is structural, not optional. Registering
 * it in `available_columns` would make it hideable and would also mean every
 * register that has already saved a preference never sees it, since the saved
 * list is a closed set of keys. If it should become hideable, the entry
 * belongs in `useInvoiceItems.ts` — reported, not assumed.
 */
const CART_COLUMN_ORDER = [
	"qty",
	"item_name",
	"uom",
	"stock",
	"price_list_rate",
	"discount_percentage",
	"discount_amount",
	"rate",
	"amount",
	"posa_is_offer",
	"actions",
];

// Plain numbers, deliberately. A `max()` expression here is silently dropped
// under the table's fixed layout and every column collapses to equal width.
// The px figures are the budget's, so the column object and the header cell
// cannot disagree (`CART_COLUMN_MIN_WIDTH.stock`).
const STOCK_COLUMN = {
	title: __("Stock"),
	key: "stock",
	align: "end" as const,
	required: true,
	sortable: false,
	width: 104,
	minWidth: 84,
};

const finalVisibleColumns = computed(() => {
	const columns = [...responsiveHeaders.value];

	// Only alongside the description — at the narrowest breakpoints the
	// responsive filter drops down to a couple of columns, and a stock figure
	// beside nothing to identify it by is noise. And only while the width
	// budget can still pay for it: `stock` is the last entry in the collapse
	// order, so a cart narrow enough to drop it has already given up the
	// discount columns.
	const hasName = columns.some((column: any) => (column?.key || column?.value) === "item_name");
	const affordsStock = cartColumnPlan.value.visible.includes("stock");
	if (
		hasName &&
		affordsStock &&
		!columns.some((column: any) => (column?.key || column?.value) === "stock")
	) {
		columns.push(STOCK_COLUMN);
	}

	const rank = (column: any) => {
		const index = CART_COLUMN_ORDER.indexOf(column?.key || column?.value);
		// An unrecognised column keeps its relative place at the end rather
		// than jumping to the front, which is what index -1 would sort to.
		return index === -1 ? CART_COLUMN_ORDER.length : index;
	};
	columns.sort((a: any, b: any) => rank(a) - rank(b));

	// ALIGNMENT, applied here for the same reason ORDER is: the operator's
	// registry says WHICH columns exist, the artboard says how the table draws
	// the set that survives. Resolved onto a COPY — `DATA_TABLE_EXPAND_COLUMN`
	// is a shared module-level const and mutating it would leak into every
	// other consumer. From here on `column.align` is the single answer that the
	// header, the cell and the cell's inner flex box all read.
	return [...columns, DATA_TABLE_EXPAND_COLUMN].map((column: any) => ({
		...column,
		align: resolveCartColumnAlign(column),
	}));
});

const showColumnHeaders = computed(() =>
	shouldShowColumnHeaders(visibleItems.value.length, breakpoint.value),
);

const hide_qty_decimals = computed(() => {
	const opts = loadItemSelectorSettings();
	return !!opts?.hide_qty_decimals;
});

// Watchers
watch(() => props.displayCurrency, clearFormatCache);
// Drop deep:true — clear format cache only on profile reassignment.
watch(() => props.pos_profile, clearFormatCache);

// Methods
const getSerialOptions = (item: any) => {
	if (Array.isArray(item?.filtered_serial_no_data)) {
		return item.filtered_serial_no_data;
	}
	return Array.isArray(item?.serial_no_data) ? item.serial_no_data : [];
};

const toggleExpanded = (rowId: any) => {
	const current = Array.isArray(props.expanded) ? props.expanded : [];
	// Single-select: the detail is now a dialog, so only one item is open at a
	// time. Clicking the already-open row closes it.
	emit("update:expanded", current.includes(rowId) ? [] : [rowId]);
};

// The item whose detail dialog is currently open (driven by `expanded`).
const detailItem = computed(() => {
	const ids = Array.isArray(props.expanded) ? props.expanded : [];
	if (!ids.length) return null;
	return visibleItems.value.find((i: any) => ids.includes(i.posa_row_id)) || null;
});
const detailDialogOpen = computed({
	get: () => !!detailItem.value,
	set: (open: boolean) => {
		if (!open) emit("update:expanded", []);
	},
});
// The detail sheet is the phone's only route to serial/batch/rate editing,
// so under sm it takes the viewport rather than an 820px card cropped to it.
const { dialogProps: detailDialogProps } = useDialogFullscreen({ maxWidth: 820 });

const handleQtyChange = (item: any, event: any) => {
	const newQty = parseFloat(event.target.value) || 0;
	if (newQty === 0) {
		props.removeItem(item);
	} else {
		props.setFormatedQty(item, "qty", null, false, event.target.value);
	}
	eventBus?.emit("recalculate_return_discount", { defer: true });
};

const handleMinusClick = (item: any) => {
	// Replacement rows should still be removed directly.
	if (item.posa_is_replace) {
		props.removeItem(item);
		return;
	}

	// magnitude-based removal: only remove if qty magnitude <= 1
	// This handles -1 for returns and 1 for normal invoices correctly
	const absQty = Math.abs(item.qty || 0);
	if (absQty <= 1) {
		props.removeItem(item);
	} else {
		// subtract_one handles the sign-aware logic (e.g. -5 -> -4 in returns)
		props.subtractOne(item);
	}
	eventBus?.emit("recalculate_return_discount", { defer: true });
};

const handleQtyUpdate = (item: any, newQty: any) => {
	props.setFormatedQty(item, "qty", null, false, newQty);
	eventBus?.emit("recalculate_return_discount", { defer: true });
};

/**
 * The weighing pad's provenance line («Weighed 0.475 kg · gross 0.495 · tare
 * 0.020»). Written straight onto the row rather than through a dialog: it is a
 * record of where a number came from, and a prompt asking the operator to
 * confirm it would only teach them to dismiss it.
 */
const handleLineNoteUpdate = (item: any, note: string) => {
	const index = getItemIndex(item);
	const row = index < 0 ? null : items.value[index];
	if (!row) return;
	row.posa_notes = note;
};

// Mesa line attributes (critique B4): course and seat land the same way a
// note does — straight onto the reactive row, and the floor's cart-sync
// debounce carries them to the table order.
const handleLineMetaUpdate = (item: any, patch: Record<string, unknown>) => {
	const index = getItemIndex(item);
	const row = index < 0 ? null : items.value[index];
	if (!row) return;
	Object.assign(row, patch);
};

const getItemIndex = (item: any) => {
	if (!item) {
		return -1;
	}
	const rowId = item?.posa_row_id;
	if (rowId) {
		return items.value.findIndex((row: any) => row?.posa_row_id === rowId);
	}
	return items.value.findIndex((row: any) => row === item);
};

const handleQtyEditSubmitted = (item: any) => {
	window.setTimeout(() => {
		const index = getItemIndex(item);
		if (index >= 0 && focusItemField(index, "discount_percentage", { activate: false })) {
			return;
		}
		eventBus?.emit("focus_item_search");
	}, 0);
};

const handleDiscountEditSubmitted = () => {
	window.setTimeout(() => {
		eventBus?.emit("focus_item_search");
	}, 0);
};

const handleRateUpdate = (item: any, newRate: any) => {
	props.setFormatedCurrency(item, "rate", null, false, { target: { value: newRate } });
	props.calcPrices(item, newRate, { target: { id: "rate" } });
};

const handleDiscountPercentUpdate = (item: any, newDiscount: any) => {
	props.setFormatedCurrency(item, "discount_percentage", null, false, {
		target: { value: newDiscount },
	});
	props.calcPrices(item, newDiscount, { target: { id: "discount_percentage" } });
};

const handleDiscountAmountUpdate = (item: any, newDiscount: any) => {
	props.setFormatedCurrency(item, "discount_amount", null, false, {
		target: { value: newDiscount },
	});
	props.calcPrices(item, newDiscount, { target: { id: "discount_amount" } });
};

const focusItemField = (index: number, field: CartShortcutField, options?: CartFieldFocusOptions) => {
	return focusCartItemField(tableContainer.value, index, field, options);
};

const isItemExpanded = (itemId: any) => {
	return props.expanded?.includes(itemId);
};

// Drag and Drop delegation
const onDragOverFromSelector = (event: DragEvent) => dragDropHandlers.onDragOverFromSelector(event);
const onDragEnterFromSelector = () => dragDropHandlers.onDragEnterFromSelector();
const onDragLeaveFromSelector = (event: DragEvent) => dragDropHandlers.onDragLeaveFromSelector(event);
const onDropFromSelector = (event: DragEvent) => dragDropHandlers.onDropFromSelector(event);

// Name editing logic
const { editNameDialog, editedName, editNameTarget, openNameDialog, saveItemName, resetItemName } = nameEdit;

// Life-cycle
onMounted(() => {
	logComponentRender({ $el: tableContainer.value }, "ItemsTable", "mounted", {
		rows: items.value?.length || 0,
	});
});

onBeforeUnmount(() => {
	merge.clearMergeCache();
});

defineExpose({
	focusItemField,
});
</script>

<style>
/* Global styles for ItemsTable and its children */
@import "./items-table-styles.css";
</style>

<style scoped>
/* Scoped styles for ItemsTable component specific logic */
.posa-items-table-container {
	position: relative;
	transition: all 0.3s ease;
}

/*
 * The empty ticket's one line.
 *
 * Scoped and named apart from the retired `.posa-cart-empty-state*` rules
 * rather than overriding them: those live in `items-table-styles.css`, which
 * this task does not own, and an override chain that has to out-specify a
 * 140 px `min-height` is the kind of thing a later cleanup deletes the wrong
 * half of. The row keeps `.posa-cart-empty-row`, which is still correct — it
 * zeroes the cell padding, and at the xs breakpoint it opts the row out of
 * the card grid the other rows become.
 *
 * No `min-height`, no `height`, no flex, no `overflow`. The cart is the
 * register's only scrollport and its single elastic sibling (59c5fe1ad); this
 * is content INSIDE that scrollport, so it must not declare a size of its own.
 * Roughly 40 px against the illustration's ~270 px, and the difference is
 * given back to the scrollport rather than spent on a gap.
 *
 * Muted secondary text, no background, no icon, no accent: it is a statement
 * about the ticket, not a thing to look at.
 */
.posa-cart-empty-note {
	margin: 0;
	padding: 10px 12px;
	text-align: center;
	font-size: 0.85rem;
	line-height: 1.4;
	color: var(--pos-text-secondary);
}
</style>
