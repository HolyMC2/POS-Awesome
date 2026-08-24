<template>
	<v-dialog
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		max-width="420"
		:retain-focus="false"
		data-testid="fractional-qty-pad"
	>
		<v-card class="posa-fracc-pad">
			<div class="posa-fracc-pad__head">
				<div class="posa-fracc-pad__item">{{ itemName }}</div>
				<div class="posa-fracc-pad__rate" data-testid="fracc-rate">{{ rateLabel }}</div>
			</div>

			<div class="posa-fracc-pad__modes">
				<button
					type="button"
					class="posa-fracc-pad__mode"
					:class="{ 'posa-fracc-pad__mode--on': mode === 'weight' }"
					data-testid="fracc-mode-weight"
					@click="setMode('weight')"
				>
					{{ __("Type weight") }}
				</button>
				<button
					type="button"
					class="posa-fracc-pad__mode"
					:class="{ 'posa-fracc-pad__mode--on': mode === 'importe' }"
					data-testid="fracc-mode-importe"
					@click="setMode('importe')"
				>
					{{ __("$ Amount") }}
				</button>
			</div>

			<div v-if="mode === 'weight'" class="posa-fracc-pad__body">
				<div class="posa-fracc-pad__row">
					<label class="posa-fracc-pad__label" for="fracc-gross-input">
						{{ __("Net weight on the scale") }}
					</label>
					<div v-if="subUnit" class="posa-fracc-pad__units" data-testid="fracc-entry-units">
						<button
							type="button"
							class="posa-fracc-pad__unit-chip"
							:class="{ 'posa-fracc-pad__unit-chip--on': entryUnit === 'pricing' }"
							data-testid="fracc-unit-pricing"
							@click="setEntryUnit('pricing')"
						>
							{{ uomLabel }}
						</button>
						<button
							type="button"
							class="posa-fracc-pad__unit-chip"
							:class="{ 'posa-fracc-pad__unit-chip--on': entryUnit === 'sub' }"
							data-testid="fracc-unit-sub"
							@click="setEntryUnit('sub')"
						>
							{{ subUnit.uom }}
						</button>
					</div>
				</div>
				<div class="posa-fracc-pad__field">
					<input
						id="fracc-gross-input"
						v-model="grossInput"
						class="posa-fracc-pad__input"
						type="number"
						inputmode="decimal"
						step="any"
						autofocus
						data-testid="fracc-gross"
						@keydown.enter.prevent="confirm"
					/>
					<span class="posa-fracc-pad__unit" data-testid="fracc-gross-unit">{{ entryUnitLabel }}</span>
				</div>

				<div class="posa-fracc-pad__tara">
					<label class="posa-fracc-pad__label" for="fracc-tara-input">
						{{ __("Tray tare") }}
					</label>
					<div class="posa-fracc-pad__field">
						<input
							id="fracc-tara-input"
							v-model="taraInput"
							class="posa-fracc-pad__input"
							type="number"
							inputmode="decimal"
							step="any"
							data-testid="fracc-tara"
							@keydown.enter.prevent="confirm"
						/>
						<span class="posa-fracc-pad__unit" data-testid="fracc-tara-unit">{{ entryUnitLabel }}</span>
					</div>
				</div>
			</div>

			<div v-else class="posa-fracc-pad__body">
				<label class="posa-fracc-pad__label" for="fracc-importe-input">
					{{ __("Amount the customer asked for") }}
				</label>
				<div class="posa-fracc-pad__field">
					<span class="posa-fracc-pad__unit">{{ currencySymbol(displayCurrency) }}</span>
					<input
						id="fracc-importe-input"
						v-model="importeInput"
						class="posa-fracc-pad__input"
						type="number"
						inputmode="decimal"
						step="any"
						autofocus
						data-testid="fracc-importe"
						@keydown.enter.prevent="confirm"
					/>
				</div>
			</div>

			<div
				class="posa-fracc-pad__readout"
				:class="{ 'posa-fracc-pad__readout--refused': !resolved.ok }"
				data-testid="fracc-readout"
			>
				{{ readout }}
			</div>

			<div class="posa-fracc-pad__actions">
				<button
					type="button"
					class="posa-fracc-pad__btn"
					data-testid="fracc-cancel"
					@click="cancel"
				>
					{{ __("Cancel") }}
				</button>
				<button
					type="button"
					class="posa-fracc-pad__btn posa-fracc-pad__primary"
					:disabled="!resolved.ok"
					data-testid="fracc-confirm"
					@click="confirm"
				>
					{{ __("Add to sale") }}
				</button>
			</div>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * The weighed line's editor — «teclear peso», tara, and «$ Importe».
 *
 * It never writes an importe or a tara anywhere. Both are GESTURES: the
 * customer says «dame $50» or the tray weighs 20 g, and what the line ends up
 * carrying is a plain quantity, exactly as if someone had typed it. Storing the
 * gesture would mean two sources of truth for one number, and the second one
 * would drift the moment anybody edited the rate.
 *
 * All arithmetic lives in `fractionalMath` and is property-tested there; this
 * file's whole job is to show the operator what that arithmetic decided BEFORE
 * they commit to it — «$50.00 → 0.312 kg · se cobran $49.92». A register that
 * quietly resolved $50 into $49.92 would be right and still untrustworthy.
 */
