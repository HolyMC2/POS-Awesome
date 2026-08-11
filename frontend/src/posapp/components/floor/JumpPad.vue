<template>
	<v-dialog :model-value="modelValue" max-width="320" @update:model-value="close">
		<v-card class="jump-pad pos-themed-card">
			<v-card-title class="jump-pad__title">{{ title }}</v-card-title>
			<v-card-text class="jump-pad__body">
				<div class="jump-pad__readout" :class="{ 'jump-pad__readout--miss': entry && !match }">
					<span class="jump-pad__entry">{{ entry || "—" }}</span>
					<span class="jump-pad__hint">{{ hint }}</span>
				</div>
				<div class="jump-pad__keys">
					<button
						v-for="key in KEYS"
						:key="key"
						type="button"
						class="jump-pad__key"
						@click="press(key)"
					>
						{{ key }}
					</button>
					<button type="button" class="jump-pad__key jump-pad__key--wide" @click="backspace">
						<v-icon icon="mdi-backspace-outline" size="18" />
					</button>
				</div>
			</v-card-text>
			<v-card-actions class="jump-pad__actions">
				<v-btn variant="text" @click="close">{{ __("Cancel") }}</v-btn>
				<v-spacer />
				<v-btn color="primary" variant="flat" :disabled="!entry" @click="confirm">
					{{ match ? openLabel : newTabLabel }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Numpad jump (spec §4): type a table label to go straight to it. A number
 * that matches no table is not an error — it opens a named tab under that
 * label, which is how the same gesture serves a coffee counter with no floor.
 */
import { computed, ref, watch } from "vue";
import { useFloorStore, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
	(event: "update:modelValue", value: boolean): void;
	(event: "open-table", table: TableRow): void;
	(event: "open-tab", tabName: string): void;
}>();

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const entry = ref("");

const title = computed(() => `${verticalStore.t("Go to")} ${verticalStore.t("Table")}`);
const openLabel = computed(() => verticalStore.t("Open"));
const newTabLabel = computed(() => verticalStore.t("New tab"));

// Labels are text ("Barra 3"), so the numpad matches on the numeric part too —
// typing 3 finds "3" first and falls back to a label that ends in 3.
const match = computed<TableRow | null>(() => {
	const needle = entry.value.trim();
	if (!needle) return null;
	const candidates = floorStore.activeFloorTables;
	return (
		candidates.find((table) => table.table_label === needle) ||
		candidates.find((table) => table.table_label.replace(/\D+/g, "") === needle) ||
		null
	);
});

const hint = computed(() => {
	if (!entry.value) return verticalStore.t("Type a table number");
	return match.value ? match.value.table_label : verticalStore.t("No match — opens a tab");
});

watch(
	() => props.modelValue,
	(open) => {
		if (open) entry.value = "";
	},
);

function press(key: string) {
	if (entry.value.length >= 8) return;
	entry.value += key;
}

function backspace() {
	entry.value = entry.value.slice(0, -1);
}

function close() {
	emit("update:modelValue", false);
}

function confirm() {
	const table = match.value;
	if (table) emit("open-table", table);
	else if (entry.value.trim()) emit("open-tab", entry.value.trim());
	close();
}
</script>

<style scoped>
.jump-pad__title {
	font-size: 16px;
	font-weight: 700;
	color: var(--pos-text-primary);
	background: var(--pos-surface);
}

.jump-pad__body {
	background: var(--pos-surface);
}

.jump-pad__readout {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding: 8px;
	margin-bottom: 10px;
	border-radius: 8px;
	background: var(--pos-surface-variant);
	color: var(--pos-text-primary);
}

.jump-pad__readout--miss {
	background: var(--pos-warning-container);
	color: var(--pos-text-primary);
}

.jump-pad__entry {
	font-size: 26px;
	font-weight: 700;
	line-height: 1.1;
	color: var(--pos-text-primary);
}

.jump-pad__hint {
	font-size: 12px;
	color: var(--pos-text-secondary);
}

.jump-pad__keys {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 6px;
}

.jump-pad__key {
	min-height: 48px;
	border: 1px solid var(--pos-border);
	border-radius: 8px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	font-size: 18px;
	font-weight: 600;
}

.jump-pad__key--wide {
	grid-column: span 2;
}

.jump-pad__actions {
	background: var(--pos-surface);
}
</style>
