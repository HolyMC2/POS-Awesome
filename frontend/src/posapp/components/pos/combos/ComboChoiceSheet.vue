<template>
	<!-- The paquete picker. Mounted ONCE by the register shell; it opens
	     whenever the add path asks (`comboChoiceRequest.ts`) and answers with
	     the picks or with a dismissal. Fullscreen below 1100 like the variant
	     picker, a bounded dialog on the desk. -->
	<v-dialog
		:model-value="open"
		v-bind="dialogProps"
		scrollable
		@update:model-value="onDialogToggle"
	>
		<div
			v-if="pending"
			ref="sheetRef"
			class="paquete-sheet"
			data-testid="combo-choice-sheet"
			:data-combo="pending.combo.item_code"
			tabindex="-1"
			@keydown="onKeydown"
		>
			<header class="paquete-sheet__head">
				<span class="paquete-sheet__thumb" aria-hidden="true">
					<img v-if="pending.combo.image" :src="pending.combo.image" alt="" />
					<v-icon v-else icon="mdi-package-variant" size="26" />
				</span>
				<div class="paquete-sheet__titles">
					<span class="paquete-sheet__eyebrow">{{ __("Combo") }}</span>
					<h2 class="paquete-sheet__name">{{ pending.combo.item_name }}</h2>
					<span class="paquete-sheet__base reg-mono">{{ formatCurrency(pending.combo.rate) }}</span>
				</div>
				<button
					type="button"
					class="paquete-sheet__close"
					data-testid="combo-choice-close"
					:aria-label="__('Close')"
					@click="cancel"
				>
					<v-icon icon="mdi-close" size="22" />
				</button>
			</header>

			<div ref="bodyRef" class="paquete-sheet__body">
				<section
					v-for="(group, groupIndex) in pending.combo.groups"
					:key="group.name"
					class="paquete-group"
					:class="{
						'paquete-group--missing': showMissing && !statusOf(group).satisfied,
						'paquete-group--active': activeGroup?.name === group.name && !isFixedGroup(group),
					}"
					:data-group="group.name"
					:data-testid="`combo-choice-group-${groupIndex}`"
				>
					<header class="paquete-group__head">
						<span class="paquete-group__step reg-mono" aria-hidden="true">{{ groupIndex + 1 }}</span>
						<span class="paquete-group__name">{{ group.name }}</span>
						<span
							class="paquete-group__rule"
							:class="{
								'paquete-group__rule--done': statusOf(group).satisfied && !isFixedGroup(group),
								'paquete-group__rule--missing': showMissing && !statusOf(group).satisfied,
							}"
						>
							<v-icon
								v-if="statusOf(group).satisfied && !isFixedGroup(group)"
								icon="mdi-check"
								size="14"
								aria-hidden="true"
							/>
							{{ ruleLabel(group) }}
						</span>
					</header>

					<p v-if="isFixedGroup(group)" class="paquete-group__included">
						<v-icon icon="mdi-check" size="16" aria-hidden="true" />
						{{ includedLabel(group) }}
					</p>

					<div v-else class="paquete-group__options" role="group" :aria-label="group.name">
						<div
							v-for="(option, optionIndex) in group.options"
							:key="option.item_code"
							class="paquete-option"
							:class="{
								'paquete-option--on': countOf(group, option) > 0,
								'paquete-option--soldout': soldOut(option),
							}"
						>
							<button
								type="button"
								class="paquete-option__tap"
								:data-testid="`combo-choice-option-${option.item_code}`"
								:aria-pressed="countOf(group, option) > 0 ? 'true' : 'false'"
								:disabled="soldOut(option) && countOf(group, option) === 0"
								@click="tap(group, option)"
							>
								<span class="paquete-option__thumb" aria-hidden="true">
									<img v-if="option.image" :src="option.image" alt="" loading="lazy" />
									<span v-else class="paquete-option__initial">{{ initialOf(option) }}</span>
								</span>
								<span class="paquete-option__text">
									<span class="paquete-option__name">{{ option.item_name }}</span>
									<span class="paquete-option__meta">
										<span v-if="option.extra_price > 0" class="paquete-option__extra reg-mono">
											+{{ formatCurrency(option.extra_price) }}
										</span>
										<span v-if="soldOut(option)" class="paquete-option__soldout">{{ __("Sold out") }}</span>
									</span>
								</span>
								<span
									v-if="group.max === 1 && countOf(group, option) > 0"
									class="paquete-option__check"
									aria-hidden="true"
								>
									<v-icon icon="mdi-check" size="18" />
								</span>
								<kbd
									v-else-if="showKeys && activeGroup?.name === group.name && optionIndex < 9"
									class="paquete-option__key"
									aria-hidden="true"
									>{{ optionIndex + 1 }}</kbd
								>
							</button>
							<div
								v-if="group.max > 1 && countOf(group, option) > 0"
								class="paquete-option__stepper"
								role="group"
								:aria-label="option.item_name"
							>
								<button
									type="button"
									:aria-label="__('One fewer')"
									:data-testid="`combo-choice-minus-${option.item_code}`"
									@click="remove(group, option)"
								>
									<v-icon icon="mdi-minus" size="18" />
								</button>
								<span class="reg-mono" aria-live="polite">{{ countOf(group, option) }}</span>
								<button
									type="button"
									:aria-label="__('One more')"
									:data-testid="`combo-choice-plus-${option.item_code}`"
									:disabled="!canAddMore(group, option)"
									@click="add(group, option)"
								>
									<v-icon icon="mdi-plus" size="18" />
								</button>
							</div>
						</div>
					</div>
				</section>
			</div>

			<footer class="paquete-sheet__foot">
				<div class="paquete-sheet__qty" role="group" :aria-label="__('Quantity')">
					<button
						type="button"
						:aria-label="__('One fewer')"
						data-testid="combo-choice-qty-minus"
						:disabled="qty <= 1"
						@click="setQty(qty - 1)"
					>
						<v-icon icon="mdi-minus" size="18" />
					</button>
					<span class="reg-mono" data-testid="combo-choice-qty">{{ qty }}</span>
					<button
						type="button"
						:aria-label="__('One more')"
						data-testid="combo-choice-qty-plus"
						@click="setQty(qty + 1)"
					>
						<v-icon icon="mdi-plus" size="18" />
					</button>
				</div>
				<div class="paquete-sheet__sum" aria-live="polite">
					<span class="paquete-sheet__picked">{{ summary || __("Nothing picked yet") }}</span>
					<span v-if="saving > 0" class="paquete-sheet__saving reg-mono" data-testid="combo-choice-saving">
						{{ __("You save {0}", [formatCurrency(saving)]) }}
					</span>
				</div>
				<button
					type="button"
					class="paquete-sheet__primary"
					:class="{ 'paquete-sheet__primary--blocked': !complete }"
					data-testid="combo-choice-confirm"
					@click="confirm"
				>
					<span class="paquete-sheet__primary-label">{{ confirmLabel }}</span>
					<span class="paquete-sheet__primary-total reg-mono">{{ formatCurrency(total) }}</span>
				</button>
			</footer>
		</div>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * `ComboChoiceSheet` — «elige tu bebida, elige tu pan».
 *
 * Everything this sheet decides is decided in `comboChoice.ts`, which the
 * cart builder and the server's voucher agree with: what a complete paquete
 * is, what a pick costs, when an option is sold out. The sheet only draws the
 * selection and hands it back through `settleComboChoice`.
 *
 * A confirm that is not yet possible is NOT a disabled button: it scrolls to
 * the first group still missing a pick and marks it, because a grey button
 * says "no" without saying why, and the cashier has a customer waiting.
 *
 * Keyboard (desk): 1–9 pick in the group that still needs an answer, Enter
 * confirms, + / − change the quantity, Esc closes (Vuetify's own).
 */
import { computed, nextTick, ref, watch } from "vue";

import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useFormat } from "../../../format";
import { useUIStore } from "../../../stores/uiStore.js";
import {
	addPick,
	canPickMore,
	defaultSelection,
	describeSelection,
	firstIncompleteGroup,
	groupStatus,
	isFixedGroup,
	isOptionSoldOut,
	isSelectionComplete,
	optionPickCount,
	removePick,
	selectionSaving,
	selectionUnitPrice,
	tapPick,
	type ChoiceGroup,
	type ChoiceOption,
	type ComboSelection,
} from "../../../composables/pos/combos/comboChoice";
import {
	settleComboChoice,
	usePendingComboChoice,
} from "../../../composables/pos/combos/comboChoiceRequest";

