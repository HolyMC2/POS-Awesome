<template>
	<div class="items-selector-shell" :style="responsiveStyles">
		<!-- v-if keeps the async chunk un-fetched until the dialog
		     actually opens. Without it, defineAsyncComponent still
		     splits the chunk but Vue instantiates the (empty) dialog
		     on parent mount and triggers the loader immediately. -->
		<ScanErrorDialog
			v-if="scanErrorDialog"
			v-model="scanErrorDialog"
			:message="scanErrorMessage"
			:code="scanErrorCode"
			:details="scanErrorDetails"
			@acknowledge="acknowledgeScanError"
		/>
		<v-card
			v-show="showCatalog"
			:class="[
				'selection selection-card mx-auto my-0 py-0 mt-3 pos-card dynamic-card resizable pos-themed-card',
				{ 'selection-card--phone': isPhone },
				rtlClasses,
			]"
			:style="selectorCardStyle"
		>
			<v-progress-linear
				:active="isLoadingOrSyncing"
				:indeterminate="isLoadingOrSyncing"
				absolute
				location="top"
				color="info"
			></v-progress-linear>

			<!-- Add dynamic-padding wrapper like Invoice component -->
			<div class="dynamic-padding">
				<!-- `disabled` when there is no target, so the default (and the
				     purchase / barcode-printing contexts) render exactly where
				     they always did. Teleport moves DOM nodes only — the header
				     keeps this component as its owner, so `v-show` on the card
				     above cannot hide a teleported header, and there is still
				     exactly one of it. -->
				<!-- `defer` (Vue 3.5) resolves the target AFTER the current render
				     cycle, so the shell may render its scan-bar slot anywhere in
				     its own template — including below this component. Without it
				     the target has to already exist at mount, which makes the
				     wiring silently order-dependent. -->
				<Teleport defer :to="headerTarget || 'body'" :disabled="!headerTarget">
				<v-card flat class="selector-header-card pos-themed-card" :class="{ 'selector-header-card--detached': !!headerTarget }">
					<ItemHeader
						v-model:search-input="search_input"
						v-model:qty-input="debounce_qty"
						:pos-profile="pos_profile"
						:is-phone="isPhone"
						:scanner-locked="scannerLocked"
						:enable-background-sync="enable_background_sync"
						:last-sync-time="lastSyncTimeLabel"
						:sync-status="syncStatus"
						:show-sync-progress="showSearchSyncProgress"
						:sync-progress="syncProgressValue"
						:sync-items-count="syncItemsCount"
						:context="context"
						:last-resolved-scan="lastResolvedScan"
						:search-chord="searchChordLabel"
						:browse-chord="browseChordLabel"
						:show-browse="showBrowseButton"
						@browse-catalog="openCatalogDrawer"
						@esc="esc_event"
						@enter="onEnter"
						@search-keydown="handleSearchKeydown"
						@clear-search="clearSearch"
						@clear-search-and-qty="clearSearchAndQty"
						@search-input="handleSearchInput"
						@search-paste="handleSearchPaste"
						@focus="handleItemSearchFocus"
						@clear-qty="clearQty"
						@blur-qty="onQtyBlur"
						@start-camera="startCameraScanning"
						@open-new-item="openNewItemDialog"
						@toggle-settings="toggleItemSettings"
						@reload-items="forceReloadItems"
						ref="itemHeader"
					/>
				</v-card>
				</Teleport>

				<ItemSettingsDialog
					v-if="show_item_settings"
					v-model="show_item_settings"
					:allow-new-line-setting="!!pos_profile?.posa_new_line"
					:show-browse-controls="hideToolbarOnPhone"
					:items-group="items_group"
					v-model:item-group="item_group"
					v-model:items-view="items_view"
					:active-price-list="active_price_list"
					:show-price-list="pos_profile?.posa_enable_price_list_dropdown !== false"
					:initial-settings="{
						new_line,
						hide_qty_decimals,
						hide_zero_rate_items,
						show_last_invoice_rate,
						enable_background_sync,
						background_sync_interval,
						enable_custom_items_per_page,
						items_per_page,
						force_server_items: temp_force_server_items,
					}"
					@save="applyItemSettings"
				/>

				<v-card flat class="selector-section-card selector-results-card pos-themed-card">
					<v-row class="items">
						<v-col cols="12" class="pt-0 mt-0" data-perf-tag="items-grid">
							<ItemsSelectorCards
								v-if="items_view === 'card'"
								ref="itemsContainerRef"
								:displayed-items="displayedItems"
								:is-loading="isLoadingOrSyncing"
								:search-input="search_input"
								:item-group="item_group"
								:card-slot-height="cardSlotHeight"
								:card-columns="cardColumns"
								:card-slot-width="cardSlotWidth"
								:card-column-width="cardColumnWidth"
								:card-row-height="cardRowHeight"
								:virtual-scroll-buffer="virtualScrollBuffer"
								:pos-profile="pos_profile"
								:context="context"
								:selected-currency="selected_currency"
								:hide-qty-decimals="hide_qty_decimals"
								:show-rate-info="show_last_invoice_rate"
								:get-item-rate-info="getItemRateInfo"
								:is-item-highlighted="isItemHighlighted"
								:currency-symbol="currencySymbol"
								:format-currency="memoizedFormatCurrency"
								:format-number="memoizedFormatNumber"
								:rate-precision="ratePrecision"
								:is-negative="isNegative"
								:no-items-title="noItemsTitle"
								:no-items-subtitle="noItemsSubtitle"
								:clear-search-label="__('Clear Search')"
								@select-item="select_item"
								@dragstart="onDragStart"
								@dragend="onDragEnd"
								@virtual-range-update="onVirtualRangeUpdate"
								@clear-search="clearSearch"
							/>
							<ItemsSelectorTable
								v-else
								ref="itemsTable"
								:headers="headers"
								:displayed-items="displayedItems"
								:is-loading="isLoadingOrSyncing"
								:header-props="headerProps"
								:context="context"
								:pos-profile="pos_profile"
								:selected-currency="selected_currency"
								:hide-qty-decimals="hide_qty_decimals"
								:show-rate-info="show_last_invoice_rate"
								:currency-symbol="currencySymbol"
								:format-currency="memoizedFormatCurrency"
								:format-number="memoizedFormatNumber"
								:rate-precision="ratePrecision"
								:get-item-rate-info="getItemRateInfo"
								:is-negative="isNegative"
								:item-class="getItemRowClass"
								:row-props="getItemRowProps"
								:no-data-text="noItemsTitle"
								@row-click="click_item_row"
								@list-scroll="onListScroll"
							/>
						</v-col>
					</v-row>
				</v-card>
			</div>
		</v-card>
		<!-- Lean layout hides the extras toolbar on the SALES register only:
		     this component also mounts in purchase and barcode-printing
		     contexts, which keep their filters regardless of the flag.
		     On PHONE the toolbar is hidden too: the selector card is sized
		     to the full viewport (useItemsSelectorPanelSizing), so anything
		     below it hands the page a scrollbar and the search bar scrolls
		     out of reach — its controls move into ItemSettingsDialog, and
		     offers/coupons already live on the mobile dock. -->
		<ItemActionToolbar
			v-if="
				showCatalog &&
				!(verticalStore.leanVerticalLayout && context === 'pos') &&
				!hideToolbarOnPhone
			"
			v-model="item_group"
			:items-group="items_group"
			v-model:items-view="items_view"
			:pos-profile="pos_profile"
			:active-price-list="active_price_list"
			:offers-count="offersCount"
			:coupons-count="couponsCount"
			:reserve-bottom-dock-space="context === 'pos' && responsive.windowWidth.value < 1100"
			@open-offers="uiStore.setActiveView('offers')"
			@open-coupons="uiStore.setActiveView('coupons')"
		/>

		<!-- New Item Dialog -->
		<NewItemDialog
			v-if="newItemDialog"
			v-model="newItemDialog"
			:pos-profile="pos_profile"
			:items-group="items_group"
			:camera-enabled="!!pos_profile.posa_enable_camera_scanning"
			:scanned-barcode="newItemDialogScannedBarcode"
			@request-camera-scan="startNewItemBarcodeScan"
			@item-created="handleItemCreated"
		/>

		<!-- Camera Scanner Component -->
		<CameraScanner
			v-if="shouldMountCameraScanner"
			ref="cameraScanner"
			:scan-type="pos_profile.posa_camera_scan_type || 'Both'"
			@barcode-scanned="onBarcodeScanned"
			@scanner-opened="onScannerOpened"
			@scanner-closed="onScannerClosed"
		/>
	</div>
