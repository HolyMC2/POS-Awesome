<template>
	<fieldset class="cash-count" data-testid="cash-count-editor" :data-count-source="modelValue.source">
		<legend class="cash-count__legend">
			<span class="cash-count__title">{{ title || __("Count cash") }}</span>
			<span class="cash-count__meta" data-testid="cash-count-denomination-count">
				{{ __("{0} denominations", [faces.length]) }}
			</span>
		</legend>

		<!-- The notes first, in the order a drawer is counted. Each row carries
		     its own subtotal: a cashier who miscounts the $200s sees $800 where
		     they expected $600 without doing any arithmetic. -->
		<div class="cash-count__rows" role="group" :aria-label="title || __('Count cash')">
			<DenominationRow
				v-for="face in majorFaces"
				:key="face"
				:face-minor="face"
				:face-label="money(majorOf(face), true)"
				:subtotal-label="money(subtotalOf(face))"
				:count="quantityOf(face)"
				:decrement-label="__('One less of {0}', [money(majorOf(face))])"
				:increment-label="__('One more of {0}', [money(majorOf(face))])"
				:count-label="__('How many of {0}', [money(majorOf(face))])"
				@update:count="setQuantity(face, $event)"
			/>
		</div>

		<!-- Small change is most of the rows and almost none of the money, so it
		     folds away — unless some is already counted, in which case hiding it
		     would hide part of the total. -->
		<template v-if="minorFaces.length">
			<button
				type="button"
				class="cash-count__disclosure"
				data-testid="cash-count-coins-toggle"
				:aria-expanded="coinsOpen ? 'true' : 'false'"
				@click="coinsOpen = !coinsOpen"
			>
				{{ coinsOpen ? __("Hide smaller denominations") : __("Show smaller denominations") }}
			</button>
			<div
				v-show="coinsOpen"
				class="cash-count__rows"
				role="group"
				:aria-label="__('Smaller denominations')"
			>
				<DenominationRow
					v-for="face in minorFaces"
					:key="face"
					:face-minor="face"
					:face-label="money(majorOf(face), true)"
					:subtotal-label="money(subtotalOf(face))"
					:count="quantityOf(face)"
					:decrement-label="__('One less of {0}', [money(majorOf(face))])"
					:increment-label="__('One more of {0}', [money(majorOf(face))])"
					:count-label="__('How many of {0}', [money(majorOf(face))])"
					@update:count="setQuantity(face, $event)"
				/>
			</div>
		</template>

		<div class="cash-count__counted">
			<div class="cash-count__counted-line">
				<span class="cash-count__counted-label">
					{{ __("Counted") }}
					<!-- A hand-typed figure that renders identically to a derived
					     one is exactly the assertion the rows above replace. -->
					<span v-if="isManual" class="cash-count__chip" data-testid="cash-count-manual-chip">
						{{ __("entered by hand") }}
					</span>
				</span>
				<span
					v-if="!isManual"
					class="cash-count__counted-value reg-mono"
					data-testid="cash-count-total"
					data-money-role="counted"
				>
					{{ money(total) }}
				</span>
				<input
					v-else
					:id="ids.amount"
					class="cash-count__counted-input reg-mono"
					data-testid="cash-count-manual-amount"
					data-money-role="counted"
					type="text"
					inputmode="decimal"
					autocomplete="off"
					:aria-label="__('Counted amount')"
					:aria-invalid="amountInvalid ? 'true' : 'false'"
					:aria-describedby="amountInvalid ? ids.amountHint : undefined"
					:value="modelValue.amount"
					@input="setAmount(($event.target as HTMLInputElement).value)"
				/>
			</div>

			<div class="cash-count__counted-foot">
				<!-- Both figures stay on screen while an override is active: the
				     gap between them is the whole reason anyone reads this card. -->
				<span v-if="isManual" class="cash-count__derived" data-testid="cash-count-derived">
					{{ __("By denominations") }}
					<span class="reg-mono" data-money-role="counted-derived">{{ money(derived) }}</span>
				</span>
				<span v-else class="cash-count__derived">{{ __("Derived from the count above") }}</span>

				<button
					type="button"
					class="cash-count__override"
					data-testid="cash-count-override-toggle"
					@click="toggleManual"
				>
					{{ isManual ? __("Use the count") : __("Enter the total by hand") }}
				</button>
			</div>
		</div>

		<!-- The override stays explicit: a typed total is only accepted with a
		     written reason, and the server refuses one shorter than 8 characters
		     rather than storing an unexplained figure. -->
		<div v-if="isManual" class="cash-count__manual">
			<p v-if="amountInvalid" :id="ids.amountHint" class="cash-count__hint cash-count__hint--warn">
				{{ __("Enter an amount with at most two decimals.") }}
			</p>
			<label class="cash-count__field" :for="ids.reason">
				<span>{{ __("Why was the total overridden?") }}</span>
				<input
					:id="ids.reason"
					type="text"
					maxlength="1000"
					autocomplete="off"
					data-testid="cash-count-manual-reason"
					:aria-invalid="reasonInvalid ? 'true' : 'false'"
					:aria-describedby="ids.reasonHint"
					:value="modelValue.reason"
					@input="update({ reason: ($event.target as HTMLInputElement).value })"
				/>
			</label>
			<p
				:id="ids.reasonHint"
				class="cash-count__hint"
				:class="{ 'cash-count__hint--warn': reasonInvalid }"
			>
				{{ __("Explain the manual count override (at least 8 characters).") }}
			</p>
		</div>
	</fieldset>
