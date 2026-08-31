<template>
	<section class="cobro-methods" data-testid="cobro-methods">
		<!--
			THE TENDER CHIPS, ONE ROW (build plan §14.2, round 4).
			────────────────────────────────────────────────────────────────────
			`Cobro.dc.html` draws `Forma de pago` as a ROW — `Efectivo ·
			Tarjeta · Transferencia · Monedero · Vale` — above the amount the
			cashier is about to key. This component drew it as a stacked LIST
			instead: three 44px lines plus a card and a heading, ~190px of the
			one column that also has to hold the numpad. On the owner's iPad
			(1195×741, 08-30) that list plus the gift-card block under it ran
			past the bottom of the surface, which is where «a long ass scroll»
			came from.

			So the list becomes the artboard's row. Nothing else changes: the
			NAME is still the button and still emits `set-full-amount` — the
			register's word for "this is the tender" — and the lit chip is still
			`resolveTenderTarget`'s, the row the pad commits into.

			THE AMOUNT INPUT IS GONE, and that is the second half of the owner's
			report: «it opened the keyboard, which breaks the numberpad we have
			on the center for touch screens». `focusFirstPaymentTarget` focuses
			the first `payment-amount` OR `payment-action` inside the payment
			root when Cobro opens — with an `<input>` here that was a text field
			on a tablet, and the OS keyboard came up over the pad the register
			had just drawn. A chip is a `payment-action`: focusing it moves the
			ring, not the keyboard. The amount is keyed on the pad, which is the
			control this surface exists to give the cashier.

			The card is still what the dialog and the phone sheet render; this
			component is `cobroMode` only, and it emits nothing new.
		-->
		<ul class="cobro-methods__list">
			<li class="cobro-methods__eyebrow" aria-hidden="true">{{ __("Payment method") }}</li>
			<li
				v-for="payment in rows"
				:key="payment.name || payment.mode_of_payment"
				class="cobro-methods__row"
				:class="{ 'cobro-methods__row--on': payment === target }"
				:data-testid="`cobro-method-${payment.mode_of_payment}`"
			>
				<button
					type="button"
					class="cobro-methods__pick"
					data-pos-keyboard-target="payment-action"
					:title="payment.mode_of_payment"
					:data-testid="`cobro-tender-${payment.mode_of_payment}`"
					:data-armed="payment === target ? 'true' : 'false'"
					:aria-pressed="payment === target"
					@click="pick(payment)"
				>
					<svg
						class="cobro-methods__icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path v-for="d in iconPaths(payment)" :key="d" :d="d" />
					</svg>
					<span class="cobro-methods__name">{{ payment.mode_of_payment }}</span>
					<!--
						The amount RIDES THE CHIP once there is one. It is not a
						second statement of the sale: it is what sits on this
						tender, which is exactly what the row's input used to
						show, and a chip carrying `$1,200.00` is how the cashier
						sees a split without a second list under the pad. Zero is
						not drawn — an untouched tender has nothing to say.
					-->
					<span
						v-if="amountOf(payment)"
						class="cobro-methods__amount reg-mono"
						:data-testid="`cobro-amount-${payment.mode_of_payment}`"
						>{{ amountOf(payment) }}</span
					>
				</button>
			</li>

			<!--
				THE GIFT CARD IS A TENDER, not a marketing block.

				`visiblePaymentMethods` filters gift rows out (they are redeemed
				by code, not typed as an amount), so the chip is drawn from the
				register's own flag and hands the act to column one's capture —
				where the artboard puts `Monedero del cliente`. What used to be
				here was a 420×333 card with a gradient, a «Scan-First Flow»
				pill and a paragraph of instructions, under three method rows,
				in the column that also has to hold the pad.
			-->
			<li
				v-if="usesGiftCards"
				class="cobro-methods__row"
				:class="{ 'cobro-methods__row--on': giftAppliedAmount > 0 }"
				data-testid="cobro-method-gift-card"
			>
				<button
					type="button"
					class="cobro-methods__pick"
					data-pos-keyboard-target="payment-action"
					data-testid="cobro-tender-gift-card"
					:data-armed="giftAppliedAmount > 0 ? 'true' : 'false'"
					:aria-pressed="giftAppliedAmount > 0"
					@click="$emit('open-gift-card', null)"
				>
					<svg
						class="cobro-methods__icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path v-for="d in ICONS.voucher" :key="d" :d="d" />
					</svg>
					<span class="cobro-methods__name">{{ __("Gift Card") }}</span>
					<span v-if="giftAppliedAmount > 0" class="cobro-methods__amount reg-mono">{{
						formatCurrency(giftAppliedAmount)
					}}</span>
				</button>
			</li>

			<!-- The two tenders that need an act beyond an amount. Both keep
			     the card's own wording and the card's own event, and both are
			     drawn only for the tender that is actually armed — a row of
			     five chips with a «Get Payments» beside each is the card list
			     again, in a line. -->
			<li v-if="target && isMpesaC2bPayment(target)" class="cobro-methods__extra">
				<button
					type="button"
					class="cobro-methods__action"
					:data-testid="`cobro-mpesa-${target.mode_of_payment}`"
					@click="$emit('mpesa-dialog', target)"
				>
					{{ __("Get Payments") }}
				</button>
			</li>
			<li
				v-else-if="target && target.type === 'Phone' && Number(target.amount) > 0 && requestPaymentField"
				class="cobro-methods__extra"
			>
				<button
					type="button"
					class="cobro-methods__action"
					:data-testid="`cobro-request-${target.mode_of_payment}`"
					@click="$emit('request-payment', target)"
				>
					{{ __("Request Payment") }}
				</button>
			</li>
		</ul>
	</section>
