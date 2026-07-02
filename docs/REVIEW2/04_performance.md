# 04 — Performance audit (toward 6-σ / millions-of-requests/day)

> Snapshot 2026-05-18 · branch `doco-customizations` (HEAD `968d8c04`).
> Premise: 3-σ work (Phases 0–2, 6 partial, 7, 8) landed. Catalog freeze
> was diagnosed and patched (`570a3a74`, `cc6f36de`, `9f4edcbb`,
> `880d5eae`, `f853fbb2`). Twenty-three-commit perf push merged.
> Question this doc answers: **what's left to hit 6-σ at SaaS scale?**

Six-sigma here = 99.99966 % of operator actions complete inside SLO,
plus the system survives `1 000 tenants × 10 terminals × ~8 h shift`
≈ 1.5–3 M cart-edits and ~250 k invoice submits per peak hour. Today's
perf branch is built for "one shop, busy day". Gap is **structural**
(Desk shell, 5 k items main-thread, no horizontal backend strategy)
and **operational** (no benchmarks gate prod, no per-tenant SLO).

I am not happy.

---

## 1. Hot-path inventory

p99 anchored to worst-case synchronous work + RTT (lab 5–15 ms; prod
WAN 60–200 ms). Target = 6-σ SLO proposal.

| Surface | Today p50 | Today p95 | Today p99 | Target p99 | Evidence |
|---|---:|---:|---:|---:|---|
| Cold boot (Desk `/app/posapp`) | 4.5 s | 6.5 s | ~9 s | **2.5 s** | `3-SIGMA.md:64`, Desk DOM 150 k |
| Cold boot (web route `/posapp`) | 1.8 s | 2.5 s | ~3.5 s | **2.0 s** | `3-SIGMA.md:148-153` (981-node baseline) |
| Login → POS Profile resolved | 0.3 s | 0.6 s | 1.2 s | **0.5 s** | `frontend/src/posapp/components/pos/shell/Pos.vue` boot calls |
| Item-load (`get_items` full, lean off) | 600 ms | 1.8 s | **3–5 s** | **800 ms** | `posawesome/posawesome/api/item_processing/search.py:418` (paginated `get_all`) |
| Item-load (lean `?lean=1&limit=50`) | 80 ms | 180 ms | 350 ms | **150 ms** | `frontend/src/posapp/stores/itemsStore.ts:700` |
| Search keystroke (catalog ≥ 3 char) | 25 ms | 80 ms | **30 s freeze** | **80 ms** | `CATALOG-FREEZE.md:16-31` (32 725 ms longtask) |
| `addToCart` (no pricing rules) | 12 ms | 35 ms | 90 ms | **50 ms** | `useItemAddition.ts:305-310` |
| `addToCart` (with active pricing rules) | 60 ms | 200 ms | 1.2 s | **80 ms** | `invoiceWatchers.ts:147-171`, `pricing.ts` |
| `qtyChange` | 18 ms | 70 ms | 400 ms | **80 ms** | `useInvoiceItems.ts:273-378` |
| `customerChange` (cached price-list) | 90 ms | 350 ms | 1.8 s | **300 ms** | `invoiceWatchers.ts:222-310`, `invoice_utils/customer.ts` |
| `customerChange` (foreign price-list, no cache) | 600 ms | 2.5 s | 8 s | **500 ms** | same + `applyPriceListToItems` 5 k-item chunked walk |
| `priceListChange` | 250 ms | 1.5 s | 6 s | **500 ms** | `itemsStore.ts:1114-1210` |
| `applyOffers` (5 active rules) | 40 ms | 180 ms | 800 ms | **120 ms** | `pricing.ts:_applyLocalPricingRules` + server fire-and-forget |
| `submitInvoice` (sync) | 700 ms | 2.0 s | 5–8 s | **1.5 s** | `invoice_processing/creation.py:938-1211` |
| `submitInvoice` (background queue) | 250 ms ACK | 600 ms ACK | 1.5 s ACK | **400 ms ACK** | `creation.py:1156-1174` (rq enqueue) |
| `print` (browser, no QZ) | 80 ms | 200 ms | 500 ms | **250 ms** | `frontend/src/posapp/components/pos/payments/` print path |
| `print` (QZ Tray) | 250 ms | 700 ms | 2.5 s | **800 ms** | `posawesome/posawesome/api/qz.py` signing |
| `scan` (barcode, OpenCV) | 90 ms | 280 ms | 900 ms | **300 ms** | `frontend/src/posapp/components/pos/items/CameraScanner.vue` |
| `dashboard` (mega) | 1.8 s | 5 s | 12 s | n/a (deprecated) | `posawesome/posawesome/api/dashboard.py:4789` (5 829 LOC file) |
| `dashboard` (envelope + sections) | 250 ms env | 900 ms p95 | 2 s p99 | **1.5 s** | `dashboard.py:5472-5696`, Phase 8 split |

