<template>
	<section class="drawer-count" data-testid="drawer-count" :data-count-source="source">
		<header class="drawer-count__head">
			<span class="drawer-count__label">{{ __("Drawer count") }}</span>
			<span class="drawer-count__meta" data-testid="drawer-count-denomination-count">
				{{ __("{0} denominations", [faces.length]) }}
			</span>
		</header>

		<!-- Ten rows, each a stepper. The subtotal sits on the row because that
		     is what makes the count checkable: a cashier who miscounts the $200s
		     sees $800 where they expected $600 without doing any arithmetic. -->
		<div class="drawer-count__rows" role="group" :aria-label="__('Drawer count')">
			<DenominationRow
				v-for="face in faces"
				:key="face"
				:face-minor="face"
				:face-label="formatMoney(faceMajor(face))"
				:subtotal-label="formatMoney(subtotalOf(face))"
				:count="countOf(face)"
				:decrement-label="__('One less of {0}', [formatMoney(faceMajor(face))])"
				:increment-label="__('One more of {0}', [formatMoney(faceMajor(face))])"
				:count-label="__('How many of {0}', [formatMoney(faceMajor(face))])"
				@update:count="setCount(face, $event)"
			/>
		</div>

		<div class="drawer-count__spacer"></div>

		<!-- Where "expected" comes from. Rendered from what the caller passed,
		     never re-derived: the expected figure is the server's, and a second
		     opinion about it on this screen would be a second number to argue
		     with at close. The box appears only when the parts ACCOUNT for that
		     figure — a provenance that does not add up is worse than none. -->
		<div
			v-if="breakdownRows.length && breakdownReconciles"
			class="drawer-count__expected"
			data-testid="drawer-count-expected"
		>
			<div v-for="part in breakdownRows" :key="part.key" class="drawer-count__expected-row">
				<span>{{ part.label }}</span>
				<span class="reg-mono" data-money-role="expected-part">{{ formatMoney(part.amount) }}</span>
			</div>
			<div class="drawer-count__expected-row drawer-count__expected-row--total">
				<span>{{ __("= Expected in drawer") }}</span>
				<span class="reg-mono" data-testid="drawer-count-expected-total" data-money-role="expected">
					{{ formatMoney(expected) }}
				</span>
			</div>
		</div>

		<div class="drawer-count__counted">
			<div class="drawer-count__counted-line">
				<span class="drawer-count__counted-label">
					{{ __("Counted") }}
					<!-- The override has to LOOK like one. A hand-typed figure that
					     renders identically to a derived one is the assertion the
					     denomination rows exist to replace. -->
					<span
						v-if="isManual"
						class="drawer-count__manual-chip"
						data-testid="drawer-count-manual-chip"
					>
						{{ __("entered by hand") }}
					</span>
				</span>
				<span
					v-if="!isManual"
					class="drawer-count__counted-value reg-mono"
					data-testid="drawer-count-counted"
					data-money-role="counted"
				>
					{{ formatMoney(counted) }}
				</span>
				<input
					v-else
					class="drawer-count__counted-input reg-mono"
					data-testid="drawer-count-manual-input"
					data-money-role="counted"
					type="text"
					inputmode="decimal"
					autocomplete="off"
					:aria-label="__('Counted total, entered by hand')"
					:value="manualEntry"
					@input="onManualInput"
				/>
			</div>

			<div class="drawer-count__counted-foot">
				<!-- Both figures stay on screen while an override is active. The
				     gap between them is the whole reason a supervisor looks at
				     this screen, and hiding the count would hide it. -->
				<span v-if="isManual" class="drawer-count__derived" data-testid="drawer-count-derived">
					{{ __("By denominations") }}
					<span class="reg-mono" data-money-role="counted-derived">{{ formatMoney(derived) }}</span>
				</span>
				<span v-else class="drawer-count__derived">{{ __("Derived from the count above") }}</span>

				<button
					type="button"
					class="drawer-count__override"
					data-testid="drawer-count-override-toggle"
					@click="toggleManual"
				>
					{{ isManual ? __("Use the count") : __("Enter the total by hand") }}
				</button>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Counting the drawer by denomination (canvas `Corte.dc.html`, build plan §12 C).
 *
 * This component changes how the counted figure is ENTERED and shown. It does
 * not change what the close posts: the number it produces is the same cash
 * `closing_amount` the reconciliation table has always carried, and the
 * difference against expected is still resolved where it always was — by
 * `bandState.ts`, from `expected` and `counted`. Nothing here subtracts
 * anything from anything.
 *
 * The arithmetic lives in `denominations.ts` as pure integer functions, both so
 * the currency table can vary without touching a template and so the derivation
 * can be mutation-tested. Reactive state lives here; sums do not.
 *
 * The override is deliberate, not a concession. A cashier counting under a
 * queue, or a drawer holding a note this list does not cover, must still be
 * able to state a figure — denomination counting is an aid, not a cage. What it
 * must never be is invisible, so an overridden total is labelled, and the
 * derived count stays beside it.
 */