</template>

<script setup lang="ts">
import {
	getCurrentInstance,
	onMounted,
	onBeforeUnmount,
	ref,
	computed,
	watch,
	reactive,
	inject,
	nextTick,
	defineAsyncComponent,
	type Ref,
} from "vue";
import { storeToRefs } from "pinia";
import * as _ from "lodash";

// Critical-path components — render on first paint, ship in the main chunk.
import ItemActionToolbar from "./ItemActionToolbar.vue";
import ItemHeader from "./ItemHeader.vue";
import { lastResolvedScan } from "../../../composables/pos/items/useLastScanEcho";
import { chordLabelFor } from "../../../composables/pos/items/useShortcutChordLabel";
import ItemsSelectorCards from "./ItemsSelectorCards.vue";
import ItemsSelectorTable from "./ItemsSelectorTable.vue";

// Lazy children — heavy dialogs operators only open on demand. Splitting
// them out shaves ~150 kB of parsed JS off the initial Pos.vue chunk
// (CameraScanner alone is 739 lines + OpenCV imports).
const CameraScanner = defineAsyncComponent(() => import("./CameraScanner.vue"));
const ItemSettingsDialog = defineAsyncComponent(() => import("./ItemSettingsDialog.vue"));
const NewItemDialog = defineAsyncComponent(() => import("./NewItemDialog.vue"));
const ScanErrorDialog = defineAsyncComponent(() => import("./ScanErrorDialog.vue"));

import { useResponsive } from "../../../composables/core/useResponsive";
import { useRtl } from "../../../composables/core/useRtl";
import { useFlyAnimation } from "../../../composables/core/useFlyAnimation";
import { useCartValidation } from "../../../composables/pos/items/useCartValidation";
import { useItemsIntegration } from "../../../composables/pos/items/useItemsIntegration";
import { useItemSearch } from "../../../composables/pos/items/useItemSearch";
import { useScannerInput } from "../../../composables/pos/items/useScannerInput";
import { useItemAvailability } from "../../../composables/pos/items/useItemAvailability";
import { useItemDetailFetcher } from "../../../composables/pos/items/useItemDetailFetcher";
import { useItemAddition } from "../../../composables/pos/items/useItemAddition";
import { useItemSelection } from "../../../composables/pos/items/useItemSelection";
import { useItemSelectorLayout } from "../../../composables/pos/items/useItemSelectorLayout";
import { useLastInvoiceRate } from "../../../composables/pos/items/useLastInvoiceRate";
import { useLastBuyingRate } from "../../../composables/pos/items/useLastBuyingRate";
import { useItemRateInfo } from "../../../composables/pos/items/useItemRateInfo";
import { useItemSync } from "../../../composables/pos/items/useItemSync";
import { useItemStorageSafety } from "../../../composables/pos/items/useItemStorageSafety";
import { useItemsSelectorSearch } from "../../../composables/pos/items/useItemsSelectorSearch";
import { useItemsSelectorSettings } from "../../../composables/pos/items/useItemsSelectorSettings";
import { useItemsSelectorFocus } from "../../../composables/pos/items/useItemsSelectorFocus";
import { useItemDisplay } from "../../../composables/pos/items/useItemDisplay";
import { useItemsLoader } from "../../../composables/pos/items/useItemsLoader";
import { useBarcodeIndexing } from "../../../composables/pos/items/useBarcodeIndexing";
import { useScanProcessor } from "../../../composables/pos/items/useScanProcessor";
import { useItemCurrency } from "../../../composables/pos/items/useItemCurrency";
import { startItemsSelectorInitialization } from "../../../composables/pos/items/useItemsSelectorInitialization";
import { registerItemsSelectorEvents } from "../../../composables/pos/items/useItemsSelectorEvents";
import { registerItemsSelectorTypeToSearch } from "../../../composables/pos/items/useItemsSelectorTypeToSearch";
import { useItemsSelectorLayoutLifecycle } from "../../../composables/pos/items/useItemsSelectorLayoutLifecycle";
import { useItemsSelectorSearchInput } from "../../../composables/pos/items/useItemsSelectorSearchInput";
import { useItemsSelectorScannerBridge } from "../../../composables/pos/items/useItemsSelectorScannerBridge";
import { useItemsSelectorPriceListSync } from "../../../composables/pos/items/useItemsSelectorPriceListSync";
import { useItemsSelectorPanelSizing } from "../../../composables/pos/items/useItemsSelectorPanelSizing";
import { useItemsSelectorQuantity } from "../../../composables/pos/items/useItemsSelectorQuantity";
import { useItemsSelectorDisplayBindings } from "../../../composables/pos/items/useItemsSelectorDisplayBindings";

import { useCustomersStore } from "../../../stores/customersStore";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore, type PosActiveView } from "../../../stores/uiStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useVerticalStore } from "../../../stores/verticalStore";
import { useEmployeeStore } from "../../../stores/employeeStore";

import { parseBooleanSetting } from "../../../utils/stock";
import { createItemSearchFocusClearGuard } from "../../../utils/itemSearchFocusClearGuard";
import {
	loadItemsViewPreference,
	saveItemsViewPreference,
} from "../../../utils/itemSelectorSettings";

const props = defineProps({
	context: {
		type: String,
		default: "pos",
	},
	showOnlyBarcodeItems: {
		type: Boolean,
		default: false,
	},
	/**
	 * Where to render the search/scan header, if not in place.
	 *
	 * Riel y Cajón (§17.7) draws the scan bar on the SALE screen with the
	 * catalogue behind an "Explorar catálogo" button — so the cashier scans
	 * with the ticket at full width and the grid nowhere on screen. That is
	 * the density argument for direction E over the rejected direction C.
	 *
	 * It is a Teleport target rather than a second component ON PURPOSE. The
	 * scan bar already IS its own component (`ItemHeader.vue`, purely
	 * presentational, all state via props/emits) — the thing that could not
	 * move was its state owner, this file. Mounting a second scan field
	 * instead would give the register two live scan targets, and every
	 * barcode would be counted twice: a money bug, not a layout bug.
	 * Teleport moves the ONE header's DOM nodes and leaves its owner alone,
	 * so single-ownership is structural rather than something a caller has
	 * to remember.
	 *
	 * Null keeps the header where it is, which is what purchase and
	 * barcode-printing contexts want.
	 */
	headerTarget: {
		type: [String, Object],
		default: null,
	},
	/**
	 * MOVIL phones (< 768, MovilShell on stage): the browse screen IS the
	 * catalogue, so the header's catalogue toggle — and its Alt+B chord hint,
	 * meaningless on glass — stands down. The search field itself stays: it
	 * is the register's ONE search and the movil screen focuses it.
	 */
	suppressBrowseButton: {
		type: Boolean,
		default: false,
	},
	/**
	 * Hide the catalogue panel without unmounting it.
	 *
	 * `v-show`, never `v-if`: the scanner attaches to the DOCUMENT
	 * (`useScannerInput` → `onScan.attachTo(document, …)`, guarded by a
	 * `document._scannerAttached` singleton), so unmounting this component
	 * detaches the shop's keyboard wedge. Toggling the catalogue must cost a
	 * repaint, never the scanner — and never the loaded catalogue, the search
	 * worker or the operator's half-typed query either.
	 */
	showCatalog: {
		type: Boolean,
		default: true,
	},
});

const emit = defineEmits(["add-item", "update:itemsView", "update:displayedItems"]);

/**
 * Scan-bar affordances (artboard nodes 22-24).
 *
 * Chords resolve from the ACTIVE keymap, never from the mock — ruling R8. The
 * artboard prints `F2` on the field and `F4` on the catalogue; the shipped pack
 * binds `items.focusSearch` to Alt+3 and `catalog.toggleDrawer` to Alt+B, and
 * F4 has meant `employee.switch` since before the shortcuts engine existed. A
 * chip naming a key that does something else is worse than no chip: the
 * operator presses it once, switches cashier mid-sale, and stops trusting every
 * other chip on the screen.
 */
