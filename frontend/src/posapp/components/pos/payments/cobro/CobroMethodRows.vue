<template>
	<section class="cobro-methods" data-testid="cobro-methods">
		<!--
			THE METHOD LIST, ONE LINE PER METHOD.
			────────────────────────────────────────────────────────────────────
			`PaymentMethods` draws each tender as a card: a `METHOD` eyebrow, the
			mode as an h4, a badge row, an amount field and a full-width button
			carrying the method's own name a second time. Three methods is three
			of those, which on the hosted surface meant a column the cashier had
			to scroll to reach `Transferencia` (owner screenshot, 2026-08-23).

			The row keeps every act the card offered and spends one line on it:
			the NAME is the button (`set-full-amount` — the register's word for
			"this is the tender"), and the amount input beside it is the same
			`update-amount` the card's field emitted. The badges are gone because
			the row states both facts otherwise — the armed row is lit, and a
			refund is already announced by the sale being a return.

			The card is still what the dialog and the phone sheet render; this
			component is `cobroMode` only, and it emits nothing new.
		-->
		<h3 class="cobro-methods__label">{{ __("Payment method") }}</h3>

		<ul class="cobro-methods__list">
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
				</button>

				<!--
					A plain input, not a `v-text-field`: the field's label, hint
					slot and 56px control box are the card's chrome, and this row
					is one line. `data-pos-keyboard-target` is kept because
					`focusFirstPaymentTarget` looks for exactly that attribute
					when the surface opens — losing it would open Cobro with
					nothing focused.

					`isNumber` still judges what was typed. The card showed its
					verdict as a Vuetify rule message; here it is `aria-invalid`
					and a red edge, because a message row would make the line two
					lines the moment anyone fat-fingers a comma. Either way the
					value travels the same path — `setFormatedCurrency` coerces
					what it cannot parse to 0, exactly as it does for the card.
				-->
				<label class="cobro-methods__field">
					<span class="cobro-methods__symbol reg-mono" aria-hidden="true">{{
						currencySymbol(currency)
					}}</span>
					<input
						class="cobro-methods__amount reg-mono"
						data-pos-keyboard-target="payment-amount"
						:data-testid="`cobro-amount-${payment.mode_of_payment}`"
						:value="formatCurrency(payment.amount)"
						:aria-label="`${payment.mode_of_payment} — ${__('Amount')}`"
						:aria-invalid="invalid.has(payment.mode_of_payment) ? 'true' : undefined"
						:readonly="isGiftCardPayment(payment)"
						inputmode="decimal"
						enterkeyhint="done"
						type="text"
						@change="onAmountChange(payment, $event)"
						@focus="$emit('set-rest-amount', payment, isReturn)"
						@keydown.enter="blurTarget"
						@keydown.esc="blurTarget"
					/>
				</label>

				<!-- The two tenders that need an act beyond an amount. Both keep
				     the card's own wording and the card's own event. -->
				<button
					v-if="isMpesaC2bPayment(payment)"
					type="button"
					class="cobro-methods__action"
					:data-testid="`cobro-mpesa-${payment.mode_of_payment}`"
					@click="$emit('mpesa-dialog', payment)"
				>
					{{ __("Get Payments") }}
				</button>
				<button
					v-else-if="payment.type === 'Phone' && Number(payment.amount) > 0 && requestPaymentField"
					type="button"
					class="cobro-methods__action"
					:data-testid="`cobro-request-${payment.mode_of_payment}`"
					@click="$emit('request-payment', payment)"
				>
					{{ __("Request Payment") }}
				</button>
			</li>
		</ul>
	</section>
</template>

<script setup>
/**
 * The configured tenders, one compact row each (build plan §14.2, round 3).
 *
 * ⚠ MONEY PATH: THIS FILE IS CHROME. Like `CobroTenderPad` it writes nothing
 * itself — every event it raises is one `PaymentMethods` already raises, so
 * `v-on="paymentMethodsHandlers"` wires it with no new handler on the register.
 *
 * The lit row is `resolveTenderTarget`'s, the same module the pad commits into,
 * so "the method that is highlighted" and "the row the pad writes to" are one
 * answer rather than two rules that agree today.
 */
