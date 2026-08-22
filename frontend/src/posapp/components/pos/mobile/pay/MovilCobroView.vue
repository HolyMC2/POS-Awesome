<template>
	<section class="movil-cobro" data-testid="movil-cobro">
		<header class="movil-cobro__head">
			<div class="movil-cobro__ident">
				<p v-if="title" class="movil-cobro__title reg-mono" data-testid="movil-cobro-title">
					{{ title }}
				</p>
				<p v-if="customerName" class="movil-cobro__customer" data-testid="movil-cobro-customer">
					{{ customerName }}
				</p>
			</div>
			<!--
				Chips only where there is evidence. `resolveHardwareReadiness`
				returns an empty list when the register knows nothing, and an
				empty list renders nothing at all — a chip that is always there
				and never means anything is how an operator learns to stop
				reading the row.
			-->
			<span
				v-for="chip in readiness.chips"
				:key="chip.id"
				class="movil-cobro__chip"
				:class="`movil-cobro__chip--${chip.state}`"
				:data-testid="`movil-readiness-${chip.id}`"
				:data-state="chip.state"
				>{{ readinessLabel(chip) }}</span
			>
		</header>

		<ChangeToHand :totals="totals" :format-currency="formatCurrency" />

		<section v-if="chips.length" class="movil-cobro__card" data-testid="movil-tender-row">
			<h2 class="movil-cobro__label">{{ __("Payment method") }}</h2>
			<div class="movil-cobro__tenders">
				<button
					v-for="chip in chips"
					:key="chip.mode"
					type="button"
					class="movil-cobro__tender"
					:class="{ 'movil-cobro__tender--on': chip.mode === armed }"
					:data-testid="`movil-tender-${chip.mode}`"
					:data-armed="chip.mode === armed ? 'true' : 'false'"
					:aria-pressed="chip.mode === armed"
					@click="pickTender(chip.mode)"
				>
					{{ chip.mode }}
				</button>
			</div>
		</section>

		<div class="movil-cobro__card movil-cobro__pad">
			<PayKeypad
				:entry="entry"
				:minor-per-major="totals.minorPerMajor"
				:display-label="keyedLabel"
				:split-enabled="splitEnabled"
				@update:entry="entry = $event"
				@split="onSplit"
			/>
		</div>

		<div class="movil-cobro__card movil-cobro__close">
			<div class="movil-cobro__promises">
				<span
					v-for="promise in promises"
					:key="promise.key"
					class="movil-cobro__promise"
					:data-testid="`movil-promise-${promise.key}`"
					>{{ __(promise.labelKey) }}</span
				>
				<span v-if="pieceLabel" class="movil-cobro__promise" data-testid="movil-promise-pieces">{{
					pieceLabel
				}}</span>
			</div>

			<button
				type="button"
				class="movil-cobro__primary"
				data-testid="movil-collect"
				:disabled="!canCollect"
				@click="onCollect"
			>
				{{ __("COLLECT AND CLOSE") }}
			</button>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * The phone's payment screen — `MovilCobro.dc.html` (build plan §12 G).
 *
 * ⚠ MONEY PATH, AND THIS FILE STAYS OUT OF IT. Every peso on this screen is
 * either a prop or a rendering of one. It captures an amount on a keypad and
 * emits it; it does not write a payment row, choose an account, round a total,
 * decide whether the sale may close, or submit anything. `Payments.vue` still
 * does all of that and was not touched — the wiring that hands this screen its
 * figures and takes its intents back is in this task's report, one call site
 * at a time, rather than made here.
 *
 * WHAT IT REUSES, RATHER THAN RE-DECIDING:
 *
 *  - `closing/denominations.ts` for what the drawer holds, through
 *    `changeBreakdown.ts`. One table, counted in the corte and dispensed here.
 *  - `payments/hardwareReadiness.ts` for the printer and terminal chips,
 *    including its rule that an unverifiable claim is not rendered as ready.
 *  - `invoice/tenderChips.ts` and `invoice/armedTender.ts` for the tender the
 *    cashier armed back on the sale screen. `revalidateArmedTender` runs on
 *    mount, so a pick that has gone stale — the profile reloaded, the method
 *    was withdrawn — resolves to nothing armed rather than being resurrected
 *    onto a Mode of Payment the register can no longer honour.
 *
 * WHAT IT DOES NOT RENDER. No dock: the mobile shell owns that, and this
 * screen stops short of it exactly as `MobileOfflineOverlay` does. No sale
 * summary either — `PaymentSaleSummary` is the desktop Cobro's line-by-line
 * card, and on a 390 px screen the keypad is what the fold is spent on.
 *
 * The single accent (§17.7 invariant 2) is on `COBRAR Y CERRAR`. Green and
 * amber on the change card are STATE; the accent's pale wash frames the tender
 * chip and the amount display, which is what the canvas does with it too.
 */
