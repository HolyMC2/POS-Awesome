# POSAwesome — Architecture

> Living architecture doc. Snapshot 2026-05-11 · branch `track/upstream-develop` (defendicon `15.29.0` + 23 perf commits).

---

## 1. What it is

POSAwesome is a Single-Page Application (SPA). It's a Vue 3 + Vuetify 3 + Pinia frontend that talks to a Python (Frappe / ERPNext v16) backend through `frappe.call` and a Socket.IO realtime channel. Offline support is provided by IndexedDB (Dexie) + a service worker.

**Two entry routes as of 2026-05-26:**
- **`/posapp`** — canonical operator entry. Web route (no Desk shell). Boot via `posawesome/www/posapp.{py,html}` + `web-entry.ts` chunk. Baseline DOM ~5 k nodes vs ~150 k under Desk; LCP win ~3-5 s on cold loads.
- **`/app/posapp`** — legacy entry inside Desk shell. Kept alive for regression testing of the Desk boot path; `posapp.js` redirects every operator hit to `/posapp` immediately. Devs opt back in with `/app/posapp?legacy=1` (also: `?customer_display=1` for the secondary-screen flow, `?_posa_chunk_reload` mid-recovery).

Workspace links + shortcuts target `/app/posapp` (`link_type=Page`, `link_to=posapp`) because v16's `Workspace Link.link_type` enum only allows `DocType / Page / Report` — the `posapp.js` redirect handles the hop to `/posapp`. `docs/TODO.md` → "Workspace link URL support" tracks a Property Setter cleanup that would let the workspace target `/posapp` directly.

