<template>
	<section class="mbrowse" data-testid="mobile-browse">
		<header class="mbrowse__head">
			<div class="mbrowse__title-row">
				<div class="mbrowse__title-copy">
					<h2 class="mbrowse__title">{{ __("Browse catalogue") }}</h2>
					<p class="mbrowse__meta" data-testid="browse-meta">{{ metaLine }}</p>
				</div>
				<span
					class="mbrowse__chip mbrowse__chip--state"
					:class="online ? 'mbrowse__chip--online' : 'mbrowse__chip--offline'"
					data-testid="browse-connection"
					>{{ online ? __("Online") : __("Offline") }}</span
				>
			</div>

			<!--
				The search ROW, not a search FIELD. `useScannerInput` attaches the
				keyboard wedge to the DOCUMENT and `preventDefault()`s the keys it
				maps, and `ItemsSelector` owns the one input the wedge writes into.
				A second text input here would fight both — so this is a button
				that hands focus back to that field. Build plan §10 records what
				happens when this component tree stops respecting the wedge.
			-->
			<button
				type="button"
				class="mbrowse__search"
				data-testid="browse-search"
				:aria-label="__('Search')"
				@click="emit('search')"
			>
				<v-icon icon="mdi-magnify" size="17" aria-hidden="true" />
				<span
					class="mbrowse__query"
					:class="{ 'mbrowse__query--empty': !query }"
					data-testid="browse-query"
					>{{ query || __("Search") }}</span
				>
				<v-icon icon="mdi-barcode-scan" size="18" aria-hidden="true" />
			</button>

			<div class="mbrowse__chips" role="group" :aria-label="__('Browse catalogue')">
				<button
					v-if="compatibleOffered"
					type="button"
					class="mbrowse__chip mbrowse__chip--filter mbrowse__chip--compatible"
					:class="{ 'mbrowse__chip--on': compatibleOnly }"
					:data-testid="`browse-filter-${COMPATIBLE_FILTER_ID}`"
					:aria-pressed="compatibleOnly ? 'true' : 'false'"
					@click="toggleCompatible"
				>
					{{ __("Compatible") }}
				</button>
				<button
					v-for="category in categories"
					:key="category.id"
					type="button"
					class="mbrowse__chip mbrowse__chip--filter"
					:class="{
						'mbrowse__chip--on': category.id === activeCategoryId,
						'mbrowse__chip--featured': category.featured,
					}"
					:data-testid="`browse-category-${category.id}`"
					:data-count="category.count ?? undefined"
					:aria-pressed="category.id === activeCategoryId ? 'true' : 'false'"
					@click="toggleCategory(category.id)"
				>
					{{ category.label }}
					<span v-if="category.count != null" class="mbrowse__chip-count reg-mono">{{
						category.count
					}}</span>
				</button>
			</div>
		</header>

		<div class="mbrowse__grid-wrap">
			<div v-if="cards.length" class="mbrowse__grid" data-testid="browse-grid">
				<MobileBrowseCard
					v-for="card in cards"
					:key="`${card.kind}:${card.item_code}`"
					:card="card"
					:format-currency="formatCurrency"
					@add="onAdd"
				/>
			</div>
			<!-- The register's own empty-state wording, not a second phrasing of it. -->
			<p v-else class="mbrowse__empty" data-testid="browse-empty">
				{{ __("No items found") }}
			</p>
		</div>

		<footer class="mbrowse__foot" data-testid="browse-footer">
			<div class="mbrowse__foot-copy">
				<div class="mbrowse__foot-count" data-testid="browse-count">{{ footer.countLine }}</div>
				<div class="mbrowse__foot-hint">{{ footer.hint }}</div>
			</div>
			<button
				v-if="footer.seeAllLabel"
				type="button"
				class="mbrowse__chip mbrowse__chip--see-all"
				data-testid="browse-see-all"
				@click="clearFilters"
			>
				{{ footer.seeAllLabel }}
			</button>
		</footer>
	</section>
</template>

<script setup lang="ts">
/**
 * `MovilExplorar` — the phone's catalogue screen.
 *
 * This is CHROME, not a second catalogue. The items, the combos and the search
 * query all arrive as props from the register that already loaded them;
 * `ItemsSelector.vue` stays mounted and stays the owner of the search input and
 * of the barcode wedge. Nothing here fetches, and nothing here may be mounted
 * in a way that unmounts that component — build plan §10 explains what that
 * costs a shop.
 *
 * The screen's own state is two chips: which category is selected, and whether
 * the compatible filter is on. Everything else is derived by the pure modules
 * beside this file, so the interesting rules — what "compatible" contains, what
 * a chip's count means, when a stock figure may be drawn — are testable without
 * a DOM and are asserted there rather than through a render.
 *
 * On the compatible filter DEFAULTING to on: it is only ever offered when a
 * device on the ticket has combos authored for it, the chip renders visibly
 * pressed, and "See all N" sits in the footer. A cashier who scanned a phone
 * and then went looking for a case is asking exactly this question, and the
 * escape is one tap. The default resets when the device changes, so a filter
 * turned off for one customer does not silently persist into the next sale.
 */
