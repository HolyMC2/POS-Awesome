<template>
	<div class="cobranza-detail" data-testid="cobranza-detail">
		<div v-if="!row" class="cobranza-detail__empty" data-testid="cobranza-detail-empty">
			{{ __("Choose an invoice and collect against it — no searching required.") }}
		</div>

		<template v-else>
			<header class="cobranza-detail__head">
				<div class="cobranza-detail__ident">
					<div class="mono cobranza-detail__folio">{{ row.name }}</div>
					<div class="cobranza-detail__meta" data-testid="cobranza-detail-contact">
						{{ contact?.customer_name || row.customer_name || row.customer }}
						<span v-if="contact?.phone"> · {{ contact.phone }}</span>
					</div>
				</div>
				<span v-if="due" class="cobranza-detail__due" :data-tone="due.tone">
					{{ dueText }}
				</span>
			</header>

			<div class="cobranza-detail__totals" data-testid="cobranza-detail-totals">
				<div class="cobranza-detail__figure">
					<span>{{ __("Invoice total") }}</span>
					<span class="mono">{{ formatCurrency(row.total) }}</span>
				</div>
				<!-- Omitted, not zeroed, when the invoice and the party account are
				     in two currencies: the server sends `paid: null` rather than a
				     figure produced by subtracting one unit from another. -->
				<div v-if="row.paid !== null" class="cobranza-detail__figure">
					<span>{{ __("Paid") }}</span>
					<span class="mono cobranza-detail__paid">{{ formatCurrency(row.paid) }}</span>
				</div>
				<div class="cobranza-detail__figure cobranza-detail__figure--total">
					<span>{{ __("Pending") }}</span>
					<span class="mono cobranza-detail__outstanding">
						{{ formatCurrency(row.outstanding) }}
					</span>
				</div>
			</div>

			<div v-if="lines.length" class="cobranza-detail__lines" data-testid="cobranza-detail-lines">
				<div class="cobranza-detail__label">{{ __("On this invoice") }}</div>
				<div
					v-for="(line, index) in lines"
					:key="`${line.item_code}-${index}`"
					class="cobranza-detail__line"
				>
					<span class="cobranza-detail__line-name">
						<span class="mono cobranza-detail__line-qty">{{ line.qty }}×</span>
						{{ line.item_name || line.item_code }}
					</span>
					<span class="mono">{{ formatCurrency(line.amount) }}</span>
				</div>
				<div v-if="moreLines > 0" class="cobranza-detail__more" data-testid="cobranza-detail-more-lines">
					{{ __("and {0} more", [moreLines]) }}
				</div>
			</div>

			<div class="cobranza-detail__label">{{ __("Payments received") }}</div>
			<div v-if="loadingDetail" class="cobranza-detail__muted">
				{{ __("Reading the invoice…") }}
			</div>
			<!-- An invoice nobody has paid against says so. A blank space under a
			     heading reads as "still loading", and this panel is exactly where a
			     cashier decides whether to ask for the whole amount. -->
			<div
				v-else-if="!payments.length"
				class="cobranza-detail__muted"
				data-testid="cobranza-detail-no-payments"
			>
				{{ __("Nothing has been paid against this invoice yet.") }}
			</div>
			<template v-else>
				<div
					v-for="payment in payments"
					:key="payment.name"
					class="cobranza-detail__figure"
					:data-testid="`cobranza-payment-${payment.name}`"
				>
					<span>
						{{ payment.date }} · {{ payment.mode_of_payment || __("Payment") }}
						<!-- Shares the invoice's date, so without this it reads as a
						     payment made on the day of a sale the customer did not
						     finish paying for. -->
						<template v-if="payment.at_the_counter"> · {{ __("at the counter") }}</template>
					</span>
					<span class="mono">{{ formatCurrency(payment.amount) }}</span>
				</div>
			</template>

			<!-- Absence, not zeros: the chip renders only where there is credit to
			     spend, so a cashier who sees it can trust it. -->
			<div
				v-if="storeCredit"
				class="cobranza-detail__credit"
				data-testid="cobranza-store-credit"
			>
				<strong>{{ __("Has {0} in store credit", [formatCurrency(storeCredit)]) }}</strong>
				<span>{{ __("can be applied when collecting") }}</span>
			</div>

			<div class="cobranza-detail__spacer"></div>

			<v-btn
				class="cobranza-detail__primary"
				color="primary"
				size="large"
				block
				:disabled="offline"
				:loading="collecting"
				data-testid="cobranza-collect"
				@click="$emit('collect', row)"
			>
				{{ __("COLLECT {0}", [formatCurrency(row.outstanding)]) }}
			</v-btn>

			<div class="cobranza-detail__secondary">
				<v-btn
					variant="tonal"
					size="small"
					:disabled="offline || reminderState === 'sending'"
					:loading="reminderState === 'sending'"
					data-testid="cobranza-reminder"
					@click="$emit('reminder', row)"
				>
					{{ reminderState === "filed" ? __("Reminder filed") : __("Reminder") }}
				</v-btn>
				<!-- A stub that SAYS it is a stub. The artboard draws «Estado de
				     cuenta» beside «Recordatorio»; the print format behind it does
				     not exist yet, and a chip that silently does nothing is worse
				     than one that explains itself. -->
				<v-btn
					variant="tonal"
					size="small"
					data-testid="cobranza-statement"
					@click="$emit('statement', row)"
				>
					{{ __("Statement") }}
				</v-btn>
			</div>

			<div class="cobranza-detail__footnote">
				{{ __("The reminder is filed as a CRM follow-up, with the folio and the balance.") }}
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
/**
 * The artboard's right column: everything needed to collect, one tap from the
 * row.
 *
 * It renders and emits; it decides nothing and it writes nothing. The lines,
 * the payments, the contact and the monedero all arrive resolved from
 * `CobranzaSurface.vue`, which is the only thing here that talks to the
 * server — so this component can be mounted in a test with plain props and no
 * store, no bus and no `frappe`.
 *
 * COBRAR emits. It does NOT capture: the money path is `PayView`'s, reached
 * through the surface, and a second one in this file would be a second place
 * for a double charge to be invented.
 */
