<template>
	<button
		type="button"
		class="mbrowse-card"
		:class="{
			'mbrowse-card--combo': card.kind === 'combo',
			'mbrowse-card--compatible': card.compatible,
		}"
		:data-testid="`browse-card-${card.item_code}`"
		:data-card-kind="card.kind"
		:data-compatible="card.compatible ? 'true' : 'false'"
		:aria-label="ariaLabel"
		@click="onActivate"
	>
		<span class="mbrowse-card__well">
			<img
				v-if="card.image"
				class="mbrowse-card__image"
				:src="card.image"
				alt=""
				loading="lazy"
			/>
			<v-icon
				v-else
				class="mbrowse-card__glyph"
				:icon="card.kind === 'combo' ? 'mdi-package-variant-closed' : 'mdi-cellphone'"
				size="30"
				aria-hidden="true"
			/>
			<!--
				The affordance, not the target. The whole card is the button —
				the artboard's footer says "toca una tarjeta para agregarla" —
				so this 24px square is decoration that shows WHERE the tap
				lands, and is hidden from assistive tech rather than announced
				as a second control the keyboard would have to visit.
			-->
			<span class="mbrowse-card__add" aria-hidden="true">
				<v-icon icon="mdi-plus" size="13" />
			</span>
		</span>

		<span class="mbrowse-card__name">{{ card.item_name }}</span>
		<span
			v-if="card.subtitle"
			class="mbrowse-card__subtitle"
			:class="{ 'mbrowse-card__subtitle--parts': card.kind === 'combo' }"
			>{{ card.subtitle }}</span
		>

		<span class="mbrowse-card__foot">
			<span class="mbrowse-card__price reg-mono" data-money-role="card-price">{{
				priceLabel
			}}</span>
			<span
				v-if="card.chip"
				class="mbrowse-card__chip"
				:class="`mbrowse-card__chip--${chipTone}`"
				:data-chip-kind="card.chip.kind"
				:data-money-role="card.chip.kind === 'saving' ? 'card-saving' : undefined"
				>{{ chipLabel }}</span
			>
		</span>
	</button>
</template>

<script setup lang="ts">
/**
 * One card in the phone's browse grid (`MovilExplorar.dc.html`, nodes 22-33).
 *
 * The card decides nothing. `browseCatalog.ts` already resolved which chip it
 * carries, whether that chip is low, and whether it is compatible; this draws
 * that answer. Keeping the judgement in a pure module and the paint here is
 * what lets the stock rule be tested without a DOM and the tap target be
 * tested without a stock fixture.
 *
 * The chip's ABSENCE is the load-bearing case. `card.chip === null` means the
 * register does not know the level — a service with no shelf, an offline row,
 * a payload with no figure — and a card with no chip is the correct render.
 * `describeLineStock` explains at length why that must never become a `0`.
 */
import { computed } from "vue";

import { defaultTranslate, type BrowseCard, type BrowseTranslate } from "./browseCatalog";

defineOptions({ name: "MobileBrowseCard" });

/** The desk's translator, reached the way every other component here reaches it. */
const __: BrowseTranslate = window.__ ?? defaultTranslate;

const props = defineProps<{
	card: BrowseCard;
	/** The shell owns the register's currency; this never formats money itself. */
	formatCurrency: (_value: number) => string;
}>();

// `defineEmits`' return, not the template's `$emit`: in `<script setup>` the
// setup proxy has no `$emit` bound, so an inline `@click="$emit('add')"`
// compiles and then never fires (build plan §10).
const emit = defineEmits<{ (_event: "add", _card: BrowseCard): void }>();

const priceLabel = computed(() => props.formatCurrency(props.card.rate));

const chipTone = computed(() => {
	const chip = props.card.chip;
	if (!chip) return "neutral";
	if (chip.kind === "saving") return "positive";
	// An affordance, not a state: the chip says "tapping opens a picker",
	// which is neither good nor bad news about the shelf.
	if (chip.kind === "variants") return "neutral";
	return chip.low ? "warning" : "positive";
});

/**
 * `quedan 2` when the shelf is thin, a bare count when it is not — the
 * artboard's `últimas 2` versus its bare `8`. The words are the ones the
 * up-sell strip and the combo cart line already use (`left`, `saves`), so the
 * three surfaces speak one vocabulary and the translation already exists.
 */
