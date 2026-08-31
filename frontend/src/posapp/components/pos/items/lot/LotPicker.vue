<template>
	<!-- ONE surface for the desk and the phone (owner ask 2026-08-30: «clicking
	     on a sn item should open a selector, and this improvement is for desk
	     and mobile, general fix» → «make the ui good, so we can reuse on
	     batches, pharma uses these features extensively»).

	     Not a `v-dialog`: this is an overlay the register draws itself, the
	     same shape `MovilLineSheet` uses — a centred card from 1100 up, a
	     bottom sheet below it — so one component covers both bands without a
	     Vuetify overlay in the middle deciding its geometry. -->
	<div class="lot-picker" data-testid="lot-picker">
		<!-- A tap outside is the phone's Escape. Not a <button>: a full-viewport
		     control would be the biggest tab stop on the screen; the × is the
		     named one. -->
		<div class="lot-picker__scrim" data-testid="lot-scrim" @click="close"></div>

		<section
			class="lot-picker__panel"
			role="dialog"
			aria-modal="true"
			:aria-label="view.itemName"
		>
			<header class="lot-picker__head">
				<span class="lot-picker__grip" aria-hidden="true"></span>
				<div class="lot-picker__ident">
					<p class="lot-picker__name" data-testid="lot-name">{{ view.itemName }}</p>
					<p class="lot-picker__code reg-mono" data-testid="lot-code">
						<span>{{ view.itemCode }}</span>
						<span v-if="view.warehouse" class="lot-picker__warehouse">{{
							view.warehouse
						}}</span>
					</p>
				</div>
				<button
					type="button"
					class="lot-picker__close"
					data-testid="lot-close"
					:aria-label="__('Close')"
					@click="close"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="m6 6 12 12M18 6 6 18"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>

			<div class="lot-picker__ask">
				<p class="lot-picker__question" data-testid="lot-question">{{ questionLabel }}</p>
				<p class="lot-picker__summary reg-mono" data-testid="lot-summary">{{ summaryLabel }}</p>
			</div>

			<label class="lot-picker__search">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" />
					<path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
				</svg>
				<input
					ref="searchEl"
					v-model="queryDraft"
					class="lot-picker__search-input"
					data-testid="lot-search"
					type="search"
					enterkeyhint="search"
					autocomplete="off"
					:placeholder="searchPlaceholder"
					:aria-label="searchPlaceholder"
				/>
			</label>

			<div class="lot-picker__body">
				<!-- BOTH: the batch is a FILTER over the serial list, not the
				     selection — `applySerialBatchFilter` decides what survives,
				     the same rule the cart row applies once the line exists. -->
				<div v-if="view.mode === 'both'" class="lot-picker__filters" data-testid="lot-batch-filters">
					<button
						type="button"
						class="lot-chip-btn"
						:class="{ 'lot-chip-btn--on': !batchFilter }"
						:aria-pressed="!batchFilter ? 'true' : 'false'"
						data-testid="lot-filter-all"
						@click="batchFilter = null"
					>
						{{ __("All batches") }}
					</button>
					<button
						v-for="batch in visibleBatches"
						:key="batch.batchNo"
						type="button"
						class="lot-chip-btn"
						:class="{ 'lot-chip-btn--on': batchFilter === batch.batchNo }"
						:aria-pressed="batchFilter === batch.batchNo ? 'true' : 'false'"
						:disabled="!batch.selectable"
						:data-batch="batch.batchNo"
						@click="batchFilter = batchFilter === batch.batchNo ? null : batch.batchNo"
					>
						<span class="reg-mono">{{ batch.batchNo }}</span>
						<span v-if="batch.expiryDate" class="lot-chip-btn__date">{{ batch.expiryDate }}</span>
					</button>
				</div>

				<!-- BATCH: each row carries its own quantity, so one sale can be
				     split across boxes — the shape the engine already produces
				     when it allocates FEFO by itself. -->
				<ul v-if="view.mode === 'batch'" class="lot-picker__rows" data-testid="lot-batch-rows">
					<li
						v-for="batch in visibleBatches"
						:key="batch.batchNo"
						class="lot-row"
						:class="{
							'lot-row--blocked': !batch.selectable,
							'lot-row--picked': batchQty(batch.batchNo) > 0,
						}"
						:data-batch="batch.batchNo"
						:data-selectable="batch.selectable ? 'true' : 'false'"
					>
						<div class="lot-row__ident">
							<span class="lot-row__code reg-mono">{{ batch.batchNo }}</span>
							<span class="lot-row__meta">
								<span v-if="batch.expiryDate" class="reg-mono"
									>{{ __("Expiry") }} {{ batch.expiryDate }}</span
								>
								<span v-if="batch.manufacturingDate" class="reg-mono"
									>{{ __("Manufactured") }} {{ batch.manufacturingDate }}</span
								>
								<span class="reg-mono"
									>{{ __("Available") }} {{ formatQty(batch.availableQty) }}</span
								>
							</span>
						</div>
						<span
							v-if="batch.tone !== 'none'"
							class="lot-tone"
							:data-tone="batch.tone"
							:data-testid="`lot-tone-${batch.batchNo}`"
							>{{ toneLabel(batch) }}</span
						>
						<div v-if="batch.selectable" class="lot-row__stepper">
							<button
								type="button"
								class="lot-step"
								:data-testid="`lot-minus-${batch.batchNo}`"
								:disabled="batchQty(batch.batchNo) <= 0"
								:aria-label="__('Decrease quantity')"
								@click="stepBatch(batch, -1)"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path d="M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
								</svg>
							</button>
							<input
								class="lot-step__qty reg-mono"
								:data-testid="`lot-qty-${batch.batchNo}`"
								type="number"
								inputmode="decimal"
								step="any"
								min="0"
								:max="batch.availableQty"
								:aria-label="__('Quantity')"
								:value="batchQty(batch.batchNo)"
								@change="typeBatchQty(batch, $event)"
							/>
							<button
								type="button"
								class="lot-step"
								:data-testid="`lot-plus-${batch.batchNo}`"
								:disabled="batchQty(batch.batchNo) >= batch.availableQty"
								:aria-label="__('Increase quantity')"
								@click="stepBatch(batch, 1)"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<path
										d="M12 6v12M6 12h12"
										stroke="currentColor"
										stroke-width="2.4"
										stroke-linecap="round"
									/>
								</svg>
							</button>
						</div>
						<span v-else class="lot-row__blocked" :data-testid="`lot-blocked-${batch.batchNo}`">{{
							reasonLabel(batch.blockedReason)
						}}</span>
					</li>
				</ul>

				<!-- SERIAL / BOTH: multi-select, and the count IS the quantity. -->
				<ul v-else class="lot-picker__rows" data-testid="lot-serial-rows">
					<li v-for="serial in visibleSerials" :key="serial.serialNo">
						<button
							type="button"
							class="lot-row lot-row--tap"
							:class="{
								'lot-row--blocked': !serial.selectable,
								'lot-row--picked': isSerialPicked(serial.serialNo),
							}"
							:data-serial="serial.serialNo"
							:data-selectable="serial.selectable ? 'true' : 'false'"
							:data-testid="`lot-serial-${serial.serialNo}`"
							:disabled="!serial.selectable"
							:aria-pressed="isSerialPicked(serial.serialNo) ? 'true' : 'false'"
							@click="toggleSerial(serial)"
						>
							<span class="lot-row__box" aria-hidden="true">
								<svg
									v-if="isSerialPicked(serial.serialNo)"
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
								>
									<path
										d="m5 12.5 4.5 4.5L19 7.5"
										stroke="currentColor"
										stroke-width="2.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</span>
							<span class="lot-row__ident">
								<span class="lot-row__code reg-mono">{{ serial.serialNo }}</span>
								<span class="lot-row__meta">
									<span v-if="serial.batchNo" class="reg-mono"
										>{{ __("Batch") }} {{ serial.batchNo }}</span
									>
									<span v-if="serial.expiryDate" class="reg-mono"
										>{{ __("Expiry") }} {{ serial.expiryDate }}</span
									>
									<span v-if="serial.warehouse">{{ serial.warehouse }}</span>
									<span v-if="serial.purchaseDate" class="reg-mono"
										>{{ __("Purchased") }} {{ serial.purchaseDate }}</span
									>
									<span v-if="serial.warrantyExpiryDate" class="reg-mono"
										>{{ __("Warranty") }} {{ serial.warrantyExpiryDate }}</span
									>
								</span>
							</span>
							<span
								v-if="serial.tone !== 'none'"
								class="lot-tone"
								:data-tone="serial.tone"
								:data-testid="`lot-tone-${serial.serialNo}`"
								>{{ toneLabel(serial) }}</span
							>
							<span
								v-if="!serial.selectable"
								class="lot-row__blocked"
								:data-testid="`lot-blocked-${serial.serialNo}`"
								>{{ reasonLabel(serial.blockedReason) }}</span
							>
						</button>
					</li>
				</ul>

				<p v-if="!visibleRowCount" class="lot-picker__empty" data-testid="lot-empty">
					{{ emptyLabel }}
				</p>
			</div>

			<footer class="lot-picker__actions">
				<p v-if="blockedHint" class="lot-picker__hint" data-testid="lot-hint">{{ blockedHint }}</p>
				<button
					type="button"
					class="lot-picker__primary"
					data-testid="lot-add"
					:disabled="!canAdd"
					@click="confirm"
				>
					{{ __("Add {0}", [formatQty(totalQty)]) }}
				</button>
				<button type="button" class="lot-picker__secondary" data-testid="lot-cancel" @click="close">
					{{ __("Cancel") }}
				</button>
			</footer>
		</section>
	</div>
