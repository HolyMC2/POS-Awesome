# POSAwesome Roadmap

Snapshot 2026-05-10 · branch `track/upstream-develop` (defendicon `15.29.0` + 5 perf commits already shipped).

Compiled from 4 parallel audits: **security**, **code review**, **performance**, **opportunities**. Each finding carries `file:line` so anyone can jump straight to the diff.

Already shipped on this branch (do NOT re-do):

| Hash | Change |
|---|---|
| `610133f1` | Background sync pauses while tab hidden + visibility catch-up + interval floor 30s/60s default |
| `10246649` | Search server-fallback when local IDB returns 0 for ≥3-char query |
| `33889855` | Fallback hardened — guard against full-catalog reload freeze |
| `4072a5af` | `defineAsyncComponent` for CameraScanner / NewItemDialog / ItemSettingsDialog / ScanErrorDialog |
| `6db56506` | In-page PerfBadge (heap MB / fps / DOM nodes / last-sync age), enable via `localStorage.posa_perf_badge=1` |
| `78750236` | Realtime: seed `serverOnline` from current socket state on mount (kills stuck "Limited connectivity" banner) |
| `d477e21f` | Hash entry filenames + read assets from `version.json` (cure for post-deploy `_s undefined` Pinia crash) |

---

## Tier 0 — Shipped 2026-05-10

Bundled in commit `posa-tier0` on `perf/upstream-develop-tweaks`.

- [x] `api/invoice.py:341` — stray `continue` killed `posa_tax_inclusive`. Nested under the `Actual` branch (Actual taxes must never be inclusive; the rest now honour the flag).
- [x] `CartItemRow.vue:484` — removed `console.log` from inside `memoDeps` `computed()`.
- [x] `Invoice.vue:654` — removed `this.$forceUpdate()` from `updatePostingDate`.
- [~] `vite.config.js:70` — `cssCodeSplit: false` flip **deferred to Tier 3**. The runtime CSS injection in `loader.ts` (single `<link id="posa-posapp-css">` from `assets.css`) cannot pick up per-chunk stylesheets. Re-tackle alongside the SW cache-first rework that already touches `loader.ts`.
- [x] `vite.config.js` build version — replaced `Date.now()` with `git rev-parse --short=12 HEAD`, falls back to timestamp outside a checkout.
- [x] `vite.config.js` `manualChunks` — per-package matchers for pinia / vue-router / vue-virtual-scroller / vue-i18n. Eager `vue` chunk shrank 339 kB → 79 kB.
- [x] `vite.config.js` esbuild — `drop: ["debugger"]` + `pure: ["console.log","console.debug","console.trace"]` (warn/error kept).
- [x] `useDatabaseStats.ts:34`, `useServerStats.ts:57`, `useUpdateChecks.ts:33` — `visibilitychange` pause/resume per `useItemSync` pattern. `Navbar.vue:327-349` was a watcher block, not a `setInterval` — only `setInterval` in Navbar is a 5 s self-clearing wait for `frappe`. No fix needed.

---

## Tier 1 — Critical security blockers (this week, ≤ 8 hours)

Same fix pattern across most: `frappe.has_permission(doctype, action, doc, throw=True)` + verify `pos_profile` belongs to caller's open shift + drop `flags.ignore_permissions=True` on user-scoped writes.

