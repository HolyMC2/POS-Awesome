<template>
	<dl class="cobro-totals" data-testid="cobro-totals">
		<!--
			`Cobro.dc.html` closes the ticket card with Subtotal · IVA · Total,
			and this is that footer.
			────────────────────────────────────────────────────────────────────
			It is NOT a second copy of `InvoiceTotals`. That component is nine
			read-only Vuetify fields — Net Total, Tax and Charges, Total Amount,
			the diff, four discount lines, Grand Total, Rounded Total — and on
			the hosted surface it sat in the primary column with its own
			scrollbar. It is still the complete breakdown and it is still one
			click away, behind `More options`; what a cashier reads while taking
			money is these four rows.

			Each row is the DOCUMENT's own field. Nothing here adds, divides or
			rounds: the register computed all four server-side and this states
			them. The tax LABEL is the only derived value, and it is derived by
			`saleTaxBreakdown` — the module the sale band already labels its own
			IVA pair with — so `IVA 16 %` says the same words in both places.
		-->
		<div class="cobro-totals__row">
			<dt class="cobro-totals__label">{{ __("Subtotal") }}</dt>
			<dd class="cobro-totals__value reg-mono" data-money-role="subtotal">
				{{ currencySymbol }}{{ formatCurrency(subtotal) }}
			</dd>
		</div>

		<!-- Absent, never zeroed, when the ticket carries no tax: `IVA $0.00` is
		     a claim about this sale, and "there is no tax line" is not it. -->
		<div v-if="showsTax" class="cobro-totals__row">
			<dt class="cobro-totals__label" data-testid="cobro-tax-label">{{ taxLabel }}</dt>
			<dd class="cobro-totals__value reg-mono" data-money-role="tax">
				{{ currencySymbol }}{{ formatCurrency(tax) }}
			</dd>
		</div>

		<!-- Same rule: a sale with no discount does not spend a line saying so. -->
		<div v-if="showsDiscount" class="cobro-totals__row">
			<dt class="cobro-totals__label">{{ __("Discount") }}</dt>
			<dd class="cobro-totals__value reg-mono" data-money-role="discount">
				{{ currencySymbol }}{{ formatCurrency(discount) }}
			</dd>
		</div>

		<div class="cobro-totals__row cobro-totals__row--total">
			<dt class="cobro-totals__label cobro-totals__label--total">{{ __("Total") }}</dt>
			<dd
				class="cobro-totals__value cobro-totals__value--total reg-mono"
				data-testid="cobro-total"
				data-money-role="total"
			>
				{{ currencySymbol }}{{ formatCurrency(total) }}
			</dd>
		</div>
	</dl>
</template>

<script setup>
/**
 * The ticket's totals, four single-line rows (build plan §14.2, round 3).
 *
 * Presentation only — it holds no state, emits nothing and computes no money.
 * Every figure arrives as a prop from `Payments.vue`, which reads them off the
 * invoice document.
 *
 * THE ONE PLACE THE SURFACE STATES THE TOTAL. The change card used to carry a
 * `Total` figure of its own beside `Recibido`; on this surface it does not, so
 * `[data-money-role="total"]` resolves to exactly this row (pinned by
 * `cobroSaysItOnce.spec.ts`).
 */
import { computed } from "vue";

const props = defineProps({
	/** `invoice_doc.net_total` — the pre-tax base the tax pair sits beside. */
	subtotal: { type: Number, default: 0 },
	/** The tenant's own name for the tax, rate included: `IVA 16 %`. */
	taxLabel: { type: String, default: "" },
	/** `invoice_doc.total_taxes_and_charges`. */
	tax: { type: Number, default: 0 },
	/** Item/rate discounts plus the invoice-level one. */
	discount: { type: Number, default: 0 },
	/** What the cashier is settling — `Payments.vue`'s `invoiceChargeTotal`. */
	total: { type: Number, default: 0 },
	/** Bare number, no symbol — the register's own `formatCurrency`. */
	formatCurrency: { type: Function, required: true },
	currencySymbol: { type: String, default: "" },
});

const __ = (value) => (typeof window !== "undefined" && window.__ ? window.__(value) : value);

const showsTax = computed(() => Boolean(props.taxLabel) && Number(props.tax) !== 0);
const showsDiscount = computed(() => Number(props.discount) !== 0);
</script>

<style scoped>
.cobro-totals {
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 6px);
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	padding: var(--reg-space-lg, 14px);
}

/* Single line, always: the label truncates before the figure gives up a
   digit, because a wrapped `IVA 16 % (INCLUIDO EN EL PRECIO)` is what turned
   this card into two cards on a narrow column. */
.cobro-totals__row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
}

.cobro-totals__label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12.5px;
	color: var(--reg-text-muted, #7b838f);
}

.cobro-totals__value {
	margin: 0;
	font-size: 12.5px;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

.cobro-totals__row--total {
	margin-top: var(--reg-space-2xs, 2px);
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px solid var(--reg-divider, #eceff3);
}

.cobro-totals__label--total {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cobro-totals__value--total {
	font-size: 25px;
	font-weight: 700;
	letter-spacing: -0.02em;
}
</style>
