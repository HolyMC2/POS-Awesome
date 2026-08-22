<template>
	<section class="movil-totals" data-testid="movil-totals">
		<div class="movil-totals__row">
			<span class="movil-totals__label">{{ __("Subtotal") }}</span>
			<span class="movil-totals__figure reg-mono" data-money-role="breakdown" data-testid="movil-subtotal">{{
				formatCurrency(subtotal)
			}}</span>
		</div>

		<div class="movil-totals__row">
			<span class="movil-totals__label">{{ taxLabel }}</span>
			<span class="movil-totals__figure reg-mono" data-money-role="breakdown" data-testid="movil-tax">{{
				formatCurrency(tax)
			}}</span>
		</div>

		<!-- The wallet line is drawn only when the register can actually answer
		     what this purchase accrues. `walletSummary.ts` records why that is
		     null on every register today — the server computes the collection
		     factor and never puts it in the payload — and the artboard's
		     "Monedero acumula +$29.20" is therefore a promise this build cannot
		     make. Absent rather than guessed: a loyalty figure a cashier reads
		     aloud is a figure the shop owes. -->
		<div v-if="wallet.accrual !== null" class="movil-totals__row movil-totals__row--accrual">
			<span class="movil-totals__label">{{ accrualLabel }}</span>
			<span
				class="movil-totals__figure reg-mono"
				data-money-role="wallet-accrual"
				data-testid="movil-wallet-accrual"
				>+{{ formatCurrency(wallet.accrual) }}</span
			>
		</div>

		<div class="movil-totals__total">
			<span class="movil-totals__total-label">{{ __("Total") }}</span>
			<span class="movil-totals__total-figure reg-mono" data-money-role="total" data-testid="movil-total">{{
				formatCurrency(state.value)
			}}</span>
		</div>

		<!-- THE action, and the only saturated colour on this screen
		     (§17.7 invariant 2). The amount rides the label because the phone
		     has no 134 px band to put it in — see mobileSaleAction.ts. -->
		<button
			type="button"
			class="movil-totals__primary"
			data-testid="movil-primary"
			:data-band-action="action.id"
			:disabled="!action.enabled"
			@click="onPrimary"
		>
			<slot name="primary-icon" />
			<span class="movil-totals__primary-label">{{ primaryLabel }}</span>
			<span
				v-if="action.amount !== null && !action.interpolates"
				class="movil-totals__primary-amount reg-mono"
				data-money-role="action-total"
				data-testid="movil-primary-amount"
				>{{ formatCurrency(action.amount) }}</span
			>
		</button>
	</section>
</template>

<script setup lang="ts">
/**
 * The phone's totals card and its primary (`MovilVenta.dc.html`, nodes 45–52).
 *
 * ON A PHONE THIS CARD *IS* THE BAND. `Pos.vue` mounts `ActionBand` only when
 * the rail is visible, because below the boundary a second 134 px lane would
 * be a second number. So the invariant "one number, one action" is discharged
 * here instead: the figure comes from `resolveBandState`, unchanged and
 * unrecomputed, and the button is the action that state named.
 *
 * THE TOTAL APPEARS TWICE, DELIBERATELY, AND SAYS SO. The artboard draws
 * `$1,129.00` at 30 px and again inside `COBRAR $1,129.00`, and that is not the
 * triple-total defect wave 5 removed from the desk: the second figure is the
 * same number restated ON the action a thumb is about to press, which is the
 * whole reason the phone inlines it. It declares itself as
 * `data-money-role="action-total"` rather than `"total"` so a count across this
 * surface still finds exactly one total — and so a genuine third total cannot
 * hide behind the button's role.
 *
 * Subtotal and tax are passed IN rather than derived. `bandState.ts` owns the
 * number that matters; a card that recomputed `subtotal + tax` from the cart
 * would be a second opinion on the amount a customer is charged.
 */
import { computed } from "vue";

import type { BandState } from "../../../../composables/pos/shell/bandState";
import {
	resolveWalletSummary,
	type WalletSummaryInput,
} from "../../payments/walletSummary";
import { compactBandAction } from "./mobileSaleAction";

