<template>
	<div class="cobro-pad" data-testid="cobro-tender-pad">
		<!-- Forma de pago. The chips ARE the invoice's payment rows, not a
		     parallel list: a chip that cannot be pointed at a row is a tender
		     the register cannot take. -->
		<section v-if="chips.length" class="cobro-pad__card" data-testid="cobro-tender-row">
			<h3 class="cobro-pad__label">{{ __("Payment method") }}</h3>
			<div class="cobro-pad__tenders" role="group" :aria-label="__('Payment method')">
				<button
					v-for="chip in chips"
					:key="chip.mode"
					type="button"
					class="cobro-pad__tender"
					:class="{ 'cobro-pad__tender--on': chip.mode === activeMode }"
					:data-testid="`cobro-tender-${chip.mode}`"
					:data-armed="chip.mode === activeMode ? 'true' : 'false'"
					:aria-pressed="chip.mode === activeMode"
					@click="pickTender(chip.mode)"
				>
					{{ chip.mode }}
				</button>
			</div>
		</section>

		<!-- Recibido. One figure, the row's own `amount`, formatted by the
		     register's formatter — never a second arithmetic. -->
		<section class="cobro-pad__card cobro-pad__received">
			<div class="cobro-pad__received-head">
				<h3 class="cobro-pad__label">{{ receivedLabel }}</h3>
				<!--
					The chord is RESOLVED, never the artboard's. `Cobro.dc.html`
					prints `Enter cobra · F6 divide el pago`; the register binds
					`payment.submit` to alt+x and binds no split at all, so this
					renders what the keymap says and the F6 half is simply not
					drawn (R8, and §14.4 item 4's own condition — the split flow
					does not exist in `usePaymentMethods`).
				-->
				<span v-if="submitChord" class="cobro-pad__hint" data-testid="cobro-submit-chord">
					<kbd class="cobro-pad__kbd">{{ submitChord }}</kbd>
					{{ chargesHint }}
				</span>
			</div>

			<output
				class="cobro-pad__amount reg-mono"
				data-testid="cobro-received"
				data-money-role="received"
				aria-live="polite"
				>{{ formatCurrency(receivedAmount, currency) }}</output
			>

			<div class="cobro-pad__presets">
				<button
					type="button"
					class="cobro-pad__preset cobro-pad__preset--exact"
					data-testid="cobro-exact"
					:disabled="!targetPayment"
					@click="onExact"
				>
					{{ __("Exact") }}
				</button>
				<!--
					The artboard's `$1,150 · $1,200 · $1,500 · $2,000` are not
					invented round numbers: `getVisibleDenominations` runs
					`getSmartTenderSuggestions` over what is still owed, which is
					where those four come from. An amount already covered returns
					an empty list and the row disappears rather than offering
					change-making for a settled sale.
				-->
				<button
					v-for="denomination in presets"
					:key="denomination"
					type="button"
					class="cobro-pad__preset"
					:data-testid="`cobro-preset-${denomination}`"
					@click="$emit('set-denomination', targetPayment, denomination)"
				>
					<span data-money-role="preset">{{ formatCurrency(denomination, currency) }}</span>
				</button>
			</div>
		</section>

		<!--
			The pad is the phone's, reused whole. Its fourth column carries
			`Dividir pago` where the desktop artboard draws `Aplicar`, and it is
			passed `:split-enabled="false"` because no split flow exists to
			answer it. Editing `KEYPAD_LAYOUT` to suit a desktop mock would move
			the most-tapped surface in the product, so `Aplicar` is a button of
			its own below instead — recorded in the log as a deviation.
		-->
		<div class="cobro-pad__card cobro-pad__keys">
			<PayKeypad
				:entry="entry"
				:minor-per-major="minorPerMajor"
				:display-label="keyedLabel"
				:split-enabled="false"
				@update:entry="entry = $event"
			/>
			<button
				type="button"
				class="cobro-pad__apply"
				data-testid="cobro-apply"
				:disabled="!canApply"
				@click="onApply"
			>
				{{ __("Apply") }}
			</button>
		</div>

		<!-- Pagos aplicados. Only rows carrying money: a list of every method
		     at 0.00 is the old dialog's card stack with smaller type. -->
		<section class="cobro-pad__card" data-testid="cobro-applied">
			<h3 class="cobro-pad__label">{{ __("Applied payments") }}</h3>
			<ul v-if="appliedRows.length" class="cobro-pad__applied">
				<li
					v-for="row in appliedRows"
					:key="row.mode_of_payment"
					class="cobro-pad__applied-row"
					:data-testid="`cobro-applied-${row.mode_of_payment}`"
				>
					<span class="cobro-pad__applied-mode">{{ row.mode_of_payment }}</span>
					<span class="cobro-pad__applied-amount reg-mono" data-money-role="applied">{{
						formatCurrency(row.amount, currency)
					}}</span>
				</li>
			</ul>
			<p v-else class="cobro-pad__empty">{{ __("Nothing tendered yet") }}</p>

			<p class="cobro-pad__outstanding" :data-covered="outstanding <= 0 ? 'true' : 'false'">
				<!-- `Still owed` is already the band's word for this figure and
				     already reads `Falta por cubrir` in Spanish. One string,
				     one meaning: a second key would let the two drift. -->
				<span class="cobro-pad__applied-mode">{{ __("Still owed") }}</span>
				<span class="cobro-pad__applied-amount reg-mono" data-money-role="outstanding">{{
					formatCurrency(Math.max(outstanding, 0), currency)
				}}</span>
			</p>
		</section>
	</div>