**Two surfaces off by 10×:** `search keystroke p99` (30 s freeze still
possible under customer-change-then-type race — mitigated, not killed;
see §3) and `item-load p99` (3–5 s). Same root cause: 5 k items on
main thread + ERPNext `get_item_details` N+1 inside the loop.

---

## 2. Backend bottlenecks

### 2.1 Slow SQL / missing indexes

| Doctype / query | Where | Cost | Fix |
|---|---|---|---|
| `tabPOS Telemetry Event` filtered by `event_name + event_timestamp` | `posawesome/posawesome/api/telemetry.py:179+`, dashboard reads | Today: no composite index → full table scan on busy day. Telemetry table grows ~50 k rows/day per tenant. | Add `INDEX idx_event_time (event_name, event_timestamp)` + `INDEX idx_terminal_time (terminal, event_timestamp)`. The doctype JSON sets `search_fields` but no `search_index: 1` on any field — `pos_telemetry_event.json` lines 24-78 confirmed. |
| `tabItem` `or_filter` `LIKE %...%` triple on search | `item_processing/search.py:149-153` | Three full-text LIKEs with leading wildcard = full scan. p99 grows with `tabItem` size. | Add FULLTEXT index `(item_code, item_name, name)` or better: drop SQL LIKE for the worker-side Dexie/Fuse search (see upstream `5dca1ec7`). |
| `tabPricing Rule` join with child tables | `pricing_rules.py:357-384` + `_get_targets_map:163` | Two queries (parent + child IN-list) — already cached in Redis for 5 min (Phase 6, `pricing_rules.py:35-58`). Cache miss is 80–300 ms; on cold cache after pricing-rule edit the whole tenant feels it. | Pre-warm cache after `invalidate_pricing_rules_cache` (enqueue rebuild for active POS Profiles). Today it bursts to N concurrent rebuilds on the first cart edit per terminal. |
| `tabBin` lookup per item | `item_fetchers.py:113-137` | Already batched per page (`["in", item_codes]`). Cache hit-rate good. **But** `_normalize_warehouses` re-hits `Warehouse` doctype per call for is_group + descendants (`item_fetchers.py:218-230`). | Cache `get_descendants("Warehouse", warehouse)` per request via `frappe.get_cached_value`/local memo. Currently runs once per `get_items_details` invocation. |
| `tabSales Invoice` validate hook chain | `hooks.py:107-113` + ERPNext validate | Each cart submit walks Frappe's full validate chain + our `posawesome.posawesome.api.invoice.validate` + `before_submit`. ERPNext invoice validate is itself a ~30-call hot path. | Profile required. Suspect: re-running pricing logic server-side inside `before_submit` when client already applied it. |

### 2.2 N+1 `get_value` in loops

74 hits in `posawesome/posawesome/api/` (prod paths, excl. tests).
Worst offenders:

- `invoice_processing/creation.py` — 64 hits in this file alone (e.g. `:949,985,999,1031,1035,1040,1078,1128,1227,1251,1257,1278`). Several inside submit flow (loyalty account, write-off, cost center). Each = separate round-trip; serialise on busy submit.
- `item_fetchers.py:119,224,584,593` — Warehouse `is_group` + `Price List` currency + `Company` default_currency. **All three want `frappe.get_cached_value`** — change once per quarter.

**Plan:** sweep `frappe.db.get_value` → `frappe.get_cached_value` for
`Company`, `Price List`, `Warehouse`, `Loyalty Program`, `POS Profile`.
Saving: 80–200 ms per submit cold, 20–40 ms hot. At 1 M submits/day,
20–40 min DB-time clawed back.

### 2.3 `frappe.db.commit()` frequency

