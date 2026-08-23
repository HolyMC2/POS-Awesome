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
	<section v-if="promises.length" class="cobro-close" data-testid="cobro-on-close">
		<h3 class="cobro-close__label">{{ __("On closing") }}</h3>
		<ul class="cobro-close__list">
			<li
				v-for="promise in promises"
				:key="promise.key"
				class="cobro-close__item"
				:data-testid="`cobro-promise-${promise.key}`"
			>
				{{ promise.text }}
			</li>
		</ul>
	</section>
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
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	padding: var(--reg-space-lg, 14px);
}

.cobro-close__label {
	margin: 0 0 var(--reg-space-sm, 6px);
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cobro-close__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xs, 5px);
}

.cobro-close__item {
	font-size: 13px;
	color: var(--reg-text-secondary, #56606e);
}
</style>
