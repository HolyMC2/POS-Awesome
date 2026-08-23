<template>
	<div class="items-card-container">
		<div v-if="isLoading" class="items-card-grid">
			<Skeleton v-for="n in 8" :key="n" class="mb-4" height="120" />
		</div>
		<div
			v-else-if="displayedItems.length === 0"
			class="d-flex flex-column align-center justify-center text-center fill-height pa-4"
			style="height: 100%; min-height: 200px"
		>
			<v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-package-variant-closed</v-icon>
			<div class="text-h6 text-medium-emphasis mb-1">
				{{ noItemsTitle }}
			</div>
			<div class="text-body-2 text-medium-emphasis">
				{{ noItemsSubtitle }}
			</div>
			<v-btn
				v-if="showClearButton"
				variant="text"
				color="primary"
				class="mt-4"
				@click="handleClearSearch"
			>
				{{ clearSearchLabel }}
			</v-btn>
		</div>
		<RecycleScroller
			v-else
			ref="scrollerRef"
			class="virtual-scroller"
			list-class="items-virtual-list"
			:items="displayedItems"
			key-field="item_code"
			:item-size="cardSlotHeight"
			:grid-items="cardColumns"
			:item-secondary-size="cardSlotWidth"
			:buffer="virtualScrollBuffer"
			:emit-update="true"
			@update="handleRangeUpdate"
		>
			<template #default="{ item }">
				<ItemCard
					v-if="item"
					:key="item.item_code"
					:item="item"
					:pos-profile="posProfile"
					:context="context"
					:selected-currency="selectedCurrency"
					:hide-qty-decimals="hideQtyDecimals"
					:show-rate-info="showRateInfo"
					:get-item-rate-info="getItemRateInfo"
					:is-item-highlighted="isItemHighlighted(item)"
					:currency-symbol="currencySymbol"
					:format-currency="formatCurrency"
					:format-number="formatNumber"
					:rate-precision="ratePrecision"
					:is-negative="isNegative"
					:compact="isCompact"
					:low-stock-threshold="posProfile?.posa_low_stock_alert_threshold"
					:style="{
						width: cardColumnWidth + 'px',
						height: cardRowHeight + 'px',
					}"
					@click="handleItemClick"
					@dragstart="handleDragStart"
					@dragend="handleDragEnd"
				/>
			</template>
		</RecycleScroller>
	</div>
</template>

<script setup>
import { computed, ref } from "vue";
import { RecycleScroller } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import ItemCard from "./ItemCard.vue";
import Skeleton from "../../ui/Skeleton.vue";
import { isCompactCard } from "../../../utils/itemSelectorLayout.js";

const props = defineProps({
	displayedItems: { type: Array, default: () => [] },
	isLoading: { type: Boolean, default: false },
	searchInput: { type: String, default: "" },
	itemGroup: { type: String, default: "ALL" },
	cardSlotHeight: { type: Number, default: 0 },
	cardColumns: { type: Number, default: 1 },
	cardSlotWidth: { type: Number, default: 0 },
	cardColumnWidth: { type: Number, default: 0 },
	cardRowHeight: { type: Number, default: 0 },
	virtualScrollBuffer: { type: Number, default: 200 },
	posProfile: { type: Object, default: () => ({}) },
	context: { type: String, default: "pos" },
	selectedCurrency: { type: String, default: "" },
	hideQtyDecimals: { type: Boolean, default: false },
	showRateInfo: { type: Boolean, default: true },
	getItemRateInfo: { type: Function, required: true },
	isItemHighlighted: { type: Function, required: true },
	currencySymbol: { type: Function, required: true },
	formatCurrency: { type: Function, required: true },
	formatNumber: { type: Function, required: true },
	ratePrecision: { type: Function, required: true },
	isNegative: { type: Function, required: true },
	noItemsTitle: { type: String, default: "" },
	noItemsSubtitle: { type: String, default: "" },
	clearSearchLabel: { type: String, default: "" },
});

const emit = defineEmits(["select-item", "dragstart", "dragend", "virtual-range-update", "clear-search"]);

/**
 * The card's anatomy follows the width it is actually drawn at, and it asks
 * the SAME pure predicate that `useItemSelectorLayout` uses to size the slot.
 * A second threshold here — a media query, a window check — is how a compact
 * card ends up in a roomy slot with 100px of dead space under it.
 */
const isCompact = computed(() => isCompactCard(props.cardColumnWidth));

const showClearButton = computed(() => {
	return Boolean(props.searchInput) || (props.itemGroup && props.itemGroup !== "ALL");
});