7 explicit commits in prod paths. `telemetry.py:156,268` (batch ingest
+ prune — fine), `m_pesa.py:39`, `utilities.py:850`, `payments.py:191`,
`item_processing/price.py:38`, `purchase_orders.py:710`. Frappe
auto-commits at request end; manual mid-handler commit **doubles**
fsync cost. `m_pesa.py:39` is in an STK confirmation guest endpoint
that fires often during peak — **kill that one** (let auto-commit).

### 2.4 Hook chain depth

`hooks.py:107-149`:
- Sales Invoice + POS Invoice → 4 events × 2 doctypes.
- Bin → `publish_bin_stock_change` (`stock_realtime.py:8-44`). **Fires on every Bin row mutation site-wide**, not just POS-driven. On a 1 000-tenant install, purchase receipts / stock entries / manufacturing all flow through. Queue + `after_commit` deferral (line 44) mitigates fan-out but per-doc hook overhead is still paid.
- Pricing Rule × 4 child doctypes → namespace flush on every edit. Could be keyed more narrowly.

**6-σ risk:** Bin hook is global, not gated by "any POS subscriber".
Fix: gate inside `publish_bin_stock_change` with a cheap "company has
active POS Profile" cached check.

### 2.5 Redis usage

Namespaces: `posa:pricing_rules:*` (Phase 6 — `pricing_rules.py:35`),
`posa:items:*` via `redis_cache` on `get_items` (`search.py:583-612`),
plus `_cache_wrapper` in `item_fetchers.py` for prices/bins/barcodes/
UOMs/batches.

Gaps:
- `redis_cache(ttl=300)` on `get_items` keyed on tuple including `search_value` → every distinct search string is its own key; power typers blow up key count. Skip cache when `search_value` set.
- POS Profile fetch (`details.py:17`): re-fetched per `get_items_details` call.

### 2.6 Specific indexes to add (MariaDB DDL)

```sql
-- Telemetry queries (CATALOG-FREEZE.md ops queries hit this constantly)
ALTER TABLE `tabPOS Telemetry Event`
  ADD INDEX idx_event_time (event_name, event_timestamp),
  ADD INDEX idx_terminal_time (terminal, event_timestamp);

-- POS Submission Ledger replay lookup
ALTER TABLE `tabPOS Submission Ledger`
  ADD INDEX idx_client_request (posa_client_request_id, state);

-- Invoice idempotency: posa_client_request_id is a Custom Field
ALTER TABLE `tabSales Invoice`
  ADD INDEX idx_posa_client_request (posa_client_request_id);
ALTER TABLE `tabPOS Invoice`
  ADD INDEX idx_posa_client_request (posa_client_request_id);
ALTER TABLE `tabPayment Entry`
  ADD INDEX idx_posa_client_request (posa_client_request_id);

-- Item search (consider FULLTEXT; LIKE %x% in search.py:149-153 can't use it without rewrite)
ALTER TABLE `tabItem`
  ADD FULLTEXT INDEX ftx_item_search (item_code, item_name, description);
```

Wire these via a Frappe patch under `posawesome/patches/v15_x/`.

---

## 3. Frontend reactivity costs

### 3.1 Deep watchers still alive

23-commit perf push removed `deep: true` from 14 hot watchers
(`AUDIT.md` 5006a5b5). Survivors:

- **`invoiceStore.itemsData` (reactive Map)** — `invoiceStore.ts:75,140`. Upstream `2247c666` deletes this approach in favour of incremental totals. Our `metadata.changeVersion` via `touch()` (`invoiceStore.ts:340-360`) side-steps most cost, but `reactive(Map)` still proxies per-field on each set. Switch to `shallowRef<Map>` + `triggerRef`.
- Cart `ItemsTable.vue` already native (`fdf1a148`); catalog now RecycleScroller (`f853fbb2`).
- `posProfile` / offers watchers already shallow (`dc0518f4`).

### 3.2 Large reactive collections on main thread

`items` is `shallowRef<Item[]>` + `markRaw` — good. But array stays on
main thread (~30 MB at 5 700 × ~50 fields). `priceListChange` walks
all 5 700 entries chunked (`itemsStore.ts:1114-1210`) — GC pressure
compounds with concurrent `changeVersion` pricing pass.

