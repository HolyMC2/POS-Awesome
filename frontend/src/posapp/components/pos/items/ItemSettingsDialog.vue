<template>
	<v-dialog v-model="dialogModel" max-width="520px" scrollable>
		<v-card class="catalogue-settings">
			<v-card-title class="pa-4 d-flex align-center">
				<span>{{ __("Catalogue settings") }}</span>
				<v-btn
					icon="mdi-close"
					variant="text"
					:aria-label="__('Close Settings')"
					@click="dialogModel = false"
				/>
			</v-card-title>
			<v-divider />
			<v-card-text class="pa-4">
				<p class="catalogue-settings__hint">
					{{ __("Saved on this device. Other registers keep their own preferences.") }}
				</p>
				<section v-if="showCategoryNavigation" class="catalogue-settings__section">
					<h3>{{ __("Start catalogue with") }}</h3>
					<v-radio-group v-model="form.category_navigation" hide-details color="primary">
						<v-radio :label="__('Automatic: categories on touchscreens')" value="touch" />
						<v-radio :label="__('Category boxes on every screen')" value="categories" />
						<v-radio :label="__('Products on every screen')" value="products" />
					</v-radio-group>
					<p class="catalogue-settings__hint">
						{{ __("Search and barcode scanning show products directly.") }}
					</p>
				</section>
				<section class="catalogue-settings__section">
					<h3>{{ __("Product display") }}</h3>
					<v-btn-toggle
						v-if="showItemsView"
						v-model="form.display_mode"
						color="primary"
						mandatory
						class="browse-view-toggle my-3"
					>
						<v-btn value="list" prepend-icon="mdi-format-list-bulleted">{{ __("List") }}</v-btn>
						<v-btn value="card" prepend-icon="mdi-view-grid-outline">{{ __("Card") }}</v-btn>
					</v-btn-toggle>
					<v-switch
						v-if="allowNewLineSetting"
						v-model="form.new_line"
						:label="__('Add on New Line')"
						hide-details
						density="compact"
						color="primary"
					/>
					<v-switch
						v-model="form.hide_qty_decimals"
						:label="__('Hide quantity decimals')"
						hide-details
						density="compact"
						color="primary"
					/>
					<v-switch
						v-model="form.hide_zero_rate_items"
						:label="__('Hide zero rated items')"
						hide-details
						density="compact"
						color="primary"
					/>
					<v-switch
						v-model="form.show_last_invoice_rate"
						:label="__('Show last invoice rate')"
						hide-details
						density="compact"
						color="primary"
					/>
				</section>
				<details class="catalogue-settings__section">
					<summary>{{ __("Sync and performance") }}</summary>
					<v-switch
						v-model="form.enable_background_sync"
						:label="__('Enable background sync')"
						hide-details
						density="compact"
						color="primary"
					/>
					<v-text-field
						v-model="form.background_sync_interval"
						:label="__('Background sync interval (seconds)')"
						type="number"
						inputmode="numeric"
						min="10"
						:disabled="!form.enable_background_sync"
						density="comfortable"
						variant="outlined"
						hide-details
						class="my-3"
					/>
					<v-switch
						v-model="form.enable_custom_items_per_page"
						:label="__('Custom items per page')"
						hide-details
						density="compact"
						color="primary"
					/>
					<v-text-field
						v-if="form.enable_custom_items_per_page"
						v-model="form.items_per_page"
						:label="__('Items per page')"
						type="number"
						inputmode="numeric"
						min="1"
						density="comfortable"
						variant="outlined"
						hide-details
						class="my-3"
					/>
				</details>
			</v-card-text>
			<v-divider />
			<v-card-actions class="pa-4">
				<v-spacer />
				<v-btn variant="text" @click="dialogModel = false">{{ __("Cancel") }}</v-btn>
				<v-btn color="primary" variant="elevated" @click="onSave">{{ __("Save Settings") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, reactive, watch } from "vue";
import { normalizeCategoryNavigation } from "../../../composables/pos/items/useCategoryNavigation";

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	initialSettings: { type: Object, required: true },
	allowNewLineSetting: { type: Boolean, default: false },
	showCategoryNavigation: { type: Boolean, default: true },
	showItemsView: { type: Boolean, default: true },
	itemsView: { type: String, default: "list" },
});
const emit = defineEmits(["update:modelValue", "save", "update:itemsView"]);
const dialogModel = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});
const __ = window.__ ?? ((text) => text);
const form = reactive({});
watch(
	() => props.modelValue,
	(open) => {
		if (open)
			Object.assign(form, props.initialSettings, {
				category_navigation: normalizeCategoryNavigation(props.initialSettings.category_navigation),
				display_mode: props.itemsView,
			});
	},
	{ immediate: true },
);
const onSave = () => {
	if (props.showItemsView) emit("update:itemsView", form.display_mode);
	emit("save", { ...form });
	dialogModel.value = false;
};
</script>

<style scoped>
.catalogue-settings {
	max-height: calc(100dvh - 32px);
}
.catalogue-settings :deep(.v-card-title) {
	display: flex !important;
	flex-wrap: nowrap;
	gap: 8px;
	white-space: normal;
	font-size: 1.15rem;
}
.catalogue-settings :deep(.v-card-title > span) {
	min-width: 0;
	flex: 1;
}
.catalogue-settings :deep(.v-card-title > .v-btn) {
	flex: 0 0 44px;
}
.catalogue-settings :deep(.v-label) {
	white-space: normal;
	opacity: 1;
}
.catalogue-settings__hint {
	margin: 0 0 12px;
	font-size: 0.875rem;
	color: var(--pos-text-secondary);
	line-height: 1.5;
}
.catalogue-settings__section {
	border-top: 1px solid var(--pos-border-light);
	padding-top: 16px;
	margin-top: 16px;
}
.catalogue-settings__section h3,
.catalogue-settings__section summary {
	font-size: 1rem;
	font-weight: 650;
}
.catalogue-settings__section summary {
	cursor: pointer;
	min-height: 44px;
	padding-block: 10px;
}
.browse-view-toggle {
	display: flex;
	width: 100%;
}
.browse-view-toggle :deep(.v-btn) {
	flex: 1;
	min-width: 0;
}
</style>
