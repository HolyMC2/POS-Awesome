<template>
	<div class="movil-line-sheet" data-testid="movil-line-sheet">
		<!-- A tap outside is the phone's Escape. Not a <button>: a full-viewport
		     control would be the biggest tab stop on the screen and would read
		     to a screen reader as an action; the × below is the named one. -->
		<div class="movil-line-sheet__scrim" data-testid="movil-line-scrim" @click="close"></div>

		<section
			ref="panelEl"
			class="movil-line-sheet__panel"
			role="dialog"
			aria-modal="true"
			:aria-label="line.itemName"
			tabindex="-1"
		>
			<header class="movil-line-sheet__head">
				<span class="movil-line-sheet__grip" aria-hidden="true"></span>
				<div class="movil-line-sheet__ident">
					<p class="movil-line-sheet__name" data-testid="movil-line-name">
						{{ line.itemName }}
					</p>
					<p
						v-if="subtitle"
						class="movil-line-sheet__code reg-mono"
						data-testid="movil-line-code"
					>
						{{ subtitle }}
					</p>
				</div>
				<button
					type="button"
					class="movil-line-sheet__close"
					data-testid="movil-line-close"
					:aria-label="__('Close')"
					@click="close"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="m6 6 12 12M18 6 6 18"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>

			<!-- Two figures, both read-only. The unit price is what one of this
			     thing costs; the line total is what the ticket is charging for
			     the row, LIVE — it is `resolveSaleSummary`'s amount, which is
			     the same number the cart row and the payment screen draw. -->
			<div class="movil-line-sheet__figures">
				<div class="movil-line-sheet__figure">
					<span class="movil-line-sheet__figure-label">{{ __("Unit price") }}</span>
					<span
						class="movil-line-sheet__figure-value reg-mono"
						data-money-role="unit-rate"
						data-testid="movil-line-unit"
						>{{ formatCurrency(line.rate) }}</span
					>
				</div>
				<div class="movil-line-sheet__figure movil-line-sheet__figure--total">
					<span class="movil-line-sheet__figure-label">{{ __("Line total") }}</span>
					<span
						class="movil-line-sheet__figure-value movil-line-sheet__figure-value--total reg-mono"
						data-money-role="line"
						data-testid="movil-line-amount"
						>{{ formatCurrency(line.amount) }}</span
					>
				</div>
			</div>

			<div class="movil-line-sheet__field">
				<span class="movil-line-sheet__label">{{ __("Quantity") }}</span>
				<div class="movil-line-sheet__stepper">
					<button
						type="button"
						class="movil-line-sheet__step"
						data-testid="movil-line-minus"
						:disabled="!line.canStepDown"
						:aria-label="__('Decrease quantity')"
						@click="step(-1)"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path d="M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
						</svg>
					</button>
					<input
						v-model="qtyDraft"
						class="movil-line-sheet__qty reg-mono"
						data-testid="movil-line-qty"
						type="number"
						inputmode="decimal"
						step="any"
						enterkeyhint="done"
						:disabled="!line.canTypeQty"
						:aria-label="__('Quantity')"
						@change="commitQty"
						@keydown.enter.prevent="commitQty"
					/>
					<button
						type="button"
						class="movil-line-sheet__step"
						data-testid="movil-line-plus"
						:disabled="!line.canStepUp"
						:aria-label="__('Increase quantity')"
						@click="step(1)"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M12 6v12M6 12h12"
								stroke="currentColor"
								stroke-width="2.4"
								stroke-linecap="round"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Rate and discount are drawn ONLY where `CartItemRow.vue` would
			     draw them. The gate is the profile's, resolved once in
			     `movilLineEdit.ts`; this component never asks a store. -->
			<div
				v-if="line.canEditRate"
				class="movil-line-sheet__field"
				data-testid="movil-line-rate-field"
			>
				<span class="movil-line-sheet__label">{{ __("Price") }}</span>
				<input
					v-model="rateDraft"
					class="movil-line-sheet__input reg-mono"
					data-testid="movil-line-rate"
					type="number"
					inputmode="decimal"
					step="any"
					enterkeyhint="done"
					:aria-label="__('Price')"
					@change="commitRate"
					@keydown.enter.prevent="commitRate"
				/>
			</div>

			<div
				v-if="line.canEditDiscount"
				class="movil-line-sheet__field"
				data-testid="movil-line-discount-field"
			>
				<span class="movil-line-sheet__label">{{ __("Discount %") }}</span>
				<input
					v-model="discountDraft"
					class="movil-line-sheet__input reg-mono"
					data-testid="movil-line-discount"
					type="number"
					inputmode="decimal"
					step="any"
					enterkeyhint="done"
					:aria-label="__('Discount %')"
					@change="commitDiscount"
					@keydown.enter.prevent="commitDiscount"
				/>
			</div>

			<div class="movil-line-sheet__actions">
				<button
					v-if="line.canRemove"
					type="button"
					class="movil-line-sheet__remove"
					data-testid="movil-line-remove"
					@click="remove"
				>
					{{ __("Remove line") }}
				</button>
				<!-- The classic cart still owns everything this sheet does not
				     model — UOM, batch and serial, the offer toggle, the line
				     note, the weighing pad. The fallback is a door, not a
				     leftover: deleting it would strand those on the phone. -->
				<button
					type="button"
					class="movil-line-sheet__more"
					data-testid="movil-line-more"
					@click="emit('more')"
				>
					{{ __("More options") }}
				</button>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
