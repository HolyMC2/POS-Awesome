<template>
	<!--
		The phone's FULL offline surface (`MovilOffline.dc.html`) — a third thing,
		and deliberately not either of the two that already exist:

		  - `shell/mobile/MobileOfflineOverlay.vue` is a `role="status"` layer laid
		    over whatever tab the cashier was on, so the dock underneath stays
		    tappable. It states the situation and gets out of the way.
		  - `pos/offline/OfflineQueueView.vue` is the desktop's full surface, with
		    a five-column table and a 372 px aside.

		This one is what the cashier opens when they want to SEE the queue on a
		390 px screen: the money held, the sales behind it, and the two-column
		answer to "can I keep working?". `data-offline-scope` on each says which
		is which, so a spec can prove they were not confused for one another.
	-->
	<section
		class="movil-offline"
		data-testid="movil-offline"
		data-offline-scope="mobile-surface"
		role="region"
		:aria-label="__('Sales saved on this register')"
	>
		<div class="movil-offline__banner" :data-claim="claim.id">
			<div class="movil-offline__head">
				<div class="movil-offline__glyph" aria-hidden="true">
					<v-icon icon="mdi-cloud-off-outline" size="20" />
				</div>
				<div class="movil-offline__copy">
					<!--
						"Back online" is NOT "uploaded". The headline follows the claim
						rather than the connection, because a shopkeeper who reads
						"sigue cobrando" after the signal returned is being reassured
						about an outage that ended while their money is still queued.
					-->
					<div class="movil-offline__title">{{ __(titleKey) }}</div>
					<div v-if="claim.id === 'offline'" class="movil-offline__subtitle">
						{{ __("It uploads by itself when the signal returns") }}
					</div>
				</div>
				<div v-if="elapsed.value" class="movil-offline__since" data-testid="movil-offline-elapsed">
					<div class="movil-offline__since-label">{{ __(elapsed.labelKey) }}</div>
					<div class="movil-offline__since-value mono">{{ elapsed.value }}</div>
				</div>
			</div>

			<div class="movil-offline__held">
				<div class="movil-offline__held-copy">
					<div class="movil-offline__held-label">
						{{ __("To upload") }} · {{ page.summary.ticketCount }}
						{{ page.summary.ticketCount === 1 ? __("ticket") : __("tickets") }}
					</div>
					<!--
						THE number on this screen (§17.7 invariant 1). No band mounts on
						the phone's offline surface, so this figure is the one the
						invariant is about: money the shop has taken on faith and the
						server has not confirmed. It is SUMMED from the queue rows by
						`summariseHeldSales`, never estimated and never carried in from
						a counter that can drift from the list underneath it.
					-->
					<div
						class="movil-offline__held-amount mono"
						data-money-role="queued-total"
						data-testid="movil-offline-held"
					>
						{{ formatCurrency(page.summary.totalHeld) }}
					</div>
				</div>

				<!--
					Outlined, never filled: amber is STATE here and the phone's one
					accent belongs to the dock's primary action (§17.7 invariant 2).

					And it is not a second drain. The click emits; the container
					dispatches `useOfflineQueue.retry`, which calls the drain the
					resume hook and the navbar already call. A button that walked the
					rows itself would be a second writer over the same money and the
					failure is a sale submitted twice.
				-->
				<button
					type="button"
					class="movil-offline__retry"
					data-testid="movil-offline-retry"
					:disabled="retrying"
					:aria-busy="retrying ? 'true' : 'false'"
					@click="onRetry"
				>
					<v-icon icon="mdi-refresh" size="15" aria-hidden="true" />
					{{ retrying ? __("Retrying…") : __("Retry") }}
				</button>
			</div>
		</div>

		<MovilOfflineQueue
			:rows="page.rows"
			:hidden-held-count="page.hiddenHeldCount"
			:format-currency="formatCurrency"
		/>

		<MovilOfflineCapabilities :surfaces="surfaces" />
	</section>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { resolveUploadClaim, type HeldSale } from "../../offline/offlineQueueModel";
import {
	OFFLINE_SURFACES,
	type OfflineSurface,
} from "../../shell/mobile/offlineSurfaceManifest";
import MovilOfflineCapabilities from "./MovilOfflineCapabilities.vue";
import MovilOfflineQueue from "./MovilOfflineQueue.vue";
import { buildMobileOfflinePage, resolveOfflineElapsed } from "./movilOfflineModel";

defineOptions({ name: "MovilOfflineView" });

