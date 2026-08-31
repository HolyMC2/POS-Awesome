<template>
	<section
		class="change-card"
		:class="`change-card--${tone}`"
		data-testid="movil-change-card"
		:data-tone="tone"
	>
		<h2 class="change-card__label">{{ __(headline.labelKey) }}</h2>

		<!--
			The one number this screen is about. `aria-live="polite"` because it
			moves under the cashier's thumb while they key an amount, and a
			figure that changes silently is a figure a screen-reader user has to
			go hunting for.

			`hideAmount` is the desktop Cobro under a band: the band's 36px
			figure IS this number, in the lane §17.7 reserves for it, and a 46px
			copy one column above was the owner's «the band duplicates the
			surface» in the other direction. The phone has no band, so the flag
			defaults to false and that screen is untouched.
		-->
		<p
			v-if="!hideAmount"
			class="change-card__amount reg-mono"
			data-testid="movil-change-amount"
			:data-money-role="headline.role"
			aria-live="polite"
		>
			{{ formatCurrency(headline.amount) }}
		</p>

		<!--
			The breakdown, and the reason this screen exists as more than a
			total: at a counter the cashier's next action is picking notes out
			of a drawer, and the register has already picked them.
		-->
		<ul v-if="notes.length" class="change-card__notes" data-testid="movil-change-notes">
			<li
				v-for="note in notes"
				:key="note.minor"
				class="change-card__note reg-mono"
				data-testid="movil-change-note"
				:data-face-minor="note.minor"
				:data-face-count="note.count"
			>
				{{ note.count }} ×
				<span data-money-role="change-note">{{ formatCurrency(faceMajor(note)) }}</span>
			</li>
		</ul>

		<!--
			Only when the drawer's faces genuinely cannot make the amount — MXN
			stops at $1, so fifty centavos of change lands here. Stated rather
			than rounded away: what the shop does about it is the shop's call,
			and a breakdown that quietly did not add up would be worse than one
			that says so.
		-->
		<p
			v-if="unbreakable > 0"
			class="change-card__unbreakable"
			data-testid="movil-change-unbreakable"
		>
			<!--
				Split around the placeholder rather than interpolated into the
				string, so the amount can carry its own `data-money-role` and
				still sit wherever Spanish puts it. A figure with no role is
				exactly how a third total once reached a live register.
			-->
			<template v-for="(part, index) in unbreakableParts" :key="index">
				<span v-if="part.money" class="reg-mono" data-money-role="change-unbreakable">{{
					part.text
				}}</span>
				<template v-else>{{ part.text }}</template>
			</template>
		</p>

		<!--
			`hideFigures` is the same story as `hideAmount`, one row down: on the
			desktop Cobro the Recibido / Falta pair is TELEPORTED into the band's
			breakdown lane, which is the lane the band publishes and the owner
			found empty across a thousand pixels. Said there, it must not also be
			said here. The phone keeps the pair — it has no lane to move it to.
		-->
		<dl v-if="!hideFigures" class="change-card__figures">
			<!--
				The desktop Cobro states the ticket's total in its own column, in
				`CobroTotalsFooter`, and a second copy here would put it on the
				screen twice — the defect the surface was rebuilt to remove. The
				phone has no such column, so it keeps the figure and the flag
				defaults to false.
			-->
			<div v-if="!hideTotal" class="change-card__figure">
				<dt>{{ __("Total") }}</dt>
				<dd class="reg-mono" data-testid="movil-pay-total" data-money-role="total">
					{{ formatCurrency(totals.total) }}
				</dd>
			</div>
			<div class="change-card__figure">
				<dt>{{ __("Received") }}</dt>
				<dd class="reg-mono" data-testid="movil-pay-received" data-money-role="received">
					{{ formatCurrency(totals.received) }}
				</dd>
			</div>
			<!--
				The counterpart of the headline, never a repeat of it. The
				artboard draws `Falta $0.00` under a change headline; when the
				sale is still short, this slot is what the customer will get
				back — which is $0.00 — and the headline is the shortfall. One
				figure, one place, either way round.
			-->
			<div class="change-card__figure">
				<dt>{{ __(counterpart.labelKey) }}</dt>
				<dd
					class="reg-mono"
					data-testid="movil-pay-counterpart"
					:data-money-role="counterpart.role"
				>
					{{ formatCurrency(counterpart.amount) }}
				</dd>
			</div>
		</dl>
	</section>
</template>

<script setup lang="ts">
/**
 * `Cambio a entregar · $71.00`, broken into `1 × $50 · 1 × $20 · 1 × $1`
 * (artboard `MovilCobro.dc.html`, build plan §12 G).
 *
 * Presentation over `payTotals.ts`. It renders figures and never derives one:
 * the amounts arrive already computed in integer minor units, and the only
 * arithmetic in this file is `minorToMajor` on a face value so a chip can say
 * `$50` instead of `5000`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It has no opinion about whether the sale
 * can be closed, no primary action, and no tender. Those live one level up, in
 * `MovilCobroView.vue`, which is also where the screen's single accent is
 * spent. Green here is STATE (§17.7 invariant 2) — change is due — and amber
 * is state too. Neither is emphasis and neither may become a fill on a button.
 */
import { computed } from "vue";

