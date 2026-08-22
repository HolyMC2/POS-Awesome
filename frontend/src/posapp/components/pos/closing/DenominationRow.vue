<template>
	<div class="denom-row" data-testid="denomination-row" :data-face-minor="faceMinor">
		<span class="denom-row__face reg-mono" data-money-role="denomination-face">{{ faceLabel }}</span>

		<div class="denom-row__stepper">
			<button
				type="button"
				class="denom-row__step"
				data-testid="denomination-decrement"
				:aria-label="decrementLabel"
				:disabled="count <= 0"
				@click="emit('update:count', count - 1)"
			>
				−
			</button>
			<!-- A text input, not `type=number`: the spin buttons had to be
			     stripped with vendor CSS everywhere else in this dialog, and a
			     cashier counting 24 twenty-peso notes types the number rather
			     than tapping twenty-four times. -->
			<input
				class="denom-row__count reg-mono"
				data-testid="denomination-count"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				:aria-label="countLabel"
				:value="count"
				@input="onInput"
			/>
			<button
				type="button"
				class="denom-row__step"
				data-testid="denomination-increment"
				:aria-label="incrementLabel"
				@click="emit('update:count', count + 1)"
			>
				+
			</button>
		</div>

		<span
			class="denom-row__subtotal reg-mono"
			data-testid="denomination-subtotal"
			data-money-role="denomination-subtotal"
		>
			{{ subtotalLabel }}
		</span>
	</div>
</template>

<script setup lang="ts">
/**
 * One row of the drawer count: a face value, a stepper, and what that many of
 * it comes to (artboard `Corte.dc.html`).
 *
 * Presentation only. It receives formatted strings and a count, and emits a
 * count — no currency, no arithmetic, no formatter. The subtotal beside the
 * stepper is what makes the count checkable at a glance, and it is the parent's
 * derivation rendered, never a second one.
 *
 * Labels arrive as props rather than being translated here so the whole card
 * carries one `__` shim instead of three.
 */
defineProps<{
	/** Face value in minor units — the row's identity for tests and the parent. */
	faceMinor: number;
	faceLabel: string;
	subtotalLabel: string;
	count: number;
	decrementLabel: string;
	incrementLabel: string;
	countLabel: string;
}>();

const emit = defineEmits<{ (_event: "update:count", _count: number): void }>();

const onInput = (event: Event) => {
	const target = event.target as HTMLInputElement;
	// Strip rather than reject: a barcode gun or a fat finger puts a stray
	// character in the box, and refusing the whole entry loses the digits the
	// cashier did mean.
	const digits = target.value.replace(/\D/g, "");
	const next = digits ? Number(digits) : 0;
	// `:value`-bound, so a rejected character would sit on screen until the next
	// reactive write. Push the accepted value back.
	target.value = String(next);
	emit("update:count", next);
};
</script>

<style scoped>
.denom-row {
	display: grid;
	grid-template-columns: 58px 1fr 84px;
	align-items: center;
	gap: 9px;
	min-height: var(--reg-touch-min, 44px);
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.denom-row:last-child {
	border-bottom: 0;
}

.denom-row__face {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.denom-row__stepper {
	display: inline-flex;
	align-items: center;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-xs, 8px);
	background: var(--reg-surface, #ffffff);
	overflow: hidden;
}

/* 26px was the artboard's drawn height; the touch minimum wins on a tablet,
   which is what the corte is actually done on. */
.denom-row__step {
	width: 34px;
	min-height: var(--reg-touch-min, 44px);
	border: 0;
	background: transparent;
	cursor: pointer;
	font-family: inherit;
	font-size: 16px;
	color: var(--reg-text-secondary, #56606e);
}

.denom-row__step:disabled {
	color: var(--reg-text-muted, #667085);
	opacity: 0.4;
	cursor: not-allowed;
}

.denom-row__step:focus-visible,
.denom-row__count:focus-visible {
	outline: 2px solid var(--reg-text-primary, #212121);
	outline-offset: 1px;
}

.denom-row__count {
	width: 44px;
	border: 0;
	background: transparent;
	text-align: center;
	font-family: inherit;
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.denom-row__subtotal {
	text-align: right;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}
</style>