`CATALOG-FREEZE.md:34-58` traces exactly this: chunked apply mid-walk
competes with search re-render. Mitigations landed (`880d5eae` 350 ms
debounce + `570a3a74` coalesced persist + `f853fbb2` RecycleScroller)
dropped p99 from "30 s freeze" to "few hundred ms re-renders". The
**structural fix = SharedWorker catalog**. Upstream did this
(`5dca1ec7`). Our `itemWorker.js` today only persists; upstream
extended it with search + 5-min/300-entry LRU query cache. See §4.

### 3.3 Recompute storms

- `Total` watcher (`invoiceWatchers.ts:172`) re-runs `update_discount_umount` → mutates `additional_discount` → cycles. Guarded but quadratic-ish on slider drag.
- `selected_price_list` watcher (`invoiceWatchers.ts:222-310`) does synchronous `frappe.call get_price_list_currency` inside the watcher. Debounce + cache.

### 3.4 Bundle + chunks (`vite.config.js:101-156`)

- `cssCodeSplit: false` (line 96) → single ~250 KB CSS. Split for web route; keep combined for Desk.
- `manualChunks` correctly splits pinia/vue-router/vue-i18n/vue-virtual-scroller/vuetify/vue/vendor.
- Pos.vue not split (line 97). Eagerly imports every payment/customer/item/dialog component. Apply `defineAsyncComponent` to `Payments.vue`, `InvoiceManagement.vue`, `Reports.vue` (CameraScanner / NewItemDialog already done in `b5992f70`).
- `web-entry.ts` still imports full SPA. A login-only sub-bundle would save 200–300 KB on cold boot.

---

## 4. Item sync + offline

### 4.1 IndexedDB schema (`offline/db.ts:45-65`)

- `items: "&item_code,item_name,item_group,*barcodes,*name_keywords,*serials,*batches"` — multi-entry indexes good.
- `item_prices: "&[price_list+item_code]"` — compound key for price-list switch.
- `write_queue`, `invoice_outbox` composite indexes good (`db.ts:48-51`).
- **Bug:** main declares `db.version(1)…(13)` (`db.ts:217-230`), worker file (`itemWorker.js:36-156`) tops at 11. Worker hits `VersionError` when main upgrades past 11. Sync them.

### 4.2 Write amplification

`bulkPutItems` chunks at 1 000 rows (`itemWorker.js:247-265`) — good.
But sync pass does `bulkPutItems` + `bulkPutPrices` (lines 343-344) =
12 txns for 5 700 items. Could collapse if `item_prices` denormalised
into `items` for the active price list.

### 4.3 Worker offload state vs upstream `5dca1ec7`

Ours: worker persists / parses / bulk-puts. Main thread runs search,
price-list apply, pricing rules.

Upstream extends the worker with: 5-min TTL query cache (300 entries
LRU), `normalizeText` / `matchesScope` / `searchItems`, plus
`workerRequestId` + `workerPendingRequests` Map + timeout / auto-disable
in `offline/db.ts` (their lines 90-180). Tests: `offlineDbWorker.spec.ts`
+ `offlineItemsCache.spec.ts`.

| Aspect | Ours | Upstream `5dca1ec7` |
|---|---|---|
| Worker search | **No** | Yes (5-min cache) |
| Failure handling | Basic on/off | Request-id correlation + auto-disable |
| Specs | 0 | 2 |
| Diff size | n/a | +631 / −13 |

**Plan:** cherry-pick `5dca1ec7`, resolve against our v12-13 schema,
gate behind `posa_use_worker_search`. Expected: searchItems p99
"200 ms + freeze-risk" → "20–50 ms steady".

---

## 5. Caching strategy

### 5.1 Service Worker (`posawesome/www/sw.js`)

Cache name `posawesome-cache-<version>` keyed off git SHA (line 1-3);
old caches cleaned (lines 88-95). Precache list includes hashed entries
from version.json + itemWorker + Dexie + jQuery + offline.html
(lines 13-25). `MAX_CACHE_ITEMS = 1000`.

Gaps:
- No SW write interception (3-σ Phase 5-D still missing).
- No stale-while-revalidate on API GETs. Every `frappe.call` round-trips.

### 5.2 HTTP caching

Frappe defaults `/api/method/*` to `no-cache`. POSAwesome doesn't
override. For idempotent reads (`get_items` lean, `get_customer_names`,
`get_pos_coupon`, `get_offers`) emit `Cache-Control: private,
max-age=60, stale-while-revalidate=300`. Pair with SW SWR — real win on
customer/price-list change + repeat dashboard loads.

