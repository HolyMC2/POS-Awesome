<template>
	<!--
		Offline is a STATE, not a destination. The artboard's note says it out
		loud: "el estado sin conexión se pone ENCIMA de lo que estabas haciendo,
		no te saca de ahí." So this layer stops short of the dock — `bottom` is
		the dock's own height — and it is deliberately NOT a dialog: no focus
		trap, no `aria-modal`, no inert background. The cashier can still tap
		Carrito underneath while reading it, which is the whole point.

		`role="status"` + `aria-live="polite"` because losing signal is an
		announcement, not a prompt: it must reach a screen reader without
		stealing the focus out of whatever field was being typed into.
	-->
	<div
		v-if="visible"
		class="mobile-offline-overlay"
		:class="{ 'mobile-offline-overlay--collapsed': collapsed }"
		data-testid="offline-overlay"
		data-offline-scope="overlay"
		:data-offline-collapsed="collapsed ? 'true' : 'false'"
		role="status"
		aria-live="polite"
		:style="{ bottom: `${dockHeight}px` }"
	>
		<!--
			Folded: one strip above the dock, and ONLY the strip takes taps.
			The full sheet used to stay over the catalogue for the whole outage,
			so while it read «You can: Charge and print» no card could be
			tapped and the phone could not ring up a sale at all (live drill,
			demo-abarrotes.lab, 2026-09-04). The sheet is for the moment the
			signal drops; the strip is for the sale that goes on.
		-->
		<button
			v-if="collapsed"
			type="button"
			class="mobile-offline-overlay__strip"
			data-testid="offline-overlay-strip"
			@click="expand"
		>
			<v-icon icon="mdi-cloud-off-outline" size="16" aria-hidden="true" />
			<span class="mobile-offline-overlay__strip-text">
				{{ __("no signal") }} · {{ __("To upload") }} · {{ pendingCount }}
				{{ pendingCount === 1 ? __("ticket") : __("tickets") }}
				<template v-if="queuedAmountLabel"> · <span class="mono">{{ queuedAmountLabel }}</span></template>
			</span>
			<span class="mobile-offline-overlay__strip-more">{{ __("Details") }}</span>
		</button>

		<div v-if="!collapsed" class="mobile-offline-overlay__card">
			<div class="mobile-offline-overlay__head">
				<div class="mobile-offline-overlay__glyph" aria-hidden="true">
					<v-icon icon="mdi-cloud-off-outline" size="20" />
				</div>
				<div class="mobile-offline-overlay__copy">
					<div class="mobile-offline-overlay__title">{{ __("Keep selling") }}</div>
					<div class="mobile-offline-overlay__subtitle">
						{{ __("It uploads by itself when the signal returns") }}
					</div>
				</div>
				<div v-if="offlineSinceLabel" class="mobile-offline-overlay__since">
					<div class="mobile-offline-overlay__since-label">{{ __("no signal") }}</div>
					<div class="mobile-offline-overlay__since-value mono">{{ offlineSinceLabel }}</div>
				</div>
			</div>

			<div class="mobile-offline-overlay__queue">
				<div>
					<div class="mobile-offline-overlay__queue-label">
						{{ __("To upload") }} · {{ pendingCount }}
						{{ pendingCount === 1 ? __("ticket") : __("tickets") }}
					</div>
					<!--
						The one number that matters in this state (§17.7, "one number,
						one action"). It is the amount the shop has taken but not yet
						banked, which is the only figure a cashier actually worries
						about while the network is down.
					-->
					<div class="mobile-offline-overlay__queue-amount mono">{{ queuedAmountLabel }}</div>
				</div>
				<slot name="action">
					<button
						type="button"
						class="mobile-offline-overlay__continue"
						data-testid="offline-overlay-continue"
						@click="collapse"
					>
						{{ __("Continue selling") }}
					</button>
				</slot>
			</div>
		</div>

		<div v-if="!collapsed" class="mobile-offline-overlay__card mobile-offline-overlay__split">
			<div class="mobile-offline-overlay__col">
				<div class="mobile-offline-overlay__col-label">{{ __("You can") }}</div>
				<div
					v-for="surface in worksOffline"
					:key="surface.id"
					class="mobile-offline-overlay__line"
					:data-offline-surface="surface.id"
					:data-offline-availability="surface.availability"
				>
					<v-icon
						class="mobile-offline-overlay__tick"
						icon="mdi-check-circle-outline"
						size="14"
						aria-hidden="true"
					/>
					{{ __(surface.labelKey) }}
				</div>
			</div>
			<div class="mobile-offline-overlay__rule" aria-hidden="true"></div>
			<div class="mobile-offline-overlay__col">
				<div class="mobile-offline-overlay__col-label mobile-offline-overlay__col-label--wait">
					{{ __("Waiting for signal") }}
				</div>
				<div
					v-for="surface in needsSignal"
					:key="surface.id"
					class="mobile-offline-overlay__line mobile-offline-overlay__line--wait"
					:data-offline-surface="surface.id"
					:data-offline-availability="surface.availability"
				>
					{{ __(surface.labelKey) }}
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import {
	OFFLINE_SURFACES,
	surfacesThatNeedSignal,
	surfacesThatWorkOffline,
	type OfflineSurface,
} from "./offlineSurfaceManifest";

defineOptions({ name: "MobileOfflineOverlay" });

const props = withDefaults(
	defineProps<{
		/** The shell owns "are we offline?" — this component never probes. */
		visible: boolean;
		pendingCount?: number;
		/** Pre-formatted by the shell, which owns the register's currency. */
		queuedAmountLabel?: string;
		/** e.g. "1 h 47 m". Empty hides the block rather than showing a zero. */
		offlineSinceLabel?: string;
		/** Measured dock height, so the overlay never covers the dock. */
		dockHeight?: number;
		surfaces?: readonly OfflineSurface[];
	}>(),
	{
		pendingCount: 0,
		queuedAmountLabel: "",
		offlineSinceLabel: "",
		dockHeight: 0,
		surfaces: () => OFFLINE_SURFACES,
	},
);

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

const worksOffline = computed(() => surfacesThatWorkOffline(props.surfaces));
const needsSignal = computed(() => surfacesThatNeedSignal(props.surfaces));

/**
 * Folded or open. The fold is per OUTAGE: a cashier who tapped «Continue
 * selling» keeps the strip until the signal is back, and the next time it
 * drops the full sheet returns — losing signal is an announcement each time.
 */
const collapsed = ref(false);
const collapse = () => {
	collapsed.value = true;
};
const expand = () => {
	collapsed.value = false;
};
watch(
	() => props.visible,
	(now, before) => {
		if (now && !before) collapsed.value = false;
	},
);
</script>

<style scoped>
.mobile-offline-overlay {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	z-index: 6;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px 11px 0;
	overflow-y: auto;
	background: var(--reg-surface-sunken, #f8f9fa);
}

/* Folded: the layer shrinks to its strip and stops catching taps — the
 * catalogue, the cart and the keypad underneath are the cashier's again. */
.mobile-offline-overlay--collapsed {
	top: auto;
	padding: 0 8px 6px;
	overflow: visible;
	background: transparent;
	pointer-events: none;
}

.mobile-offline-overlay__strip {
	pointer-events: auto;
	width: 100%;
	min-height: 40px;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	border-radius: 11px;
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-strong, #6b4a10);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	text-align: left;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.mobile-offline-overlay__strip-text {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mobile-offline-overlay__strip-more {
	flex: none;
	font-size: 11px;
	text-decoration: underline;
}

.mobile-offline-overlay__continue {
	flex: none;
	min-height: 44px;
	padding: 0 16px;
	border-radius: 11px;
	border: 0;
	/* strong/bg swap together per palette: dark brown on cream in light,
	   dark brown text on light amber in dark — AA in both. */
	background: var(--reg-tone-warning-strong, #6b4a10);
	color: var(--reg-tone-warning-bg, #fdf9f0);
	font: inherit;
	font-size: 13px;
	font-weight: 700;
}

.mobile-offline-overlay__card {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: 13px;
	padding: 13px 14px;
	flex: none;
}

.mobile-offline-overlay__head {
	display: flex;
	align-items: center;
	gap: 11px;
}

.mobile-offline-overlay__glyph {
	width: 38px;
	height: 38px;
	border-radius: 11px;
	background: var(--reg-tone-warning-glyph-bg, #f7ead2);
	display: grid;
	place-items: center;
	flex: none;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mobile-offline-overlay__copy {
	flex: 1;
	min-width: 0;
}

.mobile-offline-overlay__title {
	font-size: 14.5px;
	font-weight: 700;
	color: var(--reg-tone-warning-strong, #6b4a10);
	line-height: 1.2;
}

.mobile-offline-overlay__subtitle {
	font-size: 11px;
	color: var(--reg-tone-warning-label, #8a5a0d);
	margin-top: 2px;
}

.mobile-offline-overlay__since {
	text-align: right;
	line-height: 1.15;
}

.mobile-offline-overlay__since-label {
	font-size: 9.5px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mobile-offline-overlay__since-value {
	font-size: 16px;
	font-weight: 700;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mobile-offline-overlay__queue {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	margin-top: 11px;
	padding-top: 10px;
	border-top: 1px solid var(--reg-tone-warning-divider, #f0dcae);
	gap: 12px;
}

.mobile-offline-overlay__queue-label {
	font-size: 9.5px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mobile-offline-overlay__queue-amount {
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.03em;
	color: var(--reg-tone-warning-label, #8a5a0d);
	line-height: 1.1;
}

/* The "what works / what waits" card is neutral, not amber: it is reference,
 * not alarm. Only the queue card carries the state colour. */
.mobile-offline-overlay__split {
	display: flex;
	gap: 12px;
	background: var(--reg-surface, #fff);
	border-color: var(--reg-border-light, rgba(0, 0, 0, 0.06));
	padding: 11px 13px;
}

.mobile-offline-overlay__col {
	flex: 1;
	min-width: 0;
}

.mobile-offline-overlay__rule {
	width: 1px;
	background: var(--reg-divider-soft, #f2f4f7);
	flex: none;
}

.mobile-offline-overlay__col-label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
	margin-bottom: 7px;
}

.mobile-offline-overlay__col-label--wait {
	color: var(--reg-tone-warning-heading, #a15200);
}

.mobile-offline-overlay__line {
	display: flex;
	align-items: center;
	gap: 7px;
	font-size: 11px;
	color: var(--reg-text-secondary, #4a5260);
	margin-bottom: 5px;
	line-height: 1.5;
}

.mobile-offline-overlay__line--wait {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mobile-offline-overlay__tick {
	color: var(--reg-tone-positive-tick, #2e7d32);
	flex: none;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