const searchChordLabel = chordLabelFor("items.focusSearch") ?? "";
const browseChordLabel = chordLabelFor("catalog.toggleDrawer") ?? "";

/**
 * The button exists only where there is a cajón to open — the sale screen,
 * which is exactly where the header gets teleported. Purchase and
 * barcode-printing render this component with no `headerTarget` and no drawer,
 * and offering them a catalogue button would open nothing.
 */
const showBrowseButton = computed(
	() => !!props.headerTarget && props.context === "pos" && !props.suppressBrowseButton,
);

/**
 * The SAME door the rail item and the chord already use — `Pos.vue` owns the
 * drawer state and listens for this one event. Reaching for a drawer method
 * here would be a fourth entry point into a state that must have exactly one.
 */
const openCatalogDrawer = () => {
	if (eventBus && typeof eventBus.emit === "function") {
		eventBus.emit("toggle_catalog_drawer");
	}
};

// 1. Initialize Stores and Core Composables
const vmInstance = getCurrentInstance();
const customersStore = useCustomersStore();
const toastStore = useToastStore();
const uiStore = useUIStore();
const verticalStore = useVerticalStore();
const invoiceStore = useInvoiceStore();
const employeeStore = useEmployeeStore();
const { selectedCustomer } = storeToRefs(customersStore);
const {
	posProfile: uiPosProfile,
	searchFocusTrigger,
	triggerTopItemSelection,
	activeView,
} = storeToRefs(uiStore);
const { currentCashier } = storeToRefs(employeeStore);
const { deferStockValidationToPayment: invoiceTypeDefersStockValidation } = storeToRefs(invoiceStore);

const __ = (window as any).__;

const eventBus = inject("eventBus") as any;
const selected_currency = ref("");
const selected_exchange_rate = ref(1);
const selected_conversion_rate = ref(1);
const isInitialized = ref(false);
const initTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const initError = ref<unknown>(null);
let stopItemInitializationWatcher: (() => void) | null = null;
let cleanupItemsSelectorEvents: (() => void) | null = null;
let cleanupTypeToSearch: (() => void) | null = null;
let cleanupLayoutLifecycle: (() => void) | null = null;
let cleanupSearchInput: (() => void) | null = null;

const responsive = useResponsive();
const rtl = useRtl();
const { fly } = useFlyAnimation();
const cartValidation = useCartValidation();

const itemsIntegration = useItemsIntegration({
	enableDebounce: false,
	debounceDelay: 300,
});

const {
	showOnlyBarcodeItems: showOnlyBarcodeItemsRef,
	filterAndPaginate,
	fetchServerItemsTimestamp,
} = useItemSearch();

const scannerInput = useScannerInput();
const itemAvailability = useItemAvailability();
const itemDetailFetcher = useItemDetailFetcher();
const itemSelection = useItemSelection();
const itemSync = useItemSync();
const itemDisplay = useItemDisplay();
const itemsLoader = useItemsLoader();
const itemCurrencyUtils = useItemCurrency();
const { startItemWorker, itemWorker, storageAvailable, markStorageUnavailable } = useItemStorageSafety();
const {
	ensureBarcodeIndex,
	resetBarcodeIndex,
	indexItem,
	replaceBarcodeIndex,
	lookupItemByBarcode,
	searchItemsByCode: searchItemsByCodeFn,
} = useBarcodeIndexing();

// 2. Local State & Settings
const search_input = ref("");
const first_search = ref("");
// Seeded from the operator's last choice: cards suit a phone, the list
// suits a counter monitor, and the pick should not snap back every
// reload. `saveItemsViewPreference` validates on the way out.
// Precedence (plan C6): the cashier's saved preference wins, validated
// against the preset's allowed set; otherwise the preset's default; then
// "list". So a coffee-quickserve register opens on its card menu until the
// operator picks otherwise, and a preset that only allows one style pins it.
function resolveInitialItemsView() {
	const cfg = verticalStore.layout.items_view;
	const allowed = Array.isArray(cfg?.allow) && cfg.allow.length ? cfg.allow : ["list", "card"];
	const saved = loadItemsViewPreference();
	if (saved && allowed.includes(saved)) {
		return saved;
	}
	return allowed.includes(cfg?.default) ? cfg.default : allowed[0];
}
const items_view = ref(resolveInitialItemsView());
const itemsPerPage = ref(50);
const clearingSearch = ref(false);
const isDragging = ref(false);
const new_line = ref(false);
const item_group = computed({
	get: () => {
		const selectedGroup = itemsIntegration.item_group.value;
		return typeof selectedGroup === "string" && selectedGroup.length > 0 ? selectedGroup : "ALL";
	},
	set: (value: string) => {
		const normalized = typeof value === "string" && value.length > 0 ? value : "ALL";
		itemsIntegration.item_group.value = normalized;
	},
});
const virtualScrollBuffer = ref(200);
const localStorageAvailable = ref(true);
const shouldMountCameraScanner = ref(false);

// Settings Refs
const hide_qty_decimals = ref(false);
const hide_zero_rate_items = ref(false);
const show_last_invoice_rate = ref(true);
const enable_background_sync = ref(true);
const background_sync_interval = ref(30);
const enable_custom_items_per_page = ref(false);
const items_per_page = ref(50);

// Temporary Settings Refs (for dialog)
const show_item_settings = ref(false);
const temp_new_line = ref(false);
const temp_hide_qty_decimals = ref(false);
const temp_hide_zero_rate_items = ref(false);
const temp_enable_custom_items_per_page = ref(false);
const temp_items_per_page = ref(50);
const temp_force_server_items = ref(false);
const temp_show_last_invoice_rate = ref(true);
const temp_enable_background_sync = ref(true);
const temp_background_sync_interval = ref(30);

const {
	qty,
	debounceQty: debounce_qty,
	clearQty,
	onQtyBlur,
} = useItemsSelectorQuantity({
	hideQtyDecimals: hide_qty_decimals,
	initialQty: 1,
});

const flyConfig = reactive({ speed: 0.6, easing: "ease-in-out" });

// 3. Computed Properties
const pos_profile = computed(() => (itemsIntegration.posProfile.value || {}) as any);
const usesLimitSearch = computed(() =>
	parseBooleanSetting(pos_profile.value?.posa_use_limit_search ?? pos_profile.value?.pose_use_limit_search),
);
const { stockSettings: stock_settings_ref } = storeToRefs(uiStore);
const stock_settings = computed(() => stock_settings_ref.value || {});
const items_group = computed(() => itemsIntegration.items_group.value || []);
const offersCount = computed(() => uiStore.offersCount || 0);
const couponsCount = computed(() => uiStore.couponsCount || 0);
// selected_currency is now a local ref synced via eventBus
const active_price_list = computed(
	() => itemsIntegration.active_price_list.value || pos_profile.value?.selling_price_list,
);
const { syncSelectorPriceList } = useItemsSelectorPriceListSync({
	activePriceList: itemsIntegration.active_price_list,
	getDefaultPriceList: () => pos_profile.value?.selling_price_list || "",
	updatePriceList: (priceList) => itemsIntegration.updatePriceList(priceList),
	getItems: (force) => itemsIntegration.get_items(force),
});
const isPosSupervisor = computed(() => parseBooleanSetting(currentCashier.value?.is_supervisor));

const isReturnInvoice = computed(() => {
	return !!invoiceStore.invoiceDoc?.is_return;
});

const blockSaleBeyondAvailableQty = computed(() => {
	if (props.context === "purchase" || invoiceTypeDefersStockValidation.value) {
		return false;
	}
	return parseBooleanSetting(pos_profile.value?.posa_block_sale_beyond_available_qty);
});

const deferStockValidationToPayment = computed(
	() => props.context === "purchase" || invoiceTypeDefersStockValidation.value,
);
const forceCustomerPriceList = computed(() =>
	parseBooleanSetting(pos_profile.value?.posa_force_price_from_customer_price_list),
);

const {
	items,
	filteredItems,
	customer_price_list,
	loading,
	isBackgroundLoading,
	loadProgress,
	syncedItemsCount = ref(0),
} = itemsIntegration;