import { computed, ref, watch } from "vue";

import {
	netFromTara,
	qtyFromImporte,
	qtyFromSubUnit,
	quantizeQty,
	qtyPrecisionForUom,
	readSubUnit,
	SUB_UNIT_ENTRY_PRECISION,
	toSubUnit,
	type UomFractionFacts,
} from "../../../utils/fractionalMath";

defineOptions({ name: "FractionalQtyPad" });

const props = defineProps<{
	modelValue: boolean;
	item: Record<string, any>;
	uomFacts: UomFractionFacts;
	displayCurrency?: string;
	currencyPrecision?: number;
	formatFloat: (_value: any, _precision?: number) => string;
	formatCurrency: (_value: any) => string;
	currencySymbol: (_currency?: string) => string;
}>();

const emit = defineEmits<{
	(_e: "update:modelValue", _open: boolean): void;
	(_e: "confirm", _payload: { qty: number; note: string }): void;
}>();

const __ = (window as any).__ || ((text: string, args?: any[]) => text);

type PadMode = "weight" | "importe";
/** Which unit the weight fields are being typed in — kilos or grams. */
type EntryUnit = "pricing" | "sub";

const mode = ref<PadMode>("weight");
const entryUnit = ref<EntryUnit>("pricing");
const grossInput = ref("");
const taraInput = ref("");
const importeInput = ref("");

const itemName = computed(() => props.item?.item_name || props.item?.item_code || "");
const uomLabel = computed(() => props.item?.uom || props.item?.stock_uom || "");
const qtyPrecision = computed(() => qtyPrecisionForUom(props.uomFacts));
const rate = computed(() => Number(props.item?.rate ?? props.item?.price_list_rate ?? 0));
const currencyPrecision = computed(() =>
	Number.isFinite(props.currencyPrecision as number) ? (props.currencyPrecision as number) : 2,
);

/**
 * The everyday smaller unit this line may be typed in, or null.
 *
 * Server-supplied (`UOM Conversion Factor`), never inferred: no row, no chips,
 * and the pad keeps the single-unit field it had. A shop whose UOM table has
 * been pruned gets today's behaviour rather than a wrong factor.
 */
const subUnit = computed(() => readSubUnit(props.uomFacts?.subUnit));

const entryUnitLabel = computed(() =>
	entryUnit.value === "sub" && subUnit.value ? subUnit.value.uom : uomLabel.value,
);

const rateLabel = computed(() =>
	uomLabel.value
		? `${props.currencySymbol(props.displayCurrency)}${props.formatCurrency(rate.value)}/${uomLabel.value}`
		: `${props.currencySymbol(props.displayCurrency)}${props.formatCurrency(rate.value)}`,
);

const toNumber = (value: string): number => {
	const parsed = parseFloat(String(value ?? "").replace(",", "."));
	return Number.isFinite(parsed) ? parsed : NaN;
};