defineOptions({ name: "ComboChoiceSheet" });

const props = withDefaults(
	defineProps<{
		/** Override for specs; the sheet formats with the register's own rules otherwise. */
		formatCurrency?: ((_value: number) => string) | null;
		/** POS Profile `posa_block_sale_beyond_available_qty`. */
		blockSaleBeyondAvailable?: boolean;
	}>(),
	{
		formatCurrency: null,
		blockSaleBeyondAvailable: false,
	},
);

/**
 * Money as the register writes it: its precision and grouping (`useFormat`),
 * behind the profile currency's symbol — a price the cashier reads out.
 */
const moneyFormat = (() => {
	try {
		const { formatCurrency: grouped, currencySymbol } = useFormat();
		const uiStore = useUIStore();
		return (value: number) => {
			const currency = (uiStore.posProfile as any)?.currency;
			const symbol = currency ? currencySymbol(currency) : "";
			return `${symbol || "$"}${grouped(value)}`;
		};
	} catch {
		return (value: number) => `$${(Number(value) || 0).toFixed(2)}`;
	}
})();
const formatCurrency = (value: number): string =>
	(props.formatCurrency ?? moneyFormat)(Number(value) || 0);

const translate = (text: string, args?: (string | number)[]): string => {
	const fn = typeof window !== "undefined" ? (window as any).__ : undefined;
	if (typeof fn === "function") return fn(text, args);
	if (!args?.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index) => String(args[Number(index)] ?? match));
};
const __ = translate;

