<template>
	<Teleport to="body">
	<transition name="offline-status-panel-fade">
		<v-card
			v-if="props.modelValue"
			data-test="offline-status-panel"
			class="offline-status-panel pos-themed-card"
			elevation="16"
		>
			<div class="offline-status-panel__header">
				<div class="offline-status-panel__copy">
					<div class="offline-status-panel__title">
						{{ __("Offline Status") }}
					</div>
					<div class="offline-status-panel__subtitle">
						{{ summaryMessage }}
					</div>
				</div>
				<v-chip size="small" variant="tonal" :color="chipColor" class="offline-status-panel__chip">
					{{ connectivityLabel }}
				</v-chip>
				<button type="button" class="offline-status-panel__close" :aria-label="__('Close')"
					@click="$emit('update:modelValue', false)">×</button>
			</div>

			<div class="offline-status-panel__meta">
				<div class="offline-status-panel__meta-item">
					<span class="offline-status-panel__meta-label">{{ __("Pending Sales") }}</span>
					<strong>{{ summary.pendingInvoices }}</strong>
				</div>
				<div class="offline-status-panel__meta-item">
					<span class="offline-status-panel__meta-label">{{ __("Cache Usage") }}</span>
					<strong>{{ cacheUsageLabel }}</strong>
				</div>
			</div>

			<div class="offline-status-panel__section" data-test="storage-persistence-status">
				<div class="offline-status-panel__actions">
					<button type="button" data-testid="open-money-exceptions" @click="$emit('open-money-exceptions')">{{ __("Money needing attention") }}</button>
				</div>
				<div class="offline-status-panel__section-title">{{ __("Saved work protection") }}</div>
				<div class="offline-status-panel__resource-detail">{{ persistenceMessage }}</div>
				<div class="offline-status-panel__actions">
					<button v-if="storagePersistenceStatus !== 'persistent'"
						type="button" data-test="storage-persistence-request"
						:disabled="storagePersistenceStatus === 'checking'"
						@click="checkStoragePersistence(true)">{{ __("Request storage protection") }}</button>
				</div>
			</div>
			<div v-if="legacyRecoveryCount" class="offline-status-panel__warning" data-test="legacy-queue-recovery">
				<div class="offline-status-panel__warning-title">{{ __("Saved work needs ownership review") }}</div>
				<div class="offline-status-panel__warning-line">
					{{ __("Unassigned records are preserved on this device and will not upload under this login. Ask a System Manager to export them and check invoice names and request IDs against the server before replaying. Exporting does not submit or remove records. Do not clear browser data.") }}
				</div>
				<div v-if="canRecoverLegacyQueue()" class="offline-status-panel__actions">
					<button type="button" data-test="legacy-queue-export" @click="exportLegacyRecovery">{{ __("Export for recovery") }}</button>
				</div>
			</div>
			<div v-if="recoveryError" role="alert">{{ recoveryError }}</div>
			<ShiftTerminalStatus />

			<div
				v-if="bootstrapWarning.active"
				class="offline-status-panel__warning"
				data-test="offline-status-warning"
			>
				<div class="offline-status-panel__warning-title">
					{{ bootstrapWarning.title }}
				</div>
				<div
					v-for="message in bootstrapWarning.messages"
					:key="message"
					class="offline-status-panel__warning-line"
				>
					{{ message }}
				</div>
			</div>

			<div class="offline-status-panel__section">
				<div class="offline-status-panel__section-title">
					{{ __("Offline Capabilities") }}
				</div>
				<div v-if="capabilitySummaries.length" class="offline-status-panel__resources">
					<div
						v-for="capability in capabilitySummaries"
						:key="capability.id"
						class="offline-status-panel__resource"
						:data-test="`offline-capability-${capability.id}`"
					>
						<div class="offline-status-panel__resource-head">
							<div class="offline-status-panel__resource-title">
								{{ capability.label }}
							</div>
							<div class="offline-status-panel__resource-status">
								{{ capability.status }}
							</div>
						</div>
						<div class="offline-status-panel__resource-detail">
							{{ capability.message }}
						</div>
						<div v-if="capability.action" class="offline-status-panel__resource-id">
							{{ capability.action }}
						</div>
					</div>
				</div>
				<div v-else class="offline-status-panel__empty">
					{{ __("No capability warnings recorded yet.") }}
				</div>
			</div>

			<div class="offline-status-panel__section">
				<div class="offline-status-panel__section-title">
					{{ __("Resource Health") }}
				</div>
				<div v-if="sortedResources.length" class="offline-status-panel__resources">
					<div
						v-for="resource in sortedResources"
						:key="resource.resourceId"
						class="offline-status-panel__resource"
						:data-test="`offline-status-resource-${resource.resourceId}`"
					>
						<div class="offline-status-panel__resource-head">
							<div class="offline-status-panel__resource-title">
								{{ resource.label }}
							</div>
							<div class="offline-status-panel__resource-status">
								{{ resource.status }}
							</div>
						</div>
						<div class="offline-status-panel__resource-id">
							{{ resource.resourceId }}
						</div>
						<div v-if="resource.lastError" class="offline-status-panel__resource-detail">
							{{ resource.lastError }}
						</div>
					</div>
				</div>
				<div v-else class="offline-status-panel__empty">
					{{ __("No offline sync issues recorded yet.") }}
				</div>
			</div>

			<div class="offline-status-panel__actions">
				<button
					type="button"
					data-test="offline-status-action-connectivity"
					@click="$emit('toggle-offline')"
				>
					{{ connectivityActionLabel }}
				</button>
				<button
					type="button"
					data-test="offline-status-action-refresh"
					@click="$emit('refresh-offline-data')"
				>
					{{ __("Refresh Offline Data") }}
				</button>
				<button
					type="button"
					data-test="offline-status-action-rebuild"
					@click="$emit('rebuild-offline-data')"
				>
					{{ __("Rebuild Offline Data") }}
				</button>
				<button
					type="button"
					data-test="offline-status-action-clear-cache"
					@click="$emit('clear-cache')"
				>
					{{ __("Clear Cache") }}
				</button>
				<button
					type="button"
					data-test="offline-status-action-diagnostics"
					@click="$emit('open-diagnostics')"
				>
					{{ __("View Data Diagnostics") }}
				</button>
			</div>
		</v-card>
	</transition>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { checkStoragePersistence, storagePersistenceStatus } from "../../../offline/storagePersistence";