| # | Severity | File:Line | Issue | Fix |
|---|---|---|---|---|
| S1 | Critical | `api/invoices.py:121, 181` | `delete_invoice` / `delete_sales_invoice` — any cashier deletes any invoice by name with `force=1` | perm-check, also reject submitted invoices |
| S2 | Critical | `api/quotations.py:115, 134` | `update_quotation` / `submit_quotation` — overwrites + submits any Quotation, `ignore_permissions=True` + `ignore_account_permission=True` | validate `pos_profile` membership, drop the bypass flags, whitelist mutable fields |
| S3 | Critical | `api/sales_orders.py:86, 139` | `update_sales_order` / `submit_sales_order` — same JSON-overwrite pattern; `_payment_entry_job` enqueued without idempotency → double Payment Entries on retry | perm-check + idempotency token + DB-unique on (SO, client_request_id) |
| S4 | Critical | `api/cash_movement/service.py:188-216` | `cancel_cash_movement` / `delete_cash_movement` — only role-check, no doc-binding | bind to caller's open shift; perm-check |
| S5 | Critical | `api/employees.py:151, 199` | PIN compared with `==` (timing); no rate-limit; cashier on same profile can rewrite another cashier's PIN if they know `current_pin` | `hmac.compare_digest`; lockout counter on User; require POS Supervisor for cross-user PIN reset |
| S6 | Critical | `api/m_pesa.py:20-45` | `confirmation` is `allow_guest=True`, inserts `Mpesa Payment Register` from arbitrary POSTed fields | Safaricom IP allowlist OR HMAC; reject unknown `BusinessShortCode` |
| S7 | Critical | `api/qz.py:56, 85` | `get_certificate` returns site QZ public cert + `sign_message` does RSA-PKCS1v15-SHA512 on caller-supplied bytes — full signing oracle | role-gate; require nonce + structural validation that message is a QZ print job |
| S8 | Critical | `api/customers.py:147, 236, 407` + `api/customer.py:69` | Any auth'd user fetches full PII (mobile, email, tax_id, address, balance) + can update any Customer by name | scope to profile's `customer_groups`; require write perm |
| S9 | Critical | `Customer.vue:83-95`, `PaymentAdditionalInfo.vue:54-84` | `v-html` on `email_id`, `address_line1`, `mobile_no`, etc. — stored XSS via Customer/Address | `v-html` → `{{ }}` interpolation across all hits (also `DeliveryCharges.vue:28`, `PosOffers.vue:48`) |
| S10 | Critical | `invoice_processing/creation.py:712-935` | `update_invoice` sets `flags.ignore_permissions = True` + `frappe.flags.ignore_account_permission = True`; `pos_profile` from payload, not caller's shift | derive `pos_profile` from caller's open shift; drop both bypass flags |

**High-impact mediums** (bundle into Tier 1 PR):

- `api/utilities.py:62-74` — `subprocess(... shell=True)` with f-string interpolation. Future command-injection sink. Use list args + `cwd=`.
- `api/utilities.py:488-572` (`get_database_usage`) + `:575-612` (`get_server_usage`) + `:362-397` (`get_remote_update_info`) — leak DB engine, version, table sizes, server CPU/RAM. **Restrict to System Manager.**
- `api/shifts.py:13-56` — `get_opening_dialog_data` returns Sales Invoice Payment with `fields=["*"]`, `ignore_permissions=True` → leaks payment-method secrets across profiles. **Drop bypass; restrict fields.**

---

## Tier 2 — Code-correctness / data integrity (this week)