```
┌─────────────────────────────── Browser ────────────────────────────────┐
│  Frappe Desk shell (sidebar, navbar, modals — ~150 k DOM nodes)        │
│   └─ <Page DocType "posapp">                                           │
│       └─ posapp.js                                                     │
│           └─ injects <script type="module" src="loader-<hash>.js">     │
│               └─ loader.ts — fetches version.json, mounts SPA          │
│                   └─ posawesome.bundle.ts (Vue app)                    │
│                       ├─ Vuetify 3.12.6                                │
│                       ├─ Pinia stores (items, customers, invoice…)     │
│                       ├─ Service Worker (sw.js) + IDB (Dexie)          │
│                       └─ socket.io-client → frappe.realtime            │
└────────────────────────────────────────────────────────────────────────┘
                              │  HTTPS  /  WSS
┌─────────────────────────────── Server ─────────────────────────────────┐
│  Frappe v16 (Python 3.14) + ERPNext + posawesome app                   │
│   ├─ /api/method/posawesome.posawesome.api.* whitelisted endpoints     │
│   ├─ Socket.IO publisher (frappe.publish_realtime)                     │
│   ├─ Background workers (queue-short / queue-long / scheduler)         │
│   └─ Hooks: doc_events, scheduler_events, after_install                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Repository layout

```
posawesome/
├── frontend/                       # Vue SPA source — built by Vite
│   ├── src/
│   │   ├── posapp.bundle.ts        # Entry: mounts the SPA into the Page
│   │   ├── loader.ts               # Pre-mount: fetches version.json, validates
│   │   ├── posapp/
│   │   │   ├── components/pos/     # All Vue components organised by area
│   │   │   │   ├── shell/          #   Pos.vue (root), Payments wrapper
│   │   │   │   ├── customer/       #   Customer dropdown, NewAddress
│   │   │   │   ├── items/          #   ItemsSelector, ItemCard, CameraScanner
│   │   │   │   ├── invoice/        #   ItemsTable, CartItemRow, InvoiceSummary
│   │   │   │   ├── offers/         #   PosOffers, PosCoupons
│   │   │   │   ├── flows/          #   Drafts, Returns, SalesOrders
│   │   │   │   └── shell/          #   ClosingDialog, BarcodePrinting
│   │   │   ├── composables/pos/    # Reusable logic split by domain
│   │   │   ├── stores/             # Pinia stores (state)
│   │   │   └── utils/              # Pure helpers
│   │   ├── offline/                # IDB / Dexie / cache layer
│   │   ├── sw-updater.ts           # SW version handshake
│   │   └── lib/                    # Dependency-free utilities
│   ├── tests/                      # vitest specs (530 currently)
│   ├── vite.config.js              # Build config (entry filenames, chunks)
│   ├── build-manifest.js           # Emits version.json with hashed asset URLs
│   └── package.json                # `vuetify ^3.12.6`, `vue ^3.3.4`, etc.
├── posawesome/                     # Python app
│   ├── posawesome/
│   │   ├── api/                    # Whitelisted endpoints, grouped by domain
│   │   │   ├── __init__.py         # Pre-imports submodules (avoid Py3.14 deadlocks)
│   │   │   ├── items.py / search.py / details.py / barcode.py
│   │   │   ├── customers.py        # incl. `search_customers` server-fallback
│   │   │   ├── invoices.py / invoice.py / invoice_processing/
│   │   │   ├── pricing_rules.py    # `get_active_pricing_rules`, reconcile
│   │   │   ├── offers.py / payments.py / shifts.py
│   │   │   ├── cash_movement/
│   │   │   ├── m_pesa.py / qz.py / utilities.py
│   │   │   └── stored_value.py / commercial_flow.py
│   │   ├── doctype/                # POS-specific DocTypes (POS Coupon, etc.)
│   │   ├── page/posapp/            # Frappe Page DocType + posapp.js loader
│   │   └── public/dist/js/         # Built assets (Vite output) + version.json
│   ├── www/                        # Frappe web routes (sw.js, offline.html, manifest)
│   ├── hooks.py                    # Frappe app hooks (doc_events, fixtures, …)
│   └── fixtures/                   # Custom fields exported as JSON
├── scripts/                        # Operational tooling
│   ├── heap_topnames.py            # Heap-snapshot: top retainers by class
│   ├── heap_strings.py             # Heap-snapshot: string duplication audit
│   ├── heap_components.py          # Heap-snapshot: Vue components + DOM count
│   ├── verify_build_artifacts.mjs  # Post-build sanity (entry hashes present)
│   └── electron_smoke_check.mjs    # Optional Electron smoke
├── ARCHITECTURE.md                 # ← you are here
├── CHANGELOG.md / README.md / CLAUDE.md / POSAWESOME-ROADMAP.md
└── pyproject.toml                  # Python deps
```

---

## 3. Boot sequence (clicking `/app/posapp` in Desk)

```
1. Frappe Desk loads its shell (~150 k DOM nodes baseline).
2. Frappe routes to the `posapp` Page DocType.
3. posapp.js (Page controller) runs:
       a. Fetches  /assets/posawesome/dist/js/version.json   (cache: no-store)
       b. Reads `assets.loader` URL (already content-hashed)
       c. <script type="module" src=that URL> injected into <head>
4. loader.ts boots:
       a. Re-fetches version.json (per-tab cache freshness)
       b. ensureStylesheetLoaded(): inserts <link rel=stylesheet href=assets.css>
       c. import(assets.posawesome) — dynamic import of the entry chunk
       d. mountShell(): calls module.mountPosApp(pageRef) → Vue + Pinia + Vuetify mount
5. posapp.bundle.ts (the Vue entry):
       a. createApp(Pos.vue) + Pinia + Vuetify
       b. startOptionalRuntimeServices():
            ├─ socketStore.init() — wires 6 frappe.realtime listeners
            └─ import(sw-updater.ts) — registers periodic version checks
       c. registers /sw.js Service Worker
6. Pos.vue mounts:
       a. Loads POS Profile (uiStore.posProfile)
       b. Triggers customersStore.get_customer_names() (background)
       c. Triggers itemsStore.loadItems() (background)
7. SW handshake:
       a. SW precaches loader/posawesome/css/offlineIndex from version.json's hashed URLs
       b. Cache name = `posawesome-cache-<version>`; old caches dropped