type Resolved =
	| { ok: true; qty: number; note: string; sentence: string }
	| { ok: false; sentence: string };

/**
 * What the current inputs mean, recomputed on every keystroke.
 *
 * The empty state is a refusal with an EMPTY sentence rather than a complaint:
 * a pad that scolds before anything is typed teaches the operator to ignore
 * the line where the real answer is about to appear.
 */
const resolved = computed<Resolved>(() => {
	if (mode.value === "weight") {
		const gross = toNumber(grossInput.value);
		if (!Number.isFinite(gross)) return { ok: false, sentence: "" };

		// Everything up to the conversion happens in the unit the cashier is
		// TYPING in — a 20 g tare is subtracted from 495 g, not from 0.495 kg —
		// and at a precision generous enough that the subtraction is lossless.
		// The one floor that governs comes after, at the line's own precision.
		const typingInSub = entryUnit.value === "sub" && !!subUnit.value;
		const entryPrecision = typingInSub ? SUB_UNIT_ENTRY_PRECISION : qtyPrecision.value;
		const entryLabel = entryUnitLabel.value;

		const tara = taraInput.value === "" ? 0 : toNumber(taraInput.value);
		const net = netFromTara({ bruto: gross, tara, qtyPrecision: entryPrecision });
		if (!net.ok) {
			if (net.reason === "tara_exceeds_bruto") {
				return { ok: false, sentence: __("The tare is heavier than what is on the scale.") };
			}
			if (net.reason === "net_empty") {
				return { ok: false, sentence: __("Nothing left after the tare.") };
			}
			if (net.reason === "tara_negative") {
				return { ok: false, sentence: __("A tare cannot be negative.") };
			}
			return { ok: false, sentence: "" };
		}

		let qty: number;
		if (typingInSub) {
			const converted = qtyFromSubUnit({
				value: net.neto,
				subUnit: subUnit.value!,
				qtyPrecision: qtyPrecision.value,
			});
			if (!converted.ok) {
				return {
					ok: false,
					sentence: __("Less than the smallest quantity this register can sell."),
				};
			}
			qty = converted.qty;
		} else {
			const quantized = quantizeQty(net.neto, qtyPrecision.value);
			if (!quantized.ok) {
				return {
					ok: false,
					sentence: __("Less than the smallest quantity this register can sell."),
				};
			}
			qty = quantized.qty;
		}

		const pricingText = `${props.formatFloat(qty, qtyPrecision.value)} ${uomLabel.value}`.trim();
		const amountText = `${props.currencySymbol(props.displayCurrency)}${props.formatCurrency(
			qty * rate.value,
		)}`;
		// «475 g = 0.475 Kg» — both numbers, always, when the entry unit is not
		// the pricing unit. The conversion is the step the operator cannot check
		// in their head against a total, so it is the one that must be legible.
		const entryText = typingInSub
			? `${props.formatFloat(net.neto, 0)} ${entryLabel} = ${pricingText}`
			: pricingText;
		const taraText =
			tara > 0
				? __("tare {0}", [`${props.formatFloat(tara, typingInSub ? 0 : qtyPrecision.value)} ${entryLabel}`])
				: "";

		return {
			ok: true,
			qty,
			note: taraText
				? __("Weighed {0} · gross {1} · {2}", [
						entryText,
						`${props.formatFloat(net.bruto, typingInSub ? 0 : qtyPrecision.value)} ${entryLabel}`,
						taraText,
					])
				: typingInSub
					? __("Weighed {0}", [entryText])
					: "",
			sentence: taraText
				? `${props.formatFloat(net.bruto, typingInSub ? 0 : qtyPrecision.value)} − ${props.formatFloat(
						tara,
						typingInSub ? 0 : qtyPrecision.value,
					)} = ${entryText} · ${amountText}`
				: `${entryText} · ${amountText}`,
		};
	}

	const importe = toNumber(importeInput.value);
	if (!Number.isFinite(importe)) return { ok: false, sentence: "" };

	const derived = qtyFromImporte({
		importe,
		rate: rate.value,
		qtyPrecision: qtyPrecision.value,
		currencyPrecision: currencyPrecision.value,
	});
	if (!derived.ok) {
		if (derived.reason === "rate_not_positive") {
			return { ok: false, sentence: __("This item has no price on this register.") };
		}
		if (derived.reason === "below_minimum_qty") {
			return {
				ok: false,
				sentence: __("That amount buys less than the smallest quantity this register can sell."),
			};
		}
		return { ok: false, sentence: "" };
	}

	const symbol = props.currencySymbol(props.displayCurrency);
	const weightText = `${props.formatFloat(derived.qty, qtyPrecision.value)} ${uomLabel.value}`.trim();

	// «$50.00 → 0.312 kg · se cobran $49.92» — the charge is stated even when it
	// equals the ask, so the operator learns the sentence always tells the
	// truth rather than only appearing when something was taken off.
	return {
		ok: true,
		qty: derived.qty,
		note: __("For {0}", [`${symbol}${props.formatCurrency(derived.asked)}`]),
		sentence: `${symbol}${props.formatCurrency(derived.asked)} → ${weightText} · ${__(
			"charged {0}",
			[`${symbol}${props.formatCurrency(derived.charged)}`],
		)}`,
	};
});

