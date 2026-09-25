<template>
	<section ref="rootEl" class="mbrowse" data-testid="mobile-browse">
		<header class="mbrowse__head">
			<!-- No title row (owner, 2026-08-26): «Explorar catálogo» restated
			     the dock tab under it and the connection chip restated the
			     navbar's indicator above it — both rows spent grid space saying
			     things already on screen. The search bar leads and the category
			     chips are the first thing under it: they ARE the browse
			     mechanism. ONE row of them, never scrolling sideways; what does
			     not fit waits behind «+N». -->

			<!--
				The search ROW, not a search FIELD. `useScannerInput` attaches the
				keyboard wedge to the DOCUMENT and `preventDefault()`s the keys it
				maps, and `ItemsSelector` owns the one input the wedge writes into.
				A second text input here would fight both — so this is a button
				that hands focus back to that field. Build plan §10 records what
				happens when this component tree stops respecting the wedge.
			-->
			<div class="mbrowse__search-row">
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
				<!-- One-tap way back to the full grid. After a search narrows
				     the cards (or a scan mis-types into the field) the only
				     alternative is backspacing on a phone keyboard. Own tap
				     target, like the scan glyph beside it. -->
				<span
					v-if="query"
					role="button"
					tabindex="0"
					class="mbrowse__scan"
					data-testid="browse-clear"
					:aria-label="__('Clear search')"
					@click.stop="emit('clear')"
					@keydown.enter.stop="emit('clear')"
				>
					<v-icon icon="mdi-close" size="18" aria-hidden="true" />
				</span>
				<!-- The camera scanner's door (artboard: the glyph inside the
				     bar IS the scan affordance). Its own tap target, stopping
				     propagation so it never doubles as "focus the field". -->
				<span
					role="button"
					tabindex="0"
					class="mbrowse__scan"
					data-testid="browse-scan"
					:aria-label="__('Scan barcode')"
					@click.stop="emit('scan')"
					@keydown.enter.stop="emit('scan')"
				>
					<v-icon icon="mdi-barcode-scan" size="18" aria-hidden="true" />
				</span>
			</button>

			<button type="button" class="mbrowse__settings" :aria-label="__('Catalogue settings')" @click="emit('settings')"><v-icon icon="mdi-tune" size="22" /></button>
			</div>

			<!--
				The category ROW. It stays above the grid in every product view —
				inside a category too, so switching is one tap rather than a trip
				back to the tiles. Width decides how many chips it shows
				(`fitCategoryRow`); the selected one is always among them and the
				rest wait behind «+N», which opens the full set inline. Wrapping,
				not sideways scrolling: the phone register does not scroll
				sideways anywhere (2026-09-22), and a chip off the edge is a
				category nobody knows is there.
			-->
			<div
				v-if="stripVisible"
				ref="stripEl"
				class="mbrowse__chips"
				role="group"
				:aria-label="__('Categories')"
				data-testid="browse-categories"
			>
				<button
					v-if="showBack"
					type="button"
					class="mbrowse__chip mbrowse__chip--icon"
					data-strip-fixed
					data-testid="browse-categories-back"
					:title="__('All categories')"
					@click="backToCategories"
				>
					<v-icon icon="mdi-arrow-left" size="20" aria-hidden="true" />
					<span class="mbrowse__sr">{{ __("All categories") }}</span>
				</button>
				<button
					v-if="compatibleOffered"
					type="button"
					class="mbrowse__chip mbrowse__chip--filter"
					:class="{ 'mbrowse__chip--on': compatibleOnly }"
					data-strip-fixed
					:data-testid="`browse-filter-${COMPATIBLE_FILTER_ID}`"
					:aria-pressed="compatibleOnly ? 'true' : 'false'"
					@click="toggleCompatible"
				>
					<v-icon v-if="compatibleOnly" icon="mdi-check" size="16" aria-hidden="true" />
					{{ __("Compatible") }}
				</button>
				<button
					v-for="category in shownCategories"
					:key="category.id"
					type="button"
					class="mbrowse__chip mbrowse__chip--filter"
					:class="{
						'mbrowse__chip--on': category.id === activeCategoryId,
						'mbrowse__chip--featured': category.featured,
					}"
					:data-strip-chip="category.id"
					:data-testid="`browse-category-${category.id}`"
					:data-count="category.count ?? undefined"
					:aria-pressed="category.id === activeCategoryId ? 'true' : 'false'"
					@click="toggleCategory(category.id)"
				>
					<v-icon
						v-if="category.id === activeCategoryId"
						icon="mdi-check"
						size="16"
						aria-hidden="true"
					/>
					{{ category.label }}
					<span v-if="category.count != null" class="mbrowse__chip-count reg-mono">{{
						category.count
					}}</span>
				</button>
				<button
					v-if="stripExpanded || hiddenCategoryCount > 0"
					type="button"
					class="mbrowse__chip mbrowse__chip--more"
					data-testid="browse-categories-more"
					:aria-expanded="stripExpanded ? 'true' : 'false'"
					:aria-label="
						stripExpanded
							? __('Show fewer categories')
							: __('Show {0} more categories', [hiddenCategoryCount])
					"
					@click="stripExpanded = !stripExpanded"
				>
					<v-icon v-if="stripExpanded" icon="mdi-chevron-up" size="20" aria-hidden="true" />
					<template v-else>
						<span class="reg-mono">+{{ hiddenCategoryCount }}</span>
						<v-icon icon="mdi-chevron-down" size="18" aria-hidden="true" />
					</template>
				</button>
			</div>
			<div v-if="showCategoryTiles" class="mbrowse__navigation">
				<strong>{{ __("Choose a category") }}</strong>
				<button
					type="button"
					class="mbrowse__nav-button"
					data-testid="browse-all-products"
					@click="showProducts = true"
				>
					<v-icon icon="mdi-view-grid-outline" size="18" aria-hidden="true" />
					{{ __("All products") }}
				</button>
			</div>
		</header>

		<div class="mbrowse__grid-wrap">
			<CategoryTiles v-if="showCategoryTiles" :categories="categories" @select="toggleCategory" />
			<div v-else-if="cards.length && !(loading && itemGroup !== 'ALL')" class="mbrowse__grid" data-testid="browse-grid">
				<MobileBrowseCard
					v-for="card in cards"
					:key="`${card.kind}:${card.item_code}`"
					:card="card"
					:format-currency="formatCurrency"
					@add="onAdd"
				/>
			</div>
			<!--
				A SKELETON, not a spinner, and not the empty state.

				The catalogue's first load used to render «No items found» on
				this screen — the same defect `itemsSelectorTableLoading.spec.ts`
				records for the desk table: an empty list and a list that has not
				arrived look identical from here, so the screen has to be TOLD
				(`ItemsSelector`'s `update:catalogLoading`, through the shell).

				The ghosts sit in the REAL `.mbrowse__grid`, so the columns the
				skeleton promises are the columns the cards then take — the same
				discipline `.items-card-grid` follows on the desk. The status
				text is for screen readers only; a sighted cashier reads the
				shape.
			-->
			<div
				v-else-if="loading"
				class="mbrowse__grid mbrowse__grid--ghost"
				data-testid="browse-skeleton"
				role="status"
				aria-busy="true"
				:aria-label="__('Loading items...')"
			>
				<span v-for="n in 8" :key="n" class="mbrowse-ghost" aria-hidden="true">
					<span class="mbrowse-ghost__well shimmer"></span>
					<span class="mbrowse-ghost__line shimmer"></span>
					<span class="mbrowse-ghost__line mbrowse-ghost__line--short shimmer"></span>
				</span>
			</div>
			<!-- The register's own empty-state wording, not a second phrasing of it. -->
			<p v-else class="mbrowse__empty" data-testid="browse-empty">
				{{ __("No items found") }}
			</p>
		</div>

		<!-- The footer draws only when it carries a CLAIM (the compatible
		     filter is narrowing the grid) or an ACTION (see-all out of a
		     filtered view). The everyday «N items · tap a card» box was
		     noise on a screen whose navigation is the dock (owner 08-31). -->
		<footer
			v-if="!showCategoryTiles && (footer.claiming || footer.seeAllLabel)"
			class="mbrowse__foot"
			data-testid="browse-footer"
		>
			<div v-if="footer.claiming" class="mbrowse__foot-copy">
				<div class="mbrowse__foot-count" data-testid="browse-count">{{ footer.countLine }}</div>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { ComboAvailabilityContext } from "../../../../composables/pos/combos/comboAvailability";
import type { ComboOffer } from "../../../../composables/pos/combos/comboCatalog";
import {
	buildBrowseCards,
	buildBrowseCategories,
	buildBrowseFooter,
	defaultTranslate,
	filterBrowseCards,
	type BrowseCard,
	type BrowseCatalogItem,
	type BrowseTranslate,
} from "./browseCatalog";
import {
	COMPATIBLE_FILTER_ID,
	offersCompatibleFilter,
	resolveCompatibilityScope,
} from "./browseCompatibility";
import CategoryTiles from "../../items/CategoryTiles.vue";
import {
	categoryChoices,
	fitCategoryRow,
	useCategoryNavigation,
} from "../../../../composables/pos/items/useCategoryNavigation";
import { COMBOS_CATEGORY_ID } from "../../../../composables/pos/combos/comboCatalog";
import MobileBrowseCard from "./MobileBrowseCard.vue";
// The register's ONE shimmer, shared with `ui/Skeleton.vue` rather than
// re-authored here: a second sweep at a second speed is exactly the drift the
// motion tokens exist to stop.
import "../../../../styles/shimmer.css";

defineOptions({ name: "MobileBrowseScreen" });

const props = withDefaults(
	defineProps<{
		/** The catalogue rows currently listed — the register's search result. */
		items?: readonly BrowseCatalogItem[];
		/**
		 * `ItemsSelector`'s own first-load flag (`update:catalogLoading`).
		 * Load-bearing and NOT inferable here: an empty `items` is equally a
		 * catalogue still arriving and a search that matched nothing, and the
		 * screen used to answer «No items found» to both.
		 */
		loading?: boolean;
		itemGroups?: readonly string[];
		itemGroup?: string;
		barcodeFirst?: boolean;
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
		loading: false,
		itemGroups: () => [],
		itemGroup: "ALL",
		barcodeFirst: false,
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
	(_event: "select-group", _id: string): void;
	(_event: "settings"): void;
	(_event: "add", _card: BrowseCard): void;
	/** Focus the register's ONE search field. This screen never owns an input. */
	(_event: "search"): void;
	/** Open the camera scanner — the host routes it to ItemsSelector's own. */
	(_event: "scan"): void;
	/** Clear the ONE search field (and with it the grid's narrowing). */
	(_event: "clear"): void;
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
const { categoryFirst, showProducts } = useCategoryNavigation();
const navigationEnabled = computed(() => categoryFirst.value && !props.barcodeFirst && !compatibleOnly.value);
const showCategoryTiles = computed(() => navigationEnabled.value && !props.query.trim() && !activeCategoryId.value && !showProducts.value && categories.value.length > 0);
const backToCategories = () => {
	showProducts.value = false;
	categoryOverride.value = null;
	stripExpanded.value = false;
	emit("select-group", "ALL");
};

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

const categories = computed(() => {
	const scoped = buildBrowseCategories(scopedCards.value, __);
	if (compatibleOnly.value || props.query.trim() || !props.itemGroups.length) return scoped;
	return [
		...scoped.filter((category) => category.id === COMBOS_CATEGORY_ID),
		...categoryChoices(props.itemGroups).map((category) => ({ ...category, count: null, featured: false })),
	];
});

/**
 * A remembered category that the current scope no longer offers selects
 * nothing rather than emptying the grid — narrowing to "Fundas" and then
 * switching to a phone with no cases must show the other accessories, not a
 * blank screen with a chip nobody can see.
 */
const activeCategoryId = computed(() => {
	if (props.itemGroup !== "ALL" && !compatibleOnly.value) return props.itemGroup;
	return categories.value.some((category) => category.id === categoryOverride.value) ? categoryOverride.value : null;
});

/**
 * The cards a selected item GROUP can show.
 *
 * `itemsStore.filterByGroup` has already narrowed the rows to that group (and
 * the server may count a child group's items as the parent's, so they are not
 * re-filtered by name here). The combos are not the store's to narrow: they
 * arrive whatever group is open, and used to lead every category — three
 * breakfast combos above the hot drinks a cashier had just opened. A combo
 * belongs to Combos, which is one chip away.
 */
const serverGroupOpen = computed(() => props.itemGroup !== "ALL" && !compatibleOnly.value);
const groupCards = computed(() =>
	serverGroupOpen.value ? allCards.value.filter((card) => card.kind !== "combo") : allCards.value,
);

const cards = computed(() =>
	filterBrowseCards(groupCards.value, {
		compatibleOnly: compatibleOnly.value,
		scope: scope.value,
		categoryId: serverGroupOpen.value ? null : activeCategoryId.value,
	}),
);

const footer = computed(() =>
	buildBrowseFooter({
		shownCount: cards.value.length,
		// Inside a server group the rows ARE the group; «See all N» would
		// count that group plus the combos set aside above, which is no
		// catalogue at all. The category row is the way out.
		totalCount: groupCards.value.length,
		scope: scope.value,
		compatibleOnly: compatibleOnly.value,
		translate: __,
	}),
);

const toggleCompatible = () => {
	compatibleOverride.value = !compatibleOnly.value;
};

const toggleCategory = (id: string) => {
	const selected = activeCategoryId.value === id ? null : id;
	categoryOverride.value = selected;
	// A pick answers the open row; it folds back to one line around the choice.
	stripExpanded.value = false;
	if (props.itemGroups.length && !compatibleOnly.value) emit("select-group", selected && selected !== COMBOS_CATEGORY_ID ? selected : "ALL");
};

const clearFilters = () => {
	categoryOverride.value = null;
	emit("select-group", "ALL");
	if (compatibleOffered.value) compatibleOverride.value = false;
};

watch(() => props.query, () => {
	categoryOverride.value = null;
	stripExpanded.value = false;
});

// ---- the category row -----------------------------------------------------

const rootEl = ref<HTMLElement | null>(null);
const stripEl = ref<HTMLElement | null>(null);
/** «+N» opened: every chip, wrapped. */
const stripExpanded = ref(false);
/** Chips the collapsed row keeps; null = all of them (they fit, or unmeasured). */
const stripFit = ref<Set<string> | null>(null);
/** `.mbrowse__chip--more`'s flex basis — the room «+N» needs at the row's end. */
const MORE_CHIP_WIDTH = 64;
/** Below this the screen keeps its category row to a single line. */
const SHORT_SCREEN_HEIGHT = 480;

/** The way back to the tiles, while a category-first register shows products. */
const showBack = computed(
	() => navigationEnabled.value && !props.query.trim() && !showCategoryTiles.value && categories.value.length > 0,
);
/** On the tiles landing the tiles ARE the categories; the row keeps only Compatible. */
const stripCategories = computed(() => (showCategoryTiles.value ? [] : categories.value));
const stripVisible = computed(
	() => compatibleOffered.value || showBack.value || stripCategories.value.length > 0,
);
const shownCategories = computed(() => {
	const fit = stripFit.value;
	if (stripExpanded.value || !fit) return stripCategories.value;
	return stripCategories.value.filter((category) => fit.has(category.id));
});
const hiddenCategoryCount = computed(() => stripCategories.value.length - shownCategories.value.length);

let fitting = false;
let refitRequested = false;
/**
 * Lay every chip out once, measure, keep what fits. Both renders land in the
 * same task — the awaited `nextTick` is a microtask — so the full set is
 * measured but never painted.
 */
const fitStrip = async (): Promise<void> => {
	if (fitting) {
		refitRequested = true;
		return;
	}
	if (stripExpanded.value) return;
	fitting = true;
	try {
		stripFit.value = null;
		await nextTick();
		const strip = stripEl.value;
		if (!strip || stripExpanded.value) return;
		const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
		// Layout width, not painted width: `offsetWidth` ignores transforms (the
		// chip still pressed at 0.98 by the tap that triggered this, a screen
		// mid-entrance) but rounds, so half a pixel goes back on — erring
		// towards one chip fewer, never towards a wrapped row.
		const width = (el: HTMLElement) => (el.offsetWidth ? el.offsetWidth + 0.5 : 0);
		const fixed = Array.from(strip.querySelectorAll<HTMLElement>("[data-strip-fixed]"), width);
		stripFit.value = fitCategoryRow({
			// `clientWidth` rounds too; a pixel of slack covers it.
			available: strip.clientWidth - 1,
			gap,
			fixedWidth: fixed.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, fixed.length - 1),
			moreWidth: MORE_CHIP_WIDTH,
			chips: Array.from(strip.querySelectorAll<HTMLElement>("[data-strip-chip]"), (el) => ({
				id: el.dataset.stripChip ?? "",
				width: width(el),
			})),
			activeId: activeCategoryId.value,
			// A three-group menu shows whole on two lines; a cafeteria's dozen
			// folds to one line and «+N» instead of becoming a wall. A short
			// screen (a phone on its side) cannot spare the second line.
			maxLines: (rootEl.value?.clientHeight ?? 0) >= SHORT_SCREEN_HEIGHT ? 2 : 1,
		});
	} finally {
		fitting = false;
		if (refitRequested) {
			refitRequested = false;
			void fitStrip();
		}
	}
};

watch(
	() => [
		stripCategories.value.map((category) => `${category.id}\u0000${category.count ?? ""}`).join("\u0001"),
		activeCategoryId.value,
		showBack.value,
		compatibleOffered.value,
		compatibleOnly.value,
		stripExpanded.value,
	],
	() => void fitStrip(),
	{ flush: "post" },
);

// The ROOT is observed, not the row: the row's height changes every time it
// is fitted, and observing it would feed its own resize back into the fit.
let resizeObserver: ResizeObserver | null = null;
let observedWidth = -1;
const refitAfterFonts = () => void fitStrip();
onMounted(() => {
	void fitStrip();
	if (typeof ResizeObserver !== "undefined" && rootEl.value) {
		resizeObserver = new ResizeObserver((entries) => {
			const next = Math.round(entries[0]?.contentRect.width ?? 0);
			if (next === observedWidth) return;
			observedWidth = next;
			void fitStrip();
		});
		resizeObserver.observe(rootEl.value);
	}
	// Chip widths are font widths. A face loads the first time text needs it
	// — the chips' 500 weight can first appear WITH the row, after the tiles
	// were drawn in other weights — so measure again whenever one arrives.
	document.fonts?.addEventListener?.("loadingdone", refitAfterFonts);
});
onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	document.fonts?.removeEventListener?.("loadingdone", refitAfterFonts);
});

