<template>
	<div class="customer-strip" data-testid="customer-strip">
		<div class="customer-strip__identity">
			<!-- The name IS the way in to the person's file. Tapping who you are
			     selling to is the gesture a counter already makes, and it costs
			     the strip no width — the alternative was a third text link
			     beside «cambiar» and «historial» on the densest row in the
			     product. The refusal for the walk-in identity lives inside the
			     view, where it can say what to do instead. -->
			<button
				type="button"
				class="customer-strip__name"
				data-testid="customer-strip-name"
				:aria-label="__('Customer')"
				@click="openContact"
			>
				{{ customerName }}
			</button>

			<button
				type="button"
				class="customer-strip__change"
				data-testid="customer-strip-change"
				@click="$emit('change')"
			>
				{{ __("change") }}
			</button>
			<!-- «Historial» sits beside «change» because it answers the other
			     question a name raises at a counter: not "is this the right
			     person" but "what have we done with them". It opens over the
			     ticket and leaves again — see `CustomerStory.vue` for why it is
			     not a destination. -->
			<button
				v-if="customerName"
				type="button"
				class="customer-strip__change"
				data-testid="customer-strip-history"
				@click="historyOpen = true"
			>
				{{ __("history") }}
			</button>
		</div>

		<!-- Mounted only once asked for: the timeline pulls a chunk and a round
		     trip, and neither belongs on the sale's first paint. -->
		<CustomerStory v-if="historyMounted" v-model="historyOpen" />

		<!-- Same bargain for the person's file, which is a bigger chunk still:
		     it carries the wallet card and its ledger. -->
		<ClienteView v-if="contactMounted" v-model="contactOpen" />

		<!-- Facts, not controls. Each chip is rendered only when the register
		     actually has the value: an absent price list is silence, never
		     "Price List —", because a placeholder costs the same width as a
		     fact and teaches the cashier to stop reading the row. -->
		<div v-if="chips.length" class="customer-strip__chips" data-testid="customer-strip-chips">
			<span
				v-for="chip in chips"
				:key="chip.key"
				class="customer-strip__chip"
				:class="`customer-strip__chip--${chip.tone}`"
				:data-chip="chip.key"
			>
				{{ chip.label }}
			</span>
		</div>

		<!-- The back office's own facts about this customer, when there IS a
		     back office. The strip gates itself on a session probe and renders
		     nothing at all otherwise — see `CustomerCrmStrip.vue`. -->
		<CustomerCrmStrip v-if="customerName" />
	</div>
</template>

<script setup>
import { computed, defineAsyncComponent, ref, watch } from "vue";

// Async and behind `historyMounted`: the strip renders on every sale and the
// history is opened on a few of them.
const CustomerStory = defineAsyncComponent(() => import("./CustomerStory.vue"));
// Same bargain for the contact view — a bigger chunk still, since it carries
// the wallet card and its ledger.
const ClienteView = defineAsyncComponent(() => import("./ClienteView.vue"));
// Async too, but mounted with the strip: it has to ASK before it can know
// whether to draw anything, and the probe disables itself for the session on
// the first "not installed".
const CustomerCrmStrip = defineAsyncComponent(() => import("./CustomerCrmStrip.vue"));

const props = defineProps({
	customerName: { type: String, default: "" },
	/** Outstanding/wallet balance as the shell already formatted it. */
	balanceLabel: { type: String, default: "" },
	priceList: { type: String, default: "" },
	/** Sale type — only surfaced when it is NOT the ordinary invoice. */
	saleType: { type: String, default: "" },
	isReturn: { type: Boolean, default: false },
	cfdiReady: { type: Boolean, default: false },
});

defineEmits(["change"]);

const __ = window.__ || ((value) => value);

const historyOpen = ref(false);
// Once opened it stays mounted, so re-opening does not re-import the chunk.
const historyMounted = ref(false);
watch(historyOpen, (open) => {
	if (open) historyMounted.value = true;
});

const contactOpen = ref(false);
const contactMounted = ref(false);
watch(contactOpen, (open) => {
	if (open) contactMounted.value = true;
});