import { getLegacyQueueRecoveryCount, exportLegacyQueueRecovery } from "../../../offline/writeQueue";
import { canRecoverLegacyQueue } from "../../../offline/queueOwnership";
import ShiftTerminalStatus from "./ShiftTerminalStatus.vue";
import { storeToRefs } from "pinia";

import { useOfflineSyncStore } from "../../stores/offlineSyncStore";

defineOptions({
	name: "OfflineStatusPanel",
});

const props = defineProps<{
	modelValue: boolean;
}>();

defineEmits<{
	(e: "update:modelValue", value: boolean): void;
	(e: "toggle-offline"): void;
	(e: "refresh-offline-data"): void;
	(e: "rebuild-offline-data"): void;
	(e: "clear-cache"): void;
	(e: "open-diagnostics"): void;
	(e: "open-money-exceptions"): void;
}>();

// @ts-ignore
const __ = (window as any).__ || ((text: string) => text);

const offlineSyncStore = useOfflineSyncStore();
const {
	summary,
	bootstrapWarning,
	capabilitySummaries,
	connectivityLabel,
	connectivityTone,
	sortedResources,
	summaryMessage,
} = storeToRefs(offlineSyncStore);

const connectivityActionLabel = computed(() =>
	summary.value.manualOffline ? __("Go Online") : __("Go Offline"),
);

const chipColor = computed(() => {
	switch (connectivityTone.value) {
		case "success":
			return "success";
		case "danger":
			return "error";
		default:
			return "warning";
	}
});

const cacheUsageLabel = computed(() => `${summary.value.cacheUsage || 0}%`);
const legacyRecoveryCount = ref(0);
const recoveryError = ref("");
const persistenceMessage = computed(() => __({
	unknown: "Storage protection has not been checked.",
	checking: "Checking browser storage protection…",
	persistent: "Automatic storage eviction protection is enabled. Keep syncing saved sales; clearing browser data still removes local records.",
	best_effort: "Browser storage may be automatically cleared. Request protection and sync saved sales when online.",
	denied: "The browser did not grant storage protection. Saved sales remain on this device; sync them when online and retry protection.",
	unsupported: "This browser cannot confirm storage protection. Sync saved sales when online and do not clear browser data.",
	error: "Storage protection could not be checked. Retry and keep saved sales syncing when online.",
}[storagePersistenceStatus.value]));
watch(() => props.modelValue, async (open) => {
	if (!open) return;
	void checkStoragePersistence();
	try { legacyRecoveryCount.value = await getLegacyQueueRecoveryCount(); }
	catch { recoveryError.value = __("Saved work could not be checked. Reopen this panel to retry."); }
}, { immediate: true });
async function exportLegacyRecovery() {
	try {
		const records = await exportLegacyQueueRecovery();
		const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `pos-saved-work-recovery-${new Date().toISOString().slice(0, 10)}.json`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	} catch (error) { recoveryError.value = String((error as Error)?.message || error); }
}