const props = withDefaults(
	defineProps<{
		/** From `resolveBandState({ kind: "sale", ... })`. Never recomputed. */
		state: BandState;
		subtotal: number;
		tax: number;
		/** Tax rate for the caption — `IVA 16 %`. Absent leaves it unnamed. */
		taxRate?: number | null;
		wallet?: WalletSummaryInput | null;
		formatCurrency?: (_value: number) => string;
	}>(),
	{
		taxRate: null,
		wallet: null,
		formatCurrency: (value: number) => value.toFixed(2),
	},
);

const emit = defineEmits<{ (_event: "primary", _actionId: string): void }>();

const onPrimary = () => emit("primary", action.value.id);

/**
 * Mirrors `ActionBand.vue`'s `__`: look up, then substitute `{0}`-style args by
 * index. The fallback interpolates too — one that dropped the args would render
 * a literal "{0}" on the button for however long the shim takes to attach.
 */
const __ = (text: string, args?: (string | number)[]): string => {
	const translate = typeof window !== "undefined" ? (window as any).__ : undefined;
	if (translate) return translate(text, args);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const wallet = computed(() => resolveWalletSummary(props.wallet));

const action = computed(() => compactBandAction(props.state));

/**
 * `Impuesto 16 %`. The artboard writes `IVA`, which is the word on a Mexican
 * ticket; `es.csv` carries `Tax,Impuesto` and §7 forbids an agent editing that
 * file, so the existing row ships and the better one (`Tax {0} %` → `IVA {0} %`)
 * is in this task's report.
 */
const taxLabel = computed(() =>
	props.taxRate === null || props.taxRate === undefined
		? __("Tax")
		: `${__("Tax")} ${props.taxRate} %`,
);

/** "Monedero del cliente · Acumula" — both halves already translated. */
const accrualLabel = computed(
	() =>
		`${wallet.value.kind === "loyalty" ? __("Customer points") : __("Customer wallet")} · ${__(
			"Earns",
		)}`,
);

/**
 * The button's words. When the compact label carries its own `{0}` the amount
 * substitutes into it; otherwise the label stands alone and the amount is a
 * sibling span, which is what lets it declare its own money role.
 */
const primaryLabel = computed(() =>
	action.value.interpolates && action.value.amount !== null
		? __(action.value.labelKey, [props.formatCurrency(action.value.amount)])
		: __(action.value.labelKey),
);
</script>

<style scoped>
.movil-totals {
	display: flex;
	flex-direction: column;
	flex: none;
	padding: 12px;
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #ffffff);
}

.movil-totals__row {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.movil-totals__row + .movil-totals__row {
	margin-top: 3px;
}

/* Green is STATE — money the customer gains — and it is a caption colour, not
 * a fill. The one saturated fill on this screen is the primary below. */
.movil-totals__row--accrual,
.movil-totals__row--accrual .movil-totals__figure {
	color: var(--reg-tone-positive-label, #1b5e20);
	font-weight: 700;
}

.movil-totals__total {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.movil-totals__total-label {
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-totals__total-figure {
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.03em;
	color: var(--reg-text-primary, #212121);
}

.movil-totals__primary {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 9px;
	width: 100%;
	margin-top: 11px;
	/* 54px on purpose: it is the artboard's height AND comfortably past the
	   44px floor, so this control needs no coarse-pointer override. */
	min-height: 54px;
	border: 0;
	border-radius: var(--reg-radius-md, 14px);
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #ffffff);
	font: inherit;
	font-size: 16.5px;
	font-weight: 700;
	text-transform: uppercase;
	cursor: pointer;
}

.movil-totals__primary:active {
	background: var(--reg-accent-pressed, #00838f);
}

/* Disabled DROPS the accent rather than fading it — a 60%-opacity teal still
 * reads as the one thing to press. Same rule ActionBand's own spec pins. */
.movil-totals__primary:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: default;
}

.movil-totals__primary-amount {
	font-variant-numeric: tabular-nums;
}
</style>
