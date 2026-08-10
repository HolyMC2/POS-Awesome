<template>
	<div ref="containerRef" class="items-table-container sleek-data-table">
		<div
			:class="['posa-catalog-header', { 'posa-catalog-header--compact': isCompact }]"
			:style="gridTemplateStyle"
			role="row"
		>
			<div
				v-for="column in visibleHeaders"
				:key="column.key"
				:class="['posa-catalog-header-cell', alignClass(column.align)]"
				role="columnheader"
			>
				{{ column.title }}
			</div>
		</div>
		<!-- First catalog load: rows are coming, so say "loading" rather
			 than "no items found" — the card view has always done this
			 (ItemsSelectorCards.vue), the list view never did. -->
		<div v-if="isLoading && !displayedItems.length" class="posa-catalog-loading">
			<Skeleton
				v-for="n in 8"
				:key="n"
				class="posa-catalog-loading__row"
				:height="rowHeight"
			/>
		</div>
		<div
			v-else-if="!displayedItems.length"
			class="posa-catalog-empty"
		>
			{{ noDataText || "No items match your search." }}
		</div>
		<RecycleScroller
			v-else
			ref="scrollerRef"
			class="posa-catalog-scroller"
			:items="displayedItems"
			key-field="item_code"
			:item-size="rowHeight"
			:buffer="200"
			:page-mode="false"
		>
			<template #default="{ item }">
				<CatalogItemRow
					:item="item"
					:columns="visibleHeaders"
					:compact="isCompact"
					:context="context"
					:pos-profile="posProfile"
					:selected-currency="selectedCurrency"
					:hide-qty-decimals="hideQtyDecimals"
					:show-rate-info="showRateInfo"
					:highlighted="rowHighlighted(item)"
					:row-class="rowClassFor(item)"
					:currency-symbol="currencySymbol"
					:format-currency="formatCurrency"
					:format-number="formatNumber"
					:rate-precision="ratePrecision"
					:get-item-rate-info="getItemRateInfo"
					:is-negative="isNegative"
					:style="{ height: rowHeight + 'px' }"
					@click="handleRowClick"
				/>
			</template>
		</RecycleScroller>
	</div>
</template>

<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from "vue";
import * as _ from "lodash";
import { RecycleScroller } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import CatalogItemRow from "./CatalogItemRow.vue";
import Skeleton from "../../ui/Skeleton.vue";
import {
	getResponsiveItemsTableHeaders,
	isCompactCatalogWidth,
} from "../../../utils/itemsTableHeaders";

const props = defineProps({
	displayedItems: { type: Array, default: () => [] },
	isLoading: { type: Boolean, default: false },
	headers: { type: Array, default: () => [] },
	// Kept for prop-shape compatibility with the previous
	// v-data-table-virtual implementation. Not used by the
	// RecycleScroller-based layout, but consumers (and the smoke spec)
	// may still pass it; ignoring it is a no-op.
	headerProps: { type: Object, default: () => ({}) },
	context: { type: String, default: "pos" },
	posProfile: { type: Object, default: () => ({}) },
	selectedCurrency: { type: String, default: "" },
	hideQtyDecimals: { type: Boolean, default: false },
	showRateInfo: { type: Boolean, default: true },
	currencySymbol: { type: Function, required: true },
	formatCurrency: { type: Function, required: true },
	formatNumber: { type: Function, required: true },
	ratePrecision: { type: Function, required: true },
	getItemRateInfo: { type: Function, required: true },
	isNegative: { type: Function, required: true },
	itemClass: { type: [String, Function], default: "" },
	rowProps: { type: [Object, Function], default: null },
	noDataText: { type: String, default: "" },
});

const emit = defineEmits(["row-click", "list-scroll"]);

// Fixed row height — chosen to accommodate the dual-line rate cell
// (primary currency line + optional secondary multi-currency line).
// Single-line rows pad to the same height for a uniform grid.
const rowHeight = computed(() => (props.posProfile?.posa_allow_multi_currency ? 72 : 56));

// The catalog lives in a resizable panel, not a viewport-width column:
// on a phone it is the whole screen, on desktop roughly half of it, and
// the operator can drag the divider. So the column set follows the
// measured container, the same way the cart table does.
const containerRef = ref(null);
const containerWidth = ref(0);
let containerObserver = null;

const visibleHeaders = computed(() =>
	getResponsiveItemsTableHeaders(props.headers, containerWidth.value),
);
const isCompact = computed(() => isCompactCatalogWidth(containerWidth.value));

const gridTemplateStyle = computed(() => ({
	gridTemplateColumns: visibleHeaders.value.map((c) => c.width || "1fr").join(" "),
}));

const alignClass = (align) => {
	if (align === "end") return "text-end";
	if (align === "center") return "text-center";
	return "text-start";
};

// `itemClass` may be a string or a function `(item) => string`. Mirror
// the Vuetify v-data-table API so callers (`getItemRowClass`) keep
// working without change.
const rowClassFor = (item) => {
	if (typeof props.itemClass === "function") return props.itemClass(item) || "";
	return props.itemClass || "";
};

