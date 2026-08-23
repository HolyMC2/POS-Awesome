<template>
	<div class="cobro-paper" data-testid="cobro-paper">
		<!--
			`Facturar · CFDI 4.0 al cerrar · Uso CFDI G03 · Régimen 626 ·
			Forma de pago 01 · Método PUE · Timbres disponibles 137 · Del
			paquete de 200 · Facturación de hoy · Timbradas 6 · Con error 0 ·
			Última 19:31` is NOT DRAWN, and the reason is larger than a missing
			figure.

			THE REGISTER DOES NOT STAMP AT CLOSE. `Payments.vue` contains no
			CFDI call; stamping is `FacturacionDialog` against an invoice that
			has already been submitted, and `cfdiStore.ts` holds catalogs, a
			search and a stamp state machine — it has no quota and no daily
			counters, and the endpoints behind it return none. Drawing a column
			that promises this button will stamp would be the one kind of wrong
			figure a cashier repeats out loud to a customer.

			`Enviar el comprobante · WhatsApp · Correo · Sólo imprimir ·
			55 •••• 6390 · confirmado` is absent for the same shape of reason:
			no send path exists on this screen, so there is nothing to choose
			between. What the register really offers is printing, and that is
			the button its own footer has always had.
		-->
		<!--
			`Cambio a entregar`, with the notes the drawer has to hand back, and
			the two figures that say where the sale stands: `Recibido` and
			`Falta por cubrir`. THE OUTCOME COLUMN, and the one place on this
			surface those three are stated — the pad shows what is being keyed,
			the method rows show what sits on each tender, and the band repeats
			only the change, as its one number.

			The band and this card cannot disagree: both read the committed
			payment rows, and the pad's buffer moves neither until `Aplicar` —
			see `CobroTenderPad`.

			`hide-total` because the ticket's total is `CobroTotalsFooter`'s, one
			column to the left. `Hay 7 billetes de $50 y 8 monedas de $20 en el
			cajón` is not drawn: the drawer's live denomination counts have no
			read model, and `ChangeToHand` already handles an unknown drawer by
			suggesting from the currency's faces alone.
		-->
		<ChangeToHand :totals="totals" :format-currency="formatChange" hide-total />

		<!-- Below the outcome, not above it: the customer's RFC is a fact about
		     the paperwork, and the cashier's eye belongs on the change first. -->
		<section v-if="maskedTaxId" class="cobro-paper__card" data-testid="cobro-fiscal">
			<h3 class="cobro-paper__label">{{ __("Customer tax details") }}</h3>
			<p class="cobro-paper__rfc reg-mono" data-testid="cobro-rfc">{{ maskedTaxId }}</p>
			<p class="cobro-paper__note">{{ __("On file for this customer") }}</p>
		</section>
	</div>
</template>

<script setup>
/**
 * Column three of the desktop Cobro — the money's PAPER (build plan §14.2).
 *
 * A renderer. It computes no money: `resolvePayTotals` restates the invoice's
 * total against what has been tendered, in integer minor units, and hands the
 * change to `changeBreakdown` — which runs the corte's own denomination table
 * backwards. One table, counted at the close and dispensed here.
 */
import { computed } from "vue";

import ChangeToHand from "../../mobile/pay/ChangeToHand.vue";
import { resolvePayTotals } from "../../mobile/pay/payTotals";

const props = defineProps({
	/** The invoice total, major units, as the register computes it. */
	total: { type: Number, default: 0 },
	/** Already committed to payment lines, major units. */
	tendered: { type: Number, default: 0 },
	currency: { type: String, default: "" },
	formatCurrency: { type: Function, required: true },
	/** `customer_info.tax_id`. A customer with none renders no card. */
	taxId: { type: String, default: "" },
});

const __ = (value) => (typeof window !== "undefined" && window.__ ? window.__(value) : value);

/**
 * `keyedMinor` is deliberately not passed. The change card reads what is
 * COMMITTED, which is what the band reads, so the two figures on this screen
 * are one figure.
 */
const totals = computed(() =>
	resolvePayTotals({
		total: props.total,
		tendered: props.tendered,
		currency: props.currency,
	}),
);

// ChangeToHand's contract is `(value) => string`; ours takes a currency too.
const formatChange = (value) => props.formatCurrency(value, props.currency);

/**
 * An RFC identifies a taxpayer and the artboard masks it (`RIBA•••••••M4`).
 * Masked here for the same reason: this screen faces a counter, and the
 * cashier only has to recognise that the right one is on file.
 */
const maskedTaxId = computed(() => {
	const value = String(props.taxId ?? "").trim();
	if (value.length < 6) return value;
	return `${value.slice(0, 4)}${"•".repeat(value.length - 6)}${value.slice(-2)}`;
});
</script>

<style scoped>
.cobro-paper {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
}

.cobro-paper__card {
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	padding: var(--reg-space-lg, 14px);
}

.cobro-paper__label {
	margin: 0 0 var(--reg-space-sm, 6px);
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cobro-paper__rfc {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cobro-paper__note {
	margin: var(--reg-space-2xs, 2px) 0 0;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}
</style>
