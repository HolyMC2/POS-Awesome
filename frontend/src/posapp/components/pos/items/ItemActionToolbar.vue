<template>
	<v-card
		class="cards mb-0 mt-3 dynamic-padding"
		:class="{ 'cards--with-mobile-offset': reserveBottomDockSpace }"
	>
		<v-row no-gutters align="center" justify="center" class="dynamic-spacing-sm">
			<!-- Side by side from md up (08-30): stacked full-width, these two
			     ate 92px of a short tablet's pinned catalog while the item grid
			     collapsed to nothing. Two ~200px selects read fine, and phones
			     (cols=12) keep the stack. -->
			<v-col
				cols="12"
				:md="posProfile.posa_px_enable_price_list_dropdown !== false ? 6 : 12"
				class="mb-2 pe-md-1"
			>
				<v-select
					:items="itemsGroup"
					:label="frappe._('Items Group')"
					density="compact"
					variant="solo"
					hide-details
					:model-value="modelValue"
					@update:model-value="$emit('update:modelValue', $event)"
				></v-select>
			</v-col>
			<v-col cols="12" md="6" class="mb-2 ps-md-1" v-if="posProfile.posa_px_enable_price_list_dropdown !== false">
				<v-text-field
					density="compact"
					variant="solo"
					color="primary"
					:label="frappe._('Price List')"
					hide-details
					:model-value="activePriceList"
					readonly
				></v-text-field>
			</v-col>
			<v-col cols="12" sm="4" class="dynamic-margin-xs">
				<v-btn-toggle
					:model-value="itemsView"
					@update:model-value="$emit('update:itemsView', $event)"
					color="primary"
					group
					density="compact"
					rounded
					class="view-toggle-btn"
				>
					<v-btn size="small" value="list">{{ __("List") }}</v-btn>
					<v-btn size="small" value="card">{{ __("Card") }}</v-btn>
				</v-btn-toggle>
			</v-col>
			<v-col cols="6" sm="4" class="dynamic-margin-xs">
				<v-btn
					size="small"
					block
					color="warning"
					variant="text"
					@click="$emit('open-offers')"
					class="action-btn-consistent"
				>
					{{ offersCount }} {{ __("Offers") }}
				</v-btn>
			</v-col>
			<v-col cols="6" sm="4" class="dynamic-margin-xs">
				<v-btn
					size="small"
					block
					color="primary"
					variant="text"
					@click="$emit('open-coupons')"
					class="action-btn-consistent"
				>
					{{ couponsCount }} {{ __("Coupons") }}
				</v-btn>
			</v-col>
		</v-row>
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
.action-btn-consistent {
	height: 36px !important;
	margin-top: var(--dynamic-xs) !important;
	padding: var(--pos-space-2) var(--pos-space-3) !important;
	transition: var(--transition-normal) !important;
	border-radius: var(--pos-radius-sm) !important;
	text-transform: none !important;
	font-weight: 600 !important;
}

.action-btn-consistent:hover {
	background-color: rgba(var(--v-theme-primary), 0.1) !important;
	transform: none !important;
}

.view-toggle-btn {
	height: 36px;
	/* The toggle lives in a sm=4 column that measures ~116px inside the
	 * anchored drawer — narrower than its two buttons' natural width, which
	 * overflowed the column and grew a horizontal scrollbar under LIST/CARD.
	 * Fit the column instead: the group takes the column's width and the
	 * buttons split it, shrinking their padding before anything scrolls. */
	width: 100%;
	min-width: 0;
	overflow: hidden;
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-sm);
}

.view-toggle-btn :deep(.v-btn) {
	flex: 1 1 50%;
	min-width: 0;
	padding: 0 var(--pos-space-2);
}

.dynamic-padding {
	padding: var(--dynamic-sm);
}

.dynamic-spacing-sm {
	padding: var(--dynamic-sm) !important;
}

.cards {
	background-color: var(--pos-surface-muted) !important;
	margin-top: var(--dynamic-sm) !important;
	padding: var(--dynamic-sm) !important;
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md) !important;
	box-shadow: none !important;
	position: sticky;
	bottom: 0;
	z-index: 7;
	min-width: 0;
	overflow: visible;
}

.cards--with-mobile-offset {
	margin-bottom: calc(var(--bottom-safe-space) + 6px) !important;
}

@media (max-width: 1099px) {
	.cards {
		position: static;
	}
}

@media (max-width: 768px) {
	.dynamic-padding {
		padding: var(--dynamic-xs);
	}

	.dynamic-spacing-sm {
		padding: var(--dynamic-xs) !important;
	}

	.action-btn-consistent {
		padding: var(--dynamic-xs) !important;
		font-size: 0.875rem !important;
		min-height: 42px !important;
	}
}

@media (max-width: 480px) {
	.cards {
		padding: var(--dynamic-xs) !important;
		position: static;
	}
}
</style>
