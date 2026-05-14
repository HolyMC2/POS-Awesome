# Perf branch — commits regrouped by area

> Snapshot 2026-05-11 · branch `track/upstream-develop` · 30 commits ahead of `upstream/develop`

The perf branch landed in chronological hot-fix order. This doc reorganises the commits by area so future cherry-picks / rebases can pull a coherent slice without dragging unrelated changes.

For each area: ordered list of commits + the file footprint + a one-line mental model.

---

## A. Build / deploy hygiene (3 commits)

> Make every deploy emit unique, content-addressed URLs that no browser cache can pin stale.

| Order | Hash | What |
|---|---|---|
| 1 | `d477e21f` | Hash entry filenames (`loader-<hash>.js`, `posawesome-<hash>.js`, `style-<hash>.css`); read URLs from `version.json.assets` map at runtime |
| 2 | `5aa38110` | Bump Vuetify 3.7.5 → 3.12.6 (gets the v-virtual-scroll deep-watch fix from v3.8) |
| 3 | `2694d8dc` | Update `buildManifest.spec.ts` to assert the new hashed-entry contract |

**Files:** `frontend/build-manifest.js`, `frontend/vite.config.js`, `posawesome/www/sw.js`, `posawesome/posawesome/page/posapp/posapp.js`, `frontend/package.json`, `frontend/yarn.lock`, `frontend/tests/buildManifest.spec.ts`.

**Cherry-pick safe in this order alone.** No store/runtime touches.

---

## B. Realtime / connectivity (1 commit)

> Initial-connect race: socket already connected by the time the SPA's listener attaches; refs stay `undefined` and the "Limited connectivity" banner never clears.

| Order | Hash | What |
|---|---|---|
| 1 | `78750236` | Seed `serverOnline` from `(realtime as any)?.socket?.connected` at mount; mirror to `window.serverOnline` for the global fast-path |

**Files:** `frontend/src/posapp/composables/runtime/useNetworkLifecycle.ts`.

---

## C. Reactive layer — store de-deepening (8 commits)

> The single biggest source of CPU + heap pressure was Pinia wrapping every entry of large arrays/maps in deep proxies. Switch the storage to `shallowRef` + `markRaw` per entry; consumers re-evaluate on array reassignment.

| Order | Hash | What |
|---|---|---|
| 1 | `8f3a87e5` | `itemsStore.items` + `filteredItems` → `shallowRef`; `markRaw` per insert; `triggerRef`-equivalent via array-ref swap |
| 2 | `06c1d639` | `useItemsSearch.itemsMap` + `barcodeIndex` → `shallowRef(new Map)` |
| 3 | `47d0ca54` | `pricingRulesStore.rules` → `shallowRef`; `indexes.byItem/byGroup/byBrand` plain object |
| 4 | `c9789db6` | (audit follow-up) wrap pricingRulesStore inverted-index Maps in `markRaw` |
| 5 | `7f82339d` | `customersStore.customers` → `shallowRef`; `markRaw` per row + customer fallback gate fix |
| 6 | `0d94b966` | `useItemsCache.cache` → `shallowRef` + `markRaw` inner Maps + LRU eviction (priceListData 50, itemDetails 1000) |
| 7 | `539d8654` | `uiStore` 5 array refs → `shallowRef` (offers / applicableOffers / draftsData / parkedOrders / ordersData) |
| 8 | `40407fee` | Customer dropdown cap from 200 to 50 (Vuetify v-autocomplete bound-items mount cost) |

**Files:** `frontend/src/posapp/stores/{itemsStore,customersStore,pricingRulesStore,uiStore}.ts`, `frontend/src/posapp/composables/pos/items/store/useItemsSearch.ts`, `frontend/src/posapp/composables/pos/items/store/useItemsCache.ts`.

**Constraint:** all 8 should ship together (or in stages). Consumers that mutate `xxx.value[i].field` rely on the store re-publishing the array reference; partial adoption breaks observability.

---

## D. Watcher hygiene (3 commits)

> Drop `deep: true` from watchers whose handlers rebuild from whole-object replacement signals, not nested mutation.

