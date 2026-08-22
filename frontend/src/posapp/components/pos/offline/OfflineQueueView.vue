<template>
	<!--
		The DESKTOP offline surface — a different thing from
		`shell/mobile/MobileOfflineOverlay.vue`, deliberately.

		The phone treatment is a `role="status"` layer laid OVER the current tab
		so the dock underneath stays live: on a phone the cashier is mid-task and
		must not be moved. The desktop artboard is the opposite gesture — a full
		surface whose whole job is to show the evidence behind the promise, one
		row per sale the register is holding. Neither replaces the other; a
		`data-offline-scope` on each says which is which.
	-->
	<section
		class="offline-queue"
		data-testid="offline-queue"
		data-offline-scope="surface"
		role="region"
		:aria-label="__('Sales saved on this register')"
	>
		<div class="offline-queue__banner" :data-claim="claim.id">
			<div class="offline-queue__glyph" aria-hidden="true">
				<v-icon icon="mdi-cloud-off-outline" size="25" />
			</div>
			<div class="offline-queue__banner-copy">
				<div class="offline-queue__banner-head">
					<h2 class="offline-queue__title">{{ __(titleKey) }}</h2>
					<!--
						The claim, stated where the reassurance is. "Back online" is
						NOT "uploaded": the sales taken while the signal was gone have
						not reached the server yet, and the chip has to keep saying so
						until the queue is actually empty.
					-->
					<span
						class="offline-queue__chip"
						:class="`offline-queue__chip--${claim.tone}`"
						data-testid="offline-claim"
					>
						{{ claimLabel }}
					</span>
				</div>
				<!--
					The sentence that does the real work. It is the feature: a
					shopkeeper who believes it keeps selling, and the table below is
					the evidence that earns the belief.
				-->
				<p class="offline-queue__promise">
					{{
						__(
							"Everything is saved on this register and uploads by itself as soon as the signal returns. No ticket is lost and nobody has to write anything on paper.",
						)
					}}
				</p>
			</div>
			<div v-if="elapsed" class="offline-queue__elapsed" data-testid="offline-elapsed">
				<div class="offline-queue__elapsed-label">{{ __(elapsedLabelKey) }}</div>
				<div class="offline-queue__elapsed-value mono">{{ elapsed }}</div>
			</div>
			<button
				type="button"
				class="offline-queue__retry"
				data-testid="offline-retry"
				:disabled="retrying"
				:aria-busy="retrying ? 'true' : 'false'"
				@click="onRetry"
			>
				<v-icon icon="mdi-refresh" size="17" aria-hidden="true" />
				{{ retrying ? __("Retrying…") : __("Retry now") }}
			</button>
		</div>

		<div class="offline-queue__body">
			<div class="offline-queue__card offline-queue__list">
				<div class="offline-queue__list-head">
					<span class="offline-queue__label">{{ __("Sales saved on this register") }}</span>
					<!-- The ordering rule, stated on screen because it is a promise:
					     `buildHeldSales` sorts oldest-first to keep it. -->
					<span class="offline-queue__rule" data-testid="offline-order-rule">
						{{ __("they upload in order, from the oldest to the newest") }}
					</span>
				</div>

				<div
					v-if="summary.stuckCount || summary.draftReviewCount"
					class="offline-queue__attention"
					data-testid="offline-attention"
					role="status"
				>
					{{ attentionMessage }}
				</div>

				<OfflineQueueTable
					:rows="rows"
					:format-currency="formatCurrency"
					:max-rows="maxRows"
				/>

				<div v-if="hiddenCount" class="offline-queue__more" data-testid="offline-more">
					{{ __("and {0} more tickets in the queue").replace("{0}", String(hiddenCount)) }}
				</div>
			</div>

			<OfflineQueueAside
				:by-tender="summary.byTender"
				:format-currency="formatCurrency"
				:storage-label="storageLabel"
			/>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OfflineQueueAside from "./OfflineQueueAside.vue";
import OfflineQueueTable from "./OfflineQueueTable.vue";
import {
	elapsedLabel,
	resolveUploadClaim,
	summariseHeldSales,
	type HeldSale,
} from "./offlineQueueModel";

defineOptions({ name: "OfflineQueueView" });

const props = withDefaults(
	defineProps<{
		/** Built by `useOfflineQueue`; this component never reads the queue. */
		rows?: readonly HeldSale[];
		/** `useOnlineStatus().isOnline` — server reachability, not `navigator.onLine`. */
		online?: boolean;
		/**
		 * When the shell knows the moment the connection dropped. Absent is the
		 * normal case today (nothing records it), and the fallback below says a
		 * weaker but true thing instead of guessing this one.
		 */
		offlineSince?: string | null;
		/** Injected so the clock is testable; never called for free. */
		now?: Date | null;
		formatCurrency?: (value: number) => string;
		retrying?: boolean;
		/** Rows drawn before the list is folded into a count. */
		maxRows?: number;
		/** Pre-formatted by the shell, which owns the cache estimate. */
		storageLabel?: string;
	}>(),
	{
		rows: () => [],
		online: false,
		offlineSince: null,
		now: null,
		formatCurrency: (value: number) => String(value),
		retrying: false,
		maxRows: 40,
		storageLabel: "",
	},
);

const emit = defineEmits<{ retry: [] }>();

// @ts-ignore — the desk provides the translator on window, as elsewhere here.
const __ = (window as any).__ || ((text: string) => text);

const rows = computed(() => props.rows ?? []);
const summary = computed(() => summariseHeldSales(rows.value));
const claim = computed(() => resolveUploadClaim({ online: props.online, summary: summary.value }));