</template>

<script setup lang="ts">
/**
 * Counting money on a touchscreen, for every cash-custody surface (the closing
 * allocation, and every bag action in `CashCustodyView`).
 *
 * The model shape is the server's and does not change here — `source`,
 * `denominations: [{ value (major units), quantity }]`, `reason`, `amount` —
 * because `api/cash_custody/model.py:count()` parses exactly that and is the
 * only authority on the total. What changes is how it is ENTERED:
 *
 * - Steppers with per-row subtotals (the same `DenominationRow` the non-custody
 *   corte uses) instead of bare number spinners, so the count is checkable and
 *   reachable with a thumb.
 * - Quantities are normalised to nonnegative integers on every write. The
 *   server rejects a fractional or non-numeric quantity outright, and the old
 *   `type=number` box let one through to be refused on save, after the cash was
 *   already in the bag.
 * - Zero rows are dropped and rows are kept sorted, so the same drawer always
 *   serialises to the same JSON. The closing screen compares saved-vs-current
 *   on that string, and row order alone used to report unsaved changes.
 * - A face that arrived in the model but is not in this currency's table still
 *   gets a row. Counted money that is invisible is worse than an odd row.
 */
import { computed, ref, watch } from "vue";

import DenominationRow from "../closing/DenominationRow.vue";
import { denominationsFor } from "../closing/denominations";

const props = defineProps<{ modelValue: any; currency: string; title?: string }>();
const emit = defineEmits(["update:modelValue"]);

const __ = (text: string, args?: (string | number)[]): string => {
	const translate = (window as any).__;
	const translated = translate ? translate(text, args as any[]) : text;
	if (!args || !args.length) return translated || text;
	return String(translated || text).replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

/** Unique per instance: several editors can share one closing screen. */
const uid = `cash-count-${Math.random().toString(36).slice(2, 9)}`;
const ids = {
	amount: `${uid}-amount`,
	amountHint: `${uid}-amount-hint`,
	reason: `${uid}-reason`,
	reasonHint: `${uid}-reason-hint`,
};

const table = computed(() => denominationsFor(props.currency));

/**
 * Money is read, not parsed: grouped and with its symbol. `Intl` throws on a
 * currency code it does not know, and a count card that crashed on an odd
 * profile currency would take the whole closing screen with it.
 */
const money = (value: number, denomination = false) => {
	const amount = Number(value) || 0;
	try {
		const formatter = new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: props.currency || "MXN",
			minimumFractionDigits: denomination ? 0 : 2,
			maximumFractionDigits: 2,
		});
		// Let narrow denomination labels wrap between currency and value,
		// never require cents for whole banknotes. Subtotals keep their cents.
		return denomination
			? formatter
					.formatToParts(amount)
					.map((part) => (part.type === "currency" ? `${part.value} ` : part.value))
					.join("")
					.trim()
			: formatter.format(amount);
	} catch {
		return `${props.currency || ""} ${amount.toFixed(2)}`.trim();
	}
};