| Order | Hash | What |
|---|---|---|
| 1 | `dc0518f4` | `Invoice.vue:949,964` — drop `deep: true` on `uiStore.posProfile` + `uiStore.offers` watchers |
| 2 | `5006a5b5` | 12 watchers across 9 files (PosOffers / PosCoupons / ItemsTable / useInvoiceItems / useInvoiceOffers / InvoiceSummary / Customer / useCustomerDisplayPublisher / Pos.vue) |
| 3 | `188fe54f` (partial) | Defer `selected_price_list` watcher's invalidation pass via `requestIdleCallback` |

**Files:** see paths in commit bodies.

---

## E. Listener hygiene (2 commits)

> Stop registering listeners that never get cleaned up + stop double-registering store init.

| Order | Hash | What |
|---|---|---|
| 1 | `9fee9e46` | `socketStore.init()` idempotency guard (was registering 6 `frappe.realtime.on` per Pos.vue mount) |
| 2 | `2977e50c` | `beforeUnmount` cleanup on PosOffers / PosCoupons / NewAddress (with the b5992f70 cherry-pick, NewAddress's cleanup was made dead and removed) |

**Files:** `frontend/src/posapp/stores/socketStore.ts`, `frontend/src/posapp/components/pos/offers/PosOffers.vue`, `…/offers/PosCoupons.vue`, `…/customer/NewAddress.vue`.

---

## F. Pricing rules (3 commits)

> The cart-flicker root cause: server pricing's response mutates the cart, the cart watcher re-triggers pricing, repeat. Plus a hang-state lock on no-timeout fire-and-forget.

| Order | Hash | What |
|---|---|---|
| 1 | `7f82339d` (partial) | Anti-flicker bracketing: hold `_applyingPricingRules = true` across the server response phase |
| 2 | `96e91137` | `_applyServerPricingRules` switched to fire-and-forget; drop `$forceUpdate` from local pass; drop two hot console.logs |
| 3 | `345a59c1` | (audit follow-up) timeout the server fire-and-forget at 5 s so a hung request doesn't lock pricing forever |

**Files:** `frontend/src/posapp/components/pos/invoice_utils/pricing.ts`, `frontend/src/posapp/composables/pos/items/useItemAddition.ts`.

---

## G. Items search (4 commits)

> Server-fallback when local IDB returns nothing for a 3+ char query, plus a lean variant that doesn't re-pull the whole catalog.

| Order | Hash | What |
|---|---|---|
| 1 | `4607145e` | Drop `cacheEmpty` gate on the existing fallback; per-term cooldown Map |
| 2 | `8eb19103` | (audit follow-up) bound the per-term Map at 100 LRU entries |
| 3 | `ade09ea1` | New `loadItems({ lean: true })` path — capped 50 rows, no images, MERGES into existing items rather than replacing |
| 4 | `786d0a91` | (audit follow-up) gate the lean merge by current `effectivePriceList` so a stale fetch from before a customer switch can't add items priced for the old list |

**Files:** `frontend/src/posapp/composables/pos/items/useItemsSelectorSearch.ts`, `frontend/src/posapp/composables/pos/items/useItemsIntegration.ts`, `frontend/src/posapp/stores/items/loadItemsRequest.ts`, `frontend/src/posapp/stores/itemsStore.ts`.

---

## H. Customer flow (2 commits)

> Customer search empty after sync; foreign price-list change blocks SPA on `update_items_details`.

| Order | Hash | What |
|---|---|---|
| 1 | `188fe54f` (partial) | New `posawesome.posawesome.api.customers.search_customers` server endpoint + `customersStore.performSearch` falls back to it when IDB returns 0 for 2+ char term |
| 2 | `0d652a8f` | `fetch_customer_details` switches `update_items_details(items)` to fire-and-forget; same for `flushBackgroundUpdates` |

**Files:** `posawesome/posawesome/api/customers.py`, `frontend/src/posapp/stores/customersStore.ts`, `frontend/src/posapp/components/pos/invoice_utils/customer.ts`, `frontend/src/posapp/components/pos/invoice_utils/item_updates.ts`.

---

## I. Catalog price-list re-pricing (3 commits)

> `applyPriceListToItems` over a 5 k-item catalog blocks the main thread; later, mid-chunk customer switch leaves a mixed-rate state.

| Order | Hash | What |
|---|---|---|
| 1 | `188fe54f` (partial) | Drop the `loadItems({ forceServer: true })` fallback in `updatePriceList` (was full catalog re-pull on customer change); defer the watcher's mark-stale loop via `requestIdleCallback`; coalesce rapid switches |
| 2 | `7bbbea2c` | Chunk `applyPriceListToItems` into 400-item slices via `requestIdleCallback`; in-flight cancellation on a newer call |
| 3 | `786d0a91` | (audit follow-up) generation-id guard so cancellation actually stops the stale chunks from continuing |

**Files:** `frontend/src/posapp/components/pos/invoice/invoiceWatchers.ts`, `frontend/src/posapp/stores/itemsStore.ts`.

---

## J. Backend (2 commits)

> Server-side fixes that landed alongside frontend perf work.

| Order | Hash | What |
|---|---|---|
| 1 | `188fe54f` (partial) | New `search_customers(pos_profile, search_term, limit=20)` whitelisted endpoint |
| 2 | `6e9d7222` | Pre-import `pricing_rules` in `api/__init__.py` to avoid Py 3.14's stricter `_ModuleLock` deadlock detection |

**Files:** `posawesome/posawesome/api/customers.py`, `posawesome/posawesome/api/__init__.py`.

---

## K. Memory hygiene / hot-path stripping (2 commits)

> Reduce per-allocation churn that pushes the renderer toward OOM on long sessions.

| Order | Hash | What |
|---|---|---|
| 1 | `8cc9a311` | `loadItemsRequest.ts` — replace `JSON.parse(JSON.stringify(posProfile))` per-search deep clone with shallow spread; eliminates per-keystroke string duplication |
| 2 | `6f1f6296` | (cherry-pick from upstream `b5992f70`) `utils/debug.ts` opt-in `debugLog`; non-blocking boot via `setTimeout(…, 0)`; prop-driven dialogs for NewAddress/Mpesa |

**Files:** `frontend/src/posapp/stores/items/loadItemsRequest.ts`, `frontend/src/loader.ts`, `frontend/src/posapp/utils/debug.ts`, multiple component files (see commit body).

---

## L. Documentation + tooling (4 commits)

| Order | Hash | What |
|---|---|---|
| 1 | `031c1c56` | `scripts/heap_topnames.py`, `scripts/heap_strings.py`, `scripts/heap_components.py` (heap-snapshot triage tools) |
| 2 | `f1cbef7d` | `ARCHITECTURE.md` — system overview + boot sequence + store responsibilities + upstream branch comparison |
| 3 | `d794f191` | `AUDIT.md` — fork × upstream `b5992f70` reconciliation + agent-pipeline workflow guide |
| 4 | (this file) | `REGROUPED.md` — commit-by-area regrouping for future cherry-picks / rebases |

---

## Rebase strategy if you ever need it

Cleanest order if rebasing onto a fresh `upstream/develop`:

```
A (build hygiene) → C (store de-deepening) → D (watcher hygiene)
  → E (listener hygiene) → F (pricing) → G (search) → H (customer)
  → I (price-list re-pricing) → J (backend) → K (memory) → B (realtime)
  → L (docs)
```

Reasoning:
- A is independent and should be the foundation.
- C is the structural foundation everything else depends on.
- D + E reduce churn on top of C.
- F → G → H are the cart / customer perf trio; they assume D + E are in place.
- I depends on C's catalog shallow-ref.
- J + K are leaf nodes.
- B is the smallest, can land anywhere.
- L last (docs).

Each area can be a single squashed commit if you want a tighter history; the per-commit messages above carry enough context to recover the granular changes from the reflog.

---

## Audit follow-ups (already shipped, listed here for visibility)

After the second-opinion audit:

| Hash | Area | What |
|---|---|---|
| `c9789db6` | C | markRaw inverted-index Maps |
| `345a59c1` | F | timeout the server pricing fire-and-forget |
| `8eb19103` | G | bound retry term Map at 100 |
| `786d0a91` | G + I | gate lean merge by current price-list + generation-id chunk guard |
