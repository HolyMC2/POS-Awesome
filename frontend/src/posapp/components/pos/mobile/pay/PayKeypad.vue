<template>
	<div class="pay-keypad">
		<!--
			The amount being keyed. A live region rather than an input: the pad
			IS the input, and a real <input> here would summon the phone's own
			keyboard over a keypad the register already drew.
		-->
		<output
			class="pay-keypad__display reg-mono"
			data-testid="movil-keyed-amount"
			data-money-role="keyed"
			:aria-label="__('Amount received from customer')"
			aria-live="polite"
			>{{ displayLabel }}</output
		>

		<div class="pay-keypad__grid" role="group" :aria-label="__('Numeric keypad')">
			<button
				v-for="button in layout"
				:key="button.key"
				type="button"
				class="pay-keypad__key"
				:class="[`pay-keypad__key--${button.kind}`, spanClass(button)]"
				:data-testid="`movil-key-${button.key}`"
				:data-key="button.key"
				:disabled="button.key === 'split' && !splitEnabled"
				:aria-label="ariaLabel(button)"
				@click="press(button.key)"
			>
				{{ button.translate ? __(button.label) : button.label }}
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * The phone's numeric keypad (artboard `MovilCobro.dc.html`).
 *
 * Fourteen targets, and this is the most-tapped surface in the product — every
 * cash sale on a phone register goes through it. So every key clears the 44 px
 * touch minimum under `pointer: coarse`, which is a bigger key than the
 * artboard's 42 px: the artboard is drawn at a nominal 390 px and the rule in
 * §5 is about thumbs, not about pixels on a mock.
 *
 * Composition lives in `keypadEntry.ts` and the layout comes from the same
 * module, so the grid the cashier taps and the grid the spec counts are one
 * list. This component holds no arithmetic: it emits the entry the module
 * returns, and the screen above converts it to money.
 */
import { computed } from "vue";

import {
	KEYPAD_LAYOUT,
	applyKeypadKey,
	type KeypadButton,
	type KeypadKey,
} from "./keypadEntry";

const props = defineProps<{
	/** The raw entry buffer, owned by the screen. */
	entry: string;
	/** Minor units per major, so the pad knows how many decimals to accept. */
	minorPerMajor: number;
	/** What the entry currently comes to, already formatted by the screen. */
	displayLabel: string;
	/** `splitIsAvailable(...)`, decided one level up where the totals live. */
	splitEnabled: boolean;
}>();

const emit = defineEmits<{
	(_event: "update:entry", _entry: string): void;
	(_event: "split"): void;
}>();

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

const layout = computed<readonly KeypadButton[]>(() => KEYPAD_LAYOUT);

const spanClass = (button: KeypadButton): string[] => {
	const classes: string[] = [];
	if (button.rowSpan === 2) classes.push("pay-keypad__key--tall");
	if (button.colSpan === 2) classes.push("pay-keypad__key--wide");
	return classes;
};

/**
 * A digit announces itself; the worded keys already read correctly. `.` is the
 * exception — a lone full stop is announced as punctuation or skipped, and the
 * decimal separator is the one key a cashier cannot afford to miss.
 */
const ariaLabel = (button: KeypadButton): string | undefined =>
	button.key === "." ? __("Decimal point") : undefined;

const press = (key: KeypadKey): void => {
	if (key === "split") {
		// Guarded by `:disabled` as well; a disabled button cannot emit, and
		// the second check is here because the screen's rule — not this
		// component's styling — is what decides whether a split is possible.
		if (props.splitEnabled) emit("split");
		return;
	}
	emit("update:entry", applyKeypadKey(props.entry, key, props.minorPerMajor));
};
</script>

<style scoped>
.pay-keypad {
	display: flex;
	flex-direction: column;
	gap: 11px;
}

.pay-keypad__display {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	min-height: 52px;
	padding: 0 var(--reg-space-lg, 14px);
	border-radius: 11px;
	/* A 2px edge in the accent's PALE derivative, not the saturated accent —
	   the wash is a surface the canvas uses freely (tender chips, keypad
	   frame); invariant 2 is about one saturated colour competing for the eye,
	   and on this screen it is spent on COBRAR Y CERRAR. */
	border: 2px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-size: 28px;
	font-weight: 700;
	letter-spacing: -0.02em;
}

.pay-keypad__grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 7px;
}

.pay-keypad__key {
	display: grid;
	place-items: center;
	/* 44px is the §5 touch minimum. The artboard's 42px is a mouse-era
	   rounding and this pad is thumbs only. */
	min-height: var(--reg-touch-min, 44px);
	border-radius: var(--reg-radius-sm, 10px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 19px;
	font-weight: 500;
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
	touch-action: manipulation;
}

/* Twelve digits and two worded keys is a lot of finger travel on a small
   phone; on a real touch device the keys grow rather than the gaps. */
@media (pointer: coarse) {
	.pay-keypad__key {
		min-height: 52px;
	}
}

.pay-keypad__key--edit {
	background: var(--reg-surface-muted, #f7f8fa);
	color: var(--reg-text-muted, #667085);
	font-size: 12px;
}

.pay-keypad__key--action {
	background: var(--reg-accent-soft, #e0f7fa);
	border-color: var(--reg-accent-edge, #9fdde6);
	color: var(--reg-on-accent-soft, #00646f);
	font-size: 12.5px;
	font-weight: 700;
	line-height: 1.15;
	padding: 0 4px;
	text-align: center;
}

.pay-keypad__key--action:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	border-color: var(--reg-border-soft, #e6e9ee);
	color: var(--reg-text-muted, #667085);
	cursor: default;
}

.pay-keypad__key--tall {
	grid-row: span 2;
}

.pay-keypad__key--wide {
	grid-column: span 2;
}

.pay-keypad__key:active {
	background: var(--reg-surface-muted, #f2f4f7);
}
</style>