const pending = usePendingComboChoice();
const open = computed(() => pending.value !== null);

const { dialogProps, isFullscreenDialog } = useDialogFullscreen({ maxWidth: 760, breakpoint: 1100 });
/** Digit hints only where there is a keyboard to press them on. */
const showKeys = computed(() => !isFullscreenDialog.value);

const selection = ref<ComboSelection>({});
const qty = ref(1);
const showMissing = ref(false);
const lastGroup = ref<string | null>(null);
const sheetRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);

watch(
	pending,
	(request) => {
		showMissing.value = false;
		lastGroup.value = null;
		if (!request) return;
		selection.value = request.selection ?? defaultSelection(request.combo);
		qty.value = request.qty;
		nextTick(() => sheetRef.value?.focus({ preventScroll: true }));
	},
	{ immediate: true },
);

const availability = computed(() => ({
	blockSaleBeyondAvailable: props.blockSaleBeyondAvailable,
	comboQty: qty.value,
}));

const statusOf = (group: ChoiceGroup) => groupStatus(selection.value, group);
const countOf = (group: ChoiceGroup, option: ChoiceOption) =>
	optionPickCount(selection.value, group, option.item_code);
const soldOut = (option: ChoiceOption) => isOptionSoldOut(option, availability.value);
const canAddMore = (group: ChoiceGroup, option: ChoiceOption) =>
	statusOf(group).picked < group.max && canPickMore(option, countOf(group, option), availability.value);

const complete = computed(() =>
	pending.value ? isSelectionComplete(pending.value.combo, selection.value) : false,
);

/** Where 1–9 land: the first unanswered group, else the one last touched. */
const activeGroup = computed<ChoiceGroup | null>(() => {
	const combo = pending.value?.combo;
	if (!combo) return null;
	const choosable = combo.groups.filter((group) => !isFixedGroup(group));
	const missing = choosable.find((group) => !groupStatus(selection.value, group).satisfied);
	return missing ?? choosable.find((group) => group.name === lastGroup.value) ?? choosable[0] ?? null;
});

