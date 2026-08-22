<template>
	<div class="movil-corte" data-testid="movil-corte">
		<header class="movil-corte__head">
			<div class="movil-corte__title">
				<div class="movil-corte__name">{{ __("Close shift") }}</div>
				<div class="movil-corte__who" data-testid="movil-corte-subtitle">{{ subtitle }}</div>
			</div>
			<span v-if="shiftOpen" class="movil-corte__chip movil-corte__chip--open" data-testid="movil-corte-status">
				{{ __("Shift open") }}
			</span>
		</header>

		<DifferenceHero
			class="movil-corte__hero"
			:state="bandState"
			:expected="expected"
			:counted="counted"
			:ratio="gate.ratio"
			:format-currency="formatMoney"
		/>

		<!-- The count scrolls; the difference above it and the action below it do
		     not. Ten steppers at the touch minimum are ~500 px of rows on a
		     390 × 844 phone, and the two things a cashier alternates between —
		     "what does the drawer say" and "what am I still missing" — must not
		     be able to leave the screen while the other is being read.

		     The artboard collapses `$5 · $2 · $1` into one row to make the card
		     fit without scrolling. We do not, and the reason is arithmetic: one
		     count over three face values cannot produce a subtotal (the drawn
		     "11 → $26" has several solutions), so that row would be an ASSERTION
		     sitting inside a card whose entire purpose is that the total is a
		     DERIVATION. Scrolling costs a gesture; collapsing costs the property.
		     Reported to the lead rather than decided silently. -->
		<div class="movil-corte__count">
			<DrawerCount
				:currency="currency"
				:expected="expected"
				:breakdown="breakdown"
				:initial-counted="initialCounted"
				:format-currency="formatMoney"
				@update:counted="onCounted"
			/>
		</div>

		<footer class="movil-corte__foot">
			<DifferenceNote
				v-model="noteText"
				:gate="gate"
				:tolerance-label="formatMoney(gate.tolerance)"
			/>

			<div class="movil-corte__chips">
				<span class="movil-corte__chip movil-corte__chip--done" data-testid="movil-corte-tickets">
					{{ __("{0} tickets uploaded", [ticketsUploaded]) }}
				</span>
				<span
					class="movil-corte__chip"
					:class="openDrafts > 0 ? 'movil-corte__chip--attention' : 'movil-corte__chip--done'"
					data-testid="movil-corte-drafts"
				>
					{{ __("{0} open drafts", [openDrafts]) }}
				</span>
			</div>

			<!-- THE one action, and the only saturated colour on this screen.
			     Named `__primary` so that when tests/singleAccent.spec.ts's scan
			     scope reaches components/pos/mobile/** it recognises this button
			     as the sanctioned accent rather than reporting it as a leak. -->
			<button
				type="button"
				class="movil-corte__primary"
				data-testid="movil-corte-primary"
				:disabled="!bandState.primaryEnabled"
				@click="onClose"
			>
				{{ __(bandState.primaryAction.labelKey, bandState.primaryAction.labelParams) }}
			</button>
		</footer>

		<!-- The dock is the mobile shell's, not this screen's — the artboard's
		     own note says the corte is reached from the menu and the dock stays
		     put so the cashier can go back. A second dock built here would be a
		     second set of tab state. -->
		<slot name="dock" />
	</div>
</template>

<script setup lang="ts">
/**
 * Counting the drawer on a phone (`MovilCorte.dc.html`, build plan §12 C + G).
 *
 * This screen INTRODUCES no arithmetic. The counted figure comes from
 * `DrawerCount` (integer minor units, `denominations.ts`), the difference comes
 * from `resolveBandState`, and the two rules the artboard drew but the app did
 * not have — the mandatory note and the share-of-sales — come from
 * `differenceNote.ts`, where the reasoning behind them is written down.
 *
 * What the close POSTS is unchanged: `DrawerCount` writes the same cash
 * `closing_amount` it writes on the desktop, and this component only forwards
 * it. The note is the one genuinely new value, and it leaves here as an event
 * because it has nowhere to land yet — POS Closing Shift has no field for it
 * (see the report's schema section).
 */
import { computed, ref, watch } from "vue";

