<template>
	<section class="cobro-pad" data-testid="cobro-tender-pad">
		<!--
			ONE card for the whole act of entering an amount: label, pad,
			shortcuts, commit. It was three stacked cards — a tender-chip card, a
			received card and a keys card — and between them they pushed the pad's
			own «4 5 6» row past the fold on a 1280×800 counter (owner screenshot,
			2026-08-23). The chips moved to the method rows below, which is where
			an amount actually lands, and the received figure moved to the paper
			column, which is the one place this surface states it.
		-->
		<!--
			The amount field: its LABEL and its figure on one row, the way a
			field is drawn, rather than a caption row above a display row. Those
			two rows cost this column twenty-one points, and at 1280×800 that is
			the difference between a 45px key and a 27px one (measured).

			`Monto`, not the artboard's `Recibido en efectivo`. What this field
			holds is what the cashier is KEYING — it reads 0.00 until they press
			a digit and returns to 0.00 once `Aplicar` has committed it. The
			artboard's wording belongs to a field that STATES the tender, and
			that statement is now the method row below and the paper column's
			`Recibido`.
		-->
		<div class="cobro-pad__field">
			<span class="cobro-pad__label">{{ __("Amount") }}</span>
			<output
				class="cobro-pad__amount reg-mono"
				data-testid="cobro-keyed-amount"
				data-money-role="keyed"
				aria-live="polite"
				>{{ keyedLabel }}</output
			>
		</div>

		<!--
			The pad is the phone's, reused whole, and it is the ELASTIC element of
			this column: the stylesheet below hands it the slack so the keys grow
			on a tall screen and shrink on a short one instead of the column
			acquiring a scrollbar.

			`Aplicar` IS the pad's fourth-column key — `Cobro.dc.html` draws it in
			exactly the cell `KEYPAD_LAYOUT` reserves for the pad's action, which
			on the phone is `Dividir pago`. So the label is passed and the layout
			is left alone: one grid of fourteen keys, not a fork of the
			most-tapped surface in the product. It is the `split` emit because
			that is what the slot has always emitted; no split flow exists on this
			screen to compete for it (R8 — `usePaymentMethods` has none).

			A separate Apply button below would have cost this column 52px of
			fixed height and left a dead disabled key beside it — which at
			1280×800 is the difference between a usable pad and a clipped one.
		-->
		<PayKeypad
			class="cobro-pad__pad"
			:entry="entry"
			:minor-per-major="minorPerMajor"
			:display-label="keyedLabel"
			:action-label="applyLabel"
			:show-display="false"
			:split-enabled="canApply"
			@update:entry="entry = $event"
			@split="onApply"
		/>

		<div class="cobro-pad__presets" data-testid="cobro-presets">
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
			<!--
				The chord shares the shortcuts' row rather than taking one of its
				own. It is RESOLVED, never the artboard's: `Cobro.dc.html` prints
				`Enter cobra · F6 divide el pago`; the register binds
				`payment.submit` to alt+x and binds no split at all, so this
				renders what the keymap says and the F6 half is simply not drawn
				(R8 — the split flow does not exist in `usePaymentMethods`).
			-->
			<span v-if="submitChord" class="cobro-pad__hint" data-testid="cobro-submit-chord">
				<kbd class="cobro-pad__kbd">{{ submitChord }}</kbd>
				{{ chargesHint }}
			</span>
		</div>
	</section>
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
 * else on that screen carries the number. Here the band is one row below, and a
 * card previewing an amount the band had not adopted would be the two-numbers
 * defect §11 spent a wave removing. `Exacto` and the preset chips commit at
 * once — they are already a commitment — and from either the method rows, the
 * paper column and the band read one figure.
 *
 * The row it works on is `resolveTenderTarget`'s, shared with `CobroMethodRows`
 * so the lit method and the row the pad writes into cannot come apart.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import PayKeypad from "../../mobile/pay/PayKeypad.vue";
import { applyKeypadKey, EMPTY_ENTRY, entryMinor } from "../../mobile/pay/keypadEntry";
import { denominationsFor, minorToMajor } from "../../closing/denominations";
import { chordLabelFor } from "../../../../composables/pos/items/useShortcutChordLabel";
import { resolveTenderTarget } from "./tenderTarget";

const props = defineProps({
	/** The invoice's payment rows — the same array `PaymentMethods` renders. */
	payments: { type: Array, default: () => [] },
	currency: { type: String, default: "" },
	isReturn: { type: Boolean, default: false },
	/** `Payments.vue`'s own formatter, so precision follows the tenant. */
	formatCurrency: { type: Function, required: true },
	/** `usePaymentMethods.getVisibleDenominations` — the preset source. */
	getVisibleDenominations: { type: Function, required: true },
});

const emit = defineEmits(["update-amount", "set-full-amount", "set-denomination"]);

const __ = (value) => (typeof window !== "undefined" && window.__ ? window.__(value) : value);

/** Rows the presets and the commit are aimed at. */
const rows = computed(() => (Array.isArray(props.payments) ? props.payments.filter(Boolean) : []));

/** The row money is on, or the register's default when nothing is on yet. */
const targetPayment = computed(() => resolveTenderTarget(rows.value));