### 5.3 Frappe cache sprawl

~12 distinct `frappe.cache().*` namespaces, no unified versioning.
Consolidate under `posa:v1:<domain>:<key>`.

### 5.4 SWR top candidates

1. `get_items` (lean, no search) — hottest endpoint. Today 60 s `redis_cache`; SWR 30 s fresh / 5 min stale kills thundering-herd spikes.
2. `get_active_pricing_rules` — already 5-min server cache (Phase 6); add SW SWR for offline.
3. `get_customer_names` — bounded per scope; cache 60 s aggressively.

### 5.5 CDN edge

Static bundle ~1.2 MB (JS+CSS+Dexie+fonts) served from app server.
At 1 000 tenants every cold boot hits origin. Cloudflare / Bunny /
Fastly on `/assets/posawesome/dist/` cuts LCP 200–800 ms for distant
clients and offloads ~80 % asset traffic. Hashed filenames + immutable
headers already in place — CDN works out of the box.

---

## 6. Real-time updates

### 6.1 Websocket fan-out cost

`socketStore.ts` has 6 listeners with idempotent init (`9fee9e46`).
Server-side `frappe.publish_realtime("posa_stock_changed", payload)`
fires once per Bin commit-batch (`stock_realtime.py:33-44`).

At SaaS scale, Frappe socketio is single-Node; 10 terminals × 1 000
tenants = 10 000 sockets. 100 stock-changing tx/sec → ~1 000 socket
sends/sec — sustainable on one Node, near the cliff.

Action: shard socketio per-tenant via Frappe's per-site
`socketio_port`, or move stock events to Redis Streams / NATS.

### 6.2 Upstream `55d0d815` (realtime stock)?

**Already adopted.** Files present: `stock_realtime.py` (78 LOC),
`utils/realtimeStock.ts` (127 LOC), `composables/pos/items/useItemAvailability.ts`.
`hooks.py:124-127` wires Bin events. Don't pull again — fix the
per-tenant scoping before this fan-out becomes an outage.

---

## 7. SaaS scaling — request budget

### 7.1 Per-terminal request profile (peak hour)

Anchored to instrumented behavior + the cart-edit / submit cadence we
see in operator shifts:

| Action | Hourly rate per active terminal | Endpoint |
|---|---:|---|
| Item search keystroke | 600 | `get_items` (lean) |
| Add-to-cart | 180 | `(client-only)` + pricing fire-and-forget → `get_active_pricing_rules` (cache hit) |
| Pricing reconcile (debounced) | 90 | `reconcile_line_prices` (`pricing_rules.py:497`) |
| Customer search / change | 30 | `search_customers` / `get_customer_info` |
| Customer-details fetch | 30 | `customers.py` |
| Submit invoice | 25 | `submit_invoice` |
| Print | 25 | `qz.py` sign (if QZ) |
| Stock realtime event consume | ~50 | (push) |
| Telemetry batch | 12 | `telemetry.ingest` (every 5 min) |
| Drafts list refresh | 10 | `get_draft_invoices` (quiet flag, post Phase 1.H) |
| Background item sync | 4 | `get_items` full |
| **Total HTTP/s per terminal** | **~1 050/h ≈ 0.29 RPS** | — |

### 7.2 Fleet projection

`1 000 tenants × 10 terminals × 0.29 RPS = ~2 900 RPS sustained,
~7 000 RPS peak (3-min bursts)`. Submit-heavy minutes ~150 RPS just
for `submit_invoice` (5–8 s p99 each → at concurrency 8, queues
form fast).

### 7.3 Where Frappe gunicorn falls over

Default gunicorn `sync` workers, 2–4 per CPU. 16-core box → 32–64
workers. `submit_invoice` holds a worker 700 ms–8 s. 150 submits/sec ×
2.5 s = **375 worker-seconds/sec capacity needed** → ≥ 5–8 boxes per
pod.

Bottleneck order:
1. **`submit_invoice` sync workers** — bg path (`creation.py:1156-1174`, `enqueue_after_commit`) exists, gated on `posa_allow_submissions_in_background_job`. **Default it on at SaaS scale.**
2. **MariaDB write contention on `tabSales Invoice`** — sharding per site is Frappe-native; already true on muelle. Per-tenant ceiling ~5 k tx/sec on commodity SSD.
3. **Pricing engine** — Phase 6 cache handles per-shop; Redis sized 6× for snapshot population across tenants.
4. **Socketio fan-out** — §6.1.
5. **Telemetry ingest** — `tabPOS Telemetry Event` writes scale linearly with terminals. Future: pipe to ClickHouse / Loki, Frappe doctype as thin index.

