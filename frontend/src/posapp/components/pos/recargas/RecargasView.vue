<template>
	<!--
		Gated destinations are ABSENT, not disabled (ruling R3): a shop that does
		not sell airtime gets no Recargas screen at all, not an empty one. The rail
		already hides the entry; this is the second half of the same gate, for the
		deep link, the keyboard chord and the day somebody mounts this component
		directly — the same belt-and-braces `Pos.vue` puts around `openSaldoPicker`.
	-->
	<section
		v-if="enabled"
		class="recargas"
		data-testid="recargas-view"
		:aria-label="__('Airtime recharges')"
	>
		<header class="recargas__head">
			<div>
				<h2 class="recargas__heading">{{ __("Airtime recharges") }}</h2>
				<!-- The subtitle is the whole economic model of this screen in six
				     words: the money leaves the shop's own pouch before the customer
				     has paid for anything. -->
				<p class="recargas__subtitle">{{ __("it is charged from your saldo pouch") }}</p>
			</div>
			<div class="recargas__chips">
				<span v-if="ledger.complete" class="recargas__chip" data-testid="recargas-today-count">
					{{ __("{0} top-ups today").replace("{0}", String(ledger.operations ?? 0)) }}
				</span>
				<!--
					No "Comisión de hoy" chip. The artboard draws `$321` and there is no
					read model behind it: `list_transactions` does not select
					`Saldo Transaction.comision`, and the carrier's `ComisionCliente` is
					not exposed to the POS at all. Both gaps are named in
					`recargasModel.ts` and reported rather than invented, because a
					cashier who reads a commission believes they earned it.

					No clock and no connection chip either — those are the shell's
					(`components/navbar/registerStatusLine.ts`), and repeating them here
					would be the register saying one fact twice.
				-->
			</div>
		</header>

		<div class="recargas__body">
			<RecargasCapture
				:catalog-tree="catalogTree"
				:rows="rows"
				:last-entry="lastEntry"
				:format-currency="formatCurrency"
				:customer-phone="customerPhone"
				@intent="onIntent"
			>
				<RecargasLedger :ledger="ledger" :format-currency="formatCurrency" />
			</RecargasCapture>

			<RecargasBolsaCard :bolsa="bolsa" :format-currency="formatCurrency" />
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Recargas — the destination chrome (build plan §12 item F, `Recargas.dc.html`).
 *
 * ## What this screen is not
 *
 * It does not sell anything. A recharge is bought from TAECEL in real time and
 * every request that arrives there is charged whether it succeeds or not, so
 * the one path that spends the owner's money stays exactly where it already
 * was: the band arms it and `Pos.vue`'s `SALDO-INTEGRATION-POINT` sends it
 * through the saldo app's own capture flow. This component publishes an INTENT
 * — company, number, amount, item — and reads the payloads it is handed. That
 * is the whole of its contact with saldo.
 *
 * ## Where the figures come from
 *
 * Every payload arrives as a prop, normalised by `recargasModel.ts` and
 * `recargasCatalog.ts`, and each figure either has a real source or is not on
 * screen. The absences are commented where the figure would have gone rather
 * than listed somewhere nobody reads: the day's commission, the commission
 * rate, "te quedan", the pouch fill bar, the funding date, the burn-rate
 * estimate, the week chart and "Tu bolsa también paga" are all drawn on the
 * artboard and not one of them has a read model behind it.
 */
import { computed, ref } from "vue";

import RecargasBolsaCard from "./RecargasBolsaCard.vue";
import RecargasCapture from "./RecargasCapture.vue";
import RecargasLedger from "./RecargasLedger.vue";
import { recargasEnabled } from "./recargasGate";
import {
	buildTodayLedger,
	rechargeBandInput,
	resolveBolsa,
	type BolsaPayload,
	type RechargeIntent,
} from "./recargasModel";

type AnyRecord = Record<string, any>;

interface IntentPayload {
	intent: RechargeIntent;
	band: ReturnType<typeof rechargeBandInput>;
}

const props = withDefaults(
	defineProps<{
		/** `get_pos_available_balance()`'s envelope, or null when never read. */
		bolsaPayload?: BolsaPayload | null;
		/** `list_transactions().rows`. */
		rows?: AnyRecord[];
		/** `catalog_tree()`'s envelope. */
		catalogTree?: AnyRecord | null;
		/** The server's day, `YYYY-MM-DD`. */
		today: string;
		/** The `limit` the rows were fetched with, so truncation is detectable. */
		ledgerLimit: number;
		formatCurrency: (value: number) => string;
		posProfile?: AnyRecord | null;
		hasCapability?: (capability: string) => boolean;
		/** Phone of the customer already open on the register, if any. */
		customerPhone?: string | null;
	}>(),
	{
		bolsaPayload: null,
		rows: () => [],
		catalogTree: null,
		posProfile: null,
		hasCapability: undefined,
		customerPhone: null,
	},
);

const emit = defineEmits<{
	/** The band's input, recomputed whenever the operator changes anything. */
	intent: [IntentPayload];
}>();

const __ = (window as any).__ || ((value: string) => value);

const enabled = computed(() =>
	recargasEnabled({ posProfile: props.posProfile, hasCapability: props.hasCapability }),
);

const ledger = computed(() =>
	buildTodayLedger(props.rows, { today: props.today, limit: props.ledgerLimit }),
);
const lastEntry = computed(() => ledger.value.entries[0] ?? null);

/** The pending figure, mirrored from the capture so the pouch can say what is
 * left. Held here rather than reached for through a ref on the child: the pouch
 * and the capture are siblings, and a parent holding the one value they share
 * is the arrangement that cannot drift. */
const pendingAmount = ref(0);
const bolsa = computed(() => resolveBolsa(props.bolsaPayload, pendingAmount.value));

function onIntent(payload: IntentPayload): void {
	pendingAmount.value = payload.intent.amount ?? 0;
	emit("intent", payload);
}
</script>

<style scoped>
.recargas {
	display: flex;
	flex-direction: column;
	/* One scrollport on this surface, and it is the ledger's. Everything above is
	 * fixed-height, the body fills what is left, and `min-height: 0` runs all the
	 * way down (59c5fe1ad) — it is the half that actually does the work, since a
	 * flex item refuses to shrink below its content without it. */
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	gap: var(--reg-space-md);
	padding: var(--reg-space-lg);
	background: var(--reg-surface-sunken);
}

.recargas__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-lg);
	flex: 0 0 auto;
}

.recargas__heading {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary);
}

.recargas__subtitle {
	margin: 2px 0 0;
	font-size: 11.5px;
	color: var(--reg-text-muted);
}

.recargas__chips {
	display: flex;
	align-items: center;
	gap: 8px;
}

.recargas__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	background: var(--reg-surface-muted);
	color: var(--reg-text-muted);
}

.recargas__body {
	display: flex;
	gap: var(--reg-space-md);
	flex: 1 1 auto;
	min-height: 0;
}
</style>