const readout = computed(() => resolved.value.sentence);

const setMode = (next: PadMode) => {
	mode.value = next;
};

/**
 * Switching kg ⇄ g CONVERTS what is already typed rather than clearing it.
 *
 * A cashier who has typed 0.475 and then realises they wanted grams is telling
 * the register the unit, not retracting the number. Clearing would make the
 * chips feel like a trap; re-typing 475 is the thing the chip exists to avoid.
 */
const setEntryUnit = (next: EntryUnit) => {
	if (next === entryUnit.value || !subUnit.value) return;
	const convert = (raw: string) => {
		const value = toNumber(raw);
		if (!Number.isFinite(value)) return raw;
		return String(
			next === "sub"
				? toSubUnit(value, subUnit.value!)
				: Number((value / subUnit.value!.perUnit).toFixed(SUB_UNIT_ENTRY_PRECISION)),
		);
	};
	if (grossInput.value !== "") grossInput.value = convert(grossInput.value);
	if (taraInput.value !== "") taraInput.value = convert(taraInput.value);
	entryUnit.value = next;
};

const reset = () => {
	mode.value = "weight";
	// Grams by default when the line has them: a cashier reading a scale says
	// «475», not «cero punto cuatro siete cinco».
	entryUnit.value = subUnit.value ? "sub" : "pricing";
	grossInput.value = "";
	taraInput.value = "";
	importeInput.value = "";
};

// `immediate` so a pad that is ALREADY open when it mounts picks its default
// entry unit. Without it the initial ref wins and a kilo line opens on kilos
// even where the register offers grams — invisible in the app (the dialog is
// mounted closed and flipped open) and exactly the shape of bug that only ever
// shows up somewhere else.
watch(
	() => props.modelValue,
	(open) => {
		if (open) reset();
	},
	{ immediate: true },
);

const cancel = () => {
	emit("update:modelValue", false);
};

const confirm = () => {
	const current = resolved.value;
	if (!current.ok) return;
	emit("confirm", { qty: current.qty, note: current.note });
	emit("update:modelValue", false);
};
</script>