</template>

<script setup lang="ts">
/**
 * The lot picker's SURFACE. Every decision it draws comes from `lotPicker.ts`;
 * this file owns the selection a cashier is building and nothing else — it
 * mutates no cart row, calls no endpoint and knows no stock rule.
 *
 * The confirm leaves as an intent (`lot:confirm`) rather than as an add: the
 * ONE add path stays `ItemsSelector.add_item`, which is what the desk's
 * catalogue click already rides, so a lot-tracked item and an ordinary one
 * reach the cart through exactly the same code (money-seam shape, the same one
 * `movil_collect_payment` uses for a payment).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
	filterSerialsByBatch,
	LOT_SEARCH_DEBOUNCE_MS,
	resolveLotAdds,
	resolveLotTotalQty,
	type LotBatchRow,
	type LotBlockReason,
	type LotPickerView,
	type LotSerialRow,
} from "./lotPicker";

const props = defineProps<{
	view: LotPickerView;
	/** How many units the cashier asked for — the desk's qty field, else 1. */
	requestedQty?: number;
}>();

const emit = defineEmits<{
	(_event: "confirm", _adds: Record<string, any>[]): void;
	(_event: "close"): void;
}>();

const __ = (window as any).__ || ((text: string, args?: any[]) => formatFallback(text, args));