/**
 * The artboard's headline is the OFFLINE one, and it goes stale the moment the
 * signal returns — at which point the screen would be reassuring a shopkeeper
 * about an outage that has ended while their sales are still queued.
 */
const titleKey = computed(() =>
	claim.value.id === "offline"
		? "The internet dropped — keep selling"
		: "Back online — the queue is emptying itself",
);

const claimLabel = computed(() => {
	const label = __(claim.value.labelKey);
	return claim.value.labelParams?.length
		? label.replace("{0}", String(claim.value.labelParams[0]))
		: label;
});

const hiddenCount = computed(() =>
	props.maxRows > 0 ? Math.max(0, rows.value.length - props.maxRows) : 0,
);

/**
 * How long this has been going on, DERIVED from a timestamp and the injected
 * clock rather than stored or counted up.
 *
 * Two sources, and the label changes with them because they are two different
 * facts: the shell's `offlineSince` is when the connection dropped; the oldest
 * held sale is when the register last managed to hand money to the server.
 * Naming the weaker one "sin conexión desde" would be the same class of lie as
 * "En línea · sincronizado" over a full queue.
 */
const elapsedSource = computed<"connection" | "queue" | "none">(() => {
	if (props.offlineSince) return "connection";
	if (summary.value.oldestHeldAt) return "queue";
	return "none";
});

const elapsed = computed(() => {
	const from =
		elapsedSource.value === "connection" ? props.offlineSince : summary.value.oldestHeldAt;
	return from ? elapsedLabel(from, props.now ?? new Date()) : "";
});

const elapsedLabelKey = computed(() =>
	elapsedSource.value === "connection" ? "No connection for" : "Holding sales for",
);

const attentionMessage = computed(() => {
	const stuck = summary.value.stuckCount;
	const drafts = summary.value.draftReviewCount;
	const parts: string[] = [];
	if (stuck) {
		parts.push(
			stuck === 1
				? __("1 sale could not be uploaded")
				: __("{0} sales could not be uploaded").replace("{0}", String(stuck)),
		);
	}
	if (drafts) {
		parts.push(
			drafts === 1
				? __("1 sale was saved as a draft to review")
				: __("{0} sales were saved as drafts to review").replace("{0}", String(drafts)),
		);
	}
	return `${parts.join(" · ")} · ${__("open Offline Invoices to retry or export them")}`;
});

const onRetry = () => {
	// The guard that matters lives in `useOfflineQueue.retry`; this one only
	// keeps the DOM from dispatching while the drain is already in flight.
	if (props.retrying) return;
	emit("retry");
};
</script>

<style scoped>
/* Height chain (59c5fe1ad): fill the column, refuse to grow past it, and let
 * exactly one descendant scroll. `min-height: 0` is the load-bearing half —
 * flex items default to `min-height: auto` and nest a second scrollport. */
.offline-queue {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	gap: var(--reg-space-md, 10px);
	padding: var(--reg-space-lg, 14px);
	background: var(--reg-surface-sunken, #f8f9fa);
	overflow: hidden;
}

.offline-queue__banner {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: 18px;
	min-height: 88px;
	padding: 12px var(--reg-space-xl, 22px);
	border-radius: var(--reg-radius-md, 14px);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
}

.offline-queue__glyph {
	width: 48px;
	height: 48px;
	flex: none;
	border-radius: 13px;
	display: grid;
	place-items: center;
	background: var(--reg-tone-warning-glyph-bg, #f7ead2);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.offline-queue__banner-copy {
	flex: 1;
	min-width: 0;
}

.offline-queue__banner-head {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
}

.offline-queue__title {
	margin: 0;
	font-size: 19px;
	font-weight: 700;
	letter-spacing: -0.015em;
	color: var(--reg-tone-warning-strong, #6b4a10);
}

.offline-queue__promise {
	margin: 3px 0 0;
	font-size: 13px;
	line-height: 1.45;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.offline-queue__elapsed {
	flex: none;
	text-align: right;
	line-height: 1.15;
}

.offline-queue__elapsed-label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.offline-queue__elapsed-value {
	font-size: 24px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

/* Outlined, never filled: the one accent on this screen belongs to the band's
 * primary action (§17.7 invariant 2), and amber here is STATE. */
.offline-queue__retry {
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: 9px;
	height: 46px;
	padding: 0 20px;
	border-radius: 11px;
	border: 1px solid var(--reg-tone-warning-border, #e2c98f);
	background: var(--reg-surface, #fff);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font: inherit;
	font-size: 14px;
	font-weight: 700;
	cursor: pointer;
}

.offline-queue__retry:disabled {
	cursor: progress;
	opacity: 0.7;
}

.offline-queue__body {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	gap: var(--reg-space-md, 10px);
}

.offline-queue__card {
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	overflow: hidden;
}

.offline-queue__list {
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.offline-queue__list-head {
	flex: none;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	padding: 13px 16px 8px;
}

.offline-queue__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.offline-queue__label--wait {
	color: var(--reg-tone-warning-heading, #a15200);
	margin-top: 10px;
}

.offline-queue__rule {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.offline-queue__attention {
	flex: none;
	margin: 0 16px 8px;
	padding: 8px 12px;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	color: var(--reg-tone-warning-strong, #6b4a10);
	font-size: 12.5px;
	font-weight: 500;
}

.offline-queue__more {
	flex: none;
	padding: 11px 16px;
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: 12.5px;
	color: var(--reg-text-muted, #667085);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
