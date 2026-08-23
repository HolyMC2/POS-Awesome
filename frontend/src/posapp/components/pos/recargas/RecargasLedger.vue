<template>
	<div class="recargas-ledger" data-testid="recargas-ledger">
		<div class="recargas-ledger__head">
			<span class="recargas-ledger__label">{{ __("Today's top-ups") }}</span>
			<!--
				The tally renders ONLY when the page it was counted from is the
				whole day. `list_transactions` caps at its limit, and a busy
				counter's "31 recargas hoy" silently becoming the cap is exactly
				the kind of confident wrong number this programme keeps choosing
				absence over. The table below still shows what it has.
			-->
			<span v-if="ledger.complete" class="recargas-ledger__tally" data-testid="recargas-ledger-tally">
				{{ __("{0} operations").replace("{0}", String(ledger.operations ?? 0)) }} ·
				<span class="reg-mono" :data-money-role="MONEY_ROLE.sold">{{
					formatCurrency(ledger.sold ?? 0)
				}}</span>
				{{ __("Sold") }}
			</span>
		</div>

		<div class="recargas-ledger__scroll">
			<table class="recargas-ledger__table">
				<thead>
					<tr>
						<th scope="col">{{ __("Time") }}</th>
						<th scope="col">{{ __("Company") }}</th>
						<th scope="col">{{ __("Number") }}</th>
						<th scope="col" class="recargas-ledger__num">{{ __("Amount") }}</th>
						<th scope="col" class="recargas-ledger__num">{{ __("Status") }}</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="entry in ledger.entries" :key="entry.id" data-testid="recargas-ledger-row">
						<td class="reg-mono recargas-ledger__time">{{ entry.time }}</td>
						<td class="recargas-ledger__what">
							<!-- Company and product are DATA — TAECEL's own names — so they
							     are printed, never translated. -->
							{{ entry.carrier }}<span v-if="entry.product"> · {{ entry.product }}</span>
						</td>
						<td class="reg-mono recargas-ledger__ref">{{ entry.reference }}</td>
						<td class="reg-mono recargas-ledger__num" :data-money-role="MONEY_ROLE.entry">
							{{ formatCurrency(entry.amount) }}
						</td>
						<td class="recargas-ledger__num">
							<span
								class="recargas-chip"
								:class="`recargas-chip--${entry.outcome}`"
								:data-outcome="entry.outcome"
							>
								{{ __(OUTCOME_LABEL[entry.outcome].labelKey) }}
							</span>
						</td>
					</tr>
				</tbody>
			</table>

			<p v-if="!ledger.entries.length" class="recargas-ledger__empty" data-testid="recargas-ledger-empty">
				{{ __("No top-ups yet today") }}
			</p>
		</div>

		<!--
			The reassurance the artboard puts under the table, and it is a claim
			about money: a refunded recharge means the pouch already has its pesos
			back, so nobody has to chase it. It renders only when the count is
			known AND non-zero — the sentence is meaningless at zero and dishonest
			from a truncated page.
		-->
		<p
			v-if="ledger.complete && (ledger.refunded ?? 0) > 0"
			class="recargas-ledger__foot"
			data-testid="recargas-ledger-refunded"
		>
			{{ __("Refunded to the pouch") }}
			<span class="reg-mono">{{ ledger.refunded }}</span> ·
			{{ __("the pouch got it back by itself") }}
		</p>
	</div>
</template>

<script setup lang="ts">
/**
 * Today's recharges, as a table (build plan §12 item F).
 *
 * Deliberately not a summary card: the artboard puts the ledger on the same
 * screen as the capture, because the question a cashier actually asks at this
 * counter is *"did the one I just sent go through?"* — and a status chip beside
 * the number answers it without a second surface.
 */
import { MONEY_ROLE, OUTCOME_LABEL, type TodayLedger } from "./recargasModel";

defineProps<{
	ledger: TodayLedger;
	formatCurrency: (value: number) => string;
}>();

const __ = (window as any).__ || ((value: string) => value);
</script>

<style scoped>
.recargas-ledger {
	display: flex;
	flex-direction: column;
	/* The one scrollport on this column lives at `__scroll` below; this card
	 * fills what is left and refuses to grow past it. `min-height: 0` is the
	 * half that actually does the work (59c5fe1ad). */
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	background: var(--reg-surface);
	border: 1px solid var(--reg-border-light);
	border-radius: var(--reg-radius-md);
	padding: var(--reg-space-lg) 16px;
}

.recargas-ledger__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	flex: 0 0 auto;
	margin-bottom: 4px;
}

.recargas-ledger__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label);
}

.recargas-ledger__tally {
	font-size: 11.5px;
	color: var(--reg-text-muted);
}

.recargas-ledger__scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
}

.recargas-ledger__table {
	width: 100%;
	border-collapse: collapse;
}

.recargas-ledger__table th {
	position: sticky;
	top: 0;
	background: var(--reg-surface);
	text-align: left;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label);
	padding: 0 0 6px;
	border-bottom: 1px solid var(--reg-divider);
}

.recargas-ledger__table td {
	height: 44px;
	padding: 0 12px 0 0;
	border-bottom: 1px solid var(--reg-divider-soft);
	font-size: 13px;
	color: var(--reg-text-primary);
	white-space: nowrap;
}

.recargas-ledger__num {
	text-align: right;
	padding-right: 0 !important;
}

.recargas-ledger__time,
.recargas-ledger__ref {
	font-size: 12px;
	color: var(--reg-text-muted);
}

.recargas-ledger__what {
	white-space: normal;
	color: var(--reg-text-primary);
}

.recargas-ledger__empty,
.recargas-ledger__foot {
	margin: 0;
	font-size: 12px;
	color: var(--reg-text-muted);
}

.recargas-ledger__empty {
	padding: 24px 0;
	text-align: center;
}

.recargas-ledger__foot {
	flex: 0 0 auto;
	margin-top: 10px;
	padding-top: 10px;
	border-top: 1px dashed var(--reg-border-soft);
	color: var(--reg-text-secondary);
}

/* State, never emphasis (§17.7 invariant 2): tinted labels on a neutral row.
 * The screen's one saturated colour stays on the band's primary.
 *
 * The success and warning pairs forward from theme.css's button pairs, which
 * already flip for dark, and carry no hex fallback — a literal is one theme's
 * mistake waiting to ship, and a dead fallback also hides a renamed token.
 *
 * The danger pair is the exception, and it is on the record rather than
 * silent: theme.css has no error BUTTON pair to forward from and
 * register-tokens.css has no `--reg-tone-danger-*`. Adding them is T3's file,
 * so it is REPORTED. Until it lands the fallback is the only value, and it is
 * safe to read in both themes because the chip paints its own light background
 * — #b42318 on #fdeaea keeps 6.4:1 either way, and only the surrounding
 * aesthetic is off on a dark register. */
.recargas-chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	font-size: 11.5px;
	font-weight: 500;
	padding: 3px 9px;
	background: var(--reg-surface-muted);
	color: var(--reg-text-muted);
}

.recargas-chip--applied {
	background: var(--pos-button-success-bg);
	color: var(--pos-button-success-text);
}

.recargas-chip--confirming,
.recargas-chip--review {
	background: var(--pos-button-warning-bg);
	color: var(--pos-button-warning-text);
}

.recargas-chip--refunded,
.recargas-chip--failed {
	background: var(--reg-tone-danger-bg, #fdeaea);
	color: var(--reg-tone-danger-ink, #b42318);
}
</style>