/**
 * Minor units, always — `model.py` multiplies every value by 100 whatever the
 * currency's own minor unit is, so the wire arithmetic uses 100 here too and
 * `minorPerMajor` is left to the face table alone.
 */
const CENTS = 100;
const toCents = (value: unknown) => Math.round((Number(value) || 0) * CENTS);

/** Rows as the model holds them, cleaned of anything the server would refuse. */
const rows = computed<{ value: number; quantity: number }[]>(() => {
	const source = props.modelValue?.denominations;
	if (!Array.isArray(source)) return [];
	return source
		.map((row: any) => ({
			value: Number(row?.value),
			quantity: Math.trunc(Number(row?.quantity) || 0),
		}))
		.filter((row) => Number.isFinite(row.value) && row.value > 0 && row.quantity > 0);
});

/**
 * Face values in the table's own minor units, largest first: the currency's
 * list, plus the fractional coins MXN drawers actually hold, plus any face the
 * stored count carries that neither list knows about.
 */
const faces = computed(() => {
	const { minorPerMajor } = table.value;
	const extra = props.currency === "MXN" ? [50, 20, 10] : [];
	const fromModel = rows.value.map((row) => Math.round(row.value * minorPerMajor));
	return [...new Set([...table.value.faces, ...extra, ...fromModel])]
		.filter((face) => Number.isFinite(face) && face > 0)
		.sort((a, b) => b - a);
});

const majorFaces = computed(() => faces.value.filter((face) => face >= table.value.minorPerMajor));
const minorFaces = computed(() => faces.value.filter((face) => face < table.value.minorPerMajor));

const majorOf = (face: number) => face / table.value.minorPerMajor;

const quantityOf = (face: number) =>
	rows.value.find((row) => Math.round(row.value * table.value.minorPerMajor) === face)?.quantity || 0;

const subtotalOf = (face: number) => (toCents(majorOf(face)) * quantityOf(face)) / CENTS;

/** Open when there is small change to see, and never closed over counted money. */
const coinsOpen = ref(false);
watch(
	[minorFaces, rows],
	() => {
		if (minorFaces.value.some((face) => quantityOf(face) > 0)) coinsOpen.value = true;
	},
	{ immediate: true },
);

const derived = computed(
	() => rows.value.reduce((sum, row) => sum + toCents(row.value) * row.quantity, 0) / CENTS,
);
const isManual = computed(() => props.modelValue?.source === "manual");
const total = computed(() => (isManual.value ? Number(props.modelValue?.amount) || 0 : derived.value));

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const amountInvalid = computed(
	() => isManual.value && !AMOUNT.test(String(props.modelValue?.amount ?? "").trim()),
);
const reasonInvalid = computed(
	() => isManual.value && String(props.modelValue?.reason || "").trim().length < 8,
);

const update = (patch: any) => emit("update:modelValue", { ...props.modelValue, ...patch });

function setQuantity(face: number, next: number) {
	const quantity = Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0;
	const value = majorOf(face);
	const kept = rows.value.filter((row) => Math.round(row.value * table.value.minorPerMajor) !== face);
	if (quantity > 0) kept.push({ value, quantity });
	update({ denominations: kept.sort((a, b) => b.value - a.value) });
}

/** Preserve exactly what was typed. Invalid money is explained, never silently changed. */
function setAmount(raw: string) {
	update({ amount: raw });
}

function toggleManual() {
	if (isManual.value) {
		update({ source: "denominations", reason: "", amount: "" });
		return;
	}
	// Carry the derived figure across so the cashier edits the drawer they just
	// counted instead of retyping it.
	update({ source: "manual", amount: derived.value ? derived.value.toFixed(2) : "" });
}
</script>