/** Stand-in for `__` in a context with no Frappe boot (specs, offline shell). */
function formatFallback(text: string, args?: any[]) {
	if (!Array.isArray(args)) return text;
	return args.reduce((out: string, value, index) => out.replace(`{${index}}`, String(value)), text);
}

// ---------------------------------------------------------------------------
// the selection
// ---------------------------------------------------------------------------

const pickedSerials = ref<string[]>([]);
const batchQtys = ref<Record<string, number>>({});
const batchFilter = ref<string | null>(null);

const requested = computed(() => {
	const raw = Number(props.requestedQty);
	return Number.isFinite(raw) && raw > 0 ? Math.abs(raw) : 1;
});

/**
 * A batch-only picker opens with the requested quantity already allocated
 * FEFO — the same allocation `useItemAddition` performs unattended when the
 * profile auto-sets batches. The cashier's job is then to DISAGREE with it,
 * which is a much shorter job than building it from zero on every sale.
 *
 * Serials are never pre-picked: which numbered unit leaves the shelf is the
 * question the picker exists to ask.
 */
const seedBatchAllocation = () => {
	const seeded: Record<string, number> = {};
	if (props.view.mode !== "batch") {
		batchQtys.value = seeded;
		return;
	}
	let remaining = requested.value;
	for (const batch of props.view.batches) {
		if (remaining <= 0) break;
		if (!batch.selectable) continue;
		const take = Math.min(remaining, batch.availableQty);
		if (take <= 0) continue;
		seeded[batch.batchNo] = take;
		remaining -= take;
	}
	batchQtys.value = seeded;
};