/**
 * The phone's line editor (movil round 10).
 *
 * Tapping a cart row on the phone used to front the CLASSIC desktop cart,
 * because the line editor was a `<tr>` with five columns and four inline
 * fields and there was no phone-sized one. This sheet is that editor at
 * 390 px: the two figures a cashier is checking, a thumb-sized stepper, and
 * the rate and discount fields ONLY where the profile already allows them.
 *
 * ⚠ IT MUTATES NOTHING. Every control emits an intent; `Pos.vue` stamps the
 * row identity on it and `Invoice.vue` answers by calling the SAME functions
 * the desktop row calls (`add_one` / `subtract_one` / `setFormatedQty` /
 * `setFormatedCurrency` + `calc_prices` / `remove_item`). There is no second
 * write path into a cart line, which is the whole reason the movil shell is
 * chrome over engines rather than a second register.
 *
 * The drafts below are LOCAL and re-sync from the row: the sheet reads a live
 * `invoiceStore` row through `resolveMovilLineEdit`, so a qty the engine
 * clamped (stock limit, offer cap, return sign) comes straight back into the
 * field instead of the field insisting on what was typed.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { MovilLineEdit, MovilLineIntent } from "./movilLineEdit";

const props = withDefaults(
	defineProps<{
		line: MovilLineEdit;
		formatCurrency?: (_value: number) => string;
	}>(),
	{ formatCurrency: (value: number) => value.toFixed(2) },
);

const emit = defineEmits<{
	(_event: "edit", _intent: MovilLineIntent): void;
	(_event: "close"): void;
	(_event: "more"): void;
}>();

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

/** `IPN001880` — or `COMBO · 3` on a bundle, matching the cart row's chip. */
const subtitle = computed(() => {
	if (props.line.isCombo) return `${__("COMBO")} · ${props.line.componentCount}`;
	return props.line.itemCode;
});

/** Numbers become strings for the fields; blank is a legitimate mid-edit state. */
const asDraft = (value: number) => String(value);

const qtyDraft = ref(asDraft(props.line.qty));
const rateDraft = ref(asDraft(props.line.rate));
const discountDraft = ref(asDraft(props.line.discountPercentage));