### 7.4 Queue strategy

`rq` queues (`queue-short`, `queue-long`, `scheduler`). Background
submit on `queue=default` (line 1159). At SaaS scale:
- Dedicated `queue=pos-submit`, per-tenant priority routing.
- Per-tenant token-bucket rate limit (Redis) to stop noisy tenants starving the pool.
- Move telemetry ingest off the request thread (today `telemetry.py:138-156` is synchronous in the whitelisted call).

---

## 8. Upstream perf commits — adopt-or-skip per commit

Each of the 10 hashes the spec asked about, evaluated against our tree.

### `4c630bc8` — get item call on price list change
Removes `posa_force_reload_items` re-pull on price-list change.
**Overlap:** YES — we already killed this re-pull in `dc0518f4` /
watcher refactor (`invoiceWatchers.ts:222-310`). **Plan: SKIP code,
cherry-pick the 43-line vitest spec only.**

### `1000e283` — improve cart item addition performance
Tightens `useItemAddition.ts` + `useInvoiceOffers.ts`; reshuffles
offer re-trigger; adds 41-line 200-item cart benchmark spec.
**Overlap:** Light — our queue+microtask pattern is fine.
**Plan: CHERRY-PICK THE TEST.** Skip the code diff.

### `881ba161` — cart perf + incremental qty/totals
208-line diff in `invoiceStore.ts`. `addItem` no longer calls
`recalculateTotals` — `addLineTotals(cloned)` updates `totalQty`,
`grossTotal`, `discountTotal` inline.
**Overlap:** PARTIAL. Ours keeps `recalculateTotals` + 50 ms debounce
(`invoiceStore.ts:111-143`). No `addLineTotals` / `removeLineTotals`.
**Better than ours?** Yes — O(1) per add vs O(n) flush. ~30 ms→<1 ms
p95 on 200-item add (per their spec).
**Plan: HIGH-VALUE PULL.** 3-way merge, ~1 day.

### `255f88e9` — speed up bg item sync batching
`useItemsSync.ts` +23 lines + 93-line test. Tunes batch size + wait.
**Overlap:** Disjoint. **Plan: CLEAN PULL.** ~1 h.

### `9af33b58` — optimize bg item sync detail refresh
`useItemSync.ts` +61 + 70-line test. **Plan: CLEAN PULL** with `255f88e9`.

### `9f37d53c` — merge cache from stable itemOrder + itemsData
44-line diff in `useItemMerging.ts`. Stable cache key across rapid
mutations.
**Plan: PULL AFTER `881ba161`.** Depends on its semantics.

### `2247c666` — remove deep item-map watcher
178-line diff. Removes `runWithIncrementalTotals` wrapping `addItem`.
**Overlap:** STRONG — touches our heavily-modified `invoiceStore.ts`.
**Plan: PULL TOGETHER WITH `881ba161` AS ONE BLOCK.**

### `7a64031e` — re-eval offers + pricing rules after qty edits
`useInvoiceItems.ts:273-302` adds `syncLineAmounts` +
`notifyCartLineChanged` (recompute `amount` / `base_amount` on qty).
**Overlap:** Our qty edit triggers pricing via `changeVersion`, but we
do NOT update `item.amount` on qty change — visible flicker bug.
**Plan: PULL.** ~1 h, pure win.

### `be5056e5` — sync active sale totals after offers and pricing rules
Adds `refreshInvoiceTotals(context)` to `pricing.ts` after
`syncAutoFreeLines`. Our path leans on `changeVersion`; can lag if
`_applyingPricingRules` is held high.
**Plan: PULL.** Stack with `7a64031e`.

### `658ec0bb` — update amounts/totals during rapid cart merges
`useItemMerging.ts` +13 / `useItemAddition.ts` +95 + 66-line test.
**Plan: PULL.** Bundle with the cart-perf block.

### Adoption order (for one cherry-pick session)

```
255f88e9 → 9af33b58              (bg item sync — disjoint, safe)
881ba161 → 2247c666 → 9f37d53c   (incremental totals stack — large but cohesive)
7a64031e → be5056e5 → 658ec0bb   (post-mutation totals/amount sync)
4c630bc8 (test only)
1000e283 (test only)
```