watch(
	() => props.view.source,
	() => {
		pickedSerials.value = [];
		batchFilter.value = null;
		seedBatchAllocation();
	},
	{ immediate: true },
);

// The rows arrive in two waves: what the catalogue already knew, then the
// detail refresh. Re-seed on the second wave, but only while the cashier has
// not touched anything — overwriting a hand-built split would be the picker
// arguing with the person using it.
watch(
	() => props.view.batches,
	() => {
		if (props.view.mode !== "batch") return;
		if (Object.keys(batchQtys.value).length === 0) seedBatchAllocation();
	},
);

const batchQty = (batchNo: string) => Number(batchQtys.value[batchNo] || 0);

const setBatchQty = (batch: LotBatchRow, qty: number) => {
	const capped = Math.max(0, Math.min(qty, batch.availableQty));
	const next = { ...batchQtys.value };
	if (capped <= 0) delete next[batch.batchNo];
	else next[batch.batchNo] = capped;
	batchQtys.value = next;
};

const stepBatch = (batch: LotBatchRow, delta: number) => {
	if (!batch.selectable) return;
	setBatchQty(batch, batchQty(batch.batchNo) + delta);
};

const typeBatchQty = (batch: LotBatchRow, event: Event) => {
	if (!batch.selectable) return;
	const input = event.target as HTMLInputElement;
	const parsed = Number.parseFloat(input.value);
	setBatchQty(batch, Number.isFinite(parsed) ? parsed : 0);
	// Re-show what the picker actually holds: the cap may have trimmed it, and
	// a field claiming 9 while the sale carries 4 is a lie about a quantity.
	input.value = String(batchQty(batch.batchNo));
};

const isSerialPicked = (serialNo: string) => pickedSerials.value.includes(serialNo);

const toggleSerial = (serial: LotSerialRow) => {
	if (!serial.selectable) return;
	pickedSerials.value = isSerialPicked(serial.serialNo)
		? pickedSerials.value.filter((entry) => entry !== serial.serialNo)
		: [...pickedSerials.value, serial.serialNo];
};

// ---------------------------------------------------------------------------
// the search — client-side, debounced, over rows already in hand
// ---------------------------------------------------------------------------

const queryDraft = ref("");
const query = ref("");
let queryTimer: ReturnType<typeof setTimeout> | null = null;

watch(queryDraft, (value) => {
	if (queryTimer) clearTimeout(queryTimer);
	queryTimer = setTimeout(() => {
		query.value = String(value || "").trim().toLowerCase();
	}, LOT_SEARCH_DEBOUNCE_MS);
});

const matches = (...parts: Array<string | null>) => {
	if (!query.value) return true;
	return parts.some((part) => String(part || "").toLowerCase().includes(query.value));
};

const visibleBatches = computed(() =>
	props.view.batches.filter((batch) => matches(batch.batchNo, batch.expiryDate)),
);

const visibleSerials = computed(() =>
	filterSerialsByBatch(props.view.serials, batchFilter.value).filter((serial) =>
		matches(serial.serialNo, serial.batchNo),
	),
);

const visibleRowCount = computed(() =>
	props.view.mode === "batch" ? visibleBatches.value.length : visibleSerials.value.length,
);

// ---------------------------------------------------------------------------
// what the header says, and what the primary does
// ---------------------------------------------------------------------------