</script>

<style scoped>
.offline-status-panel {
	/* The navbar clips overflow on desktop too. Keep the panel in the body
	   and anchor it to the viewport so every recovery control stays usable. */
	position: fixed;
	top: 70px;
	right: 10px;
	width: min(360px, calc(100vw - 24px));
	/* The panel opens precisely when sync is failing — lists populated + a
	   snapshot warning — which is its tallest state. Without a cap it grows
	   past the viewport and the recovery row (Go Online / Refresh / Rebuild /
	   Clear Cache / Diagnostics) falls off the bottom with nothing to scroll.
	   Bound the whole panel to the viewport and let it own the scroll. */
	max-height: calc(100dvh - 80px);
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 16px;
	display: grid;
	gap: 14px;
	z-index: 2000;
	border: 1px solid var(--pos-border);
	box-shadow: 0 18px 40px var(--pos-shadow-dark);
}

.offline-status-panel__header,
.offline-status-panel__meta,
.offline-status-panel__resource-head,
.offline-status-panel__actions {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 10px;
}

.offline-status-panel__copy,
.offline-status-panel__section,
.offline-status-panel__resources {
	display: grid;
	gap: 6px;
}

.offline-status-panel__title {
	font-size: 14px;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.offline-status-panel__close {
	flex-shrink: 0;
	width: 44px;
	min-height: 44px;
	border-radius: 12px;
	color: var(--pos-text-primary);
	font-size: 24px;
}
.offline-status-panel__close:focus-visible {
	outline: 2px solid var(--pos-primary);
}

.offline-status-panel__subtitle,
.offline-status-panel__meta-label,
.offline-status-panel__resource-detail,
.offline-status-panel__empty,
.offline-status-panel__resource-id,
.offline-status-panel__warning-line {
	font-size: 12px;
	line-height: 1.4;
	color: var(--pos-text-secondary);
}

.offline-status-panel__meta {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
}

.offline-status-panel__meta-item {
	display: grid;
	gap: 4px;
}

.offline-status-panel__warning {
	padding: 12px;
	border-radius: 14px;
	background: rgba(255, 152, 0, 0.09);
	border: 1px solid rgba(255, 152, 0, 0.28);
	display: grid;
	gap: 6px;
}

.offline-status-panel__warning-title,
.offline-status-panel__section-title,
.offline-status-panel__resource-title,
.offline-status-panel__resource-status {
	font-size: 12px;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.offline-status-panel__resources {
	max-height: 220px;
	overflow-y: auto;
	padding-right: 4px;
}

.offline-status-panel__resource {
	padding: 10px 12px;
	border-radius: 12px;
	border: 1px solid var(--pos-border);
	background: var(--pos-card-bg);
	display: grid;
	gap: 4px;
}

.offline-status-panel__resource-status {
	text-transform: capitalize;
	color: #ff9800;
}

.offline-status-panel__actions {
	flex-wrap: wrap;
	justify-content: flex-start;
}

.offline-status-panel__actions button {
	border: 1px solid var(--pos-border);
	background: var(--pos-hover-bg);
	color: var(--pos-text-primary);
	border-radius: 999px;
	padding: 8px 12px;
	font-size: 12px;
	font-weight: 600;
	transition:
		background 0.18s ease,
		border-color 0.18s ease,
		transform 0.18s ease;
}

.offline-status-panel__actions button:hover {
	background: var(--pos-focus-bg);
	border-color: var(--pos-primary);
	transform: translateY(-1px);
}

.offline-status-panel-fade-enter-active,
.offline-status-panel-fade-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.offline-status-panel-fade-enter-from,
.offline-status-panel-fade-leave-to {
	opacity: 0;
	transform: translateY(-6px);
}

@media (max-width: 767.98px) {
	.offline-status-panel {
		width: min(340px, calc(100vw - 20px));
	}
}
</style>