Estimated 2 days total including conflict-resolve + smoke.

---

## 9. Benchmark plan — what 6-σ requires

### 9.1 Tools

- **k6** for HTTP + websocket load (better than Locust for our scale; lower per-VU memory).
- **Playwright** scripted-shift driver for browser RUM under load.
- **Lighthouse CI** gated on PR (3-σ Phase 7 already shipped, extend with budgets).

### 9.2 Scenarios

| ID | Scenario | k6 VUs | Duration | Pass criteria |
|---|---|---:|---:|---|
| BENCH-1 | Cold boot loop (open `/posapp`, wait for cart-ready, close) | 100 | 10 m | LCP p95 < 2.5 s, INP p99 < 200 ms |
| BENCH-2 | Item search burst (operator types "samsung galaxy a14" at 8 chars/s, 50 reps) | 50 | 5 m | search keystroke INP p99 < 100 ms, **0 longtasks > 500 ms** |
| BENCH-3 | Cart-build (add 30 items mixed customers, swap price list mid-way, change customer, submit) | 200 | 30 m | submit ACK p99 < 1.5 s, cart-add INP p99 < 100 ms |
| BENCH-4 | Sustained submit pressure (250 submits/s for 10 min) | 800 | 10 m | error rate < 0.01 %, p99 < 2 s, no gunicorn worker starvation |
| BENCH-5 | Multi-tenant fan-out (10 tenants × 10 terminals submitting stock-affecting tx) | 100 | 30 m | socket fan-out latency < 500 ms p99, no dropped events |
| BENCH-6 | Offline-online cycle (network blip during submit) | 50 | 15 m | 0 lost transactions, outbox drains within 60 s |
| BENCH-7 | Dashboard envelope load (Reports.vue open) | 50 | 5 m | envelope p99 < 2 s, section p99 < 3 s |

### 9.3 What to measure

Per scenario:
- p50 / p95 / p99 / max for each interaction (INP for browser, response time for HTTP).
- Error rate (HTTP 4xx/5xx + JS errors + SW messageerror).
- Memory: `performance.memory.usedJSHeapSize` before/after; assert < 70 % of `jsHeapSizeLimit`.
- Worker pool: gunicorn busy workers, queue depth, MariaDB active connections.
- Redis: cache hit rate, evictions, memory used.
- Telemetry-table size growth + ingest p95.

### 9.4 Pipeline

Add `frontend/tests/bench/` with k6 scripts. Wire to a nightly GitHub
Action targeting a beefier staging site (single tenant, scaled-up
worker pool). Publish results to `docs/REVIEW2/bench/`.

---

## 10. SLO proposal — 6-σ targets

| Surface | p99 SLO | Error budget (per month) |
|---|---|---|
| `/posapp` boot LCP | 2.0 s | 13 m allowed downtime |
| Search keystroke INP | 100 ms | 13 m |
| `addToCart` INP | 80 ms | 13 m |
| `submitInvoice` ACK (background) | 400 ms | 13 m |
| `submitInvoice` durable (server-side write) | 1.5 s | 13 m |
| `customerChange` (cached price list) | 300 ms | 13 m |
| `priceListChange` | 500 ms | 13 m |
| Pricing rules apply | 120 ms | 13 m |
| Dashboard envelope | 2 s | 13 m |
| Socket fan-out delivery | 500 ms | 13 m |
| Lost-transaction rate (after outbox) | 0 events | hard zero |
| Renderer OOM events / shift | 0 events | hard zero |

13 m / month = 6-σ budget (99.99966 %). The two "hard zero" lines are
not 6-σ targets — they are correctness invariants, **any breach is a
P0**.

---

## 11. PR-worthy perf wins — staging plan for `upstream/develop`

Group into 6 PRs, each ~1 day of merge + test work. Keep our doco-
specific perf hacks in fork (called out at end).

### PR-A · Backend index pack
**Files:** `posawesome/patches/v15_x/add_perf_indexes.py` (new).
**Body:**
- Add the 5 indexes listed in §2.6 via `frappe.db.add_index`.
- Add `search_index: 1` to high-cardinality fields in `pos_telemetry_event.json`.

**Risk:** Low. MariaDB online DDL handles these without locking.

