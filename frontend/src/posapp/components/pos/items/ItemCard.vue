<template>
	<div
		:class="[
			'card-item-card',
			{
				'item-highlighted': isItemHighlighted,
				'card-item-card--compact': compact,
				'card-item-card--dense': dense,
			},
		]"
		:data-card-anatomy="dense ? 'dense' : compact ? 'compact' : 'roomy'"
		data-pos-keyboard-target="item-card"
		tabindex="0"
		role="button"
		:aria-label="`${item.item_name || item.item_code}`"
		@click="onClick"
		@keydown="onKeyboardSelect"
		:draggable="true"
		@dragstart="onDragStart"
		@dragend="onDragEnd"
	>
		<div class="card-item-image-container">
			<div class="image-placeholder">
				<v-icon size="40" color="grey-lighten-2"> mdi-image </v-icon>
			</div>
			<img
				:src="imageSrc"
				class="card-item-image"
				:class="{ 'is-loaded': isLoaded }"
				:alt="item.item_name"
				loading="lazy"
				decoding="async"
				@load="onImageLoad"
				@error="onImageError"
			/>
		</div>
		<div class="card-item-content">
			<div class="card-item-header">
				<h4 class="card-item-name">{{ item.item_name }}</h4>
				<span class="card-item-code">{{ item.item_code }}</span>
			</div>
			<div class="card-item-details">
				<div class="card-item-price">
					<div class="primary-price">
						<span class="currency-symbol">
							{{ currencySymbol(primaryCurrency) }}
						</span>
						<span class="price-amount">
							{{ formatCurrency(primaryRate, primaryCurrency, primaryPrecision) }}
						</span>
						<ItemRateInfoMenu
							v-if="showRateInfo"
							:rate-info="rateInfo"
							:currency-symbol="currencySymbol"
							:format-currency="formatCurrency"
							:rate-precision="ratePrecision"
						/>
					</div>
					<div v-if="showSecondaryPrice" class="secondary-price">
						<span class="currency-symbol">
							{{ currencySymbol(secondaryCurrency) }}
						</span>
						<span class="price-amount">
							{{ formatCurrency(item.rate, secondaryCurrency, primaryPrecision) }}
						</span>
					</div>
				</div>
				<!--
					Existencia, under the same rule the cart line follows
					(`cartLineStock.ts`): an ABSENT figure draws NOTHING, never a
					`0`. A rendered 0 is a claim — it says the shop has none of
					this, and a cashier who reads it repeats it to a customer,
					while the shelf may be full and the register simply offline.
					A real zero still draws, tinted, because that is exactly when
					the figure is worth having.

					The package glyph goes at compact width: it is decoration,
					and at 159px the two artboards (`Cajon.dc.html`,
					`MovilExplorar.dc.html`) both give that room to the figure.
				-->
				<div
					v-if="lineStock.show"
					class="card-item-stock"
					:class="{ 'card-item-stock--low': lineStock.isLow }"
					data-testid="card-item-stock"
					:data-stock-reason="lineStock.reason"
				>
					<v-icon v-if="!compact" size="small" class="stock-icon"> mdi-package-variant </v-icon>
					<span
						class="stock-amount"
						:class="{
							'negative-number': isNegative(item.actual_qty),
						}"
					>
						{{ formattedActualQty }}
					</span>
					<span class="stock-uom">{{ item.stock_uom || "" }}</span>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import placeholderImage from "../placeholder-image.png";
import ItemRateInfoMenu from "./ItemRateInfoMenu.vue";
import { describeLineStock } from "../invoice/cartLineStock";

const props = defineProps({
	item: { type: Object, required: true },
	posProfile: { type: Object, required: true },
	context: { type: String, default: "pos" },
	selectedCurrency: { type: String, default: "" },
	hideQtyDecimals: { type: Boolean, default: false },
	showRateInfo: { type: Boolean, default: true },
	getItemRateInfo: { type: Function, required: true },
	isItemHighlighted: { type: Boolean, default: false },
	currencySymbol: { type: Function, required: true },
	formatCurrency: { type: Function, required: true },
	formatNumber: { type: Function, required: true },
	ratePrecision: { type: Function, required: true },
	isNegative: { type: Function, default: (val) => val < 0 },
	/**
	 * Drawn at a width where the roomy anatomy does not fit — the anchored
	 * drawer's ~159px column, the phone's grid. Decided by
	 * `isCompactCard(cardColumnWidth)` in `ItemsSelectorCards`, never by a
	 * media query: the card's width is a property of the PANEL, and a 400px
	 * drawer on a 1440 screen is a desktop by every window measure.
	 */
	compact: { type: Boolean, default: false },
	/**
	 * The dense desk tier's mini anatomy (68px plate, one-line name, no code)
	 * for the 128px slot the virtual scroller deals there. Decided by the
	 * VIEWPORT — `isDenseDeskViewport` in the layout composable — because
	 * what it answers is a shortage of height, which no panel width can
	 * tell. Arrives together with `compact` (a 128px column is compact).
	 */
	dense: { type: Boolean, default: false },
	/** `posa_low_stock_alert_threshold` — the register's own number. */
	lowStockThreshold: { type: [Number, String], default: 0 },
});

