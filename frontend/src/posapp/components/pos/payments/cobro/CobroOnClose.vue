<template>
	<!--
		`Al cerrar`. Only what closing this sale actually does.

		NOT drawn, each because the register does not do it:

		 - `Imprime ticket` — printing is never automatic here. It is the
		   explicit `Submit & Print`, which the paper column offers as
		   `Charge and print`.
		 - `Timbra el CFDI 4.0` — `Payments.vue` carries no CFDI call at all;
		   stamping is `FacturacionDialog` against an invoice that has already
		   been submitted.
		 - `Envía por WhatsApp` — there is no send path on the payment screen.
		 - `Abona al monedero` — `walletSummary` has no read model for the
		   accrual (`collection_factor` never reaches the client) and refuses
		   to guess one.

		A checklist that promises four things and keeps one is worse than a
		checklist with one line on it.
	-->
	<p v-if="promises.length" class="cobro-close" data-testid="cobro-on-close">
		<!-- ONE LINE, at the foot of the tender column. It was a card with a
		     heading and a list, which on a screen where the only item is
		     "Descuenta 1 pzas del inventario" spent 70px of the column the pad
		     needed and read as a block ABOVE the keys (owner, 2026-08-23). A
		     caption is what a single standing fact is worth. -->
		<span class="cobro-close__label">{{ __("On closing") }}</span>
		<span
			v-for="promise in promises"
			:key="promise.key"
			class="cobro-close__item"
			:data-testid="`cobro-promise-${promise.key}`"
			>{{ promise.text }}</span
		>
	</p>
</template>

<script setup>
/**
 * What the register commits to when the sale closes (artboard `Cobro.dc.html`,
 * build plan §14.3).
 *
 * Every row has to be something the submit really does. The screen's whole
 * argument is that a cashier can read it and know what happens next; a row
 * that is aspirational teaches them to stop reading the block.
 */
import { computed } from "vue";

const props = defineProps({
	/** `invoice_doc.total_qty`. */
	itemCount: { type: Number, default: 0 },
	/** `invoice_doc.update_stock` — a register that does not move stock says so
	 *  by not drawing the line. */
	updatesStock: { type: Boolean, default: false },
});

const __ = (value, params) =>
	typeof window !== "undefined" && window.__ ? window.__(value, params) : value;

const promises = computed(() => {
	const rows = [];
	if (props.updatesStock && props.itemCount > 0) {
		rows.push({ key: "stock", text: __("Deducts {0} pcs from stock", [props.itemCount]) });
	}
	return rows;
});
</script>

<style scoped>
.cobro-close {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: var(--reg-space-sm, 6px);
	margin: 0;
	padding: 0 var(--reg-space-xs, 5px);
}

.cobro-close__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cobro-close__item {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}
</style>