const props = withDefaults(
	defineProps<{
		/** Built by `useOfflineQueue`; this component never reads the queue. */
		rows?: readonly HeldSale[];
		/** `useOnlineStatus().isOnline` — server reachability, not `navigator.onLine`. */
		online?: boolean;
		/**
		 * When the shell knows the moment the connection dropped. Absent is the
		 * normal case today (nothing records it), and the fallback says a weaker
		 * but true thing instead of guessing this one.
		 */
		offlineSince?: string | null;
		/** Injected so the clock is testable; never called for free. */
		now?: Date | null;
		formatCurrency?: (value: number) => string;
		retrying?: boolean;
		/** Rows the phone draws before folding the rest into a count. */
		maxRows?: number;
		surfaces?: readonly OfflineSurface[];
	}>(),
	{
		rows: () => [],
		online: false,
		offlineSince: null,
		now: null,
		formatCurrency: (value: number) => String(value),
		retrying: false,
		maxRows: 5,
		surfaces: () => OFFLINE_SURFACES,
	},
);

const emit = defineEmits<{ retry: [] }>();

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

const page = computed(() =>
	buildMobileOfflinePage(props.rows ?? [], { maxRows: props.maxRows }),
);

const claim = computed(() =>
	resolveUploadClaim({ online: props.online, summary: page.value.summary }),
);

const titleKey = computed(() => {
	if (claim.value.id === "offline") return "Keep selling";
	return claim.value.id === "uploading"
		? "Back online — the queue is emptying itself"
		: "Everything is uploaded";
});

const elapsed = computed(() =>
	resolveOfflineElapsed({
		offlineSince: props.offlineSince,
		summary: page.value.summary,
		now: props.now ?? new Date(),
	}),
);

const onRetry = () => {
	// The guard that matters lives in `useOfflineQueue.retry`; this one only
	// keeps the DOM from dispatching while the drain is already in flight.
	if (props.retrying) return;
	emit("retry");
};
</script>

<style scoped>
/* Height chain: fill the phone column, refuse to grow past it, and let exactly
 * one descendant scroll (the queue's own list). `min-height: 0` is the
 * load-bearing half — flex items default to `min-height: auto` and nest a
 * second scrollport. */
.movil-offline {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	gap: 10px;
	padding: 10px 11px;
	background: var(--reg-surface-sunken, #f8f9fa);
	overflow: hidden;
}

.movil-offline__banner {
	flex: none;
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: 13px;
	padding: 13px 14px;
}

.movil-offline__head {
	display: flex;
	align-items: center;
	gap: 11px;
}

.movil-offline__glyph {
	width: 38px;
	height: 38px;
	flex: none;
	border-radius: 11px;
	display: grid;
	place-items: center;
	background: var(--reg-tone-warning-glyph-bg, #f7ead2);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline__copy {
	flex: 1;
	min-width: 0;
}

.movil-offline__title {
	font-size: 14.5px;
	font-weight: 700;
	line-height: 1.2;
	color: var(--reg-tone-warning-strong, #6b4a10);
}

.movil-offline__subtitle {
	margin-top: 2px;
	font-size: 11px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline__since {
	flex: none;
	text-align: right;
	line-height: 1.15;
}

.movil-offline__since-label {
	font-size: 9.5px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline__since-value {
	font-size: 16px;
	font-weight: 700;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline__held {
	display: flex;
	justify-content: space-between;
	align-items: flex-end;
	gap: 12px;
	margin-top: 11px;
	padding-top: 10px;
	border-top: 1px solid var(--reg-tone-warning-divider, #f0dcae);
}

.movil-offline__held-copy {
	min-width: 0;
}

.movil-offline__held-label {
	font-size: 9.5px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline__held-amount {
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.03em;
	line-height: 1.1;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-offline__retry {
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 7px;
	/* 44 px is the floor, not the target: this is the only control on the
	 * screen and it is pressed by someone who is already anxious. */
	min-height: 44px;
	min-width: 44px;
	padding: 0 16px;
	border-radius: 11px;
	border: 1px solid var(--reg-tone-warning-border, #e2c98f);
	background: var(--reg-surface, #fff);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font: inherit;
	font-size: 12.5px;
	font-weight: 700;
	cursor: pointer;
}

.movil-offline__retry:disabled {
	cursor: progress;
	opacity: 0.7;
}

@media (pointer: coarse) {
	.movil-offline__retry {
		min-height: 48px;
	}
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