const onAdd = (card: BrowseCard) => emit("add", card);
</script>

<style scoped>
.mbrowse__search-row { display: flex; gap: 8px; align-items: center; }
.mbrowse__search-row .mbrowse__search { flex: 1; min-width: 0; }
.mbrowse__settings { flex: 0 0 44px; height: 44px; border-radius: 10px; border: 1px solid var(--reg-border); color: var(--reg-text-primary, #212121); background: var(--reg-surface); }
.mbrowse__navigation { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.mbrowse__navigation > strong { margin-inline-end: auto; font-size: 15px; font-weight: 700; color: var(--reg-text-primary, #212121); }

.mbrowse {
	display: flex;
	flex-direction: column;
	/* The register shell supplies the space left after its chrome. */
	height: 100%;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.mbrowse__head {
	flex: none;
	background: var(--reg-surface, #ffffff);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
	padding: 9px 14px 9px;
}

/* The search and the category row stay put while the grid scrolls under them,
   so switching category never starts with scrolling back up. Only where the
   screen is tall enough to spare them: a landscape phone keeps its rows. */
@media (min-height: 560px) {
	.mbrowse__head {
		position: sticky;
		top: 0;
		z-index: 2;
	}
}

.mbrowse__search {
	display: flex;
	align-items: center;
	gap: 9px;
	width: 100%;
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

/* The scan door: a 44px square inside the row (the row itself is 44 tall),
   negative margin so the glyph sits where the decorative icon did. */
.mbrowse__scan {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	margin: 0 -12px 0 0;
	border-radius: 0 9px 9px 0;
	cursor: pointer;
}

.mbrowse__scan:focus-visible {
	outline: none;
	box-shadow: inset 0 0 0 2px var(--reg-accent-pressed, #00838f);
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
	flex-wrap: wrap;
}

/*
 * The desk drawer's chip (`CatalogDrawer.vue`) at touch size: outlined on the
 * surface, readable 13px, and ONE selected look — the pale accent wash, its
 * edge and a check. The old 11px grey pill read as disabled, and its selected
 * state was a hairline nobody could find.
 */
.mbrowse__chip {
	position: relative;
	max-width: 100%;
	min-height: 44px;
	white-space: normal;
	overflow-wrap: anywhere;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: 999px;
	font-size: 13px;
	font-weight: 500;
	line-height: 1.2;
	padding: 5px 14px;
	font-family: inherit;
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-secondary, #56606e);
	cursor: pointer;
	transition: transform var(--motion-fast, 120ms) var(--ease-out, ease-out);
	-webkit-tap-highlight-color: transparent;
}

.mbrowse__chip:active {
	transform: scale(var(--press-scale, 0.98));
}

/* Combos lead the row in the combo cards' own tone — a state of the grid, not
   a second accent (the same reasoning `.mbrowse-card--combo` gives). */
.mbrowse__chip--featured {
	border-color: var(--reg-tone-warning-border, #f0dcae);
	background: var(--reg-tone-warning-bg, #fdf9f0);
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 700;
}

.mbrowse__chip--see-all {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.mbrowse__chip--on {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.mbrowse__chip-count {
	font-weight: 700;
	opacity: 0.7;
}

/* The way back to the tiles: a square, so it costs the row one thumb. */
.mbrowse__chip--icon {
	flex: none;
	width: 44px;
	padding: 0;
	justify-content: center;
	color: var(--reg-text-primary, #212121);
}

/* «+N»: a known minimum, so the fit can reserve it before it exists
   (MORE_CHIP_WIDTH), then it takes what the row has left — a full row reads
   as one control rather than chips that ran out. */
.mbrowse__chip--more {
	flex: 1 0 64px;
	min-width: 64px;
	padding: 0 10px;
	justify-content: center;
	gap: 2px;
	color: var(--reg-text-primary, #212121);
	font-weight: 700;
}

/* Open, it is only the way to fold back: a square like the back chip. A
   stretched pill holding one chevron read as an empty field. */
.mbrowse__chip--more[aria-expanded="true"] {
	flex: 0 0 44px;
	min-width: 44px;
	width: 44px;
	padding: 0;
}

.mbrowse__nav-button {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 44px;
	padding: 0 14px;
	border: 1px solid var(--reg-border, rgba(0, 0, 0, 0.12));
	border-radius: 999px;
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition: transform var(--motion-fast, 120ms) var(--ease-out, ease-out);
	-webkit-tap-highlight-color: transparent;
}

.mbrowse__nav-button:active {
	transform: scale(var(--press-scale, 0.98));
}

.mbrowse__nav-button:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 2px;
}

.mbrowse__sr {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
}

@media (prefers-reduced-motion: reduce) {
	.mbrowse__chip,
	.mbrowse__nav-button {
		transition: none;
	}

	.mbrowse__chip:active,
	.mbrowse__nav-button:active {
		transform: none;
	}
}

.mbrowse__chip:focus-visible,
.mbrowse__search:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 2px;
}

.mbrowse__grid-wrap {
	flex: none;
	min-height: 0;
	overflow: visible;
	padding: 10px 11px 0;
}

.mbrowse__grid {
	display: grid;
	/* auto-fill, not a fixed 2: the same screen now serves the whole compact
	   band, and a portrait tablet at 800px fits four readable cards where a
	   phone fits the artboard's two. The floor is 158px, NOT a rounder 170:
	   a very common 360px phone has 338px of grid after the gutters, and
	   170×2+10 = 350 tipped exactly those phones into a one-card column
	   (owner met it 08-31 — «we can squeeze 2 items per row»). 158×2+10 =
	   326 keeps the pair down to ~348px viewports; the tablet band still
	   lands on four columns either way. */
	grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
	gap: 10px;
	align-content: start;
}

/* ---- the loading ghosts ------------------------------------------------
 * Geometry copied from `.mbrowse-card`, not approximated: 1px border, 12px
 * radius, 7px padding, a 78px well and two text lines. A skeleton whose
 * boxes are a different size from the content it precedes is a layout jump
 * with extra steps.
 */
.mbrowse-ghost {
	display: flex;
	flex-direction: column;
	gap: 6px;
	border: 1px solid var(--reg-divider, #eceff3);
	border-radius: 12px;
	background: var(--reg-surface, #ffffff);
	padding: 7px;
}

.mbrowse-ghost__well {
	display: block;
	height: 78px;
	border-radius: 9px;
	background: var(--reg-surface-sunken, #f8f9fa);
	position: relative;
	overflow: hidden;
}

.mbrowse-ghost__line {
	display: block;
	height: 10px;
	border-radius: 5px;
	background: var(--reg-surface-sunken, #f8f9fa);
	position: relative;
	overflow: hidden;
}

.mbrowse-ghost__line--short {
	width: 55%;
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
	.mbrowse__search {
		min-height: var(--reg-touch-min, 44px);
	}
}
</style>
