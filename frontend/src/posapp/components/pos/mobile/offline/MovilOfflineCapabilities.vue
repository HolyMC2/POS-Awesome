<template>
	<!--
		`Sí puedes` against `Espera señal` — the part of this screen a shopkeeper
		actually reads, because it is the answer to the only question they have:
		can I keep working?

		Every line comes from `offlineSurfaceManifest.ts` and none of them is
		written here. That manifest answers "is this surface usable with no
		server at all?", which is a property of the product; the sync store's
		`capabilitySummaries` answers "has the cache finished downloading this?",
		which changes minute to minute and would make this column flicker between
		true statements about a different question. §8 R4 audited these values —
		three of ten were wrong — so a hardcoded copy here would be a fourth.
	-->
	<div class="movil-offline-caps" data-testid="movil-offline-capabilities">
		<div class="movil-offline-caps__col">
			<div class="movil-offline-caps__label">{{ __("You can") }}</div>
			<div
				v-for="surface in columns.canDo"
				:key="surface.id"
				class="movil-offline-caps__line"
				data-testid="movil-offline-can"
				:data-offline-surface="surface.id"
				:data-offline-availability="surface.availability"
			>
				<span class="movil-offline-caps__tick" aria-hidden="true">
					<v-icon icon="mdi-check" size="10" />
				</span>
				{{ __(surface.labelKey) }}
			</div>
		</div>

		<div class="movil-offline-caps__rule" aria-hidden="true"></div>

		<div class="movil-offline-caps__col">
			<div class="movil-offline-caps__label movil-offline-caps__label--wait">
				{{ __("Waiting for signal") }}
			</div>
			<div
				v-for="surface in columns.mustWait"
				:key="surface.id"
				class="movil-offline-caps__line movil-offline-caps__line--wait"
				data-testid="movil-offline-wait"
				:data-offline-surface="surface.id"
				:data-offline-availability="surface.availability"
			>
				{{ __(surface.labelKey) }}
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import {
	OFFLINE_SURFACES,
	type OfflineSurface,
} from "../../shell/mobile/offlineSurfaceManifest";
import { mobileCapabilityColumns } from "./movilOfflineModel";

defineOptions({ name: "MovilOfflineCapabilities" });

const props = withDefaults(
	defineProps<{
		/** Overridable only so a spec can prove the columns are data-driven. */
		surfaces?: readonly OfflineSurface[];
	}>(),
	{ surfaces: () => OFFLINE_SURFACES },
);

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

// One call, not two filters: a future edit cannot narrow one column and leave
// the other claiming a surface it no longer contradicts.
const columns = computed(() => mobileCapabilityColumns(props.surfaces));
</script>

<style scoped>
/* Neutral, not amber: this card is reference, not alarm. Only the banner
 * carries the state colour. */
.movil-offline-caps {
	display: flex;
	gap: 12px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: 12px;
	padding: 11px 13px;
}

.movil-offline-caps__col {
	flex: 1;
	min-width: 0;
}

.movil-offline-caps__rule {
	width: 1px;
	flex: none;
	background: var(--reg-divider-soft, #f2f4f7);
}

.movil-offline-caps__label {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #8b93a0);
	margin-bottom: 7px;
}

.movil-offline-caps__label--wait {
	color: var(--reg-tone-warning-heading, #a15200);
}

.movil-offline-caps__line {
	display: flex;
	align-items: center;
	gap: 7px;
	font-size: 11px;
	line-height: 1.5;
	color: var(--reg-text-secondary, #4a5260);
	margin-bottom: 5px;
}

.movil-offline-caps__line:last-child {
	margin-bottom: 0;
}

.movil-offline-caps__line--wait {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline-caps__tick {
	display: grid;
	place-items: center;
	width: 18px;
	height: 18px;
	flex: none;
	border-radius: 50%;
	background: var(--reg-tone-positive-bg, #e8f5e8);
	color: var(--reg-tone-positive-tick, #157a48);
}
</style>