const emit = defineEmits(["click", "dragstart", "dragend"]);

const loadedSrc = ref("");
const failedSrcs = ref([]);

// Photos are uploaded at camera resolution and painted into a 132px slot, so
// the server hands us a 300px thumbnail (`posa_image_thumb`) when one exists.
// The chain degrades one step at a time: a stale thumbnail row must fall back
// to the full-size photo rather than blanking the card, and a deleted
// attachment (which still leaves `item.image` set) must fall back to the
// bundled placeholder instead of the browser's broken-image glyph.
const imageSrc = computed(() => {
	const candidates = [props.item.posa_image_thumb, props.item.image];
	return (
		candidates.find((src) => src && !failedSrcs.value.includes(src)) || placeholderImage
	);
});

// Both flags store URLs rather than booleans: RecycleScroller reuses these
// cards for different items, and a stale `true` would paint the previous item's
// photo as if it were loaded.
const isLoaded = computed(() => loadedSrc.value === imageSrc.value);

const onImageLoad = () => {
	loadedSrc.value = imageSrc.value;
};

const onImageError = () => {
	const src = imageSrc.value;
	if (!src || src === placeholderImage || failedSrcs.value.includes(src)) return;
	failedSrcs.value = [...failedSrcs.value, src];
};

// RecycleScroller hands this card a different item as the grid scrolls; without
// the reset the failure list would grow for the lifetime of the shift.
watch(
	() => props.item.item_code,
	() => {
		failedSrcs.value = [];
	},
);

const primaryCurrency = computed(() => {
	if (props.context === "purchase") {
		return (
			props.item.original_currency ||
			props.item.currency ||
			props.item.price_list_currency ||
			props.posProfile.currency
		);
	}
	return (
		props.item.original_currency ||
		props.item.currency ||
		props.item.price_list_currency ||
		props.posProfile.currency
	);
});

const primaryRate = computed(() => {
	if (props.context === "purchase") {
		return props.item.original_rate ?? props.item.rate ?? props.item.standard_rate ?? 0;
	}
	return props.item.original_rate ?? props.item.rate ?? 0;
});

const primaryPrecision = computed(() => {
	return props.ratePrecision(primaryRate.value);
});

const rateInfo = computed(() => props.getItemRateInfo(props.item));

const secondaryCurrency = computed(() => props.selectedCurrency);

const showSecondaryPrice = computed(() => {
	return (
		props.context !== "purchase" &&
		props.posProfile.posa_allow_multi_currency &&
		Boolean(props.selectedCurrency) &&
		props.selectedCurrency !== primaryCurrency.value
	);
});

/**
 * Whether there is a stock figure to draw at all, and whether it is low —
 * decided by the SAME rule the cart line uses, so the number a cashier reads
 * on the card and the number they read on the line they just added cannot
 * disagree about what "no figure" means.
 */
const lineStock = computed(() =>
	describeLineStock(props.item, { lowStockThreshold: props.lowStockThreshold }),
);

const formattedActualQty = computed(() => {
	// `describeLineStock` clamps a negative to 0 — correct for a cart line,
	// where a negative available is not a shelf count. On a catalogue card an
	// over-sold item is a state the shop needs to SEE, so the figure comes from
	// the raw quantity when it is negative. The decision to draw it at all, and
	// to tint it, still belongs to the shared rule.
	const raw = Number(props.item.actual_qty);
	const numericQty = Number.isFinite(raw) && raw < 0 ? raw : (lineStock.value.value ?? 0);
	if (props.hideQtyDecimals) {
		return props.formatNumber(Math.round(numericQty), 0);
	}
	return props.formatNumber(numericQty, 4);
});