</template>

<script setup>
/**
 * The configured tenders, one chip row (build plan §14.2, round 4).
 *
 * ⚠ MONEY PATH: THIS FILE IS CHROME. Like `CobroTenderPad` it writes nothing
 * itself — every event it raises is one `PaymentMethods` already raises, so
 * `v-on="paymentMethodsHandlers"` wires it with no new handler on the register.
 *
 * The lit chip is `resolveTenderTarget`'s, the same module the pad commits
 * into, so "the method that is highlighted" and "the row the pad writes to"
 * are one answer rather than two rules that agree today.
 */
import { computed } from "vue";

import { armTender } from "../../invoice/armedTender";
import { resolveTenderChips } from "../../invoice/tenderChips";
import { resolveTenderTarget } from "./tenderTarget";

const props = defineProps({
	/** The invoice's payment rows — the same array `PaymentMethods` renders. */
	payments: { type: Array, default: () => [] },
	currency: { type: String, default: "" },
	isReturn: { type: Boolean, default: false },
	/** `request_payment_field` — whether the phone tender may ask for money. */
	requestPaymentField: { type: Boolean, default: false },
	/** Whether the register still offers gift cards, for `armTender`'s chips
	 *  and for the chip that hands the act to column one's capture. */
	usesGiftCards: { type: Boolean, default: false },
	/** What a redeemed gift card has already covered, so its chip can say so. */
	giftAppliedAmount: { type: Number, default: 0 },
	cartHasItems: { type: Boolean, default: true },
	currencySymbol: { type: Function, required: true },
	formatCurrency: { type: Function, required: true },
	isNumber: { type: Function, required: true },
	isCashLikePayment: { type: Function, required: true },
	isMpesaC2bPayment: { type: Function, required: true },
	isGiftCardPayment: { type: Function, default: () => false },
});

/**
 * ⚠ THIS LIST IS PINNED to `PaymentMethods`'s own `defineEmits`
 * (`cobroControlPanel.spec.ts`): a new event here would be a new seam on the
 * money path. `update-amount` and `set-rest-amount` are declared and no longer
 * raised — the amount input they belonged to is what summoned the tablet
 * keyboard — and they stay declared so the two components cannot drift apart
 * on the day a card grows a third way to set an amount.
 */
const emit = defineEmits([
	"update-amount",
	"set-full-amount",
	"set-denomination",
	"mpesa-dialog",
	"request-payment",
	"set-rest-amount",
	"open-gift-card",
]);

const __ = (value) => (typeof window !== "undefined" && window.__ ? window.__(value) : value);

const rows = computed(() => (Array.isArray(props.payments) ? props.payments.filter(Boolean) : []));
const target = computed(() => resolveTenderTarget(rows.value));

/** Formatted, or "" for a tender nothing sits on — a zero is not a fact. */
const amountOf = (payment) => {
	const amount = Number(payment?.amount);
	if (!Number.isFinite(amount) || amount === 0) return "";
	return props.formatCurrency(amount);
};

/**
 * The artboard's five tender glyphs, as path data rather than an icon font:
 * this component is mounted bare in its spec, and a `v-icon` would drag
 * Vuetify's registration into a file that draws five shapes.
 */
const ICONS = {
	cash: ["M2 6h20v12H2z", "M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2"],
	card: ["M2 5.5h20v13H2z", "M2 10h20"],
	phone: ["M8 2.5h8v19H8z", "M11 18.5h2"],
	voucher: ["M4 6h16v12H4z", "M8 10h8M8 14h5"],
	transfer: ["M4 8h16M4 8l4-4", "M20 16H4m16 0-4 4"],
};