</template>

<script setup>
/**
 * Column two of the desktop Cobro — the money's HOW (build plan §14.2).
 *
 * ⚠ MONEY PATH: THIS FILE IS CHROME. It writes nothing itself. Every amount
 * it changes leaves through the contract `PaymentMethods` already has —
 * `update-amount`, `set-full-amount`, `set-denomination` — which `Payments.vue`
 * answers with `handlePaymentAmountChange`, `set_full_amount` and
 * `setPaymentToDenomination`. That is the whole reason the Cobro layout lives
 * INSIDE `Payments.vue` rather than around it: as an ordinary child this pad
 * reaches the register's own handlers, and nothing new had to be exposed for
 * a layout.
 *
 * **The pad's buffer is a display until `Aplicar`.** The mobile Cobro moves
 * its change figure under the cashier's thumb as they key, because nothing
 * else on that screen carries the number. Here the band is 134 px below, and a
 * card previewing an amount the band had not adopted would be the two-numbers
 * defect §11 spent a wave removing. `Exacto` and the tender chips commit at
 * once — they are already a commitment — and from any of those three the
 * applied rows, the change card and the band read one figure.
 *
 * The lit tender is derived from the INVOICE, never from a second store: the
 * row carrying money, or the row the register marked default. `armTender` is
 * called on a pick as well, so the sale screen's chip strip agrees with this
 * one when the cashier backs out — but nothing on this screen is drawn from
 * it.
 */
import { computed, ref } from "vue";

import PayKeypad from "../../mobile/pay/PayKeypad.vue";
import { EMPTY_ENTRY, entryMinor } from "../../mobile/pay/keypadEntry";
import { denominationsFor, minorToMajor } from "../../closing/denominations";
import { armTender } from "../../invoice/armedTender";
import { resolveTenderChips } from "../../invoice/tenderChips";
import { chordLabelFor } from "../../../../composables/pos/items/useShortcutChordLabel";

const props = defineProps({
	/** The invoice's payment rows — the same array `PaymentMethods` renders. */
	payments: { type: Array, default: () => [] },
	currency: { type: String, default: "" },
	isReturn: { type: Boolean, default: false },
	/** Whether the register still offers gift cards, for the chip exclusion. */
	usesGiftCards: { type: Boolean, default: false },
	cartHasItems: { type: Boolean, default: true },
	/** `Payments.vue`'s own formatter, so precision follows the tenant. */
	formatCurrency: { type: Function, required: true },
	/** `usePaymentMethods.getVisibleDenominations` — the preset source. */
	getVisibleDenominations: { type: Function, required: true },
	isCashLikePayment: { type: Function, required: true },
	/** `diff_payment`: positive is still owed, negative is change. */
	diffPayment: { type: Number, default: 0 },
});

const emit = defineEmits(["update-amount", "set-full-amount", "set-denomination"]);

const __ = (value) =>
	typeof window !== "undefined" && window.__ ? window.__(value) : value;

/** Rows the chips and the applied list are drawn from. */
const rows = computed(() => (Array.isArray(props.payments) ? props.payments.filter(Boolean) : []));

const chips = computed(() =>
	resolveTenderChips({
		payments: rows.value,
		posa_use_gift_cards: props.usesGiftCards ? 1 : 0,
	}),
);

/** The row money is on, or the register's default when nothing is on yet. */
const targetPayment = computed(() => {
	const carrying = rows.value.find((row) => Number(row.amount) !== 0);
	if (carrying) return carrying;
	return rows.value.find((row) => Number(row.default) === 1) ?? rows.value[0] ?? null;
});

const activeMode = computed(() => targetPayment.value?.mode_of_payment ?? null);
const receivedAmount = computed(() => Number(targetPayment.value?.amount) || 0);

const receivedLabel = computed(() => {
	const payment = targetPayment.value;
	// `Recibido en efectivo` is the artboard's wording BECAUSE its shop is
	// taking cash. On a card sale the same words would be wrong, so the label
	// asks the register which kind of tender this row is.
	return payment && props.isCashLikePayment(payment)
		? __("Received in cash")
		: __("Amount received");
});

const presets = computed(() => {
	const payment = targetPayment.value;
	if (!payment) return [];
	const suggestions = props.getVisibleDenominations(payment);
	return Array.isArray(suggestions) ? suggestions : [];
});

