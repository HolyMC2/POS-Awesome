# POS SPA — conventions map (invoice surfaces, dialogs, transport, print, icons)

> As of commit ee46f76fd (2026-08-11). Codebase survey — file:line refs drift; verify before relying. Update this doc when shapes change. Companion: CUSTOMER_FISCAL_SURFACES.md, RESTAURANT_TABLES_SPEC.md.

## 1. Invoice browser surfaces

Model new browser surfaces on **InvoiceManagement.vue** (`components/pos/flows/InvoiceManagement.vue`, ~2700 lines). `Drafts.vue` is a REDIRECT SHIM into it (its own watcher closes itself and calls `uiStore.openInvoiceManagement("drafts", …)`) — do not model on Drafts' data flow.

| Surface | Opened by |
|---|---|
| Invoice Management (History/Unpaid/Drafts/Returns tabs) | `uiStore.openInvoiceManagement(tab, source)` — store, NOT bus |
| Drafts (legacy) | `uiStore.openDrafts(...)` → redirects |
| Sales Orders | `uiStore.openOrders(data)` |
| Returns | bus: `eventBus.emit("open_returns", company)` + `openRequest: {…, token: Date.now()}` prop pattern (Pos.vue ~796-816) |
| Print Last Invoice | `composables/core/useLastInvoicePrinting.ts` via NavbarMenu quick action |

Backend methods: list = generic `frappe.client.get_list` fanned over `["POS Invoice","Sales Invoice"]`; plus `posawesome...api.invoices.{delete_invoice,get_invoice_for_return,get_draft_invoices,get_draft_invoice_doc,search_invoices_for_return,get_last_pos_invoice}`, `commercial_flow.{list_source_documents,prepare_document_flow_action,commit_document_flow_action}` (utils/documentSources.ts), `sales_orders.search_orders`.

Field-list convention (`InvoiceManagement.vue` ~2077): `getInvoiceListFields(extraFields=[])` returns the base list (name, customer, customer_name, posting_date/time, grand_total, paid_amount, outstanding_amount, status, currency, pos_profile, owner, modified_by) + spread. Filters via `buildInvoiceFilters()` — always `docstatus: 1`, supervisor scope swaps pos_profile for company. Ordering `posting_date desc, posting_time desc, modified desc`, `limit_page_length: 0`, client paging TAB_PAGE_SIZE=25. House style for POS Profile checkboxes: loose `== 1`. Per-row status painting precedent: Returns.vue `posa_return_expired` chips + row class.

## 2. Navigation / menus

`NavbarMenu.vue`: menu items are plain objects in computeds (`quickActions`, `settingsSections`, `supervisorSections`), gated with `cond ? {...} : null` + `.filter(Boolean)`. Item shape: `{ id, label, subtitle, icon, tone: primary|secondary|info|warning|danger|neutral, handler: "<string>", disabled? }`. Dispatch = `switch` on handler string in `handleAction` → closeMenu, then `$emit` / local dialog flag / `router.push`. Supervisor gating: `currentCashier?.is_supervisor` inline or whole-section `showSupervisorSection()`; for ROUTES the server verdict wins (`dashboardAccessAllowed` from `api.dashboard.get_dashboard_access`; router `meta.requiresSupervisor` via `getDashboardAccessCached()`).

Dialog mounting: NOT App.vue. Flows dialogs mount in `components/pos/shell/Pos.vue` as `defineAsyncComponent` each `v-if`'d on a uiStore flag (lazy chunk). Navbar-scoped dialogs in `Navbar.vue`. uiStore convention: `ref(false)` + `openX()/closeX()` pair, exported; payload arrays are `shallowRef` (deep Pinia proxies caused renderer OOM — comment ~63-67).

bus.ts: CLOSED mitt event map `export type Events` — every event declared or vue-tsc fails; payload type or `void`. Always `eventBus.off(name, handler)` WITH handler — bare off removes all listeners.

## 3. Backend transport tiers

