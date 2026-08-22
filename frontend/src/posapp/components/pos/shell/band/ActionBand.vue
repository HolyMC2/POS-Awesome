<template>
	<div
		class="action-band"
		:class="`action-band--${tint}`"
		:data-kind="state.kind"
		data-testid="action-band"
		:data-band-tone="state.tone"
		:data-band-value="state.value"
		:data-band-action="state.primaryAction.id"
	>
		<!-- THE number. `aria-live` because the tone carries meaning a screen
		     reader cannot see: a shortfall turning into change is the moment
		     the cashier is waiting for. -->
		<div class="action-band__figure" aria-live="polite" aria-atomic="true">
			<div class="action-band__label" data-testid="action-band-label">
				{{ __(state.labelKey, state.labelParams) }}
			</div>
			<div class="action-band__number reg-mono" data-testid="band-value">
				{{ formattedValue }}
			</div>
		</div>

		<template v-if="$slots.breakdown">
			<div class="action-band__divider" aria-hidden="true"></div>
			<div class="action-band__breakdown"><slot name="breakdown" /></div>
		</template>

		<template v-if="$slots.context">
			<div class="action-band__divider" aria-hidden="true"></div>
			<div class="action-band__context"><slot name="context" /></div>
		</template>

		<div class="action-band__spacer"></div>

		<!-- THE action. One button, and the only place in the register where a
		     saturated brand colour is allowed to appear. -->
		<button
			type="button"
			class="action-band__primary"
			data-testid="band-primary"
			:disabled="!state.primaryEnabled"
			@click="onPrimary"
		>
			<slot name="primary-icon" />
			{{ __(state.primaryAction.labelKey, primaryParams) }}
		</button>
	</div>
</template>

<script setup lang="ts">
/**
 * The register's bottom band (roadmap §17.7, design direction E).
 *
 * Renders exactly what `resolveBandState` returned: one number, one action.
 * The component makes no decision about WHICH number — that would put the
 * invariant in two places at once. It only formats, tints and emits.
 *
 * The breakdown and context columns are slots because they differ per screen
 * (subtotal/IVA on a sale, denominations on a close, tender chips on a
 * charge) while the number and the button never do. Secondary figures live
 * there at 12.5px; the 60px figure is reserved.
 *
 * The root publishes its state as DATA ATTRIBUTES, not only as classes, so the
 * e2e and screenshot lane can select deterministically. That also makes the
 * invariant assertable from outside: counting `[data-testid="band-value"]` and
 * `[data-testid="band-primary"]` on a live page must give exactly one of each.
 * `bandState.ts` guarantees only one CAN be produced; a pure function cannot
 * stop a second band being mounted elsewhere, and the DOM count can.
 *
 * Tone changes swap a class and inherited custom properties only — nothing
 * here reads layout (`offsetWidth`, `getBoundingClientRect`), because the band
 * sits on the payment-open path that §6 budgets at ≤150 ms p95.
 */
import { computed } from "vue";

import { type BandState, tintForTone } from "../../../../composables/pos/shell/bandState";

const props = withDefaults(
	defineProps<{
		state: BandState;
		/** Injected so the band inherits the tenant's currency and precision. */
		formatCurrency?: (_value: number) => string;
	}>(),
	{ formatCurrency: undefined },
);

const emit = defineEmits<{ (_event: "primary", _actionId: string): void }>();

/** Named rather than an inline `$emit`: in `<script setup>` the template's
 *  `$emit` is not bound on the setup proxy, so the inline form compiles but
 *  never fires — the click just falls through as a native event. */
const onPrimary = () => emit("primary", props.state.primaryAction.id);

/**
 * Mirrors `frappe-shim`'s `__`: look up, then substitute `{0}`-style args by
 * index. The fallback interpolates too — a fallback that dropped the args
 * would render a literal "{0}" on screen for however long the shim takes to
 * attach, which is exactly the bug frappe-shim's own comment records fixing.
 */
const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const tint = computed(() => tintForTone(props.state.tone));

const formattedValue = computed(() => {
	const { value } = props.state;
	if (props.formatCurrency) return props.formatCurrency(value);
	// Standalone fallback so the band renders in isolation (tests, Storybook-
	// style harnesses) without dragging the whole pos-data graph in.
	return value.toLocaleString("es-MX", {
		style: "currency",
		currency: "MXN",
		minimumFractionDigits: 2,
	});
});

/**
 * A CTA that names its amount ("DEVOLVER $149.00") gets it formatted the same
 * way the figure above is, or the two disagree on the same screen.
 */