const displayedItems = computed(() => {
	const baseItems = Array.isArray(filteredItems.value) ? filteredItems.value : [];
	// Prefer `search_input` (the v-model source) over `first_search` (a
	// derived mirror updated via watcher in useItemsSelectorSearchInput).
	// On /posapp the watcher chain sometimes fails to keep first_search
	// in step with the textfield value, leaving displayedItems stuck
	// showing the unfiltered first page. Reading the model directly is
	// always correct; first_search remains for any scanner/external
	// injection code paths that set it without touching the input.
	const rawTerm =
		(typeof search_input.value === "string" && search_input.value) ||
		first_search.value ||
		"";
	const term = (typeof rawTerm === "string" ? rawTerm : "").trim().toLowerCase();
	// Barcode-first mode: nothing visible until the operator searches/
	// scans. Cuts visual noise in convenience-store layouts where every
	// sale is a barcode hit and the operator never browses the grid.
	if (!term && pos_profile.value?.posa_hide_items_until_search) {
		return [];
	}
	return filterAndPaginate(baseItems, {
		searchTerm: term,
		hideZeroRate: hide_zero_rate_items.value,
		hideVariants: pos_profile.value?.posa_hide_variants_items,
		onlyBarcode: showOnlyBarcodeItemsRef.value,
		// Saldo items live on the Recargas destination only (owner direction
		// 2026-08-22): never in the catalogue, never as a search hit.
		hideSaldo: true,
		limit: enable_custom_items_per_page.value ? items_per_page.value : itemsPerPage.value,
	});
});

// Published for the shell (same move as update:itemsView): the movil browse
// screen draws THESE rows — the searched, filtered, paginated list this
// selector displays — so search and grid can never disagree about the
// catalogue. Immediate, so the phone's first paint has the first page.
watch(
	displayedItems,
	(rows) => {
		emit("update:displayedItems", rows);
	},
	{ immediate: true },
);

const isBarcodeFirstWaiting = computed(() => {
	if (!pos_profile.value?.posa_hide_items_until_search) return false;
	const rawTerm =
		(typeof search_input.value === "string" && search_input.value) ||
		first_search.value ||
		"";
	return !((typeof rawTerm === "string" ? rawTerm : "").trim());
});

const noItemsTitle = computed(() =>
	isBarcodeFirstWaiting.value
		? __("Scan a barcode or type to search")
		: __("No items found"),
);

const noItemsSubtitle = computed(() =>
	isBarcodeFirstWaiting.value
		? __("Items list stays empty in barcode-first mode")
		: __("Try adjusting your search or filters"),
);

watch(
	() => props.showOnlyBarcodeItems,
	(value) => {
		showOnlyBarcodeItemsRef.value = !!value;
	},
	{ immediate: true },
);

watch(
	new_line,
	(value) => {
		if (eventBus && typeof eventBus.emit === "function") {
			eventBus.emit("set_new_line", !!value);
		}
	},
	{ immediate: true },
);

const isLoadingOrSyncing = computed(() => {
	if (loading.value) return true;
	if (isBackgroundLoading.value && items.value.length === 0) return true;
	return false;
});

const syncStatus = computed(() => {
	if (loading.value) return __("Loading items...");
	if (isBackgroundLoading.value && syncProgressValue.value > 0) {
		return __("Syncing items in background");
	}
	if (isBackgroundLoading.value) return __("Preparing background sync");
	return "";
});

const syncProgressValue = computed(() => {
	const progress = Number(loadProgress.value || 0);
	if (!Number.isFinite(progress) || progress <= 0) {
		return 0;
	}
	return Math.min(100, Math.round(progress));
});

const syncItemsCount = computed(() => {
	const count = Number(syncedItemsCount.value || 0);
	if (!Number.isFinite(count) || count <= 0) {
		return 0;
	}
	return Math.round(count);
});

const showSearchSyncProgress = computed(() => isBackgroundLoading.value && items.value.length > 0);

const lastSyncTimeLabel = computed(() => {
	const lastSync = itemSync.last_background_sync_time?.value;
	if (!lastSync) return __("Never");
	const parsed = new Date(lastSync);
	return Number.isNaN(parsed.getTime()) ? __("Never") : parsed.toLocaleTimeString();
});

// 4. Initialization logic for Composables needing Context

// Settings context object for useItemsSelectorSettings
const settingsContext = reactive({
	new_line,
	hide_qty_decimals,
	hide_zero_rate_items,
	show_last_invoice_rate,
	enable_background_sync,
	background_sync_interval,
	enable_custom_items_per_page,
	items_per_page,
	temp_new_line,
	temp_hide_qty_decimals,
	temp_hide_zero_rate_items,
	temp_enable_custom_items_per_page,
	temp_items_per_page,
	temp_force_server_items,
	temp_show_last_invoice_rate,
	temp_enable_background_sync,
	temp_background_sync_interval,
	show_item_settings,
	localStorageAvailable,
	pos_profile,
	itemsPerPage,
	clearLastInvoiceRateCache: () => clearLastInvoiceRateCache(),
	scheduleLastInvoiceRateRefresh: () => scheduleLastInvoiceRateRefresh(),
	itemSync,
});

const itemsSelectorSearch = useItemsSelectorSearch({
	getVM: () => vmInstance?.proxy,
	scannerInput,
	itemSelection,
	getSearchInput: () => String(search_input.value || first_search.value || ""),
	setSearchInput: (value) => {
		search_input.value = value;
		first_search.value = value;
	},
	isLimitSearchEnabled: () => usesLimitSearch.value,
	runLimitSearch: (term) => itemsIntegration.searchItems(term),
	clearHighlightedItem: () => itemSelection.clearHighlightedItem(),
});
const itemsSelectorSettings = useItemsSelectorSettings({ getVM: () => settingsContext, itemSync });
const itemsSelectorFocus = useItemsSelectorFocus({
	getVM: () => vmInstance?.proxy,
	scannerInput,
	itemSelection,
});

const { getLastInvoiceRate, scheduleLastInvoiceRateRefresh, clearLastInvoiceRateCache } = useLastInvoiceRate({
	pos_profile: () => pos_profile.value,
	customer: () => selectedCustomer.value,
	displayedItems: () => displayedItems.value,
	show_last_invoice_rate: () => show_last_invoice_rate.value,
	autoRefresh: true,
});

const selectedSupplier = ref<string | null>(null);

const { getLastBuyingRate, scheduleLastBuyingRateRefresh, clearLastBuyingRateCache } = useLastBuyingRate({
	pos_profile: () => pos_profile.value,
	supplier: () => selectedSupplier.value,
	displayedItems: () => displayedItems.value,
	show_last_buying_rate: () =>
		show_last_invoice_rate.value && parseBooleanSetting(currentCashier.value?.is_supervisor),
});

const getLastRateForContext = (item: any) => {
	if (props.context === "purchase") {
		return getLastBuyingRate(item);
	}
	return getLastInvoiceRate(item);
};

const { getItemRateInfo } = useItemRateInfo({
	context: () => props.context,
	pos_profile: () => pos_profile.value,
	is_pos_supervisor: () => isPosSupervisor.value,
	getLastInvoiceRate,
	getLastBuyingRate,
});

const {
	cardColumns,
	cardRowHeight,
	cardSlotHeight,
	cardSlotWidth,
	cardColumnWidth,
	itemsContainerRef,
	scheduleCardMetricsUpdate,
	onListScroll: handleListScroll,
} = useItemSelectorLayout({
	resizeDebounce: 100,
	loadVisibleItems: () => itemsLoader.loadVisibleItems(),
});

const itemSelectorLayoutLifecycle = useItemsSelectorLayoutLifecycle({
	displayedItems,
	scheduleCardMetricsUpdate,
	scheduleLastInvoiceRateRefresh,
	scheduleLastBuyingRateRefresh,
	syncHighlightedItem: () => itemSelection.syncHighlightedItem(),
});