| # | Severity | File:Line | Issue | Fix |
|---|---|---|---|---|
| C1 | High | `invoice_processing/creation.py:368-378` | `_mark_ledger_failed` runs DB writes after `frappe.db.rollback()`; later exceptions roll those back too | wrap in `frappe.db.savepoint()`, or write ledger via fresh transaction |
| C2 | High | `hooks.py:124-127` | `Bin.after_insert` + `on_update` push to `frappe.flags._posa_stock_change_queue` with no doc-flag guard; on stock recon / reposting the queue grows unbounded in memory | cap queue size, clear on `before_request`, or move to `on_change` only |
| C3 | High | `frontend/src/offline/db.ts:215-230` | Dexie schema declared at versions `1, 7-13` (gaps `2-6`); intermediate-version clients hit `VersionError` | declare only the versions actually shipped, or guard with `clearAllCache` for corrupt DBs |
| C4 | High | `frontend/src/offline/db.ts:362-408` | `initPromise` runs inside `requestIdleCallback`; readers race and get default values instead of persisted ones | fire eagerly (microtask) and have all readers `await initPromise` |
| C5 | High | `frontend/src/offline/db.ts:610` | `localStorage.setItem` is wrapped in try/catch; `persistWorker.postMessage` (line 593) is not — `DataCloneError` silently kills the worker | wrap `postMessage`; fall back to main-thread persist |
| C6 | High | `api/customers.py:91` | `@redis_cache(ttl=...)` keyed on the full `pos_profile` JSON string — cache effectively never hits | key on `(profile_name, profile_modified)` |
| C7 | High | `api/customers.py:300` | `customer.save()` after-insert without `ignore_permissions`; whitelisted POS user without Customer-write rights gets 403 mid-checkout | add `customer.flags.ignore_permissions = True` |
| C8 | High | `composables/pos/items/useScannerInput.ts:484-501` | Keyboard-scan setTimeout reads `keyboardScanPendingValue` via closure; fast typing during slow render fires `onBarcodeScanned` with stale code | snapshot value via `ref` inside the timeout, compare with current before firing |
| C9 | Medium | `api/invoice.py:84-85` | `je_doc.cancel()` loop, no per-iter savepoint — entry 3 of 5 fails leaves entries 1-2 cancelled, exception aborts loop | savepoint per JE; collect failures and report at end |
| C10 | Medium | `api/customer.py:46-49` | `create_gift_coupon` runs in `after_insert` without try/except — coupon-doctype validation throw blocks all customer inserts (incl. offline-sync) | wrap in try/except + `frappe.log_error`; coupon creation is best-effort |
| C11 | Medium | `composables/pos/items/useItemsIntegration.ts:84` | `searchTimeout` is module-closure scoped — multiple ItemsSelector mounts share + clobber the timer | move inside the function body; per-instance |
| C12 | Medium | `api/payments.py:191` | `frappe.db.commit()` mid-transaction in Shopping Cart branch leaves PR creation half-committed if `pr.get_payment_url()` raises after | move commit after URL is computed, or use `on_commit` hook |
| C13 | Medium | `api/utilities.py` (30+ sites) | Bare `except Exception:` returning empty dict/string masks DB outages, corrupted git refs, etc. | always `frappe.log_error` in except; narrow exception types |
| C14 | Low | `frontend/src/sw-updater.ts:397` | `setTimeout(reload, 50)` after `decision.reloadWindow` — two SW version messages can reload-loop | `hasReloaded` flag; ignore subsequent decisions |
| C15 | Low | `api/items.py:215-218` | `build_item_cache(item_code)` body is `pass`, no callers | delete or implement |
| C16 | Low | `frontend/src/offline/db.ts:670-671` | `clearAllCache` does `db.close → Dexie.delete → db.open`; if `Dexie.delete` rejects (locked by other tab) DB stays closed | reopen DB on error |

---

## Tier 3 — Mobile perf, beyond the 5 already shipped

Highest-leverage on Moto E15 (Cortex-A55, 4 GB).

**Biggest single win** — kill per-item Vue Proxy on the items store:

- [ ] **`stores/itemsStore.ts:102-103`** — items + filteredItems use `ref([])`; thousands of items become deep Proxies with per-property dep tracking. **Switch to `shallowRef([])` + `markRaw(item)` on insert.** Mutate via reassignment, not in-place. ~1-2 days, **eliminates the GC pressure that dominates on Cortex-A55**.
- [ ] `stores/itemsStore.ts:264, 1100, 1108` — `items.value = [...items.value, ...additions]` rebuilds the entire reactive array per background-sync chunk. **Switch to `.push(...additions)` + `triggerRef`** (depends on the `shallowRef` change).
- [ ] `composables/pos/items/store/useItemsSearch.ts:41,46,52` — `itemsMap`/`barcodeIndex` are `ref(new Map())`; every `.set()` triggers store-level reactivity → fan-out re-renders. **`shallowRef(new Map())` + `triggerRef` once per batch, or `markRaw` the Maps.**
- [ ] `composables/pos/items/useItemDetailFetcher.ts:319-672` — `update_items_details` mutates each item via `Object.assign`; with page=200 that's 200 × 8 trigger fires per refresh. **Combined with #3 above** — with `markRaw(item)` these become free.

