<template>
	<div class="orden-queue" data-testid="orden-queue">
		<label class="orden-queue__search">
			<v-icon icon="mdi-magnify" size="17" class="orden-queue__search-icon" />
			<input
				ref="searchEl"
				class="orden-queue__search-input"
				type="search"
				:value="query"
				:placeholder="__('Folio, IMEI or phone…')"
				:aria-label="__('Find a service order')"
				data-testid="orden-search"
				@input="$emit('update:query', ($event.target as HTMLInputElement).value)"
			/>
		</label>

		<div class="orden-queue__chips" data-testid="orden-chips">
			<template v-for="chip in chips" :key="chip.id">
				<button
					v-if="chip.selectable"
					type="button"
					class="orden-queue__chip"
					:class="{ 'orden-queue__chip--on': chip.active }"
					:data-bucket="chip.id"
					:aria-pressed="chip.active"
					@click="$emit('bucket', chip.id)"
				>
					{{ __(chip.labelKey) }}
					<span v-if="chip.count" class="orden-queue__chip-count">{{ chip.count }}</span>
				</button>
				<!-- «En trabajo» is a FIGURE, not a door — Taller owns that work,
				     and this surface's only verb is COBRAR Y ENTREGAR. It used to
				     render as a disabled pill between the filters, and a pill that
				     never presses reads as a broken button (reported from the
				     register, 08-24). So: right-aligned, a wrench, a number, no
				     pill — nothing about it claims it can be pressed. The tooltip
				     reuses the footer's own sentence rather than minting a new
				     string. -->
				<span
					v-else
					class="orden-queue__figure"
					:data-bucket="chip.id"
					:title="
						__('Service orders are created and worked in Taller. The register only charges them.')
					"
					data-testid="orden-working-figure"
				>
					<svg
						class="orden-queue__figure-icon"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
						/>
					</svg>
					<span class="orden-queue__figure-count mono">{{ chip.count }}</span>
					{{ __("in Taller") }}
				</span>
			</template>
		</div>

		<div class="orden-queue__list" data-testid="orden-cards">
			<div v-if="loading" class="orden-queue__note">
				<v-progress-circular indeterminate size="22" width="2" />
			</div>

			<p v-else-if="!cards.length" class="orden-queue__note" data-testid="orden-empty">
				{{ emptyMessage }}
			</p>

			<!-- `v-for` inside a `<template v-else>` rather than beside a `v-else`
			     on the button itself: `v-if` outranks `v-for` on one element in
			     Vue 3, so the branch is decided before `card` is in scope and the
			     row's own `@click` never binds — the click falls through to the
			     host as a bare native event. -->
			<template v-else>
				<button
					v-for="card in cards"
					:key="card.name"
					type="button"
					class="orden-queue__card"
					:class="[
						`orden-queue__card--${stateOf(card).tone}`,
						{ 'orden-queue__card--on': card.name === selected },
					]"
					:data-testid="`orden-card-${card.name}`"
					:aria-pressed="card.name === selected"
					@click="$emit('select', card.name)"
				>
					<span class="orden-queue__card-head">
						<span class="orden-queue__folio mono">#{{ card.folio }}</span>
						<span class="orden-queue__state">{{ __(stateOf(card).labelKey) }}</span>
					</span>
					<span class="orden-queue__title">{{ card.title }}</span>
					<span class="orden-queue__customer">{{ card.customer_name }}</span>
					<!-- Order hub (D3): a Source-mode row settles through its own
					     document — the cashier must see it is a different gesture
					     BEFORE pressing the band. -->
					<span
						v-if="card.settle_mode === 'Source'"
						class="orden-queue__source-badge"
						data-testid="orden-source-badge"
					>
						{{ __("Settles at source") }}
					</span>
					<span class="orden-queue__money">
						<span class="orden-queue__aside">{{ asideFor(card) }}</span>
						<span class="orden-queue__amount mono">{{
							formatCurrency(card.amount_total)
						}}</span>
					</span>
				</button>
			</template>
		</div>

		<p class="orden-queue__provenance">
			{{ __("Service orders are created and worked in Taller. The register only charges them.") }}
		</p>
	</div>
</template>

<script setup lang="ts">
/**
 * The queue column of the Orden surface (artboard `Orden.dc.html`, left card).
 *
 * Presentational: it holds no request, fetches nothing and decides nothing
 * about money. Every rule it renders — which chips exist, what a card's state
 * is, whether a card answers the search — comes from `ordenModel.ts`, so the
 * rules can be tested without mounting this.
 *
 * The cards are `<button>`s rather than divs with a click handler, because a
 * queue is a list of things you choose between and the keyboard has to be able
 * to walk it. That is also why the state chip is TEXT beside the tone rather
 * than a tint alone (§17.7: colour is state, never the only carrier of it).
 */
import { computed, ref } from "vue";

import { describeAdvance, describeCardState, type OrdenBucketId, type OrdenChip } from "./ordenModel";
import type { ServiceOrderCard } from "../../../../services/serviceOrderService";

const props = defineProps<{
	cards: ServiceOrderCard[];
	chips: OrdenChip[];
	query: string;
	selected: string | null;
	loading?: boolean;
	bucket: OrdenBucketId;
	formatCurrency: (value: number) => string;
}>();

defineEmits<{
	"update:query": [string];
	bucket: [OrdenBucketId];
	select: [string];
}>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const searchEl = ref<HTMLInputElement | null>(null);

const stateOf = (card: ServiceOrderCard) => describeCardState(card);

