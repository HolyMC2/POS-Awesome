<template>
	<v-dialog v-model="open" max-width="420" class="discount-dialog">
		<v-card data-testid="discount-dialog">
			<v-card-title class="discount-title">{{ __("Discount") }}</v-card-title>

			<v-card-text>
				<v-btn-toggle
					v-model="mode"
					mandatory
					density="comfortable"
					variant="outlined"
					class="discount-mode"
					data-testid="discount-mode"
				>
					<v-btn value="percentage" data-testid="discount-mode-pct">%</v-btn>
					<v-btn value="amount" data-testid="discount-mode-amount">{{ currencySymbol }}</v-btn>
				</v-btn-toggle>

				<v-text-field
					v-model="draft"
					autofocus
					type="number"
					inputmode="decimal"
					density="comfortable"
					variant="outlined"
					class="mt-3"
					data-testid="discount-input"
					:label="mode === 'percentage' ? __('Percent off') : __('Amount off')"
					:suffix="mode === 'percentage' ? '%' : ''"
					:prefix="mode === 'amount' ? currencySymbol : ''"
					@keydown.enter="applyDiscount"
				/>

				<!-- Presets: the four a counter actually uses. Typing 10 is not
				     hard, but during a queue a tap is one less thing to aim at. -->
				<div v-if="mode === 'percentage'" class="discount-presets">
					<v-chip
						v-for="preset in PRESETS"
						:key="preset"
						size="small"
						variant="outlined"
						data-testid="discount-preset"
						@click="draft = preset"
						>{{ preset }}%</v-chip
					>
				</div>

				<div class="discount-preview" data-testid="discount-preview">
					<span>{{ __("New total") }}</span>
					<strong>{{ currencySymbol }}{{ previewTotal }}</strong>
				</div>
				<div v-if="warning" class="discount-warning" data-testid="discount-warning">
					{{ warning }}
				</div>
			</v-card-text>

			<v-card-actions>
				<v-btn
					variant="text"
					color="error"
					data-testid="discount-clear"
					@click="clearDiscount"
					>{{ __("Clear") }}</v-btn
				>
				<v-spacer />
				<v-btn variant="text" data-testid="discount-cancel" @click="open = false">{{
					__("Cancel")
				}}</v-btn>
				<v-btn
					variant="tonal"
					color="primary"
					data-testid="discount-apply"
					:disabled="!!warning"
					@click="applyDiscount"
					>{{ __("Apply") }}</v-btn
				>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Discount dialog — "que el descuento sea un botón más claro" (§17.2).
 *
 * The discount was a small labelled field in the summary; on a busy counter
 * that is a hard target and an easy mis-type. This is a deliberate surface:
 * percent or amount, four presets, and the resulting total shown BEFORE the
 * operator commits — a discount is money leaving the till, so it should be
 * read back before it is applied.
 *
 * It owns no pricing logic. It emits the operator's intent and the shell
 * applies it through the very same handlers the inline field uses, so the
 * two surfaces can never drift into disagreeing about what a discount means.
 */
import { computed, ref, watch } from "vue";

import { evaluateDiscount, seedDraft, type DiscountMode } from "./discountIntent";

// @ts-ignore — Frappe's global translator; absent in unit tests.
const __ = window.__ || ((value: string) => value);

const PRESETS = [5, 10, 15, 20];

const props = withDefaults(
	defineProps<{
		modelValue: boolean;
		/** Net before the additional discount — the base the preview works from. */
		baseTotal?: number;
		currencySymbol?: string;
		initialMode?: "percentage" | "amount";
		initialPercentage?: number | string;
		initialAmount?: number | string;
	}>(),
	{
		baseTotal: 0,
		currencySymbol: "$",
		initialMode: "percentage",
		initialPercentage: 0,
		initialAmount: 0,
	},
);

// Runtime array form, like the rest of the dialogs here: the type-literal
// form silently registered NO events under this repo's lint rule that forces
// leading-underscore parameter names, so every emit became a no-op.
const emit = defineEmits(["update:modelValue", "apply", "clear"]);

const open = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const mode = ref<DiscountMode>(props.initialMode);
const draft = ref<number | string>("");

watch(
	() => props.modelValue,
	(visible) => {
		if (!visible) return;
		// Re-seed from what is currently applied, so opening the dialog on an
		// existing discount shows it rather than an empty box the operator
		// might read as "no discount".
		mode.value = props.initialMode;
		draft.value = seedDraft(props.initialMode, props.initialPercentage, props.initialAmount);
	},
	// immediate: mounted-already-open (v-model true on first render) would
	// otherwise never seed and show an empty box over a live discount.
	{ immediate: true },
);

const numericDraft = computed(() => {
	const value = parseFloat(String(draft.value));
	return Number.isFinite(value) ? value : 0;
});

// All decisions live in discountIntent.ts — pure, and tested there.
const intent = computed(() =>
	evaluateDiscount(mode.value, numericDraft.value, props.baseTotal, __),
);
const warning = computed(() => intent.value.warning);
const previewTotal = computed(() => intent.value.newTotal.toFixed(2));

// NOT named `apply`/`clear`: a component proxy resolves `apply` to
// Function.prototype.apply, so an exposed `apply` is unreachable from a test
// or a parent ref — a footgun worth naming out of existence.
const applyDiscount = () => {
	if (!intent.value.ok) return;
	emit("apply", { mode: mode.value, value: numericDraft.value });
	open.value = false;
};

const clearDiscount = () => {
	draft.value = 0;
	emit("clear");
	open.value = false;
};

defineExpose({ mode, draft, previewTotal, warning, applyDiscount, clearDiscount });
</script>

<style scoped>
.discount-title {
	font-size: 1.05rem;
	font-weight: 600;
}

.discount-mode {
	width: 100%;
}

.discount-presets {
	display: flex;
	gap: 8px;
	margin-top: 12px;
	flex-wrap: wrap;
}

.discount-preview {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	margin-top: 18px;
	font-size: 1.05rem;
}

.discount-preview strong {
	font-size: 1.4rem;
}

.discount-warning {
	margin-top: 10px;
	font-size: 0.8rem;
	color: rgb(var(--v-theme-error));
}
</style>
