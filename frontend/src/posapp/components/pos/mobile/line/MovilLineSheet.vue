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

			<!-- The scale, where the register HAS one: the same pad the desk row
			     opens (weight in, or pesos in, qty out). The sheet only rings
			     the bell — the pad is hosted beside the lot picker in Pos.vue,
			     because a v-dialog mounted inside a leaving <Transition> would
			     be torn down mid-entry. -->
			<button
				v-if="line.canWeigh"
				type="button"
				class="movil-line-sheet__weigh"
				data-testid="movil-line-weigh"
				@click="emit('weigh')"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M12 3v3m0 0 5 2m-5-2L7 8m5-2v13m-8 0h16M4 8l-2.2 5.5a3 3 0 0 0 5.9 0L5.5 8M20 8l-2.2 5.5a3 3 0 0 0 5.9 0L21.5 8"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				{{ __("Weigh or set amount") }}
			</button>

			<!-- The unit the line sells in. Chips, not a <select>: the options
			     are the item's own UOM table (two or three entries), and the
			     active one has to be readable at a glance mid-sale. -->
			<div
				v-if="line.uomOptions.length > 1"
				class="movil-line-sheet__field movil-line-sheet__field--uom"
				data-testid="movil-line-uom-field"
			>
				<span class="movil-line-sheet__label">{{ __("UOM") }}</span>
				<div class="movil-line-sheet__uoms" role="group" :aria-label="__('UOM')">
					<button
						v-for="option in line.uomOptions"
						:key="option"
						type="button"
						class="movil-line-sheet__uom"
						:class="{ 'movil-line-sheet__uom--on': option === line.uom }"
						:disabled="!line.canEditUom"
						:aria-pressed="option === line.uom ? 'true' : 'false'"
						:data-testid="`movil-line-uom-${option}`"
						@click="pickUom(option)"
					>
						{{ option }}
					</button>
				</div>
			</div>
			<!-- The conversion, said out loud: the one line that keeps a cashier
			     selling a box from believing the price is per piece. -->
			<p
				v-if="conversionCaption"
				class="movil-line-sheet__conversion reg-mono"
				data-testid="movil-line-conversion"
			>
				{{ conversionCaption }}
			</p>

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

			<!-- The % field's peso twin — the desk row carries both, and a
			     cashier matching a competitor's sticker thinks in pesos, not
			     percentages. Same gate; `calc_prices` keeps the two agreeing. -->
			<div
				v-if="line.canEditDiscount"
				class="movil-line-sheet__field"
				data-testid="movil-line-discount-amount-field"
			>
				<span class="movil-line-sheet__label">{{ __("Discount Amount") }}</span>
				<input
					v-model="discountAmountDraft"
					class="movil-line-sheet__input reg-mono"
					data-testid="movil-line-discount-amount"
					type="number"
					inputmode="decimal"
					step="any"
					enterkeyhint="done"
					:aria-label="__('Discount Amount')"
					@change="commitDiscountAmount"
					@keydown.enter.prevent="commitDiscountAmount"
				/>
			</div>

			<!-- Which numbered unit this line actually sells. The row states
			     the current answer; the tap re-opens the same LOT PICKER the
			     add path uses, seeded with it. -->
			<div
				v-if="line.hasLots"
				class="movil-line-sheet__field"
				data-testid="movil-line-lots-field"
			>
				<span class="movil-line-sheet__label">{{ lotLabel }}</span>
				<button
					type="button"
					class="movil-line-sheet__lots"
					data-testid="movil-line-lots"
					:disabled="!line.canEditLots"
					@click="emit('lots')"
				>
					<span class="movil-line-sheet__lots-summary reg-mono">{{ lotSummary }}</span>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="m9 6 6 6-6 6"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
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
				<!-- «More options» now opens IN the sheet: the price-list rate,
				     the delivery date and the stock facts the desk's expanded
				     row shows. What used to be here — a jump to the whole
				     classic cart — is demoted to the last line of that section,
				     because fronting a five-column desktop table was the one
				     thing this sheet was built to stop doing. -->
				<button
					type="button"
					class="movil-line-sheet__more"
					data-testid="movil-line-expand"
					:aria-expanded="moreOpen ? 'true' : 'false'"
					@click="toggleMore"
				>
					{{ __("More options") }}
					<svg
						class="movil-line-sheet__more-chevron"
						:class="{ 'movil-line-sheet__more-chevron--open': moreOpen }"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="m6 9 6 6 6-6"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			</div>

			<div v-if="moreOpen" class="movil-line-sheet__extra" data-testid="movil-line-extra">
				<!-- The list price behind the rate. Editable ONLY where the desk's
				     «Change Price» button is (posa_allow_price_list_rate_change);
				     everywhere else it reads as a fact below. -->
				<div
					v-if="line.canChangePriceListRate"
					class="movil-line-sheet__field"
					data-testid="movil-line-plr-field"
				>
					<span class="movil-line-sheet__label">{{ __("Price List Rate") }}</span>
					<input
						v-model="priceListRateDraft"
						class="movil-line-sheet__input reg-mono"
						data-testid="movil-line-plr"
						type="number"
						inputmode="decimal"
						step="any"
						enterkeyhint="done"
						:aria-label="__('Price List Rate')"
						@change="commitPriceListRate"
						@keydown.enter.prevent="commitPriceListRate"
					/>
				</div>

				<!-- Order / Quotation lines promise a date. Native date input:
				     the phone's own picker beats any widget this sheet could ship. -->
				<div
					v-if="line.canEditDeliveryDate"
					class="movil-line-sheet__field"
					data-testid="movil-line-delivery-field"
				>
					<span class="movil-line-sheet__label">{{ __("Delivery Date") }}</span>
					<input
						class="movil-line-sheet__input"
						data-testid="movil-line-delivery"
						type="date"
						:value="deliveryDateIso"
						:min="todayIso"
						:aria-label="__('Delivery Date')"
						@change="commitDeliveryDate"
					/>
				</div>

				<!-- The stock facts the desk's expanded panel shows, read-only. -->
				<dl class="movil-line-sheet__facts" data-testid="movil-line-facts">
					<div class="movil-line-sheet__fact">
						<dt>{{ __("Available QTY") }}</dt>
						<dd class="reg-mono">{{ factQty(line.availableQty) }} {{ line.stockUom }}</dd>
					</div>
					<div v-if="line.uom !== line.stockUom" class="movil-line-sheet__fact">
						<dt>{{ __("Stock QTY") }}</dt>
						<dd class="reg-mono" data-testid="movil-line-stock-qty">
							{{ factQty(line.stockQty) }} {{ line.stockUom }}
						</dd>
					</div>
					<div v-if="!line.canChangePriceListRate" class="movil-line-sheet__fact">
						<dt>{{ __("Price List Rate") }}</dt>
						<dd class="reg-mono">{{ formatCurrency(line.priceListRate) }}</dd>
					</div>
					<div v-if="line.warehouse" class="movil-line-sheet__fact">
						<dt>{{ __("Warehouse") }}</dt>
						<dd>{{ line.warehouse }}</dd>
					</div>
					<div v-if="line.itemGroup" class="movil-line-sheet__fact">
						<dt>{{ __("Group") }}</dt>
						<dd>{{ line.itemGroup }}</dd>
					</div>
				</dl>

				<!-- The door to the classic cart, demoted but NOT deleted: the
				     bundle dialog and the customer editor still live there, and
				     a spec pins that this stays reachable. -->
				<button
					type="button"
					class="movil-line-sheet__classic"
					data-testid="movil-line-more"
					@click="emit('more')"
				>
					{{ __("Open the classic cart") }}
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { tick, warn } from "../../../../utils/haptics";
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
	/** Open the weighing pad (hosted in `Pos.vue`, beside the lot picker). */
	(_event: "weigh"): void;
	/** Re-open the lot picker over this line's current serial / batch choice. */
	(_event: "lots"): void;
}>();

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