/**
 * The small line to the left of the price.
 *
 * Priority is the card's, not the money's: a note explaining why this card is
 * dimmed («No se puede cobrar dos veces») matters more than the advance, and
 * an order with neither says nothing rather than "Sin anticipo" — the artboard
 * prints that only where there is a price to contrast it against, and a
 * placeholder costs the same width as a fact.
 */
const asideFor = (card: ServiceOrderCard): string => {
	const state = stateOf(card);
	if (state.noteKey) {
		return (state.noteParams ?? []).reduce<string>(
			(text, value, index) => text.replace(`{${index}}`, String(value)),
			__(state.noteKey),
		);
	}
	const advance = describeAdvance(card);
	if (advance) {
		return `${__(advance.labelKey)} ${props.formatCurrency(advance.amount)}`;
	}
	return __("No advance");
};

const emptyMessage = computed(() =>
	props.bucket === "delivered"
		? __("Nothing has been handed over yet today.")
		: props.query
			? __("No service order matches that.")
			: __("No service order is ready to charge."),
);

defineExpose({ focusSearch: () => searchEl.value?.focus() });
</script>

<style scoped>
.orden-queue {
	display: flex;
	flex-direction: column;
	width: 330px;
	flex: none;
	min-height: 0;
	padding: var(--reg-space-lg, 14px);
	gap: var(--reg-space-md, 10px);
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.orden-queue__search {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	height: 44px;
	flex: none;
	padding: 0 12px;
	border: 1px solid var(--reg-border-soft, #e2e6ec);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-sunken, #fbfcfd);
}

.orden-queue__search-icon {
	color: var(--reg-text-muted, #b3bac4);
}

.orden-queue__search-input {
	flex: 1;
	min-width: 0;
	border: 0;
	background: none;
	font: inherit;
	font-size: 13.5px;
	color: var(--reg-text-primary, #212121);
	outline: none;
}

.orden-queue__chips {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	flex: none;
}

.orden-queue__chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	border: 0;
	border-radius: 999px;
	padding: 3px 9px;
	font: inherit;
	font-size: 11.5px;
	font-weight: 500;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: pointer;
}

/* Not a fill: the wash is the same pale derivative the tender chips use, and
   the saturated accent on this screen belongs to the band's primary alone. */
.orden-queue__chip--on {
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.orden-queue__chip-count {
	font-variant-numeric: tabular-nums;
}

/* The workshop count. Everything about it says "fact": pushed to the far
   side of the row, no pill, no border, default cursor. The icon rides
   currentColor at a step below the text so the number stays the loudest
   part — it is the only piece of this the cashier actually reads. */
.orden-queue__figure {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	margin-inline-start: auto;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
	cursor: default;
}

.orden-queue__figure-icon {
	color: var(--reg-text-muted, #9aa2ae);
	opacity: 0.75;
	flex: none;
}

.orden-queue__figure-count {
	font-weight: 700;
	color: var(--reg-text-secondary, #56606e);
}

.orden-queue__list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.orden-queue__card {
	display: flex;
	flex-direction: column;
	gap: 3px;
	width: 100%;
	text-align: left;
	padding: 10px 12px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: 11px;
	background: var(--reg-surface, #fff);
	font: inherit;
	cursor: pointer;
}

.orden-queue__card--on {
	border: 2px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	padding: 9px 11px;
}

/* An invoiced order is dimmed AND says why (see `asideFor`). The dim alone
   would be a card that looks broken rather than a card that is finished. */
.orden-queue__card--muted {
	opacity: 0.6;
}

.orden-queue__card-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
}

.mono {
	font-variant-numeric: tabular-nums;
}

.orden-queue__folio {
	font-size: 14px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.orden-queue__card--on .orden-queue__folio {
	color: var(--reg-on-accent-soft, #00646f);
}

.orden-queue__state {
	font-size: 11.5px;
	font-weight: 500;
	white-space: nowrap;
	color: var(--reg-text-muted, #667085);
}

.orden-queue__card--ready .orden-queue__state {
	color: var(--reg-tone-positive-label, #1b5e20);
	font-weight: 700;
}

.orden-queue__card--warning .orden-queue__state {
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.orden-queue__title {
	font-size: 12.5px;
	color: var(--reg-text-primary, #212121);
}

.orden-queue__customer {
	font-size: 11px;
	color: var(--reg-text-secondary, #4a5260);
}

.orden-queue__money {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
	margin-top: 4px;
}

.orden-queue__aside {
	font-size: 11px;
	color: var(--reg-text-muted, #9aa2ae);
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.orden-queue__card--ready .orden-queue__aside {
	color: var(--reg-tone-positive-number, #2f7a55);
}

.orden-queue__card--warning .orden-queue__aside {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.orden-queue__amount {
	font-size: 13px;
	font-weight: 700;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

.orden-queue__card--muted .orden-queue__amount {
	color: var(--reg-text-muted, #9aa2ae);
}

.orden-queue__note {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px 8px;
	margin: 0;
	font-size: 12.5px;
	text-align: center;
	color: var(--reg-text-muted, #9aa2ae);
}

.orden-queue__provenance {
	flex: none;
	margin: 0;
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: 11px;
	line-height: 1.4;
	color: var(--reg-text-muted, #9aa2ae);
}

/* Order hub (D3): the Source-mode marker — a different gesture, visibly. */
.orden-queue__source-badge {
	align-self: flex-start;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: 999px;
	padding: 0 8px;
	font-size: 11px;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #9aa2ae);
}
</style>