**Pos.vue eager dialogs** (statically imported + always mounted):

- [ ] `Pos.vue:7-13, 205-217` — `Drafts`, `InvoiceManagement` (3190 lines), `SalesOrders`, `Returns`, `NewAddress`, `MpesaPayments`, `Variants` all eager-loaded. Adds 5-7k lines of script setup + watchers + DOM at first paint. **Wrap in `defineAsyncComponent` + `v-if` on flow open** (same pattern we used for CameraScanner).

**Per-row re-render cost**:

- [ ] `ItemsSelectorTable.vue:3` — `<v-data-table-virtual>` re-evaluates the column slot per visible row per reactive tick. **Add `v-memo="[item.item_code, item.rate, item.actual_qty, selectedCurrency]"`; pre-compute `displayRate` per row.**
- [ ] `ItemCard.vue:94-144` — 5 `computed`s per card × N visible cards in `RecycleScroller`. **Memoise via `v-memo` on the root.**
- [ ] `Invoice.vue:950-973` — two `$watch` with `{ deep: true, immediate: true }` on `uiStore.posProfile` and `uiStore.offers` (100+ keys each). **Watch only the consumed keys.**
- [ ] `CartItemRow.vue:458-491` — `memoDeps` includes 18 fields, joins `visibleColumns.map(...)` per tick. **Pre-compute `visibleColumnsKey` in parent, trim deps.**

**Service worker / network**:

- [ ] `posawesome/www/sw.js:222-288` — network-first on every asset; on flaky LTE adds 1-3 s per JS chunk. **Switch hashed `/assets/posawesome/dist/...` URLs to cache-first** (cache.match → network fallback).
- [ ] `useItemDetailFetcher.ts:160-167, 663-665` — exponential-retry timers stack across searches (no key/dedupe). **Track latest `affectedKey`; cancel stale retry.**

**OpenCV scanner — moderate-risk refactor**:

- [ ] `CameraScanner.vue:350-351` — `getImageData / putImageData` runs OpenCV postprocessing on the main thread. Each 4 MP frame is ~16 MB memcpy on Cortex-A55. **Move to `opencvWorker.js` with `OffscreenCanvas` or transferred ImageData.** Risky-refactor.
- [ ] `CameraScanner.vue:725` — `destroy()` only on `onBeforeUnmount`; reused worker may leak `cv.Mat`. **Per-session `cleanupMats()` + `MediaStream.getTracks().forEach(t.stop())` in `stopScanning`.**

**Smaller cleanups**:

- [ ] `stores/itemsStore.ts:249, 266, 804, 1012` — `updateIndexes(items, posProfile)` rebuilds `_search_index` for every item every load, even when only 50 were appended. **Pass only the new chunk.**
- [ ] `composables/pos/items/useItemsIntegration.ts:239-257` — three `watch()` callers do nothing but `console.log/debug` in production builds. **Gate behind `import.meta.env.DEV`.**
- [ ] `composables/pos/items/useItemSync.ts:330` — `bindVisibilityListener` adds a `document` listener that's only removed if `stopBackgroundSyncScheduler` runs. **Always call `unbindVisibilityListener` in `onUnmounted` regardless of timer state.**

---

## Tier 4 — Opportunity windows (after stability is settled)

**Quick wins (≤ 1 day each)**