// 5. Core Methods
const add_item = async (item, optionsOrQty: any = {}) => {
	if (props.context === "pos") {
		let options: any = typeof optionsOrQty === "object" ? optionsOrQty : { qty: optionsOrQty };
		let requestedQty = options.qty !== undefined ? options.qty : qty.value || 0;
		requestedQty =
			requestedQty === "" || requestedQty == null ? 1 : Math.abs(parseFloat(requestedQty) || 1);

		item = { ...item };
		if (item.has_variants) {
			await useItemAddition().handleVariantItem(item, {
				pos_profile: pos_profile.value,
				itemDetailFetcher,
				add_item,
				items: items.value,
				invoiceStore,
				toastStore,
				uiStore,
				customer: selectedCustomer.value,
				active_price_list: itemsIntegration.active_price_list.value,
				customer_price_list: customer_price_list.value,
			});
			return;
		}

		const context = {
			pos_profile: pos_profile.value,
			stock_settings: stock_settings.value,
			customer: selectedCustomer.value,
			selected_currency: selected_currency.value,
			exchange_rate: selected_exchange_rate.value,
			conversion_rate: selected_conversion_rate.value,
			price_list_currency: item.original_currency || item.currency || pos_profile.value?.currency,
			itemCurrencyUtils,
			invoiceStore,
			eventBus,
			itemDetailFetcher,
			items: invoiceStore.items,
			isReturnInvoice: isReturnInvoice.value,
			...options,
			new_line: typeof options?.new_line === "boolean" ? options.new_line : !!new_line.value,
		};

		const isValid = await cartValidation.validateCartItem(
			item,
			requestedQty,
			pos_profile.value,
			stock_settings.value,
			null,
			blockSaleBeyondAvailableQty.value,
			!options.suppressNegativeWarning,
			true,
			isReturnInvoice.value,
			deferStockValidationToPayment.value,
		);

		if (isValid) {
			await useItemAddition().prepareItemForCart(item, requestedQty, context);
			await useItemAddition().addItem(item, context);
			if (eventBus && typeof eventBus.emit === "function") {
				eventBus.emit("apply_pricing_rules");
			}
			qty.value = 1;
			// No auto-focus into the cart qty field on add — the cursor
			// hijack interrupts fast tapping/scanning (user report 2026-08-10).
		}
	} else {
		emit("add-item", item);
	}
};

const scanProcessor = useScanProcessor({
	items,
	pos_profile,
	isReturnInvoice,
	active_price_list,
	customer_price_list,
	itemDetailFetcher,
	itemAddition: { addItem: add_item },
	barcodeIndex: {
		lookupItemByBarcode,
		searchItemsByCode: searchItemsByCodeFn,
		ensureBarcodeIndex,
		replaceBarcodeIndex,
		indexItem,
		resetBarcodeIndex,
	},
	scannerInput,
	searchCache: ref(new Map()) as Ref<Map<any, any>>,
	eventBus,
	format_number: itemDisplay.format_number,
	float_precision: computed(() => pos_profile.value?.float_precision || 2),
	hide_qty_decimals: computed(() => !!hide_qty_decimals.value),
	blockSaleBeyondAvailableQty,
	deferStockValidationToPayment,
	currency_precision: computed(() => pos_profile.value?.currency_precision || 2),
	exchange_rate: computed(() => selected_exchange_rate.value),
	selected_currency,
	conversion_rate: selected_conversion_rate,
	format_currency: itemDisplay.format_currency,
	ratePrecision: itemDisplay.ratePrecision,
	customer: selectedCustomer,
	onItemAdded: () => {
		clearSearch();
		itemsSelectorFocus.focusItemSearch();
	},
	onItemNotFound: (code) => {
		search_input.value = code;
		first_search.value = code;
	},
	stock_settings,
	search_from_scanner_ref: scannerInput.searchFromScanner,
});

const clearSearchAndQty = () => {
	clearSearch();
	clearQty();
};

const onDragStart = (event, item) => {
	isDragging.value = true;
	event.dataTransfer.setData("application/json", JSON.stringify({ type: "item-from-selector", item }));
	event.dataTransfer.effectAllowed = "copy";
	uiStore.setDraggedItem(item);
};

const onDragEnd = () => {
	isDragging.value = false;
	uiStore.setDraggedItem(null);
};

const toggleItemSettings = () => {
	temp_new_line.value = new_line.value;
	temp_hide_qty_decimals.value = hide_qty_decimals.value;
	temp_hide_zero_rate_items.value = hide_zero_rate_items.value;
	temp_enable_custom_items_per_page.value = enable_custom_items_per_page.value;
	temp_items_per_page.value = items_per_page.value;
	temp_force_server_items.value = !!(pos_profile.value && pos_profile.value.posa_force_server_items);
	temp_show_last_invoice_rate.value = show_last_invoice_rate.value;
	temp_enable_background_sync.value = enable_background_sync.value;
	temp_background_sync_interval.value = background_sync_interval.value;
	show_item_settings.value = true;
};

const applyItemSettings = (settings) => {
	itemsSelectorSettings.applyItemSettings(settings);
};

const handleRemoteStockAdjustment = (payload: unknown) => {
	itemAvailability.handleInvoiceStockAdjusted(payload);
};

// SALDO-INTEGRATION-POINT — receive picker-driven add. Picker passes a
// fully-resolved {item_code, rate, price_list_rate, saldo_referencia}.
// Hand off to handleItemSelection so addItemMeasured (with getNewItem +
// price-list normalization) runs the same as a search-driven add.
let saldoPickerAddHandler: ((p: any) => void) | null = null;
onMounted(() => {
	if (eventBus && typeof eventBus.on === "function") {
		saldoPickerAddHandler = (payload: any) => {
			if (!payload?.item_code) return;
			const synthetic = {
				item_code: payload.item_code,
				item_name: payload.item_name || payload.item_code,
				rate: payload.rate,
				price_list_rate: payload.price_list_rate,
				qty: 1,
				stock_qty: 1,
				saldo_enabled: 1,
				saldo_referencia: payload.saldo_referencia,
				uom: "Nos",
				is_stock_item: 0,
			};
			try {
				// Synthetic MouseEvent so addItemMeasured's fly-animation
				// origin point doesn't crash. Real event isn't needed —
				// the handler only reads currentTarget for animation.
				const evt = new MouseEvent("click", { bubbles: false });
				itemSelection.handleItemSelection(evt, synthetic);
			} catch (err) {
				console.error("[saldo] picker handoff failed", err);
			}
		};
		eventBus.on("saldo:picker-add", saldoPickerAddHandler);
		// MOVIL-INTEGRATION-POINT — the movil browse bar's scan glyph. The
		// camera scanner (and the wedge) live HERE; the phone rings the bell.
		eventBus.on("movil:start-camera", startCameraScanning);
		// The bar's tap: focus the ONE input directly. focusItemSearch
		// refuses coarse pointers on purpose; this tap IS the invitation.
		eventBus.on("movil:focus-search", movilFocusSearch);
		// The bar's ×: clear the ONE input (and the grid's narrowing with
		// it) — the phone's alternative was backspacing on a soft keyboard.
		eventBus.on("movil:clear-search", movilClearSearch);
	}
});
onBeforeUnmount(() => {
	if (eventBus && saldoPickerAddHandler && typeof eventBus.off === "function") {
		eventBus.off("saldo:picker-add", saldoPickerAddHandler);
		saldoPickerAddHandler = null;
		eventBus.off("movil:start-camera", startCameraScanning);
		eventBus.off("movil:focus-search", movilFocusSearch);
		eventBus.off("movil:clear-search", movilClearSearch);
	}
});

/** Clearing on a limit-search profile must RE-ASK the server: the in-memory
 *  list is only the last server page, so after a 0-hit search there is
 *  nothing local to fall back to and the grid stays empty forever
 *  (`_performSearch` refuses terms under 3 chars, and
 *  `itemsStore.searchItems("")` merely preserves that empty page). The
 *  forced default-page load is the same read the group filter performs —
 *  see the store's own note at its groupFilter branch. */
const movilClearSearch = () => {
	clearSearch();
	if (usesLimitSearch.value) {
		const store = itemsIntegration.itemsStore;
		// Order matters: `searchItems("")` resets the STORE's searchTerm —
		// while one is active, `setItems` refuses to refresh filteredItems,
		// which is how the first attempt fetched a page nobody displayed —
		// but by itself it only preserves the last (possibly empty) server
		// page. The forced load then brings the default first page back.
		void Promise.resolve(store?.searchItems?.("")).then(() =>
			store?.loadItems?.({ forceServer: true, groupFilter: store.itemGroup }),
		);
	}
};

