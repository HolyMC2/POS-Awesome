<template>
	<div class="orden-detail" data-testid="orden-detail">
		<p v-if="!order" class="orden-detail__idle" data-testid="orden-detail-idle">
			{{ __("Choose a service order to see what is on it.") }}
		</p>

		<template v-else>
			<header class="orden-detail__head">
				<span class="orden-detail__folio mono">#{{ order.folio }}</span>
				<span class="orden-detail__chip" :data-tone="state.tone">
					{{ __(state.labelKey) }}
				</span>
				<span v-if="order.technician" class="orden-detail__chip" data-tone="neutral">
					{{ __("Tech. {0}").replace("{0}", order.technician) }}
				</span>
				<span class="orden-detail__who">{{ order.customer_name }}</span>
				<span v-if="benchLabel" class="orden-detail__bench">{{ benchLabel }}</span>
				<span
					v-for="device in deviceIds"
					:key="device"
					class="orden-detail__bench mono"
					data-testid="orden-device-id"
					>{{ __("IMEI {0}").replace("{0}", device) }}</span
				>
			</header>

			<div class="orden-detail__lines">
				<div class="orden-detail__row orden-detail__row--head">
					<span>{{ __("Item") }}</span>
					<span class="orden-detail__num">{{ __("Qty") }}</span>
					<span class="orden-detail__num">{{ __("Price") }}</span>
					<span class="orden-detail__num">{{ __("Amount") }}</span>
				</div>

				<p v-if="!order.lines.length" class="orden-detail__idle">
					{{ __("This order carries no lines yet.") }}
				</p>

				<div
					v-for="(line, index) in order.lines"
					:key="`${line.item_code}-${index}`"
					class="orden-detail__row"
					:class="{ 'orden-detail__row--free': !line.billable }"
					:data-provenance="line.provenance"
				>
					<span class="orden-detail__item">
						<span class="orden-detail__item-name">{{ line.item_name }}</span>
						<span class="orden-detail__item-note mono">{{ noteFor(line) }}</span>
					</span>
					<span class="orden-detail__num mono">{{ formatFloat(line.qty) }}</span>
					<span class="orden-detail__num mono">{{
						line.billable ? formatCurrency(line.rate) : "—"
					}}</span>
					<span class="orden-detail__num orden-detail__num--total mono">{{
						formatCurrency(line.amount)
					}}</span>
				</div>
			</div>

			<footer class="orden-detail__totals">
				<span class="orden-detail__total">
					{{ __("Order") }}
					<span class="mono">{{ formatCurrency(balance.orderTotal) }}</span>
				</span>
				<span v-if="balance.advance > 0" class="orden-detail__total orden-detail__total--credit">
					− {{ __("Advance") }}
					<span class="mono">{{ formatCurrency(balance.advance) }}</span>
				</span>
				<span class="orden-detail__total orden-detail__total--due">
					{{ __("Balance due") }}
					<span class="mono">{{ formatCurrency(balance.saldo) }}</span>
				</span>
			</footer>
		</template>
	</div>
</template>

<script setup lang="ts">
/**
 * The detail panel of the Orden surface (artboard `Orden.dc.html`, centre).
 *
 * The reason this panel exists is the qualifier under each line: «refacción ·
 * surtida de almacén», «pieza traída por el cliente · no se cobra». A cashier
 * looking at a repair bill has to be able to answer "why is this on here" and
 * "why is that one free" without walking to the bench, and the charge request
 * alone cannot answer either — the customer-supplied row is not even in it
 * (see the server's `describe_order_lines`).
 *
 * TWO THINGS THE ARTBOARD DRAWS THAT ARE NOT HERE, deliberately:
 *
 * - **Subtotal and IVA.** The artboard prints both. The read model has neither
 *   and cannot: tax is applied by the Sales Invoice when
 *   `prepare_charge_request_invoice` builds it, from the tax template on the
 *   profile. Splitting a total into a subtotal and an IVA here would be this
 *   surface guessing at a figure the invoice will compute differently, and the
 *   cashier would read the guess as the ticket.
 * - **«CFDI 4.0 listo» and «Monedero $418».** Both are facts about the
 *   CUSTOMER, and this round builds no read model for either. Absent rather
 *   than faked, the same rule `CustomerStrip.vue` states about the purchase
 *   provenance it does not have.
 */
import { computed } from "vue";

import { describeBalance, describeCardState, describeDeviceIds, describeLine } from "./ordenModel";
import type { ServiceOrderDetail, ServiceOrderLine } from "../../../../services/serviceOrderService";

const props = defineProps<{
	order: ServiceOrderDetail | null;
	formatCurrency: (value: number) => string;
	formatFloat: (value: number) => string;
}>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const state = computed(() =>
	props.order
		? describeCardState(props.order)
		: { labelKey: "Ready", tone: "ready" as const, noteKey: null, chargeable: false },
);

