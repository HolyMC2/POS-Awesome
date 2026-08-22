<template>
	<div class="customer-strip" data-testid="customer-strip">
		<div class="customer-strip__identity">
			<span class="customer-strip__name" data-testid="customer-strip-name">{{ customerName }}</span>
			<button
				type="button"
				class="customer-strip__change"
				data-testid="customer-strip-change"
				@click="$emit('change')"
			>
				{{ __("change") }}
			</button>
		</div>

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
	</div>
</template>

<script setup>
import { computed } from "vue";

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

.customer-strip__name {
	font-size: 1.05rem;
	font-weight: 700;
	color: var(--pos-text-primary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
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
</style>
