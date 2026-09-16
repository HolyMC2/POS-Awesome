<template>
	<v-card class="cards catalog-toolbar" :class="{ 'cards--with-mobile-offset': reserveBottomDockSpace }">
		<div class="catalog-toolbar__controls">
			<v-select class="catalog-toolbar__group" :items="itemsGroup" :label="frappe._('Items Group')"
				density="compact" variant="outlined" hide-details :model-value="modelValue"
				@update:model-value="$emit('update:modelValue', $event)" />
			<v-text-field v-if="posProfile.posa_px_enable_price_list_dropdown !== false"
				class="catalog-toolbar__price" density="compact" variant="outlined"
				:label="frappe._('Price List')" hide-details :model-value="activePriceList" readonly />
			<v-btn-toggle :model-value="itemsView" @update:model-value="$emit('update:itemsView', $event)"
				mandatory color="primary" density="compact" class="view-toggle-btn" :aria-label="__('View')">
				<v-btn size="small" value="list" :aria-label="__('List')" :title="__('List')">
					<v-icon icon="mdi-format-list-bulleted" size="20" />
				</v-btn>
				<v-btn size="small" value="card" :aria-label="__('Card')" :title="__('Card')">
					<v-icon icon="mdi-view-grid-outline" size="20" />
				</v-btn>
			</v-btn-toggle>
			<v-btn size="small" variant="text" class="catalog-toolbar__action" @click="$emit('open-offers')">
				{{ offersCount }} {{ __('Offers') }}
			</v-btn>
			<v-btn size="small" variant="text" class="catalog-toolbar__action" @click="$emit('open-coupons')">
				{{ couponsCount }} {{ __('Coupons') }}
			</v-btn>
		</div>
	</v-card>
</template>

<script setup>
const __ = window.__;
const frappe = window.frappe;

defineProps({
	modelValue: { type: String, default: "ALL" }, // item_group
	itemsGroup: { type: Array, default: () => [] },
	itemsView: { type: String, default: "card" },
	posProfile: { type: Object, required: true },
	activePriceList: { type: String, default: "" },
	offersCount: { type: Number, default: 0 },
	couponsCount: { type: Number, default: 0 },
	reserveBottomDockSpace: { type: Boolean, default: false },
});

defineEmits(["update:modelValue", "update:itemsView", "open-offers", "open-coupons"]);
</script>

<style scoped>
.catalog-toolbar {
	container-type: inline-size;
	background: var(--pos-surface-muted) !important;
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md) !important;
	box-shadow: none !important;
	margin-top: 6px !important;
	padding: 8px !important;
	flex: 0 0 auto;
	min-width: 0;
}
.catalog-toolbar__controls {
	display: flex;
	align-items: center;
	gap: 6px;
}
.catalog-toolbar__group,
.catalog-toolbar__price {
	flex: 1 1 130px;
	min-width: 0;
}
.catalog-toolbar :deep(.v-field__input) {
	min-height: 36px;
	padding-top: 6px;
	padding-bottom: 6px;
	font-size: 12px;
}
.catalog-toolbar :deep(.v-field__outline .v-label) { font-size: 11px; }
.catalog-toolbar .view-toggle-btn { flex: 0 0 auto; height: 36px; }
.catalog-toolbar .view-toggle-btn :deep(.v-btn) { min-width: 36px; padding: 0 8px; }
.catalog-toolbar .catalog-toolbar__action {
	flex: 0 0 auto;
	min-width: 0;
	padding: 0 6px;
	height: 36px;
	font-size: 12px;
	text-transform: none;
}
.cards--with-mobile-offset { margin-bottom: calc(var(--bottom-safe-space) + 6px) !important; }
@container (max-width: 559px) {
	.catalog-toolbar__controls { flex-wrap: wrap; }
	.catalog-toolbar__group, .catalog-toolbar__price { flex-basis: calc(50% - 6px); }
	.catalog-toolbar__action { flex-grow: 1 !important; }
}
</style>