| # | What's there | What we could do |
|---|---|---|
| O1 | `router/index.ts:50` `/reports` route exists, no nav link | Add nav item gated on `posa_show_reports` profile flag |
| O2 | Scale Barcode Settings doctype has detailed `description` text but no SPA UI | Settings card in `NavbarSettingsPanel.vue` alongside QZ Tray |
| O3 | `customer-display` route at `router/index.ts:84`; only opened from `NavbarMenu.vue:489` | Add nav drawer entry under "Display" |
| O4 | `cash_movement/service.py` has `duplicate / cancel / delete` endpoints; doctype settings `posa_allow_cancel_submitted_cash_movement`, `posa_allow_delete_cancelled_cash_movement` exist | Row-action buttons in `CashMovementView.vue` |
| O5 | `posa_back_office_cash_account` field exists, never read in SPA (0 grep hits) | Consume in cash-deposit flow OR hide |
| O6 | `update_remote_info` returns commit list — only count is shown | Display changelog list in `AboutDialog.vue` |
| O7 | 38 `<v-dialog>` instances, only 4 use focus-trap | Add `<v-focus-trap>` / `retain-focus` across dialogs |
| O8 | `translations/es.csv` 1442 lines vs ~1251 unique `_("…")` calls | Run `bench update-translations posawesome --lang es`; review V3 strings (cash mov, offline status, gift cards) |
| O9 | `useOffers.ts` tracks active coupons, no nav badge | `v-badge` count on cart icon |
| O10 | `getPrintFormats(doctype)` returns formats for any DocType | Restrict to POS-relevant whitelist (also a perm fix) |

**Medium (≤ 1 week each)**

| # | What's there | What we could do |
|---|---|---|
| O11 | `api/commercial_flow.py` (15 KB) — `list_source_documents` / `prepare_document_flow_action` / `commit_document_flow_action` wired in `Pos.vue` mention but no dedicated UI | Build `CommercialFlowDialog.vue` for cross-document conversion (Quotation → SO → SI) |
| O12 | `api/quotations.py` `search_quotations` unused; only `submit_quotation` / `update_quotation` consumed (`invoiceService.ts:15`, `server.ts:110`); `custom_allow_create_quotation` profile flag exists | Quotations browser similar to `PurchaseOrders.vue` |
| O13 | Manual offline toggle exists but buried in `OfflineStatusPanel.vue:119/194` | Top-bar toggle + first-run hint |
| O14 | QZ Tray `setup_qz_certificate` flow fully implemented; only existing `QzTrayDialog.vue` shows it | One-time onboarding wizard that auto-calls `setup_qz_certificate` |
| O15 | `api/stored_value.py` `get_available_stored_value` / `get_stored_value_summary` never called by SPA | Stored Value tab in customer drawer |
| O16 | Mpesa reconcile flag wired (`Mpesa-Payments.vue`) but no Stripe/PayPal/etc. settings UI | Generic gateway settings UI |
| O17 | `api/item_processing/details.get_item_attributes` + `search.get_items_count` unused | Power an Attributes filter on `ItemsSelector.vue` and a stock-pagination footer |
| O18 | `api/item_processing/stock.get_bulk_stock_availability` unused; current code calls `get_available_qty` per item | Switch to bulk endpoint; add "low stock" badge on item tiles |
| O19 | `api/invoices.create_sales_invoice_from_order` + `delete_sales_invoice` unused by SPA (SO workflow uses `update_invoice_from_order` instead) | "Convert SO → SI" action on `PurchaseOrders.vue` (after Tier 1 perm hardening) |
| O20 | `posa_enable_return_validity` + `posa_return_validity_days` exist, Returns dialog (`flows/Returns.vue:716`) doesn't display them | "Valid until X" chip + warn when expired |

**Bigger bets (≥ 1 sprint each)**

| # | What's there | What we could do |
|---|---|---|
| O21 | `api/dashboard.py` ~4500 lines, 7+ report builders, ONE whitelisted entry `get_dashboard_data` (line 4569) returning a mega-payload | Section-by-section endpoints; lazy-load tabs in `Reports.vue`; separate Cash-Up dashboard from Sales |
| O22 | `api/purchase_orders.py` has 9 whitelisted endpoints (`create_supplier`, `search_suppliers`, `get_buying_price_list`, `get_supplier_info`, `get_last_buying_rate`, `create_purchase_item`, `create_purchase_order`, `search_items`); only some consumed | Full Receive-Stock-from-POS view (`posa_allow_purchase_receipt` flag suggests this was planned) |
| O23 | PWA `manifest.json` + `sw.js` registered, `sw-updater.ts` handles updates, no install prompt | `beforeinstallprompt` capture + "Add to Home Screen" hint, About dialog entry |
| O24 | `api/bundles.get_bundle_components` exists; `Invoice.vue:552 openPackedItems` shows them; no creator UI | Ad-hoc bundle creator in POS |
| O25 | `CustomerDisplay.vue` exists, route registered; no integration with delivery-charges / tax-inclusive line preview / multi-currency display (all 3 settings exist on POS Profile) | One sprint to make second screen production-grade |