const unitPrice = computed(() =>
	pending.value ? selectionUnitPrice(pending.value.combo, selection.value) : 0,
);
const total = computed(() => unitPrice.value * qty.value);
const saving = computed(() =>
	pending.value ? selectionSaving(pending.value.combo, selection.value) * qty.value : 0,
);
const summary = computed(() =>
	pending.value ? describeSelection(pending.value.combo, selection.value) : "",
);

const confirmLabel = computed(() => {
	if (!complete.value && pending.value) {
		const missing = firstIncompleteGroup(pending.value.combo, selection.value);
		if (missing) return __("Choose {0}", [missing.name]);
	}
	return pending.value?.editing ? __("Update") : __("Add");
});

const ruleLabel = (group: ChoiceGroup): string => {
	if (isFixedGroup(group)) return __("Included");
	if (group.min === 0) return __("Optional · up to {0}", [group.max]);
	if (group.min === group.max) return __("Pick {0}", [group.min]);
	return __("Pick {0} to {1}", [group.min, group.max]);
};

const includedLabel = (group: ChoiceGroup): string =>
	group.options
		.map((option) => {
			const count = countOf(group, option);
			return count > 1 ? `${count} × ${option.item_name}` : option.item_name;
		})
		.join(" · ");

const initialOf = (option: ChoiceOption): string =>
	(option.item_name || option.item_code).trim().charAt(0).toUpperCase();

const touch = (group: ChoiceGroup) => {
	lastGroup.value = group.name;
};

const tap = (group: ChoiceGroup, option: ChoiceOption) => {
	touch(group);
	const already = countOf(group, option);
	// A multi-pick group adds on tap; refuse quietly when the shelf is out —
	// the stepper's disabled "+" already says so.
	if (group.max > 1 && !canPickMore(option, already, availability.value)) return;
	if (group.max === 1 && already === 0 && soldOut(option)) return;
	selection.value = tapPick(selection.value, group, option.item_code);
};

const add = (group: ChoiceGroup, option: ChoiceOption) => {
	touch(group);
	if (!canAddMore(group, option)) return;
	selection.value = addPick(selection.value, group, option.item_code);
};

const remove = (group: ChoiceGroup, option: ChoiceOption) => {
	touch(group);
	selection.value = removePick(selection.value, group, option.item_code);
};

const setQty = (value: number) => {
	qty.value = Math.max(1, Math.min(99, Math.trunc(value) || 1));
};

