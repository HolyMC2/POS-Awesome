<template>
	<div
		ref="posRoot"
		data-pos-keyboard-root="pos"
		class="pos-main-container dynamic-container"
		:class="[rtlClasses]"
		:style="[responsiveStyles, layoutStyleOverrides, rtlStyles]"
	>
		<!-- The FLOATING copies of the flows sheets, for the layout with no
		     rail (the dock is the nav there). With the rail on screen these
		     same components are hosted as destinations by DestinationHost
		     below, and the legacy open triggers are turned into rail
		     activations — see `legacyDialogRedirect`. Gating the floating
		     copy on the same condition is what stops a hosted sheet's store
		     flag from raising a second, modal copy over the surface. -->
		<Drafts v-if="uiStore.draftsDialog && !railVisible"></Drafts>
		<InvoiceManagement
			v-if="uiStore.invoiceManagementDialog && !invoiceManagementHosted"
		></InvoiceManagement>
		<SalesOrders v-if="uiStore.ordersDialog"></SalesOrders>
		<Returns
			v-if="returnsMounted && !railVisible"
			:open-request="returnsOpenRequest"
		></Returns>
		<NewAddress v-if="newAddressMounted" :open-request="newAddressOpenRequest"></NewAddress>
		<MpesaPayments v-if="mpesaMounted" :open-request="mpesaOpenRequest"></MpesaPayments>
		<Variants v-if="uiStore.variantsDialog"></Variants>
		<!-- SALDO-INTEGRATION-POINT — components live in saldo Frappe app -->
		<SaldoReferenciaDialog
			v-model="saldoDialogOpen"
			:meta="saldoDialogMeta"
			@captured="onSaldoCaptured"
			@cancelled="onSaldoCancelled"
		></SaldoReferenciaDialog>
		<SaldoStatusDialog></SaldoStatusDialog>
		<ShortcutsCheatSheet></ShortcutsCheatSheet>
		<PriceCheckDialog></PriceCheckDialog>
		<SaldoCatalogPicker
			v-model="saldoPickerOpen"
			@picked="onSaldoPicked"
			@cancelled="saldoPickerOpen = false"
		></SaldoCatalogPicker>
		<!-- SaldoHoldsBadge moved into the Navbar (top bar, beside the online
		     indicator). Its print/realtime wiring is unaffected — it still
		     emits saldo:hold_print on saldoCaptureBus, handled below. -->
		<!-- /SALDO-INTEGRATION-POINT -->
		<OpeningDialog
			v-if="dialog"
			:dialog="dialog"
			@close="closeOpeningDialog"
			@register="handleRegisterPosData"
		></OpeningDialog>
		<!-- The payment DIALOG survives only where there is no rail to host the
		     surface beside: 992–1099px, which has the dialog breakpoint but not
		     the rail's. Above 1100 Cobro is a destination-style surface in the
		     shell's content area (build plan §14.2); below 992 the payment
		     panel replaces the selector column, unchanged. -->
		<v-dialog
			v-if="usePaymentDialog && !railVisible"
			v-model="paymentDialogOpen"
			:retain-focus="false"
			width="96vw"
			max-width="1480"
			scrim="rgba(15, 23, 42, 0.55)"
			class="payment-dialog"
			@update:model-value="handlePaymentDialogUpdate"
			@after-leave="handlePaymentDialogAfterLeave"
		>
			<Payments v-if="paymentDialogOpen" dialog-mode />
		</v-dialog>
		<!-- Mounted on the shell, above the payment dialog it outlives — see
		     the onChangeDue note in Payments.vue. -->
		<ChangeDueDialog
			v-model="changeDueOpen"
			:amount="changeDueAmount"
			:currency-symbol="changeDueSymbol"
			:format-amount="formatChangeAmount"
			@confirm="onChangeDueConfirmed"
		></ChangeDueDialog>
		<!-- The register shell: rail on the left, everything else to its right
		     (roadmap §17.7, direction E). The rail is the ONLY desktop nav; the
		     navbar's actions menu survives because it still carries settings,
		     printing, language and the cashier tools, none of which are
		     destinations. Below the two-column boundary the dock is the nav and
		     the rail is not drawn at all. -->
		<div v-show="!dialog" class="register-shell">
			<RegisterRail v-if="railVisible" :context="railContext" @setting="openRegisterSetting" />

			<!-- `position: relative` is load-bearing, not cosmetic: the catalogue
			     drawer's overlay presentation is `position: absolute` precisely so
			     the action band below stays visible ("the drawer never reaches
			     it"). Without a positioned ancestor it would escape to the
			     viewport and cover the one number that matters. -->
			<div class="register-shell__content">
				<!-- A destination that is refused, or one of the hosted flows, takes
				     the whole content area. The sale underneath is kept mounted
				     (v-show, not v-if) so a cashier who glances at Facturas and
				     comes back has the same cart, scroll position and focus. -->
				<!-- Cobro. Same slot, same treatment as a destination: the sale
				     underneath stays mounted (v-show) so backing out returns the
				     cashier to the cart they left, with its scroll and its focus.
				     It publishes its own band upward exactly as a hosted sheet
				     does, and the shell answers `sale.collectAndClose` below. -->
				<CobroSurface v-if="cobroHosted" @band="onHostedBand" />

				<DestinationHost
					v-else-if="hostedDestinationId"
					:destination-id="hostedDestinationId"
					:refusal="destinationRefusal"
					:t="verticalT"
					@dismiss="dismissDestination"
					@band="onHostedBand"
				/>

				<!--
					Teleport target for ItemsSelector's scan/search header.

					The register scans with the ticket at full width and the grid
					nowhere on screen — that is the density argument for direction E
					over the rejected direction C. `<Teleport defer>` resolves its
					target AFTER the render cycle, so this div may sit above the
					component that fills it.

					An EMPTY div, never a second ItemHeader: the scanner attaches to
					the DOCUMENT behind a `_scannerAttached` singleton, so a second
					scan field would count every barcode twice. Teleport moves the one
					header's nodes and leaves its owner mounted.
				-->
				<div v-show="!hostedDestinationId && !cobroHosted" id="register-scan-bar"></div>

				<v-row
					v-show="!hostedDestinationId && !cobroHosted"
					dense
					class="ma-0 dynamic-main-row"
					:class="{
						'dynamic-main-row--phone': isPhone,
						'dynamic-main-row--with-drawer': drawerAnchoredOpen,
					}"
				>
				<v-col
					v-show="(!useCompactPosSwitcher || compactPanel === 'selector') && activeView === 'offers'"
					:xl="useCompactPosSwitcher ? 12 : 5"
					:lg="useCompactPosSwitcher ? 12 : 5"
					:md="useCompactPosSwitcher ? 12 : 5"
					:sm="useCompactPosSwitcher ? 12 : 5"
					cols="12"
					class="pos dynamic-col dynamic-col--selector"
				>
					<PosOffers></PosOffers>
				</v-col>
				<v-col
					v-show="(!useCompactPosSwitcher || compactPanel === 'selector') && activeView === 'coupons'"
					:xl="useCompactPosSwitcher ? 12 : 5"
					:lg="useCompactPosSwitcher ? 12 : 5"
					:md="useCompactPosSwitcher ? 12 : 5"
					:sm="useCompactPosSwitcher ? 12 : 5"
					cols="12"
					class="pos dynamic-col dynamic-col--selector"
				>
					<PosCoupons></PosCoupons>
				</v-col>
				<v-col
					v-show="(!useCompactPosSwitcher || compactPanel === 'selector') && activeView === 'floor'"
					:xl="useCompactPosSwitcher ? 12 : 5"
					:lg="useCompactPosSwitcher ? 12 : 5"
					:md="useCompactPosSwitcher ? 12 : 5"
					:sm="useCompactPosSwitcher ? 12 : 5"
					cols="12"
					class="pos dynamic-col dynamic-col--selector"
				>
					<!-- The panel's visibility is v-show like every other selector
					     column; this v-if is the CAPABILITY gate, so a retail
					     register never fetches the floor chunk and never opens a
					     socket room. On a restaurant register it mounts with the
					     shell and stays mounted, which is what keeps the dock badge
					     honest before anyone has opened the floor. -->
					<FloorView v-if="floorEnabled"></FloorView>
				</v-col>
				<v-col
					v-if="
						(!useCompactPosSwitcher || compactPanel === 'selector') &&
						activeView === 'payment' &&
						!usePaymentDialog
					"
					:xl="useCompactPosSwitcher ? 12 : 5"
					:lg="useCompactPosSwitcher ? 12 : 5"
					:md="useCompactPosSwitcher ? 12 : 5"
					:sm="useCompactPosSwitcher ? 12 : 5"
					cols="12"
					class="pos dynamic-col dynamic-col--selector"
				>
					<Payments></Payments>
				</v-col>

				<v-col
					v-show="!useCompactPosSwitcher || compactPanel === 'invoice'"
					:xl="12"
					:lg="12"
					:md="12"
					:sm="12"
					cols="12"
					class="pos dynamic-col dynamic-col--invoice"
				>
					<component :is="CartView" @open-saldo-picker="openSaldoPicker" />
				</v-col>

					<!--
						El cajón — INSIDE the row, deliberately.

						Anchored presentation is "a plain flex sibling of the cart, inside
						the content row" (CatalogDrawer.vue's own note), and it is not
						positioned, so the full-width band below stays reachable — the
						drawer "never reaches it". Placed below the row instead it would
						stack under the cart, because the content wrapper is a flex
						COLUMN.

						Mounted unconditionally, and `#persistent` provided
						unconditionally: the wrapper inside is `v-if="$slots.persistent"`,
						which is static per call site, so a parent that toggled either one
						would re-create exactly the remount this arrangement exists to
						prevent.
					-->
					<CatalogDrawer
						:phase="catalogDrawer.phase.value"
						:presentation="catalogDrawer.presentation.value"
						:open-reason="catalogDrawer.openReason.value"
						:categories="catalogCategories"
						:active-category="catalogDrawer.activeCategory.value"
						:traps-focus="catalogDrawer.trapsFocus.value"
						:shows-scrim="catalogDrawer.showsScrim.value"
						:transition-duration-ms="catalogDrawer.transitionDurationMs.value"
						:can-anchor="catalogDrawer.canAnchor.value"
						:items-view="catalogItemsView"
						@close="closeCatalogDrawer"
						@opened="onDrawerOpened"
						@update:active-category="catalogDrawer.setCategory"
						@update:anchored="catalogDrawer.setAnchored"
					>
						<template #persistent>
							<!--
								THE ItemsSelector. Exactly one, and it never unmounts.

								It used to be two `v-if` branches — one here, one in the
								selector column — which read as single ownership but was not.
								`useScannerInput` attaches the keyboard wedge to the DOCUMENT
								behind a `document._scannerAttached` singleton, and the
								attach/detach pair is symmetric but ORDER-DEPENDENT: on close
								the column patched first, the new instance's `initScanner()`
								saw the flag still set by the not-yet-unmounted old one and
								returned early, and then the old one cleared it. Net effect,
								invisible without a scanner in the room: the shop's barcode
								gun died the first time a cashier closed the catalogue.

								Now the panel itself never unmounts — the layer's
								`display: none` is the only hiding mechanism — so visibility
								is `show-catalog` and the scan header teleports out to the
								sale screen. Nothing in this subtree may become a `v-if`.
							-->
							<component
								:is="ItemsView"
								context="pos"
								header-target="#register-scan-bar"
								:show-catalog="catalogDrawer.isOpen.value"
								@update:items-view="catalogItemsView = $event"
							/>
						</template>
					</CatalogDrawer>
				</v-row>

				<!-- "Se suele llevar junto". Above the band on purpose: it is an
				     offer, and the band is the commitment. -->
				<ComboSuggestionStrip
					v-if="!hostedDestinationId && !cobroHosted && comboSuggestions.length"
					:suggestions="comboSuggestions"
					:format-currency="formatCurrency"
					@add="addComboSuggestion"
				/>

				<!-- One band, one number, one action (§17.7 invariant 1). Desktop
				     only: below the boundary the dock's own summary already owns
				     that lane, and two of them would be two numbers. -->
				<ActionBand
					v-if="railVisible"
					:state="bandState"
					:format-currency="formatCurrency"
					@primary="onBandPrimary"
				/>

			</div>
		</div>

		<!-- Offline is a STATE laid over whatever the cashier was doing, never a
		     destination: the dock stays mounted and tappable underneath it. -->
		<MobileOfflineOverlay
			v-if="showBottomDock"
			:visible="!isOnline"
			:dock-height="bottomDockHeight"
			:pending-count="queuedInvoiceCount"
			:queued-amount-label="queuedAmountLabel"
		/>

		<div v-if="showBottomDock" ref="mobileDock" data-testid="mobile-dock" class="mobile-dock">
			<div class="mobile-dock__summary">
				<div class="mobile-dock__totals">
					<strong class="mobile-dock__amount">{{ formattedCartTotal }}</strong>
					<div class="mobile-dock__subline">
						<button
							type="button"
							class="mobile-dock__customer"
							:title="dockCustomerLabel"
							:aria-label="`${__('Customer')}: ${dockCustomerLabel}`"
							@click="jumpToCustomer"
						>
							<v-icon icon="mdi-account-outline" size="14" />
							<span class="mobile-dock__customer-name">{{ dockCustomerLabel }}</span>
						</button>
						<span class="mobile-dock__meta">{{ cartMetaLabel }}</span>
					</div>
				</div>
				<!-- The always-on discount field held a 190px slot in this row
				     down to 360px viewports, squeezing the customer chip at
				     every common phone width. It now lives in an expandable
				     row; the toggle shows the applied value while collapsed. -->
				<button
					v-if="showDockDiscountToggle"
					type="button"
					class="mobile-dock__discount-toggle"
					:class="{ 'mobile-dock__discount-toggle--active': dockDiscountOpen || dockDiscountApplied }"
					:aria-expanded="dockDiscountOpen ? 'true' : 'false'"
					:aria-label="__('Additional discount')"
					@click="toggleDockDiscount"
				>
					<v-icon
						:icon="posProfile?.posa_use_percentage_discount ? 'mdi-percent' : 'mdi-cash-minus'"
						size="18"
					/>
					<span v-if="dockDiscountApplied" class="mobile-dock__discount-value">{{
						dockDiscountLabel
					}}</span>
				</button>
			</div>
			<v-expand-transition>
				<div v-show="dockDiscountOpen" class="mobile-dock__discount-row">
					<v-text-field
						v-if="!posProfile?.posa_use_percentage_discount"
						ref="additionalDiscountField"
						v-model="additionalDiscountDisplay"
						@update:model-value="handleAdditionalDiscountUpdate"
						@focus="handleAdditionalDiscountFocus"
						@blur="handleAdditionalDiscountBlur"
						:placeholder="__('Discount')"
						prepend-inner-icon="mdi-cash-minus"
						variant="solo"
						density="compact"
						color="warning"
						inputmode="decimal"
						enterkeyhint="done"
						:prefix="getCurrencySymbol(posProfile?.currency)"
						:disabled="
							!posProfile?.posa_allow_user_to_edit_additional_discount ||
							!!discountPercentageOfferName
						"
						hide-details
					/>
					<v-text-field
						v-else
						ref="additionalDiscountField"
						v-model="additionalDiscountPercentageDisplay"
						@update:model-value="handleAdditionalDiscountPercentageUpdate"
						@focus="handleAdditionalDiscountPercentageFocus"
						@blur="handleAdditionalDiscountPercentageBlur"
						@change="commitAdditionalDiscountPercentage"
						:placeholder="__('Discount %')"
						suffix="%"
						prepend-inner-icon="mdi-percent"
						variant="solo"
						density="compact"
						color="warning"
						inputmode="decimal"
						enterkeyhint="done"
						:disabled="
							!posProfile?.posa_allow_user_to_edit_additional_discount ||
							!!discountPercentageOfferName
						"
						hide-details
					/>
				</div>
			</v-expand-transition>
			<div class="mobile-dock__tabs" :style="{ '--dock-tab-count': dockTabCount }">
				<button
					v-for="tab in dockTabs"
					:key="tab.id"
					type="button"
					class="mobile-dock__tab"
					:data-testid="'dock-' + tab.id"
					:class="[
						tab.cls,
						{
							'mobile-dock__tab--active': tab.isActive(),
							'mobile-dock__tab--busy': tab.busy?.(),
							'mobile-dock__tab--dimmed': isDockTabDimmedOffline(tab, isOnline),
						},
					]"
					:aria-label="tab.ariaLabel()"
					:aria-busy="tab.busy?.() ? 'true' : undefined"
					:disabled="tab.busy?.() || false"
					@click="tab.onTap()"
				>
					<span
						v-if="tab.badge && tab.badge()"
						class="mobile-dock__pill"
						:class="{ 'mobile-dock__pill--sm': tab.badgeSm }"
						>{{ tab.badge() }}</span
					>
					<v-icon :icon="tab.icon" :size="tab.iconSize" />
					<span class="mobile-dock__tab-label">{{ tab.label() }}</span>
				</button>
			</div>
		</div>
	</div>