---

## Positive findings (do NOT touch)

These work as designed; calling them out so we don't accidentally regress:

- Most raw `frappe.db.sql` is parameterized with `%s` / `%(name)s`. Few f-string SQL builds (`dashboard.py`, `invoice_processing/data.py`, `payments.py:367`) interpolate from internal whitelists, not user input.
- No hardcoded API keys / passwords / tokens in `api/`.
- No `methods=["GET"]` on state-changing endpoints. Only two `allow_guest=True` (M-Pesa) — known and gated by Tier 1 fix.
- No path-traversal sinks in `utilities.py`.
- `qz.py:setup_qz_certificate` correctly gates on `frappe.only_for("System Manager")`.
- `useItemSync.ts` correctly pauses on `document.hidden` and binds/unbinds visibility listener (the pattern we already shipped).
- Stock-change broadcast uses `frappe.db.after_commit` to batch — good defensive design.
- Service-worker version negotiation has thoughtful state-machine (`resolveActiveVersionTransition`) with unit-testable pure function.
- Items use `vue-virtual-scroller`'s `RecycleScroller` (cards) — virtualization is in place; gains in Tier 3 come from per-row memo + reactive proxy elimination, not adding virtualization.

---

## Suggested execution order

1. **Today** — Tier 0 as one commit, deploy lab. Cheapest perceived-wins.
2. **This week** — Tier 1 security as 4 commits (delete endpoints, perm gates, v-html sweep, M-Pesa+QZ hardening). Open PR upstream defendicon.
3. **This week** — Tier 2 code-correctness as 2-3 commits.
4. **Sprint after** — Tier 3 reactivity refactor (`shallowRef` items + Pos.vue async dialogs + SW cache-first). The real Moto E15 fix.
5. **Backlog** — Tier 4 opportunities, 2-3 quick-wins per week.

## Files most worth a focused pass

```
posawesome/posawesome/api/invoices.py
posawesome/posawesome/api/quotations.py
posawesome/posawesome/api/sales_orders.py
posawesome/posawesome/api/customers.py
posawesome/posawesome/api/customer.py
posawesome/posawesome/api/employees.py
posawesome/posawesome/api/m_pesa.py
posawesome/posawesome/api/qz.py
posawesome/posawesome/api/cash_movement/service.py
posawesome/posawesome/api/utilities.py
posawesome/posawesome/api/invoice.py
posawesome/posawesome/api/invoice_processing/creation.py
posawesome/posawesome/api/payments.py
posawesome/posawesome/api/shifts.py
frontend/src/posapp/stores/itemsStore.ts
frontend/src/posapp/components/pos/shell/Pos.vue
frontend/src/posapp/components/pos/Invoice.vue
frontend/src/posapp/components/pos/items/ItemsSelectorTable.vue
frontend/src/posapp/components/pos/items/ItemCard.vue
frontend/src/posapp/components/pos/items/CameraScanner.vue
frontend/src/posapp/components/pos/invoice/CartItemRow.vue
frontend/src/posapp/components/pos/customer/Customer.vue
frontend/src/posapp/components/pos/payments/PaymentAdditionalInfo.vue
frontend/src/posapp/composables/pos/items/useItemDetailFetcher.ts
frontend/src/posapp/composables/pos/items/store/useItemsSearch.ts
frontend/src/posapp/composables/pos/items/useScannerInput.ts
frontend/src/offline/db.ts
frontend/vite.config.js
posawesome/www/sw.js
```
