<template>
	<section v-if="enabled" class="cobro-gift" data-testid="cobro-gift-card">
		<!--
			THE MONEDERO SLOT, column one (build plan §14.2, artboard node
			`Monedero del cliente`).
			────────────────────────────────────────────────────────────────────
			This was a 420×333 block in column TWO, under the method rows: a
			gradient card with a «Scan-First Flow» pill, an `h4`, a paragraph of
			instructions and a pair of `v-text-field`s that only appeared after
			a button. On the owner's iPad it began at y=395 in a column whose
			surface ended at y=597, which is where «a long ass scroll» came from
			(08-30).

			A gift card is a fact about the MONEY'S WHY — whose balance is
			paying for this ticket — so it belongs beside the wallet and the
			totals, and it is a CAPTURE, not a pitch. What is drawn is the code
			field, the balance once it is known, and what has been applied.
			Nothing is drawn about what a gift card is.

			SCAN FIRST, and the field says so by refusing to summon a keyboard:
			`inputmode="none"` on a touch register keeps the OS keyboard shut
			while a wedge scanner types straight into it (a wedge is a keyboard;
			it does not need the on-screen one) and while the register's own pad
			in column two feeds it digits. `Teclado` is the way out for a code
			with letters in it. There is no autofocus at all on a touch
			register — the same rule `pointer.ts` states for every search field
			on this product.
		-->
		<h3 class="cobro-gift__label">{{ __("Gift Card") }}</h3>

		<div class="cobro-gift__row">
			<span class="cobro-gift__glyph" aria-hidden="true">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
				>
					<path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v11M17 5v14M20.5 5v14" />
				</svg>
			</span>
			<input
				ref="field"
				class="cobro-gift__input reg-mono"
				type="text"
				data-testid="cobro-gift-code"
				:value="cardCode"
				:inputmode="coarse && !typing ? 'none' : 'text'"
				:placeholder="__('Gift Card Code')"
				:aria-label="__('Gift Card Code')"
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				enterkeyhint="search"
				@input="$emit('update:cardCode', $event.target.value)"
				@focus="$emit('activate')"
				@keydown.enter.prevent="$emit('check-balance')"
				@keydown.esc="$emit('deactivate')"
			/>
			<!--
				NOT `@blur`. Tapping a key on the centre pad moves focus to that
				BUTTON, which would blur this field — and a capture that stopped
				receiving the pad's digits the instant the cashier used the pad
				would never receive any. So the claim on the keys is LATCHED one
				level up and released by an act that means something else: a
				tender chip, an apply, a clear, or Escape.
			-->
			<!-- The way out of scan-first, and the reason it is a TOGGLE rather
			     than a mode the register guesses: a code printed with letters
			     has to be typed, and a cashier who cannot get a keyboard up is
			     stuck with a card they can see in their hand. -->
			<button
				v-if="coarse"
				type="button"
				class="cobro-gift__toggle"
				data-testid="cobro-gift-keyboard"
				:aria-pressed="typing"
				@click="toggleTyping"
			>
				{{ __("Keyboard") }}
			</button>
			<button
				type="button"
				class="cobro-gift__toggle cobro-gift__toggle--go"
				data-testid="cobro-gift-check"
				:disabled="loading || !cardCode"
				@click="$emit('check-balance')"
			>
				{{ __("Check Balance") }}
			</button>
		</div>

		<!--
			FACTS ONLY, and only the ones the register actually holds. The
			balance is what `check_gift_card_balance` returned; the applied
			amount is what is sitting in `giftCardRedemptions`. A card nobody
			has looked up yet states neither, and says nothing in their place.
		-->
		<p v-if="appliedAmount > 0" class="cobro-gift__fact" data-testid="cobro-gift-applied">
			<span class="cobro-gift__fact-label">{{ __("Applied") }}</span>
			<span class="cobro-gift__fact-value reg-mono" data-money-role="gift-applied">{{
				formatCurrency(appliedAmount)
			}}</span>
			<button type="button" class="cobro-gift__clear" data-testid="cobro-gift-clear" @click="$emit('clear')">
				{{ __("Clear") }}
			</button>
		</p>
		<p v-else-if="balance > 0" class="cobro-gift__fact" data-testid="cobro-gift-balance">
			<span class="cobro-gift__fact-label">{{ __("Balance") }}</span>
			<span class="cobro-gift__fact-value reg-mono" data-money-role="gift-balance">{{
				formatCurrency(balance)
			}}</span>
			<button
				type="button"
				class="cobro-gift__clear cobro-gift__clear--apply"
				data-testid="cobro-gift-apply"
				:disabled="loading"
				@click="$emit('apply')"
			>
				{{ __("Apply") }}
			</button>
		</p>

		<p v-if="errorMessage" class="cobro-gift__error" data-testid="cobro-gift-error">
			{{ errorMessage }}
		</p>
	</section>
</template>

<script setup>
/**
 * The gift-card capture, column one of the desktop Cobro (build plan §14.2).
 *
 * ⚠ MONEY PATH: THIS FILE IS CHROME. It holds no balance, redeems nothing and
 * never writes a payment row. Every act leaves through an event
 * `Payments.vue` already answers — `checkGiftCardBalance`,
 * `applyGiftCardRedemption`, `clearGiftCardRedemption` — which are the same
 * three functions `GiftCardDialog` and the phone sheet call. The dialog stays
 * mounted as the desk fallback; it is simply no longer what the hosted surface
 * opens.
 */
