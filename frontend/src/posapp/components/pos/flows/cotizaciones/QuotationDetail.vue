<template>
	<div class="quotation-detail" data-testid="quotation-detail">
		<div v-if="!row" class="quotation-detail__empty" data-testid="quotation-detail-empty">
			{{ __("Choose a quotation to see what was promised.") }}
		</div>

		<template v-else>
			<header class="quotation-detail__head">
				<div class="quotation-detail__ident">
					<div class="quotation-detail__folio mono">{{ row.name }}</div>
					<div class="quotation-detail__meta">
						{{ row.customer_name || row.customer }}
						<span v-if="row.owner"> · {{ row.owner }}</span>
						<span v-if="row.date"> · {{ row.date }}</span>
					</div>
				</div>
				<span class="quotation-detail__estado" :data-tone="tab.tone">{{ __(tab.label) }}</span>
			</header>

			<!-- Converted: the link comes first, because the only useful act on
			     this quotation is opening the sale that closed it. -->
			<div
				v-if="row.converted_invoice"
				class="quotation-detail__notice quotation-detail__notice--muted"
				data-testid="quotation-converted-notice"
			>
				{{ __("Already sold on") }}
				<button type="button" class="quotation-detail__link" @click="$emit('open-invoice', row)">
					{{ row.converted_invoice }}
				</button>
			</div>

			<!-- Expired: both totals, by name. "Prices may have changed" is not
			     something a cashier can repeat to the customer in front of them. -->
			<div
				v-else-if="warning"
				class="quotation-detail__notice quotation-detail__notice--warn"
				data-testid="quotation-expiry-warning"
			>
				<template v-if="warning.unchanged">
					{{ __("This quotation expired. Today's prices are the same, so the total is unchanged at") }}
					<strong>{{ formatCurrency(warning.todayTotal) }}</strong>.
				</template>
				<template v-else>
					{{ __("This quotation expired. It was quoted at") }}
					<strong>{{ formatCurrency(warning.quotedTotal) }}</strong>
					{{ __("and today's prices make it") }}
					<strong>{{ formatCurrency(warning.todayTotal) }}</strong>.
				</template>
			</div>

			<div class="quotation-detail__lines" data-testid="quotation-lines">
				<div v-if="loadingLines" class="quotation-detail__loading">
					{{ __("Reading the quotation…") }}
				</div>
				<div
					v-for="(line, index) in lines"
					:key="`${line.item_code}-${index}`"
					class="quotation-line"
					:data-testid="`quotation-line-${line.item_code}`"
				>
					<div class="quotation-line__top">
						<span class="quotation-line__name">
							<span class="mono quotation-line__qty">{{ line.qty }}×</span>
							{{ line.item_name || line.item_code }}
						</span>
						<span class="mono quotation-line__amount">{{ formatCurrency(line.rate * line.qty) }}</span>
					</div>
					<div
						v-if="line.provenance"
						class="quotation-line__provenance"
						:data-testid="`quotation-provenance-${line.item_code}`"
					>
						{{ __("quoted price") }} ·
						{{ __("list today {0}", [formatCurrency(line.provenance.today_rate)]) }}
					</div>
				</div>
			</div>

			<div v-if="row.note" class="quotation-detail__note" data-testid="quotation-note">
				{{ __("Note") }}: «{{ row.note }}»
			</div>

			<div class="quotation-detail__spacer"></div>

			<div class="quotation-detail__totals">
				<div class="quotation-detail__total-row">
					<span>{{ __("Quoted total") }}</span>
					<span class="mono quotation-detail__total">{{ formatCurrency(row.total) }}</span>
				</div>
			</div>

			<v-btn
				class="quotation-detail__primary"
				color="primary"
				size="large"
				block
				:disabled="loadDisabled"
				:loading="loading"
				data-testid="quotation-load"
				@click="$emit('load', row)"
			>
				{{ __("LOAD INTO THE SALE") }}
			</v-btn>

			<div class="quotation-detail__secondary">
				<v-btn
					variant="tonal"
					size="small"
					data-testid="quotation-print"
					:disabled="offline"
					@click="$emit('print', row)"
				>
					{{ __("Print / PDF") }}
				</v-btn>
				<!-- A stub that SAYS it is a stub. The artboard draws «Extender
				     vigencia» beside Imprimir; nothing behind it exists yet, and a
				     chip that silently does nothing is worse than one that
				     explains itself. -->
				<v-btn
					variant="tonal"
					size="small"
					data-testid="quotation-extend"
					@click="$emit('extend')"
				>
					{{ __("Extend validity") }}
				</v-btn>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
/**
 * The artboard's right column: what was promised, and the one act on it.
 *
 * It renders and emits; it decides nothing. `lines`, `warning` and the estado
 * all arrive resolved from `CotizacionesSurface.vue`, which is the only place
 * that talks to the server — so this component can be mounted in a test with
 * four plain props and no store, no bus and no `frappe`.
 */
import { computed } from "vue";

import {
	expiryWarning,
	getQuotationTab,
	type QuotationLine,
	type QuotationRow,
} from "./quotationModel";