const adds = computed(() =>
	resolveLotAdds(props.view, {
		serials: pickedSerials.value,
		batches: Object.entries(batchQtys.value).map(([batchNo, qty]) => ({ batchNo, qty })),
	}),
);

const totalQty = computed(() => resolveLotTotalQty(adds.value));

const pickedCount = computed(() =>
	props.view.mode === "batch"
		? Object.keys(batchQtys.value).filter((batchNo) => batchQty(batchNo) > 0).length
		: pickedSerials.value.length,
);

const canAdd = computed(() => adds.value.length > 0);

const questionLabel = computed(() => {
	if (props.view.mode === "batch") return __("Choose a batch");
	if (props.view.mode === "serial") return __("Choose a serial number");
	return __("Choose a batch and a serial number");
});

const searchPlaceholder = computed(() =>
	props.view.mode === "batch" ? __("Search batch") : __("Search serial number"),
);

const emptyLabel = computed(() =>
	props.view.mode === "batch" ? __("No batches available") : __("No serial numbers available"),
);

const formatQty = (value: number) => {
	const numeric = Number(value) || 0;
	return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(3)));
};

const summaryLabel = computed(() => {
	const chosen = __("{0} selected · {1} pcs", [pickedCount.value, formatQty(totalQty.value)]);
	if (requested.value > 1) {
		return `${chosen} · ${__("{0} of {1}", [formatQty(totalQty.value), formatQty(requested.value)])}`;
	}
	return chosen;
});

/** Why the primary is closed — said out loud, never left to a greyed button. */
const blockedHint = computed(() => {
	if (canAdd.value) return "";
	if (props.view.isEmpty) return emptyLabel.value;
	return __("Choose at least one unit");
});

const toneLabel = (row: LotBatchRow | LotSerialRow) => {
	if (row.tone === "expired") return __("Expired lot");
	if (row.daysToExpiry === null) return "";
	if (row.daysToExpiry === 0) return __("Expires today");
	return __("{0} days", [row.daysToExpiry]);
};

const reasonLabel = (reason: LotBlockReason | null) => {
	if (reason === "expired") return __("Expired lot");
	if (reason === "empty") return __("No stock left");
	if (reason === "in-cart") return __("Already on this ticket");
	return "";
};

const confirm = () => {
	if (!canAdd.value) return;
	emit("confirm", adds.value);
};

const close = () => emit("close");

// ---------------------------------------------------------------------------
// keyboard, focus and the scanner
// ---------------------------------------------------------------------------

const searchEl = ref<HTMLInputElement | null>(null);

/**
 * Escape closes, from anywhere — on `document` rather than on the panel,
 * because the panel does not take focus on a coarse pointer (below).
 */
const onKeydown = (event: KeyboardEvent) => {
	if (event.key !== "Escape") return;
	event.stopPropagation();
	close();
};

onMounted(() => {
	document.addEventListener("keydown", onKeydown);
	// NO autofocus on glass. The register's ONE scanner is attached to the
	// document, and a focused text field on a phone also summons a keyboard
	// over the list the cashier came here to read. A mouse-and-keyboard desk
	// gets the cursor, because there the search IS the fastest way in.
	const finePointer =
		typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
	if (finePointer) searchEl.value?.focus();
});

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown);
	if (queryTimer) clearTimeout(queryTimer);
});
</script>

<style scoped>
/* Every colour is a token with the artboard value as its fallback — a literal
 * hex here is what left the register's primary navigation rendering light
 * beside a #121212 shell (wave 3, A1). */
.lot-picker {
	position: fixed;
	inset: 0;
	/* Above the phone dock (`z-index: 20`) for the same reason the line sheet
	   is: a picker the dock covers is a picker whose primary is under Pay. */
	z-index: 30;
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
}

.lot-picker__scrim {
	position: absolute;
	inset: 0;
	background: var(--reg-scrim, rgba(15, 23, 42, 0.32));
}