const handleItemClick = (event, item) => {
	emit("select-item", event, item);
};

const handleDragStart = (event, item) => {
	emit("dragstart", event, item);
};

const handleDragEnd = (event) => {
	emit("dragend", event);
};

const handleRangeUpdate = (...args) => {
	emit("virtual-range-update", ...args);
};

const handleClearSearch = () => {
	emit("clear-search");
};

const scrollerRef = ref(null);

const scrollToItem = (index) => {
	scrollerRef.value?.scrollToItem?.(index);
};

const getScrollerElement = () => {
	const ref = scrollerRef.value;
	return ref?.$el || ref;
};

defineExpose({ scrollToItem, getScrollerElement, scrollerRef });
</script>

<style scoped>
/* SCOPED CSS CANNOT REACH INTO THE SCROLLER. Vue stamps this component's
   scope attribute onto its OWN template nodes and onto child-component ROOT
   nodes — nothing deeper. `.virtual-scroller` is RecycleScroller's root so it
   carries the attribute, but every node the library renders inside it
   (`.vue-recycle-scroller__item-wrapper`, the item views) does not: a rule
   like `.virtual-scroller .vue-recycle-scroller__item-wrapper { … }` compiles
   to `…[data-v-xxxxxxxx]` and matches nothing, forever, silently. Two such
   rules sat here dead until 2026-08-13 — and both would have BROKEN the grid
   had a later `:deep()` woken them (`display:contents` erases the wrapper box
   that carries the scroller's total height; a second `overflow-y:auto` nests a
   scrollport inside the scrollport). Style the root, or go through `:deep()`
   deliberately. Same rule bit ItemsSelector.vue, which styled `.items-card-grid`
   and `.item-container` — classes that live in THIS template, so its copies
   were dead too. Card-view styling belongs here and only here. */

/* The card root must bound its own height for the scroller's `height:100%`
   to resolve — the height chain above (dynamic-padding → results card →
   row/col) is definite. Without this the container is auto-height, the
   scroller grows to full content, and nothing scrolls: on a phone every
   item past the fold hides behind the fixed dock. This mirrors
   .items-table-container, which got the fix in the mobile overhaul; the
   card view was left on the old broken `calc(100% - 80px)` pattern because
   retail defaults to list view and only the cafetería preset defaults to
   cards, so the bug went unseen. */
.items-card-container {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	overflow: hidden;
}

/* THE scrollport for the card grid — the only one. `scrollbar-gutter` is
   unconditional by design: reserving the gutter is precisely what stops the
   grid reflowing the instant a scrollbar appears, so gating it behind a
   JS-measured "is it overflowing?" flag defeated its own purpose. */
.virtual-scroller {
	flex: 1 1 auto;
	min-height: 0;
	height: 100%;
	overflow-y: auto;
	position: relative;
	scrollbar-gutter: stable;
	overscroll-behavior: contain;
	overflow-anchor: auto;
	scrollbar-width: thin;
	scrollbar-color: rgba(var(--v-theme-on-surface), 0.2) transparent;
}

.virtual-scroller::-webkit-scrollbar {
	width: 8px;
}

.virtual-scroller::-webkit-scrollbar-track {
	background: transparent;
}

.virtual-scroller::-webkit-scrollbar-thumb {
	background-color: rgba(var(--v-theme-on-surface), 0.2);
	border-radius: 4px;
}

/* Loading skeletons — a SIBLING of the scroller (v-if/v-else), never inside
   it. auto-fill on the same minimum card width `getCardColumnsForContainer`
   uses keeps the placeholder in step with the real grid at every panel width,
   with no media queries to drift out of sync.

   148px is `CARD_MIN_WIDTH` in `utils/itemSelectorLayout.ts`, written out
   because scoped CSS cannot read a TS constant; `catalogCardGrid.spec.ts`
   asserts the two are the same number. It was 216 — sized for the catalogue
   when it was a 40% column — and at the 400px drawer that meant the skeleton
   promised one giant card and the real grid then delivered one, which is why
   nobody noticed the track had gone stale. */
.items-card-grid {
	flex: 1 1 auto;
	min-height: 0;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
	gap: 16px;
	padding: 16px;
	overflow-y: auto;
	contain: layout style;
}

.virtual-scroller :deep(.items-virtual-list) {
	padding: 16px;
	contain: layout style;
	box-sizing: border-box;
}

@media (max-width: 1200px) {
	.virtual-scroller :deep(.items-virtual-list) {
		padding: 12px;
	}
}

@media (max-width: 768px) {
	.virtual-scroller :deep(.items-virtual-list) {
		padding: 10px;
	}
}
</style>
