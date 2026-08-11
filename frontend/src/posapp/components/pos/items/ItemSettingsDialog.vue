<template>
	<v-dialog v-model="dialogModel" max-width="400px">
		<v-card>
			<v-card-title class="text-h6 pa-4 d-flex align-center">
				<span>{{ __("Item Selector Settings") }}</span>
				<v-spacer></v-spacer>
				<v-btn
					icon="mdi-close"
					variant="text"
					density="compact"
					@click="dialogModel = false"
					:aria-label="__('Close Settings')"
				>
				</v-btn>
			</v-card-title>
			<v-divider></v-divider>
			<v-card-text class="pa-4">
				<!-- Browse controls: on phone the bottom toolbar (item group /
				     price list / list-card toggle) is hidden so the selector
				     card owns the whole viewport and the search bar never
				     scrolls away — those controls live here instead. They
				     apply IMMEDIATELY (filters, not settings): Save/Cancel
				     below only governs the switches. -->
				<template v-if="props.showBrowseControls">
					<div class="browse-section-label">{{ __("Browse") }}</div>
					<v-select
						:items="props.itemsGroup"
						:label="__('Items Group')"
						density="compact"
						variant="outlined"
						color="primary"
						hide-details
						class="mb-2 pos-themed-input"
						:model-value="props.itemGroup"
						@update:model-value="emit('update:itemGroup', $event)"
					></v-select>
					<v-btn-toggle
						:model-value="props.itemsView"
						@update:model-value="$event && emit('update:itemsView', $event)"
						color="primary"
						group
						density="compact"
						rounded
						mandatory
						class="browse-view-toggle mb-2"
					>
						<v-btn size="small" value="list">{{ __("List") }}</v-btn>
						<v-btn size="small" value="card">{{ __("Card") }}</v-btn>
					</v-btn-toggle>
					<v-text-field
						v-if="props.showPriceList"
						density="compact"
						variant="outlined"
						color="primary"
						:label="__('Price List')"
						hide-details
						class="mb-2 pos-themed-input"
						:model-value="props.activePriceList"
						readonly
					></v-text-field>
					<v-divider class="mb-3 mt-1"></v-divider>
				</template>
				<v-switch
					v-if="props.allowNewLineSetting"
					v-model="form.new_line"
					:label="__('Add on New Line')"
					hide-details
					density="compact"
					color="primary"
					class="mb-2"
				></v-switch>
				<v-switch
					v-model="form.hide_qty_decimals"
					:label="__('Hide quantity decimals')"
					hide-details
					density="compact"
					color="primary"
					class="mb-2"
				></v-switch>
				<v-switch
					v-model="form.hide_zero_rate_items"
					:label="__('Hide zero rated items')"
					hide-details
					density="compact"
					color="primary"
				></v-switch>
				<v-switch
					v-model="form.show_last_invoice_rate"
					:label="__('Show last invoice rate')"
					hide-details
					density="compact"
					color="primary"
					class="mb-2"
				></v-switch>
				<v-switch
					v-model="form.enable_background_sync"
					:label="__('Enable background sync')"
					hide-details
					density="compact"
					color="primary"
					class="mb-2"
				></v-switch>
				<v-text-field
					v-model="form.background_sync_interval"
					:label="__('Background sync interval (seconds)')"
					type="number"
					inputmode="numeric"
					enterkeyhint="done"
					density="compact"
					variant="outlined"
					color="primary"
					hide-details
					class="mb-2 pos-themed-input"
					:min="10"
					:disabled="!form.enable_background_sync"
				></v-text-field>
				<v-switch
					v-model="form.enable_custom_items_per_page"
					:label="__('Custom items per page')"
					hide-details
					density="compact"
					color="primary"
					class="mb-2"
				>
				</v-switch>
				<v-checkbox
					v-model="form.force_server_items"
					:label="__('Always fetch items from server (ignore local cache)')"
					hide-details
					density="compact"
					color="primary"
					class="mb-2"
				></v-checkbox>
				<v-text-field
					v-if="form.enable_custom_items_per_page"
					v-model="form.items_per_page"
					type="number"
					inputmode="numeric"
					enterkeyhint="done"
					density="compact"
					variant="outlined"
					color="primary"
					hide-details
					:label="__('Items per page')"
					class="mb-2 pos-themed-input"
				>
				</v-text-field>
			</v-card-text>
			<v-divider></v-divider>
			<v-card-actions class="pa-4">
				<v-spacer></v-spacer>
				<v-btn variant="text" @click="dialogModel = false">
					{{ __("Cancel") }}
				</v-btn>
				<v-btn color="primary" variant="elevated" @click="onSave">
					{{ __("Save Settings") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, reactive, watch } from "vue";

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	initialSettings: { type: Object, required: true },
	allowNewLineSetting: { type: Boolean, default: false },
	// Phone-only browse controls (the bottom toolbar is hidden there).
	showBrowseControls: { type: Boolean, default: false },
	itemsGroup: { type: Array, default: () => [] },
	itemGroup: { type: String, default: "ALL" },
	itemsView: { type: String, default: "list" },
	activePriceList: { type: String, default: "" },
	showPriceList: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "save", "update:itemGroup", "update:itemsView"]);

const dialogModel = computed({
	get: () => props.modelValue,
	set: (val) => emit("update:modelValue", val),
});

const form = reactive({
	new_line: false,
	hide_qty_decimals: false,
	hide_zero_rate_items: false,
	show_last_invoice_rate: true,
	enable_background_sync: true,
	background_sync_interval: 30,
	enable_custom_items_per_page: false,
	items_per_page: 50,
	force_server_items: false,
});

watch(
	() => props.modelValue,
	(val) => {
		if (val) {
			// Initialize form with current settings when dialog opens
			Object.assign(form, props.initialSettings);
		}
	},
);

const onSave = () => {
	emit("save", { ...form });
	dialogModel.value = false;
};
</script>

<style scoped>
.browse-section-label {
	font-size: 0.8rem;
	font-weight: 700;
	letter-spacing: 0.02em;
	text-transform: uppercase;
	color: var(--pos-text-secondary);
	margin-bottom: 8px;
}

.browse-view-toggle {
	width: 100%;
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-sm);
}

.browse-view-toggle :deep(.v-btn) {
	flex: 1 1 50%;
}
</style>