import { computed, ref, watch } from "vue";

import {
	resolveHardwareReadiness,
	type HardwareReadinessInput,
	type ReadinessChip,
} from "../../payments/hardwareReadiness";
import { armTender, revalidateArmedTender } from "../../invoice/armedTender";
import {
	mixedIsAvailable,
	resolveTenderChips,
	type TenderContext,
	type TenderProfile,
} from "../../invoice/tenderChips";
import { denominationsFor, minorToMajor } from "../../closing/denominations";
import ChangeToHand from "./ChangeToHand.vue";
import PayKeypad from "./PayKeypad.vue";
import { EMPTY_ENTRY, entryMinor } from "./keypadEntry";
import { resolvePayTotals, splitIsAvailable } from "./payTotals";

export interface CollectionIntent {
	/** The armed `mode_of_payment`, or null when nothing is armed. */
	mode: string | null;
	/** Major units, for the payment path's own fields. */
	amount: number;
	/** The same figure, exact, for anything that would rather not re-parse it. */
	amountMinor: number;
}

const props = withDefaults(
	defineProps<{
		/** `Cobro · B-04812`. Rendered only when the host passes it. */
		title?: string;
		customerName?: string;
		/** The invoice total, major units, as the register computes it. */
		total?: number;
		/** Already committed to payment lines, major units. */
		tendered?: number;
		currency?: string | null;
		formatCurrency: (_value: number) => string;
		/** The POS Profile — `payments` is the only table read. */
		profile?: TenderProfile | null;
		cartHasItems?: boolean;
		isReturn?: boolean;
		hardware?: HardwareReadinessInput | null;
		/** What closing this sale will do. Each renders only when true. */
		printsTicket?: boolean;
		stampsCfdi?: boolean;
		sendsWhatsapp?: boolean;
		itemCount?: number;
		/**
		 * Whether the register will accept this collection. Defaults to FALSE:
		 * enabling the button is an authorisation decision and it belongs to
		 * the payment path, which already owns one. A screen wired to nothing
		 * refuses rather than promising.
		 */
		canCollect?: boolean;
	}>(),
	{
		title: "",
		customerName: "",
		total: 0,
		tendered: 0,
		currency: null,
		profile: null,
		cartHasItems: true,
		isReturn: false,
		hardware: null,
		printsTicket: false,
		stampsCfdi: false,
		sendsWhatsapp: false,
		itemCount: 0,
		canCollect: false,
	},
);

const emit = defineEmits<{
	(_event: "update:tender", _mode: string | null): void;
	(_event: "split", _intent: CollectionIntent): void;
	(_event: "collect", _intent: CollectionIntent): void;
}>();

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

/** The keypad buffer. A string, not a number — see `keypadEntry.ts`. */
const entry = ref<string>(EMPTY_ENTRY);

/**
 * The currency's own shape, read once from the same table the corte counts —
 * so nothing on this screen has to assume two decimals.
 */
const minorPerMajor = computed(() => denominationsFor(props.currency).minorPerMajor);

/** The pad's amount, exact, in minor units. */
const keyedMinor = computed(() => entryMinor(entry.value, minorPerMajor.value));
const keyedLabel = computed(() =>
	props.formatCurrency(minorToMajor(keyedMinor.value, minorPerMajor.value)),
);

const totals = computed(() =>
	resolvePayTotals({
		total: props.total,
		tendered: props.tendered,
		keyedMinor: keyedMinor.value,
		currency: props.currency,
	}),
);

const readiness = computed(() => resolveHardwareReadiness(props.hardware));

/** `{0}`-style interpolation, the same shape the desktop header uses. */
const readinessLabel = (chip: ReadinessChip): string =>
	(chip.labelParams ?? []).reduce<string>(
		(text, value, index) => text.replace(`{${index}}`, String(value)),
		__(chip.labelKey),
	);

const chips = computed(() => resolveTenderChips(props.profile));
const context = computed<TenderContext>(() => ({
	cartHasItems: props.cartHasItems,
	isReturn: props.isReturn,
}));

/** What the sale screen armed, re-run through the same guard that set it. */
const armed = ref<string | null>(null);

watch(
	[chips, context],
	() => {
		// Re-validating rather than reading: the world may have changed between
		// the chip strip and this screen, and `resolveArmedTender` returns null
		// for a pick the register can no longer honour. Nothing lights up, and
		// the cashier is asked to choose again — which beats opening on a Mode
		// of Payment nobody selected.
		armed.value = revalidateArmedTender(chips.value, context.value);
	},
	{ immediate: true },
);