import DrawerCount, { type ExpectedBreakdown } from "../../closing/DrawerCount.vue";
import { denominationsFor } from "../../closing/denominations";
import { resolveBandState } from "../../../../composables/pos/shell/bandState";
import DifferenceHero from "./DifferenceHero.vue";
import DifferenceNote from "./DifferenceNote.vue";
import { type NotePolicy, evaluateNoteGate } from "./differenceNote";

type CountSource = "denominations" | "manual";

const props = withDefaults(
	defineProps<{
		/** Header facts, straight off the shift — never derived here. */
		registerLabel?: string;
		cashierName?: string;
		/** Frappe datetimes, "YYYY-MM-DD HH:mm:ss". */
		periodStart?: string;
		periodEnd?: string;
		/**
		 * The opening shift is still Open — which it is for the whole life of
		 * this screen, since pressing the primary is what closes it. NOT derived
		 * from a missing `periodEnd`: `make_closing_shift_from_opening` stamps
		 * the end at *now* when the corte is prepared, so the closing doc carries
		 * one while the shift is very much still open, and the artboard draws
		 * `09:02 → 20:05` beside `Turno abierto` for exactly that reason.
		 */
		shiftOpen?: boolean;

		currency?: string;
		/** Expected cash, the server's figure. Displayed, never recomputed. */
		expected?: number;
		breakdown?: ExpectedBreakdown | null;
		initialCounted?: number | null;

		/**
		 * The shift's takings across EVERY payment mode — the artboard's "Total
		 * del turno". Not cash takings; see `differenceNote.ts` on the choice.
		 * Zero is a real answer and the card says so rather than dividing by it.
		 */
		takings?: number;

		ticketsUploaded?: number;
		openDrafts?: number;

		/** Tenant override of the note policy; defaults are argued in the module. */
		notePolicy?: Partial<NotePolicy> | null;
		/** Seeds the box when a close is resumed. */
		note?: string;

		formatCurrency?: (_value: number) => string;
	}>(),
	{
		registerLabel: "",
		cashierName: "",
		periodStart: "",
		periodEnd: "",
		shiftOpen: true,
		currency: "",
		expected: 0,
		breakdown: null,
		initialCounted: null,
		takings: 0,
		ticketsUploaded: 0,
		openDrafts: 0,
		notePolicy: null,
		note: "",
		formatCurrency: undefined,
	},
);

const emit = defineEmits<{
	(_event: "update:counted", _amount: number, _source: CountSource): void;
	(_event: "update:note", _note: string): void;
	(_event: "close-shift", _payload: { counted: number; source: CountSource; note: string }): void;
}>();

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = window.__;
	if (translate) return translate(text, args as any[]);
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const formatMoney = (value: number) => {
	if (props.formatCurrency) return props.formatCurrency(value);
	return Number(value || 0).toLocaleString("es-MX", {
		style: "currency",
		currency: props.currency || "MXN",
		minimumFractionDigits: 2,
	});
};

// ---- the header --------------------------------------------------------------

/**
 * Clock digits read straight off the Frappe string, never reformatted — the
 * value is SITE time and `new Date()` would reinterpret it as the phone's.
 * `ClosingHeader.vue` owns the desktop version of this and appends the shift's
 * duration; the phone's header is one 9.5 px line and the artboard drops the
 * duration to keep it there, so the two are not the same string.
 */
const clockOf = (value: string) => {
	const match = /(\d{1,2}):(\d{2})/.exec(String(value || ""));
	if (!match) return "";
	return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
};

const shiftSpan = computed(() => {
	const from = clockOf(props.periodStart);
	if (!from) return "";
	const to = clockOf(props.periodEnd);
	return to ? `${from} → ${to}` : from;
});

const subtitle = computed(() =>
	[props.registerLabel, props.cashierName, shiftSpan.value].filter(Boolean).join(" · "),
);

// ---- the count, the difference and the gate ----------------------------------

const counted = ref(Number(props.initialCounted) || 0);
const countSource = ref<CountSource>("denominations");

const onCounted = (amount: number, source: CountSource) => {
	counted.value = amount;
	countSource.value = source;
	emit("update:counted", amount, source);
};

const minorPerMajor = computed(() => denominationsFor(props.currency).minorPerMajor);

/**
 * `resolveBandState` is asked twice, and each call answers a different
 * question. The first asks what the difference IS — that number has exactly one
 * owner and computing `counted − expected` here would give it a second. The
 * second asks what the band should SAY once the note gate has ruled on whether
 * this shift may close. Both are pure; neither reads the other's tone.
 */
