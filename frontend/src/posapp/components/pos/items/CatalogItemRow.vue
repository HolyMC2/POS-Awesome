<template>
	<div
		:class="['posa-catalog-row', rowClass, { 'posa-catalog-row--highlighted': highlighted }]"
		:data-item-code="item.item_code"
		:style="gridStyle"
		role="row"
		tabindex="0"
		data-pos-keyboard-target="item-row"
		@click="onClick"
		@keydown="onKeyboardSelect"
	>
		<div
			v-for="column in columns"
			:key="column.key"
			:class="['posa-catalog-cell', `posa-catalog-cell--${column.key}`, alignClass(column.align)]"
			role="cell"
		>
			<template v-if="column.key === 'rate' && context !== 'purchase'">
				<div class="rate-cell-primary text-primary">
					<div>
						{{ primaryCurrencySymbol }}
						{{ primaryRateFormatted }}
					</div>
					<ItemRateInfoMenu
						v-if="showRateInfo"
						:rate-info="rateInfo"
						:currency-symbol="currencySymbol"
						:format-currency="formatCurrency"
						:rate-precision="ratePrecision"
					/>
				</div>
				<div v-if="showSecondaryRate" class="text-success">
					{{ currencySymbol(selectedCurrency) }}
					{{ formatCurrency(item.rate, selectedCurrency, ratePrecision(item.rate)) }}
				</div>
			</template>
			<template v-else-if="column.key === 'rate' && context === 'purchase'">
				<div class="rate-cell-primary text-primary">
					<div>
						{{ primaryCurrencySymbol }}
						{{ purchaseRateFormatted }}
					</div>
					<ItemRateInfoMenu
						v-if="showRateInfo"
						:rate-info="rateInfo"
						:currency-symbol="currencySymbol"
						:format-currency="formatCurrency"
						:rate-precision="ratePrecision"
					/>
				</div>
			</template>
			<template v-else-if="column.key === 'actual_qty'">
				<span class="golden--text" :class="{ 'negative-number': isNegative(item.actual_qty) }">
					{{ qtyFormatted }}
				</span>
			</template>
			<template v-else>
				{{ item[column.key] }}
			</template>
		</div>
	</div>
</template>

<script setup>
import { computed } from "vue";
import ItemRateInfoMenu from "./ItemRateInfoMenu.vue";

const props = defineProps({
	item: { type: Object, required: true },
	columns: { type: Array, required: true },
	context: { type: String, default: "pos" },
	posProfile: { type: Object, default: () => ({}) },
	selectedCurrency: { type: String, default: "" },
	hideQtyDecimals: { type: Boolean, default: false },
	showRateInfo: { type: Boolean, default: true },
	highlighted: { type: Boolean, default: false },
	rowClass: { type: String, default: "" },
	currencySymbol: { type: Function, required: true },
	formatCurrency: { type: Function, required: true },
	formatNumber: { type: Function, required: true },
	ratePrecision: { type: Function, required: true },
	getItemRateInfo: { type: Function, required: true },
	isNegative: { type: Function, required: true },
});

const emit = defineEmits(["click"]);

// CSS-grid template built from header `width` strings (e.g. "40%") or
// even fractions when not specified. Keeps column alignment in sync
// with the header row in the parent without `<table>`/`<col>`.
const gridStyle = computed(() => {
	const tracks = props.columns.map((c) => c.width || "1fr").join(" ");
	return { gridTemplateColumns: tracks };
});

const alignClass = (align) => {
	if (align === "end") return "text-end";
	if (align === "center") return "text-center";
	return "text-start";
};

const primaryCurrency = computed(
	() =>
		props.item.original_currency ||
		props.item.currency ||
		props.item.price_list_currency ||
		props.posProfile.currency,
);

const primaryCurrencySymbol = computed(() => props.currencySymbol(primaryCurrency.value));

const primaryRateValue = computed(() => props.item.original_rate ?? props.item.rate ?? 0);

const primaryRateFormatted = computed(() =>
	props.formatCurrency(
		primaryRateValue.value,
		primaryCurrency.value,
		props.ratePrecision(primaryRateValue.value),
	),
);

const purchaseRateValue = computed(
	() => props.item.original_rate ?? props.item.rate ?? props.item.standard_rate ?? 0,
);

const purchaseRateFormatted = computed(() =>
	props.formatCurrency(
		purchaseRateValue.value,
		primaryCurrency.value,
		props.ratePrecision(purchaseRateValue.value),
	),
);

const showSecondaryRate = computed(
	() =>
		props.posProfile.posa_allow_multi_currency &&
		props.selectedCurrency &&
		props.selectedCurrency !== primaryCurrency.value,
);

const rateInfo = computed(() => props.getItemRateInfo(props.item));

const qtyFormatted = computed(() => {
	const numeric = Number(props.item.actual_qty ?? 0);
	if (!Number.isFinite(numeric)) return 0;
	if (props.hideQtyDecimals) return props.formatNumber(Math.round(numeric), 0);
	return props.formatNumber(numeric, 4);
});

function onClick(event) {
	// Emitting from a child component (rather than binding @click in the
	// scroller slot directly) is the documented workaround for
	// vue-virtual-scroller's RecycleScroller item recycling: scroller
	// reuses the same slot DOM node across rows, so an outer @click
	// would fire against a stale closure. The emit goes through the
	// component instance, which the scroller keeps stable for the slot
	// lifetime. Same pattern used in ItemsSelectorCards → ItemCard.
	emit("click", event, props.item);
}

function onKeyboardSelect(event) {
	const key = event?.key || "";
	if (key !== "Enter" && key !== " ") {
		return;
	}
	event.preventDefault?.();
	emit("click", event, props.item);
}
</script>

<style scoped>
.posa-catalog-row {
	display: grid;
	align-items: center;
	gap: 0;
	min-height: 48px;
	padding: 0;
	border-bottom: 1px solid var(--pos-border-light);
	background-color: var(--pos-surface-raised);
	transition: background-color 0.15s ease;
	cursor: pointer;
	font-family:
		"SF Pro Display", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Arabic", "Tahoma",
		sans-serif;
	font-variant-numeric: lining-nums tabular-nums;
	font-feature-settings:
		"tnum" 1,
		"lnum" 1,
		"kern" 1;
}

.posa-catalog-row:hover {
	background-color: rgba(var(--v-theme-primary), 0.05);
}

.posa-catalog-row:focus-visible {
	outline: 2px solid rgb(var(--v-theme-primary));
	outline-offset: -2px;
}

.posa-catalog-row--highlighted {
	background-color: rgba(var(--v-theme-primary), 0.32);
}

.posa-catalog-row--highlighted .posa-catalog-cell {
	font-weight: 600;
	color: rgb(var(--v-theme-primary));
}

.posa-catalog-cell {
	padding: 8px 16px;
	color: var(--pos-text-primary);
	font-size: 0.875rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.posa-catalog-cell--rate,
.posa-catalog-cell--actual_qty {
	white-space: normal;
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

.rate-cell-primary {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
</style>