import { computed, ref, watch } from "vue";

import type { ComboAvailabilityContext } from "../../../../composables/pos/combos/comboAvailability";
import type { ComboOffer } from "../../../../composables/pos/combos/comboCatalog";
import {
	buildBrowseCards,
	buildBrowseCategories,
	buildBrowseFooter,
	defaultTranslate,
	filterBrowseCards,
	formatCount,
	type BrowseCard,
	type BrowseCatalogItem,
	type BrowseTranslate,
} from "./browseCatalog";
import {
	COMPATIBLE_FILTER_ID,
	offersCompatibleFilter,
	resolveCompatibilityScope,
} from "./browseCompatibility";
import MobileBrowseCard from "./MobileBrowseCard.vue";

defineOptions({ name: "MobileBrowseScreen" });

const props = withDefaults(
	defineProps<{
		/** The catalogue rows currently listed — the register's search result. */
		items?: readonly BrowseCatalogItem[];
		/** The register's combos, from `useComboOffers`. */
		combos?: readonly ComboOffer[];
		/** The ticket, as lines or codes. Identifies the device to match against. */
		cart?: readonly (string | { item_code?: unknown })[];
		/** An explicitly known device. Nothing supplies this yet — see the model. */
		deviceItemCode?: string | null;
		deviceNames?: Record<string, string>;
		/** `posa_low_stock_alert_threshold` off the POS Profile. */
		lowStockThreshold?: number;
		availabilityContext?: ComboAvailabilityContext;
		/** The live query, owned and echoed by `ItemsSelector`'s search field. */
		query?: string;
		/** The whole catalogue's size — the header's "1,482 artículos". */
		catalogueCount?: number;
		/** "Caja 2". */
		registerLabel?: string;
		online?: boolean;
		formatCurrency: (_value: number) => string;
	}>(),
	{
		items: () => [],
		combos: () => [],
		cart: () => [],
		deviceItemCode: null,
		deviceNames: () => ({}),
		lowStockThreshold: 0,
		availabilityContext: () => ({}),
		query: "",
		catalogueCount: 0,
		registerLabel: "",
		online: true,
	},
);

const emit = defineEmits<{
	(_event: "add", _card: BrowseCard): void;
	/** Focus the register's ONE search field. This screen never owns an input. */
	(_event: "search"): void;
}>();

/**
 * The desk's translator, as the rest of this tree reaches it. The fallback is
 * `defaultTranslate` rather than an identity because this screen's strings
 * carry `{0}` placeholders: an identity would print the braces at a customer.
 */
const __: BrowseTranslate = window.__ ?? defaultTranslate;

const scope = computed(() =>
	resolveCompatibilityScope({
		combos: props.combos,
		cart: props.cart,
		deviceItemCode: props.deviceItemCode,
		deviceNames: props.deviceNames,
	}),
);

const compatibleOffered = computed(() => offersCompatibleFilter(scope.value));

/** null = never touched, so the default applies. */
const compatibleOverride = ref<boolean | null>(null);
const categoryOverride = ref<string | null>(null);

watch(
	() => scope.value.deviceItemCode,
	() => {
		compatibleOverride.value = null;
	},
);

const compatibleOnly = computed(
	() => compatibleOffered.value && (compatibleOverride.value ?? true),
);

const allCards = computed(() =>
	buildBrowseCards({
		items: props.items,
		combos: props.combos,
		scope: scope.value,
		lowStockThreshold: props.lowStockThreshold,
		availabilityContext: props.availabilityContext,
	}),
);

/** The compatible narrowing alone — what the category chips count over. */
const scopedCards = computed(() =>
	filterBrowseCards(allCards.value, {
		compatibleOnly: compatibleOnly.value,
		scope: scope.value,
	}),
);

const categories = computed(() => buildBrowseCategories(scopedCards.value, __));

/**
 * A remembered category that the current scope no longer offers selects
 * nothing rather than emptying the grid — narrowing to "Fundas" and then
 * switching to a phone with no cases must show the other accessories, not a
 * blank screen with a chip nobody can see.
 */
const activeCategoryId = computed(() =>
	categories.value.some((category) => category.id === categoryOverride.value)
		? categoryOverride.value
		: null,
);

const cards = computed(() =>
	filterBrowseCards(allCards.value, {
		compatibleOnly: compatibleOnly.value,
		scope: scope.value,
		categoryId: activeCategoryId.value,
	}),
);

const footer = computed(() =>
	buildBrowseFooter({
		shownCount: cards.value.length,
		totalCount: allCards.value.length,
		scope: scope.value,
		compatibleOnly: compatibleOnly.value,
		translate: __,
	}),
);

const metaLine = computed(() => {
	const count = `${formatCount(props.catalogueCount)} ${__("items")}`;
	return props.registerLabel ? `${count} · ${props.registerLabel}` : count;
});