```

---

## 4. Data flow — key paths

### 4.1 Adding an item to the cart

```
User clicks ItemCard
  └─ ItemsSelector.handleRowClick → useItemAddition.addItem({item})
      ├─ batches via queueMicrotask
      └─ flushPendingItems(context):
           ├─ invoiceStore.addItems([items], 0)
           │    ├─ for each item: posa_row_id ← item.posa_row_id ?? random()
           │    │                  itemsData.set(rowId, cloneItem(item))
           │    └─ recalculateTotals() (debounced 50 ms)
           └─ context.invoiceStore.touch() → metadata.changeVersion++
                ↓ triggers
           invoiceWatchers.ts:
             "invoiceStore.metadata.changeVersion" watch:
               ├─ schedulePricingRuleApplication() (debounced 150 ms)
               └─ scheduleOfferRefresh()
                    ↓
             applyPricingRulesForCart():
               ├─ _applyLocalPricingRules() — sync pass over indexed rules
               └─ _applyServerPricingRules() — fire-and-forget; bracketed by
                  `_applyingPricingRules` so cart watcher does NOT re-trigger
                  on the server's own mutations.
```

The `_applyingPricingRules` bracketing is the **anti-flicker guard** — without it, server pricing mutates cart → watcher fires → re-applies → infinite loop.

### 4.2 Selecting a customer with a foreign price list

```
User picks customer
  └─ customersStore.setSelectedCustomer(name)
       ↓
  Invoice.vue $watch(selectedCustomer):
       ├─ this.customer = name
       └─ fetch_customer_details() (in invoice_utils/customer.ts):
            ├─ frappe.call get_customer_info → customer_info.value
            ├─ resolves customer's `default_price_list`
            ├─ if differs from POS Profile default:
            │     this.selected_price_list = resolvedPriceList
            └─ if items in cart: update_items_details(items)  ← FIRE AND FORGET
                                                                (was awaited; blocked)
       ↓
  invoiceWatchers.ts $watch(selected_price_list):
       ├─ clearPriceListCache()
       ├─ emit "update_customer_price_list" → itemsStore.updatePriceList()
       │    └─ if cached price-list snapshot exists → applyPriceListToItems() (chunked)
       │      else → DO NOT pull full catalog (was forceServer; removed)
       └─ DEFERRED via requestIdleCallback:
            ├─ items.forEach: i._detailSynced = false
            └─ packed_items.forEach: i._detailSynced = false
            (was clearItemDetailCache + clearItemStockCache; removed — those
             wholesale wipes forced every subsequent add to re-fetch from server.)
```

### 4.3 Searching for an item ("rev" → "revision")

```
User types in items search box
  └─ ItemsSelector $watch(first_search) → debouncedSearch
       └─ itemsStore.searchItems(term)
            └─ runs filterAndPaginate over filteredItems.value
                 └─ if cacheEmpty || partial-catalog && term ≥ 3 chars:
                      → search_items_lean adapter (useItemsIntegration):
                           loadItems({ forceServer: true, lean: true,
                                       searchValue: term, groupFilter })
                       which:
                           ├─ requests get_items with limit=50, include_image=0
                           ├─ MERGES results into items.value (dedupe by item_code)
                           └─ skips cache-write / persistence / background sync
```

### 4.4 Building / loading items list

```
itemsStore.loadItems({ forceServer, searchValue, …, lean }):
  ├─ buildLoadItemsRequest() builds the API args
  │     - if forceServer: clones POS Profile via SHALLOW SPREAD (was JSON.parse(JSON.stringify))
  │     - if lean: limit = 50, include_image = 0
  ├─ if !forceServer && cache hit → return cached
  ├─ else → itemService.getItemsData(args, signal) (fetch wrapper around frappe.call)
  └─ result handling:
       ├─ if lean: merge new items into items.value (markRaw each), prime detail cache
       └─ else: setItems(fetchedItems) — replaces items.value, indexes rebuild