import { computed, reactive, ref, watch } from "vue";

import DenominationRow from "./DenominationRow.vue";
import {
	countedMinorTotal,
	denominationsFor,
	majorToMinor,
	minorToMajor,
	rowMinorSubtotal,
} from "./denominations";

/**
 * The figures the artboard shows above "= Debe haber", in major units. Each is
 * optional because the shift overview does not publish all four yet, and a row
 * we cannot source is left out rather than shown as a confident zero.
 */
export interface ExpectedBreakdown {
	openingFloat?: number | null;
	cashSales?: number | null;
	advances?: number | null;
	withdrawals?: number | null;
}

type CountSource = "denominations" | "manual";

const props = withDefaults(
	defineProps<{
		/** Tenant currency; decides which faces this drawer can hold. */
		currency?: string;
		/** Expected cash, computed by the server. Displayed, never recomputed. */
		expected?: number;
		/** Optional provenance of `expected`, straight from the shift overview. */
		breakdown?: ExpectedBreakdown | null;
		/**
		 * A figure the close already carried — a resumed dialog, or an amount
		 * typed into the reconciliation table. Seeds the override, because a
		 * number that arrived from somewhere else is by definition not derived
		 * from these rows.
		 */
		initialCounted?: number | null;
		/** Tenant formatter; falls back so the card renders standalone. */
		formatCurrency?: (_value: number) => string;
	}>(),
	{
		currency: "",
		expected: 0,
		breakdown: null,
		initialCounted: null,
		formatCurrency: undefined,
	},
);

