<template>
	<div
		ref="posRoot"
		data-pos-keyboard-root="pos"
		class="pos-main-container dynamic-container"
		:class="[rtlClasses]"
		:style="[responsiveStyles, layoutStyleOverrides, rtlStyles]"
	>
		<Drafts v-if="uiStore.draftsDialog"></Drafts>
		<InvoiceManagement v-if="uiStore.invoiceManagementDialog"></InvoiceManagement>
		<SalesOrders v-if="uiStore.ordersDialog"></SalesOrders>
		<Returns v-if="returnsMounted" :open-request="returnsOpenRequest"></Returns>
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
		<v-dialog
			v-if="usePaymentDialog"
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
		<v-row
			v-show="!dialog"
			dense
			class="ma-0 dynamic-main-row"
			:class="{ 'dynamic-main-row--phone': isPhone }"
		>
			<v-col
				v-show="(!useCompactPosSwitcher || compactPanel === 'selector') && activeView === 'items'"
				:xl="useCompactPosSwitcher ? 12 : 5"
				:lg="useCompactPosSwitcher ? 12 : 5"
				:md="useCompactPosSwitcher ? 12 : 5"
				:sm="useCompactPosSwitcher ? 12 : 5"
				cols="12"
				class="pos dynamic-col dynamic-col--selector"
			>
				<component :is="ItemsView" context="pos" />
			</v-col>
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
				:xl="useCompactPosSwitcher ? 12 : 7"
				:lg="useCompactPosSwitcher ? 12 : 7"
				:md="useCompactPosSwitcher ? 12 : 7"
				:sm="useCompactPosSwitcher ? 12 : 7"
				cols="12"
				class="pos dynamic-col dynamic-col--invoice"
			>
				<component :is="CartView" @open-saldo-picker="openSaldoPicker" />
			</v-col>
		</v-row>
		<div v-if="showBottomDock" ref="mobileDock" class="mobile-dock">
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
					:class="[
						tab.cls,
						{ 'mobile-dock__tab--active': tab.isActive(), 'mobile-dock__tab--busy': tab.busy?.() },
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
import { resolveCartView, resolveItemsView } from "../../../vertical/viewRegistry";
import { buildDockTabDefs } from "../../../vertical/viewContracts";
import OpeningDialog from "../shift/OpeningDialog.vue";
import PosOffers from "../offers/PosOffers.vue";
import PosCoupons from "../offers/PosCoupons.vue";
// SALDO-INTEGRATION-POINT — Vue sources live in the saldo Frappe app
// (see saldo/saldo/public/saldo_pos/). Resolved via Vite alias `@saldo`
// declared in vite.config.js. Upstream rebase: keep these lines.
import SaldoReferenciaDialog from "@saldo/SaldoReferenciaDialog.vue";
import SaldoStatusDialog from "@saldo/SaldoStatusDialog.vue";
import SaldoCatalogPicker from "@saldo/SaldoCatalogPicker.vue";
import { saldoCaptureBus } from "@saldo/useSaldoCapture";
import { printInvoiceByName } from "../../../utils/printInvoiceByName";
import { usePosShift } from "../../../composables/pos/shared/usePosShift";
import { useOffers } from "../../../composables/pos/shared/useOffers";
// Import the cache cleanup function
import { clearExpiredCustomerBalances } from "../../../../offline/index";
import { useResponsive } from "../../../composables/core/useResponsive";
import { connectQzTray } from "../../../services/qzTray";
import { useRtl } from "../../../composables/core/useRtl";
import { useUIStore } from "../../../stores/uiStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useVerticalStore } from "../../../stores/verticalStore";
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
		const DOCK_TAB_DEFS = buildDockTabDefs({
			__,
			offersCount,
			couponsCount,
			itemsCount,
			activeView,
			compactPanel,
			paymentPending,
			isSelectorViewActive,
			setSelectorView,
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
				eventBus.on("open_returns", handleOpenReturns);
				eventBus.on("open_new_address", handleOpenNewAddress);
				eventBus.on("open_mpesa_payments", handleOpenMpesaPayments);
			}
			nextTick(() => {
				updateBottomDockHeight();
				if (mobileDockObserver && mobileDock.value) {
					mobileDockObserver.observe(mobileDock.value);
				}
			});
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
				eventBus.off("open_returns", handleOpenReturns);
				eventBus.off("open_new_address", handleOpenNewAddress);
				eventBus.off("open_mpesa_payments", handleOpenMpesaPayments);
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

			if (["items", "offers", "coupons", "payment"].includes(view)) {
				compactPanel.value = "selector";
			}
		});

		watch(useCompactPosSwitcher, (enabled) => {
			if (!enabled) {
				compactPanel.value = "selector";
				return;
			}

			if (["offers", "coupons", "payment"].includes(activeView.value)) {
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
		OpeningDialog,
		Payments,
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

.dynamic-container {
	transition: all 0.3s ease;
	padding-bottom: calc(var(--bottom-safe-space) + var(--dynamic-xs));
	min-width: 0;
}

.dynamic-main-row {
	padding: 0;
	margin: 0;
}

.dynamic-main-row--phone {
	align-items: stretch;
}

.dynamic-col {
	padding: var(--dynamic-sm);
	transition: padding 0.3s ease;
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
</style>