<style scoped>
.cash-count {
	container: cash-count / inline-size;
}
.cash-count :deep(.denom-row__step) {
	width: 48px;
	min-width: 48px;
	min-height: 48px;
}
.cash-count :deep(.denom-row__count) {
	width: 48px;
	min-height: 48px;
	font-size: 14px;
}
.cash-count :deep(.denom-row) {
	grid-template-columns: 58px minmax(146px, 1fr) 76px;
	gap: 6px;
}
@container cash-count (max-width: 300px) {
	.cash-count :deep(.denom-row) {
		grid-template-columns: 1fr auto;
		padding-block: 6px;
	}
	.cash-count :deep(.denom-row__stepper) {
		grid-column: 1 / -1;
		grid-row: 2;
	}
	.cash-count :deep(.denom-row__count) {
		flex: 1;
	}
}

/* Register tokens with artboard fallbacks, the pattern `DrawerCount.vue` set.
   No accent fill anywhere: the closing band's button owns the one accent, and a
   counting card that painted itself cyan would spend it on a surface nobody
   presses. */
.cash-count {
	display: block;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	background: var(--reg-surface, var(--pos-card-bg, #ffffff));
	padding: var(--reg-space-lg, 16px);
	min-inline-size: 0;
}

.cash-count__legend {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	inline-size: 100%;
	padding: 0;
}

.cash-count__title {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.cash-count__meta {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

/* One column on a phone, as many as fit on the corte's count column.
   272px is not a taste: the artboard's row is `58px + stepper + 84px` with two
   9px gaps, and the stepper is 34 + 44 + 34 of touch target. Below that the
   track grows past its column and the subtotal leaves the card. */
.cash-count__rows {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr));
	gap: 0 18px;
	margin-top: 9px;
}

.cash-count__disclosure {
	margin-top: 8px;
	min-height: 44px;
	padding: 6px 12px;
	border: 1px solid var(--reg-tone-neutral-divider, #eceff3);
	border-radius: 999px;
	background: var(--reg-surface-muted, #f7f8fa);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	font-weight: 600;
	cursor: pointer;
}

.cash-count__counted {
	margin-top: 12px;
	padding-top: 11px;
	border-top: 1px solid var(--reg-divider, #eceff3);
}

.cash-count__counted-line {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
}

.cash-count__counted-label {
	display: inline-flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: 8px;
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

/* Amber, and amber only: a hand-typed total is an exception a supervisor reads,
   in the same vocabulary the band uses for a difference. A tint on a caption,
   never a fill on a control. */
.cash-count__chip {
	padding: 2px 8px;
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: 999px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.cash-count__counted-value,
.cash-count__counted-input {
	font-size: 26px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-text-primary, #212121);
}

.cash-count__counted-input {
	inline-size: 170px;
	min-height: 48px;
	border: 1px solid var(--reg-tone-warning-border, #f0dcae);
	border-radius: var(--reg-radius-xs, 8px);
	background: transparent;
	padding: 2px 8px;
	text-align: right;
	font-family: inherit;
}

.cash-count__counted-foot {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 12px;
	margin-top: 6px;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.cash-count__override {
	border: 0;
	background: transparent;
	padding: 10px 0;
	min-height: 44px;
	cursor: pointer;
	font-family: inherit;
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-secondary, #56606e);
	text-decoration: underline;
}

.cash-count__manual {
	margin-top: 10px;
	display: grid;
	gap: 6px;
}

.cash-count__field {
	display: grid;
	gap: 5px;
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.cash-count__field input {
	min-height: 48px;
	border: 1px solid var(--reg-border, var(--pos-border, rgba(0, 0, 0, 0.12)));
	border-radius: var(--reg-radius-xs, 8px);
	background: var(--reg-surface, var(--pos-card-bg, #ffffff));
	color: inherit;
	font: inherit;
	padding: 8px 10px;
	inline-size: 100%;
	min-inline-size: 0;
}

.cash-count__hint {
	margin: 0;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.cash-count__hint--warn {
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 600;
}

.cash-count__disclosure:focus-visible,
.cash-count__override:focus-visible,
.cash-count__counted-input:focus-visible,
.cash-count__field input:focus-visible {
	outline: 2px solid var(--reg-text-primary, #212121);
	outline-offset: 2px;
}

@media (max-width: 599.98px) {
	.cash-count {
		padding: var(--reg-space-md, 12px);
	}

	.cash-count__rows {
		grid-template-columns: minmax(0, 1fr);
	}

	.cash-count__counted-value,
	.cash-count__counted-input {
		font-size: 22px;
	}
}
</style>
