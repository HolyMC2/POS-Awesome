/**
 * Central UI state bus for the POS main view.
 *
 * **Loading vs. freeze overlays**
 * Two distinct blocking states exist:
 * - `isLoading` / `loadingText` — non-blocking spinner shown during async work.
 * - `isFrozen` / `freezeTitle` / `freezeMessage` — blocks all user interaction
 *   (e.g. during payment submission). Managed via `freeze()` / `unfreeze()`.
 *
 * **Active view**
 * `activeView` drives the main content panel: `"items"` | `"payment"` |
 * `"offers"` | `"coupons"` | `"floor"`. Updated via `setActiveView()`.
 *
 * **POS session data**
 * `posProfile`, `stockSettings`, `companyDoc`, and `posOpeningShift` are set once
 * at register boot through `setRegisterData()`. `currency` and `company` are
 * derived computed properties from `posProfile`.
 *
 * **Dialog triggers**
 * Dialogs are opened and closed through dedicated action pairs:
 * `openPaymentDialog` / `closePaymentDialog`, `openInvoiceManagement` /
 * `closeInvoiceManagement`, `openDrafts` / `closeDrafts`, `openOrders` /
 * `closeOrders`, `openNewAddress` / `closeNewAddress`, `openMpesaPayments` /
 * `closeMpesaPayments`, `openVariants` / `closeVariants`.
 *
 * **Counter-based triggers**
 * Some side effects are driven by incrementing a counter ref rather than emitting
 * events, to avoid Vue event-bus coupling:
 * - `searchFocusTrigger` (via `triggerItemSearchFocus()`) — focuses the item search input.
 * - `forceReloadTrigger` (via `triggerForceReloadItems()`) — forces the item list to reload.
 * - `triggerTopItemSelection` (via `selectTopItem()`) — selects the first item in the list.
 */
import { defineStore } from "pinia";
import { ref, shallowRef, computed, watch } from "vue";
import type { POSProfile } from "../types/models";
import { configureShortcuts } from "../shortcuts";

/**
 * The selector-column panels the shell knows how to mount. Each member has a
 * `v-show` block in Pos.vue; a value with no block renders an empty column,
 * which is why this is a union and not `string` — a typo in `setActiveView`
 * now fails `vue-tsc` instead of blanking the register.
 */
export type PosActiveView = "items" | "offers" | "coupons" | "payment" | "floor";

