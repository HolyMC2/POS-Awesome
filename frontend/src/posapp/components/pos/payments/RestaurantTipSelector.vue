<template>
	<section class="restaurant-tip" data-test="restaurant-tip-row">
		<div class="restaurant-tip__choices">
			<strong>{{ label }}</strong>
			<v-btn
				v-for="percent in [10, 15, 20]"
				:key="percent"
				size="small"
				:variant="choice === String(percent) ? 'flat' : 'tonal'"
				color="primary"
				@click="choosePercent(percent)"
			>
				{{ percent }}%
			</v-btn>
			<v-btn
				size="small"
				:variant="choice === 'other' ? 'flat' : 'tonal'"
				color="primary"
				@click="chooseOther"
			>
				Otro
			</v-btn>
			<v-btn
				size="small"
				:variant="choice === 'none' ? 'flat' : 'tonal'"
				color="secondary"
				@click="chooseNone"
			>
				Sin
			</v-btn>
		</div>
		<v-text-field
			v-if="choice === 'other'"
			data-pos-keyboard-target="payment-amount"
			density="compact"
			variant="solo"
			class="pos-themed-input"
			:label="label"
			:prefix="currencySymbol"
			:model-value="modelValue || ''"
			inputmode="decimal"
			hide-details
			@input="setOther"
		/>
		<div v-if="modelValue > 0" class="restaurant-tip__preview" data-test="tip-preview-line">
			<span>{{ label }}</span>
			<strong>{{ formatCurrency(modelValue) }}</strong>
		</div>
	</section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { restaurantTipFromPercent } from "../../../utils/restaurantTips";

const props = defineProps<{
	modelValue: number;
	orderTotal: number;
	label: string;
	formatCurrency: (value: number) => string;
	currencySymbol: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const choice = ref("none");
const choosePercent = (percent: number) => {
	choice.value = String(percent);
	emit("update:modelValue", restaurantTipFromPercent(props.orderTotal, percent));
};
const chooseOther = () => {
	choice.value = "other";
	emit("update:modelValue", 0);
};
const chooseNone = () => {
	choice.value = "none";
	emit("update:modelValue", 0);
};
watch(
	() => props.modelValue,
	(value) => {
		// Parent resets the tip to 0 on sheet open/close — clear the local
		// selection too, or a reopened sheet shows "15%" highlighted over an
		// actual tip of 0 (spec §4: never pre-select). "other" is exempt:
		// choosing Otro legitimately emits 0 before the amount is typed.
		if (!value && choice.value !== "other") choice.value = "none";
	},
);

const setOther = (event: Event) => {
	const value = Number((event.target as HTMLInputElement)?.value || 0);
	// Whole pesos like the % buttons — a fractional tip desyncs rounded_total
	// from the server's re-rounding and strands centavos on the invoice.
	emit("update:modelValue", Number.isFinite(value) ? Math.round(Math.max(value, 0)) : 0);
};
</script>

<style scoped>
.restaurant-tip {
	display: grid;
	gap: var(--pos-space-2);
	padding: var(--pos-space-3);
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md);
	background: var(--pos-surface-raised);
}
.restaurant-tip__choices,
.restaurant-tip__preview {
	display: flex;
	align-items: center;
	gap: var(--pos-space-2);
	flex-wrap: wrap;
}
.restaurant-tip__preview {
	justify-content: space-between;
}
</style>