/** `IPN001880` — or `COMBO · 3` on a bundle, matching the cart row's chip. */
const subtitle = computed(() => {
	if (props.line.isCombo) return `${__("COMBO")} · ${props.line.componentCount}`;
	return props.line.itemCode;
});

/** Trailing zeros trimmed — `12` and `0.5`, never `12.000`. */
const factQty = (value: number): string => {
	const rounded = Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
	return String(rounded);
};

/** `1 Caja = 12 Pza` — drawn only when the line's unit is not the shelf's. */
const conversionCaption = computed(() => {
	const { uom, stockUom, conversionFactor } = props.line;
	if (!uom || !stockUom || uom === stockUom) return "";
	if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) return "";
	return `1 ${uom} = ${factQty(conversionFactor)} ${stockUom}`;
});

const lotLabel = computed(() => (props.line.hasSerial ? __("Serial No") : __("Batch No")));

/** What is chosen NOW — the serials themselves, the batch, or an ask. */
const lotSummary = computed(() => {
	const serials = props.line.lotSerials;
	if (serials.length === 1) return serials[0];
	if (serials.length > 1) return `${serials.length} · ${serials[serials.length - 1]}`;
	if (props.line.lotBatchNo) return props.line.lotBatchNo;
	return __("Select");
});

// ---- «More options» — the expanded half of the sheet ----------------------
const moreOpen = ref(false);
const toggleMore = () => {
	moreOpen.value = !moreOpen.value;
	if (!moreOpen.value) return;
	// The section unfolds at the bottom of a scrolling panel; without this the
	// tap "does nothing" visually on a sheet that is already full.
	void nextTick(() => {
		// `?.` on the METHOD too: jsdom's elements have no scrollIntoView, and
		// the `x?.y()` form only guards x being null, not y being absent.
		panelEl.value
			?.querySelector('[data-testid="movil-line-extra"]')
			?.scrollIntoView?.({ block: "nearest" });
	});
};