/** Explicit focus for the movil bar's tap — the teleported header's input,
 *  found where it lives. `focus()` ignores paint, so the ghost-hidden bar
 *  still takes it and the phone keyboard rises. */
const movilFocusSearch = () => {
	const input = document.querySelector<HTMLInputElement>("#register-scan-bar input");
	input?.focus({ preventScroll: true });
};
// /SALDO-INTEGRATION-POINT

onMounted(async () => {
	itemAvailability.initAvailability();

	itemAvailability.registerCallbacks({
		getItems: () => items.value,
		getDisplayedItems: () => displayedItems.value,
		getFilteredItems: () => filteredItems.value,
		updateItemsDetails: (its, opts) => itemDetailFetcher.update_items_details(its, opts),
	});

	itemDetailFetcher.registerContext({
		get pos_profile() {
			return pos_profile.value;
		},
		get active_price_list() {
			return active_price_list.value;
		},
		get items() {
			return items.value;
		},
		get displayedItems() {
			return displayedItems.value;
		},
		itemAvailability,
		itemCurrencyUtils,
		get usesLimitSearch() {
			return parseBooleanSetting(
				pos_profile.value?.posa_use_limit_search ?? pos_profile.value?.pose_use_limit_search,
			);
		},
		get storageAvailable() {
			return storageAvailable.value;
		},
		markStorageUnavailable,
		applyCurrencyConversionToItem: (item) => {
			itemCurrencyUtils.applyCurrencyConversionToItem(item, {
				pos_profile: pos_profile.value,
				price_list_currency: item?.original_currency || item?.currency || pos_profile.value?.currency,
				selected_currency: selected_currency.value || pos_profile.value?.currency,
				exchange_rate: selected_exchange_rate.value,
				conversion_rate: selected_conversion_rate.value,
				currency_precision: pos_profile.value?.currency_precision || 2,
				flt: (window as any).frappe?.utils?.flt,
			});
		},
		forceUpdate: () => vmInstance?.proxy?.$forceUpdate?.(),
	});

	itemDisplay.registerContext({
		get context() {
			return props.context;
		},
		get pos_profile() {
			return pos_profile.value;
		},
		get float_precision() {
			return pos_profile.value?.float_precision || 2;
		},
		get currency_precision() {
			return pos_profile.value?.currency_precision || 2;
		},
		get exchange_rate() {
			return selected_exchange_rate.value;
		},
	});

	itemsLoader.registerContext({
		get eventBus() {
			return eventBus;
		},
		get itemsStore() {
			return itemsIntegration.itemsStore;
		},
		get itemDetailFetcher() {
			return itemDetailFetcher;
		},
		get displayedItems() {
			return displayedItems.value;
		},
		get cardColumns() {
			return cardColumns.value;
		},
		get loading() {
			return loading.value;
		},
	});

	itemSelection.registerContext({
		addItem: add_item,
		clearSearch: () => clearSearch(),
		focusItemSearch: () => itemsSelectorFocus.focusItemSearch(),
		fly,
		get flyConfig() {
			return flyConfig;
		},
		get displayedItems() {
			return displayedItems.value;
		},
	});

	itemSync.registerContext({
		get pos_profile() {
			return pos_profile.value;
		},
		get enable_background_sync() {
			return enable_background_sync.value;
		},
		get background_sync_interval() {
			return background_sync_interval.value;
		},
		get usesLimitSearch() {
			return usesLimitSearch.value;
		},
		get itemsPageLimit() {
			return enable_custom_items_per_page.value ? items_per_page.value : itemsPerPage.value;
		},
		getBackgroundSyncPriceList: () => {
			const customerPriceList =
				typeof customer_price_list.value === "string" ? customer_price_list.value.trim() : "";
			const profilePriceList =
				typeof pos_profile.value?.selling_price_list === "string"
					? pos_profile.value.selling_price_list.trim()
					: "";

			if (forceCustomerPriceList.value && customerPriceList) {
				return customerPriceList;
			}

			return profilePriceList || customerPriceList || null;
		},
		refreshModifiedItems: (priceListOverride) => itemsIntegration.refreshModifiedItems(priceListOverride),
		backgroundSyncItems: (args) => itemsIntegration.backgroundSyncItems(args),
		get_items: (force) => itemsIntegration.get_items(force),
		search_onchange: (value, fromScanner) => itemsIntegration.search_onchange(value, fromScanner),
		fetchServerItemsTimestamp,
		eventBus,
		getItems: () => items.value,
		getDisplayedItems: () => displayedItems.value,
		itemDetailFetcher,
	});

	if (scannerInput.setScanHandler) {
		scannerInput.setScanHandler(scanProcessor.processScannedItem);
	}

	cleanupItemsSelectorEvents = registerItemsSelectorEvents({
		eventBus,
		selectedCurrency: selected_currency,
		selectedExchangeRate: selected_exchange_rate,
		selectedConversionRate: selected_conversion_rate,
		selectedSupplier,
		syncSelectorPriceList,
		scheduleLastBuyingRateRefresh,
		requestItemSearchFocus,
		handleCartQuantitiesUpdated: itemAvailability.handleCartQuantitiesUpdated,
		handleRemoteStockAdjustment,
	});

	stopItemInitializationWatcher = startItemsSelectorInitialization({
		uiPosProfile,
		selectedCustomer,
		customerPriceList: customer_price_list,
		selectedCurrency: selected_currency,
		selectedExchangeRate: selected_exchange_rate,
		selectedConversionRate: selected_conversion_rate,
		isInitialized,
		initTimeout,
		initError,
		itemsIntegration,
		startItemWorker,
		loadItemSettings: () => itemsSelectorSettings.loadItemSettings(),
		startBackgroundSyncScheduler: () => itemSync.startBackgroundSyncScheduler(),
	});

	itemSelectorLayoutLifecycle.mount();
	cleanupLayoutLifecycle = itemSelectorLayoutLifecycle.cleanup;
	cleanupTypeToSearch = registerItemsSelectorTypeToSearch({
		getContext: () => props.context,
		activeView,
		cameraScannerActive: scannerInput.cameraScannerActive,
		prepareSearchInjection,
		revealItemSearchView,
		requestForegroundItemSearchFocus,
		appendSearchCharacter,
	});
});

onBeforeUnmount(() => {
	stopItemInitializationWatcher?.();
	stopItemInitializationWatcher = null;
	if (initTimeout.value) clearTimeout(initTimeout.value);
	itemSync.stopBackgroundSyncScheduler();
	// @ts-ignore
	if (itemWorker.value) itemWorker.value.terminate();
	cleanupItemsSelectorEvents?.();
	cleanupItemsSelectorEvents = null;
	cleanupTypeToSearch?.();
	cleanupTypeToSearch = null;
	cleanupLayoutLifecycle?.();
	cleanupLayoutLifecycle = null;
	cleanupSearchInput?.();
	cleanupSearchInput = null;
	itemSearchFocusClearGuard.dispose();
});

// 8. Watchers
watch(searchFocusTrigger, () => {
	requestItemSearchFocus();
});

// Limit-search profiles (Doco Ventas, etc.) keep the local catalog
// empty and depend on the server for results. Without this watcher
// the only way to trigger a server fetch is hitting Enter — operators
// type a query, get "No items found", and assume the search is
// broken. Mirror Vuetify v-text-field's keyup-debounce by piping
// every search_input change through the existing 300 ms-debounced
// `search_onchange`. For local-search profiles `displayedItems`
// already filters reactively from `filteredItems`, so we still gate
// on `usesLimitSearch` to avoid re-firing the server search there.
watch(search_input, (next, prev) => {
	if (next === prev) return;
	if (!usesLimitSearch.value) return;
	const fn = itemsSelectorSearch.search_onchange;
	if (typeof fn === "function") fn();
});

watch(triggerTopItemSelection, () => {
	if (activeView.value !== "items") {
		uiStore.setActiveView("items");
	}
	itemSelection.selectTopItem();
});

watch(activeView, (view) => {
	if (view === "items") {
		requestItemSearchFocus();
	}
});