```

---

## 5. State (Pinia stores)

All stores use `shallowRef` + `markRaw` for arrays/maps that hold many records — **per-property reactive proxies were the dominant CPU + memory cost**. See §8 for why.

| Store | Purpose | Reactivity surface |
|---|---|---|
| `itemsStore` | Catalog + indexes + price-list snapshots | `shallowRef<Item[]> items`, `shallowRef<Map> itemsMap`, `barcodeIndex`, `filteredItems` |
| `customersStore` | Customer list, scope isolation, search | `shallowRef<CustomerSummary[]> customers`; capped at 50 in `filteredCustomers` for dropdown |
| `invoiceStore` | Cart contents (`itemsData` Map keyed by `posa_row_id`), totals, metadata.changeVersion | Reactive Map (cart needs deep reactivity for line edits) |
| `pricingRulesStore` | Pricing-rule snapshot + indexes | `shallowRef<PricingRule[]> rules`, plain Maps `byItem/byGroup/byBrand` |
| `useItemsCache` | Memory caches keyed by (search/group/priceList/scope) — searchResults / priceListData / itemDetails | `shallowRef + markRaw` Maps with TTL + LRU caps (50 / 1000 / 500) |
| `uiStore` | UI state, dialog open flags, drafts/parkedOrders/ordersData/offers/applicableOffers | `shallowRef<any[]>` for the 5 list refs |
| `socketStore` | Realtime invoice / payment / stock event handlers + waiters | Plain refs; `init()` is idempotent (guard added to fix listener leak) |
| `toastStore` | Snackbar queue + bell history (capped at 20) | Plain refs |
| `employeeStore` | Active terminal employees | Plain refs |
| `offlineSyncStore` | Background sync orchestration | Plain refs |

---

## 6. Backend (Python) — endpoint groups

```
posawesome/posawesome/api/
├── __init__.py               # Pre-imports submodules (Py 3.14 ModuleLock fix)
├── items.py                  # get_items_details, get_items_count
├── item_processing/
│   ├── search.py             # get_items (the main catalog endpoint)
│   ├── details.py            # get_items_details (per-line refresh)
│   ├── barcode.py / stock.py
├── customers.py              # get_customer_names, search_customers (NEW), info, addresses
├── invoices.py / invoice.py  # delete/submit/update + apply_tax_inclusive
├── invoice_processing/       # creation.py, data.py — heavy invoice ops
├── pricing_rules.py          # get_active_pricing_rules, reconcile_line_prices
├── offers.py                 # get_offers, get_pos_coupon, get_active_gift_coupons
├── payments.py               # create_payment_request, get_available_credit
├── sales_orders.py / quotations.py / purchase_orders.py
├── shifts.py                 # opening / closing
├── cash_movement/service.py  # cancel/delete + history
├── m_pesa.py                 # M-Pesa STK confirmation (allow_guest)
├── qz.py                     # QZ Tray cert + signing
├── stored_value.py           # gift cards / store credit
├── commercial_flow.py        # Quotation → SO → SI conversion plumbing
├── dashboard.py              # 4500-line mega-payload (Tier 4 split candidate)
└── utilities.py              # version, language, branch, host, db/server stats
```

Realtime events the SPA subscribes to (`socketStore.init`):

- `pos_invoice_processed` — backend finished submitting an invoice
- `pos_invoice_submit_error`
- `pos_post_submit_payments_started/completed/failed`
- `posa_stock_changed` — broadcast after Bin updates (debounced via `frappe.flags._posa_stock_change_queue`)

---

## 7. Build pipeline (Vite)

`frontend/vite.config.js`:

- **3 entry points**: `posawesome` (SPA), `loader` (boot), `offline/index` (lazy offline path).
- **All entries content-hashed** (`getEntryFileName` → `[name]-[hash].js`).
- `cssCodeSplit: false` → single combined stylesheet (`style-<hash>.css`). Loader injects one `<link>` from `assets.css`.
- `manualChunks`: pinia / vue-router / vue-i18n / vue-virtual-scroller / vuetify / vue / vendor each in their own chunk.
- `esbuild.pure: ["console.log", "console.debug", "console.trace"]` strips hot-path debug output.
- `esbuild.drop: ["debugger"]`.
- `buildVersion = git rev-parse --short=12 HEAD` (fallback: `Date.now()`). Same SHA = identical hashed filenames; deploys of the same commit don't force connected POS clients to reload.

`frontend/build-manifest.js` writes `posawesome/public/dist/js/version.json`:

```json
{
  "version": "<git-sha>",
  "assets": {
    "loader":      "/assets/posawesome/dist/js/loader-<hash>.js?v=<sha>",
    "posawesome":  "/assets/posawesome/dist/js/posawesome-<hash>.js?v=<sha>",
    "css":         "/assets/posawesome/dist/js/style-<hash>.css?v=<sha>",
    "offlineIndex":"/assets/posawesome/dist/js/offline/index-<hash>.js"
  }
}
```

`posapp.js` and `sw.js` both consume this manifest to decide which URLs to load / precache. **A fresh deploy invalidates only by filename; the browser cannot pin a stale entry.**

---

## 8. Why so much shallowRef + markRaw?

Vue 3 / Pinia wrap every reactive `ref({...})` value in a `Proxy`, walking nested properties to set up dep tracking. With:

- ~5 700 catalog items (each ~50 fields)
- ~4 000 customers (each ~10 fields)
- Hundreds of pricing rules
- Multiple cached price-list snapshots

the per-Proxy + per-dep-tracking cost dominated CPU AND heap. Heap snapshots before the perf branch showed 49 k+ minified `_o` objects (Vue ref wrappers), with each catalog mutation re-wrapping growing arrays. `applyPriceListToItems` did 5 reactive writes × ~5 000 matching items = 25 k+ dep notifications in one synchronous tick.

The fix (Tier 3 of `POSAWESOME-ROADMAP.md`):

1. **`shallowRef([])` + `markRaw(item)` on insert** — the array reference is reactive, individual items are not. Mutations to individual fields don't fire reactivity automatically; consumers re-evaluate on array reassignment via `triggerRef` or `items.value = [...items.value]`.
2. **`deep: true` removed from hot watchers** — Vue's deep watch traverses the entire object tree to register dep tracking; with 100-key POS Profile + offers arrays, this fired thousands of times per cart edit. Replaced with shallow watches that fire on identity change only (and the consumers replace the whole object via `setPosProfile(...)` when they actually change).
3. **`useItemsCache` LRU + de-reactified** — `searchResults` / `priceListData` / `itemDetails` Maps were unbounded; on long sessions the renderer hit OOM. Now bounded at 500 / 50 / 1 000 entries with TTL eviction.
4. **`socketStore.init` idempotent** — was being called per Pos.vue (re)mount, stacking 6 `frappe.realtime.on(...)` handlers per call. Now guarded by a module-level `initialised` flag.
5. **Server pricing fire-and-forget** — `_applyServerPricingRules` mutates the cart; awaiting it serialised every cart edit behind a 1-5 s round-trip. Now async, with `_applyingPricingRules = true` held for the duration so the cart watcher doesn't re-trigger on the server's own mutations (anti-flicker).
6. **`JSON.parse(JSON.stringify(posProfile))` removed** — the per-search deep-clone allocated fresh string copies of every property in the 100-key POS Profile. With many searches the duplicate-string population grew unbounded. Replaced with shallow spread `{ ...posProfile, posa_use_server_cache: 0, posa_force_reload_items: 1 }`.

See `scripts/heap_*.py` for the diagnostic tooling used to measure each fix.

---

## 9. Branch state (2026-05-11)

- **Upstream**: `defendicon/POS-Awesome-V15` `develop` @ `15.29.0` (`737e993f`).
- **Our fork**: `HolyMC2/POS-Awesome` `perf/upstream-develop-tweaks` (which is a downstream of our local `track/upstream-develop`). Ahead of upstream by 23 commits — all perf / hotfix work.
- **`doco-customizations`**: long-lived production branch. (Currently NOT merged with `perf/...` — both deployed separately to prod.)

To rebase on a future upstream release: rebase `track/upstream-develop` onto the new `upstream/develop`, resolve, retest 530 vitest, redeploy.

---

## 10. Upstream pending work — `fix-app-performance-issues` branch

Three commits exist on `upstream/fix-app-performance-issues` (not in `develop` yet) addressing the same problem space:

### `b5992f70` — Safe startup and bundle performance
- Defers `runPosBootSync` to `setTimeout(..., 0)` so render chrome appears before boot syncs.
- Refactors `eventBus.on` patterns in NewAddress / Returns / MpesaPayments → prop-driven `watch` blocks; relies on natural unmount cleanup instead of manual `.off()`.
- Centralises debug logging behind a `debugLog()` import.
- Adds tests for chunk recovery + payment printing.

**Verdict: KEEP UPSTREAM (cherry-pick).** Zero overlap with our reactive-layer perf work; complements it. Low conflict risk.

### `8bf5eba7` — Item / customer data architecture
- Adds **5 new normalized indexes** to `itemsStore` / `useItemsSearch`:
  `itemByCode`, `barcodeToItem`, `itemNameSearchIndex` (Map<token, Set<item_code>>), `priceByItemAndPriceList`, `stockByItemAndWarehouse`, `uomConversionByItem`.
- Adds `customerByName` Map for O(1) customer lookup.
- Adds `search_tokens` field to cached items + uses Dexie's `startsWithIgnoreCase()` for sub-linear first-token seek.
- Wraps every `items.value` / `customers.value` assignment with `markRaw()`.

**Verdict: HYBRID.** Our `shallowRef + markRaw` (commits `8f3a87e5`, `7f82339d`) already covers the wrapping. Upstream's *additional* indexes (price by price-list, stock by warehouse, search tokens with Dexie tree seek) are real wins we haven't done. Needs a 3-way merge on `itemsStore.ts` / `customersStore.ts` / `useItemsSearch.ts` to keep both layers.

### `efdaa465` — Cart and pricing performance
- Introduces `CartMutationKind` enum + `rowTotals` cache + `cartInvalidation` state.
- Per-row watchers stored in a `rowWatchStops` Map (vs our debounced global watcher).
- `classifyChangedFields()` auto-tags edits as quantity / rate / discount / pricing / stock / display / structure.

**Verdict: DEFER.** Zero file conflict (different store layout). Our debounced `recalculateTotals` works; upstream's row-mutation tracker is novel but not a current blocker. Re-evaluate after we run the long-test cycle on the merged 1+2.

### Recommended integration order
1. **Cherry-pick `b5992f70`** — low risk, immediate wins on boot path.
2. **3-way merge `8bf5eba7`** — keep our shallowRef wrappers + add upstream's normalized indexes. ~1 day.
3. **Defer `efdaa465`** — bandwidth permitting; revisit if cart-edit perf regressions surface.

---

## 11. Operational quick reference

```bash
# Build
bench build --app posawesome
# OR (this host) — full lab refresh
~/muelle-host/muelle/scripts/dev-refresh.sh posawesome

