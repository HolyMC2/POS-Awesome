<template>
	<section class="cobro-credit" :class="stateClass" data-testid="cobro-financed-sale">
		<template v-if="!summary">
			<button
				type="button"
				class="cobro-credit__start"
				data-testid="cobro-financed-start"
				:disabled="Boolean(blockedReason)"
				@click="$emit('open')"
			>
				<v-icon icon="mdi-hand-coin-outline" size="20" />
				<span class="cobro-credit__start-copy">
					<strong>{{ __("Sell on credit") }}</strong>
					<small>{{ blockedReason || providerNames }}</small>
				</span>
			</button>
		</template>
		<template v-else>
			<header class="cobro-credit__head">
				<span class="cobro-credit__title">{{ __("Credit sale · {0}", [summary.providerLabel]) }}</span>
				<button type="button" class="cobro-credit__link" data-testid="cobro-financed-edit" @click="$emit('open')">
					{{ __("Edit") }}
				</button>
			</header>
			<dl v-if="summary.valid" class="cobro-credit__facts">
				<div>
					<dt>{{ __("Down payment") }}</dt>
					<dd data-testid="cobro-financed-enganche">{{ formatMoney(summary.enganche) }}</dd>
				</div>
				<div>
					<dt>{{ __("Credit price") }}</dt>
					<dd>{{ formatMoney(summary.creditPrice) }}</dd>
				</div>
				<div>
					<dt>{{ __("Financed") }}</dt>
					<dd data-testid="cobro-financed-amount">{{ formatMoney(summary.financed) }}</dd>
				</div>
			</dl>
			<p v-if="summary.valid && summary.shape === 'split'" class="cobro-credit__note">
				{{ __("Collect the down payment only; {0} is recorded on {1}.", [formatMoney(summary.financed), summary.modeOfPayment]) }}
			</p>
			<p v-else-if="!summary.valid" class="cobro-credit__warning" role="alert">
				{{ summary.issueText }}
			</p>
			<button type="button" class="cobro-credit__link cobro-credit__remove" data-testid="cobro-financed-remove" @click="$emit('remove')">
				{{ __("Not a credit sale") }}
			</button>
		</template>
	</section>
</template>

<script setup lang="ts">
/**
 * The payment screen's door into a provider-financed credit sale and, once
 * declared, its summary. Display only: the figures arrive computed from the
 * credit store and every act is an emit handled by `Payments.vue`.
 */
import { computed } from "vue";

export interface FinancedSaleCardSummary {
	providerLabel: string;
	shape: "split" | "enganche";
	modeOfPayment: string;
	creditPrice: number;
	enganche: number;
	financed: number;
	valid: boolean;
	issueText: string;
}

const props = defineProps<{
	summary: FinancedSaleCardSummary | null;
	providerNames: string;
	blockedReason?: string;
	formatMoney: (_value: number) => string;
}>();

defineEmits<{
	(_e: "open"): void;
	(_e: "remove"): void;
}>();

const __ = (window as any).__ || ((value: string) => value);

const stateClass = computed(() => ({
	"cobro-credit--active": Boolean(props.summary?.valid),
	"cobro-credit--attention": Boolean(props.summary && !props.summary.valid),
}));
</script>

<style scoped>
.cobro-credit {
	display: grid;
	gap: var(--reg-space-xs);
	min-width: 0;
}
.cobro-credit--active,
.cobro-credit--attention {
	padding: var(--reg-space-sm) var(--reg-space-md);
	border-radius: var(--reg-radius-md);
	border: 1px solid var(--reg-tone-neutral-border);
	background: var(--reg-tone-neutral-bg);
}
.cobro-credit--attention {
	border-color: var(--reg-tone-warning-border);
	background: var(--reg-tone-warning-bg);
}
.cobro-credit__start {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm);
	width: 100%;
	min-height: var(--reg-touch-min);
	padding: var(--reg-space-xs) var(--reg-space-md);
	border: 1px dashed var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	text-align: left;
	cursor: pointer;
}
.cobro-credit__start:disabled {
	cursor: not-allowed;
	opacity: 0.7;
}
.cobro-credit__start-copy {
	display: grid;
	min-width: 0;
}
.cobro-credit__start-copy small {
	color: var(--reg-text-muted);
	font-size: 12px;
	overflow-wrap: anywhere;
}
.cobro-credit__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-sm);
}
.cobro-credit__title {
	font-weight: 700;
	overflow-wrap: anywhere;
}
.cobro-credit__facts {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: var(--reg-space-xs);
	margin: 0;
}
.cobro-credit__facts div {
	display: grid;
	min-width: 0;
}
.cobro-credit__facts dt {
	font-size: 12px;
	color: var(--reg-text-muted);
}
.cobro-credit__facts dd {
	margin: 0;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	overflow-wrap: anywhere;
}
.cobro-credit__note,
.cobro-credit__warning {
	margin: 0;
	font-size: 13px;
	color: var(--reg-text-secondary);
}
.cobro-credit__warning {
	color: var(--reg-tone-warning-heading);
}
.cobro-credit__link {
	justify-self: start;
	min-height: 32px;
	padding: 0 var(--reg-space-xs);
	border: 0;
	background: transparent;
	color: var(--reg-accent);
	font-weight: 700;
	cursor: pointer;
}
.cobro-credit__remove {
	color: var(--reg-tone-negative-label);
}
.cobro-credit button:focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}
</style>