import { computed, reactive } from "vue";

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
	/** Whether the register still offers gift cards, for `armTender`'s chips. */
	usesGiftCards: { type: Boolean, default: false },
	cartHasItems: { type: Boolean, default: true },
	currencySymbol: { type: Function, required: true },
	formatCurrency: { type: Function, required: true },
	isNumber: { type: Function, required: true },
	isCashLikePayment: { type: Function, required: true },
	isMpesaC2bPayment: { type: Function, required: true },
	isGiftCardPayment: { type: Function, default: () => false },
});

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

/** Modes whose last typed value `isNumber` rejected. Presentation only. */
const invalid = reactive(new Set());

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

const blurTarget = (event) => {
	event?.target?.blur?.();
};

const onAmountChange = (payment, event) => {
	const raw = event?.target?.value ?? "";
	if (props.isNumber(raw) === true) invalid.delete(payment.mode_of_payment);
	else invalid.add(payment.mode_of_payment);
	emit("update-amount", payment, event);
};

/**
 * Picking a method is `set-full-amount` — the same act the card's big button
 * performed, and the register's word for "this is the tender". A gift card
 * opens its own dialog instead, because the amount there comes from a balance
 * check rather than from the sale.
 */
const pick = (payment) => {
	if (props.isGiftCardPayment(payment)) {
		emit("open-gift-card", payment);
		return;
	}
	emit("set-full-amount", payment, props.isReturn);
	// Kept in step so the sale screen's chip strip does not disagree with this
	// list after `Volver a la venta`. Nothing here is DRAWN from it.
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
.cobro-methods {
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	/* 10px like the pad above it: what this card does not spend on padding,
	   the pad's keys get. */
	padding: var(--reg-space-md, 10px);
}

.cobro-methods__label {
	margin: 0 0 var(--reg-space-sm, 8px);
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

/* ONE ROW PER METHOD, top to bottom, so a name is never abbreviated when
   there is room to print it. */
.cobro-methods__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: var(--reg-space-sm, 6px);
}

/* ONE LINE. The whole reason this component exists, so it is a property of the
   row rather than of its contents: a fixed height means a method cannot grow
   the column by carrying a longer name or a second badge. */
.cobro-methods__row {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	height: var(--reg-touch-min, 44px);
	padding: 0 var(--reg-space-sm, 6px) 0 0;
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
}

/* The armed row, in the accent's PALE derivative — the one saturated colour on
   this screen is COBRAR Y CERRAR, and it is on the band. */
.cobro-methods__row--on {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
}

.cobro-methods__pick {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	flex: 1 1 auto;
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

/* Gives way before the name does, down to a floor that still shows
   `$ 1,200.00` whole — the row is one line and something has to yield first. */
.cobro-methods__field {
	display: flex;
	align-items: center;
	gap: 3px;
	flex: 0 1 122px;
	min-width: 96px;
	height: 32px;
	padding: 0 8px;
	border-radius: var(--reg-radius-xs, 6px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
}

.cobro-methods__symbol {
	font-size: 12px;
	color: var(--reg-text-muted, #667085);
}

.cobro-methods__amount {
	width: 100%;
	min-width: 0;
	border: 0;
	background: transparent;
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13.5px;
	font-weight: 700;
	text-align: right;
	outline: none;
}

.cobro-methods__amount[aria-invalid="true"] {
	color: var(--reg-tone-warning-number, #8a5a0d);
}

.cobro-methods__field:focus-within {
	border-color: var(--reg-accent-edge, #9fdde6);
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
 * ON A SHORT SCREEN THE LIST PACKS INTO COLUMNS.
 *
 * Measured on the real box model: at 1280×800 the surface has 584px, and
 * three tenders stacked leave the numpad 33px keys — under the touch minimum
 * and visibly cramped. Packed two-across they leave 45px, at the cost of
 * abbreviating a long `Transferencia` beside its own icon (the full name is
 * on the row's `title`).
 *
 * A height query rather than a width one, because HEIGHT is what is short:
 * on a 1023px screen — the owner's own — the list stays one per row with
 * every name whole and the keys at 88px.
 */
@media (max-height: 899px) {
	.cobro-methods__list {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}

	/* Packed, the row has about 210px to divide. The amount field takes a
	   fixed share so the NAME gets what is left — the other way round leaves
	   three characters of `Transferencia` beside a field with room to spare. */
	.cobro-methods__field {
		flex: 0 0 96px;
		min-width: 0;
	}

	.cobro-methods__pick {
		padding: 0 var(--reg-space-sm, 6px);
	}
}
</style>