const toggleCompatible = () => {
	compatibleOverride.value = !compatibleOnly.value;
};

const toggleCategory = (id: string) => {
	categoryOverride.value = activeCategoryId.value === id ? null : id;
};

const clearFilters = () => {
	categoryOverride.value = null;
	if (compatibleOffered.value) compatibleOverride.value = false;
};

const onAdd = (card: BrowseCard) => emit("add", card);
</script>

<style scoped>
.mbrowse {
	display: flex;
	flex-direction: column;
	/*
	 * The phone keeps an explicit height for the same reason
	 * `useItemsSelectorPanelSizing` gives the selector one: below 768px the
	 * document scrolls and the fixed dock eats the bottom, so a panel that
	 * sizes itself off its content ends up with its last row under the dock.
	 * The grid is the single scrollport; this element never scrolls.
	 */
	height: calc(var(--viewport-height, 100vh) - var(--bottom-safe-space, 0px));
	min-height: 0;
	overflow: hidden;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.mbrowse__head {
	flex: none;
	background: var(--reg-surface, #ffffff);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
	padding: 13px 14px 11px;
}

.mbrowse__title-row {
	display: flex;
	align-items: center;
	gap: 9px;
}

.mbrowse__title-copy {
	flex: 1;
	min-width: 0;
	line-height: 1.15;
}

.mbrowse__title {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	margin: 0;
}

.mbrowse__meta {
	font-size: 9.5px;
	color: var(--reg-text-muted, #667085);
	margin: 0;
}

.mbrowse__search {
	display: flex;
	align-items: center;
	gap: 9px;
	width: 100%;
	margin-top: 11px;
	height: 44px;
	/* An outline, not a fill: the saturated accent marks the field the cashier
	   types into without becoming a second emphasis on a screen full of cards. */
	border: 2px solid var(--reg-accent, #0097a7);
	border-radius: 11px;
	padding: 0 12px;
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	cursor: pointer;
	font: inherit;
}

.mbrowse__query {
	flex: 1;
	min-width: 0;
	text-align: left;
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
	font-size: 14px;
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mbrowse__query--empty {
	font-weight: 500;
	opacity: 0.75;
}

.mbrowse__chips {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 9px;
	overflow-x: auto;
	/* The row scrolls rather than capping the chip count: a hidden category is
	   a slice of the catalogue nobody can reach from here. */
	scrollbar-width: none;
}

.mbrowse__chips::-webkit-scrollbar {
	display: none;
}

.mbrowse__chip {
	position: relative;
	white-space: nowrap;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	border: 0;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 500;
	padding: 5px 11px;
	font-family: inherit;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
}

.mbrowse__chip--filter {
	cursor: pointer;
}

.mbrowse__chip--state {
	font-weight: 500;
	padding: 3px 8px;
}

.mbrowse__chip--online {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.mbrowse__chip--offline {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.mbrowse__chip--featured {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.mbrowse__chip--compatible,
.mbrowse__chip--see-all {
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.mbrowse__chip--see-all {
	cursor: pointer;
}

.mbrowse__chip--on {
	box-shadow: inset 0 0 0 1.5px var(--reg-accent-edge, #9fdde6);
}

.mbrowse__chip-count {
	font-weight: 700;
	opacity: 0.8;
}

.mbrowse__chip:focus-visible,
.mbrowse__search:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 2px;
}

.mbrowse__grid-wrap {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 10px 11px 0;
}

.mbrowse__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
	align-content: start;
}

.mbrowse__empty {
	text-align: center;
	font-size: 12px;
	color: var(--reg-text-muted, #667085);
	padding: 32px 0;
	margin: 0;
}

.mbrowse__foot {
	flex: none;
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 10px 11px;
	padding: 11px 13px;
	border-radius: 12px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	background: var(--reg-surface, #ffffff);
}

.mbrowse__foot-copy {
	flex: 1;
	min-width: 0;
	line-height: 1.2;
}

.mbrowse__foot-count {
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
}

.mbrowse__foot-hint {
	font-size: 12.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

@media (pointer: coarse) {
	/*
	 * The chips keep the artboard's 24-30px pill and get a 44px HIT AREA from
	 * a pseudo-element that grows vertically only. Growing horizontally would
	 * overlap the neighbouring chip's box and hand a tap to the wrong filter,
	 * which on this screen means silently changing what the cashier is looking
	 * at. Vertical growth costs nothing: the row is the only thing at that y.
	 */
	.mbrowse__chip--filter::after,
	.mbrowse__chip--see-all::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: var(--reg-touch-min, 44px);
		transform: translateY(-50%);
	}

	.mbrowse__chips {
		/* Room for the expanded hit areas, so they cannot spill onto the grid. */
		padding: 7px 0;
	}

	.mbrowse__search {
		min-height: var(--reg-touch-min, 44px);
	}
}
</style>