const primaryParams = computed(() =>
	props.state.primaryAction.labelParams?.map((param) =>
		typeof param === "number" ? formattedValue.value : param,
	),
);
</script>

<style scoped>
/* Every custom property below carries its artboard value as a fallback, so
 * the band is correct even if styles/register-tokens.css has not been wired
 * into the entry yet. A band that renders with an unset height is a blank
 * lane where the total should be — worth the duplication. */
.action-band {
	display: flex;
	align-items: center;
	flex: none;
	height: var(--reg-band-height, 134px);
	padding: 0 var(--reg-band-pad-x, 22px);
	gap: var(--reg-band-gap, 22px);
	border-radius: var(--reg-radius-md, 14px);
	border: 1px solid var(--reg-tone-neutral-border, rgba(0,0,0,.06));
	background: var(--reg-tone-neutral-bg, #ffffff);
	box-shadow: 0 1px 2px rgba(16, 20, 30, 0.05);
}

.action-band__figure {
	flex: none;
	min-width: 0;
}

.action-band__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #8b93a0);
}

.action-band__number {
	font-size: var(--reg-band-number-size, 60px);
	font-weight: 700;
	letter-spacing: var(--reg-band-number-tracking, -0.035em);
	line-height: var(--reg-band-number-leading, 1.06);
	margin-top: var(--reg-space-2xs, 2px);
	white-space: nowrap;
	color: var(--reg-tone-neutral-number, #212121);
}

.action-band__divider {
	width: 1px;
	height: var(--reg-band-divider-height, 88px);
	flex: none;
	background: var(--reg-tone-neutral-divider, #eceff3);
}

.action-band__breakdown,
.action-band__context {
	flex: none;
	font-size: 12.5px;
}

.action-band__spacer {
	flex: 1;
}

/* The one accent. Nothing else in the register may claim it. */
.action-band__primary {
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--reg-space-md, 10px);
	height: var(--reg-band-action-height, 92px);
	min-height: var(--reg-touch-min, 44px);
	padding: 0 34px;
	border: 0;
	border-radius: var(--reg-radius-md, 14px);
	cursor: pointer;
	font-family: inherit;
	font-size: var(--reg-band-action-size, 22px);
	font-weight: 700;
	letter-spacing: 0.01em;
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #ffffff);
	box-shadow: 0 14px 30px -14px var(--reg-accent, #0097a7);
}

.action-band__primary:active:not(:disabled) {
	background: var(--reg-accent-pressed, #00838f);
}

/* Disabled loses the accent entirely rather than fading it: a washed-out
 * teal still reads as "the button", and the cashier presses it anyway. */
.action-band__primary:disabled {
	background: var(--reg-tone-neutral-divider, #eceff3);
	color: var(--reg-tone-neutral-label, #8b93a0);
	box-shadow: none;
	cursor: not-allowed;
}

.action-band__primary:focus-visible {
	outline: 3px solid var(--reg-accent-pressed, #00838f);
	outline-offset: 2px;
}

/* ---- tone tints -----------------------------------------------------
 * Only the surface, the caption and the figure change. The button is
 * untouched by tone on purpose — state must never move the accent. */
.action-band--positive {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	border-color: var(--reg-tone-positive-border, #cdead8);
}
.action-band--positive .action-band__label {
	color: var(--reg-tone-positive-label, #1b5e20);
}
.action-band--positive .action-band__number {
	color: var(--reg-tone-positive-number, #157a48);
}
.action-band--positive .action-band__divider {
	background: var(--reg-tone-positive-divider, #cdead8);
}

.action-band--warning {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border-color: var(--reg-tone-warning-border, #f0dcae);
}
.action-band--warning .action-band__label {
	color: var(--reg-tone-warning-label, #8a5a0d);
}
.action-band--warning .action-band__number {
	color: var(--reg-tone-warning-number, #8a5a0d);
}
.action-band--warning .action-band__divider {
	background: var(--reg-tone-warning-divider, #f0dcae);
}

/* Below the two-column boundary the band keeps its lane but gives up the
 * fixed height — a 134px band on a 844px phone is a sixth of the screen. */
@media (max-width: 1099px) {
	.action-band {
		height: auto;
		min-height: var(--reg-touch-min, 44px);
		padding: var(--reg-space-md, 10px) var(--reg-space-lg);
		gap: var(--reg-space-lg);
		flex-wrap: wrap;
	}

	.action-band__number {
		font-size: 34px;
	}

	.action-band__primary {
		height: 56px;
		font-size: 17px;
		padding: 0 22px;
	}
}
</style>