/**
 * «Cliente» — the person's file, opened over the sale.
 *
 * It opens even for the walk-in identity, on purpose: the view refuses there
 * with a sentence naming the next act, which is a better answer than a name
 * that silently does nothing. See `customerCard.isContactableCustomer`.
 */
function openContact() {
	contactOpen.value = true;
}

/**
 * The artboard's strip also carries purchase provenance — "Cliente frecuente ·
 * 11 compras · última hace 3 semanas". There is no read model for that, and a
 * shell-level fetch for it would be new traffic on the hottest path in the
 * product, so it is deliberately absent rather than faked. Same reasoning the
 * shell applied to its unwired badge counts: zero renders nothing, never a
 * wrong number.
 */
const chips = computed(() => {
	const out = [];
	if (props.isReturn) {
		out.push({ key: "return", label: __("Return"), tone: "warning" });
	} else if (props.saleType && props.saleType !== "Invoice") {
		out.push({ key: "type", label: props.saleType, tone: "neutral" });
	}
	if (props.balanceLabel) {
		out.push({ key: "balance", label: props.balanceLabel, tone: "neutral" });
	}
	if (props.priceList) {
		out.push({ key: "price-list", label: props.priceList, tone: "neutral" });
	}
	if (props.cfdiReady) {
		out.push({ key: "cfdi", label: __("CFDI ready"), tone: "neutral" });
	}
	return out;
});
</script>

<style scoped>
/* One strip, no card. This replaces a bordered "Customer Details" card that
 * held a customer autocomplete, a type dropdown and two buttons permanently on
 * screen — roughly 150px spent on controls the cashier touches once a sale.
 * The controls did not disappear; they moved into the Sale details disclosure,
 * and `change` is the way back to them. */
.customer-strip {
	display: flex;
	flex-direction: column;
	gap: 3px;
	flex: 0 0 auto;
	padding: 2px 2px 6px;
	min-width: 0;
}

.customer-strip__identity {
	display: flex;
	align-items: baseline;
	gap: 10px;
	min-width: 0;
}

/* A button that looks like the heading it replaced. The name gained an act —
 * it opens the person's file — and none of the weight, colour or truncation
 * changed with it, because the strip's density budget did not move either. */
.customer-strip__name {
	border: 0;
	background: none;
	padding: 0;
	font: inherit;
	text-align: start;
	cursor: pointer;
	font-size: 1.05rem;
	font-weight: 700;
	color: var(--pos-text-primary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}

.customer-strip__name:hover,
.customer-strip__name:focus-visible {
	text-decoration: underline;
}

/* A text affordance, not a button: it competes with nothing, and the accent
 * on this screen belongs to the band's primary. */
.customer-strip__change {
	flex: none;
	border: 0;
	background: none;
	padding: 2px 4px;
	font: inherit;
	font-size: 0.78rem;
	color: var(--pos-text-muted, #667085);
	text-decoration: underline;
	cursor: pointer;
}

.customer-strip__change:hover,
.customer-strip__change:focus-visible {
	color: var(--pos-text-primary);
}

.customer-strip__chips {
	display: flex;
	flex-wrap: wrap;
	gap: 5px 12px;
	min-width: 0;
}

.customer-strip__chip {
	font-size: 0.72rem;
	font-weight: 500;
	color: var(--pos-text-muted, #667085);
	white-space: nowrap;
}

/* Amber is STATE here, and a return IS a state — the one case on this strip
 * where colour carries meaning rather than decoration. */
.customer-strip__chip--warning {
	color: var(--pos-warning-text, #8a5a00);
	font-weight: 700;
}
/* Dense desk tier (utils/itemSelectorLayout DENSE_DESK_*): ≥1100px wide,
 * ≤820px tall. The strip's three stacked rows measured 80px at 1195×741;
 * flowed as one wrapping row they measure 54 — name, provenance chips and
 * the CRM line share the width the cart column has to spare. */
@media (min-width: 1100px) and (max-height: 820px) {
	.customer-strip {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 14px;
		padding: 2px 2px 3px;
	}

	.customer-strip__identity,
	.customer-strip__chips,
	.customer-strip :deep(.crm-strip) {
		flex: 0 1 auto;
		min-width: 0;
	}

	.customer-strip :deep(.crm-strip) {
		padding-top: 0;
	}
}
</style>