const props = defineProps<{
	row: QuotationRow | null;
	lines: QuotationLine[];
	loadingLines: boolean;
	loading: boolean;
	offline: boolean;
	expired: boolean;
	quotedTotal: number;
	todayTotal: number;
	formatCurrency: (_value: number) => string;
}>();

defineEmits<{
	load: [QuotationRow];
	print: [QuotationRow];
	"open-invoice": [QuotationRow];
	extend: [];
}>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const tab = computed(() => getQuotationTab(props.row?.estado ?? "active"));

const warning = computed(() =>
	expiryWarning({
		expired: props.expired,
		quoted_total: props.quotedTotal,
		today_total: props.todayTotal,
	}),
);

/**
 * A converted quotation cannot be loaded, and neither can anything while the
 * register is offline: the load MINTS a draft invoice on the server, so there
 * is nothing to mint without one.
 */
const loadDisabled = computed(
	() => props.offline || Boolean(props.row?.converted_invoice) || props.loading,
);
</script>

<style scoped>
.quotation-detail {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 8px);
	width: 430px;
	flex: none;
	min-height: 0;
	padding: var(--reg-space-lg, 16px) 18px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-accent, rgba(0, 0, 0, 0.08));
	border-radius: var(--reg-radius-md, 14px);
	color: var(--pos-text-primary, #212121);
}

.quotation-detail__empty {
	margin: auto;
	font-size: 12.5px;
	color: var(--pos-text-secondary, #7b838f);
	text-align: center;
}

.quotation-detail__head {
	display: flex;
	align-items: center;
	gap: 10px;
}

.quotation-detail__ident {
	flex: 1;
	min-width: 0;
	line-height: 1.25;
}

.quotation-detail__folio {
	font-size: 15px;
	font-weight: 700;
}

.quotation-detail__meta {
	font-size: 11.5px;
	color: var(--pos-text-secondary, #7b838f);
}

.quotation-detail__estado {
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 700;
	white-space: nowrap;
}

.quotation-detail__estado[data-tone="good"] {
	background: var(--reg-good-soft, #e8f5e8);
	color: var(--reg-good-ink, #1b5e20);
}

.quotation-detail__estado[data-tone="warn"] {
	background: var(--reg-warn-soft, #fff3e0);
	color: var(--reg-warn-ink, #a15200);
}

.quotation-detail__estado[data-tone="bad"] {
	background: var(--reg-bad-soft, #fdeaea);
	color: var(--reg-bad-ink, #b42318);
}

.quotation-detail__estado[data-tone="muted"] {
	background: var(--reg-muted-soft, #f2f4f7);
	color: var(--reg-muted-ink, #667085);
}

.quotation-detail__notice {
	border-radius: 11px;
	padding: 9px 11px;
	font-size: 12px;
	line-height: 1.45;
}

.quotation-detail__notice--warn {
	background: var(--reg-warn-soft, #fdf9f0);
	border: 1px solid var(--reg-warn-edge, #f0dcae);
	color: var(--reg-warn-ink, #6b4a10);
}

.quotation-detail__notice--muted {
	background: var(--reg-muted-soft, #f2f4f7);
	color: var(--reg-muted-ink, #4a5260);
}

.quotation-detail__link {
	font: inherit;
	font-weight: 700;
	color: var(--pos-accent, #00838f);
	background: none;
	border: 0;
	padding: 0;
	cursor: pointer;
	text-decoration: underline;
}

.quotation-detail__lines {
	min-height: 0;
	overflow-y: auto;
	border-top: 1px solid var(--reg-border-light, #f2f4f7);
}

.quotation-detail__loading {
	padding: 10px 0;
	font-size: 12px;
	color: var(--pos-text-secondary, #7b838f);
}

.quotation-line {
	padding: 8px 0;
	border-bottom: 1px solid var(--reg-border-light, #f5f7f9);
}

.quotation-line__top {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	font-size: 13px;
}

.quotation-line__qty {
	color: var(--pos-text-secondary, #9aa2ae);
}

.quotation-line__amount {
	font-weight: 700;
}

.quotation-line__provenance {
	margin-top: 2px;
	font-size: 10.5px;
	color: var(--reg-good-ink, #14603a);
}

.quotation-detail__note {
	border-radius: 11px;
	padding: 10px 12px;
	background: var(--reg-warn-soft, #fdf9f0);
	border: 1px solid var(--reg-warn-edge, #f0dcae);
	font-size: 11.5px;
	line-height: 1.45;
	color: var(--reg-warn-ink, #6b4a10);
}

.quotation-detail__spacer {
	flex: 1;
}

.quotation-detail__totals {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding-top: 6px;
	border-top: 1px solid var(--reg-border-light, #f2f4f7);
}

.quotation-detail__total-row {
	display: flex;
	justify-content: space-between;
	font-size: 12.5px;
	font-weight: 700;
}

.quotation-detail__total {
	font-size: 16px;
}

.quotation-detail__primary {
	margin-top: 4px;
	height: 56px;
	font-weight: 700;
	letter-spacing: 0.01em;
}

.quotation-detail__secondary {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

@media (max-width: 1180px) {
	.quotation-detail {
		width: auto;
	}
}
</style>