const onClick = (event) => {
	emit("click", event, props.item);
};

const onKeyboardSelect = (event) => {
	const key = event?.key || "";
	if (key !== "Enter" && key !== " ") {
		return;
	}
	event.preventDefault?.();
	emit("click", event, props.item);
};

const onDragStart = (event) => {
	emit("dragstart", event, props.item);
};

const onDragEnd = (event) => {
	emit("dragend", event);
};
</script>

<style scoped>
.card-item-card {
	background: var(--pos-surface-raised);
	border-radius: var(--pos-radius-md);
	border: 1px solid var(--pos-border-light);
	overflow: hidden;
	transition:
		transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
		box-shadow 0.2s ease,
		border-color 0.2s ease,
		background-color 0.2s ease;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	box-shadow: 0 10px 24px var(--pos-shadow-light);
	will-change: transform;
	backface-visibility: hidden;
	transform: translate3d(0, 0, 0);
	position: relative;
}

.card-item-card:hover {
	transform: translate3d(0, -3px, 0);
	box-shadow: 0 16px 32px var(--pos-shadow);
	border-color: rgba(var(--v-theme-primary), 0.35);
}

.card-item-card.item-highlighted {
	border-color: rgb(var(--v-theme-primary));
	box-shadow:
		0 0 0 3px rgba(var(--v-theme-primary), 0.35),
		0 12px 28px rgba(var(--v-theme-primary), 0.2);
	transform: translate3d(0, -2px, 0);
	background: rgba(var(--v-theme-primary), 0.08);
}

.card-item-image-container {
	position: relative;
	height: 132px;
	flex-shrink: 0;
	overflow: hidden;
	background: var(--pos-surface-muted);
}

.card-item-image {
	/* Positioned so it paints above the absolutely-placed placeholder, and
	   transparent until decoded so the placeholder shows through meanwhile. */
	position: relative;
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain; /* Changed to contain to ensure full image visibility */
	background-color: rgb(var(--v-theme-surface-bright));
	opacity: 0;
	transition: opacity 0.2s ease;
}

.card-item-image.is-loaded {
	opacity: 1;
}

/* Image Placeholder Style */
.image-placeholder {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	background-color: rgb(var(--v-theme-surface-variant));
}

.card-item-content {
	padding: var(--pos-space-3);
	display: flex;
	flex-direction: column;
	flex-grow: 1;
	justify-content: space-between;
	gap: var(--pos-space-2);
}

.card-item-header {
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-1);
}

.card-item-name {
	font-size: 0.98rem;
	font-weight: 700;
	margin: 0;
	line-height: 1.35;
	color: var(--pos-text-primary);
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
}

.card-item-code {
	font-size: 0.74rem;
	color: var(--pos-text-secondary);
	display: block;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	letter-spacing: 0.02em;
}

.card-item-details {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	margin-top: auto; /* Push to bottom */
	gap: var(--pos-space-2);
}

.card-item-price {
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-1);
	min-width: 0;
}

.primary-price {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: var(--pos-space-1);
	font-weight: 700;
	color: var(--pos-primary);
	font-size: 1.05rem;
}

.secondary-price {
	font-size: 0.8rem;
	color: var(--pos-text-secondary);
}

.card-item-stock {
	text-align: right;
	font-size: 0.82rem;
	color: var(--pos-text-secondary);
	display: flex;
	flex-direction: row;
	align-items: flex-end;
	gap: 6px;
	padding: 6px 8px;
	border-radius: var(--pos-radius-xs);
	background: var(--pos-hover-bg);
	white-space: nowrap;
}

.stock-amount {
	font-weight: 600;
}

.stock-amount.negative-number {
	color: rgb(var(--v-theme-error));
}

