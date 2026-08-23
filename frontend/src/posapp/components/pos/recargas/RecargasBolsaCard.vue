<template>
	<!--
		The pouch, and ONLY what the register can actually know about it.

		The artboard draws six more things on this card — a fill bar at 25 %, a
		"Abonaste $5,000 el 14 de agosto", "te alcanza para unas 6 h · se acaba
		~01:40", a week-consumption chart, an auto-top-up toggle and an "Abonar a
		la bolsa" button. Every one of them needs a read model the POS does not
		have: a pouch CEILING (there is none — TAECEL reports a balance, not a
		limit, so the bar has no denominator), the funding history, a burn rate,
		and a write path for adding funds. Drawing them from guesses would put
		invented numbers next to a real balance on the owner's own money, which
		is the one place this programme has consistently refused to do it.

		The last one is refused for a second reason as well: this destination is
		a VIEW. It reads. Nothing on it may move money.
	-->
	<aside v-if="bolsa.visible" class="recargas-bolsa" data-testid="recargas-bolsa">
		<div class="recargas-bolsa__label">{{ __("Saldo pouch available") }}</div>

		<div
			v-if="bolsa.available !== null"
			class="recargas-bolsa__amount reg-mono"
			:data-money-role="MONEY_ROLE.pouch"
			data-testid="recargas-bolsa-amount"
		>
			{{ formatCurrency(bolsa.available) }}
		</div>
		<!--
			Asked for and not answered — no credentials, or TAECEL unreachable with
			no cached snapshot. A zero here would read as an empty pouch and stop a
			cashier selling against money that is actually there, so the figure is
			absent and says which of the two it is.
		-->
		<p v-else class="recargas-bolsa__unknown" data-testid="recargas-bolsa-unknown">
			{{ __("Saldo/recarga requires an online connection") }}
		</p>

		<div v-if="bolsa.asOf" class="recargas-bolsa__as-of" data-testid="recargas-bolsa-as-of">
			{{ __("Updated") }} <span class="reg-mono">{{ bolsa.asOf }}</span>
		</div>

		<div
			v-if="bolsa.after !== null"
			class="recargas-bolsa__after"
			data-testid="recargas-bolsa-after"
		>
			<span>{{ __("Left after this top-up") }}</span>
			<span class="reg-mono" :data-money-role="MONEY_ROLE.pouchAfter">{{
				formatCurrency(bolsa.after)
			}}</span>
		</div>
	</aside>
</template>

<script setup lang="ts">
/**
 * The saldo pouch aside (build plan §12 item F).
 *
 * Renders nothing at all when `Saldo Settings.show_available_balance_in_pos` is
 * off — the server sends `{visible: false}` and no balance ever leaves it, so
 * there is nothing to hide behind a "hidden" placeholder either. A manager who
 * switched it off did so to keep the business wallet away from the counter;
 * announcing that a number exists would half-undo that.
 */
import { MONEY_ROLE, type BolsaFigures } from "./recargasModel";

defineProps<{
	bolsa: BolsaFigures;
	formatCurrency: (value: number) => string;
}>();

const __ = (window as any).__ || ((value: string) => value);
</script>

<style scoped>
.recargas-bolsa {
	/* The artboard's aside is 372px. It shrinks on a narrow desktop rather than
	 * pushing the capture column under its own minimum. */
	flex: 0 0 auto;
	width: 372px;
	max-width: 40%;
	align-self: flex-start;
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 18px;
	border-radius: var(--reg-radius-md);
	/* The warning tone, which is STATE — "this is a pouch that runs down" —
	 * and not emphasis. The screen's single saturated colour stays on the
	 * band's primary (§17.7 invariant 2). */
	background: var(--reg-tone-warning-bg);
	border: 1px solid var(--reg-tone-warning-border);
	color: var(--reg-tone-warning-label);
}

.recargas-bolsa__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
}

.recargas-bolsa__amount {
	/* The artboard sets this at 42px. It renders at 34 here on purpose: the
	 * band's figure is 60px and invariant 1 gives the band the one number that
	 * matters. Two figures within 18px of each other, one of them the pouch and
	 * one of them what the customer is about to be charged, is exactly the
	 * confusion the invariant exists to prevent. */
	font-size: 34px;
	font-weight: 700;
	letter-spacing: -0.03em;
	line-height: 1.05;
	color: var(--reg-tone-warning-number);
}

.recargas-bolsa__unknown {
	margin: 0;
	font-size: 12.5px;
	line-height: 1.4;
	color: var(--reg-tone-warning-strong);
}

.recargas-bolsa__as-of {
	font-size: 11.5px;
}

.recargas-bolsa__after {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	margin-top: 3px;
	padding-top: 9px;
	border-top: 1px solid var(--reg-tone-warning-divider);
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-tone-warning-strong);
}

@media (max-width: 1180px) {
	.recargas-bolsa {
		width: 260px;
	}
}
</style>