const iconPaths = (payment) => {
	if (props.isGiftCardPayment(payment)) return ICONS.voucher;
	if (props.isCashLikePayment(payment)) return ICONS.cash;
	if (payment?.type === "Phone") return ICONS.phone;
	if (payment?.type === "Bank") return ICONS.card;
	return ICONS.transfer;
};

/**
 * Picking a method is `set-full-amount` — the same act the card's big button
 * performed, and the register's word for "this is the tender". A gift card
 * hands the act to column one's capture instead, because the amount there
 * comes from a balance check rather than from the sale.
 */
const pick = (payment) => {
	if (props.isGiftCardPayment(payment)) {
		emit("open-gift-card", payment);
		return;
	}
	emit("set-full-amount", payment, props.isReturn);
	// Kept in step so the sale screen's chip strip does not disagree with this
	// row after `Volver a la venta`. Nothing here is DRAWN from it.
	armTender(
		payment.mode_of_payment,
		resolveTenderChips({
			payments: rows.value,
			posa_use_gift_cards: props.usesGiftCards ? 1 : 0,
		}),
		{ cartHasItems: props.cartHasItems, isReturn: props.isReturn },
	);
};
</script>

<style scoped>
/*
 * NO CARD. The chips ARE the chrome — a bordered box with an uppercase heading
 * around a single row is the card-in-a-card density the panel exists to
 * remove, and on a 741px screen it is 34 points the numpad wanted.
 */
.cobro-methods {
	min-width: 0;
}

/* ONE ROW, wrapping only when the register genuinely has more tenders than
   fit. `Cobro.dc.html`'s `Forma de pago` line, with its label riding the row
   as the first item rather than sitting on a line of its own. */
.cobro-methods__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
}

.cobro-methods__eyebrow {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

/* ONE LINE, and a FIXED height so a method cannot grow the row by carrying a
   longer name. 44px is §5's touch minimum and this is a tablet's most-tapped
   row after the pad itself. */
.cobro-methods__row {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	height: var(--reg-touch-min, 44px);
	min-width: 0;
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
}

/* The armed chip, in the accent's PALE derivative — the one saturated colour
   on this screen is COBRAR Y CERRAR, and it is on the band. */
.cobro-methods__row--on {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
}

.cobro-methods__pick {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	min-width: 0;
	height: 100%;
	padding: 0 var(--reg-space-md, 10px);
	border: 0;
	border-radius: inherit;
	background: transparent;
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 13.5px;
	font-weight: 600;
	text-align: start;
	cursor: pointer;
}

.cobro-methods__row--on .cobro-methods__pick {
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.cobro-methods__icon {
	width: 18px;
	height: 18px;
	flex: none;
}

.cobro-methods__name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* The amount on this tender. Tabular and a shade heavier than the name, so a
   split reads as two chips with two figures rather than as two labels. */
.cobro-methods__amount {
	flex: none;
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	white-space: nowrap;
}

.cobro-methods__row--on .cobro-methods__amount {
	color: var(--reg-on-accent-soft, #00646f);
}

.cobro-methods__extra {
	display: flex;
	align-items: center;
}

.cobro-methods__action {
	flex: none;
	height: 32px;
	padding: 0 var(--reg-space-md, 10px);
	border-radius: var(--reg-radius-xs, 6px);
	border: 1px solid var(--reg-border, rgba(0, 0, 0, 0.12));
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}

/*
 * ON A SHORT SCREEN THE CHIPS TIGHTEN.
 *
 * A HEIGHT query, and it has to be one: width is what decides whether five
 * names fit on a line, but HEIGHT is what is scarce here — the row shares its
 * column with the numpad, and every point it gives back is a point of key.
 * A width query would abbreviate `Transferencia` on a wide screen that had all
 * the room in the world (the rule this file has carried since round 3; only
 * what it tightens has changed, because the list is no longer a stack).
 */
@media (max-height: 899px) {
	.cobro-methods__list {
		gap: var(--reg-space-xs, 5px);
	}

	.cobro-methods__pick {
		padding: 0 var(--reg-space-sm, 6px);
		font-size: 13px;
	}
}

/*
 * THE DENSE DESK TIER — Marco's iPad-class window (1195×741, 1143×656).
 * The same query the rest of the register switches on; `denseDeskTier.spec.ts`
 * holds this file in lockstep with it.
 */
@media (min-width: 1100px) and (max-height: 820px) {
	.cobro-methods__row {
		border-radius: var(--reg-radius-xs, 6px);
	}

	.cobro-methods__eyebrow {
		font-size: 10px;
	}

	.cobro-methods__icon {
		width: 16px;
		height: 16px;
	}
}
</style>