1. Raw `frappe.call` (~90% of sites): destructure `{message}`, try/catch → console.error + toast.
2. `services/api.ts` envelope: `api.callEnvelope<T>()` never throws → `{ok, data, error:{code,message,retryable}, requestId, serverTime}`; `api.call<T>()` unwraps or throws ApiEnvelopeError. Codes classified from server text (TIMESTAMP_MISMATCH, INSUFFICIENT_STOCK, BUSINESS_RULE…); transport retryable on status null|0|408|429|>=500. Use for round-trips where error class matters (PAC, submits). invoiceService raises timeout to 120s for submits.
3. `api/restaurant.ts` module pattern: frozen `METHODS` dotted-path table, one exported fn per op, `callRestaurant` unwraps `.message`; `RestaurantOfflineError` for online-only ops; `isTransportFailure()` — anything carrying exc_type/exc/_server_messages/4xx is a VERDICT (re-throw to operator), only pre-verdict transport deaths are retryable.

Toasts (`stores/toastStore.ts`): `{title, message?, color, timeout?, key?, loading?}`; dedupe by key (default `color::title`); all land in bell history. Rule: NEVER silent on user-initiated fetch — dialog-body `<v-alert type="error">` with `err?.serverMessage || err?.message || fallback` (canonical comment in ChargeRequestsDialog).

## 4. Print path

Three copies of the same recipe (no shared builder): usePaymentPrinting.loadPrintPage, useLastInvoicePrinting.printLastInvoice (module-scope in-flight guard), InvoiceManagement.printInvoice. URL: `/printview?doctype&name&trigger_print=1&format&no_letterhead[&letterhead]`. Branch order everywhere: (1) posa_open_print_in_new_tab → window.open + watchPrintWindow, popup-block → track + fall through; (2) posa_silent_print && online → QZ `printDocumentViaQz` (renders via frappe.www.printview.get_html_and_style), throw → notifyQzPrintFallback → silentPrint iframe; (3) default window.open("Print"). Helpers in plugins/print.ts. Format resolution: override || profile.print_format_for_online || profile.print_format || "Standard"; per-payment-method overrides in utils/paymentPrintFormat.ts.

## 5. Mobile dialog conventions (390px)

`useDialogFullscreen` (composables/core/, breakpoint default 600; flows sheets use 1100) is MANDATORY for form dialogs: it DROPS geometry props when fullscreen because VOverlay writes inline width/min/max that outrank the fullscreen stylesheet (the Mpesa 800px-on-390px bug). Template: `v-bind="dialogProps"`, `scrollable`, explicit `:theme`, content-class hook. Card = flex column, only `__body` scrolls, `__footer` sticky with `env(safe-area-inset-bottom)` + backdrop blur; media queries must relax geometry over the WHOLE fullscreen range (1099.98px AND 959px tiers; footer buttons `flex:1` stacked). BEM off component name: `<name>-dialog-card` + `__title/__body/__footer` + `--light/--dark`. Tokens: `--pos-surface(-raised)`, `--pos-text-primary/-muted`. `*.vue.css` siblings are GITIGNORED build artifacts — author styles in the .vue.

## 6. Icons

`plugins/icons/mdiIconPaths.ts` — generated, curated @mdi/js SVG paths (~220). No webfont. Consumption transparent: templates write plain `mdi-*` strings anywhere Vuetify accepts an icon; the custom IconSet resolves name→path and re-applies the mdi-* class (CSS selects on it). HARD GATE `tests/mdiIconCoverage.spec.ts`: scans frontend/src AND the @saldo alias dir (stubs fallback); missing entry fails; ORPHANS fail; `KNOWN_MISSING_ICONS` must stay `[]` (repoint call sites, never quarantine). New icon = import + map entry, alphabetical, same commit.

## 7. Recommended shape for a new browser/flow surface

New `components/pos/flows/X.vue` + `useDialogFullscreen({breakpoint:1100,…})` + BEM root; uiStore `xDialog` ref + open/close pair; lazy mount in Pos.vue beside the other flows; list via get_list + buildInvoiceFilters-style predicate + getInvoiceListFields(extra); entry via NavbarMenu item (store call, not bus) or InvoiceActionButtons button gated `posa_* == 1`; round-trip calls via api.callEnvelope; errors inline v-alert + toast.