import { minorToMajor } from "../../closing/denominations";
import { noteFaceMajor, type ChangeNote } from "./changeBreakdown";
import type { PayTotals } from "./payTotals";

const props = withDefaults(
	defineProps<{
		totals: PayTotals;
		formatCurrency: (_value: number) => string;
		/** Drop the `Total` figure because the surface already states it. */
		hideTotal?: boolean;
		/** Drop the headline: a band below is already saying this number. */
		hideAmount?: boolean;
		/** Drop the Recibido / Falta pair: it went into the band's lane. */
		hideFigures?: boolean;
	}>(),
	{ hideTotal: false, hideAmount: false, hideFigures: false },
);

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

const notes = computed<ChangeNote[]>(() => props.totals.change.notes);
const unbreakable = computed(() => props.totals.change.unbreakableMinor);

const faceMajor = (note: ChangeNote): number => noteFaceMajor(note, props.totals.change.denominations);

/**
 * Which figure leads. `payTotals` guarantees at most one of the two is
 * non-zero, so this is a choice of wording rather than of arithmetic — and
 * when both are zero the sale is settled exactly, which is a change of nothing
 * rather than a shortfall of nothing.
 */
const isShort = computed(() => props.totals.shortfallMinor > 0);

const headline = computed(() =>
	isShort.value
		? { labelKey: "Still owed", role: "shortfall", amount: props.totals.shortfall }
		: { labelKey: "Change to give", role: "change", amount: props.totals.change.major },
);

const counterpart = computed(() =>
	isShort.value
		? { labelKey: "Change to give", role: "change", amount: props.totals.change.major }
		: { labelKey: "Still owed", role: "shortfall", amount: props.totals.shortfall },
);

const tone = computed(() => {
	if (isShort.value) return "warning";
	return props.totals.change.minor > 0 ? "positive" : "neutral";
});

/**
 * `{0} has no note or coin`, split around its placeholder so the amount is a
 * node of its own. `minorToMajor` rather than a raw division: the remainder is
 * an integer and the conversion belongs to the module that owns the boundary.
 */
const unbreakableParts = computed(() => {
	const amount = props.formatCurrency(minorToMajor(unbreakable.value, props.totals.minorPerMajor));
	const [before = "", after = ""] = __("{0} has no note or coin").split("{0}");
	return [
		{ text: before, money: false },
		{ text: amount, money: true },
		{ text: after, money: false },
	].filter((part) => part.text !== "");
});
</script>

<style scoped>
.change-card {
	border-radius: var(--reg-radius-md, 13px);
	border: 1px solid var(--reg-tone-neutral-border, rgba(0, 0, 0, 0.06));
	background: var(--reg-tone-neutral-bg, #fff);
	padding: var(--reg-space-lg, 14px) 15px;
}

.change-card--positive {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	border-color: var(--reg-tone-positive-border, #cdead8);
}

.change-card--warning {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border-color: var(--reg-tone-warning-border, #f0dcae);
}

.change-card__label {
	margin: 0;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.change-card--positive .change-card__label {
	color: var(--reg-tone-positive-label, #1b5e20);
}

.change-card--warning .change-card__label {
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.change-card__amount {
	margin: 2px 0 0;
	/* The artboard's 46px, which is the phone's version of the desktop band's
	   60px — same lane, smaller screen. */
	font-size: 46px;
	font-weight: 700;
	letter-spacing: -0.035em;
	line-height: 1.05;
	color: var(--reg-tone-neutral-number, #212121);
}

.change-card--positive .change-card__amount {
	color: var(--reg-tone-positive-number, #157a48);
}

.change-card--warning .change-card__amount {
	color: var(--reg-tone-warning-number, #8a5a0d);
}

.change-card__notes {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-xs, 5px);
	margin: var(--reg-space-md, 10px) 0 0;
	padding: 0;
	list-style: none;
}

.change-card__note {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	border-radius: 999px;
	border: 1px solid var(--reg-tone-positive-border, #cdead8);
	background: var(--reg-surface, #fff);
	color: var(--reg-tone-positive-label, #14603a);
	padding: 5px 11px;
	font-size: 12px;
	font-weight: 500;
	white-space: nowrap;
}

.change-card__unbreakable {
	margin: var(--reg-space-sm, 6px) 0 0;
	font-size: 11.5px;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.change-card__figures {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-sm, 6px);
	margin: 11px 0 0;
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px solid var(--reg-tone-neutral-divider, #eceff3);
	font-size: 11.5px;
	color: var(--reg-text-secondary, #56606e);
}

.change-card--positive .change-card__figures {
	border-top-color: var(--reg-tone-positive-divider, #cdead8);
	/* Tokenised rather than the artboard's literal #2f7a55: a hex here would
	   stay a light-mode green after theme.css flips (A1, wave 3). */
	color: var(--reg-tone-positive-label, #1b5e20);
}

.change-card--warning .change-card__figures {
	border-top-color: var(--reg-tone-warning-divider, #f0dcae);
}

.change-card__figure {
	display: flex;
	align-items: baseline;
	gap: 4px;
	min-width: 0;
}

.change-card__figure dt {
	font-weight: 400;
}

.change-card__figure dd {
	margin: 0;
	font-weight: 700;
}
</style>