# Deploy on prod (contavm)
ssh contavm@<prod-ip>
fm shell ventas.docomexico.com
cd apps/posawesome
git pull --ff-only fork perf/upstream-develop-tweaks
cd frontend && yarn install
bench build --app posawesome
bench --site ventas.docomexico.com migrate
bench --site ventas.docomexico.com clear-cache
bench restart

# Heap-snapshot triage
python3 scripts/heap_topnames.py path/to/heap.heapsnapshot
python3 scripts/heap_strings.py    path/to/heap.heapsnapshot
python3 scripts/heap_components.py path/to/heap.heapsnapshot

# Vitest
cd frontend && node_modules/.bin/vitest run
```

POS Profile recommended config (post-perf-branch):
- `posa_local_storage = 1`
- `posa_use_server_cache = 1`
- `posa_server_cache_duration = 30` (minutes)
- `posa_force_server_items = 0`

---

## 12. Known structural floor

Even with all 23 perf commits, the SPA still hits Chrome's per-tab memory cap on long sessions (~30-60 min of intensive use). The remaining drivers are:

- **Frappe Desk shell DOM** (~150 k nodes baseline at `/app/posapp`)
- **POS catalog held in memory** (5 700 items × ~50 fields each)
- **Vuetify per-component CSS rules** (mostly GC'd, but creates GC pressure)

The cleanest structural fix is **moving POSAwesome from `/app/posapp` (Desk-wrapped) to `/posapp` (web route, no Desk)** — see Path 3 in the perf-investigation log. Estimated effort ~1 week, single-developer. DOM baseline drops from ~250 k → ~100 k nodes.
