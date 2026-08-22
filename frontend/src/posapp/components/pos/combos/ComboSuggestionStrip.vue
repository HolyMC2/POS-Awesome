<template>
	<!-- "Se suele llevar junto" — the artboard puts this in the band that used
	     to be empty under a short cart, so the space earns its keep without
	     costing the ticket any room when the cart is long. -->
	<section v-if="suggestions.length" class="upsell" data-testid="upsell-strip">
		<header class="upsell__head">
			<svg
				class="upsell__bolt"
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="#e9a13b"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M13 2 4.5 13H11l-1 9 8.5-11H12z" />
			</svg>
			<h3 class="upsell__title">{{ __("Often bought together") }}</h3>
			<span class="upsell__sub">{{ __("· combos and accessories that go together") }}</span>
			<div class="upsell__spacer"></div>
			<span class="upsell__hint">{{ __("Enter adds the first") }}</span>
		</header>

		<ul class="upsell__grid">
			<li
				v-for="(suggestion, index) in suggestions"
				:key="suggestion.item_code"
				class="upsell__cell"
			>
				<button
					type="button"
					class="upsell__tile"
					:class="{ 'upsell__tile--combo': suggestion.kind === 'combo' }"
					:data-testid="`upsell-tile-${suggestion.item_code}`"
					:data-upsell-kind="suggestion.kind"
					:data-availability="suggestion.availability?.reason || 'unknown'"
					:aria-label="tileLabel(suggestion)"
					:ref="index === 0 ? setFirstTile : undefined"
					@click="onAdd(suggestion)"
				>
					<span class="upsell__thumb">
						<img v-if="suggestion.image" :src="suggestion.image" :alt="''" />
					</span>
					<span class="upsell__body">
						<span class="upsell__name">{{ suggestion.item_name }}</span>
						<span class="upsell__meta mono">
							{{ formatCurrency(suggestion.rate) }}
							<span
								v-if="suggestion.kind === 'combo'"
								class="upsell__saving"
								data-testid="combo-saving"
								>· {{ __("saves") }} {{ formatCurrency(suggestion.saving || 0) }}</span
							>
							<span v-else class="upsell__qty"
								>· {{ suggestion.availableQty }} {{ __("pcs") }}</span
							>
							<!-- Combo stock rides beside the saving, and ONLY when the
							     answer is bounded and known — an all-labour combo is
							     unbounded and would otherwise print "Infinity". The
							     artboard draws no figure here at healthy stock, so it
							     appears only when the register calls the level low;
							     that is when it earns the width. -->
							<span
								v-if="suggestion.kind === 'combo' && showsStock(suggestion)"
								class="upsell__low"
								data-testid="upsell-stock"
								>· {{ __("left") }} {{ suggestion.availability?.value }}</span
							>
						</span>
					</span>
					<!-- The only place the brand accent appears in this strip, and it
					     is a soft container rather than a filled button: the ONE
					     saturated accent on the screen belongs to the band's primary
					     action (§17.7 invariant 2). -->
					<span class="upsell__add" aria-hidden="true">
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#00646f"
							stroke-width="2.6"
							stroke-linecap="round"
						>
							<path d="M12 5v14M5 12h14" />
						</svg>
					</span>
				</button>
			</li>
		</ul>
	</section>
</template>

<script setup lang="ts">
import { ref } from "vue";

import type { ComboSuggestion } from "../../../composables/pos/combos/comboCatalog";

/**
 * A combo tile shows stock only when the figure is bounded, known AND low.
 * The first two are correctness — unbounded prints "Infinity", unknown prints
 * a 0 that reads as out-of-stock. The third is the artboard: at healthy stock
 * the tile stays as drawn, price and saving only.
 */
const showsStock = (suggestion: ComboSuggestion): boolean =>
	!!suggestion.availability?.show && suggestion.availability.isLow;

const __ = window.__ || ((value: string) => value);