const pickTender = (mode: string): void => {
	// Tapping the lit chip deselects, which is what MIXED is: no pre-arm, and
	// the payment path opens with every method listed exactly as it does today.
	// A register with one tender has nothing to mix, so its chip does not
	// deselect.
	const next = mode === armed.value && mixedIsAvailable(chips.value) ? null : mode;
	armed.value = armTender(next, chips.value, context.value);
	emit("update:tender", armed.value);
};

const splitEnabled = computed(() =>
	splitIsAvailable({
		totals: totals.value,
		keyedMinor: keyedMinor.value,
		hasArmedTender: armed.value !== null,
		multipleTenders: mixedIsAvailable(chips.value),
	}),
);

const intent = (): CollectionIntent => ({
	mode: armed.value,
	amount: minorToMajor(keyedMinor.value, minorPerMajor.value),
	amountMinor: keyedMinor.value,
});

/**
 * `Dividir pago` closes the current tender at the keyed amount and re-opens
 * the pad for the next one. It divides nothing itself — the register does not
 * guess how a customer wants to split — and it writes nothing: the host
 * records the part-payment through the path it already uses, and the raised
 * `tendered` comes back as a prop.
 */
const onSplit = (): void => {
	if (!splitEnabled.value) return;
	emit("split", intent());
	entry.value = EMPTY_ENTRY;
};

const onCollect = (): void => {
	if (!props.canCollect) return;
	emit("collect", intent());
};

const promises = computed(() =>
	[
		{ key: "print", labelKey: "Prints ticket", on: props.printsTicket },
		{ key: "cfdi", labelKey: "Stamp CFDI", on: props.stampsCfdi },
		{ key: "whatsapp", labelKey: "Send by WhatsApp", on: props.sendsWhatsapp },
	].filter((promise) => promise.on),
);

const pieceLabel = computed(() =>
	props.itemCount > 0 ? `${props.itemCount} ${__("pcs")}` : "",
);
</script>

<style scoped>
.movil-cobro {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	min-height: 0;
	padding: var(--reg-space-md, 10px) 11px;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.movil-cobro__head {
	display: flex;
	align-items: center;
	gap: 9px;
	flex-wrap: wrap;
	padding: 3px 3px 0;
}

.movil-cobro__ident {
	flex: 1 1 auto;
	min-width: 0;
	line-height: 1.15;
}

.movil-cobro__title {
	margin: 0;
	font-size: 12px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-cobro__customer {
	margin: 0;
	font-size: 9.5px;
	/* Forwarded, not the artboard's #9aa2ae: that literal measures 2.4:1 on
	   this surface and A1 already replaced its twin in the token layer. */
	color: var(--reg-text-muted, #667085);
}

.movil-cobro__chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 8px;
	font-size: 11px;
	font-weight: 500;
	white-space: nowrap;
}

.movil-cobro__chip--ready {
	background: var(--reg-tone-positive-bg, #e8f5e8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.movil-cobro__chip--attention {
	background: var(--reg-tone-warning-bg, #fdf3df);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.movil-cobro__card {
	border-radius: var(--reg-radius-md, 12px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #fff);
	padding: 11px;
}

.movil-cobro__pad {
	flex: 1 1 auto;
	min-height: 0;
}

.movil-cobro__close {
	padding: 11px 13px;
}

.movil-cobro__label {
	margin: 0 0 8px;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.movil-cobro__tenders {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
	gap: 7px;
}

.movil-cobro__tender {
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
	/* §5 touch minimum. The artboard's 52px already clears it; the token is
	   here so a density pass cannot quietly drop below 44. */
	min-height: max(52px, var(--reg-touch-min, 44px));
	padding: 0 6px;
	border-radius: 11px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 10.5px;
	font-weight: 500;
	cursor: pointer;
	touch-action: manipulation;
}

/* Armed: the accent as an EDGE and a wash, never as a fill. The saturated
   fill is spent once per screen and this screen spends it on COBRAR Y CERRAR
   (§17.7 invariant 2). */
.movil-cobro__tender--on {
	border: 2px solid var(--reg-accent, #0097a7);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.movil-cobro__promises {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.movil-cobro__promise {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 8px;
	background: var(--reg-tone-positive-bg, #f0fbf4);
	color: var(--reg-tone-positive-label, #14603a);
	font-size: 11px;
	font-weight: 500;
	white-space: nowrap;
}

.movil-cobro__primary {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 9px;
	width: 100%;
	margin-top: 11px;
	min-height: 54px;
	border: 0;
	border-radius: var(--reg-radius-md, 12px);
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #fff);
	font: inherit;
	font-size: 16px;
	font-weight: 700;
	cursor: pointer;
	touch-action: manipulation;
}

/* Disabled DROPS the accent rather than fading it — the same rule
   `ActionBand.vue` follows, so a register that cannot take money does not
   render a button that looks like it can. */
.movil-cobro__primary:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: default;
}
</style>
