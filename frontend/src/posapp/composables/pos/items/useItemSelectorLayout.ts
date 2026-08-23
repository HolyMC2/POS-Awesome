import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import _ from "lodash";
import {
	getCardColumns,
	getCardColumnsForContainer,
	getCardColumnWidth,
	getCardGap,
	getCardPadding,
	getCardRowHeight,
} from "../../../utils/itemSelectorLayout.js";

type SelectorLayoutOptions = {
	resizeDebounce?: number;
	loadVisibleItems?: () => void;
};

/**
 * Grid metrics for the ItemsSelector card view: column count, card dimensions,
 * and the scroll handler that drives pagination.
 *
 * It MEASURES and never writes geometry. Height belongs to the CSS chain
 * (selector card → dynamic-padding → results card → `.items-card-container` →
 * `.virtual-scroller`); width comes from the panel's ResizeObserver. A previous
 * version wrote an inline max-height parsed out of `--container-height` and
 * clipped every card to 14px — see the guard in
 * `tests/itemSelectorLayoutOwnership.spec.ts`.
 */
export function useItemSelectorLayout(options: SelectorLayoutOptions = {}) {
	const {
		resizeDebounce = 100,
		loadVisibleItems, // Method to load more items on scroll (pagination)
	} = options;

	// State
	const windowWidth = ref(window.innerWidth);
	const itemsContainerRef = ref<any>(null);
	const scrollThrottle = ref<number | null>(null);

	// MEASURED container width via ResizeObserver. clientWidth read inside a
	// computed is not reactive, and the old windowWidth*0.4 estimate is only
	// right for the classic two-column desk — in the lean vertical layout the
	// panel is the full window and the estimate left 60% of it empty.
	const measuredContainerWidth = ref(0);
	let containerObserver: ResizeObserver | null = null;

	const observeContainer = (el: HTMLElement | null) => {
		if (containerObserver) {
			containerObserver.disconnect();
			containerObserver = null;
		}
		if (!el || typeof ResizeObserver === "undefined") {
			measuredContainerWidth.value = el ? el.clientWidth : 0;
			return;
		}
		containerObserver = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect?.width;
			if (typeof width === "number") {
				measuredContainerWidth.value = width;
			}
		});
		containerObserver.observe(el);
		measuredContainerWidth.value = el.clientWidth;
	};

	watch(itemsContainerRef, (component) => {
		const el = (component?.$el || component) as HTMLElement | null;
		observeContainer(el instanceof HTMLElement ? el : null);
	});

	// Computed Metrics — container-measured when available, window fallback
	// until the panel mounts.
	const cardGap = computed(() => getCardGap(windowWidth.value));
	const cardPadding = computed(() => getCardPadding(windowWidth.value));

	// The count is decided with the SAME gap and padding the grid is then laid
	// out with. The old call passed the container width alone, so the count and
	// the width disagreed about how much room there was — which is how a grid
	// that "fitted" still put its last card outside the scrollport.
	const cardColumns = computed(() => {
		const containerColumns = getCardColumnsForContainer(
			measuredContainerWidth.value,
			cardGap.value,
			cardPadding.value,
		);
		return containerColumns > 0 ? containerColumns : getCardColumns(windowWidth.value);
	});

	// Height follows the CARD's width, not the window's: the 400px drawer on a
	// 1440 screen is a "desktop" by every window measure and a phone-width
	// panel by the only measure that matters here.
	// `ItemsSelectorCards` asks `isCompactCard(cardColumnWidth)` the same
	// question for the card's anatomy; one function, one answer, so the slot
	// and the thing in it cannot disagree about which card is being drawn.
	const cardRowHeight = computed(() => getCardRowHeight(cardColumnWidth.value, windowWidth.value));

	const cardSlotHeight = computed(() => cardRowHeight.value + cardGap.value);
	const cardSlotWidth = computed(() => cardColumnWidth.value + cardGap.value);

	const cardContainerWidth = computed(() => {
		if (measuredContainerWidth.value > 0) {
			return measuredContainerWidth.value;
		}
		// Pre-mount estimate only (classic desk panel ≈ 40% of the window).
		return windowWidth.value * 0.4;
	});

	const cardColumnWidth = computed(() => {
		const containerWidth = cardContainerWidth.value || 0;
		if (!containerWidth) {
			return 240; // Pre-measurement only.
		}
		return getCardColumnWidth(
			containerWidth,
			cardColumns.value,
			cardGap.value,
			cardPadding.value,
		);
	});

	// Actions
	const updateWindowWidth = () => {
		windowWidth.value = window.innerWidth;
	};

	// Window width still drives gap, padding, row height and the pre-mount
	// column fallback. Container WIDTH is the ResizeObserver's job, and
	// container HEIGHT is CSS's — this composable never writes geometry.
	const scheduleCardMetricsUpdate = _.debounce(updateWindowWidth, resizeDebounce);

	const onListScroll = (event: Event) => {
		if (scrollThrottle.value) return;

		scrollThrottle.value = requestAnimationFrame(() => {
			try {
				const el = event.target as HTMLElement | null;
				if (!el) return;
				if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
					// Trigger pagination via callback
					if (typeof loadVisibleItems === "function") {
						// We need access to currentPage logic, but usually loadVisibleItems handles the "next/more" logic
						loadVisibleItems();
					}
				}
			} catch (error: unknown) {
				console.error("Error in list scroll handler:", error);
			} finally {
				scrollThrottle.value = null;
			}
		});
	};

	// Lifecycle
	onMounted(() => {
		window.addEventListener("resize", scheduleCardMetricsUpdate);
		nextTick(updateWindowWidth);
	});

	onUnmounted(() => {
		window.removeEventListener("resize", scheduleCardMetricsUpdate);
		if (scrollThrottle.value) {
			cancelAnimationFrame(scrollThrottle.value);
		}
		scheduleCardMetricsUpdate.cancel();
		if (containerObserver) {
			containerObserver.disconnect();
			containerObserver = null;
		}
	});

	return {
		// Refs
		windowWidth,
		itemsContainerRef, // Bind this to the container in template

		// Computed
		cardColumns,
		cardGap,
		cardPadding,
		cardRowHeight,
		cardSlotHeight,
		cardSlotWidth,
		cardColumnWidth,

		// Methods
		scheduleCardMetricsUpdate,
		onListScroll,
	};
}