/** dd-MM-yyyy (the row's own format) → yyyy-MM-dd (the input's), and back. */
const deliveryDateIso = computed(() => {
	const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(props.line.deliveryDate);
	return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
});
const todayIso = computed(() => {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});
const commitDeliveryDate = (event: Event) => {
	if (!props.line.canEditDeliveryDate) return;
	const value = String((event.target as HTMLInputElement)?.value || "");
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return;
	const formatted = `${match[3]}-${match[2]}-${match[1]}`;
	if (formatted === props.line.deliveryDate) return;
	emit("edit", { kind: "deliveryDate", date: formatted });
};

/** Numbers become strings for the fields; blank is a legitimate mid-edit state. */
const asDraft = (value: number) => String(value);

const qtyDraft = ref(asDraft(props.line.qty));
const rateDraft = ref(asDraft(props.line.rate));
const discountDraft = ref(asDraft(props.line.discountPercentage));
const discountAmountDraft = ref(asDraft(props.line.discountAmount));
const priceListRateDraft = ref(asDraft(props.line.priceListRate));

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
watch(
	() => props.line.discountAmount,
	(value) => {
		discountAmountDraft.value = asDraft(value);
	},
);
watch(
	() => props.line.priceListRate,
	(value) => {
		priceListRateDraft.value = asDraft(value);
	},
);

const close = () => emit("close");

/**
 * The haptic fires AFTER the gate, never before it: a disabled ± that buzzes
 * tells the hand the tap landed when the quantity did not move. It is the
 * same rule the toast layer follows — feedback describes what happened.
 */
const step = (delta: 1 | -1) => {
	if (delta > 0 ? !props.line.canStepUp : !props.line.canStepDown) return;
	tick();
	emit("edit", { kind: "step", delta });
};

/** The heavier pattern: a line leaving the ticket is not a step. */
const remove = () => {
	warn();
	emit("edit", { kind: "remove" });
};

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

