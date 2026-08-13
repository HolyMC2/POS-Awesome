import { nextTick, watch, type Ref } from "vue";

type UseItemsSelectorLayoutLifecycleArgs = {
	displayedItems: Ref<unknown[]>;
	scheduleCardMetricsUpdate: () => void;
	scheduleLastInvoiceRateRefresh: () => void;
	scheduleLastBuyingRateRefresh: () => void;
	syncHighlightedItem: () => void;
};

export function useItemsSelectorLayoutLifecycle({
	displayedItems,
	scheduleCardMetricsUpdate,
	scheduleLastInvoiceRateRefresh,
	scheduleLastBuyingRateRefresh,
	syncHighlightedItem,
}: UseItemsSelectorLayoutLifecycleArgs) {
	const refreshCardMetrics = () => {
		nextTick(scheduleCardMetricsUpdate);
	};

	const stopDisplayedItemsWatcher = watch(displayedItems, () => {
		refreshCardMetrics();
		scheduleLastInvoiceRateRefresh();
		scheduleLastBuyingRateRefresh();
		syncHighlightedItem();
	});

	// No resize listener here: useItemSelectorLayout already owns one for
	// window width, and the panel's own width comes from its ResizeObserver.
	const mount = () => {
		refreshCardMetrics();
	};

	const cleanup = () => {
		stopDisplayedItemsWatcher();
	};

	return {
		mount,
		cleanup,
	};
}