const balance = computed(() => describeBalance(props.order));

/**
 * «SERV-PANT · mano de obra · 1 h 40 m» in the artboard; here the code, the
 * serial if there is one, and what the part IS. The bench time is on the
 * header rather than on the labour line — taller records one span per order,
 * not one per line, and repeating it beside a row would imply a measurement
 * nobody takes.
 */
const noteFor = (line: ServiceOrderLine): string => {
	const presentation = describeLine(line);
	return [
		...presentation.handles,
		presentation.labelKey ? __(presentation.labelKey) : "",
		presentation.noteKey ? __(presentation.noteKey) : "",
	]
		.filter((part) => part.length > 0)
		.join(" · ");
};

/** «IMEI 35•••••••••4821» — masked in `ordenModel`, never raw on this screen. */
const deviceIds = computed(() => describeDeviceIds(props.order));

/** «recibida 10:12 · terminada 18:40 · 8 h 28 m», with only the parts we hold. */
const benchLabel = computed(() => {
	const order = props.order;
	if (!order) return "";
	const parts: string[] = [];
	if (order.worked_minutes !== null && order.worked_minutes !== undefined) {
		const hours = Math.floor(order.worked_minutes / 60);
		const minutes = order.worked_minutes % 60;
		parts.push(
			hours > 0
				? __("{0} h {1} m").replace("{0}", String(hours)).replace("{1}", String(minutes))
				: __("{0} m").replace("{0}", String(minutes)),
		);
	}
	if (order.invoiced && order.invoice) {
		parts.push(__("Invoiced {0}").replace("{0}", order.invoice));
	}
	return parts.join(" · ");
});
</script>

<style scoped>
.orden-detail {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	gap: var(--reg-space-md, 10px);
	padding: var(--reg-space-lg, 14px) 16px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.orden-detail__idle {
	display: flex;
	flex: 1 1 auto;
	align-items: center;
	justify-content: center;
	margin: 0;
	padding: 24px;
	text-align: center;
	font-size: 13px;
	color: var(--reg-text-muted, #9aa2ae);
}

.orden-detail__head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 9px;
	flex: none;
}

.mono {
	font-variant-numeric: tabular-nums;
}

.orden-detail__folio {
	font-size: 19px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-text-primary, #212121);
	white-space: nowrap;
}

.orden-detail__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 500;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
}

.orden-detail__chip[data-tone="ready"] {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
	font-weight: 700;
}

.orden-detail__chip[data-tone="warning"] {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.orden-detail__who,
.orden-detail__bench {
	font-size: 12.5px;
	color: var(--reg-text-muted, #7b838f);
}

.orden-detail__lines {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.orden-detail__row {
	display: grid;
	/* Percentages, never `max()`: a fixed-layout grid drops a `max()` track and
	   every column ends up the same width. */
	grid-template-columns: 1fr 62px 96px 104px;
	gap: var(--reg-space-md, 10px);
	align-items: center;
	min-height: 46px;
	padding: 4px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f4f6f8);
}

.orden-detail__row--head {
	min-height: 32px;
	border-bottom: 1px solid var(--reg-divider, #eceff3);
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #7b838f);
}

.orden-detail__item {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.orden-detail__item-name {
	font-size: 13.5px;
	color: var(--reg-text-primary, #212121);
}

.orden-detail__item-note {
	font-size: 10.5px;
	color: var(--reg-text-muted, #9aa2ae);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.orden-detail__num {
	text-align: right;
	font-size: 13px;
	color: var(--reg-text-secondary, #4a5260);
}

.orden-detail__row--head .orden-detail__num {
	text-align: right;
}

.orden-detail__num--total {
	font-size: 14px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

/* A line the customer is not paying for reads as a fact, not as a discount:
   grey throughout, so the eye skips it while adding the ticket up. */
.orden-detail__row--free .orden-detail__item-name,
.orden-detail__row--free .orden-detail__num,
.orden-detail__row--free .orden-detail__num--total {
	color: var(--reg-text-muted, #9aa2ae);
}

.orden-detail__totals {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-lg, 14px);
	flex: none;
	padding-top: 11px;
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
	font-size: 12px;
	color: var(--reg-text-muted, #667085);
}

.orden-detail__total .mono {
	color: var(--reg-text-primary, #212121);
	font-weight: 500;
}

.orden-detail__total--credit,
.orden-detail__total--credit .mono {
	color: var(--reg-tone-positive-number, #14603a);
}

.orden-detail__total--due {
	margin-left: auto;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.orden-detail__total--due .mono {
	font-weight: 700;
}
</style>
