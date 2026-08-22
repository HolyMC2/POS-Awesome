<template>
	<section class="movil-orden__card movil-orden__balance" data-testid="orden-balance">
		<!--
			Three parts and a result, each declaring what it is
			(`data-money-role`) so the four cannot be read as four totals. The
			arithmetic itself is `resolveBandState`'s — this block only shows its
			working, which is what makes "why is the saldo not the order total?"
			answerable at the counter instead of over the phone.
		-->
		<div class="movil-orden__part">
			<span>{{ __("Order") }}</span>
			<span class="reg-mono" data-money-role="breakdown" data-testid="orden-part-order">{{
				formatCurrency(orderTotal)
			}}</span>
		</div>
		<div class="movil-orden__part movil-orden__part--credit">
			<span>{{ __("− Advance") }}</span>
			<span class="reg-mono" data-money-role="breakdown" data-testid="orden-part-advance">{{
				formatCurrency(advance)
			}}</span>
		</div>
		<div class="movil-orden__part">
			<span>{{ __("+ Counter") }}</span>
			<span class="reg-mono" data-money-role="breakdown" data-testid="orden-part-counter">{{
				formatCurrency(counterSales)
			}}</span>
		</div>

		<div class="movil-orden__saldo">
			<span class="movil-orden__saldo-label">{{ __("Balance") }}</span>
			<span
				class="movil-orden__saldo-value reg-mono"
				data-money-role="total"
				data-testid="orden-balance-value"
				:data-band-kind="band.kind"
				>{{ formatCurrency(band.value) }}</span
			>
		</div>

		<p v-if="blockedReason" class="movil-orden__blocked" data-testid="orden-blocked-reason">
			{{ blockedReason }}
		</p>

		<!-- The one primary on this screen (§1 invariant 2). Its label is the
		     band's, so the phone and the desktop cannot end up calling the same
		     act two different things. -->
		<button
			type="button"
			class="movil-orden__primary"
			data-testid="orden-primary"
			:data-band-action="band.primaryAction.id"
			:disabled="!band.primaryEnabled"
			@click="onPrimary"
		>
			<v-icon icon="mdi-check" size="20" aria-hidden="true" />
			{{ __(band.primaryAction.labelKey, band.primaryAction.labelParams) }}
		</button>
	</section>
</template>

<script setup lang="ts">
/**
 * `Orden − Anticipo + Mostrador = Saldo`, and the one button that acts on it.
 *
 * The balance is NOT the order total, and the three parts are here so that
 * fact is legible rather than merely correct: the anticipo was taken on a
 * different day against the workshop's quote, and the counter sale was never
 * part of that quote. A cashier who cannot see the subtraction cannot answer
 * the customer who asks about it.
 *
 * `band` arrives already resolved by `resolveBandState` — this component
 * formats and emits, exactly as `ActionBand.vue` does, and for the same
 * reason: a surface that decided WHICH number to show would put the
 * one-number invariant in two places at once.
 */
import type { BandState } from "../../../../composables/pos/shell/bandState";

defineOptions({ name: "ServiceOrderBalance" });

const props = defineProps<{
	band: BandState;
	orderTotal: number;
	advance: number;
	counterSales: number;
	/** Empty when the charge can go ahead; the sentence to show when it cannot. */
	blockedReason?: string;
	formatCurrency: (_value: number) => string;
}>();

const emit = defineEmits<{ (_event: "primary", _actionId: string): void }>();

/** Named, not inline: `$emit` is not bound on the setup proxy (build plan §10). */
const onPrimary = () => emit("primary", props.band.primaryAction.id);

/** Mirrors `frappe-shim`'s `__`, as ActionBand.vue does — same reasoning. */
const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};
</script>

<style scoped>
/* Artboard values carried as fallbacks, as the band does. */
.movil-orden__card {
	background: var(--reg-surface, #ffffff);
	margin: 0 11px;
	border-radius: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	padding: 12px;
	flex: none;
}

.movil-orden__part {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	font-size: 11.5px;
	color: var(--reg-text-muted, #7b838f);
	margin-top: 3px;
}

.movil-orden__part:first-child {
	margin-top: 0;
}

.movil-orden__part--credit {
	color: var(--reg-tone-positive-label, #14603a);
}

.movil-orden__saldo {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	gap: 12px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.movil-orden__saldo-label {
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__saldo-value {
	font-size: 30px;
	font-weight: 700;
	letter-spacing: -0.03em;
	color: var(--reg-text-primary, #212121);
}

.movil-orden__blocked {
	margin: 9px 0 0;
	font-size: 11px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

/* The screen's one accent, and the only place a saturated brand colour is
 * allowed to appear (§1 invariant 2). */
.movil-orden__primary {
	width: 100%;
	margin-top: 11px;
	min-height: 54px;
	border: 0;
	border-radius: 12px;
	cursor: pointer;
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #ffffff);
	font-family: inherit;
	font-size: 15.5px;
	font-weight: 700;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 9px;
}

/* Disabled DROPS the accent rather than fading it — a translucent accent is
 * still the loudest thing on screen. Same rule the band follows. */
.movil-orden__primary:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: not-allowed;
}

/* WCAG 2.5.5: the one control a thumb lands on here. Desktop density is
 * untouched, as theme.css's own coarse block is. */
@media (pointer: coarse) {
	.movil-orden__primary {
		min-height: max(var(--reg-touch-min, 44px), 54px);
	}
}
</style>
