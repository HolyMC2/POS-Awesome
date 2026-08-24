<template>
	<section class="cliente-movements">
		<header class="cliente-movements__head">
			<span class="cliente-movements__label">{{ __("Movements") }}</span>
			<span v-if="capLabel" class="cliente-movements__scope" data-testid="cliente-wallet-cap">{{
				capLabel
			}}</span>
		</header>

		<p v-if="!movements.length" class="cliente-movements__empty">
			{{ __("No movements yet") }}
		</p>

		<ol v-else class="cliente-movements__rows">
			<li
				v-for="movement in movements"
				:key="movement.key"
				class="cliente-movements__row"
				:data-kind="movement.kind || 'other'"
				data-testid="cliente-wallet-movement"
			>
				<span class="mono cliente-movements__day">{{ dayLabel(movement.day) }}</span>
				<span class="cliente-movements__what">
					<span>{{ __(movement.labelKey) }}</span>
					<span v-if="movement.detail" class="cliente-movements__detail">{{
						movement.detail
					}}</span>
					<span v-if="movement.reference" class="mono cliente-movements__ref">{{
						movement.reference
					}}</span>
				</span>
				<span
					class="mono cliente-movements__amount"
					:class="
						movement.amount < 0
							? 'cliente-movements__amount--out'
							: 'cliente-movements__amount--in'
					"
					>{{ signedLabel(movement.amount) }}</span
				>
			</li>
		</ol>
	</section>
</template>

<script setup lang="ts">
/**
 * The wallet's unified ledger — deposits, redemptions, cashback earned and
 * spent, credit notes (artboard `Cliente.dc.html`, «Movimientos»).
 *
 * Presentational and pure of requests: the rows arrive normalized from
 * `customerCard.ts`, already signed and already labelled, so this file decides
 * only how a row LOOKS. That split is what lets the sign rule be checked
 * without a mount and the layout be read without a server.
 *
 * THE CAP IS STATED ON SCREEN, the OrderStory convention: a ledger that
 * quietly stops at fifteen rows reads as a customer with fifteen movements.
 */
import { computed } from "vue";

import { makeDayLabel, type WalletMovement } from "./customerCard";

const props = defineProps<{
	movements: WalletMovement[];
	/** How many rows the server was willing to send. `null` says nothing. */
	cap: number | null;
	formatCurrency: (value: number) => string;
}>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const dayLabel = makeDayLabel(__);

const capLabel = computed(() => {
	if (!props.cap || !props.movements.length) return "";
	return __("Last {0}").replace("{0}", String(props.cap));
});

const signedLabel = (amount: number): string => {
	const figure = props.formatCurrency(Math.abs(amount));
	// The minus is U+2212, not a hyphen: at tabular-nums a hyphen is a
	// different width from the digits beside it and the column stops lining up.
	return amount < 0 ? `−${figure}` : `+${figure}`;
};
</script>

<style scoped>
.cliente-movements {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	padding: var(--reg-space-lg, 14px) 0 4px;
}

.cliente-movements__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	padding: 0 16px var(--reg-space-md, 10px);
}

.cliente-movements__label {
	font-size: 0.66rem;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.cliente-movements__scope {
	font-size: 0.68rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-movements__empty {
	margin: 0;
	padding: 0 16px 12px;
	font-size: 0.78rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-movements__rows {
	list-style: none;
	margin: 0;
	padding: 0;
	overflow-y: auto;
	min-height: 0;
}

.cliente-movements__row {
	display: grid;
	grid-template-columns: 76px 1fr 110px;
	gap: 12px;
	align-items: baseline;
	padding: 9px 16px;
	border-bottom: 1px solid var(--reg-divider-soft, #f5f7f9);
	font-size: 0.78rem;
	color: var(--reg-text-secondary, #4a5260);
}

.cliente-movements__row:last-child {
	border-bottom: 0;
}

.cliente-movements__day {
	color: var(--reg-text-muted, #667085);
}

.cliente-movements__what {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 6px;
	min-width: 0;
}

.cliente-movements__detail,
.cliente-movements__ref {
	color: var(--reg-text-muted, #667085);
	font-size: 0.72rem;
}

.cliente-movements__amount {
	text-align: right;
	font-weight: 700;
}

/* Green and red are STATE here — money in and money out — which is the one
 * use `singleAccent.spec.ts` reserves them for. They are figures, never a
 * fill, and the sign carries the same meaning without the colour. */
.cliente-movements__amount--in {
	color: var(--reg-tone-positive-number, #157a48);
}

.cliente-movements__amount--out {
	color: var(--reg-tone-negative-label, #b42318);
}

.mono {
	font-variant-numeric: tabular-nums;
}
</style>