</template>

<script>
import {
	defineAsyncComponent,
	inject,
	markRaw,
	ref,
	onMounted,
	onBeforeUnmount,
	computed,
	watch,
	nextTick,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { resolveCartView, resolveItemsView } from "../../../vertical/viewRegistry";
import { buildDockTabDefs, isDockTabDimmedOffline } from "../../../vertical/viewContracts";
// Riel y Cajón (roadmap §17.7). All static, not async: the rail and the band
// are on screen from first paint, and the drawer/host/overlay are chrome that
// must already exist the instant a chord or a lost connection asks for them —
// a chunk fetch at that moment is a chunk fetch at the worst moment.
import RegisterRail from "./rail/RegisterRail.vue";
import CatalogDrawer from "./drawer/CatalogDrawer.vue";
import ActionBand from "./band/ActionBand.vue";
import DestinationHost from "./destinations/DestinationHost.vue";
import CobroSurface from "./cobro/CobroSurface.vue";
import MobileOfflineOverlay from "./mobile/MobileOfflineOverlay.vue";
import ComboSuggestionStrip from "../combos/ComboSuggestionStrip.vue";
import {
	resolveSearchDrawerIntent,
	useCatalogDrawer,
} from "../../../composables/pos/shell/useCatalogDrawer";

/** See `handleItemSearchChanged`: longer than a scanner's burst, shorter than a keystroke. */
const SEARCH_DRAWER_DEBOUNCE_MS = 200;
import { resolveBandState } from "../../../composables/pos/shell/bandState";
import { useDestinationRouting } from "../../../composables/pos/shell/useDestinationRouting";
import { useEmployeeStore } from "../../../stores/employeeStore";
import { getDashboardAccessCached } from "../../../services/dashboardService";
import {
	getServiceOrderCountsCached,
	invalidateServiceOrderCounts,
} from "../../../services/serviceOrderService";
import { buildCombosCategory, buildSuggestions } from "../../../composables/pos/combos/comboCatalog";
import { useOnlineStatus } from "../../../composables/core/useOnlineStatus";
import OpeningDialog from "../shift/OpeningDialog.vue";
import PosOffers from "../offers/PosOffers.vue";
import PosCoupons from "../offers/PosCoupons.vue";
// Static, not async: it is asked for at the instant a sale lands, and a chunk
// fetch there is exactly the moment the network is least trustworthy.
import ChangeDueDialog from "../payments/ChangeDueDialog.vue";
// SALDO-INTEGRATION-POINT — Vue sources live in the saldo Frappe app
// (see saldo/saldo/public/saldo_pos/). Resolved via Vite alias `@saldo`
// declared in vite.config.js. Upstream rebase: keep these lines.
import SaldoReferenciaDialog from "@saldo/SaldoReferenciaDialog.vue";
import SaldoStatusDialog from "@saldo/SaldoStatusDialog.vue";
import ShortcutsCheatSheet from "./ShortcutsCheatSheet.vue";
import PriceCheckDialog from "./PriceCheckDialog.vue";
import SaldoCatalogPicker from "@saldo/SaldoCatalogPicker.vue";
import { saldoCaptureBus } from "@saldo/useSaldoCapture";
import { printInvoiceByName } from "../../../utils/printInvoiceByName";
import { usePosShift } from "../../../composables/pos/shared/usePosShift";
import { useOffers } from "../../../composables/pos/shared/useOffers";
// Import the cache cleanup function
import { clearExpiredCustomerBalances } from "../../../../offline/index";
import { useResponsive } from "../../../composables/core/useResponsive";
import { useFormat } from "../../../format";
import { connectQzTray } from "../../../services/qzTray";
import { useRtl } from "../../../composables/core/useRtl";
import { useUIStore } from "../../../stores/uiStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useVerticalStore } from "../../../stores/verticalStore";
import { useFloorStore } from "../../../stores/floorStore";
import { useItemsStore } from "../../../stores/itemsStore";
import { useCustomersStore } from "../../../stores/customersStore";
import { storeToRefs } from "pinia";
import { parseBooleanSetting } from "../../../utils/stock";
import { useCustomerDisplayPublisher } from "../../../composables/pos/shared/useCustomerDisplayPublisher";
import {
	isEditableElement,
	isElementVisible,
	moveFocusByArrow,
	resolveKeyboardNavigationRoot,
} from "../../../utils/keyboardNavigation";

const Payments = defineAsyncComponent(() => import("../Payments.vue"));
const FloorView = defineAsyncComponent(() => import("../../floor/FloorView.vue"));
const Drafts = defineAsyncComponent(() => import("../flows/Drafts.vue"));
const InvoiceManagement = defineAsyncComponent(() => import("../flows/InvoiceManagement.vue"));
const SalesOrders = defineAsyncComponent(() => import("../flows/SalesOrders.vue"));
const NewAddress = defineAsyncComponent(() => import("../customer/NewAddress.vue"));
const Variants = defineAsyncComponent(() => import("../items/Variants.vue"));
const Returns = defineAsyncComponent(() => import("../flows/Returns.vue"));
const MpesaPayments = defineAsyncComponent(() => import("../payments/Mpesa-Payments.vue"));

export default {
	setup() {
		const eventBus = inject("eventBus");
		const route = useRoute();
		const dialog = ref(false);
		const posRoot = ref(null);
		const additionalDiscountField = ref(null);
		const mobileDock = ref(null);
		// SALDO-INTEGRATION-POINT — picker open state + handlers live in
		// setup() (not data()/methods) because the Options-API method binding
		// was not reaching the template's @open-saldo-picker handler in the
		// production-built render scope. setup() returns expose cleanly via
		// `n.openSaldoPicker` after Vite compilation.
		const saldoPickerOpen = ref(false);
		// SALDO-INTEGRATION-POINT — per-profile gate. The launcher button is
		// hidden via v-if when the active POS Profile has saldo disabled, but
		// the eventBus `open-saldo-picker` path could still fire, so guard here
		// too (defensive). `posProfile` is a storeToRefs(uiStore) ref declared
		// below; closure resolves it at click-time, well after setup() returns.
		const saldoEnabledForProfile = () =>
			parseBooleanSetting(posProfile.value?.saldo_enabled);
		const openSaldoPicker = () => {
			if (!saldoEnabledForProfile()) {
				return;
			}
			// With the rail on screen, Recarga is a DESTINATION (§12 F) and the
			// cart's button is one more way to reach it. The two-step picker
			// stays the mechanism for the layout with no rail.
			if (railVisible.value) {
				destinationRouting.activate("recharge", "shortcut");
				return;
			}
			saldoPickerOpen.value = true;
		};
		const onSaldoPicked = (payload) => {
			// Hand off to ItemsSelector's add pipeline (addItemMeasured) so
			// posawesome's getNewItem + price-list normalization run. Raw
			// invoiceStore.addItems bypasses that and the cart line ends up
			// with rate=0 because price_list_rate isn't preserved on a
			// bare-bones row.
			//
			// The receiver sees saldo_referencia already populated and skips
			// the requireSaldoCapture intercept (useItemAddition.ts:354).
			if (eventBus && typeof eventBus.emit === "function") {
				eventBus.emit("saldo:picker-add", {
					item_code: payload.item_code,
					item_name: payload.product_label || payload.item_code,
					rate: Number(payload.monto),
					price_list_rate: Number(payload.monto),
					saldo_referencia: payload.referencia,
				});
			} else {
				console.error("[saldo] eventBus missing — cannot deliver picker payload");
			}
		};
		const responsive = useResponsive();
		const rtl = useRtl();
		const shift = usePosShift(() => {
			dialog.value = true;
		});
		const handleSubmitClosingPos = (data) => {
			shift.submit_closing_pos(data);
		};
		const handleOpenShiftDetails = () => {
			shift.get_closing_data();
		};
		const offers = useOffers();
		const uiStore = useUIStore();
		const invoiceStore = useInvoiceStore();
		const itemsStore = useItemsStore();
		const customersStore = useCustomersStore();
		const __ = window.__;
		const { activeView, posProfile, paymentDialogOpen, offersCount, couponsCount } = storeToRefs(uiStore);
		const { selectedCustomer, customerInfo } = storeToRefs(customersStore);
		const {
			invoiceDoc,
			itemsCount,
			totalQty,
			grossTotal,
			discountTotal,
			additionalDiscount,
			additionalDiscountPercentage,
		} = storeToRefs(invoiceStore);
		const usePaymentDialog = computed(() => responsive.windowWidth.value >= 992);

		// SALDO-INTEGRATION-POINT — per-profile gate for the catalog picker.
		// SaldoReferenciaDialog + SaldoStatusDialog stay mounted (bus-driven,
		// inert without saldo lines); only the operator-facing picker is gated.
		const showSaldoCatalogPicker = computed(() =>
			parseBooleanSetting(posProfile.value?.saldo_enabled),
		);

		// Lean vertical layout (verticalStore) forces the stacked
		// single-panel mode + dock at any width; otherwise width decides.
		const vertical = useVerticalStore();
		// Restaurant floor: state + realtime live in the store, the panel is
		// mounted below only when the preset carries the `tables` capability.
		const floorStore = useFloorStore();
		const floorEnabled = computed(() => vertical.has("tables"));
		const floorOpenOrdersCount = computed(() => floorStore.openOrdersCount);
		// Panels resolve through the view registry keyed (layout, context)
		// — an unknown layout key throws at setup, never a blank counter.
		const ItemsView = markRaw(resolveItemsView(vertical.layout.items_panel, "pos"));
		const CartView = markRaw(resolveCartView(vertical.layout.cart_style, "pos"));
		const useCompactPosSwitcher = computed(
			() => vertical.leanVerticalLayout || responsive.windowWidth.value < 1100,
		);
		const compactPanel = ref("selector");
		const isPhone = computed(() => responsive.isPhone.value);
		const showBottomDock = computed(
			() => !dialog.value && (vertical.leanVerticalLayout || responsive.windowWidth.value < 1100),
		);
		const bottomDockHeight = ref(0);
		let mobileDockObserver = null;
		const returnsMounted = ref(false);
		const returnsOpenRequest = ref(null);
		const newAddressMounted = ref(false);
		const newAddressOpenRequest = ref(null);
		const mpesaMounted = ref(false);
		const mpesaOpenRequest = ref(null);
		const isEditingAdditionalDiscount = ref(false);
		const isEditingAdditionalDiscountPercentage = ref(false);
		const invoiceTotal = computed(() => {
			// Published by the invoice panel (CartView contract) — never read
			// off the component instance.
			const liveSubtotal = Number(invoiceStore.liveSubtotal);
			if (invoiceStore.liveSubtotal !== null && Number.isFinite(liveSubtotal)) {
				return liveSubtotal;
			}

			const doc = invoiceDoc.value || {};
			const fallbackTotal = Number(grossTotal.value || 0);
			const rawValue = doc.rounded_total ?? doc.grand_total ?? doc.total ?? fallbackTotal;
			const numericValue = Number(rawValue);
			return Number.isFinite(numericValue) ? numericValue : fallbackTotal;
		});
		const activeCurrency = computed(() => invoiceDoc.value?.currency || posProfile.value?.currency || "");
		const formatCompactNumber = (value) =>
			new Intl.NumberFormat(undefined, {
				maximumFractionDigits: value % 1 === 0 ? 0 : 2,
			}).format(Number(value || 0));
		const getCurrencySymbol = (currency) => {
			const resolver = window.get_currency_symbol || globalThis.get_currency_symbol;
			if (typeof resolver === "function") {
				return resolver(currency || activeCurrency.value || "") || "";
			}
			return currency ? `${currency} ` : "";
		};
		const formattedCartTotal = computed(() => {
			const symbol = getCurrencySymbol(activeCurrency.value);
			return `${symbol}${formatCompactNumber(invoiceTotal.value)}`.trim();
		});
		const formattedDiscountTotal = computed(() => {
			const symbol = getCurrencySymbol(activeCurrency.value);
			return `${symbol}${formatCompactNumber(discountTotal.value || 0)} ${__("discount")}`.trim();
		});
		const cartMetaLabel = computed(() => {
			const qty = formatCompactNumber(totalQty.value || 0);
			const itemCount = formatCompactNumber(itemsCount.value || 0);
			return `${itemCount} ${__("lines")} | ${qty} ${__("qty")}`;
		});
		// The active customer is otherwise invisible while browsing the
		// catalog on a phone — the cart panel that carries it is off-screen.
		const dockCustomerLabel = computed(() => {
			const info = customerInfo.value || {};
			return info.customer_name || info.name || selectedCustomer.value || __("No customer");
		});

		const discountPercentageOfferName = computed(
			() => invoiceStore.discountPercentageOfferName || null,
		);
		const showUnsignedReturnDiscount = computed(
			() => !!invoiceStore.returnDiscountMeta && !posProfile.value?.posa_use_percentage_discount,
		);
		const normalizeDiscountDisplay = (value) => {
			if (value === 0 || value === "0") {
				return "";
			}
			return value;
		};
		const normalizeAdditionalDiscountDisplay = (value) => {
			if (value === 0 || value === "0") {
				return "";
			}
			if (showUnsignedReturnDiscount.value) {
				const proratedValue = Number(invoiceStore.returnDiscountMeta?.prorated_discount);
				if (Number.isFinite(proratedValue)) {
					return Math.abs(proratedValue);
				}
				const numericValue = Number(value);
				if (Number.isFinite(numericValue)) {
					return Math.abs(numericValue);
				}
			}
			return value;
		};
		const normalizeAdditionalDiscountInput = (value) => {
			if (showUnsignedReturnDiscount.value) {
				const numericValue = Number(value);
				if (Number.isFinite(numericValue)) {
					const originalStoredValue = Number(additionalDiscount.value);
					const sign = Math.sign(
						Number.isFinite(originalStoredValue) && originalStoredValue !== 0
							? originalStoredValue
							: -1,
					);
					return sign * Math.abs(numericValue);
				}
			}
			return value;
		};
		const additionalDiscountDisplay = ref(normalizeAdditionalDiscountDisplay(additionalDiscount.value));
		const additionalDiscountPercentageDisplay = ref(
			normalizeDiscountDisplay(additionalDiscountPercentage.value),
		);

		watch(
			() => [
				additionalDiscount.value,
				invoiceStore.returnDiscountMeta?.prorated_discount,
				posProfile.value?.posa_use_percentage_discount,
			],
			([value]) => {
				if (!isEditingAdditionalDiscount.value) {
					additionalDiscountDisplay.value = normalizeAdditionalDiscountDisplay(value);
				}
			},
		);

		watch(additionalDiscountPercentage, (value) => {
			if (!isEditingAdditionalDiscountPercentage.value) {
				additionalDiscountPercentageDisplay.value = normalizeDiscountDisplay(value);
			}
		});

		const focusItemSearchField = () => {
			nextTick(() => {
				uiStore.triggerItemSearchFocus();
				eventBus?.emit?.("focus_item_search");
			});
		};

		// Change due — raised by Payments.vue via the bus the moment a sale with
		// change is submitted, and dismissed only by the cashier confirming the
		// money left the drawer.
		const { formatCurrency } = useFormat();
		const changeDueOpen = ref(false);
		const changeDueAmount = ref(0);
		const changeDueCurrency = ref("");
		const changeDueSymbol = computed(() => getCurrencySymbol(changeDueCurrency.value));
		const formatChangeAmount = (value) => formatCurrency(value);
		const handleShowChangeDue = (payload = {}) => {
			const amount = Number(payload.amount) || 0;
			if (amount <= 0) {
				return;
			}
			changeDueAmount.value = amount;
			changeDueCurrency.value = payload.currency || "";
			changeDueOpen.value = true;
		};
		const onChangeDueConfirmed = () => {
			changeDueOpen.value = false;
			// The sale already cleared itself; this only returns the cashier's
			// hands to where the next one starts.
			focusItemSearchField();
		};

		// Tapping a table opens its order and the waiter's next act is adding
		// food, so the shell follows them to the cart. The floor panel stays
		// mounted behind it (v-show) and keeps its socket room.
		const handleFloorOrderOpened = () => {
			showInvoicePanel();
		};

		const handlePaymentDialogUpdate = (value) => {
			if (value || !usePaymentDialog.value) {
				return;
			}
			uiStore.closePaymentDialog();
		};

		const handlePaymentDialogAfterLeave = () => {
			if (!usePaymentDialog.value) {
				return;
			}
			focusItemSearchField();
		};

		const setCompactPanel = (panel) => {
			compactPanel.value = panel;
			if (panel === "selector" && activeView.value === "items") {
				focusItemSearchField();
			}
		};
		const setSelectorView = (view) => {
			compactPanel.value = "selector";
			uiStore.setActiveView(view);
			if (view === "items") {
				focusItemSearchField();
			}
		};
		// One-shot: swallows the very next activeView->compactPanel sync. Set
		// only by showInvoicePanel below, and only on a transition that is
		// guaranteed to fire that watcher, so it is always consumed and can
		// never leak into a later view change. See the watcher for the why.
		const suppressNextPanelSync = ref(false);
		const showInvoicePanel = () => {
			compactPanel.value = "invoice";
			if (activeView.value === "payment" && !usePaymentDialog.value) {
				// Leaving the inline payment view means changing activeView, and
				// the activeView watcher answers every change by forcing the
				// selector panel — which would undo the line above and land the
				// cashier on Browse, item search autofocused, Android keyboard
				// up. Asking for the cart has to mean the cart.
				suppressNextPanelSync.value = true;
				uiStore.setActiveView("items");
			}
		};
		const jumpToCustomer = () => {
			showInvoicePanel();
			nextTick(() => {
				eventBus.emit("open_customer_details");
			});
		};
		const showPaymentPanel = () => {
			compactPanel.value = "selector";
			if (usePaymentDialog.value) {
				uiStore.openPaymentDialog();
				uiStore.setActiveView("items");
				return;
			}
			uiStore.setActiveView("payment");
		};
		const triggerInvoicePay = () => {
			if (!vertical.canSell) {
				window.frappe?.msgprint?.(
					__("This register configuration is invalid. Ask a manager to repair its capability profile."),
				);
				return;
			}
			// The invoice panel owns the pre-payment validation; it is
			// always mounted (v-show, not v-if), so the event always lands.
			// It also owns the in-flight latch (show_payment), so a repeat
			// tap that beats the busy repaint is dropped there, not here.
			eventBus.emit("request_invoice_payment");
		};
		const paymentPending = computed(() => uiStore.paymentRequestPending);
		const isSelectorViewActive = (view) => compactPanel.value === "selector" && activeView.value === view;
		// Dock tabs render from the capability profile's dock_tabs list —
		// the shell owns HOW each id is drawn, the profile owns WHICH ids
		// appear and in what order (plan M2). Unknown ids are dropped.
		// The defs themselves live in viewContracts.ts so the map is bound to
		// DockTabId at compile time; this script block is plain JS and cannot
		// carry that annotation itself.
		// ── Riel y Cajón ────────────────────────────────────────────────
		// The shell owns "where am I" and hands every surface the same answer.
		const router = useRouter();
		const { isOnline } = useOnlineStatus();
		const verticalT = (key) => vertical.t(key);
		const shiftOpen = computed(() => Boolean(shift.pos_opening_shift?.value));

		// The rail draws only where it IS the navigation. Below the two-column
		// boundary the dock is the nav, and drawing both would be two answers
		// to one question.
		const railVisible = computed(() => !useCompactPosSwitcher.value);
		// Published to the store so the navbar can drop its hamburger while the
		// rail is the nav, and pick it back up the moment the shell unmounts.
		watch(railVisible, (visible) => uiStore.setRailLayout(visible), { immediate: true });
		onBeforeUnmount(() => uiStore.setRailLayout(false));

		// Borradores still has no read model: `resolveBadge` renders nothing for
		// 0, so the rail shows no badge rather than a wrong one, and inventing a
		// shell-level poll for it would be new traffic on the hottest path in
		// the product.
		const draftInvoicesCount = ref(0);

		// Órdenes de servicio does. One probe per session, cached in the
		// service and shared with the surface, exactly as the dashboard access
		// probe is shared by the router guard, the navbar and the view. It is
		// asked ONLY where the destination exists — a register with no taller
		// seam has no Orden rail item to badge, and probing anyway would put a
		// guaranteed 403 on every retail register's boot.
		const serviceOrderOpenCount = ref(0);
		const refreshServiceOrderCount = () => {
			const profile = posProfile.value?.name;
			if (!profile || !vertical.externalDocumentCheckout) {
				serviceOrderOpenCount.value = 0;
				return;
			}
			getServiceOrderCountsCached(profile)
				.then((counts) => {
					serviceOrderOpenCount.value = Number(counts?.ready) || 0;
				})
				.catch(() => {
					// Offline, or the profile does not really have the gate. No
					// badge is the honest answer; a stale one would send a
					// cashier to an empty queue.
					serviceOrderOpenCount.value = 0;
				});
		};

		// Supervisor access for the dashboard: the cashier flag answers at once,
		// the server probe (the same one the dashboard route asks) corrects it.
		// Rail gates are ABSENT-not-disabled (R3), so a plain cashier never sees
		// Tablero at all.
		const employeeStore = useEmployeeStore();
		const dashboardProbeAllowed = ref(null);
		const supervisorAccess = computed(() =>
			dashboardProbeAllowed.value !== null
				? dashboardProbeAllowed.value
				: Boolean(employeeStore.currentCashier?.is_supervisor),
		);
		getDashboardAccessCached()
			.then((result) => {
				dashboardProbeAllowed.value = Boolean(result?.allowed);
			})
			.catch(() => {
				// Probe unreachable (offline): the cashier flag stands.
			});

		// The badge follows the two things that can change what it means: which
		// register this is, and whether that register still has the taller seam.
		watch(
			() => [posProfile.value?.name, vertical.externalDocumentCheckout],
			() => {
				invalidateServiceOrderCounts();
				refreshServiceOrderCount();
			},
			{ immediate: true },
		);

		const railGates = computed(() => ({
			floor: floorEnabled.value,
			externalDocumentCheckout: Boolean(vertical.externalDocumentCheckout),
			saldo: showSaldoCatalogPicker.value,
			// A profile that hides the closing shift genuinely cannot close from
			// here; the rail must not offer a door that is bricked up.
			closingShift: !parseBooleanSetting(posProfile.value?.posa_hide_closing_shift),
			giftCards: parseBooleanSetting(posProfile.value?.posa_use_gift_cards),
			dashboard: supervisorAccess.value,
		}));

		// A hosted flow (Borradores, Facturas, Devolución, Orden, Recarga) or a
		// refusal screen occupying the content area. Null means the sale is up.
		const hostedDestinationId = ref(null);
		const destinationRefusal = ref(null);

		const destinationRouting = useDestinationRouting(
			() => ({
				isOnline: isOnline.value,
				shiftOpen: shiftOpen.value,
				hasCapability: (capability) => vertical.has(capability),
				hasProfileFlag: (flag) => Boolean(posProfile.value?.[flag]),
				isSupervisor: supervisorAccess.value,
			}),
			{
				setPanelView: (view) => applySelectorView(view),
				openSheet: (id) => {
					destinationRefusal.value = null;
					hostedDestinationId.value = id;
				},
				closeSheet: () => {
					destinationRefusal.value = null;
					hostedDestinationId.value = null;
				},
				navigate: (path) => {
					router.push(path).catch(() => {});
				},
				// A refusal is a SURFACE, not a toast: the cashier who deep-linked
				// into Devolución on a dead network needs the reason to still be
				// there when they look up from the router.
				refuse: (decision) => {
					destinationRefusal.value = decision.reason;
					hostedDestinationId.value = decision.destination?.id ?? null;
				},
			},
		);

		const dismissDestination = () => destinationRouting.dismiss();

		// Borradores and Facturas are both InvoiceManagement, hosted. While
		// either is up, the floating copy behind `uiStore.invoiceManagementDialog`
		// must stay down — the hosted instance raises that same flag.
		const invoiceManagementHosted = computed(() =>
			["drafts", "invoices"].includes(hostedDestinationId.value),
		);

		// Cobro is hosted beside the rail rather than raised over it (build
		// plan §14.2). One condition, used by the surface, by the sale it
		// covers and by the band: `paymentDialogOpen` is still the flag the
		// whole register raises to ask for the payment screen — only WHERE it
		// lands changed, and only on the layout that has a rail to land beside.
		const cobroHosted = computed(() => railVisible.value && paymentDialogOpen.value);

		// A hosted surface may publish its own band state (DestinationHost
		// relays `band`; CobroSurface emits it directly). The shell adopts it
		// ONLY for kinds it can act on: `recharge` (`recharge.submit` → bus →
		// RecargasDestination), `balanceDue` (`order.collectAndDeliver` → bus →
		// OrdenSurface) and Cobro's `change`/`shortfall`, whose
		// `sale.collectAndClose` is answered below. The corte also publishes
		// one and keeps its own Submit; adopting it here without an action
		// behind `shift.close` would show a button that does nothing.
		const hostedBandState = ref(null);
		const HOSTED_BAND_KINDS = ["recharge", "balanceDue", "change", "shortfall"];
		const onHostedBand = (state) => {
			hostedBandState.value =
				state && HOSTED_BAND_KINDS.includes(state.kind) ? state : null;
		};
		watch(hostedDestinationId, () => {
			hostedBandState.value = null;
		});
		// The tender band belongs to the surface that published it. Left
		// standing after Cobro closes it would put `COBRAR Y CERRAR` under a
		// cart nobody is paying for.
		watch(cobroHosted, () => {
			hostedBandState.value = null;
		});

		/**
		 * The legacy open triggers — `uiStore.openDrafts` after Alt+L,
		 * `uiStore.openInvoiceManagement` from the navbar and from Drafts'
		 * own redirect — raise a FLOATING modal. With the rail on screen those
		 * sheets are destinations, so the trigger is turned into the rail
		 * activation it means and the flag is lowered before the floating
		 * copy can mount. Below the two-column boundary nothing changes.
		 *
		 * Not a loop: the hosted InvoiceManagement raises the same flag on
		 * mount, and by then `invoiceManagementHosted` is already true.
		 */
		const legacyDialogRedirect = (id) => {
			if (!railVisible.value) {
				return false;
			}
			destinationRouting.activate(id, "shortcut");
			return true;
		};
		watch(
			() => uiStore.draftsDialog,
			(open) => {
				if (open && railVisible.value) {
					uiStore.closeDrafts();
					legacyDialogRedirect("drafts");
				}
			},
		);
		watch(
			() => uiStore.invoiceManagementDialog,
			(open) => {
				if (!open || !railVisible.value || invoiceManagementHosted.value) {
					return;
				}
				// Read before closing: `closeInvoiceManagement` resets the tab.
				const target = uiStore.invoiceManagementTargetTab === "drafts" ? "drafts" : "invoices";
				uiStore.closeInvoiceManagement();
				legacyDialogRedirect(target);
			},
		);

		const railContext = {
			__,
			t: verticalT,
			gates: railGates,
			activeDestinationId: destinationRouting.activeId,
			shiftOpen,
			offline: computed(() => !isOnline.value),
			// Same question the navbar menu asks of the same flag, so the two
			// menus cannot offer different printer entries on one register.
			silentPrint: computed(() => parseBooleanSetting(posProfile.value?.posa_silent_print)),
			counts: { serviceOrderOpenCount, floorOpenOrdersCount, draftInvoicesCount },
			navigate: (id) => {
				destinationRouting.activate(id, "rail");
			},
		};

		/**
		 * The rail's «Más» flyout offers the navbar actions menu's settings
		 * entries. It cannot open them — the dialogs and the gating that decides
		 * they exist live in `NavbarMenu.vue`, a different tree — so it NAMES one
		 * and that menu runs its own handler for it. One copy of each dialog, one
		 * place the gates live, two ways in.
		 */
		const openRegisterSetting = (id) => {
			eventBus.emit("run_menu_action", { id });
		};

		// Combos are not fetched yet — the read model lands with the doctype.
		// An empty list means the drawer draws no chip row and the strip does not
		// render at all, which is the honest state rather than a stub offer.
		const comboOffers = ref([]);
		const catalogCategories = computed(() => {
			const category = buildCombosCategory(comboOffers.value);
			return category ? [category] : [];
		});
		const comboSuggestions = computed(() =>
			buildSuggestions(comboOffers.value, invoiceDoc.value?.items || []),
		);
		const addComboSuggestion = (suggestion) => {
			eventBus.emit("add_item", { item_code: suggestion.item_code });
		};

		/**
		 * What the slotted selector is drawing, published by `ItemsSelector`.
		 *
		 * The drawer's anchored WIDTH follows it — a card menu needs columns, a
		 * list does not — and this is the only way the shell learns it without
		 * reaching into the preference the items toolbar owns. Seeded to `list`
		 * so the first frame is the narrow drawer rather than a wide one that
		 * snaps back.
		 */
		const catalogItemsView = ref("list");

		const catalogDrawer = useCatalogDrawer({
			registerId: computed(() => posProfile.value?.name || ""),
			viewportWidth: responsive.windowWidth,
			categories: catalogCategories,
			compact: useCompactPosSwitcher,
		});
		// While the drawer is showing it HOLDS the catalogue; the selector column
		// gives it up rather than rendering a second copy. Exactly one
		// ItemsSelector exists at any moment — see the template comment for why
		// that is a scanning requirement, not a tidiness one.
		// The catalogue now has exactly ONE home — the drawer's persistent slot —
		// so the cart owns the whole row and only gives width back while an
		// anchored drawer is actually open. That is the density argument for
		// direction E: closed, the ticket is full width with just the teleported
		// scan bar above it.
		const drawerAnchoredOpen = computed(
			() => catalogDrawer.isOpen.value && catalogDrawer.presentation.value === "anchored",
		);

		// Browse IS the drawer. Any request to show the catalogue opens it and
		// any move away closes it, so the rail, the dock and the chord cannot
		// disagree about whether the grid is up.
		const applySelectorView = (view, reason = "rail") => {
			if (view === "items") {
				catalogDrawer.open(reason);
			} else if (catalogDrawer.isOpen.value) {
				catalogDrawer.close();
			}
			setSelectorView(view);
		};

		/**
		 * Compact: the catalogue IS the selector panel, so its state FOLLOWS the
		 * panel instead of being toggled beside it.
		 *
		 * The register boots on `selector` + `items` and the only ItemsSelector
		 * lives in the drawer, so a drawer that boots closed left the compact
		 * shell with every column hidden — a blank screen, which is what Marco
		 * reported. Deriving it here rather than opening once at boot also keeps
		 * the two honest afterwards: every path that moves the panel (the dock,
		 * the bus, the floor's "add products", a returning cashier) lands on the
		 * grid without each one having to remember to open the drawer.
		 *
		 * `items` and not merely `selector`: Ofertas, Cupones, Salón and the
		 * inline payment panel are the OTHER selector-panel views, and each has
		 * a column of its own. Opening the catalogue over them would draw two.
		 */
		watch(
			[() => catalogDrawer.presentation.value, compactPanel, activeView],
			([presentation, panel, view]) => {
				if (presentation !== "inline") {
					return;
				}
				const catalogueIsThePanel = panel === "selector" && view === "items";
				if (catalogueIsThePanel && !catalogDrawer.isOpen.value) {
					// A landing, not a resume: `empty-cart` starts on the featured
					// category rather than wherever this register was last.
					catalogDrawer.open("empty-cart");
				} else if (!catalogueIsThePanel && catalogDrawer.isOpen.value) {
					catalogDrawer.close();
				}
			},
			{ immediate: true },
		);

		/**
		 * Closing the catalogue has to LAND somewhere. Anchored and overlay both
		 * close onto a cart that was already beside or behind them; inline is
		 * the panel itself, so closing it without moving the compact shell would
		 * leave the register showing nothing — the same blank the watcher above
		 * exists to prevent. The ticket is the only other panel, so × goes there
		 * and the watcher closes the drawer on the way.
		 */
		const closeCatalogDrawer = () => {
			if (catalogDrawer.presentation.value === "inline") {
				showInvoicePanel();
				return;
			}
			catalogDrawer.close();
		};

		/**
		 * The drawer has settled visible.
		 *
		 * A virtualised grid measures ZERO height while its layer is
		 * `display: none`, so it can come back with no rows until something tells
		 * it to re-measure. `useItemSelectorLayout` listens on two channels: a
		 * ResizeObserver on the container, which usually catches this on its own,
		 * and a debounced window `resize`. Nudging the second one is cheap
		 * insurance on a deliberate user action, and it beats a guessed
		 * `setTimeout` — this is the moment, named by the drawer itself.
		 *
		 * `scheduleCardMetricsUpdate` is not on ItemsSelector's exposed API, so a
		 * template ref cannot reach it from here without editing a file this task
		 * does not own.
		 */
		const onDrawerOpened = () => {
			window.dispatchEvent(new Event("resize"));
		};

		// One number, one action. `sale` is the only input the shell can answer
		// today; tender, refund, recharge and closing arrive with the surfaces
		// that own those numbers.
		const bandState = computed(
			() =>
				hostedBandState.value ??
				resolveBandState({
					kind: "sale",
					total: invoiceTotal.value,
					itemCount: itemsCount.value,
				}),
		);
		const onBandPrimary = (actionId) => {
			if (actionId === "sale.pay") {
				triggerInvoicePay();
				return;
			}
			if (actionId === "sale.collectAndClose") {
				// The SAME submit the payment screen's own button calls.
				// `queue_submit_payment_shortcut` is the bus event the payment
				// chord already uses: Payments.vue answers it with
				// `submit(null, false, print)`, behind its own in-flight and
				// visibility guards. Reaching into the component for a second
				// entry point would have put a new call site on the money path
				// in exchange for a layout.
				eventBus.emit("queue_submit_payment_shortcut", { print: false });
				return;
			}
			if (actionId === "recharge.submit") {
				// The destination owns the intent; the press travels down.
				eventBus.emit("recharge:submit");
				return;
			}
			if (actionId === "order.collectAndDeliver") {
				// Same shape as the recharge press: the surface holds the
				// selected order and owns the call, so the shell sends the
				// intent rather than reaching into it for a second entry point
				// onto the money path.
				eventBus.emit("orden:collect");
			}
		};

		// Offline queue figures are not published to the shell yet; 0 and an
		// empty label render the overlay's copy without inventing a number.
		const queuedInvoiceCount = ref(0);
		const queuedAmountLabel = ref("");

		// `serviceOrder` is a DESTINATION, not a selector panel: it is a hosted
		// sheet in the destination registry, and `PosActiveView` (uiStore) does
		// not contain it. So the dock gets a shimmed pair — the tab asks the same
		// two questions every other tab asks, and for this one id they are
		// answered by the destination router instead of by `activeView`. That
		// keeps the rail and the dock on ONE piece of state, which is the whole
		// point of §17.7's routing change, without widening a store union from a
		// file this task does not own.
		const SERVICE_ORDER_VIEW = "serviceOrder";
		const dockActiveView = computed(() =>
			hostedDestinationId.value === SERVICE_ORDER_VIEW ? SERVICE_ORDER_VIEW : activeView.value,
		);
		const dockSetSelectorView = (view) => {
			if (view === SERVICE_ORDER_VIEW) {
				destinationRouting.activate(SERVICE_ORDER_VIEW, "rail");
				return;
			}
			applySelectorView(view);
		};
		const dockIsSelectorViewActive = (view) => {
			if (view === SERVICE_ORDER_VIEW) {
				return hostedDestinationId.value === SERVICE_ORDER_VIEW;
			}
			// Browse no longer has a column to be "on"; the drawer being up IS
			// the state, so the tab must read the drawer or it lights the wrong
			// thing on every preset.
			if (view === "items") {
				return catalogDrawer.isOpen.value;
			}
			return isSelectorViewActive(view);
		};

		// One event carrying a destination id, rather than one event per
		// destination: the rail, the router and the chord all name the same
		// thing, so a tenth destination costs a registry entry and nothing else.
		const handleOpenDestination = (id) => {
			destinationRouting.activate(String(id ?? ""), "shortcut");
		};
		const handleToggleCatalogDrawer = () => {
			// Inline the catalogue IS a panel, so "toggle it" means swapping
			// panels. Closing it where it stands would leave the compact shell
			// with nothing drawn — the same hole `closeCatalogDrawer` closes for
			// the × and the landing rule closes at boot.
			if (catalogDrawer.presentation.value === "inline") {
				if (catalogDrawer.isOpen.value) {
					showInvoicePanel();
				} else {
					applySelectorView("items", "shortcut");
				}
				return;
			}
			catalogDrawer.toggle("shortcut");
		};

		/**
		 * Typing opens the drawer on the matches (`resolveSearchDrawerIntent`).
		 * Debounced: a barcode wedge types ten characters and Enter inside
		 * ~100ms, and the field is empty again before the timer fires, so a scan
		 * never flashes the drawer open and shut. A person typing "Anillo" is
		 * well past the delay by the second letter.
		 */
		let searchDrawerTimer = null;
		const handleItemSearchChanged = (term) => {
			if (searchDrawerTimer !== null) {
				clearTimeout(searchDrawerTimer);
			}
			searchDrawerTimer = setTimeout(() => {
				searchDrawerTimer = null;
				const intent = resolveSearchDrawerIntent({
					term: String(term ?? ""),
					isOpen: catalogDrawer.isOpen.value,
					presentation: catalogDrawer.presentation.value,
					openReason: catalogDrawer.openReason.value,
				});
				if (intent === "open") {
					catalogDrawer.open("search");
				} else if (intent === "close") {
					catalogDrawer.close();
				}
			}, SEARCH_DRAWER_DEBOUNCE_MS);
		};

		const DOCK_TAB_DEFS = buildDockTabDefs({
			__,
			t: vertical.t,
			offersCount,
			couponsCount,
			itemsCount,
			floorOpenOrdersCount,
			serviceOrderOpenCount,
			activeView: dockActiveView,
			compactPanel,
			paymentPending,
			isSelectorViewActive: dockIsSelectorViewActive,
			setSelectorView: dockSetSelectorView,
			showInvoicePanel,
			triggerInvoicePay,
		});
		const dockTabs = computed(() =>
			vertical.layout.dock_tabs
				.map((id) => {
					// A backend-allowed dock tab id the frontend build has no def
					// for is dropped below (graceful in prod); shout in dev so the
					// backend↔frontend drift surfaces instead of a silent blank tab.
					if (import.meta.env.DEV && !DOCK_TAB_DEFS[id]) {
						console.warn(`[dock] preset dock tab "${id}" has no DOCK_TAB_DEFS entry — dropped`);
					}
					return { id, ...DOCK_TAB_DEFS[id] };
				})
				.filter((tab) => tab.icon),
		);
		// The grid is `repeat(var(--dock-tab-count), …)`, and repeat(0, …) is
		// invalid at computed-value time — it would collapse the whole track
		// list rather than render nothing. A preset that drops every tab
		// should leave the dock empty, not broken.
		const dockTabCount = computed(() => Math.max(1, dockTabs.value.length));
		const getFallbackBottomSpace = () => {
			const rawValue = responsive.responsiveStyles.value["--bottom-safe-space"];
			const parsed = Number.parseFloat(String(rawValue || "0"));
			return Number.isFinite(parsed) ? parsed : 24;
		};
		// Published on the document root so overlays that Vuetify teleports out
		// of this subtree (the Navbar snackbar) can still clear the dock.
		const publishDockHeight = (height) => {
			document.documentElement?.style?.setProperty("--pos-dock-height", `${height}px`);
		};
		const updateBottomDockHeight = () => {
			const dockElement = mobileDock.value;
			if (!showBottomDock.value || !dockElement) {
				bottomDockHeight.value = 0;
				publishDockHeight(0);
				return;
			}
			bottomDockHeight.value = dockElement.offsetHeight + 10;
			publishDockHeight(bottomDockHeight.value);
		};
		const layoutStyleOverrides = computed(() => {
			const fallbackBottomSpace = getFallbackBottomSpace();
			const effectiveBottomSpace = showBottomDock.value
				? Math.max(bottomDockHeight.value, fallbackBottomSpace)
				: fallbackBottomSpace;
			return {
				"--bottom-safe-space": `${effectiveBottomSpace}px`,
			};
		});
		const handleAdditionalDiscountUpdate = (value) => {
			invoiceStore.setAdditionalDiscount(normalizeAdditionalDiscountInput(value));
		};
		const handleAdditionalDiscountFocus = () => {
			isEditingAdditionalDiscount.value = true;
		};
		const handleAdditionalDiscountBlur = () => {
			isEditingAdditionalDiscount.value = false;
		};
		const handleAdditionalDiscountPercentageUpdate = (value) => {
			invoiceStore.setAdditionalDiscountPercentage(value);
		};
		const handleAdditionalDiscountPercentageFocus = () => {
			isEditingAdditionalDiscountPercentage.value = true;
		};
		const commitAdditionalDiscountPercentage = () => {
			eventBus.emit("recalc_additional_discount");
		};
		const handleAdditionalDiscountPercentageBlur = () => {
			isEditingAdditionalDiscountPercentage.value = false;
			commitAdditionalDiscountPercentage();
		};
		const dockDiscountOpen = ref(false);
		const dockDiscountApplied = computed(() => {
			const value = posProfile.value?.posa_use_percentage_discount
				? Number(additionalDiscountPercentage.value)
				: Number(additionalDiscount.value);
			return Number.isFinite(value) && value !== 0;
		});
		const dockDiscountLabel = computed(() => {
			if (posProfile.value?.posa_use_percentage_discount) {
				return `${Math.abs(Number(additionalDiscountPercentage.value))}%`;
			}
			const symbol = getCurrencySymbol(posProfile.value?.currency) || "";
			return `${symbol}${Math.abs(Number(additionalDiscount.value)).toFixed(2)}`;
		});
		// Show the toggle when the operator may edit the discount, or when
		// one is applied and must stay visible (even if read-only).
		const showDockDiscountToggle = computed(
			() =>
				(posProfile.value?.posa_allow_user_to_edit_additional_discount &&
					!discountPercentageOfferName.value) ||
				dockDiscountApplied.value,
		);
		const toggleDockDiscount = () => {
			dockDiscountOpen.value = !dockDiscountOpen.value;
			if (dockDiscountOpen.value) {
				nextTick(() => {
					const field = additionalDiscountField.value;
					field?.focus?.();
					field?.$el?.querySelector?.("input")?.focus?.();
				});
			}
		};
		const focusAdditionalDiscountField = () => {
			// Bus consumers (keyboard shortcut) expect the field visible — but
			// the collapse control is v-if'd on this same condition, so opening
			// the row without it strands a disabled field the operator has no
			// way to close.
			if (!showDockDiscountToggle.value) {
				return;
			}
			dockDiscountOpen.value = true;
			nextTick(() => {
				const field = additionalDiscountField.value;
				field?.focus?.();
				field?.$el?.querySelector?.("input")?.focus?.();
			});
		};
		const handleOpenReturns = (company) => {
			// Alt+8 and the invoice's "return" action both say `open_returns`;
			// with the rail on screen that means the Devolución destination,
			// which opens itself on the POS Profile's company.
			if (legacyDialogRedirect("return")) {
				return;
			}
			returnsMounted.value = true;
			returnsOpenRequest.value = {
				company,
				token: Date.now(),
			};
		};
		const handleOpenNewAddress = (customer) => {
			newAddressMounted.value = true;
			newAddressOpenRequest.value = {
				customer,
				token: Date.now(),
			};
		};
		const handleOpenMpesaPayments = (data) => {
			mpesaMounted.value = true;
			mpesaOpenRequest.value = {
				data,
				token: Date.now(),
			};
		};
		const handlePosKeyboardNavigation = (event) => {
			const root = resolveKeyboardNavigationRoot(posRoot.value);
			moveFocusByArrow(event, { root });
		};
		// Upstream bf150918 replaced arrow-nav with an UNCONDITIONAL Tab
		// hijack (any Tab anywhere → item search). We keep both, gated:
		// native Tab survives inside editable fields and open overlays
		// (payment dialog, saldo dialogs), everywhere else Tab jumps to
		// the search box — the cashier's home position.
		const handlePosTabFocus = (event) => {
			if (
				event.key !== "Tab" ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey
			) {
				return;
			}
			if (isEditableElement(document.activeElement)) {
				return;
			}
			const hasVisibleOverlay = Array.from(
				document.querySelectorAll(".v-overlay__content"),
			).some((el) => isElementVisible(el));
			if (hasVisibleOverlay) {
				return;
			}
			event.preventDefault();
			focusItemSearchField();
		};

		useCustomerDisplayPublisher({
			posProfile,
			eventBus,
		});

		// Pre-warm QZ Tray connection as soon as a POS Profile with silent_print is loaded.
		// Keeps the websocket open so the first print doesn't pay the connect/cert/signing round-trip cost.
		const stopQzPrewarm = watch(
			posProfile,
			(profile) => {
				if (profile && profile.posa_silent_print) {
					connectQzTray().catch(() => undefined);
				}
			},
			{ immediate: true },
		);

		onMounted(() => {
			document.addEventListener("keydown", handlePosKeyboardNavigation);
			document.addEventListener("keydown", handlePosTabFocus, true);
			if (typeof window !== "undefined" && "ResizeObserver" in window) {
				mobileDockObserver = new ResizeObserver(() => {
					updateBottomDockHeight();
				});
			}
			if (eventBus) {
				eventBus.on("submit_closing_pos", handleSubmitClosingPos);
				// F7 — shift overview / closing dialog. The listener was lost
				// in an old refactor and F7 emitted into the void.
				eventBus.on("open_shift_details", handleOpenShiftDetails);
				eventBus.on("focus_additional_discount", focusAdditionalDiscountField);
				eventBus.on("set_compact_panel", setCompactPanel);
				// Payments.vue's Cancel asks for the cart here rather than
				// setting the panel itself: only the shell can move the panel
				// and the active view in the one pass that survives the
				// activeView watcher. mitt dispatches inline, so the caller's
				// synchronous fallback sees this as already handled.
				eventBus.on("show_invoice_panel", showInvoicePanel);
				// The floor's ticket panel asks for Browse by name: "Agregar
				// productos" has to land on the item list with the panel moved,
				// which set_compact_panel alone cannot do from the floor view.
				eventBus.on("set_selector_view", setSelectorView);
				eventBus.on("open_destination", handleOpenDestination);
				eventBus.on("toggle_catalog_drawer", handleToggleCatalogDrawer);
				eventBus.on("item_search_changed", handleItemSearchChanged);
				eventBus.on("open_returns", handleOpenReturns);
				eventBus.on("open_new_address", handleOpenNewAddress);
				eventBus.on("open_mpesa_payments", handleOpenMpesaPayments);
				eventBus.on("show_change_due", handleShowChangeDue);
				eventBus.on("floor_order_opened", handleFloorOrderOpened);
			}
			nextTick(() => {
				updateBottomDockHeight();
				if (mobileDockObserver && mobileDock.value) {
					mobileDockObserver.observe(mobileDock.value);
				}
			});
			// /floor mounts this same shell and asks for the floor panel. The
			// capability is re-checked here because the route guard runs before
			// the register has resolved its preset.
			if (route?.meta?.initialView === "floor" && floorEnabled.value) {
				setSelectorView("floor");
			}
		});

		onBeforeUnmount(() => {
			document.removeEventListener("keydown", handlePosKeyboardNavigation);
			document.removeEventListener("keydown", handlePosTabFocus, true);
			publishDockHeight(0);
			if (mobileDockObserver) {
				mobileDockObserver.disconnect();
				mobileDockObserver = null;
			}
			if (eventBus) {
				// Always pass the handler: a bare off("submit_closing_pos")
				// removes EVERY listener for the event, including ones other
				// components registered.
				eventBus.off("submit_closing_pos", handleSubmitClosingPos);
				eventBus.off("open_shift_details", handleOpenShiftDetails);
				eventBus.off("focus_additional_discount", focusAdditionalDiscountField);
				eventBus.off("set_compact_panel", setCompactPanel);
				eventBus.off("show_invoice_panel", showInvoicePanel);
				eventBus.off("set_selector_view", setSelectorView);
				eventBus.off("open_destination", handleOpenDestination);
				eventBus.off("toggle_catalog_drawer", handleToggleCatalogDrawer);
				eventBus.off("item_search_changed", handleItemSearchChanged);
				if (searchDrawerTimer !== null) {
					clearTimeout(searchDrawerTimer);
				}
				eventBus.off("open_returns", handleOpenReturns);
				eventBus.off("open_new_address", handleOpenNewAddress);
				eventBus.off("open_mpesa_payments", handleOpenMpesaPayments);
				eventBus.off("show_change_due", handleShowChangeDue);
				eventBus.off("floor_order_opened", handleFloorOrderOpened);
			}
			stopQzPrewarm();
		});

		watch(usePaymentDialog, (enabled) => {
			if (enabled && activeView.value === "payment") {
				uiStore.openPaymentDialog();
				uiStore.setActiveView("items");
				return;
			}

			if (!enabled && paymentDialogOpen.value) {
				uiStore.closePaymentDialog();
				uiStore.setActiveView("payment");
			}
		});

		watch(activeView, (view) => {
			if (!useCompactPosSwitcher.value) {
				return;
			}

			// Deliberately narrow: a caller that has already chosen the panel
			// opts out for this one change. Testing `compactPanel === "invoice"`
			// instead would look equivalent and is not — it would also swallow
			// the legitimate selector reveals that type-to-search, the Alt
			// shortcuts, and the offers/coupons panels rely on.
			if (suppressNextPanelSync.value) {
				suppressNextPanelSync.value = false;
				return;
			}

			if (["items", "offers", "coupons", "payment", "floor"].includes(view)) {
				compactPanel.value = "selector";
			}
		});

		// A preset can lose the `tables` capability under a live register (a
		// profile swap at shift open). Leaving the shell on a floor it no longer
		// mounts would show an empty column with no way back.
		watch(floorEnabled, (enabled) => {
			if (!enabled && activeView.value === "floor") {
				uiStore.setActiveView("items");
			}
		});

		watch(useCompactPosSwitcher, (enabled) => {
			if (!enabled) {
				compactPanel.value = "selector";
				return;
			}

			if (["offers", "coupons", "payment", "floor"].includes(activeView.value)) {
				compactPanel.value = "selector";
			}
		});

		watch(
			[showBottomDock, () => responsive.windowWidth.value, () => responsive.windowHeight.value],
			() => {
				nextTick(() => {
					if (mobileDockObserver) {
						mobileDockObserver.disconnect();
						if (showBottomDock.value && mobileDock.value) {
							mobileDockObserver.observe(mobileDock.value);
						}
					}
					updateBottomDockHeight();
				});
			},
			{ immediate: true },
		);

		return {
			...responsive,
			...rtl,
			...shift,
			...offers,
			// SALDO-INTEGRATION-POINT
			saldoPickerOpen,
			showSaldoCatalogPicker,
			openSaldoPicker,
			onSaldoPicked,
			uiStore,
			invoiceStore,
			itemsStore,
			__,
			invoiceDoc,
			itemsCount,
			totalQty,
			formattedCartTotal,
			formattedDiscountTotal,
			cartMetaLabel,
			dockCustomerLabel,
			offersCount,
			couponsCount,
			posProfile,
			additionalDiscountField,
			additionalDiscountDisplay,
			additionalDiscountPercentageDisplay,
			dockDiscountOpen,
			dockDiscountApplied,
			dockDiscountLabel,
			showDockDiscountToggle,
			toggleDockDiscount,
			ItemsView,
			CartView,
			floorEnabled,
			// Riel y Cajón
			railVisible,
			cobroHosted,
			railContext,
			openRegisterSetting,
			catalogDrawer,
			catalogItemsView,
			drawerAnchoredOpen,
			onDrawerOpened,
			closeCatalogDrawer,
			applySelectorView,
			catalogCategories,
			comboSuggestions,
			addComboSuggestion,
			bandState,
			onBandPrimary,
			onHostedBand,
			hostedDestinationId,
			invoiceManagementHosted,
			destinationRefusal,
			dismissDestination,
			verticalT,
			isOnline,
			isDockTabDimmedOffline,
			queuedInvoiceCount,
			queuedAmountLabel,
			bottomDockHeight,
			dockTabs,
			dockTabCount,
			activeView,
			paymentDialogOpen,
			isPhone,
			usePaymentDialog,
			useCompactPosSwitcher,
			showBottomDock,
			layoutStyleOverrides,
			compactPanel,
			mobileDock,
			setCompactPanel,
			setSelectorView,
			showInvoicePanel,
			showPaymentPanel,
			jumpToCustomer,
			triggerInvoicePay,
			isSelectorViewActive,
			handleAdditionalDiscountUpdate,
			handleAdditionalDiscountFocus,
			handleAdditionalDiscountBlur,
			handleAdditionalDiscountPercentageUpdate,
			handleAdditionalDiscountPercentageFocus,
			handleAdditionalDiscountPercentageBlur,
			commitAdditionalDiscountPercentage,
			handlePaymentDialogUpdate,
			handlePaymentDialogAfterLeave,
			changeDueOpen,
			changeDueAmount,
			changeDueSymbol,
			formatChangeAmount,
			onChangeDueConfirmed,
			discountPercentageOfferName,
			getCurrencySymbol,
			posRoot,
			eventBus,
			dialog,
			returnsMounted,
			returnsOpenRequest,
			newAddressMounted,
			newAddressOpenRequest,
			mpesaMounted,
			mpesaOpenRequest,
		};
	},
	components: {
		// Riel y Cajón
		RegisterRail,
		CatalogDrawer,
		ActionBand,
		DestinationHost,
		CobroSurface,
		MobileOfflineOverlay,
		ComboSuggestionStrip,
		OpeningDialog,
		ShortcutsCheatSheet,
		PriceCheckDialog,
		Payments,
		FloorView,
		ChangeDueDialog,
		Drafts,
		InvoiceManagement,

		Returns,
		PosOffers,
		PosCoupons,
		NewAddress,
		Variants,
		MpesaPayments,
		SalesOrders,
		// SALDO-INTEGRATION-POINT
		SaldoReferenciaDialog,
		SaldoStatusDialog,
		SaldoCatalogPicker,
	},

	// SALDO-INTEGRATION-POINT — data/created/beforeUnmount/methods saldo*
	// blocks below. Keep contained here for easy rebase identification.
	// saldoPickerOpen + openSaldoPicker + onSaldoPicked moved into setup()
	// above — Options-API methods weren't reaching @open-saldo-picker
	// template binding in production build.
	data() {
		return {
			saldoDialogOpen: false,
			saldoDialogMeta: null,
			_saldoResolve: null,
			_saldoReject: null,
		};
	},

	created() {
		this._saldoOpenHandler = ({ meta, resolve, reject }) => {
			this.saldoDialogMeta = meta;
			this.saldoDialogOpen = true;
			this._saldoResolve = resolve;
			this._saldoReject = reject;
		};
		saldoCaptureBus.on("saldo:open", this._saldoOpenHandler);
		// Hold-until-confirm: SaldoHoldsBadge asks us to print the receipt
		// of a held sale that submitted in background after TAECEL confirmed.
		this._saldoHoldPrintHandler = ({ invoice, doctype }) => {
			printInvoiceByName(this.pos_profile, doctype || "Sales Invoice", invoice);
		};
		saldoCaptureBus.on("saldo:hold_print", this._saldoHoldPrintHandler);
		// Clean up expired customer balance cache on POS load (was a separate
		// created() hook before saldo wiring; merged here because Vue Options
		// API silently keeps only the last definition of a duplicate key).
		clearExpiredCustomerBalances();
	},

	beforeUnmount() {
		if (this._saldoOpenHandler) {
			saldoCaptureBus.off("saldo:open", this._saldoOpenHandler);
		}
		if (this._saldoHoldPrintHandler) {
			saldoCaptureBus.off("saldo:hold_print", this._saldoHoldPrintHandler);
		}
	},

	methods: {
		// SALDO-INTEGRATION-POINT
		onSaldoCaptured(result) {
			if (this._saldoResolve) this._saldoResolve(result);
			this._saldoResolve = null;
			this._saldoReject = null;
		},
		onSaldoCancelled() {
			if (this._saldoReject) this._saldoReject(new Error("saldo capture cancelled"));
			this._saldoResolve = null;
			this._saldoReject = null;
		},
		// openSaldoPicker + onSaldoPicked moved to setup() — see SALDO-INTEGRATION-POINT
		// SALDO-INTEGRATION-POINT-END
		create_opening_voucher() {
			this.dialog = true;
		},
		get_pos_setting() {
			frappe.db.get_doc("POS Settings", undefined).then((doc) => {
				this.uiStore.setPosSettings(doc);
			});
		},
		// handleAddItem removed as ItemsSelector handles pos addition internally
		handleRegisterPosData(data) {
			this.pos_profile = data.pos_profile;
			this.get_offers(this.pos_profile.name, this.pos_profile);
			this.pos_opening_shift = data.pos_opening_shift;

			// Update Store
			this.uiStore.setRegisterData(data);
		},
		closeOpeningDialog() {
			this.dialog = false;
		},
	},

	mounted: function () {
		this.$nextTick(function () {
			this.check_opening_entry();
			this.get_pos_setting();

			// Watch store for updates
			this.$watch(
				// Drop deep:true — react to profile reassignment only
				// (handled when shift opens / closes / switches).
				() => this.uiStore.posProfile,
				(newProfile) => {
					if (newProfile && newProfile.name) {
						this.pos_profile = newProfile;
						this.get_offers(newProfile.name, newProfile);
						// Tag telemetry with the active profile once it's known
						// (boot only has buildVersion). Lazy + best-effort so it
						// can never block or break the shell.
						import("../../../utils/telemetry")
							.then((t) => t.updateContext({ posProfile: newProfile.name }))
							.catch(() => {});
					}
				},
				{ immediate: true },
			);
		});
	},
};
</script>

<style scoped>
.payment-dialog :deep(.v-overlay__content) {
	max-height: calc(100dvh - 24px);
}

/* NOTHING here animates, and that is the rule rather than an omission.
 *
 * The compact shell switches panels by flipping `v-show` on siblings, so a
 * dock tap is one repaint — except that this container used to carry
 * `all 0.3s ease` and the columns `padding 0.3s ease`. `all` silently covers
 * the layout properties, so every panel change eased its padding and its
 * safe-space over 300ms while the panel underneath had already swapped: the
 * flicker Marco reported. Browse was worse still, because it also waited on a
 * modal sheet to slide in.
 *
 * One rule for every dock destination: instant. Anything reinstated here has
 * to hold for Cart, Ofertas, Cupones, Salón, Cobro and Browse alike, or the
 * dock has a slow tab again — `compactPanelSwitchInstant.spec.ts` enforces it.
 */
.dynamic-container {
	padding-bottom: calc(var(--bottom-safe-space) + var(--dynamic-xs));
	min-width: 0;
}

.dynamic-main-row {
	padding: 0;
	margin: 0;
}

/* Desktop (>=1100px, the two-column register) is viewport-locked: this view
 * fits `.page-content` exactly, so the PAGE scrollbar never appears and the
 * only scrolling happens inside a panel. Below 1100px nothing here applies —
 * the compact switcher shows one panel at a time and the 769-1099 band still
 * scrolls through `.page-content`, which tests/defaultLayoutMainScroller.spec.ts
 * guards. Deliberately scoped rather than global for that reason. */
@media (min-width: 1100px) {
	.dynamic-container {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dynamic-main-row {
		flex: 1 1 auto;
		min-height: 0;
		flex-wrap: nowrap;
	}

	/* No `height: 100%` here on purpose — these columns carry a top margin, so
	 * an explicit 100% would overflow the row by exactly that margin. The row's
	 * default `align-items: stretch` already gives them full height. */
	.dynamic-col--selector,
	.dynamic-col--invoice {
		min-height: 0;
		overflow: hidden;
	}
}

.dynamic-main-row--phone {
	align-items: stretch;
}

.dynamic-col {
	padding: var(--dynamic-sm);
	margin-top: var(--dynamic-sm);
}

.dynamic-col--selector,
.dynamic-col--invoice {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}

/* ───────────────────────────────────────────────────────────────
 * Mobile action bar (compact < 1100px). SOLID + opaque — no glass,
 * no backdrop blur — so page content never bleeds through it (the
 * old translucent fixed dock did, which read as a render glitch).
 * Slim two-row layout: compact totals + 5-tab panel switcher. The
 * content panel above reserves --bottom-safe-space (measured from
 * this bar) so the last content row always clears it.
 * ─────────────────────────────────────────────────────────────── */
.mobile-dock {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 20;
	display: flex;
	flex-direction: column;
	background: var(--pos-card-bg);
	border-top: 1px solid var(--pos-border);
	border-radius: 16px 16px 0 0;
	box-shadow: 0 -6px 20px var(--pos-shadow);
	padding-bottom: env(safe-area-inset-bottom);
}

.mobile-dock__summary {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 9px 14px;
	border-bottom: 1px solid var(--pos-border);
}

.mobile-dock__totals {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	flex: 1 1 auto;
}

.mobile-dock__amount {
	font-size: 1.15rem;
	font-weight: 700;
	line-height: 1.15;
	color: var(--pos-text-primary);
}

.mobile-dock__subline {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.mobile-dock__meta {
	font-size: 0.72rem;
	color: var(--pos-text-secondary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Customer chip — keeps the active customer visible while the cart panel
 * is off-screen. Lives inside the flexible totals column so it never
 * competes with the discount field for the summary row's fixed slot; the
 * name ellipsizes first, then the line/qty meta gives way. */
.mobile-dock__customer {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	flex: 0 1 auto;
	min-width: 0;
	max-width: 60%;
	min-height: 30px;
	padding: 3px 9px;
	/* Visual chip stays 30px; the tap target reaches 44 via margin-less
	   padding on coarse pointers below. */
	border: 1px solid var(--pos-border);
	border-radius: 999px;
	background: rgba(var(--v-theme-primary), 0.08);
	color: var(--pos-text-primary);
	font: inherit;
	font-size: 0.72rem;
	font-weight: 600;
	line-height: 1.1;
	cursor: pointer;
}

.mobile-dock__customer:active {
	transform: scale(0.97);
}

.mobile-dock__discount-toggle {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	flex: 0 0 auto;
	min-width: 44px;
	min-height: 44px;
	padding: 0 10px;
	border: 1px solid var(--pos-border);
	border-radius: 999px;
	background: transparent;
	color: var(--pos-text-secondary);
	font: inherit;
	font-size: 0.72rem;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
	justify-content: center;
}

.mobile-dock__discount-toggle--active {
	background: rgba(var(--v-theme-warning), 0.16);
	border-color: rgb(var(--v-theme-warning));
	color: var(--pos-text-primary);
}

.mobile-dock__discount-row {
	padding: 8px 14px 2px;
}

@media (pointer: coarse) {
	.mobile-dock__customer {
		min-height: 44px;
		padding-top: 10px;
		padding-bottom: 10px;
	}
}

.mobile-dock__customer-name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mobile-dock__discount-row :deep(.v-field) {
	background: rgba(var(--v-theme-surface), 0.6);
}

.mobile-dock__tabs {
	display: grid;
	grid-template-columns: repeat(var(--dock-tab-count, 5), minmax(0, 1fr));
	gap: 6px;
	padding: 7px 10px 9px;
}

.mobile-dock__tab {
	position: relative;
	border: 0;
	background: transparent;
	border-radius: 12px;
	min-width: 0;
	min-height: 46px;
	padding: 4px 2px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 2px;
	font: inherit;
	font-size: 0.66rem;
	font-weight: 600;
	color: var(--pos-text-secondary);
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease,
		transform 0.1s ease;
}

/* Label spans only — a bare `span` selector also matched the count
   pill, whose absolute box then took width:100% of the tab cell and
   rendered as a 70px blue bar over the icon. */
.mobile-dock__tab-label {
	display: block;
	width: 100%;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align: center;
}

.mobile-dock__tab:active {
	transform: scale(0.96);
}

.mobile-dock__tab--active {
	background: rgba(var(--v-theme-primary), 0.18);
	color: rgb(var(--v-theme-primary));
	/* Colour alone was too faint a signal on the dark card — the inset
	   top rule marks the active tab unmistakably. */
	box-shadow: inset 0 2px 0 rgb(var(--v-theme-primary));
}

.mobile-dock__tab--pay.mobile-dock__tab--active {
	background: rgba(var(--v-theme-success), 0.18);
	color: rgb(var(--v-theme-success));
}

/* Round-trip in flight. Dimmed rather than greyed so the tab still reads
   as itself, and the press-scale is dropped so a repeat tap gives no
   feedback that would suggest it landed. */
.mobile-dock__tab--busy {
	opacity: 0.55;
	cursor: progress;
}

.mobile-dock__tab--busy:active {
	transform: none;
}

.mobile-dock__pill {
	position: absolute;
	top: 3px;
	/* Left-anchored at the icon's top-right corner (icon half-width 11px
	   − 7px overlap): 2-3 digit counts grow outward, never across the
	   glyph or into the next cell. */
	left: calc(50% + 4px);
	right: auto;
	width: auto;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	border-radius: 999px;
	background: rgb(var(--v-theme-primary));
	color: #fff;
	font-size: 0.68rem;
	font-weight: 700;
	line-height: 18px;
	text-align: center;
	/* Ring separates the badge from the icon; never swallows the tap. */
	box-shadow: 0 0 0 2px var(--pos-card-bg);
	pointer-events: none;
}

/* Offers/Coupons tabs carry a 20px icon (Cart's is 22) — pull their badge
 * in so it hugs the glyph instead of drifting toward the next cell. */
.mobile-dock__pill--sm {
	left: calc(50% + 3px);
}

:deep(.v-theme--dark) .mobile-dock,
:deep([data-theme="dark"]) .mobile-dock,
:deep([data-theme-mode="dark"]) .mobile-dock {
	box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.5);
	border-top-color: rgba(255, 255, 255, 0.08);
}

:deep(.v-theme--dark) .mobile-dock__customer,
:deep([data-theme="dark"]) .mobile-dock__customer,
:deep([data-theme-mode="dark"]) .mobile-dock__customer {
	background: rgba(var(--v-theme-primary), 0.18);
	border-color: rgba(255, 255, 255, 0.12);
}

:deep(.v-theme--dark) .mobile-dock__tab--active,
:deep([data-theme="dark"]) .mobile-dock__tab--active,
:deep([data-theme-mode="dark"]) .mobile-dock__tab--active {
	background: rgba(var(--v-theme-primary), 0.22);
}

:deep(.v-theme--dark) .mobile-dock__tab--pay.mobile-dock__tab--active,
:deep([data-theme="dark"]) .mobile-dock__tab--pay.mobile-dock__tab--active,
:deep([data-theme-mode="dark"]) .mobile-dock__tab--pay.mobile-dock__tab--active {
	background: rgba(var(--v-theme-success), 0.24);
}

@media (max-width: 768px) {
	.dynamic-container {
		padding-top: var(--dynamic-xs);
		padding-bottom: calc(var(--bottom-safe-space) + 4px);
	}

	.dynamic-col {
		padding: var(--dynamic-xs);
		margin-top: var(--dynamic-xs);
	}
}

@media (max-width: 360px) {
	.mobile-dock__summary {
		justify-content: space-between;
	}
}

/* Landscape / short viewport: collapse to one slim row — drop the
 * discount field + meta, shrink tabs so content keeps the screen. */
@media (orientation: landscape) and (max-height: 540px) {
	.mobile-dock__summary {
		padding: 3px 12px;
		border-bottom: 0;
	}

	.mobile-dock__discount-row,
	.mobile-dock__meta {
		display: none;
	}

	.mobile-dock__amount {
		font-size: 1rem;
	}

	.mobile-dock__tabs {
		padding: 0 8px 3px;
		gap: 6px;
	}

	.mobile-dock__tab {
		min-height: 36px;
		font-size: 0.6rem;
		flex-direction: row;
		gap: 6px;
	}
}
/* ── Riel y Cajón (roadmap §17.7) ────────────────────────────────────────
 * The shell is a flex ROW: the rail, then everything else. It slots into the
 * height chain `.dynamic-container` already establishes at >=1100px, which is
 * why both halves carry `min-height: 0` — a flex item defaults to
 * `min-height: auto` and refuses to shrink below its content, and that is
 * exactly how a "just add overflow" fix ends up nesting a second scrollport
 * instead of removing one. Same lesson as commit 59c5fe1ad. */
.register-shell {
	display: flex;
	align-items: stretch;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
}

.register-shell__content {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	/* LOAD-BEARING. The catalogue drawer's overlay presentation is
	 * `position: absolute` on purpose, so the action band below it stays
	 * visible — "the drawer never reaches it". With no positioned ancestor the
	 * overlay escapes to the viewport and covers the one number that matters. */
	position: relative;
}

/* The row is the drawer's positioning context.
 *
 * `.catalog-drawer-layer--overlay` is `position: absolute; inset: 0` and
 * deliberately NOT `fixed`, so the action band below stays visible and
 * reachable while the catalogue is up. That is only true if the nearest
 * positioned ancestor is this row rather than the viewport. */
.dynamic-main-row {
	position: relative;
}

/* An anchored drawer is a 400px flex sibling of the cart. The cart column is
 * `cols="12"`, i.e. `flex: 0 0 100%`, which cannot shrink — so without this the
 * row overflows by exactly the drawer's width and the ticket's right edge goes
 * off screen. Closed, the cart keeps the whole row: that is the density win. */
.dynamic-main-row--with-drawer .dynamic-col--invoice {
	flex: 1 1 auto;
	max-width: none;
	min-width: 0;
}

/* A dock tab that needs signal dims; it is never removed. "El dock no miente"
 * — what the cashier's thumb learned stays where it was, it just stops
 * pretending it can work. The amber dot repeats it non-chromatically for
 * anyone who cannot see the dimming. */
.mobile-dock__tab--dimmed {
	opacity: 0.45;
}

.mobile-dock__tab--dimmed::after {
	content: "";
	position: absolute;
	top: 6px;
	right: 10px;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #e9a13b;
}
</style>