watch(
	() => props.line.qty,
	(value) => {
		qtyDraft.value = asDraft(value);
	},
);
watch(
	() => props.line.rate,
	(value) => {
		rateDraft.value = asDraft(value);
	},
);
watch(
	() => props.line.discountPercentage,
	(value) => {
		discountDraft.value = asDraft(value);
	},
);

const close = () => emit("close");

const step = (delta: 1 | -1) => {
	if (delta > 0 ? !props.line.canStepUp : !props.line.canStepDown) return;
	emit("edit", { kind: "step", delta });
};

const remove = () => emit("edit", { kind: "remove" });

/**
 * A committed field sends the intent only when it carries a real, CHANGED
 * number. A blank or half-typed value re-shows the row's own figure rather
 * than travelling: `setFormatedQty(…, NaN)` would write a quantity nobody
 * asked for, and a repricing pass for an unchanged rate is a server round
 * trip charged to a cashier who only tapped away from the field.
 */
const commit = (
	draft: { value: string },
	current: number,
	make: (_value: number) => MovilLineIntent,
) => {
	const parsed = Number.parseFloat(draft.value);
	if (!Number.isFinite(parsed)) {
		draft.value = asDraft(current);
		return;
	}
	if (parsed === current) return;
	emit("edit", make(parsed));
};

const commitQty = () => {
	if (!props.line.canTypeQty) return;
	commit(qtyDraft, props.line.qty, (qty) => ({ kind: "qty", qty }));
};

const commitRate = () => {
	if (!props.line.canEditRate) return;
	commit(rateDraft, props.line.rate, (rate) => ({ kind: "rate", rate }));
};

const commitDiscount = () => {
	if (!props.line.canEditDiscount) return;
	commit(discountDraft, props.line.discountPercentage, (discount) => ({
		kind: "discount",
		discount,
	}));
};

/**
 * Escape closes, from anywhere.
 *
 * On `document` rather than on the panel: the sheet opens without stealing
 * focus (a focused panel on a phone summons nothing, but on a laptop in the
 * compact band it would move focus off the cart), so a keydown bound to the
 * panel would only fire once something inside it had been tapped.
 */
const panelEl = ref<HTMLElement | null>(null);
const onKeydown = (event: KeyboardEvent) => {
	if (event.key !== "Escape") return;
	event.stopPropagation();
	close();
};
onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<style scoped>
/* Every colour is a token with the artboard value as its fallback — a literal
 * hex here is what left the register's primary navigation rendering light
 * beside a #121212 shell (wave 3, A1), and this sheet is drawn over a screen
 * people read at night. */
.movil-line-sheet {
	position: fixed;
	inset: 0;
	/* The dock is `position: fixed; z-index: 20`. A sheet the dock covers is a
	   sheet whose Remove button is under the Pay tab. */
	z-index: 30;
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
}

.movil-line-sheet__scrim {
	position: absolute;
	inset: 0;
	background: var(--reg-scrim, rgba(15, 23, 42, 0.32));
}

