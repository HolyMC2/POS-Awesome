<template>
	<!--
		The right-hand column of `Offline.dc.html`: what still works, what has to
		wait, and what is guaranteed while it waits.

		Separate from `OfflineQueueView.vue` because it renders no queue — every
		line here is a DECLARATION (the offline surface manifest, the promises and
		their citations) rather than a row, and keeping the two apart stops the
		table's grid and this column's stack from being read as one layout.
	-->
	<aside class="offline-aside">
		<div class="offline-aside__label">{{ __("You can") }}</div>
		<div
			v-for="surface in worksOffline"
			:key="surface.id"
			class="offline-aside__line"
			:data-offline-surface="surface.id"
			:data-offline-availability="surface.availability"
		>
			<v-icon class="offline-aside__tick" icon="mdi-check-circle-outline" size="14" aria-hidden="true" />
			{{ __(surface.labelKey) }}
		</div>

		<div class="offline-aside__divider" aria-hidden="true"></div>

		<div class="offline-aside__label offline-aside__label--wait">{{ __("Waiting for signal") }}</div>
		<div
			v-for="surface in needsSignal"
			:key="surface.id"
			class="offline-aside__line offline-aside__line--wait"
			:data-offline-surface="surface.id"
			:data-offline-availability="surface.availability"
		>
			{{ __(surface.labelKey) }}
		</div>

		<div v-if="byTender.length" class="offline-aside__panel" data-testid="offline-by-tender">
			<div class="offline-aside__label">{{ __("To upload by payment method") }}</div>
			<div v-for="tender in byTender" :key="tender.label" class="offline-aside__row">
				<span>{{ tender.isLiteral ? tender.label : __(tender.label) }}</span>
				<!-- A breakdown, never a second total: the band owns the one number. -->
				<span class="mono" data-money-role="breakdown">{{ formatCurrency(tender.amount) }}</span>
			</div>
		</div>

		<div class="offline-aside__panel" data-testid="offline-promises">
			<div class="offline-aside__label">{{ __("Nothing is lost") }}</div>
			<!-- Each promise names the module that makes it checkable — R4's ruling,
			     so a reassurance cannot outlive the code behind it. -->
			<div
				v-for="promise in promises"
				:key="promise.id"
				class="offline-aside__line"
				:data-promise="promise.id"
				:data-backed-by="promise.backedBy"
			>
				<v-icon class="offline-aside__tick" icon="mdi-check" size="13" aria-hidden="true" />
				{{ __(promise.labelKey) }}
			</div>
		</div>

		<div v-if="storageLabel" class="offline-aside__panel" data-testid="offline-storage">
			<div class="offline-aside__row">
				<span>{{ __("Storage used on this register") }}</span>
				<span class="mono">{{ storageLabel }}</span>
			</div>
		</div>
	</aside>
</template>

<script setup lang="ts">
import { computed } from "vue";

import {
	OFFLINE_SURFACES,
	surfacesThatNeedSignal,
	surfacesThatWorkOffline,
} from "../shell/mobile/offlineSurfaceManifest";
import { QUEUE_PROMISES, type TenderTotal } from "./offlineQueueModel";

defineOptions({ name: "OfflineQueueAside" });

const props = withDefaults(
	defineProps<{
		byTender?: readonly TenderTotal[];
		formatCurrency?: (value: number) => string;
		/** Pre-formatted by the shell, which owns the cache estimate. */
		storageLabel?: string;
	}>(),
	{
		byTender: () => [],
		formatCurrency: (value: number) => String(value),
		storageLabel: "",
	},
);

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

const byTender = computed(() => props.byTender ?? []);

// The manifest is imported, never restated: it is the audited answer to "can
// the shop still do this thing?" and the phone reads the same list.
const worksOffline = computed(() => surfacesThatWorkOffline(OFFLINE_SURFACES));
const needsSignal = computed(() => surfacesThatNeedSignal(OFFLINE_SURFACES));
const promises = QUEUE_PROMISES;
</script>

<style scoped>
.offline-aside {
	width: 372px;
	flex: none;
	padding: 16px;
	overflow-y: auto;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.offline-aside__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.offline-aside__label--wait {
	color: var(--reg-tone-warning-heading, #a15200);
	margin-top: 10px;
}

.offline-aside__line {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
	font-size: 12.5px;
	line-height: 1.4;
	color: var(--reg-text-secondary, #4a5260);
}

.offline-aside__line--wait {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.offline-aside__tick {
	color: var(--reg-tone-positive-tick, #2e7d32);
	flex: none;
}

.offline-aside__divider {
	height: 1px;
	background: var(--reg-divider, #eceff3);
	margin: 12px 0 2px;
}

.offline-aside__panel {
	margin-top: 12px;
	padding: 13px 14px;
	border-radius: 12px;
	background: var(--reg-surface-sunken, #fafbfc);
	border: 1px solid var(--reg-border-light, #eff2f5);
}

.offline-aside__row {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #4a5260);
	margin-top: 6px;
}

.offline-aside__row:first-of-type {
	margin-top: 8px;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