import { computed } from "vue";

import {
	describeDue,
	type ReceivableContact,
	type ReceivableLine,
	type ReceivablePayment,
	type ReceivableRow,
} from "./receivablesModel";

const props = defineProps<{
	row: ReceivableRow | null;
	contact: ReceivableContact | null;
	lines: ReceivableLine[];
	payments: ReceivablePayment[];
	/** Total lines on the invoice, so the panel can own up to a truncation. */
	lineCount: number;
	storeCredit: number | null;
	loadingDetail: boolean;
	collecting: boolean;
	offline: boolean;
	/** `filed` is what makes the CRM round's idempotence visible on screen. */
	reminderState: "idle" | "sending" | "filed";
	formatCurrency: (_value: number) => string;
}>();

defineEmits<{
	collect: [ReceivableRow];
	reminder: [ReceivableRow];
	statement: [ReceivableRow];
}>();

const __ =
	(window as Record<string, any>).__ ||
	((value: string, args?: any[]) => {
		if (!args?.length) return value;
		return args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), value);
	});

const due = computed(() => (props.row ? describeDue(props.row) : null));
const dueText = computed(() => {
	const label = due.value;
	if (!label) return "";
	return label.count === null ? __(label.key) : __(label.key, [label.count]);
});

const moreLines = computed(() => Math.max(props.lineCount - props.lines.length, 0));
</script>

<style scoped>
.cobranza-detail {
	display: flex;
	flex-direction: column;
	width: 430px;
	flex: none;
	min-height: 0;
	overflow-y: auto;
	padding: 16px 18px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	border-radius: var(--reg-radius-md, 14px);
}

.cobranza-detail__empty {
	margin: auto;
	padding: 24px 8px;
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--pos-text-secondary, #9aa2ae);
	text-align: center;
}

.cobranza-detail__head {
	display: flex;
	align-items: center;
	gap: 10px;
}

.cobranza-detail__ident {
	flex: 1;
	min-width: 0;
	line-height: 1.25;
}

.cobranza-detail__folio {
	font-size: 15px;
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cobranza-detail__meta {
	font-size: 11.5px;
	color: var(--pos-text-secondary, #7b838f);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cobranza-detail__due {
	display: inline-flex;
	flex: none;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 700;
}

.cobranza-detail__totals {
	margin-top: 12px;
	padding: 11px 12px;
	border-radius: 11px;
	background: var(--reg-surface-sunken, #fafbfc);
	border: 1px solid var(--reg-border-light, #eff2f5);
}

.cobranza-detail__figure {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 5px;
	font-size: 12.5px;
	color: var(--pos-text-secondary, #7b838f);
}

.cobranza-detail__figure--total {
	margin-bottom: 0;
	padding-top: 5px;
	border-top: 1px solid var(--reg-border-light, #f2f4f7);
	color: var(--pos-text-primary, #212121);
	font-weight: 700;
}

.cobranza-detail__paid {
	color: var(--reg-good-ink, #14603a);
}

.cobranza-detail__outstanding {
	font-size: 16px;
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cobranza-detail__label {
	margin: 13px 0 7px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--pos-text-secondary, #8b93a0);
}

.cobranza-detail__lines {
	display: flex;
	flex-direction: column;
}

.cobranza-detail__line {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 4px;
	font-size: 12.5px;
	color: var(--pos-text-secondary, #4a5260);
}

.cobranza-detail__line-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cobranza-detail__line-qty {
	color: var(--pos-text-secondary, #9aa2ae);
}

.cobranza-detail__more,
.cobranza-detail__muted {
	font-size: 11.5px;
	color: var(--pos-text-secondary, #9aa2ae);
}

.cobranza-detail__credit {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	margin-top: 12px;
	padding: 10px 12px;
	border-radius: 11px;
	background: var(--reg-accent-soft, #e0f7fa);
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	font-size: 12.5px;
	color: var(--reg-accent-ink, #00646f);
}

.cobranza-detail__spacer {
	flex: 1;
	min-height: 12px;
}

.cobranza-detail__primary {
	margin-top: 12px;
	font-weight: 700;
	letter-spacing: 0.01em;
}

.cobranza-detail__secondary {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	margin-top: 8px;
}

.cobranza-detail__footnote {
	margin-top: 8px;
	font-size: 10.5px;
	line-height: 1.4;
	color: var(--pos-text-secondary, #9aa2ae);
}

[data-tone="good"] {
	background: var(--reg-good-soft, #e8f5e8);
	color: var(--reg-good-ink, #14603a);
}

[data-tone="warn"] {
	background: var(--reg-warn-soft, #fff3e0);
	color: var(--reg-warn-ink, #a15200);
}

[data-tone="bad"] {
	background: var(--reg-bad-soft, #fdeaea);
	color: var(--reg-bad-ink, #b42318);
}

[data-tone="muted"] {
	background: var(--reg-muted-soft, #f2f4f7);
	color: var(--reg-muted-ink, #667085);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

/* Below the artboard's width the detail stops being a column and becomes the
   bottom half — the same boundary the ledger, orden and cotizaciones surfaces
   use. */
@media (max-width: 1180px) {
	.cobranza-detail {
		width: auto;
	}
}
</style>