const appliedRows = computed(() => rows.value.filter((row) => Number(row.amount) !== 0));
const outstanding = computed(() => Number(props.diffPayment) || 0);

const submitChord = chordLabelFor("payment.submit");
const chargesHint = __("charges");

// ── The pad ─────────────────────────────────────────────────────────────
const entry = ref(EMPTY_ENTRY);
const minorPerMajor = computed(() => denominationsFor(props.currency).minorPerMajor);
const keyedMinor = computed(() => entryMinor(entry.value, minorPerMajor.value));
const keyedLabel = computed(() =>
	props.formatCurrency(minorToMajor(keyedMinor.value, minorPerMajor.value), props.currency),
);
const canApply = computed(() => Boolean(targetPayment.value) && keyedMinor.value > 0);

const onApply = () => {
	if (!canApply.value) return;
	// `setFormatedCurrency` takes either a change event or a bare value; a
	// number goes straight through `flt` at the register's own precision, so
	// the keyed amount is committed the same way a typed one is.
	emit("update-amount", targetPayment.value, minorToMajor(keyedMinor.value, minorPerMajor.value));
	entry.value = EMPTY_ENTRY;
};

const onExact = () => {
	if (!targetPayment.value) return;
	emit("set-full-amount", targetPayment.value, props.isReturn);
	entry.value = EMPTY_ENTRY;
};

const pickTender = (mode) => {
	const payment = rows.value.find((row) => row.mode_of_payment === mode);
	if (!payment) return;
	// Same act as pressing the method's own button on the old card, which is
	// `set-full-amount` — the register's word for "this is the tender".
	emit("set-full-amount", payment, props.isReturn);
	entry.value = EMPTY_ENTRY;
	// Kept in step so the sale screen's strip does not disagree with this one
	// after `Volver a la venta`. Nothing here is DRAWN from it.
	armTender(mode, chips.value, {
		cartHasItems: props.cartHasItems,
		isReturn: props.isReturn,
	});
};
</script>

<style scoped>
.cobro-pad {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	min-height: 0;
}

.cobro-pad__card {
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	padding: var(--reg-space-lg, 14px);
}

.cobro-pad__label {
	margin: 0 0 var(--reg-space-md, 10px);
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cobro-pad__tenders {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-sm, 6px);
}

.cobro-pad__tender {
	min-height: var(--reg-touch-min, 44px);
	padding: 0 var(--reg-space-lg, 14px);
	border-radius: 999px;
	border: 1px solid var(--reg-border, rgba(0, 0, 0, 0.12));
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font-size: 13.5px;
	font-weight: 600;
	cursor: pointer;
}

/* The PALE derivative, which the canvas spends freely on chips — the one
   saturated colour on this screen is COBRAR Y CERRAR, and it is on the band. */
.cobro-pad__tender--on {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.cobro-pad__received-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
}

.cobro-pad__hint {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
}

.cobro-pad__kbd {
	border-radius: var(--reg-radius-xs, 6px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface-muted, #f2f4f7);
	padding: 1px 5px;
	font-size: 11px;
	font-family: inherit;
}

.cobro-pad__amount {
	display: block;
	text-align: right;
	font-size: 34px;
	font-weight: 700;
	line-height: 1.1;
	letter-spacing: -0.02em;
	color: var(--reg-text-primary, #212121);
}

.cobro-pad__presets {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-sm, 6px);
	margin-top: var(--reg-space-md, 10px);
}

.cobro-pad__preset {
	min-height: 38px;
	padding: 0 var(--reg-space-md, 10px);
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface-sunken, #f8f9fa);
	color: var(--reg-text-primary, #212121);
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.cobro-pad__preset:disabled {
	opacity: 0.5;
	cursor: default;
}

.cobro-pad__preset--exact {
	font-weight: 700;
}

.cobro-pad__keys {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	flex: 1 1 auto;
	min-height: 0;
}

.cobro-pad__apply {
	min-height: var(--reg-touch-min, 44px);
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-size: 14px;
	font-weight: 700;
	cursor: pointer;
}

.cobro-pad__apply:disabled {
	border-color: var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: default;
}

.cobro-pad__applied {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xs, 5px);
}

.cobro-pad__applied-row,
.cobro-pad__outstanding {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	margin: 0;
	font-size: 13.5px;
	color: var(--reg-text-primary, #212121);
}

.cobro-pad__outstanding {
	margin-top: var(--reg-space-md, 10px);
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px solid var(--reg-divider, #eceff3);
	font-weight: 700;
}

/* Amber is STATE, and only ever a caption here — never a fill on an action. */
.cobro-pad__outstanding[data-covered="false"] .cobro-pad__applied-amount {
	color: var(--reg-tone-warning-number, #8a5a0d);
}

.cobro-pad__applied-mode {
	color: var(--reg-text-secondary, #56606e);
}

.cobro-pad__empty {
	margin: 0;
	font-size: 13px;
	color: var(--reg-text-muted, #667085);
}
</style>