const scrollToMissing = () => {
	const combo = pending.value?.combo;
	if (!combo) return;
	const missing = firstIncompleteGroup(combo, selection.value);
	if (!missing) return;
	const escaped =
		typeof CSS !== "undefined" && typeof CSS.escape === "function"
			? CSS.escape(missing.name)
			: missing.name.replace(/["\\]/g, "\\$&");
	const target = bodyRef.value?.querySelector<HTMLElement>(`[data-group="${escaped}"]`);
	target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
};

const confirm = () => {
	if (!pending.value) return;
	if (!complete.value) {
		showMissing.value = true;
		scrollToMissing();
		return;
	}
	settleComboChoice({ selection: selection.value, qty: qty.value });
};

const cancel = () => settleComboChoice(null);

const onDialogToggle = (value: boolean) => {
	if (!value) cancel();
};

const onKeydown = (event: KeyboardEvent) => {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	if (event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		confirm();
		return;
	}
	if (event.key === "+" || event.key === "-") {
		event.preventDefault();
		event.stopPropagation();
		setQty(qty.value + (event.key === "+" ? 1 : -1));
		return;
	}
	if (/^[1-9]$/.test(event.key)) {
		const group = activeGroup.value;
		const option = group?.options[Number(event.key) - 1];
		event.preventDefault();
		event.stopPropagation();
		if (group && option) tap(group, option);
	}
};
</script>

<style scoped>
.paquete-sheet {
	display: flex;
	flex-direction: column;
	min-height: 0;
	max-height: 100%;
	height: 100%;
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	outline: none;
	border-radius: var(--reg-radius-lg, 16px);
	overflow: hidden;
}

:global(.v-dialog--fullscreen) .paquete-sheet {
	border-radius: 0;
}

.paquete-sheet__head {
	flex: none;
	display: grid;
	grid-template-columns: auto 1fr auto;
	gap: 12px;
	align-items: center;
	padding: 14px 16px;
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

.paquete-sheet__thumb {
	width: 52px;
	height: 52px;
	border-radius: 12px;
	display: grid;
	place-items: center;
	overflow: hidden;
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.paquete-sheet__thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.paquete-sheet__titles {
	display: flex;
	flex-direction: column;
	min-width: 0;
	line-height: 1.2;
}

.paquete-sheet__eyebrow {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.paquete-sheet__name {
	margin: 2px 0;
	font-size: 18px;
	font-weight: 700;
	overflow-wrap: anywhere;
}

.paquete-sheet__base {
	font-size: 13px;
	color: var(--reg-text-muted, #667085);
}

.paquete-sheet__close {
	width: 44px;
	height: 44px;
	display: grid;
	place-items: center;
	border: 0;
	border-radius: 12px;
	background: transparent;
	color: var(--reg-text-secondary, #475467);
	cursor: pointer;
}

.paquete-sheet__close:hover,
.paquete-sheet__close:focus-visible {
	background: var(--reg-surface-muted, #f2f4f7);
}

.paquete-sheet__body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 6px 16px 16px;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.paquete-group {
	margin-top: 12px;
	padding: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: 14px;
	background: var(--reg-surface, #fff);
	transition: border-color 140ms, box-shadow 140ms;
}

.paquete-group--active {
	border-color: var(--reg-accent-edge, #9fdde6);
}

.paquete-group--missing {
	border-color: var(--reg-tone-negative-border, #f3b0a9);
	box-shadow: 0 0 0 3px var(--reg-tone-negative-bg, #fdf2f1);
}

.paquete-group__head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 10px;
	min-width: 0;
}

.paquete-group__step {
	flex: none;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 12px;
	font-weight: 700;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #475467);
}

.paquete-group__name {
	font-weight: 700;
	font-size: 15px;
	min-width: 0;
	overflow-wrap: anywhere;
}

.paquete-group__rule {
	margin-inline-start: auto;
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	font-weight: 600;
	padding: 3px 9px;
	border-radius: 999px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.paquete-group__rule--done {
	background: var(--reg-tone-positive-bg, #ecfdf3);
	color: var(--reg-tone-positive-label, #067647);
}

.paquete-group__rule--missing {
	background: var(--reg-tone-negative-bg, #fdf2f1);
	color: var(--reg-tone-negative-label, #b42318);
}

.paquete-group__included {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0;
	font-size: 14px;
	color: var(--reg-text-secondary, #475467);
}

/* 180px on the desk, so «Café americano» wraps between words and never
   inside one; the phone's own floor is below. Cards keep their own height —
   a stepper opening on one must not stretch its neighbours. */
.paquete-group__options {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
	align-items: start;
	gap: 8px;
}

.paquete-option {
	display: flex;
	flex-direction: column;
	min-width: 0;
	border: 1.5px solid var(--reg-border, #dce3e8);
	border-radius: 12px;
	background: var(--reg-surface, #fff);
	overflow: hidden;
	transition: border-color 140ms, background 140ms;
}

.paquete-option--on {
	border-color: var(--reg-accent, #0097a7);
	background: var(--reg-accent-soft, #e0f7fa);
}

.paquete-option--soldout {
	opacity: 0.55;
}

.paquete-option__tap {
	position: relative;
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	min-height: 56px;
	padding: 8px 10px;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: start;
	cursor: pointer;
}

.paquete-option__tap:disabled {
	cursor: not-allowed;
}

.paquete-option__tap:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: -2px;
	border-radius: 11px;
}

.paquete-option__thumb {
	flex: none;
	width: 40px;
	height: 40px;
	border-radius: 9px;
	overflow: hidden;
	display: grid;
	place-items: center;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.paquete-option__thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.paquete-option__initial {
	font-weight: 700;
	color: var(--reg-text-muted, #667085);
}

.paquete-option__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1;
	line-height: 1.25;
}

.paquete-option__name {
	font-size: 14px;
	font-weight: 600;
	overflow-wrap: break-word;
}

.paquete-option__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	font-size: 12px;
}

.paquete-option__extra {
	font-weight: 700;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.paquete-option__soldout {
	font-weight: 600;
	color: var(--reg-tone-negative-label, #b42318);
}

/* The tick is a FIGURE, not an action: accent ink on the card's own pale
   selected surface. The one accent FILL on this sheet is its primary. */
.paquete-option__check {
	flex: none;
	width: 26px;
	height: 26px;
	border-radius: 50%;
	display: grid;
	place-items: center;
	border: 1.5px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-surface, #fff);
	color: var(--reg-accent-pressed, #00838f);
}

.paquete-option__key {
	flex: none;
	min-width: 22px;
	height: 22px;
	padding: 0 5px;
	border-radius: 6px;
	border: 1px solid var(--reg-border, #dce3e8);
	font: 600 11px/20px "Roboto Mono", ui-monospace, monospace;
	text-align: center;
	color: var(--reg-text-muted, #667085);
	background: var(--reg-surface, #fff);
}

.paquete-option__stepper {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	padding: 4px 6px 6px;
}

.paquete-option__stepper button,
.paquete-sheet__qty button {
	width: 40px;
	height: 40px;
	display: grid;
	place-items: center;
	border: 1px solid var(--reg-border, #dce3e8);
	border-radius: 10px;
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	cursor: pointer;
}

.paquete-option__stepper button:disabled,
.paquete-sheet__qty button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.paquete-option__stepper .reg-mono,
.paquete-sheet__qty .reg-mono {
	min-width: 22px;
	text-align: center;
	font-weight: 700;
}

.paquete-sheet__foot {
	flex: none;
	display: grid;
	grid-template-columns: auto 1fr auto;
	gap: 12px;
	align-items: center;
	padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
	border-top: 1px solid var(--reg-divider, #eceff3);
	background: var(--reg-surface, #fff);
}

.paquete-sheet__qty {
	display: flex;
	align-items: center;
	gap: 6px;
}

.paquete-sheet__sum {
	display: flex;
	flex-direction: column;
	min-width: 0;
	line-height: 1.25;
}

.paquete-sheet__picked {
	font-size: 13px;
	color: var(--reg-text-secondary, #475467);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.paquete-sheet__saving {
	font-size: 12px;
	font-weight: 700;
	color: var(--reg-tone-positive-label, #067647);
}

.paquete-sheet__primary {
	display: inline-flex;
	align-items: center;
	gap: 12px;
	min-height: 48px;
	padding: 0 18px;
	border: 0;
	border-radius: 12px;
	background: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #fff);
	font: inherit;
	font-weight: 700;
	cursor: pointer;
}

.paquete-sheet__primary--blocked {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-secondary, #475467);
}

.paquete-sheet__primary:focus-visible {
	outline: 2px solid var(--reg-accent-pressed, #00838f);
	outline-offset: 2px;
}

.paquete-sheet__primary-total {
	font-size: 16px;
}

/* A phone keeps the whole footer on screen: summary on its own row, the
   quantity and the confirm below it, the confirm taking the width. */
@media (max-width: 599.98px) {
	.paquete-sheet__foot {
		grid-template-columns: auto 1fr;
		grid-template-areas:
			"sum sum"
			"qty confirm";
	}
	.paquete-sheet__sum {
		grid-area: sum;
	}
	.paquete-sheet__qty {
		grid-area: qty;
	}
	.paquete-sheet__primary {
		grid-area: confirm;
		justify-content: space-between;
	}
	.paquete-group__options {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
	}
}

@media (prefers-reduced-motion: reduce) {
	.paquete-group,
	.paquete-option {
		transition: none;
	}
}
</style>
