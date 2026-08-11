<template>
	<v-dialog
		:model-value="visible"
		persistent
		:retain-focus="false"
		max-width="460"
		class="change-due-dialog"
		@update:model-value="onModelUpdate"
	>
		<v-card class="change-due-card" data-testid="change-due-card">
			<div class="change-due-body">
				<span class="change-due-label">{{ __("Change due") }}</span>
				<strong class="change-due-amount" data-testid="change-due-amount">{{
					displayAmount
				}}</strong>
			</div>
			<div class="change-due-actions">
				<v-btn
					block
					size="x-large"
					color="success"
					variant="flat"
					class="change-due-confirm"
					data-testid="change-due-confirm"
					@click="onConfirm"
					>{{ __("Change given") }}</v-btn
				>
			</div>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";

// @ts-ignore — Frappe's global translator; absent in unit tests.
const __ = window.__ || ((value: string) => value);

const props = withDefaults(
	defineProps<{
		modelValue: boolean;
		amount?: number;
		currencySymbol?: string;
		formatAmount?: (_value: number) => string;
	}>(),
	{
		amount: 0,
		currencySymbol: "",
		formatAmount: undefined,
	},
);

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
	confirm: [];
}>();

// A sale that owes nothing back has no dialog to show, whatever the parent
// asks for: the cashier's hand is already on the next order.
const visible = computed(() => props.modelValue && Number(props.amount) > 0);

// Gated on `visible` so a dialog nobody asked for never reaches into the POS
// formatter — it depends on an active profile that may not exist yet when the
// shell first mounts.
const displayAmount = computed(() => {
	if (!visible.value) {
		return "";
	}
	const value = Number(props.amount) || 0;
	const body = props.formatAmount ? props.formatAmount(value) : String(value);
	return `${props.currencySymbol || ""}${body}`;
});

// `persistent` swallows outside-click and Esc, so this only ever fires on a
// programmatic close; mirror it back so the parent stays the source of truth.
const onModelUpdate = (value: boolean) => {
	if (!value) {
		emit("update:modelValue", false);
	}
};

const onConfirm = () => {
	emit("update:modelValue", false);
	emit("confirm");
};
</script>

<style scoped>
.change-due-card {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 28px 24px 20px;
	background: var(--pos-card-bg);
	color: var(--pos-text-primary);
	border-radius: 18px;
	text-align: center;
}

.change-due-body {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	padding-bottom: 22px;
}

.change-due-label {
	font-size: 1rem;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--pos-text-secondary);
}

/* Read from a meter away — this is the number the cashier counts out of the
   drawer, so it outranks everything else on screen. Scales with the viewport
   so a phone sheet does not clip a five-figure amount. */
.change-due-amount {
	font-size: clamp(3rem, 14vw, 4.5rem);
	font-weight: 800;
	line-height: 1.05;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary);
	word-break: break-word;
}

.change-due-actions {
	display: flex;
}

.change-due-confirm {
	min-height: 56px;
	font-size: 1.05rem;
	font-weight: 700;
	letter-spacing: 0.02em;
}
</style>