const presets = computed(() => {
	const payment = targetPayment.value;
	if (!payment) return [];
	const suggestions = props.getVisibleDenominations(payment);
	return Array.isArray(suggestions) ? suggestions : [];
});

const submitChord = chordLabelFor("payment.submit");
const chargesHint = __("charges");
const applyLabel = __("Apply");

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

// ── The physical keyboard IS the pad ────────────────────────────────────
// A cashier at a desktop register reaches for the number row, not the
// mouse (reported 08-24: "the number pad doesn't work with the keyboard").
// The keys feed the SAME buffer through the SAME `applyKeypadKey` the
// on-screen pad uses, so a typed amount and a tapped one cannot diverge.
// Guarded, not greedy: a keystroke aimed at a real field — the method
// rows' own amount inputs, a search box, a dialog — is never intercepted,
// and modifier chords stay with the shortcut system that owns them.
const isTypingTarget = (el) => {
	if (!el) return false;
	const tag = String(el.tagName || "").toUpperCase();
	return (
		tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true
	);
};

const onPhysicalKey = (event) => {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	if (isTypingTarget(event.target)) return;
	const key = event.key;
	if (key.length === 1 && key >= "0" && key <= "9") {
		entry.value = applyKeypadKey(entry.value, key, minorPerMajor.value);
		event.preventDefault();
	} else if (key === "." || key === ",") {
		entry.value = applyKeypadKey(entry.value, ".", minorPerMajor.value);
		event.preventDefault();
	} else if (key === "Backspace") {
		entry.value = applyKeypadKey(entry.value, "backspace", minorPerMajor.value);
		event.preventDefault();
	} else if (key === "Enter" && canApply.value) {
		// Enter commits the keyed amount exactly as `Aplicar` does. With an
		// empty buffer it is left alone — the register's own submit chord and
		// whatever else listens for Enter keep their meaning.
		onApply();
		event.preventDefault();
	}
};

onMounted(() => window.addEventListener("keydown", onPhysicalKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onPhysicalKey));
</script>

<style scoped>
.cobro-pad {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 8px);
	/* The card takes what is left of its column after the `Al cerrar` caption
	   below it, and refuses to grow past that. `flex`, never `height: 100%` —
	   a percentage height resolves against the SECTION and ignores the caption
	   beside it, which is a card exactly one caption taller than its cell.
	   `min-height: 0` is the other half: without it the pad inside claims its
	   content height and the column overflows the box it is clipped to. */
	flex: 1 1 auto;
	min-height: 0;
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	/* 10px, not the 14px the other cards use: this is the one card whose
	   padding is spent on the pad, and at 1280×800 the four points of it are
	   four points of key height. */
	padding: var(--reg-space-md, 10px);
}

/* The field: label left, figure right, ONE row. The pale accent edge is the
   artboard's own treatment of this box — a wash the canvas spends freely, not
   the saturated accent, which on this screen belongs to COBRAR Y CERRAR. */
.cobro-pad__field {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	flex: none;
	min-height: 44px;
	padding: 0 var(--reg-space-md, 10px);
	border-radius: 11px;
	border: 2px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
}

.cobro-pad__label {
	margin: 0;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-on-accent-soft, #00646f);
}

.cobro-pad__amount {
	min-width: 0;
	font-size: 24px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-on-accent-soft, #00646f);
}

.cobro-pad__hint {
	margin-inline-start: auto;
	align-self: center;
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

/* THE ELASTIC ELEMENT of the whole surface.
   Every other region on this screen is sized by its content; something has to
   absorb the difference between a 1280×800 counter and a 1920×1080 one, and a
   numeric pad is the one control that reads correctly at any key height. So
   the pad takes the slack and NOTHING here scrolls. */
.cobro-pad__pad {
	flex: 1 1 auto;
	min-height: 0;
}

:deep(.cobro-pad__pad) {
	gap: var(--reg-space-sm, 8px);
}

:deep(.cobro-pad__pad .pay-keypad__grid) {
	flex: 1 1 auto;
	min-height: 0;
	gap: 6px;
	/*
	 * NO FLOOR — `minmax(0, 1fr)`, deliberately.
	 *
	 * A floor here would be a promise the column cannot keep: a register with
	 * four tenders on a 1280×800 screen has less room than one with two, and
	 * the moment the floor exceeds what is left the grid overflows a box that
	 * is `overflow: hidden` and the bottom row of keys DISAPPEARS. Sharing
	 * whatever is there means the keys get smaller on the worst screen and the
	 * pad is always whole, which is the property the panel is judged on.
	 *
	 * Measured: at 1280×800 with two tenders the share resolves near 49px, and
	 * with three near 37px. Below ~740px the stylesheet in `Payments.vue` gives
	 * the surface an honest scrollbar instead of letting them shrink further.
	 */
	grid-auto-rows: minmax(0, 1fr);
}

:deep(.cobro-pad__pad .pay-keypad__key) {
	min-height: 0;
	height: 100%;
}

.cobro-pad__presets {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-xs, 5px);
}

.cobro-pad__preset {
	min-height: 32px;
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
</style>
