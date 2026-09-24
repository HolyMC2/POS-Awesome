<template>
	<v-dialog
		:model-value="modelValue"
		v-bind="dialogProps"
		scrollable
		persistent
		@update:model-value="emit('update:modelValue', $event)"
	>
		<v-card class="credit-after" data-testid="credit-after-sale">
			<header class="credit-after__head">
				<h2 class="credit-after__title">{{ __("Credit sale recorded") }}</h2>
				<button
					type="button"
					class="credit-after__close"
					:aria-label="__('Close')"
					data-testid="credit-after-close"
					@click="close"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
					</svg>
				</button>
			</header>

			<div class="credit-after__body">
				<CreditSaleDetail
					v-if="invoice"
					:key="invoice"
					:invoice="invoice"
					mode="after-sale"
					@loaded="sale = $event"
					@changed="sale = $event"
					@print="emit('print', $event)"
					@close="close"
				/>
			</div>

			<footer class="credit-after__footer">
				<p v-if="paperworkPending" class="credit-after__note" data-testid="credit-after-pending">
					{{ __("The sale stays in Credit sales → Pending until its documents are complete.") }}
				</p>
				<button type="button" class="credit-after__primary" data-testid="credit-after-done" @click="close">
					{{ paperworkPending ? __("Finish later") : __("Done") }}
				</button>
			</footer>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * «Credit sale recorded»: the sheet the register raises right after a
 * provider-financed sale is charged, while the customer is still at the
 * counter — the paperwork checklist first, then the expenses and the plan.
 *
 * Nothing here is required to leave: paperwork that is still missing keeps the
 * sale in Credit sales → Pending, and the footer says so before the cashier
 * closes it.
 */
import { computed, ref, watch } from "vue";

import CreditSaleDetail from "./CreditSaleDetail.vue";
import type { CreditSale } from "./creditApi";
import { translate as __ } from "./creditFormat";
import { BREAKPOINTS } from "../../../constants/breakpoints";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";

const props = defineProps<{
	modelValue: boolean;
	invoice: string | null;
}>();

const emit = defineEmits<{
	"update:modelValue": [boolean];
	/** Reprint the down-payment ticket of this invoice. */
	print: [string];
}>();

const { dialogProps } = useDialogFullscreen({ breakpoint: BREAKPOINTS.compact, maxWidth: 760 });

const sale = ref<CreditSale | null>(null);

const paperworkPending = computed(() => Boolean(sale.value && !sale.value.documents?.complete));

const close = () => emit("update:modelValue", false);

watch(
	() => props.invoice,
	() => {
		sale.value = null;
	},
);
</script>

<style scoped>
.credit-after {
	display: flex;
	flex-direction: column;
	max-height: 100%;
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	border-radius: var(--reg-radius-lg);
}

.credit-after__head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--reg-space-md);
	padding: var(--reg-space-lg) var(--reg-space-lg) var(--reg-space-md);
	border-bottom: 1px solid var(--reg-divider-soft);
}

.credit-after__title {
	margin: 0;
	align-self: center;
	font-size: 20px;
	line-height: 1.25;
}

.credit-after__close {
	display: inline-grid;
	place-items: center;
	flex: none;
	width: var(--reg-touch-min);
	height: var(--reg-touch-min);
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: var(--reg-text-secondary);
	cursor: pointer;
}

.credit-after__body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: var(--reg-space-lg);
}

.credit-after__footer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: var(--reg-space-md);
	padding: var(--reg-space-md) var(--reg-space-lg);
	border-top: 1px solid var(--reg-divider-soft);
}

.credit-after__note {
	flex: 1 1 260px;
	margin: 0;
	font-size: 13px;
	color: var(--reg-tone-warning-label);
}

.credit-after__primary {
	min-height: var(--reg-touch-min);
	min-width: 160px;
	padding: 0 var(--reg-space-xl);
	border: 1px solid var(--reg-accent);
	border-radius: var(--reg-radius-md);
	background: var(--reg-accent);
	color: var(--reg-on-accent);
	font: inherit;
	font-size: 15px;
	font-weight: 700;
	cursor: pointer;
	transition: transform var(--motion-fast) var(--ease-out);
}

.credit-after__primary:active {
	transform: scale(var(--press-scale));
}

.credit-after :is(button):focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}

@media (max-width: 599.98px) {
	.credit-after__primary {
		flex: 1 1 100%;
	}
}

@media (prefers-reduced-motion: reduce) {
	.credit-after__primary {
		transition: none;
	}
}
</style>