.movil-line-sheet__panel {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	max-height: 88%;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 10px 14px calc(18px + env(safe-area-inset-bottom));
	border-radius: var(--reg-radius-lg, 18px) var(--reg-radius-lg, 18px) 0 0;
	background: var(--reg-surface, #ffffff);
	box-shadow: 0 -8px 28px var(--pos-shadow, rgba(15, 23, 42, 0.18));
}

.movil-line-sheet__panel:focus {
	outline: none;
}

.movil-line-sheet__head {
	display: flex;
	align-items: flex-start;
	gap: var(--reg-space-md, 10px);
}

/* The drag handle every phone sheet has. Decorative — the × is the control. */
.movil-line-sheet__grip {
	position: absolute;
	top: 6px;
	left: 50%;
	width: 36px;
	height: 4px;
	margin-left: -18px;
	border-radius: 999px;
	background: var(--reg-divider, #eceff3);
}

.movil-line-sheet__ident {
	flex: 1;
	min-width: 0;
	padding-top: 8px;
}

.movil-line-sheet__name {
	margin: 0;
	font-size: 14.5px;
	font-weight: 700;
	line-height: 1.25;
	color: var(--reg-text-primary, #212121);
}

.movil-line-sheet__code {
	margin: 3px 0 0;
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.movil-line-sheet__close {
	flex: none;
	display: grid;
	place-items: center;
	width: var(--reg-touch-min, 44px);
	height: var(--reg-touch-min, 44px);
	min-width: var(--reg-touch-min, 44px);
	min-height: var(--reg-touch-min, 44px);
	/* Bleed the target outside the layout box so a 44px hit area does not push
	   the title row down — the same trade ItemRateInfoMenu's trigger makes. */
	margin: -6px -8px -6px 0;
	border: 0;
	border-radius: var(--reg-radius-sm, 10px);
	background: none;
	color: var(--reg-text-muted, #667085);
	cursor: pointer;
}

.movil-line-sheet__close:active {
	background: var(--reg-surface-muted, #f2f4f7);
}

.movil-line-sheet__figures {
	display: flex;
	gap: var(--reg-space-sm, 6px);
}

.movil-line-sheet__figure {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 8px 10px;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-sunken, #f8f9fa);
}

.movil-line-sheet__figure-label {
	font-size: 9.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.movil-line-sheet__figure-value {
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-line-sheet__figure-value--total {
	font-size: 19px;
	letter-spacing: -0.02em;
}

.movil-line-sheet__field {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	min-height: var(--reg-touch-min, 44px);
}

.movil-line-sheet__label {
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.movil-line-sheet__stepper {
	display: flex;
	align-items: center;
	gap: var(--reg-space-xs, 5px);
}

/* 44px square, always — not behind a `pointer: coarse` query. This control is
 * only ever drawn inside the compact register, where the owner may be holding
 * a phone or a stylus-reporting tablet, and both hands get the same target. */
.movil-line-sheet__step {
	display: grid;
	place-items: center;
	width: var(--reg-touch-min, 44px);
	height: var(--reg-touch-min, 44px);
	min-width: var(--reg-touch-min, 44px);
	min-height: var(--reg-touch-min, 44px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	cursor: pointer;
}

.movil-line-sheet__step:active {
	background: var(--reg-surface-muted, #f2f4f7);
}

.movil-line-sheet__step:disabled {
	color: var(--reg-text-muted, #667085);
	opacity: 0.45;
	cursor: default;
}

.movil-line-sheet__qty {
	width: 86px;
	min-height: var(--reg-touch-min, 44px);
	padding: 0 8px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 16px;
	font-weight: 700;
	text-align: center;
}

.movil-line-sheet__input {
	width: 128px;
	min-height: var(--reg-touch-min, 44px);
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	/* 16px on purpose: iOS Safari zooms the viewport on focus below it. */
	font-size: 16px;
	text-align: end;
}

.movil-line-sheet__qty:disabled,
.movil-line-sheet__input:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.movil-line-sheet__actions {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xs, 5px);
	margin-top: 2px;
}

/* Danger is a TINT with a label, never a saturated fill: the one filled,
 * saturated control on the phone's cart is CHARGE, and a red block here would
 * be the loudest thing on a screen whose loudest thing is taking money. */
.movil-line-sheet__remove {
	min-height: var(--reg-touch-min, 44px);
	border: 1px solid var(--reg-tone-negative-border, #f6cfcf);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-tone-negative-bg, #fdeaea);
	color: var(--reg-tone-negative-label, #b42318);
	font: inherit;
	font-size: 13.5px;
	font-weight: 700;
	cursor: pointer;
}

.movil-line-sheet__more {
	min-height: var(--reg-touch-min, 44px);
	border: 0;
	border-radius: var(--reg-radius-sm, 10px);
	background: none;
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}

.movil-line-sheet__more:active {
	background: var(--reg-surface-muted, #f2f4f7);
}
</style>