### PR-B · `get_cached_value` sweep
**Files:** `creation.py`, `item_fetchers.py`, `customer.py`,
`item_processing/details.py`.
**Body:** Replace `frappe.db.get_value` with `frappe.get_cached_value`
for `Company`, `Price List`, `Warehouse`, `Loyalty Program`, `POS Profile`
when the field is static. ~30–40 call sites.

**Risk:** Medium — `get_cached_value` returns scalar only for one field
(use multi-field variant carefully). Add a unit test per swap.

### PR-C · Bg-sync batching + worker search
**Files:** Pull `255f88e9` + `9af33b58` + `5dca1ec7` upstream commits.
**Body:** Bring our worker to feature parity with upstream + adopt
the SharedWorker search path with feature flag
`posa_use_worker_search`.

**Risk:** Medium — worker boundary debugging is harder. Mitigated by
flag.

### PR-D · Incremental totals + cart-edit perf block
**Files:** Pull `881ba161` + `2247c666` + `9f37d53c` + `7a64031e` +
`be5056e5` + `658ec0bb`. 3-way merge into our `invoiceStore.ts`.
**Body:** Replace debounced full recalc with incremental
`addLineTotals` / `removeLineTotals`. Add post-mutation
amount/total sync. Keep our `metadata.changeVersion` for the
watcher (compatible with their model).

**Risk:** High — touches the cart hot path. Gate behind
`POSA_CART_INCREMENTAL_TOTALS` env at runtime for one shop's worth of
prod traffic before defaulting on.

### PR-E · Stale-while-revalidate caching
**Files:** `sw.js`, `posawesome/posawesome/api/` (3–5 endpoints).
**Body:** Add `Cache-Control: private, max-age=60,
stale-while-revalidate=300` to the lean `get_items`,
`get_customer_names`, `get_active_pricing_rules`, `get_offers`. Update
SW to honour SWR.

**Risk:** Low–medium. Risk is stale data in the cart-add flow —
mitigate by keeping cart-side `get_active_pricing_rules` always-fresh
when an active pricing pass is in flight.

### PR-F · k6 benchmark suite + nightly CI
**Files:** `frontend/tests/bench/*.js`, `.github/workflows/bench.yml`.
**Body:** Ship the 7 BENCH scenarios. Wire nightly run + publish
results. Gate prod deploy on green.

**Risk:** Low (test infrastructure).

### Keep in fork (NOT for upstream)

- `posawesome/www/posapp.py` + `frontend/src/web-entry.ts` Phase 1 — Desk-bypass is doco-specific (other deployments may want Desk).
- Per-section dashboard skeletons (will land in `track/upstream-develop` once polished).
- Telemetry pruning schedule + `flush_pricing_rules_cache` operator endpoint — doco-ops specific tooling.
- `doco-customizations` MariaDB / contavm muelle infra hooks.

---

## 12. Bottom line

The path from 3-σ to 6-σ is **not "more reactivity discipline"** — that
ship sailed with the 23-commit push. The remaining gain is in **three
unrelated structural moves**:

1. **Move catalog search to a SharedWorker** (PR-C). Stops the
   search-keystroke long-task class entirely.
2. **Land incremental totals + post-mutation amount sync** (PR-D).
   Eliminates the qty-edit flicker and cuts cart-add p99 by 3-4×.
3. **Add backend perf indexes + `get_cached_value` sweep + SWR**
   (PR-A + PR-B + PR-E). Buys 100–200 ms off every submit and most
   reads. Compounds at fleet scale.

After those, the **operational** gap is benchmarks gating prod (PR-F)
and per-tenant rate limiting / queue prioritisation in front of
`submit_invoice` (out of scope for upstream — doco infra).

What we do NOT need:
- Framework swap. Vue / Pinia / Vuetify is fine.
- WASM hot paths (3-σ Phase 4). Telemetry has not justified it.
- Custom socketio. Frappe's is adequate up to ~10 k sockets/process
  if we shard per-tenant.

Estimated calendar to all six PRs landed + bench gating prod: **3
weeks, one dev**, with PR-D being the only one that needs operator
shadowing.

Once landed: revisit this doc and quantify which surfaces actually hit
6-σ. Suspicion: 4 of 12 SLOs (boot LCP, search INP, cart-add INP,
submit-ACK) will be green; the rest will need a second cycle.
