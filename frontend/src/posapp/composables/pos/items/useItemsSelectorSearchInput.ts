import { nextTick, watch, type Ref } from "vue";

type EventBusLike = {
	emit?: (_event: string, _payload?: unknown) => void;
};

type ScannerInputLike = {
	handleSearchInput?: (_value: string) => void;
	setInputHandlers?: (_handlers: {
		get: () => string;
		set: (_value: string) => void;
		clear: () => void;
		focus: () => void;
	}) => void;
};

type SearchFocusGuardLike = {
	armPreserveNextFocusClear: () => void;
	shouldClearSearchOnFocus: () => boolean;
};

type UseItemsSelectorSearchInputArgs = {
	searchInput: Ref<string>;
	firstSearch: Ref<string>;
	clearingSearch?: Ref<boolean>;
	activeView: Ref<string>;
	eventBus: EventBusLike | null | undefined;
	scannerInput: ScannerInputLike;
	searchFocusGuard: SearchFocusGuardLike;
	clearHighlightedItem: () => void;
	focusItemSearch: () => void;
	setActiveView: (_view: string) => void;
	triggerItemSearchFocus: () => void;
};

export function useItemsSelectorSearchInput({
	searchInput,
	firstSearch,
	clearingSearch,
	activeView,
	eventBus,
	scannerInput,
	searchFocusGuard,
	clearHighlightedItem,
	focusItemSearch,
	setActiveView,
	triggerItemSearchFocus,
}: UseItemsSelectorSearchInputArgs) {
	const clearSearch = () => {
		if (clearingSearch) {
			clearingSearch.value = true;
		}
		searchInput.value = "";
		firstSearch.value = "";
		if (clearingSearch) {
			clearingSearch.value = false;
		}
		// The same announcement typing makes (`handleSearchInput`): the movil
		// browse bar ECHOES this event, so a clear that stays silent leaves
		// the teal bar claiming a term the field no longer holds — which is
		// exactly what the bar's × looked like before this line.
		eventBus?.emit?.("item_search_changed", "");
	};

	const handleSearchInput = (value: unknown) => {
		const normalized = String(value ?? "");
		searchInput.value = normalized;
		firstSearch.value = normalized;
		// Arm the focus-clear guard while the operator is actively
		// typing so any focus event Vuetify fires in the next 800 ms
		// (clear-button hit-test re-focus, autofocus chip rebind after
		// a render pass) doesn't blow away the in-progress query.
		// Pairs with `handleItemSearchFocus`'s non-empty fast path.
		if (normalized) {
			searchFocusGuard.armPreserveNextFocusClear();
		}
		scannerInput.handleSearchInput?.(normalized);
		// The shell listens: with the ticket at full width the matches live
		// in the drawer, and the drawer has to know someone is looking.
		//
		// Through the INJECTED bus, never a module import of `bus`: this
		// composable ships in the lazy ItemsSelector chunk, and a module
		// import there resolved to a second mitt instance nobody in the shell
		// listens on — `focus_item_search` two lines below always worked
		// because it went this way. Verified on the lab 2026-08-22.
		eventBus?.emit?.("item_search_changed", normalized);
	};

	const prepareSearchInjection = () => {
		clearSearch();
		searchFocusGuard.armPreserveNextFocusClear();
	};

	const appendSearchCharacter = (character: string) => {
		const nextValue = `${String(searchInput.value || "")}${character}`;
		handleSearchInput(nextValue);
	};

	const revealItemSearchView = () => {
		eventBus?.emit?.("set_compact_panel", "selector");
		if (activeView.value !== "items") {
			setActiveView("items");
		}
	};

	const requestItemSearchFocus = () => {
		if (activeView.value !== "items") {
			return;
		}
		nextTick(() => {
			focusItemSearch();
		});
	};

	const requestForegroundItemSearchFocus = () => {
		revealItemSearchView();
		triggerItemSearchFocus();
		eventBus?.emit?.("focus_item_search");
	};

	const handleItemSearchFocus = () => {
		if (!searchFocusGuard.shouldClearSearchOnFocus()) {
			requestItemSearchFocus();
			return;
		}
		// Don't clearSearch if the operator is actively typing — Vuetify
		// v-text-field can emit `@focus` mid-keystroke (e.g. clear-button
		// hit-test re-focus, or the autofocus chip rebind after a render
		// pass). When `searchInput.value` already holds typed content,
		// blowing it away here desyncs the Vue ref from the DOM input
		// (the input keeps "samsung", the ref goes ""), and
		// displayedItems renders the unfiltered first page even though
		// the operator typed a query. Only clear when there's nothing
		// to lose.
		if (searchInput.value) {
			requestItemSearchFocus();
			return;
		}
		clearSearch();
		requestItemSearchFocus();
	};

	const stopSearchInputWatcher = watch(searchInput, (value) => {
		firstSearch.value = value;
		clearHighlightedItem();
	});

	scannerInput.setInputHandlers?.({
		get: () => String(searchInput.value || ""),
		set: (value: string) => {
			prepareSearchInjection();
			handleSearchInput(String(value ?? ""));
		},
		clear: clearSearch,
		focus: requestForegroundItemSearchFocus,
	});

	return {
		clearSearch,
		handleSearchInput,
		prepareSearchInjection,
		appendSearchCharacter,
		revealItemSearchView,
		requestItemSearchFocus,
		requestForegroundItemSearchFocus,
		handleItemSearchFocus,
		cleanup: stopSearchInputWatcher,
	};
}
