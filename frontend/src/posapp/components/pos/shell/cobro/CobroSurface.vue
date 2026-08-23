<template>
	<section class="cobro-surface" data-testid="cobro-host">
		<!--
			`Payments.vue` itself, in its `cobro` layout. Not a copy, not a
			wrapper that re-homes its sections: the same component, the same
			state, the same submit — only the chrome differs. See §14.4 item 1
			and the log entry for why re-homing from OUTSIDE was rejected.
		-->
		<Payments cobro-mode />
	</section>
</template>

<script setup lang="ts">
/**
 * The desktop Cobro as a hosted surface beside the rail (build plan §14.2).
 *
 * `Pos.vue` renders this in `.register-shell__content` — the same slot
 * `DestinationHost` uses — whenever the rail is on screen and the payment
 * dialog would otherwise have opened. Below the rail boundary nothing changes:
 * the `v-dialog` and the narrow layout's payment column are untouched.
 *
 * WHAT THIS FILE IS FOR, given that `Payments.vue` draws the whole surface:
 * publishing the band. The band is the shell's, `Payments.vue` has no emit and
 * gains none, and this component is the seam where the two meet — it reads the
 * invoice document (which is what `Payments.vue` writes into) and hands the
 * shell a `BandState`.
 *
 * ⚠ IT COMPUTES NO MONEY. `resolveBandState` is a description of two figures
 * the register already holds: the invoice's own total, and the sum of the
 * payment rows. It rounds nothing, decides nothing, and submits nothing —
 * `payTotals.ts` states the same rule for the phone's screen and it is the
 * same rule here.
 */
import { computed, defineAsyncComponent, watch } from "vue";
import { storeToRefs } from "pinia";

import { useInvoiceStore } from "../../../../stores/invoiceStore";
import { useUIStore } from "../../../../stores/uiStore";
import { resolveBandState, type BandState } from "../../../../composables/pos/shell/bandState";

// Async, like `Pos.vue`'s own reference to it: the payment chunk must not be
// pulled into the shell's initial bundle just because this thin host is
// statically imported there. §6 budgets payment-open at 150 ms p95, and that
// budget assumes the chunk arrives when the cashier asks for it.
const Payments = defineAsyncComponent(() => import("../../Payments.vue"));

const emit = defineEmits<{ band: [BandState] }>();

const invoiceStore = useInvoiceStore();
const uiStore = useUIStore();
const { invoiceDoc } = storeToRefs(invoiceStore);
const { posProfile } = storeToRefs(uiStore);

const toNumber = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The amount the cashier is settling.
 *
 * Mirrors `Payments.vue`'s `invoiceChargeTotal`, including the multi-currency
 * branch: a foreign-currency invoice on a register that allows them is charged
 * at `grand_total`, everything else at the rounded total. Written out rather
 * than simplified so the band and "To Be Paid" cannot disagree on the one
 * register where they would.
 */
const total = computed(() => {
	const doc = invoiceDoc.value as Record<string, unknown> | null;
	if (!doc) return 0;
	const profile = (posProfile.value ?? {}) as Record<string, unknown>;
	if (profile.posa_allow_multi_currency && doc.currency !== profile.currency) {
		return toNumber(doc.grand_total);
	}
	return toNumber(doc.rounded_total) || toNumber(doc.grand_total);
});

/** What has actually been committed to payment rows. */
const received = computed(() => {
	const rows = (invoiceDoc.value as { payments?: unknown[] } | null)?.payments;
	if (!Array.isArray(rows)) return 0;
	return rows.reduce<number>((sum, row) => sum + toNumber((row as { amount?: unknown })?.amount), 0);
});

const band = computed(() =>
	resolveBandState({ kind: "tender", total: total.value, received: received.value }),
);

// `immediate`: the surface is mounted BECAUSE the cashier pressed PAGAR, so
// the band has to change in the same breath. Waiting for the first amount
// would leave the sale's own `PAY` under a screen that is no longer the sale.
watch(band, (state) => emit("band", state), { immediate: true, deep: false });
</script>

<style scoped>
.cobro-surface {
	display: flex;
	flex-direction: column;
	/* Same height-chain discipline as `DestinationHost`: fill the parent,
	   refuse to grow past it, and let the columns inside own the scrollports.
	   `min-height: 0` is the half that actually does the work. */
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}
</style>
