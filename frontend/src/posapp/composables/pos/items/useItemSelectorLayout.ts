import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import _ from "lodash";
import {
	getCardColumns,
	getCardColumnsForContainer,
	getCardGap,
	getCardPadding,
} from "../../../utils/itemSelectorLayout.js";

type SelectorLayoutOptions = {
	resizeDebounce?: number;
	loadVisibleItems?: () => void;
};

/**
 * Manages the layout metrics and resize behavior for the ItemsSelector component.
 * Handles calculation of grid columns, card dimensions, and overflow detection.
 */
export function useItemSelectorLayout(options: SelectorLayoutOptions = {}) {
	const {
		resizeDebounce = 100,
		loadVisibleItems, // Method to load more items on scroll (pagination)
	} = options;

	// State
	const windowWidth = ref(window.innerWidth);
	const isOverflowing = ref(false);
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
	const cardColumns = computed(() => {
		const containerColumns = getCardColumnsForContainer(measuredContainerWidth.value);
		return containerColumns > 0 ? containerColumns : getCardColumns(windowWidth.value);
	});
	const cardGap = computed(() => getCardGap(windowWidth.value));
	const cardPadding = computed(() => getCardPadding(windowWidth.value));

	const cardRowHeight = computed(() => {
		if (windowWidth.value <= 768) {
			return 260;
		}
		if (windowWidth.value <= 1200) {
			return 280;
		}
		return 300;
	});

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
		const columns = Math.max(1, cardColumns.value);
		// Note: We might need a more robust way to get container width if it's dynamic
		// Ideally pass a ref to the container element
		const containerWidth = cardContainerWidth.value || 0;
		if (!containerWidth) {
			return 240; // Safe default
		}

		const gapTotal = cardGap.value * (columns - 1);
		const paddingTotal = cardPadding.value * 2;
		const available = Math.max(0, containerWidth - gapTotal - paddingTotal);
		const width = Math.floor(available / columns);
		return Math.max(180, width);
	});

	// Actions
	const updateWindowWidth = () => {
		windowWidth.value = window.innerWidth;
	};

	const scheduleCardMetricsUpdate = _.debounce(() => {
		updateWindowWidth();
		// Force re-evaluation of container width if needed by accessing ref
		if (itemsContainerRef.value) {
			// Trigger reactivity if needed, though windowWidth usually drives computed props
		}
		checkItemContainerOverflow();
	}, resizeDebounce);

	const getItemsContainerElement = (): HTMLElement | null => {
		if (!itemsContainerRef.value) return null;
		// Handle both Vue component ref and raw element
		return (itemsContainerRef.value.$el ||
			itemsContainerRef.value) as HTMLElement | null;
	};

	const checkItemContainerOverflow = () => {
		const el = getItemsContainerElement();
		if (!el) {
			isOverflowing.value = false;
			return;
		}

		const containerHeight = parseFloat(
			getComputedStyle(el).getPropertyValue("--container-height"),
		);
		if (isNaN(containerHeight)) {
			isOverflowing.value = false;
			return;
		}

		const stickyHeader = el
			.closest(".dynamic-padding")
			?.querySelector(".sticky-header") as HTMLElement | null;
		const headerHeight = stickyHeader ? stickyHeader.offsetHeight : 0;
		const availableHeight = containerHeight - headerHeight;

		// Only apply if calculated height is valid
		if (availableHeight > 0) {
			el.style.maxHeight = `${availableHeight}px`;
			isOverflowing.value = el.scrollHeight > availableHeight;
		}

		// Also schedule metrics update as this might affect layout
		// But be careful of infinite loops; separate updateWindowWidth logic if needed
	};

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
		nextTick(() => {
			updateWindowWidth();
			checkItemContainerOverflow();
		});
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
		isOverflowing,
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
		checkItemContainerOverflow,
		scheduleCardMetricsUpdate,
		onListScroll,
	};
}