// The anchored drawer sizes itself by what this panel is DRAWING — a card menu
// earns columns, a list does not. Published rather than read: the choice is
// this component's state and the shell must not reach into the preference the
// toolbar writes. `immediate` because the seeded view is already the answer.
watch(items_view, (view) => emit("update:itemsView", view), { immediate: true });

let suppressItemsViewSave = false;
watch(items_view, (view) => {
	if (suppressItemsViewSave) {
		// Preset-default application, not an operator choice — do not persist.
		suppressItemsViewSave = false;
		return;
	}
	saveItemsViewPreference(view);
});

// The preset's items_view.default lands async with the profile (after the
// ref above initialised from the retail fallback). Apply it ONCE the
// profile resolves, but only when the operator has no saved pick — their
// choice always wins (plan C6). Guarded so a manual toggle isn't clobbered.
watch(
	() => verticalStore.layout.items_view,
	(cfg) => {
		if (loadItemsViewPreference()) {
			return; // operator has an explicit preference
		}
		const allowed = Array.isArray(cfg?.allow) && cfg.allow.length ? cfg.allow : ["list", "card"];
		const next = allowed.includes(cfg?.default) ? cfg.default : allowed[0];
		if (next && next !== items_view.value) {
			// Assign without persisting: this is the preset default, not an
			// operator choice, so it must not become a saved preference.
			suppressItemsViewSave = true;
			items_view.value = next;
		}
	},
	{ immediate: true },
);

watch(selectedCustomer, () => {
	itemsIntegration.customer.value = selectedCustomer.value || null;
	clearLastInvoiceRateCache();
	scheduleLastInvoiceRateRefresh();
});

watch(isPosSupervisor, (isSupervisor) => {
	if (!isSupervisor) {
		clearLastBuyingRateCache();
		return;
	}
	scheduleLastBuyingRateRefresh();
});

// 9. Template Bindings & Direct Exports
const {
	ratePrecision,
	format_currency,
	format_number,
	currencySymbol,
	headers,
	memoizedFormatCurrency,
	memoizedFormatNumber,
	isItemHighlighted,
	isNegative,
	headerProps,
	getItemRowClass,
	getItemRowProps,
} = useItemsSelectorDisplayBindings({
	itemDisplay,
	itemSelection,
});

const {
	scannerLocked,
	scanErrorDialog,
	scanErrorMessage,
	scanErrorCode,
	scanErrorDetails,
	acknowledgeScanError,
	onBarcodeScanned: onBarcodeScannedFromScannerInput,
} = scannerInput;
const startCameraScanning = () => {
	if (scannerInput.scannerLocked.value) {
		scannerInput.playScanTone?.("error");
		return;
	}
	if (!pos_profile.value?.posa_enable_camera_scanning) {
		return;
	}
	shouldMountCameraScanner.value = true;
	// The scanner is an async chunk (739 lines + OpenCV): on the FIRST press
	// the template ref does not exist until the chunk lands, and the old
	// single nextTick made that press a dead tap — on desktop and on the
	// movil scan glyph alike. Retry briefly, stopping the moment the scanner
	// reports itself open.
	let cameraStartAttempts = 0;
	const tryStartCamera = () => {
		if (scannerInput.cameraScannerActive.value) {
			return;
		}
		itemsSelectorFocus.startCameraScanning();
		cameraStartAttempts += 1;
		if (!scannerInput.cameraScannerActive.value && cameraStartAttempts < 15) {
			setTimeout(tryStartCamera, 200);
		}
	};
	nextTick(tryStartCamera);
};
const { responsiveStyles } = responsive;
const { rtlClasses } = rtl;
const isPhone = computed(() => responsive.isPhone.value);
// Phone + sales register: the bottom toolbar is suppressed (the selector
// card owns the whole viewport height, so a sibling below it would give
// the page a scrollbar and let the search bar scroll away) and its
// controls render inside ItemSettingsDialog instead.
const hideToolbarOnPhone = computed(() => isPhone.value && props.context === "pos");
const { selectorCardStyle } = useItemsSelectorPanelSizing({
	isPhone,
	windowWidth: responsive.windowWidth,
	windowHeight: responsive.windowHeight,
	responsiveStyles,
});
const itemSearchFocusClearGuard = createItemSearchFocusClearGuard();
const {
	clearSearch,
	handleSearchInput,
	prepareSearchInjection,
	appendSearchCharacter,
	revealItemSearchView,
	requestItemSearchFocus,
	requestForegroundItemSearchFocus,
	handleItemSearchFocus,
	cleanup: stopSearchInputWatcher,
} = useItemsSelectorSearchInput({
	searchInput: search_input,
	firstSearch: first_search,
	clearingSearch,
	activeView,
	eventBus,
	scannerInput,
	searchFocusGuard: itemSearchFocusClearGuard,
	clearHighlightedItem: () => itemSelection.clearHighlightedItem(),
	focusItemSearch: () => itemsSelectorFocus.focusItemSearch(),
	// The search-input composable only ever asks for "items"; its context
	// type stays (view: string), so narrow here at the store boundary.
	setActiveView: (view) => uiStore.setActiveView(view as PosActiveView),
	triggerItemSearchFocus: () => uiStore.triggerItemSearchFocus(),
});
cleanupSearchInput = stopSearchInputWatcher;
const {
	newItemDialog,
	newItemDialogScannedBarcode,
	openNewItemDialog,
	startNewItemBarcodeScan,
	onBarcodeScanned,
	onScannerOpened,
	onScannerClosed,
	handleItemCreated,
} = useItemsSelectorScannerBridge({
	cameraScannerActive: scannerInput.cameraScannerActive,
	startCameraScanning,
	requestForegroundItemSearchFocus,
	onBarcodeScannedFromScannerInput,
	reloadItems: () => itemsIntegration.get_items(true),
});

// Proxy functions for template
const esc_event = () => clearSearch();
const onEnter = (e) => itemsSelectorSearch.onEnter(e);
const handleSearchKeydown = (e) => itemsSelectorFocus.handleSearchKeydown(e);
const handleSearchPaste = (e) => itemsSelectorFocus.handleSearchPaste(e);
const searchItems = (term) => itemsIntegration.searchItems(term);
const get_items = (force = false) => itemsIntegration.get_items(force);
const loadVisibleItems = (reset = false) => itemsLoader.loadVisibleItems(reset);
const verifyServerItemCount = () => {};
const forceReloadItems = () => itemsIntegration.get_items(true);
const cancelItemDetailsRequest = () => itemDetailFetcher.cancelItemDetailsRequest();

const select_item = (e, item) => itemSelection.handleItemSelection(e, item);
const click_item_row = (e, data) => itemSelection.handleRowClick(e, data);
const onVirtualRangeUpdate = (s, e, vs, ve) => itemsLoader.onVirtualRangeUpdate(s, e, vs, ve);
const onListScroll = (e) => handleListScroll(e);

defineExpose({
	search_input,
	debounce_qty,
	qty,
	items_view,
	pos_profile,
	isLoadingOrSyncing,
	displayedItems,
	headers,
	active_price_list,
	memoizedFormatCurrency,
	memoizedFormatNumber,
	ratePrecision,
	format_currency,
	format_number,
	currencySymbol,
	openNewItemDialog,
	clearSearch,
	onDragStart,
	onDragEnd,
	select_item,
	click_item_row,
	onVirtualRangeUpdate,
	onListScroll,
	responsiveStyles,
	rtlClasses,
	scanErrorDialog,
	scanErrorMessage,
	scanErrorCode,
	scanErrorDetails,
	acknowledgeScanError,
	lastSyncTimeLabel,
	esc_event,
	onEnter,
	handleSearchKeydown,
	handleSearchInput,
	handleSearchPaste,
	searchItems,
	get_items,
	loadVisibleItems,
	verifyServerItemCount,
	usesLimitSearch,
	storageAvailable,
	handleItemSearchFocus,
	clearQty,
	startCameraScanning,
	toggleItemSettings,
	forceReloadItems,
	cancelItemDetailsRequest,
	applyItemSettings,
	show_item_settings,
	items_group,
	item_group,
	offersCount,
	couponsCount,
	virtualScrollBuffer,
	selected_currency,
	getLastInvoiceRate,
	getLastRateForContext,
	getItemRateInfo,
	isItemHighlighted,
	isNegative,
	headerProps,
	getItemRowClass,
	getItemRowProps,
	handleItemCreated,
	onBarcodeScanned,
	onScannerOpened,
	onScannerClosed,
	new_line,
	temp_new_line,
	clearSearchAndQty,
	onQtyBlur,
	hide_qty_decimals,
	hide_zero_rate_items,
	show_last_invoice_rate,
	enable_background_sync,
	background_sync_interval,
	enable_custom_items_per_page,
	items_per_page,
	scannerLocked,
	temp_hide_qty_decimals,
	temp_hide_zero_rate_items,
	temp_enable_custom_items_per_page,
	temp_items_per_page,
	temp_force_server_items,
	temp_show_last_invoice_rate,
	temp_enable_background_sync,
	temp_background_sync_interval,
	localStorageAvailable,
	clearLastInvoiceRateCache,
	scheduleLastInvoiceRateRefresh,
	itemSync,
});
</script>