export const useUIStore = defineStore("ui", () => {
  // Loading Overlay State
  const isLoading = ref(false);
  const loadingText = ref("Loading...");

  // Freeze Dialog State (Blocking UI)
  const isFrozen = ref(false);
  const freezeTitle = ref("");
  const freezeMessage = ref("");

  // Main POS View State (Active View)
  const activeView = ref<PosActiveView>("items");
  const paymentDialogOpen = ref(false);

  /**
   * A sale submit is in flight — the ONLY client-side double-submit guard
   * (audit RUNTIME-F2). It lives in the store, not in Payments.vue, because the
   * register deliberately DESTROYS and rebuilds the payment surface when it
   * crosses the 1100px boundary (inline column <-> CobroSurface, no KeepAlive);
   * a component-local ref reset to false on that remount, so a second PAGAR /
   * F-key / movil collect was accepted for the same invoice while the first
   * submit — which can wait up to 45s on the socket — was still running. The
   * server submission ledger dedupes on posa_client_request_id and is the real
   * backstop, but the guard must survive the remount so the register does not
   * even send the second request. Reset with the invoice on a new sale.
   */
  const submissionInFlight = ref(false);
  const setSubmissionInFlight = (value: boolean) => {
    submissionInFlight.value = Boolean(value);
  };

  /**
   * The register shell is showing the rail (roadmap §17.7). Published by
   * Pos.vue so chrome OUTSIDE the shell — the navbar's hamburger — can stand
   * down: with the rail on screen the drawer is a second list of the same
   * destinations. False whenever the shell is not mounted, so pages with no
   * rail keep their drawer.
   */
  const railLayout = ref(false);
  const setRailLayout = (value: boolean) => {
    railLayout.value = Boolean(value);
  };

  /**
   * The rail destination currently hosted over the sale stage (Gasto,
   * Cobranza, Borradores…), or null when the sale owns the stage. Published
   * by Pos.vue's sheet effects so surfaces that stay mounted BEHIND the
   * sheet (InvoiceSummary's band-lane teleports) can stand down — the band
   * is not the sale's while a destination is up (critique A1/A2, 08-29).
   */
  const hostedDestination = ref<string | null>(null);
  const setHostedDestination = (value: string | null) => {
    hostedDestination.value = value || null;
  };

  const invoiceManagementDialog = ref(false);
  const invoiceManagementTargetTab = ref<string>("history");
  const invoiceManagementDraftSource = ref<string>("invoice");
  const draftsDialog = ref(false);
  // Switched to `shallowRef` — these arrays hold full draft /
  // order documents and are mutated on every dialog open. Pinia
  // wrapping them as deep proxies caused per-row dep tracking
  // and contributed to the renderer OOM (Chrome "Aw, Snap!"
  // Error code 5) over long sessions with many customer changes.
  const draftsData = shallowRef<any[]>([]);
  const parkedOrders = shallowRef<any[]>([]);
  const draftSource = ref<string>("invoice");

  const ordersDialog = ref(false);
  const ordersData = shallowRef<any[]>([]);

  const setActiveView = (view: PosActiveView) => {
    activeView.value = view;
  };

  const openPaymentDialog = () => {
    paymentDialogOpen.value = true;
  };

  const closePaymentDialog = () => {
    paymentDialogOpen.value = false;
  };

  const openInvoiceManagement = (targetTab: string = "history", draftSourceKey: string = "invoice") => {
    invoiceManagementTargetTab.value = targetTab || "history";
    invoiceManagementDraftSource.value = draftSourceKey || "invoice";
    invoiceManagementDialog.value = true;
  };

  /**
   * The document source SURVIVES the close; the tab does not.
   *
   * `Pos.vue` turns a legacy open into a rail destination by closing this sheet
   * and activating the destination, so the close sits BETWEEN the request and
   * the mount that serves it. Resetting the source here erased «Select S.O»'s
   * `"order"` on the way past, and the hosted sheet re-opened on draft
   * invoices — the register's Borradores list, which is not what the chip asks
   * for.
   *
   * Leaving it is also what the rest of the surface already assumes:
   * `loadDrafts` and `updateDraftSource` write this ref on every load and every
   * switch, i.e. it is the drafts surface's remembered source, not a one-shot.
   */
  const closeInvoiceManagement = () => {
    invoiceManagementDialog.value = false;
    invoiceManagementTargetTab.value = "history";
  };

  // Opening the payment screen is a server round-trip (update_invoice), ~1s on
  // 4G. Nothing used to mark that time, so cashiers tapped Pay again and two
  // update_invoice calls landed on the same draft — MariaDB answered the loser
  // with 1020 and the POS showed a 500 (prod, 2026-08-10). This latch is the
  // one piece of state every Pay entry point checks, and the dock reads it to
  // show a busy tab the instant the finger lifts.
  const paymentRequestPending = ref(false);

  // frappe.call carries no timeout, so a request that never settles (4G dropped
  // mid-flight) would leave the latch shut and Pay dead until someone reloads
  // the POS — a worse day on the lane than the double-tap this guards. Well
  // clear of the ~1s round-trip it is watching.
  const PAYMENT_REQUEST_WATCHDOG_MS = 20000;
  let paymentRequestWatchdog: ReturnType<typeof setTimeout> | null = null;

  const clearPaymentRequestWatchdog = () => {
    if (paymentRequestWatchdog) {
      clearTimeout(paymentRequestWatchdog);
      paymentRequestWatchdog = null;
    }
  };

  const beginPaymentRequest = () => {
    paymentRequestPending.value = true;
    clearPaymentRequestWatchdog();
    paymentRequestWatchdog = setTimeout(() => {
      paymentRequestWatchdog = null;
      paymentRequestPending.value = false;
    }, PAYMENT_REQUEST_WATCHDOG_MS);
  };

  const endPaymentRequest = () => {
    clearPaymentRequestWatchdog();
    paymentRequestPending.value = false;
  };

  const paymentRouteTarget = ref<any | null>(null);

  const setPaymentRouteTarget = (target: any | null) => {
    paymentRouteTarget.value = target || null;
  };

  const clearPaymentRouteTarget = () => {
    paymentRouteTarget.value = null;
  };

  const openDrafts = (data?: any[], sourceKey: string = "invoice") => {
    const nextDrafts = Array.isArray(data) ? data : [];
    draftSource.value = sourceKey || "invoice";
    draftsData.value = nextDrafts;
    parkedOrders.value = nextDrafts;
    draftsDialog.value = true;
  };

  const closeDrafts = () => {
    draftsDialog.value = false;
  };

  const setDraftsData = (data?: any[]) => {
    draftsData.value = Array.isArray(data) ? data : [];
  };

  const setParkedOrders = (data?: any[]) => {
    parkedOrders.value = Array.isArray(data) ? data : [];
  };

  const setDraftSource = (sourceKey?: string) => {
    draftSource.value = sourceKey || "invoice";
  };

  const setInvoiceManagementDraftSource = (sourceKey?: string) => {
    invoiceManagementDraftSource.value = sourceKey || "invoice";
  };

  const parkedOrdersCount = computed(() => parkedOrders.value.length);
  const hasParkedOrders = computed(() => parkedOrdersCount.value > 0);

  const openOrders = (data?: any[]) => {
    ordersData.value = data || [];
    ordersDialog.value = true;
  };

  const closeOrders = () => {
    ordersDialog.value = false;
  };

  function setLoading(active: boolean, text: string = "Loading...") {
    isLoading.value = active;
    loadingText.value = text;
  }

  function freeze(title?: string, message?: string) {
    freezeTitle.value = title || "Processing";
    freezeMessage.value = message || "Please wait...";
    isFrozen.value = true;
  }

  function unfreeze() {
    isFrozen.value = false;
    freezeTitle.value = "";
    freezeMessage.value = "";
  }

  // POS Profile & Settings
  const posProfile = ref<POSProfile | null>(null);
  const stockSettings = ref<Record<string, any>>({});
  // Global POS Settings doc. The bus handoff ("set_pos_settings") was
  // removed in an old refactor but the store side was never wired, so
  // consumers (Payments' invoice_fields, the global return-validity
  // fallback) read {} forever. Fetched by Pos.vue's get_pos_setting().
  const posSettings = ref<Record<string, any> | null>(null);
  // Resolved capability payload — a sibling of the opening data (plan C7),
  // NOT a field on the profile doc. verticalStore reads this.
  const capabilityPayload = ref<Record<string, any> | null>(null);
  const companyDoc = ref<any>(null);
  const posOpeningShift = ref<any>(null);

  const currency = computed(() => posProfile.value?.currency || "");
  const company = computed(() => posProfile.value?.company || "");

  function setPosProfile(profile: POSProfile) {
    posProfile.value = profile;
  }

  function setPosSettings(doc: Record<string, any> | null) {
    posSettings.value = doc || null;
  }

  function setStockSettings(settings: Record<string, any>) {
    stockSettings.value = settings || {};
  }

  function setCompanyDoc(doc: any) {
    companyDoc.value = doc;
  }

  function setCapabilityPayload(payload: Record<string, any> | null) {
    capabilityPayload.value = payload || null;
  }

  // The keymap rides the capability payload (roadmap §17.3). Watched
  // rather than wired into each setter: every assignment path — opening
  // data, a bare setCapabilityPayload, a future one — must land on the
  // keyboard, and a missed path would strand a register on the previous
  // register's layout. null resets to muelle-default by design.
  watch(
    capabilityPayload,
    (payload) => {
      configureShortcuts({ keymapId: payload?.shortcuts?.keymap_id ?? null });
    },
    // sync: the keyboard must not answer to the previous register for
    // even one microtask after a new payload lands.
    { immediate: true, flush: "sync" },
  );

  function setRegisterData(data: {
    pos_profile?: POSProfile;
    stock_settings?: any;
    company?: any;
    pos_opening_shift?: any;
    capability_profile?: Record<string, any> | null;
  }) {
    if (data.pos_profile) posProfile.value = data.pos_profile;
    if (data.stock_settings) stockSettings.value = data.stock_settings;
    if (data.company) companyDoc.value = data.company;
    if (data.pos_opening_shift) posOpeningShift.value = data.pos_opening_shift;
    // The capability payload is a sibling of the opening data (plan C7).
    // Always assign — an opening with no preset carries null, which must
    // reset any prior preset rather than linger.
    if ("capability_profile" in data) {
      capabilityPayload.value = data.capability_profile || null;
    }
  }

  const LAST_INVOICE_STORAGE_KEY = "posa_last_invoice_id";
  function loadLastInvoiceId(): string | null {
    try {
      return localStorage.getItem(LAST_INVOICE_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }
  // Persisted per-origin so "Print Last Invoice" survives a page reload or
  // service-worker refresh. Kept in-memory only, this ref reset to null on
  // every reload — which silently broke the reprint button at the counter.
  const lastInvoiceId = ref<string | null>(loadLastInvoiceId());
  function setLastInvoice(id: string | null) {
    lastInvoiceId.value = id;
    try {
      if (id) localStorage.setItem(LAST_INVOICE_STORAGE_KEY, id);
      else localStorage.removeItem(LAST_INVOICE_STORAGE_KEY);
    } catch {
      // localStorage unavailable (private mode / quota) — in-memory only.
    }
  }

  const lastStockAdjustment = ref<any>(null);
  function setLastStockAdjustment(doc: any) {
    lastStockAdjustment.value = doc;
  }

  const offers = shallowRef<any[]>([]);
  function setOffers(data: any[]) {
    offers.value = data || [];
  }
  const applicableOffers = shallowRef<any[]>([]);
  function setApplicableOffers(data: any[]) {
    applicableOffers.value = data || [];
  }

  // Dialogs & Focus Triggers
  const searchFocusTrigger = ref(0);
  const newAddressDialog = ref(false);
  const newAddressCustomer = ref<any>(null);

  const mpesaDialog = ref(false);
  const mpesaData = ref<any>(null);

  const variantsDialog = ref(false);
  const variantsData = ref<any>(null);

  // The LOT PICKER (`components/pos/items/lot/`). Same shape as the variant
  // picker beside it: the store holds WHAT is being picked, `ItemsSelector`
  // opens it from its own add path, and `Pos.vue` mounts the surface — so the
  // desk click and the phone tap raise one picker, not two.
  const lotPickerDialog = ref(false);
  const lotPickerData = ref<any>(null);

  function triggerItemSearchFocus() {
    searchFocusTrigger.value++;
  }

  function openNewAddress(customer: any) {
    newAddressCustomer.value = customer;
    newAddressDialog.value = true;
  }

  function closeNewAddress() {
    newAddressDialog.value = false;
    newAddressCustomer.value = null;
  }

  function openMpesaPayments(data: any) {
    mpesaData.value = data;
    mpesaDialog.value = true;
  }

  function closeMpesaPayments() {
    mpesaDialog.value = false;
    mpesaData.value = null;
  }

  function openVariants(data: any) {
    variantsData.value = data;
    variantsDialog.value = true;
  }

  function closeVariants() {
    variantsDialog.value = false;
    variantsData.value = null;
  }

  function openLotPicker(data: any) {
    lotPickerData.value = data;
    lotPickerDialog.value = true;
  }

  function closeLotPicker() {
    lotPickerDialog.value = false;
    lotPickerData.value = null;
  }

  const draggedItem = ref<any>(null);
  function setDraggedItem(item: any) {
    draggedItem.value = item;
  }

  const offersCount = ref(0);
  const appliedOffersCount = ref(0);
  function setOfferCounts(total: number, applied: number) {
    offersCount.value = total;
    appliedOffersCount.value = applied;
  }

  const couponsCount = ref(0);
  const appliedCouponsCount = ref(0);
  function setCouponCounts(total: number, applied: number) {
    couponsCount.value = total;
    appliedCouponsCount.value = applied;
  }

  const showItemSettings = ref(false);
  function toggleItemSettings() {
    showItemSettings.value = !showItemSettings.value;
  }
  function setItemSettings(value: boolean) {
    showItemSettings.value = value;
  }

  const triggerTopItemSelection = ref(0);
  function selectTopItem() {
    triggerTopItemSelection.value++;
  }

  const forceReloadTrigger = ref(0);
  function triggerForceReloadItems() {
    forceReloadTrigger.value++;
  }

  return {
    isLoading,
    loadingText,
    posSettings,
    setPosSettings,
    capabilityPayload,
    setCapabilityPayload,
    isFrozen,
    freezeTitle,
    freezeMessage,
    activeView,
    paymentDialogOpen,
    submissionInFlight,
    setSubmissionInFlight,
    railLayout,
    setRailLayout,
    hostedDestination,
    setHostedDestination,
    invoiceManagementDialog,
    invoiceManagementTargetTab,
    invoiceManagementDraftSource,
    paymentRouteTarget,
    paymentRequestPending,
    beginPaymentRequest,
    endPaymentRequest,
    setActiveView,
    openPaymentDialog,
    closePaymentDialog,
    openInvoiceManagement,
    closeInvoiceManagement,
    setPaymentRouteTarget,
    clearPaymentRouteTarget,
    draftsDialog,
    draftsData,
    parkedOrders,
    draftSource,
    parkedOrdersCount,
    hasParkedOrders,
    openDrafts,
    closeDrafts,
    setDraftsData,
    setParkedOrders,
    setDraftSource,
    setInvoiceManagementDraftSource,
    ordersDialog,
    ordersData,
    openOrders,
    closeOrders,
    posProfile,
    stockSettings,
    companyDoc,
    posOpeningShift,
    lastInvoiceId,
    offers,
    applicableOffers,
    currency,
    company,
    setLoading,
    freeze,
    unfreeze,
    setPosProfile,
    setStockSettings,
    setCompanyDoc,
    setRegisterData,
    setLastInvoice,
    setOffers,
    setApplicableOffers,
    searchFocusTrigger,
    triggerItemSearchFocus,
    newAddressDialog,
    newAddressCustomer,
    openNewAddress,
    closeNewAddress,
    mpesaDialog,
    mpesaData,
    openMpesaPayments,
    closeMpesaPayments,
    variantsDialog,
    variantsData,
    openVariants,
    closeVariants,
    lotPickerDialog,
    lotPickerData,
    openLotPicker,
    closeLotPicker,
    draggedItem,
    setDraggedItem,
    offersCount,
    appliedOffersCount,
    setOfferCounts,
    couponsCount,
    appliedCouponsCount,
    setCouponCounts,
    showItemSettings,
    toggleItemSettings,
    setItemSettings,
    triggerTopItemSelection,
    selectTopItem,
    forceReloadTrigger,
    triggerForceReloadItems,
    lastStockAdjustment,
    setLastStockAdjustment,
  };
});