.stock-uom {
	font-size: 0.7rem;
	text-transform: uppercase;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Amber is STATE, and state on a figure is a TINT, never a fill (§17.7
   invariant 2). The one saturated accent on this screen belongs to the primary
   action in the band; a wall of cards is exactly where a second one starts
   competing. Same treatment, same token, as `.posa-cart-item-row__stock--low`. */
.card-item-stock--low .stock-amount,
.card-item-stock--low .stock-uom {
	color: var(--pos-button-warning-text, #e65100);
	font-weight: 700;
}

/* The small-WINDOW tuning, for the band between the compact card and the full
   one — a landscape phone or a small tablet whose panel still affords ~210px
   columns. It must stay ABOVE the compact block: a media query adds no
   specificity, so the two would be settled by source order alone, and on a
   portrait phone (which is compact) the 112px plate would win and overflow the
   184px slot by 24px. */
@media (max-width: 768px) {
	.card-item-image-container {
		height: 112px;
	}

	.card-item-content {
		padding: var(--pos-space-2);
	}

	.card-item-name {
		font-size: 0.85rem;
	}

	.card-item-code {
		font-size: 0.7rem;
	}
}

/* ==========================================================================
   COMPACT ANATOMY — the card at the anchored drawer's width.
   ==========================================================================

   The catalogue is a 400px drawer now, so its grid column is about 159px and
   two cards sit per row. Nothing is DROPPED at this size: the artboards
   (`Cajon.dc.html` nodes 34-39, `MovilExplorar.dc.html` nodes 22-33) draw the
   same four things on a 181px and a 179px card — the picture, the name over
   two clamped lines, the code, and the price beside the stock figure. They are
   simply smaller, and the one thing that goes is the package glyph, which is
   decoration.

   That is also the answer `Rejilla.dc.html` was rejected for proposing: at a
   narrow width, a text-only list of near-identical names ("Anillo Case Honor
   X8A Rojo" / "…Negro") is SLOWER to hit than small pictures. Shrink the card;
   do not turn it into a row.

   Sizes are proportional to the artboard's: an 88px plate under a 159px card
   is the same ratio as its 72px plate under 181px, so the grid reads as one
   family at both widths. Every number here is paid for out of the 184px slot
   `getCardRowHeight` reserves — 88 + 8 + 30 + 13 + 22 + 16 of padding = 177,
   with the slack going to the name's line-height.

   The whole card is the tap target (`role="button"` on the root), so the 44px
   coarse-pointer floor is met by the card itself at 159 × 184 rather than by
   any control inside it. The single control that IS inside — the rate-info
   trigger — carries its own 44px box bled out on negative margin, guarded by
   `touchTargetSweep.spec.ts`. */
.card-item-card--compact .card-item-image-container {
	height: 88px;
}

.card-item-card--compact .card-item-content {
	padding: 8px;
	gap: 4px;
}

.card-item-card--compact .card-item-header {
	gap: 1px;
}

.card-item-card--compact .card-item-name {
	font-size: 0.78rem;
	font-weight: 600;
	line-height: 1.22;
}

.card-item-card--compact .card-item-code {
	font-size: 0.66rem;
}

.card-item-card--compact .card-item-details {
	align-items: baseline;
	gap: 6px;
}

/* The price is the half that may truncate; the stock figure is the half that
   must not, because a clipped quantity is a wrong quantity. */
.card-item-card--compact .primary-price {
	font-size: 0.86rem;
	flex-wrap: nowrap;
	min-width: 0;
	overflow: hidden;
}

.card-item-card--compact .price-amount {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.card-item-card--compact .secondary-price {
	font-size: 0.68rem;
}

.card-item-card--compact .card-item-stock {
	flex: 0 0 auto;
	align-items: baseline;
	gap: 3px;
	padding: 1px 6px;
	font-size: 0.72rem;
}

.card-item-card--compact .stock-uom {
	font-size: 0.62rem;
}

/* No lift on a card this size: the 3px translate reads as jitter across a
   dense two-column grid, and the drawer has no room to paint the larger
   shadow. */
.card-item-card--compact:hover {
	transform: none;
}

/* Dense desk tier (utils/itemSelectorLayout DENSE_*): the 128px slot the
   virtual scroller deals on a short landscape desk (≥1100 wide, ≤820 tall).
   Rides on --compact — a 128px column is compact by width — and trims only
   what that anatomy cannot fit in 128px: the plate drops to 68px, the name
   goes to one line, the code goes. The card stays the tap target: 128 × 128
   clears the 44px coarse floor with room to spare. */
.card-item-card--dense .card-item-image-container {
	height: 68px;
}

.card-item-card--dense .card-item-content {
	padding: 5px 8px 6px;
	gap: 2px;
}

.card-item-card--dense .card-item-header {
	min-width: 0;
}

.card-item-card--dense .card-item-name {
	display: block;
	font-size: 0.76rem;
	line-height: 1.2;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.card-item-card--dense .card-item-code {
	display: none;
}

.card-item-card--dense .card-item-details {
	padding: 0;
}

.card-item-card--dense .primary-price {
	font-size: 0.82rem;
}
</style>