// `rowProps` similarly is object or function. v-data-table emitted the
// returned object as element attributes; for highlight purposes the
// existing caller returns `{ class: "item-row-highlighted" }` for the
// keyboard-highlighted row. Detect that to flip `highlighted` on the
// child component (which has dedicated styles).
const rowHighlighted = (item) => {
	let resolved = props.rowProps;
	if (typeof resolved === "function") {
		try {
			resolved = resolved({ item });
		} catch {
			return false;
		}
	}
	if (!resolved || typeof resolved !== "object") return false;
	const cls = resolved.class;
	if (typeof cls === "string") return cls.includes("item-row-highlighted");
	if (Array.isArray(cls)) return cls.some((c) => typeof c === "string" && c.includes("item-row-highlighted"));
	return false;
};

const handleRowClick = (event, item) => {
	// Re-shape to the v-data-table-virtual payload `{ item }` so the
	// consumer's `click_item_row(e, data)` keeps reading
	// `data.item` without change.
	emit("row-click", event, { item });
};

const scrollerRef = ref(null);

let scrollTarget = null;
const onScroll = (event) => emit("list-scroll", event);

const attachScrollListener = () => {
	const el = scrollerRef.value?.$el;
	if (!el || el === scrollTarget) return;
	if (scrollTarget) scrollTarget.removeEventListener("scroll", onScroll);
	scrollTarget = el;
	scrollTarget.addEventListener("scroll", onScroll, { passive: true });
};

// Debounced like the cart's observer: every column change rebuilds the
// grid template and every row's cells, and a divider drag would otherwise
// do that on each animation frame.
const applyContainerWidth = _.debounce((entries) => {
	for (const entry of entries) {
		const { width } = entry.contentRect;
		if (containerWidth.value !== width) {
			containerWidth.value = width;
		}
	}
}, 100);

const observeContainerWidth = () => {
	const el = containerRef.value;
	if (!el) return;
	containerWidth.value = el.getBoundingClientRect().width;
	if (typeof ResizeObserver === "undefined") return;
	containerObserver = new ResizeObserver(applyContainerWidth);
	containerObserver.observe(el);
};

onMounted(() => {
	observeContainerWidth();
	nextTick(attachScrollListener);
});

onBeforeUnmount(() => {
	applyContainerWidth.cancel();
	if (containerObserver) {
		containerObserver.disconnect();
		containerObserver = null;
	}
	if (scrollTarget) {
		scrollTarget.removeEventListener("scroll", onScroll);
		scrollTarget = null;
	}
});

const scrollToIndex = (index) => {
	const ref = scrollerRef.value;
	if (ref?.scrollToItem) {
		ref.scrollToItem(index);
		return true;
	}
	const el = ref?.$el;
	if (el && typeof index === "number") {
		el.scrollTop = index * rowHeight.value;
		return true;
	}
	return false;
};

const getTableElement = () => scrollerRef.value?.$el || null;

defineExpose({ scrollToIndex, getTableElement, tableRef: scrollerRef });
</script>

<style scoped>
.items-table-container {
	display: flex;
	flex-direction: column;
	/* The height chain above (dynamic-padding → results card → row/col)
	   is definite now — the old `calc(100% - 80px)` and 400px floor were
	   compensations for it resolving against auto, and the floor is what
	   overflowed short phone viewports. */
	height: 100%;
	min-height: 0;
	margin: 0;
	background-color: transparent;
	border-radius: var(--pos-radius-md);
	overflow: hidden;
	border: 1px solid var(--pos-border-light);
	transition: box-shadow 0.3s ease;
}

.items-table-container:hover {
	box-shadow: 0 12px 24px var(--pos-shadow-light) !important;
}

.posa-catalog-header {
	display: grid;
	align-items: center;
	background: var(--pos-surface-muted);
	border-bottom: 1px solid var(--pos-border-light);
	color: var(--pos-text-secondary);
	font-weight: 700;
	font-size: 0.8rem;
	text-transform: none;
	letter-spacing: 0.02em;
	position: sticky;
	top: 0;
	z-index: 10;
	min-height: 48px;
	font-family:
		"SF Pro Display", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Arabic", "Tahoma",
		sans-serif;
	font-variant-numeric: lining-nums tabular-nums;
}

.posa-catalog-header-cell {
	padding: 14px 16px;
	line-height: 1.25;
	display: flex;
	align-items: center;
	min-height: 48px;
	box-sizing: border-box;
}

.posa-catalog-header--compact .posa-catalog-header-cell {
	padding-left: 8px;
	padding-right: 8px;
}

.posa-catalog-empty {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--pos-text-secondary);
	font-size: 0.9rem;
	padding: 24px;
}

.posa-catalog-loading {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 4px 0;
	overflow: hidden;
}

.posa-catalog-loading__row {
	flex: 0 0 auto;
}

.posa-catalog-scroller {
	flex: 1 1 auto;
	min-height: 0;
	height: 100%;
	overflow-y: auto;
	overflow-x: hidden;
	background-color: transparent;
	scrollbar-width: thin;
	position: relative;
}

.posa-catalog-scroller :deep(.vue-recycle-scroller__item-view:nth-child(even) .posa-catalog-row) {
	background-color: rgba(var(--v-theme-on-surface), 0.015);
}

.text-start {
	text-align: start;
}
.text-end {
	text-align: end;
}
.text-center {
	text-align: center;
}
</style>
