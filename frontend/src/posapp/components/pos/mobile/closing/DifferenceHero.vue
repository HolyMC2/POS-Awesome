<template>
	<section
		class="corte-hero"
		:class="`corte-hero--${tint}`"
		data-testid="movil-corte-hero"
		:data-band-tone="state.tone"
		:data-band-value="state.value"
	>
		<!-- `aria-live` for the same reason the band has it: the tone carries a
		     meaning a screen reader cannot see, and on a phone the figure changes
		     under the cashier's thumb as each denomination row is counted. -->
		<div class="corte-hero__figure" aria-live="polite" aria-atomic="true">
			<div class="corte-hero__label" data-testid="movil-corte-hero-label">
				{{ __(state.labelKey, state.labelParams) }}
			</div>
			<div class="corte-hero__number reg-mono" data-testid="movil-corte-difference" data-money-role="difference">
				{{ formattedDifference }}
			</div>
		</div>

		<div class="corte-hero__foot">
			<!-- "Expected in drawer", not "= Expected in drawer": the `=` belongs
			     to the derivation's last line further down the screen, where it
			     closes an identity. Here the figure is one half of a comparison. -->
			<span class="corte-hero__fact">
				{{ __("Expected in drawer") }}
				<span class="reg-mono" data-money-role="expected">{{ formatMoney(expected) }}</span>
			</span>
			<span class="corte-hero__fact">
				{{ __("Counted") }}
				<span class="reg-mono" data-money-role="counted">{{ formatMoney(counted) }}</span>
			</span>
			<!-- Not a money figure and so deliberately without a `data-money-role`:
			     it carries no currency and counting it as one would make the
			     register's "say it once" sweep report a total that isn't there. -->
			<span v-if="ratio" class="corte-hero__fact" data-testid="movil-corte-ratio">
				{{ __("{0} % of sales", [ratioLabel]) }}
			</span>
			<!-- A shift with no takings has no share-of-sales, and saying "0 %"
			     of a real difference would state the opposite of the truth. -->
			<span v-else class="corte-hero__fact corte-hero__fact--muted" data-testid="movil-corte-ratio-absent">
				{{ __("no sales to compare against") }}
			</span>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * The corte's difference, as the phone's hero (`MovilCorte.dc.html`).
 *
 * The desktop puts this number in the 134 px band at the bottom of the screen.
 * A phone has no bottom lane to spare — the artboard spends it on the dock —
 * so the same number moves to the top and keeps the band's vocabulary: one
 * figure, tinted by state, with its two operands and its share of the day
 * underneath at caption size.
 *
 * It renders a `BandState` and decides nothing. `resolveBandState` already
 * knows that a surplus is amber too and that only an exact drawer is calm;
 * re-deciding any of that here would be the second opinion this screen is
 * built to not have. There is NO accent anywhere in this file: the difference
 * is STATE (§17.7 invariant 2) and `CERRAR TURNO` is the screen's one primary.
 */
import { computed } from "vue";

import { type BandState, tintForTone } from "../../../../composables/pos/shell/bandState";
import { type DifferenceRatio } from "./differenceNote";

const props = withDefaults(
	defineProps<{
		/** Straight from `resolveBandState({ kind: "closing", … })`. */
		state: BandState;
		expected: number;
		counted: number;
		/** `null` on a shift with no takings — the caption says so instead. */
		ratio: DifferenceRatio | null;
		formatCurrency?: (_value: number) => string;
	}>(),
	{ formatCurrency: undefined },
);

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const tint = computed(() => tintForTone(props.state.tone));

const formatMoney = (value: number) =>
	props.formatCurrency ? props.formatCurrency(value) : String(value);

/**
 * The band's own value is signed and the artboard draws `−$25.00`, so the sign
 * is rendered outside the formatter: a tenant formatter that wraps negatives in
 * parentheses or moves the minus behind the symbol would otherwise decide how
 * a shortfall reads on this card.
 */
const formattedDifference = computed(() => {
	const value = props.state.value;
	const magnitude = formatMoney(Math.abs(value));
	return value < 0 ? `−${magnitude}` : magnitude;
});

/** Two decimals, always — "0.2 % de ventas" and "0.23 %" are the same figure
 *  printed at two different precisions, and the pair reads as two figures. */
const ratioLabel = computed(() => (props.ratio ? props.ratio.percent.toFixed(2) : ""));
</script>

<style scoped>
/* Tone tokens with artboard fallbacks, the pattern ActionBand.vue set, so the
   card is correct wherever register-tokens.css has not been wired in yet.
   Every colour here is a STATE colour; none of them is the accent. */
.corte-hero {
	padding: var(--reg-space-lg, 14px) 15px;
	border: 1px solid var(--reg-tone-neutral-border, rgba(0, 0, 0, 0.06));
	border-radius: 13px;
	background: var(--reg-tone-neutral-bg, #ffffff);
}

.corte-hero--warning {
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
}

.corte-hero--positive {
	border-color: var(--reg-tone-positive-border, #cdead8);
	background: var(--reg-tone-positive-bg, #f4fbf7);
}

.corte-hero__label {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.corte-hero--warning .corte-hero__label,
.corte-hero--warning .corte-hero__number {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.corte-hero--positive .corte-hero__label,
.corte-hero--positive .corte-hero__number {
	color: var(--reg-tone-positive-label, #1b5e20);
}

/* 46px, not the desktop band's 60px: the artboard drops the figure a step for
   the 390px viewport so `−$25.00` still fits on one line beside its label. */
.corte-hero__number {
	margin-top: 2px;
	font-size: 46px;
	font-weight: 700;
	letter-spacing: -0.035em;
	line-height: 1.05;
	color: var(--reg-tone-neutral-number, #212121);
}

.corte-hero__foot {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 4px 12px;
	margin-top: var(--reg-space-md, 10px);
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px solid var(--reg-tone-neutral-divider, #eceff3);
	font-size: 11.5px;
	color: var(--reg-text-secondary, #56606e);
}

.corte-hero--warning .corte-hero__foot {
	border-top-color: var(--reg-tone-warning-divider, #f0dcae);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.corte-hero--positive .corte-hero__foot {
	border-top-color: var(--reg-tone-positive-divider, #cdead8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.corte-hero__fact .reg-mono {
	font-weight: 700;
}

.corte-hero__fact--muted {
	opacity: 0.8;
}
</style>
