<template>
	<section class="cliente-story" data-testid="cliente-story">
		<header class="cliente-story__head">
			<span class="cliente-story__label">{{ __("Story with the shop") }}</span>
			<div v-if="totals.purchases" class="cliente-story__totals" data-testid="cliente-story-totals">
				<span class="cliente-story__total">{{ purchasesLabel }}</span>
				<span class="cliente-story__total">{{ spentLabel }}</span>
				<span class="cliente-story__total">{{ lastLabel }}</span>
			</div>
		</header>

		<div class="cliente-story__body">
			<p v-if="loading" class="cliente-story__note">{{ __("Reading what happened…") }}</p>

			<p v-else-if="errorMessage" class="cliente-story__note" data-testid="cliente-story-error">
				{{ errorMessage }}
			</p>

			<OrderStory
				v-else
				:payload="story"
				:format-currency="formatCurrency"
				:empty-key="'Nothing in this window.'"
				:title="''"
			/>
		</div>

		<!-- The honesty footer. The window is a SCOPE, not a complete account,
		     and a customer's history that quietly stops looks like a customer
		     who quietly stopped buying. The second half draws the line the
		     owner keeps drawing: this surface is the relationship, not the
		     books. -->
		<p class="cliente-story__footer" data-testid="cliente-story-scope">{{ scopeLabel }}</p>
	</section>
</template>

<script setup lang="ts">
/**
 * «Historia con la tienda» — the purchase timeline, on the contact view
 * (artboard `Cliente.dc.html`, right column).
 *
 * It reuses `OrderStory` untouched through its `payload` seam — the same
 * component that draws a repair order's timeline and the strip's «historial»
 * dialog. A cashier learns to read ONE timeline, not three, and the rows here
 * come from `get_customer_story`, which is the read model that already exists.
 *
 * THE TOTALS ARE READ OFF THE ROWS BELOW THEM. `storyTotals` counts the events
 * the timeline is about to draw, so the figure and the window under it can
 * never disagree. A second endpoint for a lifetime total would put "23
 * compras" above a ninety-day list — which is the shape of every "my numbers
 * do not add up" support call.
 *
 * WALLET EVENTS ARE NOT MERGED IN, and that is a decision rather than an
 * omission. The artboard draws a deposit in this column; `OrderStory`'s
 * vocabulary (`EVENT_LABELS` in `flows/orden/orderStory.ts`, another task's
 * file) has no key for one, so a merged row would render as «Registrado» —
 * a timeline that is wrong is worse than a timeline that is partial, and the
 * movements ledger in the left column already tells that half whole.
 */
import { computed, ref, watch } from "vue";

import OrderStory from "../flows/orden/OrderStory.vue";
import {
	fetchCustomerStory,
	type CustomerStoryPayload,
} from "../../../services/serviceOrderService";
import { makeDayLabel, storyTotals } from "./customerCard";

const props = defineProps<{
	customer: string;
	posProfile: string;
	formatCurrency: (value: number) => string;
}>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const dayLabel = makeDayLabel(__);

const story = ref<CustomerStoryPayload | null>(null);
const loading = ref(false);
const errorMessage = ref("");

const totals = computed(() =>
	storyTotals((story.value?.events ?? []) as unknown as Record<string, unknown>[]),
);

const purchasesLabel = computed(() =>
	__("{0} purchases").replace("{0}", String(totals.value.purchases)),
);

const spentLabel = computed(() =>
	__("{0} in total").replace("{0}", props.formatCurrency(totals.value.total)),
);

const lastLabel = computed(() =>
	__("last {0}").replace("{0}", dayLabel(totals.value.lastDay)),
);

const scopeLabel = computed(() => {
	const days = story.value?.days ?? 90;
	return __("Last {0} days · the fiscal side lives in Invoices, this is the relationship").replace(
		"{0}",
		String(days),
	);
});

async function load() {
	const { customer, posProfile } = props;
	if (!customer || !posProfile) {
		story.value = null;
		errorMessage.value = "";
		return;
	}
	loading.value = true;
	errorMessage.value = "";
	try {
		const loaded = await fetchCustomerStory(customer, posProfile);
		// The view may have moved to another customer while this was in
		// flight. A timeline that fills in with the PREVIOUS person is worse
		// than an empty one, because it looks authoritative.
		if (props.customer === customer) story.value = loaded;
	} catch (error) {
		const failure = error as { serverMessage?: string; message?: string } | null;
		story.value = null;
		errorMessage.value =
			failure?.serverMessage || failure?.message || __("Could not read this customer's history.");
	} finally {
		loading.value = false;
	}
}

watch(() => [props.customer, props.posProfile] as const, () => void load(), { immediate: true });
</script>

<style scoped>
.cliente-story {
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	padding: 16px 18px;
}

.cliente-story__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-lg, 14px);
	flex-wrap: wrap;
	margin-bottom: var(--reg-space-lg, 14px);
}

.cliente-story__label {
	font-size: 0.66rem;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.cliente-story__totals {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 14px;
}

.cliente-story__total {
	font-size: 0.72rem;
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
}

.cliente-story__body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.cliente-story__note {
	margin: 0;
	padding: 16px 0;
	font-size: 0.78rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-story__footer {
	margin: 0;
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: 0.72rem;
	color: var(--reg-text-muted, #667085);
}
</style>