const emit = defineEmits<{
	(_event: "update:counted", _amount: number, _source: CountSource): void;
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

const table = computed(() => denominationsFor(props.currency));
const faces = computed(() => table.value.faces);

/** Face minor value → how many. Keyed by the minor value, so a currency swap
 *  cannot carry a stale count onto a face that means something else. */
const counts = reactive<Record<number, number>>({});

const countOf = (face: number): number => counts[face] ?? 0;

const setCount = (face: number, next: number) => {
	counts[face] = next < 0 ? 0 : Math.trunc(next);
};

/** Rows in the shape the pure derivation wants. */
const rows = computed(() => faces.value.map((face) => ({ minor: face, count: countOf(face) })));

const derivedMinor = computed(() => countedMinorTotal(rows.value));
const derived = computed(() => minorToMajor(derivedMinor.value, table.value.minorPerMajor));

const subtotalOf = (face: number) =>
	minorToMajor(rowMinorSubtotal(face, countOf(face)), table.value.minorPerMajor);

const faceMajor = (face: number) => minorToMajor(face, table.value.minorPerMajor);

// ---- the override ----------------------------------------------------------

const isManual = ref(false);
const manualEntry = ref("");

const manualMajor = computed(() =>
	minorToMajor(majorToMinor(manualEntry.value, table.value.minorPerMajor), table.value.minorPerMajor),
);

const source = computed<CountSource>(() => (isManual.value ? "manual" : "denominations"));
const counted = computed(() => (isManual.value ? manualMajor.value : derived.value));

const onManualInput = (event: Event) => {
	manualEntry.value = (event.target as HTMLInputElement).value;
};

const toggleManual = () => {
	if (isManual.value) {
		isManual.value = false;
		return;
	}
	// Opening the override carries the derived figure across, so the cashier
	// edits the count rather than retyping a drawer they already counted.
	manualEntry.value = derived.value ? String(derived.value) : "";
	isManual.value = true;
};

// A figure that arrived from outside these rows is an override by definition;
// pretending it was derived would claim a provenance it does not have.
watch(
	() => props.initialCounted,
	(seed) => {
		if (seed === null || seed === undefined || !Number.isFinite(Number(seed))) return;
		if (isManual.value || derivedMinor.value > 0) return;
		manualEntry.value = String(seed);
		isManual.value = true;
	},
	{ immediate: true },
);

watch(
	[counted, source],
	([amount, from]) => emit("update:counted", amount, from),
	{ immediate: true },
);

// ---- presentation ----------------------------------------------------------

const formatMoney = (value: number) => {
	if (props.formatCurrency) return props.formatCurrency(value);
	return value.toLocaleString("es-MX", {
		style: "currency",
		currency: props.currency || "MXN",
		minimumFractionDigits: 2,
	});
};

/** `sign` is how the part enters the identity, and what prefixes its label. */
const BREAKDOWN_PARTS = [
	{ key: "opening", field: "openingFloat", labelKey: "Opening float", sign: 1 },
	{ key: "sales", field: "cashSales", labelKey: "+ Cash sales", sign: 1 },
	{ key: "advances", field: "advances", labelKey: "+ Advances taken", sign: 1 },
	{ key: "withdrawals", field: "withdrawals", labelKey: "− Withdrawals and payouts", sign: -1 },
] as const;

const breakdownRows = computed(() => {
	const parts = props.breakdown;
	if (!parts) return [];
	return BREAKDOWN_PARTS.flatMap((part) => {
		const raw = parts[part.field];
		if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return [];
		return [{ key: part.key, label: __(part.labelKey), amount: Number(raw), sign: part.sign }];
	});
});

/**
 * Do the parts we were given account for the expected figure?
 *
 * Compared in minor units, because the whole point of this card is that money
 * arithmetic in float drifts; a half-centavo tolerance would let the box render
 * beside an identity that is off by a rounding error nobody can see.
 */
const breakdownReconciles = computed(() => {
	const parts = breakdownRows.value;
	if (!parts.length) return false;
	const { minorPerMajor } = table.value;
	const sum = parts.reduce(
		(total, part) => total + part.sign * majorToMinor(part.amount, minorPerMajor),
		0,
	);
	return sum === majorToMinor(props.expected, minorPerMajor);
});

defineExpose({ counted, derived, source });
</script>

<style scoped>
/* Tokens with artboard fallbacks, the pattern ActionBand.vue set: the card is
   correct even where register-tokens.css has not been wired into the entry.
   No accent fill anywhere in this file — the band's button owns the one accent
   (§17.7 invariant 2), and a counting card that painted itself teal would spend
   it on a surface nobody presses. */
.drawer-count {
	display: flex;
	flex-direction: column;
	min-height: 0;
	padding: var(--reg-space-lg, 16px);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	background: var(--reg-surface, #ffffff);
}

.drawer-count__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
}

.drawer-count__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.drawer-count__meta {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.drawer-count__rows {
	margin-top: 9px;
}

.drawer-count__spacer {
	flex: 1 1 auto;
	min-height: 0;
}

.drawer-count__expected {
	margin-top: var(--reg-space-md, 10px);
	padding: 12px 14px;
	border: 1px solid var(--reg-divider-soft, #f2f4f7);
	border-radius: var(--reg-radius-sm, 12px);
	background: var(--reg-surface-sunken, #fafbfc);
}

.drawer-count__expected-row {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	padding: 3px 0;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.drawer-count__expected-row--total {
	margin-top: 4px;
	padding-top: 7px;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.drawer-count__counted {
	margin-top: 12px;
	padding-top: 11px;
	border-top: 1px solid var(--reg-divider, #eceff3);
}

.drawer-count__counted-line {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.drawer-count__counted-label {
	display: inline-flex;
	align-items: baseline;
	gap: 8px;
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

/* Amber, and amber only: a hand-typed total is an exception the supervisor
   reads, in the same vocabulary the band uses for a difference. It is a tint
   on a caption, never a fill on a control. */
.drawer-count__manual-chip {
	padding: 2px 8px;
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: 999px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.drawer-count__counted-value,
.drawer-count__counted-input {
	font-size: 26px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-text-primary, #212121);
}

.drawer-count__counted-input {
	width: 150px;
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: var(--reg-radius-xs, 8px);
	background: transparent;
	padding: 2px 8px;
	text-align: right;
	font-family: inherit;
}

.drawer-count__counted-foot {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	margin-top: 6px;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.drawer-count__override {
	border: 0;
	background: transparent;
	padding: 4px 0;
	cursor: pointer;
	font-family: inherit;
	font-size: 11.5px;
	font-weight: 700;
	color: var(--reg-text-secondary, #56606e);
	text-decoration: underline;
}
</style>
