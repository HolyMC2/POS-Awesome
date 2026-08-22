<template>
	<div class="pay-head" data-testid="pay-readiness-header">
		<button
			type="button"
			class="pay-head__back"
			data-testid="pay-back-to-sale"
			@click="emit('back')"
		>
			<span aria-hidden="true" class="pay-head__chevron">‹</span>
			{{ __("Back to sale") }}
		</button>

		<div class="pay-head__spacer"></div>

		<!-- Chips only where there is evidence. `resolveHardwareReadiness`
		     returns an empty list when the register knows nothing, and an empty
		     list renders an empty row rather than a grey "unknown" chip — a
		     chip that is always there and never means anything is how an
		     operator learns to stop reading the row. -->
		<span
			v-for="chip in readiness.chips"
			:key="chip.id"
			class="pay-head__chip"
			:class="`pay-head__chip--${chip.state}`"
			:data-testid="`pay-readiness-${chip.id}`"
			:data-state="chip.state"
			>{{ label(chip) }}</span
		>
	</div>
</template>

<script setup lang="ts">
/**
 * The payment screen's header: the way back to the cart, and the three devices
 * that can fail while the customer is standing there (§12 item B).
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY. `Cobro.dc.html` also draws the ticket
 * folio and `Doco Ventas · Caja 2 · Jenni` here. The navbar's status line
 * already states both on every screen of the register — that is what
 * `registerStatusLine.ts` is — and restating them one row below is the same
 * duplication `registerSaysItOnceSource.spec.ts` was written to stop. The
 * artboard drew a standalone screen; ours has a navbar above it.
 *
 * The back affordance is presentation over a path that already exists:
 * `Payments.vue`'s `cancel_payment()` leaves the payment view with the sale
 * ALIVE and lands on the cart. It has always been there, wearing a red
 * "Cancel Payment" label at the bottom of the action column, which reads like
 * voiding a sale rather than stepping back from it. This is the same call with
 * the artboard's affordance; the label change on the existing button is in the
 * report, not made here.
 */
import { computed } from "vue";

import {
	resolveHardwareReadiness,
	type HardwareReadinessInput,
	type ReadinessChip,
} from "./hardwareReadiness";

const props = withDefaults(
	defineProps<{
		hardware?: HardwareReadinessInput | null;
	}>(),
	{ hardware: null },
);

const emit = defineEmits<{ (_e: "back"): void }>();

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

const readiness = computed(() => resolveHardwareReadiness(props.hardware));

/** `{0}`-style interpolation, the same shape the status line strip uses. */
const label = (chip: ReadinessChip): string => {
	const translated = __(chip.labelKey);
	const params = chip.labelParams ?? [];
	return params.reduce<string>(
		(text, value, index) => text.replace(`{${index}}`, String(value)),
		translated,
	);
};
</script>

<style scoped>
.pay-head {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	flex-wrap: wrap;
	padding: 0 0 var(--reg-space-md, 10px);
}

.pay-head__spacer {
	flex: 1 1 auto;
}

.pay-head__back {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	/* 44px is the §5 touch minimum; the artboard's 34px chrome is a mouse
	   target and this register runs on tablets. */
	min-height: 44px;
	padding: 0 12px;
	border: 1px solid var(--reg-border-soft, #e2e6ec);
	border-radius: var(--reg-radius-sm, 9px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #4a5260);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.pay-head__chevron {
	font-size: 18px;
	line-height: 1;
}

.pay-head__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 500;
	white-space: nowrap;
}

/* Green and amber are STATE (§17.7 invariant 2). The saturated accent stays
   on the primary button, which on this screen is the one taking the money. */
.pay-head__chip--ready {
	background: var(--reg-tone-positive-bg, #e8f5e8);
	color: #1b5e20;
}

.pay-head__chip--attention {
	background: var(--reg-tone-warning-bg, #fdf3df);
	color: var(--reg-tone-warning-label, #8a5a0d);
}
</style>