.lot-picker__panel {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	max-height: 90%;
	padding: 10px 14px calc(14px + env(safe-area-inset-bottom));
	border-radius: var(--reg-radius-lg, 18px) var(--reg-radius-lg, 18px) 0 0;
	background: var(--reg-surface, #ffffff);
	box-shadow: 0 -8px 28px var(--pos-shadow, rgba(15, 23, 42, 0.18));
}

/* The desk: a centred card, the same 1100 boundary the variant picker and the
   flows sheets use. Below it the panel stays the phone's bottom sheet. */
@media (min-width: 1100px) {
	.lot-picker {
		align-items: center;
		justify-content: center;
	}

	.lot-picker__panel {
		width: min(720px, 92vw);
		max-height: 84vh;
		padding: 14px 18px 16px;
		border-radius: var(--reg-radius-lg, 18px);
		box-shadow: 0 18px 48px var(--pos-shadow, rgba(15, 23, 42, 0.18));
	}

	.lot-picker__grip {
		display: none;
	}
}

.lot-picker__head {
	display: flex;
	align-items: flex-start;
	gap: var(--reg-space-md, 10px);
}

/* The drag handle every phone sheet has. Decorative — the × is the control. */
.lot-picker__grip {
	position: absolute;
	top: 6px;
	left: 50%;
	width: 36px;
	height: 4px;
	margin-left: -18px;
	border-radius: 999px;
	background: var(--reg-divider, #eceff3);
}

.lot-picker__ident {
	flex: 1;
	min-width: 0;
	padding-top: 8px;
}

.lot-picker__name {
	margin: 0;
	font-size: 14.5px;
	font-weight: 700;
	line-height: 1.25;
	color: var(--reg-text-primary, #212121);
}

.lot-picker__code {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 10px;
	margin: 3px 0 0;
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

.lot-picker__warehouse::before {
	content: "· ";
}

.lot-picker__close {
	flex: none;
	display: grid;
	place-items: center;
	width: var(--reg-touch-min, 44px);
	height: var(--reg-touch-min, 44px);
	min-width: var(--reg-touch-min, 44px);
	min-height: var(--reg-touch-min, 44px);
	/* Bleed the target outside the layout box so a 44px hit area does not push
	   the title row down — the same trade the line sheet's × makes. */
	margin: -6px -8px -6px 0;
	border: 0;
	border-radius: var(--reg-radius-sm, 10px);
	background: none;
	color: var(--reg-text-muted, #667085);
	cursor: pointer;
}

.lot-picker__close:active {
	background: var(--reg-surface-muted, #f2f4f7);
}

.lot-picker__ask {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	flex-wrap: wrap;
}

.lot-picker__question {
	margin: 0;
	font-size: 9.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.lot-picker__summary {
	margin: 0;
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.lot-picker__search {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	min-height: var(--reg-touch-min, 44px);
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface-sunken, #f8f9fa);
	color: var(--reg-text-muted, #667085);
}

.lot-picker__search-input {
	flex: 1;
	min-width: 0;
	border: 0;
	background: none;
	color: var(--reg-text-primary, #212121);
	font: inherit;
	/* 16px on purpose: iOS Safari zooms the viewport on focus below it. */
	font-size: 16px;
	outline: none;
}

.lot-picker__body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.lot-picker__filters {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-xs, 5px);
	padding-bottom: var(--reg-space-sm, 6px);
}

/* 36px, the variant picker's chip — the register's existing answer for a
 * secondary filter affordance. Every control that COMMITS something here (the
 * steppers, the serial rows, the primary, the ×) keeps the 44px floor. */
.lot-chip-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 36px;
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: 999px;
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 11.5px;
	cursor: pointer;
}

/* The picked chip is an EDGE and a weight, never a fill: the one saturated
 * control on this surface is the primary, and a filled chip beside it would
 * make the sheet argue with itself about where to look. */
.lot-chip-btn--on {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.lot-chip-btn:disabled {
	opacity: 0.45;
	cursor: default;
}

.lot-chip-btn__date {
	color: var(--reg-text-muted, #667085);
}

.lot-picker__rows {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xs, 5px);
	margin: 0;
	padding: 0;
	list-style: none;
}

.lot-row {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	width: 100%;
	min-height: var(--reg-touch-min, 44px);
	padding: 6px 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	text-align: start;
}

.lot-row--tap {
	font: inherit;
	cursor: pointer;
}

.lot-row--picked {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
}

.lot-row--blocked {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: default;
}

.lot-row__box {
	flex: none;
	display: grid;
	place-items: center;
	width: 20px;
	height: 20px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-xs, 6px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-on-accent-soft, #00646f);
}

.lot-row__ident {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.lot-row__code {
	font-size: 12.5px;
	font-weight: 700;
	overflow-wrap: anywhere;
}

.lot-row__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 2px 8px;
	font-size: 10.5px;
	color: var(--reg-text-muted, #667085);
}

/* State, never emphasis — the same contract the band's tone palette carries. */
.lot-tone {
	flex: none;
	padding: 2px 7px;
	border: 1px solid var(--reg-tone-neutral-border, rgba(0, 0, 0, 0.06));
	border-radius: 999px;
	background: var(--reg-tone-neutral-bg, #ffffff);
	color: var(--reg-tone-neutral-label, #667085);
	font-size: 10px;
	font-weight: 700;
	white-space: nowrap;
}

.lot-tone[data-tone="soon"] {
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.lot-tone[data-tone="expired"] {
	border-color: var(--reg-tone-negative-border, #f6cfcf);
	background: var(--reg-tone-negative-bg, #fdeaea);
	color: var(--reg-tone-negative-label, #b42318);
}

.lot-row__blocked {
	flex: none;
	font-size: 10.5px;
	font-weight: 700;
	color: var(--reg-tone-negative-label, #b42318);
}

.lot-row__stepper {
	flex: none;
	display: flex;
	align-items: center;
	gap: var(--reg-space-2xs, 2px);
}

/* 44px square, always — not behind a `pointer: coarse` query. The picker is
 * drawn on phones, on portrait tablets and on a counter monitor, and every
 * hand gets the same target. */
.lot-step {
	display: grid;
	place-items: center;
	width: var(--reg-touch-min, 44px);
	height: var(--reg-touch-min, 44px);
	min-width: var(--reg-touch-min, 44px);
	min-height: var(--reg-touch-min, 44px);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	cursor: pointer;
}

.lot-step:active {
	background: var(--reg-surface-muted, #f2f4f7);
}

.lot-step:disabled {
	color: var(--reg-text-muted, #667085);
	opacity: 0.45;
	cursor: default;
}

.lot-step__qty {
	width: 58px;
	min-height: var(--reg-touch-min, 44px);
	padding: 0 4px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 16px;
	font-weight: 700;
	text-align: center;
}

.lot-picker__empty {
	margin: var(--reg-space-lg, 14px) 0;
	font-size: 12.5px;
	text-align: center;
	color: var(--reg-text-muted, #667085);
}

.lot-picker__actions {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-xs, 5px);
}

.lot-picker__hint {
	margin: 0;
	font-size: 11px;
	text-align: center;
	color: var(--reg-text-muted, #667085);
}

/* The ONE saturated control on the surface. */
.lot-picker__primary {
	min-height: var(--reg-touch-min, 44px);
	border: 0;
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #ffffff);
	font: inherit;
	font-size: 14px;
	font-weight: 700;
	cursor: pointer;
}

.lot-picker__primary:active {
	background: var(--reg-accent-pressed, #00838f);
}

.lot-picker__primary:disabled {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	cursor: default;
}

.lot-picker__secondary {
	min-height: var(--reg-touch-min, 44px);
	border: 0;
	border-radius: var(--reg-radius-sm, 10px);
	background: none;
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}

.lot-picker__secondary:active {
	background: var(--reg-surface-muted, #f2f4f7);
}

@media (prefers-reduced-motion: reduce) {
	.lot-picker,
	.lot-picker__panel,
	.lot-row,
	.lot-chip-btn {
		transition: none !important;
		animation: none !important;
	}
}
</style>