const props = withDefaults(
	defineProps<{
		suggestions?: ComboSuggestion[];
		formatCurrency?: (_value: number) => string;
	}>(),
	{
		suggestions: () => [],
		formatCurrency: (value: number) => value.toFixed(2),
	},
);

const emit = defineEmits<{ (_event: "add", _suggestion: ComboSuggestion): void }>();

const onAdd = (suggestion: ComboSuggestion) => emit("add", suggestion);

/**
 * The first tile is kept addressable because the header promises "Enter para
 * agregar el primero"; the shell focuses it when the cart's Enter falls
 * through. Exposed rather than self-bound so the strip never steals a key the
 * scan field is using.
 */
const firstTile = ref<HTMLElement | null>(null);
const setFirstTile = (el: unknown) => {
	firstTile.value = (el as HTMLElement) ?? null;
};
defineExpose({ firstTile });

/**
 * Screen-reader label. The visual tile splits name, price and saving across
 * three nodes; read out separately they arrive as fragments, so the button
 * carries one sentence instead.
 */
const tileLabel = (suggestion: ComboSuggestion): string => {
	const price = props.formatCurrency(suggestion.rate);
	if (suggestion.kind === "combo") {
		const base = `${__("Add")} ${suggestion.item_name}, ${price}, ${__("saves")} ${props.formatCurrency(suggestion.saving || 0)}`;
		// Spoken too, not just tinted: colour alone is not an accessible way to
		// say "nearly out" (WCAG 2.2 AA, §5).
		return showsStock(suggestion)
			? `${base}, ${__("left")} ${suggestion.availability?.value}`
			: base;
	}
	return `${__("Add")} ${suggestion.item_name}, ${price}`;
};
</script>

<style scoped>
.upsell {
	padding: 10px 16px 0;
	display: flex;
	flex-direction: column;
	/* Takes leftover space and sits at the bottom of it, so a growing cart
	   squeezes the strip out rather than pushing the totals off screen. */
	flex: 1;
	min-height: 0;
	justify-content: flex-end;
}

.upsell__head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
}

.upsell__title {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #7b838f;
	margin: 0;
}

.upsell__sub,
.upsell__hint {
	font-size: 11px;
	color: #9aa2ae;
}

.upsell__spacer {
	flex: 1;
}

.upsell__grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 9px;
	list-style: none;
	margin: 0;
	padding: 0;
}

.upsell__tile {
	display: flex;
	align-items: center;
	gap: 9px;
	width: 100%;
	background: #fff;
	border: 1px solid #eceff3;
	border-radius: 10px;
	padding: 7px 9px;
	cursor: pointer;
	text-align: left;
	/* 44px touch minimum (§5) without inflating the artboard's 7px padding. */
	min-height: 44px;
}

.upsell__tile--combo {
	border-color: #f0dcae;
	background: #fdf9f0;
}

.upsell__thumb {
	width: 30px;
	height: 30px;
	border-radius: 7px;
	background: #f4f6f9;
	display: grid;
	place-items: center;
	flex: none;
	overflow: hidden;
}

.upsell__tile--combo .upsell__thumb {
	background: #fff;
}

.upsell__thumb img {
	max-width: 100%;
	max-height: 100%;
}

.upsell__body {
	min-width: 0;
	flex: 1;
	display: block;
}

.upsell__name {
	display: block;
	font-size: 11.5px;
	font-weight: 500;
	color: #212121;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.upsell__meta {
	display: block;
	font-size: 11px;
	font-weight: 700;
	color: #4a5260;
}

.upsell__qty {
	font-weight: 400;
	color: #9aa2ae;
}

.upsell__low {
	font-weight: 700;
	color: #8a5a0d;
}

.upsell__saving {
	font-weight: 400;
	color: #14603a;
}

.upsell__add {
	width: 22px;
	height: 22px;
	border-radius: 7px;
	background: var(--ac-soft, #e0f7fa);
	display: grid;
	place-items: center;
	flex: none;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