const commitDiscountAmount = () => {
	if (!props.line.canEditDiscount) return;
	commit(discountAmountDraft, props.line.discountAmount, (amount) => ({
		kind: "discountAmount",
		amount,
	}));
};

const commitPriceListRate = () => {
	if (!props.line.canChangePriceListRate) return;
	commit(priceListRateDraft, props.line.priceListRate, (rate) => ({
		kind: "priceListRate",
		rate,
	}));
};

/** A chip tap. The active unit re-tapped travels nowhere — nothing changed. */
const pickUom = (uom: string) => {
	if (!props.line.canEditUom || uom === props.line.uom) return;
	tick();
	emit("edit", { kind: "uom", uom });
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
	/* LOAD-BEARING: this z-index only beats the dock while the sheet is mounted
	   OUTSIDE `.destination-host`. That host sets `isolation: isolate` (so a
	   hosted contained overlay's z-index cannot escape it), which ALSO caps any
	   `position: fixed` descendant — a fixed z-30 sheet mounted inside a hosted
	   flow would paint BELOW the dock again. If a hosted flow (Returns, Purchase)
	   ever mounts this sheet, `<Teleport to="body">` it (audit LAYOUT-F3). */

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
	/* Two shadows. The first is the sheet's lift. The SECOND is a hard,
	 * blur-less copy of the panel painted 32px lower in the surface colour —
	 * it sits below the viewport at rest and costs nothing, and it is what
	 * `--ease-emphasized`'s overshoot lands on: the curve carries the panel
	 * ~5% of its own height past its resting place, and without this the
	 * bounce would flash a strip of scrim under a sheet that is supposed to
	 * be sitting ON the bottom edge. A box-shadow rather than a pseudo-
	 * element because the panel scrolls, and `overflow-y: auto` would clip
	 * an `::after` while it never clips a shadow. */
	box-shadow:
		0 -8px 28px var(--pos-shadow, rgba(15, 23, 42, 0.18)),
		0 32px 0 0 var(--reg-surface, #ffffff);
}

/* ---- enter / leave ------------------------------------------------------
 * Driven by `<Transition name="movil-sheet">` in `MovilShell.vue`, which
 * v-ifs this component: Vue stamps the classes on THIS root, so the rules
 * live here, next to the geometry they move.
 *
 * The panel travels its own height on the emphasized curve; the scrim only
 * fades, and faster, so the darkening reads as already-done by the time the
 * sheet arrives. `transform` and `opacity` only — a sheet that animated
 * `height` or `bottom` would reflow the whole register per frame.
 */
.movil-sheet-enter-active .movil-line-sheet__panel,
.movil-sheet-leave-active .movil-line-sheet__panel {
	transition: transform var(--motion-slow) var(--ease-emphasized);
	will-change: transform;
}

.movil-sheet-enter-active .movil-line-sheet__scrim,
.movil-sheet-leave-active .movil-line-sheet__scrim {
	transition: opacity var(--motion-base) var(--ease-out);
	will-change: opacity;
}

.movil-sheet-enter-from .movil-line-sheet__panel,
.movil-sheet-leave-to .movil-line-sheet__panel {
	transform: translateY(100%);
}

.movil-sheet-enter-from .movil-line-sheet__scrim,
.movil-sheet-leave-to .movil-line-sheet__scrim {
	opacity: 0;
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
	transition: transform var(--motion-fast) var(--ease-out);
}

/* The ± is the control this sheet exists for, and it is pressed in runs.
 * The scale is what makes the fourth tap feel like it landed when the number
 * has stopped surprising anyone. */
.movil-line-sheet__step:active:not(:disabled) {
	background: var(--reg-surface-muted, #f2f4f7);
	transform: scale(var(--press-scale, 0.98));
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

.movil-line-sheet__more-chevron {
	transition: transform var(--motion-fast) var(--ease-out);
}

.movil-line-sheet__more-chevron--open {
	transform: rotate(180deg);
}

/* The scale's door. Tonal, not filled: it OFFERS a faster entry, it is not
 * the screen's action — that is still the stepper above it. */
.movil-line-sheet__weigh {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	min-height: var(--reg-touch-min, 44px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-sunken, #f8f9fa);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.movil-line-sheet__weigh:active {
	background: var(--reg-surface-muted, #f2f4f7);
}

/* Two or three chips; a catalogue with more scrolls them rather than wrapping
 * a sheet that must keep Remove above the fold. */
.movil-line-sheet__uoms {
	display: flex;
	gap: var(--reg-space-xs, 5px);
	max-width: 70%;
	overflow-x: auto;
}

.movil-line-sheet__uom {
	flex: none;
	min-height: var(--reg-touch-min, 44px);
	min-width: 52px;
	padding: 0 12px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: 999px;
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	font-weight: 600;
	cursor: pointer;
}

.movil-line-sheet__uom--on {
	border-color: var(--reg-accent, #0097a7);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-accent-pressed, #00838f);
}

.movil-line-sheet__uom:disabled {
	opacity: 0.55;
	cursor: default;
}

.movil-line-sheet__conversion {
	margin: -4px 0 0;
	font-size: 10.5px;
	text-align: end;
	color: var(--reg-text-muted, #667085);
}

/* The lot row reads as a value with a chevron — a row that goes somewhere. */
.movil-line-sheet__lots {
	display: flex;
	align-items: center;
	gap: 6px;
	min-height: var(--reg-touch-min, 44px);
	max-width: 70%;
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.movil-line-sheet__lots:active:not(:disabled) {
	background: var(--reg-surface-muted, #f2f4f7);
}

.movil-line-sheet__lots:disabled {
	color: var(--reg-text-muted, #667085);
	cursor: default;
}

.movil-line-sheet__lots-summary {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align: end;
}

/* The unfolded «More options». A divider above it marks where the everyday
 * sheet ends and the occasional half begins. */
.movil-line-sheet__extra {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px solid var(--reg-divider, #eceff3);
}

.movil-line-sheet__facts {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: var(--reg-space-sm, 6px);
	margin: 0;
}

.movil-line-sheet__fact {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 8px 10px;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-sunken, #f8f9fa);
}

.movil-line-sheet__fact dt {
	font-size: 9.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.movil-line-sheet__fact dd {
	margin: 0;
	font-size: 12.5px;
	font-weight: 600;
	color: var(--reg-text-primary, #212121);
	overflow-wrap: anywhere;
}

.movil-line-sheet__classic {
	min-height: var(--reg-touch-min, 44px);
	border: 0;
	background: none;
	color: var(--reg-text-muted, #667085);
	font: inherit;
	font-size: 11.5px;
	text-decoration: underline;
	cursor: pointer;
}

/* The tokens are already 0ms under this query; the block states the intent
 * where the animation is written, and covers a surface rendered before
 * register-tokens.css has been wired into the entry. */
@media (prefers-reduced-motion: reduce) {
	/* The same compound selectors, or they lose on specificity to the
	 * `.movil-sheet-*-active` rules above — a media query buys no weight. */
	.movil-sheet-enter-active .movil-line-sheet__panel,
	.movil-sheet-leave-active .movil-line-sheet__panel,
	.movil-sheet-enter-active .movil-line-sheet__scrim,
	.movil-sheet-leave-active .movil-line-sheet__scrim,
	.movil-line-sheet__step,
	.movil-line-sheet__more-chevron {
		transition: none;
	}

	.movil-sheet-enter-from .movil-line-sheet__panel,
	.movil-sheet-leave-to .movil-line-sheet__panel {
		transform: none;
	}

	.movil-sheet-enter-from .movil-line-sheet__scrim,
	.movil-sheet-leave-to .movil-line-sheet__scrim {
		opacity: 1;
	}
}
</style>