<style scoped>
.posa-fracc-pad {
	padding: 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.posa-fracc-pad__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.posa-fracc-pad__item {
	font-size: 15px;
	font-weight: 600;
	color: var(--pos-text-primary);
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.posa-fracc-pad__rate {
	font-size: 14px;
	font-weight: 700;
	color: var(--pos-text-primary);
	font-variant-numeric: tabular-nums;
	flex: 0 0 auto;
}

.posa-fracc-pad__modes {
	display: flex;
	gap: 8px;
}

/*
 * Two independent declarations rather than one compounded selector: a single
 * `.posa-fracc-pad__mode--on` sitting beside the base class inherits its
 * background from whichever rule the cascade happens to favour, which is how a
 * selected mode ends up looking unselected on one theme and not the other.
 */
.posa-fracc-pad__mode {
	flex: 1;
	height: 34px;
	border: 0;
	border-radius: 8px;
	cursor: pointer;
	font-size: 13px;
	background: var(--pos-surface-muted, #f2f4f7);
	color: var(--pos-text-muted, #667085);
}

.posa-fracc-pad__mode.posa-fracc-pad__mode--on {
	background: var(--pos-primary-soft, #e0f7fa);
	color: var(--pos-primary, #00646f);
	font-weight: 700;
}

.posa-fracc-pad__body {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.posa-fracc-pad__label {
	font-size: 11.5px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--pos-text-muted, #667085);
}

.posa-fracc-pad__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
}

.posa-fracc-pad__units {
	display: flex;
	gap: 4px;
	flex: 0 0 auto;
}

/* The entry-unit chips are a QUIET control — the loud choice on this pad is
   peso-vs-importe above them. Same two-declaration shape as the mode buttons,
   for the same cascade reason. */
.posa-fracc-pad__unit-chip {
	min-width: 34px;
	height: 24px;
	padding: 0 8px;
	border: 1px solid var(--pos-border, #e2e6ec);
	border-radius: 12px;
	cursor: pointer;
	font-size: 11.5px;
	background: transparent;
	color: var(--pos-text-muted, #667085);
}

.posa-fracc-pad__unit-chip.posa-fracc-pad__unit-chip--on {
	border-color: var(--pos-primary, #0097a7);
	color: var(--pos-primary, #00646f);
	font-weight: 700;
}

.posa-fracc-pad__field {
	display: flex;
	align-items: center;
	gap: 6px;
	height: 44px;
	padding: 0 12px;
	border: 1px solid var(--pos-border, #e2e6ec);
	border-radius: 10px;
	background: var(--pos-surface, #fff);
}

.posa-fracc-pad__field:focus-within {
	border-color: var(--pos-primary, #0097a7);
}

/* A weight is read at a glance from arm's length, so it is set large and in
   tabular figures — the same treatment the artboard gives the scale readout. */
.posa-fracc-pad__input {
	flex: 1;
	min-width: 0;
	border: 0;
	outline: none;
	background: transparent;
	font-size: 20px;
	font-weight: 600;
	color: var(--pos-text-primary);
	font-variant-numeric: tabular-nums;
}

.posa-fracc-pad__unit {
	flex: 0 0 auto;
	font-size: 15px;
	font-weight: 600;
	color: var(--pos-text-muted, #667085);
}

.posa-fracc-pad__tara {
	display: flex;
	align-items: center;
	gap: 10px;
}

.posa-fracc-pad__tara .posa-fracc-pad__label {
	flex: 0 0 auto;
}

.posa-fracc-pad__tara .posa-fracc-pad__field {
	flex: 1;
	height: 36px;
}

.posa-fracc-pad__tara .posa-fracc-pad__input {
	font-size: 15px;
}

/* The readout keeps its height when empty so the dialog does not jump on the
   first keystroke — the number appearing IS the feedback. */
.posa-fracc-pad__readout {
	min-height: 22px;
	font-size: 14px;
	font-weight: 600;
	color: var(--pos-text-primary);
	font-variant-numeric: tabular-nums;
}

.posa-fracc-pad__readout--refused {
	color: var(--pos-button-warning-text, #e65100);
	font-weight: 500;
}

.posa-fracc-pad__actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}

.posa-fracc-pad__btn {
	height: 36px;
	padding: 0 16px;
	border: 0;
	border-radius: 8px;
	cursor: pointer;
	font-size: 13px;
	font-weight: 600;
	background: transparent;
	color: var(--pos-text-muted, #667085);
}

/* Named `__primary` rather than `__btn--primary`: this is the surface's primary
   action, and the single-accent guard identifies one by that name. A modifier
   spelling would have read as a decorated button and been flagged as an accent
   fill loose in the UI — correctly, since that is exactly what it would look
   like from the outside. */
.posa-fracc-pad__btn.posa-fracc-pad__primary {
	background: var(--pos-primary, #0097a7);
	color: #fff;
}

.posa-fracc-pad__btn:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
</style>