<style scoped>
/* "dynamic-card" no longer composes from pos-card; the pos-card class is added directly in the template */
/* Passes the column's height down to `.selection-card`. Without the flex
 * column here the chain broke at this div and the card fell back to
 * content height, which is why the panel needed an explicit vh in the
 * first place. */
.items-selector-shell {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
}

.dynamic-padding {
	/* Equal spacing on all sides for consistent alignment */
	padding: var(--dynamic-sm);
	display: flex;
	flex-direction: column;
	gap: var(--dynamic-sm);
}

/* Definite height so the results card (flex:1) and the table's
   height:100% chain resolve — without this the table's min-height
   floor decides, the card overflows, and rows scroll behind the
   sticky search bar.
   CHILD COMBINATOR IS LOAD-BEARING: Vue scoped CSS stamps this
   component's scope attr onto child component ROOT nodes, and
   ItemActionToolbar's root also carries class "dynamic-padding" — a
   bare `.dynamic-padding{height:100%}` turned that sticky toolbar
   into a full-height overlay covering the item list on desktop
   (prod, 2026-08-10). */
.selection-card > .dynamic-padding {
	height: 100%;
	min-height: 0;
}

/* Desktop: no height of its own — it fills the column and hands the leftover
 * to `.selector-results-card`, which hands it to the virtual scroller. The
 * phone branch of useItemsSelectorPanelSizing still sets an explicit height
 * inline, and that inline value wins over this rule, as intended. */
.selection-card {
	border-radius: 22px;
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	/* Load-bearing. The card carries Vuetify's `mx-auto`, and an auto margin on
	 * the cross axis makes a flex item shrink-to-fit and centre instead of
	 * stretching — so the moment `.items-selector-shell` became a flex column
	 * (for the height chain) this panel collapsed to content width with dead
	 * space beside it. As a plain block it had filled the column. */
	width: 100%;
}

.selector-section-card {
	background: var(--pos-card-bg) !important;
	border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
	border-radius: var(--pos-radius-md, 18px);
	box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
}

/* The search header intentionally does NOT take .selector-section-card:
   on phone it must read as the top edge of the list (a bar), not a
   floating card over it. Desktop keeps the card look via this rule. */
.selector-header-card {
	padding: 0;
	overflow: hidden;
	position: sticky;
	top: 0;
	z-index: 8;
	/* Never cede height to the flex column — the results card absorbs
	   all shortfall; without this the bar collapses to 0 on phones. */
	flex: 0 0 auto;
	background: var(--pos-surface-muted);
	border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
	border-radius: var(--pos-radius-md, 18px);
}

/* Teleported out to the sale screen (Riel y Cajón §17.7). It is no longer the
   top of a scrolling panel, so the sticky/border chrome that made it read as a
   panel header would read as a seam across the ticket instead. `position:
   sticky` in particular is actively wrong here: its containing block is now
   whatever the shell teleported it into, and it would pin against that.
   Geometry matches Main.dc.html — a 56px bar carrying the register's accent. */
.selector-header-card--detached {
	position: static;
	background: transparent;
	border-bottom: 0;
	border-radius: 0;
	overflow: visible;
	width: 100%;
}

.selector-results-card {
	padding: var(--dynamic-xs);
	overflow: hidden;
	min-width: 0;
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

/* The v-row/v-col wrapper between the results card and the table adds
   Vuetify gutters and breaks the height chain the virtual scroller
   needs; neutralise both. */
.selector-results-card .items,
.selector-results-card .items > .v-col {
	height: 100%;
	min-height: 0;
	margin: 0;
	padding: 0;
}

/* ⚠ INERT — kept for its declarations, not because it works. The element is
   built in JS (`useItemSelection.ts`: `placeholder.className =
   "item-fly-placeholder"`), so it never carries a scope attribute and no
   scoped rule can reach it; `:deep()` cannot help either. The fly-to-cart
   placeholder therefore renders unstyled today. The fix is a NON-scoped
   stylesheet, which is a visual change rather than a CSS repair — left for a
   deliberate call. Same story below for `.item-selection-option` /
   `.item-selection-image`, whose markup is an HTML string in
   `utils/itemSelectionDialog.ts`. */
.item-fly-placeholder {
	background-color: rgba(var(--v-theme-on-surface), 0.2);
}

:deep(.text-success) {
	color: rgb(var(--v-theme-success)) !important;
}

:deep(.text-primary),
:deep(.text-success),
:deep(.golden--text) {
	font-family:
		"SF Pro Display", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Arabic", "Tahoma",
		sans-serif;
	font-variant-numeric: lining-nums tabular-nums;
	font-feature-settings:
		"tnum" 1,
		"lnum" 1,
		"kern" 1;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	letter-spacing: 0.02em;
}

:deep(.negative-number) {
	color: rgb(var(--v-theme-error)) !important;
	font-weight: 600;
	font-family:
		"SF Pro Display", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Arabic", "Tahoma",
		sans-serif;
	font-variant-numeric: lining-nums tabular-nums;
	font-feature-settings:
		"tnum" 1,
		"lnum" 1,
		"kern" 1;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

/* Enhanced input fields for Arabic number support */
.v-text-field :deep(input),
.v-select :deep(input),
.v-autocomplete :deep(input) {
	/* Enhanced Arabic number font stack for input fields */
	font-family:
		"SF Pro Display", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Arabic", "Tahoma",
		sans-serif;
	font-variant-numeric: lining-nums tabular-nums;
	font-feature-settings:
		"tnum" 1,
		"lnum" 1,
		"kern" 1;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	letter-spacing: 0.01em;
}

.selection {
	background-color: var(--pos-surface-muted) !important;
}

.item-selection-option {
	border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
	transition:
		border-color 0.2s ease,
		background-color 0.2s ease;
}

.item-selection-option:hover {
	background-color: rgba(var(--v-theme-primary), 0.06);
	border-color: rgba(var(--v-theme-primary), 0.4);
}

.item-selection-image {
	width: 50px;
	height: 50px;
	object-fit: cover;
	margin-right: 15px;
	background-color: rgb(var(--v-theme-surface-variant));
}

/* Responsive breakpoints.
   NOTE: card-grid/scroller rules do NOT belong in this file. `.items-card-grid`
   and `.item-container` live in ItemsSelectorCards' template, so they carry
   THAT component's scope attribute — five rules here targeted them and every
   one was dead. See the scoping note at the top of ItemsSelectorCards' style. */
@media (max-width: 768px) {
	.dynamic-padding {
		/* Reduce spacing uniformly on smaller screens */
		padding: var(--dynamic-xs);
	}

	.selection-card {
		margin-top: var(--dynamic-xs) !important;
	}

	.selector-header-card {
		/* NOT env(safe-area-inset-top): this element is sticky inside the
		   selector card's scrollport, ~290px below the viewport top — the
		   status-bar inset pushed it 31px down and let rows show through
		   the transparent band above it (the "floating window" bug). */
		top: 0;
		z-index: 12;
		border-radius: 0;
		border-left: 0;
		border-right: 0;
		box-shadow: none;
		/* Cancel the .dynamic-padding inset → edge-to-edge bar. */
		margin-inline: calc(var(--dynamic-xs) * -1);
	}
}

@media (max-width: 480px) {
	.dynamic-padding {
		padding: var(--dynamic-xs);
	}
}

/* Fewer repaints while the theme transitions. */
* {
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

</style>