const chipLabel = computed(() => {
	const chip = props.card.chip;
	if (!chip) return "";
	if (chip.kind === "saving") return `−${props.formatCurrency(chip.amount)}`;
	if (chip.kind === "variants") return __("Variants");
	return chip.low ? `${__("left")} ${chip.value}` : String(chip.value);
});

/**
 * What a screen reader hears. The visible chip is a bare number in the healthy
 * case, which is meaningless read aloud, so the label spells out the unit —
 * mirroring `ComboSuggestionStrip.vue`'s tile label rather than inventing a
 * second phrasing for the same fact.
 */
const ariaLabel = computed(() => {
	const parts = [`${__("Add")} ${props.card.item_name}`, priceLabel.value];
	const chip = props.card.chip;
	if (chip?.kind === "saving") parts.push(`${__("saves")} ${props.formatCurrency(chip.amount)}`);
	if (chip?.kind === "variants") parts.push(__("This is an item template. Please choose a variant."));
	if (chip?.kind === "stock") {
		parts.push(chip.low ? `${__("left")} ${chip.value}` : `${chip.value} ${__("pcs")}`);
	}
	return parts.join(", ");
});

const onActivate = () => emit("add", props.card);
</script>

<style scoped>
.mbrowse-card {
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	text-align: left;
	border: 1px solid var(--reg-divider, #eceff3);
	border-radius: 12px;
	background: var(--reg-surface, #ffffff);
	padding: 7px;
	cursor: pointer;
	font: inherit;
	color: var(--reg-text-primary, #212121);
}

/*
 * A combo is a STATE of the grid, not an emphasis: the warning tone marks it
 * the same way the band marks a shortfall. The one saturated colour on this
 * screen belongs to the primary action in the dock, and a wall of cards is
 * exactly where a second one would start competing (§17.7 invariant 2).
 */
.mbrowse-card--combo {
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
}

.mbrowse-card__well {
	position: relative;
	display: grid;
	place-items: center;
	width: 100%;
	height: 78px;
	border-radius: 9px;
	background: var(--reg-surface-sunken, #f8f9fa);
	overflow: hidden;
}

.mbrowse-card--combo .mbrowse-card__well {
	background: var(--reg-surface, #ffffff);
}

.mbrowse-card__image {
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
}

.mbrowse-card__glyph {
	color: var(--reg-text-muted, #667085);
}

.mbrowse-card__add {
	position: absolute;
	right: 4px;
	bottom: 4px;
	display: grid;
	place-items: center;
	width: 24px;
	height: 24px;
	border-radius: 8px;
	/* The pale wash, never the saturated accent — a fill reserved for the
	   primary action. `--reg-accent-soft` is the canvas's own `--ac-soft`. */
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.mbrowse-card__name {
	font-size: 11.5px;
	line-height: 1.22;
	margin: 6px 0 2px;
	/* Two lines, clamped: the grid is a fixed two columns and a third line
	   would shunt the price out of alignment across the row. */
	height: 28px;
	overflow: hidden;
}

.mbrowse-card__subtitle {
	font-size: 9.5px;
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

.mbrowse-card__subtitle--parts {
	/* Component names are prose, not a code — and they carry the combo's tone. */
	font-family: inherit;
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mbrowse-card__foot {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 6px;
	margin-top: 3px;
}

.mbrowse-card__price {
	font-size: 13.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.mbrowse-card__chip {
	white-space: nowrap;
	border-radius: 999px;
	font-size: 10px;
	font-weight: 700;
	padding: 1px 6px;
}

.mbrowse-card__chip--positive {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.mbrowse-card__chip--warning {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

/* «Variantes» — an affordance, not a state: muted, never green or amber. */
.mbrowse-card__chip--neutral {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.mbrowse-card--combo .mbrowse-card__chip--warning,
.mbrowse-card--combo .mbrowse-card__chip--positive {
	/* The combo card is already tinted; a same-tone chip on it would vanish. */
	background: var(--reg-surface, #ffffff);
}

.mbrowse-card--compatible {
	/* A hairline, not a fill. The compatible SET is the filter's job; this only
	   keeps the marking visible when the filter is off and the grid is mixed. */
	border-color: var(--reg-accent-edge, #9fdde6);
}

.mbrowse-card:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 2px;
}

@media (pointer: coarse) {
	.mbrowse-card {
		/* Well above the floor already, but stated so the sweep can read it
		   off this file rather than infer it from the well's height. */
		min-height: var(--reg-touch-min, 44px);
	}
}
</style>