const difference = computed(
	() => resolveBandState({ kind: "closing", expected: props.expected, counted: counted.value }).value,
);

const noteText = ref(props.note);
watch(() => props.note, (seed) => {
	if (seed !== noteText.value) noteText.value = seed;
});
watch(noteText, (text) => emit("update:note", text));

const gate = computed(() =>
	evaluateNoteGate({
		difference: difference.value,
		takings: props.takings,
		note: noteText.value,
		minorPerMajor: minorPerMajor.value,
		policy: props.notePolicy || undefined,
	}),
);

const bandState = computed(() =>
	resolveBandState({
		kind: "closing",
		expected: props.expected,
		counted: counted.value,
		canClose: gate.value.canClose,
	}),
);

const onClose = () => {
	// Belt and braces: the button is disabled, and the handler refuses anyway.
	// A disabled attribute is a rendering; the gate is the rule.
	if (!gate.value.canClose) return;
	emit("close-shift", {
		counted: counted.value,
		source: countSource.value,
		note: noteText.value.trim(),
	});
};

defineExpose({ gate, bandState, difference, counted });
</script>

<style scoped>
/* No accent anywhere but `.movil-corte__primary`. The difference is STATE
   (§17.7 invariant 2) and this screen has exactly one thing to press. */
.movil-corte {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.movil-corte__head {
	display: flex;
	align-items: center;
	gap: 9px;
	flex: none;
	padding: 13px 14px 10px;
	border-bottom: 1px solid var(--reg-divider, #eceff3);
	background: var(--reg-surface, #ffffff);
}

.movil-corte__title {
	flex: 1;
	min-width: 0;
	line-height: 1.15;
}

.movil-corte__name {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.movil-corte__who {
	font-size: 9.5px;
	color: var(--reg-text-muted, #667085);
}

.movil-corte__hero {
	flex: none;
	margin: var(--reg-space-md, 10px) 11px 0;
}

.movil-corte__count {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	-webkit-overflow-scrolling: touch;
	margin: var(--reg-space-md, 10px) 11px 0;
}

.movil-corte__foot {
	flex: none;
	margin: var(--reg-space-md, 10px) 11px 0;
}

.movil-corte__chips {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 9px;
}

.movil-corte__chip {
	padding: 3px 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 500;
	white-space: nowrap;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.movil-corte__chip--done {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

/* Amber, and STATE again: an open draft blocks the close server-side
   (`_block_on_stranded_drafts` throws), so the chip is a warning about a real
   condition rather than emphasis. */
.movil-corte__chip--attention,
.movil-corte__chip--open {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-heading, #a15200);
	font-weight: 700;
}

.movil-corte__primary {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 9px;
	width: 100%;
	/* Above the 44 px minimum on purpose: it is the last thing pressed at the
	   end of an eleven-hour shift, one-handed, and a mis-tap here reopens the
	   whole count. */
	min-height: 50px;
	margin: 11px 0 14px;
	border: 0;
	border-radius: var(--reg-radius-md, 12px);
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #ffffff);
	cursor: pointer;
	font-family: inherit;
	font-size: 15.5px;
	font-weight: 700;
}

/* Disabled DROPS the accent rather than fading it, the rule ActionBand follows:
   a translucent teal is still teal, and the eye still reads "press this". */
.movil-corte__primary:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: not-allowed;
}

.movil-corte__primary:focus-visible {
	outline: 2px solid var(--reg-text-primary, #212121);
	outline-offset: 2px;
}

/*
 * Touch targets on the ten-row count.
 *
 * `DenominationRow` draws its steppers 34 px wide with a 44 px min-height —
 * correct for the tablet the desktop corte is done on, and twenty targets
 * narrower than the minimum once the same card is on a phone. Widened from
 * here with `:deep()` rather than by editing the shared component, which
 * belongs to the desktop corte and to another agent this wave. Reported: the
 * width is arguably wrong at source too.
 */
@media (pointer: coarse) {
	.movil-corte__count :deep(.denom-row__step) {
		width: var(--reg-touch-min, 44px);
	}

	.movil-corte__count :deep(.denom-row__count) {
		min-height: var(--reg-touch-min, 44px);
	}

	.movil-corte__count :deep(.drawer-count__override) {
		min-height: var(--reg-touch-min, 44px);
	}
}
</style>