import { computed, ref } from "vue";

import { coarsePointer } from "../../../../utils/pointer";

defineProps({
	/** `pos_profile.posa_use_gift_cards`. Off renders nothing at all. */
	enabled: { type: Boolean, default: false },
	cardCode: { type: String, default: "" },
	/** What `check_gift_card_balance` last returned. */
	balance: { type: Number, default: 0 },
	/** What is already sitting in `giftCardRedemptions`. */
	appliedAmount: { type: Number, default: 0 },
	loading: { type: Boolean, default: false },
	errorMessage: { type: String, default: "" },
	formatCurrency: { type: Function, required: true },
});

defineEmits(["update:cardCode", "check-balance", "apply", "clear", "activate", "deactivate"]);

const __ = (value) => (typeof window !== "undefined" && window.__ ? window.__(value) : value);

const field = ref(null);

/**
 * Touch registers get scan-first; a desk with a real keyboard gets a plain
 * text field, because there is no on-screen keyboard to keep shut and
 * `inputmode="none"` on a desk would only confuse a screen reader.
 *
 * Read once at setup rather than watched: a register does not change its
 * pointer class mid-sale, and a live media listener here would be a watcher on
 * the payment-open path §6 budgets at 150 ms.
 */
const coarse = computed(() => coarsePointer());

/** Has the cashier asked for the OS keyboard? Off is the default, always. */
const typing = ref(false);

const toggleTyping = () => {
	typing.value = !typing.value;
	// Re-focusing is what actually raises the keyboard: `inputmode` is read
	// when the field takes focus, so flipping it under a focused field does
	// nothing until the field is focused again.
	const el = field.value;
	el?.blur?.();
	if (typing.value) el?.focus?.();
};

/**
 * ⚠ NO `onMounted` FOCUS, deliberately, and this is the whole of it: a wedge
 * scanner types into whatever has focus, so a scan-first field WANTS focus —
 * and on a tablet taking it summons the OS keyboard over the numpad the
 * cashier is about to use, which is exactly what the owner reported on 08-30.
 * The cashier taps the field (one tap, no keyboard, because `inputmode` is
 * `none`) and the scanner or the centre pad fills it.
 */
defineExpose({ focus: () => field.value?.focus?.() });
</script>

<style scoped>
.cobro-gift {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-sm, 6px);
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	padding: var(--reg-space-md, 10px);
}

.cobro-gift__label {
	margin: 0;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cobro-gift__row {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	min-width: 0;
	height: var(--reg-touch-min, 44px);
	padding: 0 var(--reg-space-sm, 8px);
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface-sunken, #f8f9fa);
}

.cobro-gift__row:focus-within {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
}

.cobro-gift__glyph {
	display: inline-flex;
	flex: none;
	color: var(--reg-text-muted, #667085);
}

.cobro-gift__glyph svg {
	width: 18px;
	height: 18px;
}

.cobro-gift__input {
	flex: 1 1 auto;
	min-width: 0;
	border: 0;
	background: transparent;
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13.5px;
	font-weight: 700;
	letter-spacing: 0.04em;
	outline: none;
}

.cobro-gift__toggle {
	flex: none;
	height: 30px;
	padding: 0 var(--reg-space-sm, 8px);
	border-radius: var(--reg-radius-xs, 6px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 11.5px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

.cobro-gift__toggle[aria-pressed="true"] {
	border-color: var(--reg-accent-edge, #9fdde6);
	color: var(--reg-on-accent-soft, #00646f);
}

.cobro-gift__toggle:disabled {
	opacity: 0.5;
	cursor: default;
}

.cobro-gift__fact {
	display: flex;
	align-items: baseline;
	gap: var(--reg-space-sm, 6px);
	margin: 0;
	font-size: 11.5px;
	color: var(--reg-text-secondary, #56606e);
}

.cobro-gift__fact-value {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cobro-gift__clear {
	margin-inline-start: auto;
	border: 0;
	background: transparent;
	color: var(--reg-text-muted, #667085);
	font: inherit;
	font-size: 11.5px;
	font-weight: 700;
	text-decoration: underline;
	cursor: pointer;
}

.cobro-gift__clear--apply {
	color: var(--reg-on-accent-soft, #00646f);
}

.cobro-gift__error {
	margin: 0;
	font-size: 11.5px;
	font-weight: 600;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

/*
 * THE DENSE DESK TIER — Marco's iPad-class window (1195×741, 1143×656).
 * The same query the rest of the register switches on; `denseDeskTier.spec.ts`
 * holds this file in lockstep with it.
 */
@media (min-width: 1100px) and (max-height: 820px) {
	.cobro-gift {
		gap: var(--reg-space-xs, 5px);
		padding: var(--reg-space-sm, 8px);
		border-radius: var(--reg-radius-sm, 10px);
	}

	.cobro-gift__label {
		font-size: 10px;
	}
}
</style>
