# REVIEW2 — 06 · Code quality (maintainability + modernity)

> Snapshot 2026-05-18 · branch `doco-customizations` (HolyMC2 fork) · upstream
> `defendicon/POS-Awesome-V15` · Frappe v16 + Python 3.14 + Vue 3.3 / Vuetify 3.12.
>
> Verdict from the auditor: the fork has shipped real perf wins (the 23-commit
> reactive-layer surgery is genuinely impressive engineering) but the
> *maintainability* floor is dragging behind the performance ceiling. Type
> safety is theatrical, the god-file population is growing, and the test
> matrix has wide-but-shallow coverage with structural blind spots. Below is
> the unvarnished list, cited by `path:line`.

---

## 0. Summary scorecard

| Dimension | Score | One-line verdict |
|---|---:|---|
| Readability | 6 / 10 | Naming improved (post `_processing/` split) but god files mask flow. |
| Maintainability | 5 / 10 | God files >1 k LOC are the norm in cart/payments/dashboard. |
| Type safety (TS) | 4 / 10 | `strict: true` is a lie: `noImplicitAny: false` + 1 073 `: any` + 139 `as any` + 35 `@ts-ignore`. |
| Type safety (Py) | 3 / 10 | ~40 / 350 public defs annotated. `from __future__ import annotations` in 8 / 66 modules. |
| Test coverage breadth | 7 / 10 | 145 vitest specs + 37 pytest modules + Playwright smoke. Good count. |
| Test coverage depth | 4 / 10 | Heavy boot/scaffolding bias; thin coverage of `creation.py`, `dashboard.py`, `pricing_rules.py`. |
| Lint/format hygiene | 5 / 10 | Two eslint configs (`.eslintrc.cjs` AND `eslint.config.mjs`), ruff invoked only from CI. |
| Frappe idiom hygiene | 5 / 10 | 80 raw `frappe.db.sql` sites, 132 `except Exception`, 19 `frappe.flags.ignore_account_permission`. |
| Vue idiom hygiene | 6 / 10 | Options API still in 22 / 102 components incl. `Pos.vue` (974 LOC), `Invoice.vue` (1 487 LOC). |
| Upstream tracking | 7 / 10 | The cherry-pick discipline (`AUDIT.md`) is solid; the refactor branches are dangerous to adopt. |
| Mutation / contract tests | 2 / 10 | Zero mutation testing infra. No contract tests against ERPNext. |

**Tech debt rough estimate**: 12-16 dev-weeks to clear the god files + type
safety + test depth gaps. Roughly equivalent to one full 3-σ phase.

---

## 1. God-file index (>500 LOC)

### 1.1 Frontend (Vue / TS) — 39 files

| Path | LOC | Role | Split suggestion |
|---|---:|---|---|
| `frontend/src/libs/opencv.js` | 6 335 | Vendored OpenCV.js | Move to dynamic CDN load or `import('@techstark/opencv-js')` lazy — already in deps. |
| `frontend/src/libs/dexie.min.js` | 5 869 | Vendored Dexie minified | Drop; we already depend on `dexie ^4.0.11`. Dead weight in repo. |
| `frontend/src/posapp/components/reports/Reports.vue` | 5 367 | Dashboard root | Already partially split via `dashboardService.ts` (Phase 8). Finish: extract `<Section*>` panels into `frontend/src/posapp/components/reports/sections/*.vue` — one per `DASHBOARD_SECTION_KEYS` entry. |
| `frontend/src/posapp/components/pos/flows/InvoiceManagement.vue` | 3 184 | Past-invoice browser/edit | Split: `InvoiceList.vue`, `InvoiceFilters.vue`, `InvoiceDetailDrawer.vue`, `useInvoiceActions.ts` composable. |
| `frontend/src/posapp/components/pos/Payments.vue` | 2 223 | Payment dialog | Per-method panels exist as siblings — finish extraction. Move `usePaymentSubmission` already exists; pull out `usePaymentMethodSelection.ts`. |
| `frontend/src/posapp/components/pos/shell/BarcodePrinting.vue` | 1 774 | Barcode-label preview | Lazy-load entire route — operator-rare. Extract template into `<BarcodePreview/>`, model into `useBarcodePrinting.ts`. |
| `frontend/src/posapp/composables/pos/invoice/useInvoiceOffers.ts` | 1 772 | Offer matching/applying | Split by responsibility: `offerMatching.ts`, `offerApplication.ts`, `offerCartSync.ts`. Composable is doing 3 jobs. |
| `frontend/src/offline/cache.ts` | 1 650 | IDB cache facade | Split per store: `cache/items.ts`, `cache/customers.ts`, `cache/profile.ts`, `cache/offers.ts`. |
| `frontend/src/posapp/components/navbar/NavbarMenu.vue` | 1 619 | Navbar dropdown menus | Templates contain repeated menu-item blocks — extract `<NavbarMenuItem/>` and pass items as data. |
| `frontend/src/posapp/components/pos/Invoice.vue` | 1 487 | Cart root | Already extracted `invoice_utils/` siblings; finish migrating remaining `<script>` logic into `composables/pos/invoice/*` and convert to `<script setup>`. |
| `frontend/src/posapp/components/pos/items/ItemsSelector.vue` | 1 466 | Catalog grid | Pre-existing `composables/pos/items/*` covers logic — template needs splitting: `ItemsSelectorToolbar.vue`, `ItemsSelectorGrid.vue`, `ItemsSelectorListView.vue`. |
| `frontend/src/posapp/stores/itemsStore.ts` | 1 461 | Catalog state | Already partially split via `composables/pos/items/store/*`. Pull `loadItems*` + `applyPriceListToItems` into separate modules (the store should be ≤500 LOC of state, not orchestration). |
| `frontend/src/posapp/components/pos/shell/PayView.vue` | 1 353 | Pay-screen root | Same as `Payments.vue` — extract per-method UI. |
| `frontend/src/posapp/layouts/DefaultLayout.vue` | 1 243 | Default layout chrome | Pull navbar + drawer into siblings; current file holds responsive logic AND scaffolding. |
| `frontend/src/offline/bootstrapSnapshot.ts` | 1 233 | Boot snapshot orchestrator | Split: `snapshot/take.ts`, `snapshot/restore.ts`, `snapshot/reconcile.ts`. |
| `frontend/src/posapp/components/navbar/NavbarAppBar.vue` | 1 163 | App bar | Pull menu/search/user-area into children. |
| `frontend/src/posapp/composables/pos/payments/usePaymentSubmission.ts` | 1 140 | Submit pipeline | Split: `submission/validate.ts`, `submission/build.ts`, `submission/dispatch.ts`, `submission/postSubmit.ts`. |
| `frontend/src/posapp/components/pos/invoice_utils/pricing.ts` | 1 090 | Cart pricing | Split: `pricing/local.ts`, `pricing/server.ts`, `pricing/reconcile.ts`. The `_applyingPricingRules` brackets live here — keep them in one module but the local/server passes are independent. |
| `frontend/src/posapp/components/pos/flows/Returns.vue` | 1 074 | Returns flow | Extract validation + pickers as in `flows/SalesOrders.vue` pattern. |
| `frontend/src/posapp/components/Navbar.vue` | 1 057 | Legacy navbar | Dead-ish — `navbar/Navbar*.vue` is the active set. Confirm via knip and remove. |
| `frontend/src/posapp/components/pos/shell/Pos.vue` | 974 | Root component | Options API + 974 LOC. Convert to `<script setup>` and pull lifecycle into `composables/pos/shell/useBoot.ts`. |
| `frontend/src/posapp/composables/pos/items/useItemAddition.ts` | 959 | Add-to-cart batcher | Split: `addition/queue.ts`, `addition/dedupe.ts`, `addition/apply.ts`. Currently mixes microtask batching + cart mutation + pricing kickoff. |
| `frontend/src/posapp/components/pos/invoice_utils/item_updates.ts` | 909 | Cart item refresh | Split per concern: `details.ts`, `stock.ts`, `price.ts`. Hot path — keep behavior pinned with tests before splitting. |
| `frontend/src/posapp/components/pos/closing/ShiftOverview.vue` | 902 | Closing dialog | Extract `<DenominationSheet/>`, `<CashCounts/>`, `<DiscrepancyPanel/>`. |
| `frontend/src/offline/db.ts` | 886 | Dexie schema | Acceptable size for a schema, but each version migration deserves its own file (already partly the case). |
| `frontend/src/posapp/stores/customersStore.ts` | 868 | Customer state | Pull search adapter + server fallback into `composables/pos/customer/useCustomerSearch.ts`. |
| `frontend/src/posapp/components/OfflineInvoices.vue` | 817 | Offline queue UI | Split per row state (pending / failed / synced). |
| `frontend/src/posapp/services/dashboardService.ts` | 808 | Dashboard fetchers | Already section-aware — split each section's fetch+normalize into `services/dashboard/<section>.ts`. |
| `frontend/src/posapp/workers/opencvWorker.js` | 804 | OpenCV worker | Acceptable as a single worker boundary. |
| `frontend/src/posapp/components/pos/invoice_utils/document.ts` | 790 | Invoice doc shape | Split into builders (`builders/header.ts`, `builders/items.ts`, `builders/taxes.ts`). |
| `frontend/src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue` | 768 | Customer edit | Form sections → child components. |
| `frontend/src/posapp/composables/pos/items/useItemDetailFetcher.ts` | 755 | Per-row detail fetch | Pull batching into `useItemDetailBatcher.ts`. |
| `frontend/src/posapp/components/pos/items/CameraScanner.vue` | 740 | Scanner UI | Extract `<ScannerHud/>` + `useCameraStream.ts`. |
| `frontend/src/posapp/components/pos/invoice/CartItemRow.vue` | 735 | Cart row | Row is hot path — refactor with caution. Extract edit-mode subtree into `<CartItemRowEditing/>`. |
| `frontend/src/posapp/composables/pos/items/useScanProcessor.ts` | 720 | Barcode scan pipeline | Split: `parse.ts`, `lookup.ts`, `apply.ts`. |
| `frontend/src/posapp/components/pos/shift/OpeningDialog.vue` | 716 | Opening dialog | Same shape as `ShiftOverview.vue` — same split. |
| `frontend/src/posapp/components/navbar/NavbarSettingsPanel.vue` | 704 | Settings drawer | Per-section children. |
| `frontend/src/lib/pricingEngine.ts` | 700 | Local pricing engine | Keep — it's a self-contained pure module with tests; size is justified. |
| `frontend/src/posapp/composables/pos/shared/useDiscounts.ts` | 683 | Discount logic | Split per discount source (manual / offer / pricing-rule / customer). |

**Frontend god-file count**: 39 files >500 LOC, 21 files >800 LOC. Target for
the next 2 quarters: cut to ≤15 files >500 LOC, zero >1 200 LOC.

### 1.2 Backend (Python) — 16 files

| Path | LOC | Role | Split suggestion |
|---|---:|---|---|
| `posawesome/posawesome/api/dashboard.py` | 5 829 | Dashboard payload | Phase 8 split landed at the orchestration layer (17 section endpoints) but THIS FILE STILL HOSTS THEM. Move each section to `api/dashboard/sections/<name>.py`; keep `dashboard.py` as the `get_dashboard_envelope` + `_build_dashboard_envelope` facade. |
| `posawesome/posawesome/api/invoice_processing/test_creation.py` | 1 646 | Tests for creation | Acceptable — test files are allowed to be large. Worth split by scenario class for readability. |
| `posawesome/posawesome/api/invoice_processing/creation.py` | 1 420 | Invoice creation | Split into: `creation/build.py` (line items), `creation/tax.py`, `creation/payments.py`, `creation/submit.py`. This is the single most-modified file in the repo — splitting will improve diff resolution alone. |
| `posawesome/posawesome/api/payment_processing/test_payment_processing.py` | 1 055 | Payment tests | OK as-is. |
| `posawesome/posawesome/api/utilities.py` | 961 | Misc utilities | Move per-concern: `version.py`, `db_stats.py`, `language.py`, `branch.py`. Currently dumping-ground. |
| `posawesome/posawesome/doctype/pos_closing_shift/closing_processing/overview.py` | 861 | Closing overview | Split into `overview/build.py`, `overview/totals.py`, `overview/diffs.py`. |
| `posawesome/posawesome/api/purchase_orders.py` | 849 | Purchase flow | Split per op: `purchase/create.py`, `purchase/receive.py`, `purchase/pay.py`. |
| `posawesome/posawesome/api/payment_processing/processor.py` | 805 | Payment processor | Decompose by step (validate → allocate → post-journal-entry → reconcile). |
| `posawesome/posawesome/api/pricing_rules.py` | 781 | Pricing engine | Split: `pricing_rules/fetch.py`, `pricing_rules/index.py`, `pricing_rules/cache.py`. |
| `posawesome/posawesome/api/payments.py` | 758 | Payment endpoints | Pull `create_payment_request`, `get_available_credit`, `reconcile_*` into `payments/<endpoint>.py`. |
| `posawesome/posawesome/api/item_fetchers.py` | 758 | Item fetch helpers | Probably overlaps `item_processing/`. Audit + collapse. |
| `posawesome/posawesome/api/test_payments.py` | 709 | Tests | OK. |
| `posawesome/posawesome/api/item_processing/search.py` | 689 | Item search | Split parse-filter / build-query / post-process. |
| `posawesome/posawesome/api/payment_processing/data.py` | 584 | Payment data shapes | OK. |
| `posawesome/posawesome/api/gift_cards.py` | 528 | Gift cards | OK; will grow when Phase 2 gift cards (`upstream/refactor-pos-speed-accuracy`) land. |
| `posawesome/posawesome/api/customers.py` | 512 | Customer endpoints | Split: `customers/search.py`, `customers/info.py`, `customers/credit.py`. |

**Backend god-file count**: 16 files >500 LOC, 6 files >800 LOC. The split
plan above eliminates 5 of the 6 worst cases in <2 weeks.

---

## 2. Duplicated code

Concrete duplication patterns observed across the fork. Severity scale:
🔴 critical (correctness risk) · 🟡 high (maintenance cost) · 🔵 low (cosmetic).

| # | Pattern | Sites | Severity | Fix |
|---:|---|---|---|---|
| D1 | `frappe.flags.ignore_account_permission = True; doc.insert(ignore_permissions=True); frappe.flags.ignore_account_permission = False` (or no reset!) | 19 sites across `sales_orders.py`, `purchase_orders.py`, `quotations.py`, `payments.py`, `cash_movement/posting.py`, `invoice_processing/creation.py`, `invoice_processing/payment.py`, `gift_cards.py` | 🔴 | Replace with one context manager `posawesome.posawesome.api.utils.ignore_account_permission()` (`with` statement guarantees cleanup even on exception). At least 6 of the 19 sites do NOT reset the flag on the failure path → leaked privileges within the same request. |
| D2 | `frappe.call({ method: "posawesome.posawesome.api...", args: {...} }).then(r => r.message ?? r)` | 139 `frappe.call` sites across `frontend/src/posapp/` | 🟡 | Already partially wrapped in `frappe-shim.ts` for the web-route path. Promote `posa.api.<group>.<method>(args)` typed wrappers generated from a single contract (Python side). Cuts ~3 LOC × 139 = ~400 LOC of boilerplate AND eliminates payload typo risk. |
| D3 | Raw `frappe.db.sql("SELECT ... FROM \`tab*\`")` with `%s` placeholders | 80 of 83 `frappe.db.sql` sites do NOT pass `as_dict=True`; downstream code indexes by integer offset (`row[0]`, `row[1]`) | 🟡 | Replace with `frappe.qb` (Query Builder) or `frappe.db.get_all(..., fields=[...])`. The integer-offset pattern is the most common copy-paste source of column-shift bugs after schema changes. |
| D4 | `cint(...) / flt(...) / cstr(...)` chains on every endpoint entry | every public endpoint in `api/*.py` | 🔵 | Acceptable Frappe idiom — but lift into a `_coerce_input(**kwargs)` decorator for the multi-arg endpoints (e.g. `dashboard.py`'s `get_*` series). |
| D5 | `try/except Exception: frappe.log_error(...); return {}` swallowing every failure | 132 `except Exception` blocks; >50 % return a falsy default | 🔴 | At minimum: differentiate `frappe.DoesNotExistError`, `frappe.PermissionError`, `frappe.ValidationError` from generic. Today a `KeyError` from a buggy refactor returns `{}` and the SPA gets quiet failures with no operator signal. |
| D6 | `posa_row_id ?? Math.random()` row-id generator | `useItemAddition.ts:?`, `useScanProcessor.ts`, `invoice/CartItemRow.vue`, `flows/Returns.vue` | 🟡 | Lift to `lib/posaRowId.ts` with a single `nextRowId()` (also lets tests stub it for determinism). |
| D7 | Local "is offline" probe in 6 composables (each calling `navigator.onLine` directly) | `composables/pos/payments/*`, `composables/pos/invoice/*`, `offline/*` | 🟡 | One `useNetworkStatus()` already exists (`composables/runtime/useNetworkLifecycle.ts`) — finish migration; the duplicates predate it. |
| D8 | Item-detail fetch retry / dedupe / cache logic | `useItemDetailFetcher.ts`, `item_updates.ts`, `useItemsIntegration.ts`, `itemsStore.ts` (lean merge) | 🟡 | Single batched fetcher service `services/itemDetailService.ts` with request coalescing + TTL. Three implementations exist today. |
| D9 | Customer-summary projection (`{ name, customer_name, mobile_no, email_id, customer_group, default_price_list }`) | Hard-coded in 5 sites: `customersStore.ts`, `Customer.vue`, `customers.py`, `useCustomerSearch.ts`, `bootstrapSnapshot.ts` | 🟡 | Define `types/customerSummary.ts` + Python `posawesome.types.customer.CustomerSummary` TypedDict; reference once. |
| D10 | Toast helpers (`show_alert` shims) | `frappe-shim.ts`, `toastStore.ts`, ad-hoc `eventBus.emit("show_message")` in 12 components | 🔵 | One call: `toastStore.push(...)`. Already exists — remove the eventBus path. |

---

## 3. Type safety

### 3.1 Python

| Metric | Value |
|---|---|
| `from __future__ import annotations` adoption | 8 / 66 non-test modules (12 %) |
| Public `def` with full annotation (rough) | ~40 / 350 (≈11 %) |
| `typing` imports | 7 modules |
| `frappe.types.DF` usage | 0 |
| `pyright` / `mypy` in CI | none |

The single biggest win is dropping `from __future__ import annotations` at the
top of every `api/*.py` and `_processing/*.py`, then incrementally annotating
the public endpoint signatures (~40 endpoints touch 80 % of traffic). One day
of focused work yields a coherent typed surface for the API boundary.

**Hot spots**:
- `posawesome/posawesome/api/invoice_processing/creation.py:1` — 1 420 LOC, 0 type hints, manipulates dicts shaped as Sales Invoice. The single biggest correctness blind spot in the backend.
- `posawesome/posawesome/api/dashboard.py:1` — 5 829 LOC; 26 annotated defs out of 49 whitelisted methods, but the bulk of helpers are untyped.
- `posawesome/posawesome/api/payments.py` — 758 LOC, 1 annotated def.

### 3.2 TypeScript

`tsconfig.json` says `"strict": true` but follows with:

```json
"allowJs": true,
"checkJs": false,
"noImplicitAny": false,
```

That combination effectively disables `strict`. Census:

| Metric | Value |
|---|---|
| `: any` annotations | 1 073 |
| `as any` casts | 139 |
| `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` | 35 |
| `.js` files under `src/` (count not bounded by `checkJs`) | ~20 (workers, plugins, `libs/*` vendor) |

**Unsound casts to call out**:
- `frontend/src/posapp/utils/frappe-shim.ts:601` — the entire shim hangs `frappe.*` off `globalThis` with `(globalThis as any).frappe = {...}`. Acceptable at the boundary; **must** be the only place that does it. Today the pattern leaks into `Pos.vue`, `Invoice.vue` and several composables — grep `(window as any)` / `(globalThis as any)` outside the shim and remove.
- `(realtime as any)?.socket?.connected` — `useNetworkLifecycle.ts`. Fine as a typed interface declaration in `types/frappe-realtime.d.ts`; the cast is hiding the shape rather than fixing it.
- 139 `as any` should be triaged in 3 buckets: (a) genuine cross-boundary type erasure → declare a `.d.ts`; (b) lazy refactor cost → fix; (c) actually unsound → fix urgently.

**Fix path**: flip `noImplicitAny: true` in a child `tsconfig.strict.json`,
include only `src/posapp/composables/pos/**` to start, and grow the strict
island file-by-file. Estimated 1 dev-week for the composables tree, 2-3 weeks
for stores + components.

---

## 4. Naming, comments, dead exports

### 4.1 Inconsistencies

- **`api/` vs `posawesome/posawesome/api/`** — the Frappe convention of nested `app/app/` is fine, but the `_processing/` suffix is used for `invoice_processing/`, `payment_processing/`, `item_processing/`, while `cash_movement/` (parallel concept) is just `cash_movement/`. Either suffix all or none.
- **`posa_` prefix on custom fields** is consistent (good). On Python module names, however: `posawesome/posawesome/api/utils.py` (243 LOC) vs `posawesome/posawesome/api/utilities.py` (961 LOC) coexist. Merge into one or rename to `_internal.py` / `db_stats.py`.
- **Naming inversion**: `frontend/src/posapp/components/pos/invoice_utils/` mixes "utils" of two scopes — invoice composition (`document.ts`, `pricing.ts`) AND cart sync (`item_updates.ts`, `customer.ts`). The directory should follow the composables convention; rename to `components/pos/invoice/orchestration/` and `composables/pos/invoice/*`.
- **Snake_case Vue file**: `Customer.vue` / `NewAddress.vue` / `pos/items/Variants.vue` are PascalCase (correct). But composables under `composables/pos/payments/usePaymentSubmission.ts` mix camelCase and per-domain folders inconsistently with `composables/pos/items/store/useItemsCache.ts` (no `pos/items/cache/` parallel).
- **`useItemsSearch` vs `useItemsSelectorSearch`** — two composables, similar names, related responsibilities, share state via the store. One should be the public API, the other an internal of the first.

### 4.2 Stale comments / dead code

- `frontend/src/posapp/components/Navbar.vue` (1 057 LOC) — looks superseded by `navbar/Navbar*.vue` siblings; confirm with `knip` and delete.
- `posawesome/hooks.py:23,24` — commented `web_include_css/js` blocks: delete or move to a CHANGELOG entry.
- `posawesome/hooks.py:55-101` — wholesale commented hook templates from `bench new-app`. Strip — they obscure the active hooks.
- `frontend/src/posapp/components/pos/invoice_utils/pricing.ts` — TODOs referring to commits that have shipped; audit and clear.
- `electron/preload.js` — keep, but `electron-builder` is in `knip.json` ignore lists. If Electron is no longer a release target, delete the whole `electron/` directory + the `package.json` Electron metadata.

### 4.3 Dead exports

Run `npx knip` (config exists, `knip.json`). The auditor did not invoke it
live; based on a static scan, expect ~30-50 unused exports in:
- `posapp/composables/pos/items/*` (legacy adapters)
- `posapp/utils/format.ts` (multiple unused formatters)
- `lib/pricingEngine.ts` (public helpers that the store doesn't import)

---

## 5. Testing posture

### 5.1 Coverage census

| Layer | Tests | Lines covered (proxy) | Verdict |
|---|---:|---|---|
| Frontend vitest | 145 specs | ~530 cases reported in docs | Broad but boot-/scaffolding-biased. |
| Backend pytest | 37 test modules | Concentrated in `invoice_processing/`, `payment_processing/`, `commercial_flow`, `gift_cards`, `payments` | Good per-module density on those, BUT: |
| Playwright smoke | 8 specs in `tests/smoke/posapp.web-route.spec.ts` + e2e dir | Covers cash sale, credit sale, draft save/resume, multi-add+swap, customer create | Adequate for boot regression; thin on payments matrix. |

### 5.2 Gap list (high priority)

| Module | Gap | Impact if regressed |
|---|---|---|
| `api/dashboard.py` (5 829 LOC) | No unit tests for the section endpoints. `test_dashboard*` does not exist. | Silent envelope shape drift; SPA `dashboardService.ts` would not catch a missing field server-side. |
| `api/pricing_rules.py` (781 LOC) | No tests of the Redis cache invalidation on `Pricing Rule` doc events. | Rule edits not reflected for up to 5 min. |
| `api/invoice_processing/creation.py` (1 420 LOC) | Heavy in `test_creation.py` (1 646 LOC) — but coverage of the "draft → submit → cancel → return" round trip is thin; `test_creation.py` is largely about line construction. | Returns regress silently (the Phase 6 cashback fix on `upstream/centralization` is a witness). |
| `composables/pos/items/useItemAddition.ts` | Microtask batching is tested at the unit level only. No integration test that exercises 50 rapid adds. | Cart double-add regressions slip past CI. |
| `composables/pos/payments/usePaymentSubmission.ts` (1 140 LOC) | Tests exist (`paymentPrintingLazyDeps.spec.ts`, `giftCardPayment.spec.ts`) but no scenario for: partial payment + change due + foreign currency. | Reconciliation drift for multi-method invoices. |
| Pricing flicker | `_applyingPricingRules` bracketing relies on async ordering — no test that asserts no re-entrancy. | Re-introduction would only surface under load. |
| `frappe-shim.ts` | 470 LOC of Frappe API impersonation, partial test coverage (`apiEnvelope.spec.ts`, scattered). Every endpoint shape change in Frappe v16 risks breaking this silently. | Boot path failure on Frappe minor bumps. |
| `offline/cache.ts` (1 650 LOC) | Schema migrations covered (`bootstrapSnapshot.spec.ts`) — but cache-coherency under concurrent tab use is not tested with `fake-indexeddb`. | Stale cache poisoning across tabs. |

### 5.3 Flakiness signal

- `chunkLoadRecovery.spec.ts` was historically flaky during the hashed-entry rollout (the spec asserts a window-side import retry). Now stable but watch on every Vite version bump.
- Playwright smoke is gated on lab credentials; the `static` job runs unconditionally. There is no flakiness retry policy in `ci-frontend.yml` — adding `retries: 2` (Playwright) for the smoke matrix would absorb the rare lab-network jitter.

### 5.4 Missing test layers

- **Contract tests against ERPNext**: the cart payload sent to `make_sales_invoice` is a structural contract with ERPNext v16. Zero schema-snapshot tests. A single `tests/contracts/sales_invoice_payload.spec.ts` that asserts the SPA-built JSON matches a frozen fixture would catch most upstream Frappe breakages before they hit prod.
- **Mutation tests**: none. `stryker-mutator` on `lib/pricingEngine.ts` and `composables/pos/items/store/*` would be cheap and high-signal (these are pure modules with good unit coverage — mutation testing's sweet spot).
- **Property tests**: `lib/pricingEngine.ts` is ideal for `fast-check` property tests on price computations.

---

## 6. Dependency hygiene

### 6.1 Static observations (live `npm audit` / `pip audit` not invoked by the auditor)

| Concern | Detail |
|---|---|
| Vendored libs in repo | `frontend/src/libs/opencv.js` (6 335 LOC) + `frontend/src/libs/dexie.min.js` (5 869 LOC) duplicate dependencies already in `package.json` (`@techstark/opencv-js`, `dexie ^4.0.11`). Delete vendored copies + verify build. Saves ~12 k LOC from repo, removes a stale-version risk. |
| `vue ^3.3.4` | Vue 3.5 is current. Several reactivity perf fixes ship in 3.5 that complement our shallowRef work. Upgrade after a vitest sweep. |
| `vitest ^1.6.0` | vitest 2.x is current. Migration is small; gain is faster watch mode + better worker isolation. |
| `eslint ^9.16.0` + two configs | Flat config (`eslint.config.mjs`) AND legacy (`.eslintrc.cjs`) coexist. Delete `.eslintrc.cjs`. |
| `nunjucks` | Used where? If only for build-time templates, move to `devDependencies`. |
| `html2pdf.js` | Heavy + niche. Confirm it's only loaded by the print path; lazy-import. |
| `qz-tray` | Pinned at `2.2.5`; QZ Tray's protocol has changed in 3.x. Plan a tracking decision: stay on 2.2.5 forever, or bump. |
| `lodash` | Used sparingly; replacing with native ES + `lodash-es` named imports (for tree-shaking) would shave ~30 KB. |
| `tailwindcss` in `devDependencies` | We ship Vuetify and Tailwind. Confirm Tailwind is actually used; if only for one module, isolate or remove. |
| `electron-builder` ignored in knip | If Electron isn't a current deliverable, drop the dependency + `electron/` directory entirely. |
| Python deps in `pyproject.toml` | `dependencies = [ "# Core dependencies" ]` — literally empty. All Python deps come from Frappe/ERPNext. OK, but document. |

### 6.2 Recommended actions

1. Run `npm audit --omit=dev` once and pin findings into `docs/REVIEW2/dependencies.md` (separate doc).
2. Run `bench --site … pip audit` (Frappe has a helper) — Frappe v16 bundles a curated audit run.
3. Delete `frontend/src/libs/*.js`; re-import from npm.
4. Decide on Electron: drop or invest.

---

## 7. Lint / format gaps

- **Two eslint configs**: `.eslintrc.cjs` (legacy, root-level) + `eslint.config.mjs` (flat). ESLint 9 ignores `.eslintrc.cjs` by default but the file still confuses humans. Delete it.
- **No `@typescript-eslint`** plugin wired despite `@typescript-eslint/parser` being in deps. Currently `.ts` files are linted by the JS recommended ruleset only. Add `typescript-eslint` plugin and at least `no-floating-promises`, `no-misused-promises`, `consistent-type-imports`.
- **`eslint-plugin-vue` config = `flat/essential`**. Promote to `flat/strongly-recommended` after fixing the top-N reports (template lint will catch `v-for` without `:key`, prop mutation, etc).
- **Prettier**: `useTabs: true, tabWidth: 4`. Consistent with Frappe's house style. Fine.
- **Ruff**: configured (`pyproject.toml` `[tool.ruff]`, target `py310`). Selected rules are reasonable. **But ruff is not installed locally for the auditor**, only invoked in `format.yml`. Add a `pre-commit` hook (the `pre-commit` package is referenced in `.github/workflows/format.yml` but the repo has no `.pre-commit-config.yaml`).
- **`commitlint`**: `commitlint.config.js` exists. Not wired to a git hook by default. Husky would make this stick.
- **Files not following project conventions**:
  - `Pos.vue` (Options API) — convert to `<script setup>`.
  - `Invoice.vue` (Options API + 1 487 LOC) — same.
  - 22 components total still on Options API (list in §1.1 + §9).
- **Tab/space mixing**: `pyproject.toml` ruff `ignore = ["W191", "E101"]` — currently tolerated. Not a blocker but an inconsistent codebase appearance signal.

---

## 8. Frappe anti-patterns

| ID | Pattern | Sites | Severity | Notes |
|---|---|---|---|---|
| F1 | Raw `frappe.db.sql("SELECT ...")` without `as_dict=True` | 80 / 83 SQL sites | 🟡 | Concentrated in `utilities.py:83-543` (db stats — acceptable), but also `dashboard.py:?` (49 sites — refactor), `customers.py:65,256,465`, `payments.py:367`, `shifts.py:18`. Replace with `frappe.qb` or `frappe.db.get_all(..., as_dict=True, fields=[...])`. |
| F2 | `frappe.flags.ignore_account_permission = True` without context manager / cleanup | 19 sites (listed in D1) | 🔴 | Several flow paths can leave the flag set across a request → privilege bleed for subsequent statements in same job. Wrap in `contextmanager`. |
| F3 | `except Exception` catch-all + silent drop | 132 sites repo-wide; 90 + in `posawesome/posawesome/api/*` | 🔴 | At minimum differentiate `frappe.DoesNotExistError`, `frappe.PermissionError`, `frappe.ValidationError`. Quiet failures here are the dominant operator-side ghost-bug source. |
| F4 | `frappe.db.commit()` absence | 0 explicit commits — relies on Frappe's request boundary | 🔵 | Mostly correct, but `m_pesa.py` (allow_guest webhook) and `cash_movement/posting.py` should defend with explicit `frappe.db.commit()` after success on write paths to avoid losing data on socketio-only response paths. |
| F5 | `frappe.local.flags.redirect_location` | `posawesome/www/posapp.py:57,66` | 🔵 | Legitimate use (Frappe's web-route redirect API). Single-purpose. Document the rationale inline; today it's commented but worth a link to the Frappe doc. |
| F6 | `@frappe.whitelist()` without `allow_guest` discipline | All API endpoints checked: `allow_guest=True` appears in `m_pesa.py` (correct — STK callback) and `posapp.py` web controller. Other endpoints require login. | 🔵 | OK. Add a `tests/contracts/guest_endpoints.spec.py` that asserts only the M-Pesa endpoint is allow_guest. |
| F7 | `frappe.get_doc(...).save(ignore_permissions=True)` | ~30 sites | 🟡 | Sometimes paired with F2 (double bypass). Audit: every `ignore_permissions=True` should have a one-line comment explaining WHY the bypass is correct (e.g. "POS user can't write Sales Invoice directly but is creating one on operator's behalf"). |
| F8 | `frappe.get_all(..., limit_page_length=0)` (= unbounded) | Multiple sites — auditor did not enumerate | 🟡 | Cap and paginate. |
| F9 | `frappe.session.user` checks inside loops | `dashboard.py` heavy | 🔵 | Move once to a request-local cache. |
| F10 | Mixing `posa_offers` and `posa_coupons` as JSON-blob child-table fields | `hooks.py:240-244, 290-291` | 🔵 | Custom-field JSON serialisation works but obfuscates queries. Long-term: promote to proper child doctypes. |
| F11 | `stock_realtime.py` uses `frappe.flags._posa_stock_change_queue` as request-scoped buffer | `posawesome/posawesome/stock_realtime.py:33-65` | 🟡 | Functional, but `frappe.flags` is global within a request — using a private attribute on it is brittle (any other hook touching `frappe.flags` could collide). Move to a module-level dict keyed by request id, or to a Redis list. |

---

## 9. Vue anti-patterns

| ID | Pattern | Severity | Notes |
|---|---|---|---|
| V1 | `v-html=` on user-derived strings | 🔴 | `frontend/src/posapp/components/pos/payments/PaymentAdditionalInfo.vue:54-84` renders 9 address fields via `v-html` from item.raw — those values come from the customer Address doctype which is operator-editable. Upstream PR `26853355` ("fix: removed unsafe v-html in frontend") and `8e96d0d8` ("fix: v-html XSS in Customer.vue") on `upstream/refactoring-repo-architecture-structure` address this. **Adopt those two commits.** Also `frontend/src/posapp/components/pos/invoice/DeliveryCharges.vue:28-30` uses `v-html` on doctype names — likely safe but the pattern is contagious; replace with `{{ }}` interpolation. |
| V2 | Options API holdouts | 🟡 | 22 components still on Options API including `Pos.vue` (974 LOC, root!), `Invoice.vue` (1 487 LOC), `NavbarMenu.vue` (1 619), `InvoiceManagement.vue` (3 184), `PayView.vue` (1 353), `Returns.vue` (1 074), `BarcodePrinting.vue` (1 774). Conversion to `<script setup>` is a precondition for serious refactor; until then the templates can't import composables cleanly. |
| V3 | Direct mutation of objects passed as props | 🔴 | Specific cases: `frontend/src/posapp/components/pos/invoice/ItemsTableExpandedRow.vue:25,57` does `v-model="item.item_code"` / `v-model="item.uom"` on a row object received as prop. Same in `purchase/PurchaseItemsTable.vue:79,114` (`item._editingQtyValue`, `item._editingRateValue`). Per Vue convention the child should emit `update:*` and the parent owns the mutation. Today the cart Map's identity guarantees reactivity by accident — but it breaks the `shallowRef + markRaw` discipline; when the array re-publishes, the in-place edits *may* be lost. |
| V4 | Large reactive objects | 🟡 | Most heavy state is already `shallowRef` post `8f3a87e5` / `06c1d639` / `47d0ca54` / `7f82339d`. Continue: `useInvoiceOffers.ts` (1 772 LOC) holds offers in a `ref({})`. Audit and shallow-ify. |
| V5 | Fat templates | 🟡 | `Reports.vue` (5 367 LOC), `NavbarMenu.vue`, `InvoiceManagement.vue`. The split work in §1.1 is the fix. |
| V6 | Inline functions in templates | 🔵 | Only 4 sites found via `@event="() => …"`. Negligible. |
| V7 | `v-for` without `:key` | 🔵 | 112 `v-for` sites; static scan needs deeper validation, but `eslint-plugin-vue/strongly-recommended` would flag any genuine misses. Promote the lint level. |
| V8 | `watchEffect` over `watch` | n/a (0 uses) — good. |
| V9 | Listener leaks via `frappe.realtime.on` without `.off` | 🔵 | Fixed by `9fee9e46` (socketStore idempotency) + `2977e50c` (component unmount cleanup) + the `b5992f70` cherry-pick (prop-driven dialogs). Continue the prop-driven pattern for any new dialog component. |
| V10 | `eventBus.emit("show_message")` leftovers | 🔵 | 12 sites still emit toasts via mitt rather than `toastStore.push`. Cosmetic but worth a sweep. |
| V11 | Deep `:class` object bindings (34 sites) | 🔵 | Vuetify-friendly; not a perf concern at the volumes used here. |

---

## 10. Upstream refactor branches — adopt / defer / never

Snapshot from `git log` on `upstream/<branch>` and `git diff --stat` against
`doco-customizations`.

### 10.1 `upstream/refactoring-repo-architecture-structure`

- Diff vs `doco-customizations`: 194 files, **+6 800 / −10 521**.
- Net signal: directory reshuffle + several real fixes:
  - `26853355` "removed unsafe v-html in frontend" 🔴 ADOPT
  - `8e96d0d8` "v-html XSS in Customer.vue" 🔴 ADOPT
  - `f14103d5` "memory leak in NewAddress.vue" 🟡 evaluate against our prop-driven NewAddress (likely SUPERSEDED)
  - `143ce0bf` "route cart item mutations through invoice store totals" 🟡 evaluate; overlaps our `invoiceStore.touch()` flow
  - `c805f8a0` "add POS profile write authorization helper feature" 🟡 ADOPT (closes a real auth gap)
  - `3c6c75e3` "guard POS purchase write APIs with profile authorization" 🟡 ADOPT
  - `359c0a74` "validate POS customer write API authorization" 🟡 ADOPT
  - `c47083b9` "lint TypeScript files with ESLint" 🟡 ADOPT (matches §7 fix)

**Verdict: hand-pick 5 commits (XSS × 2, auth × 3, ts-eslint × 1). Never bulk-merge — the directory shuffle would undo our perf work.**

### 10.2 `upstream/refactor-customer-and-item-loading-modules`

- Mostly directory renames + duplicates of perf work that we already shipped via `track/upstream-develop`.
- **Verdict: NEVER bulk-merge.** Cherry-pick only if a specific bug fix surfaces on top.

### 10.3 `upstream/refactor-pos-module-namings`

- Diff: 570 files, **+14 182 / −53 990**. Massive — most deletions remove the fork's perf branch.
- `789c833c` "rename frontend and backend module names" is the headline; this is a cosmetic shake that would force-rebase the fork onto a new naming convention.
- **Verdict: NEVER on `doco-customizations`.** Could be a useful base for a `track/upstream-naming-rebase` experiment branch, but not a production target.

### 10.4 `upstream/refactor-pos-speed-accuracy`

- Diff: 536 files, **+11 885 / −61 684**. Same deletion shape as above.
- Real gems inside: cashier accountability work + gift card phase 2 (`58079317`, `aa516de3`, `c24a6f08`) and `364ad4fc` "centralize pos pay reference validation".
- **Verdict: cherry-pick gift card phase 2 + cashier accountability + pay-reference validation. Defer everything else.**

### 10.5 `upstream/centralization-of-pos-app`

- Diff: 611 files, **+18 909 / −53 292**.
- Recent commits (`03843ea9` auto-repair offline offers cache, `7136b39a` sync item selector stock with cart, `46bc3468` refresh batch on draft load, `a5d0207f` auto-apply coupon offers, `9e74d643` cashback settlement on returns, `93d8fcd0` apply_tax_inclusive unreachable logic) are real bug fixes.
- **Verdict: cherry-pick the 6 bug-fix commits above. Don't take the centralization re-org.**

### 10.6 Summary table

| Branch | Bulk merge | Cherry-picks |
|---|---|---|
| `refactoring-repo-architecture-structure` | ❌ | XSS × 2, auth × 3, ts-eslint × 1 (6 commits) |
| `refactor-customer-and-item-loading-modules` | ❌ | none priority |
| `refactor-pos-module-namings` | ❌ | none |
| `refactor-pos-speed-accuracy` | ❌ | gift cards phase 2, cashier accountability, pay-ref validation |
| `centralization-of-pos-app` | ❌ | 6 bug-fix commits listed above |

Style note when backporting: **convert any `eventBus.emit/on` dialog opens
to prop-driven (`b5992f70` pattern) before merging** — our codebase is
moving away from eventBus dialog wiring; consistency matters.

---

## 11. 6-σ readiness (the next reliability rung)

3-σ is the active target (`3-SIGMA.md`). 6-σ is the question: what's missing
in code-quality posture to support 99.9997 % success rates?

### 11.1 Automated code review

- **Today**: human PR review + agent-pipeline (coder + reviewer agents per `AUDIT.md §4`).
- **6-σ missing**:
  - Auto-block PR if `: any` count rises.
  - Auto-block PR if a god file grows (LOC ceiling per file).
  - Auto-block PR if a new `frappe.flags.ignore_account_permission` is introduced without an explanatory comment.
  - Auto-warn on `frappe.db.sql` without `as_dict=True`.
  - Conventional-commits enforced via husky + commitlint.

These are 10-20 LOC of CI hooks; missing today.

### 11.2 Mutation testing

- **Today**: 0.
- **6-σ missing**: `@stryker-mutator/core` on `lib/pricingEngine.ts`, `composables/pos/items/store/*`, `composables/pos/payments/usePaymentSubmission.ts`. Pure-ish modules with the most unit coverage → highest mutation-score signal-to-noise. Goal: ≥85 % mutation score on the 5 pure-est modules.
- Backend: `mutmut` on `api/invoice_processing/creation.py` + `api/pricing_rules.py`.

### 11.3 Contract tests

- **Today**: 0 contract tests against ERPNext doctype shapes.
- **6-σ missing**:
  - Snapshot of `make_sales_invoice` payload contract (fixture).
  - Snapshot of `get_active_pricing_rules` response contract.
  - Snapshot of `frappe.realtime` event payloads (the 6 we subscribe to).
- Without these, every Frappe v16 minor bump can silently mutate behaviour.

### 11.4 Determinism

- Random IDs (`Math.random()` for `posa_row_id`) make tests non-deterministic. Inject a `nextId()` factory.
- `Date.now()` used directly in hot paths. Inject a `now()` factory.

### 11.5 Observability for ghost bugs

- `posa_debug` opt-in (`utils/debug.ts`) is good.
- `posawesome.posawesome.api.telemetry` is good.
- Missing: an "operator reported a bug" button that dumps the redux/pinia state + last 50 telemetry events as a single bundle. ~80 LOC.

---

## 12. PR-worthy cleanup PRs for upstream (against `stage-develop`)

Each PR should be ≤500 LOC, single-concern, with tests.

### PR-1 · "fix(security): remove v-html in PaymentAdditionalInfo and DeliveryCharges"

- **Files**: `frontend/src/posapp/components/pos/payments/PaymentAdditionalInfo.vue` (9 sites), `frontend/src/posapp/components/pos/invoice/DeliveryCharges.vue` (2 sites).
- **Risk**: low — replacing `v-html` with `{{ }}` for address fields.
- **Test**: `tests/security/payment-additional-info.spec.ts` — assert no XSS via crafted address.
- **Co-credits**: upstream `26853355`, `8e96d0d8` for inspiration.

### PR-2 · "refactor(api): contextmanager for ignore_account_permission"

- **Files**: new `posawesome/posawesome/api/utils.py` `@contextmanager def ignore_account_permission()`, 19 call-site replacements across `sales_orders.py`, `purchase_orders.py`, `quotations.py`, `payments.py`, `cash_movement/posting.py`, `invoice_processing/creation.py:354,926,1122,1239`, `invoice_processing/payment.py:260,290`, `gift_cards.py:120`.
- **Risk**: medium — flow-control change; behaviour-preserving but covers exception paths the originals leak on.
- **Test**: `test_ignore_permission_contextmanager.py` — assert flag resets on exception.

### PR-3 · "chore(deps): remove vendored opencv.js and dexie.min.js; use npm dependencies"

- **Files**: delete `frontend/src/libs/opencv.js`, `frontend/src/libs/dexie.min.js`, update imports.
- **Risk**: medium — build path / SW precache assumptions need verification.
- **Test**: existing vitest + Playwright smoke; add `tests/buildArtifacts.spec.ts` asserting `libs/` is empty.
- **Saves**: 12 200 LOC from repo.

### PR-4 · "refactor(dashboard): extract section endpoints into api/dashboard/sections/"

- **Files**: split `posawesome/posawesome/api/dashboard.py` (5 829 LOC) — keep `dashboard.py` as orchestration (≤500 LOC), move 17 section endpoints into `api/dashboard/sections/<name>.py`.
- **Risk**: medium — file-path churn; whitelist methods must keep stable dotted paths via re-export in `dashboard.py`.
- **Test**: existing dashboard smoke + new `test_dashboard_endpoint_paths.py` asserting every section method is callable via the legacy dotted path.

### PR-5 · "refactor(invoice): split creation.py into build/tax/payments/submit"

- **Files**: split `posawesome/posawesome/api/invoice_processing/creation.py` (1 420 LOC) into a `creation/` sub-package with `build.py`, `tax.py`, `payments.py`, `submit.py`; keep `creation/__init__.py` re-exporting the public surface.
- **Risk**: medium-high — this is the most-modified file in the repo; squashed PR + test sweep is mandatory.
- **Test**: existing `test_creation.py` (1 646 LOC) covers regression. Add `test_creation_module_boundaries.py` asserting no cross-module forbidden imports.

### PR-6 · "chore(lint): single eslint flat config + typescript-eslint plugin"

- **Files**: delete `.eslintrc.cjs`; extend `eslint.config.mjs` with `typescript-eslint` (`no-floating-promises`, `no-misused-promises`, `consistent-type-imports`).
- **Risk**: low — lint-only.
- **Test**: CI lint step.

(Upstream may want different framing for the bigger refactors; offer them
PR-1, PR-2, PR-3 first as the most universally valuable. PR-4, PR-5 may
need a prior design proposal.)

---

## 13. Doco-specific code that stays in fork

Anything that ties to `doco/`, `erpnext_mexico_compliance`, or per-customer
behavior. From a static scan, the explicit `doco`/`mexico` references in
posawesome are nearly zero — the fork is structurally generic. The
fork-only surface is:

| Concern | Lives where | Reason it stays |
|---|---|---|
| Branch policy | `doco-customizations` long-lived production branch (see `ARCHITECTURE.md §9`) | Production deploy target on `ventas.docomexico.com`; merge cadence is decoupled from `perf/upstream-develop-tweaks`. |
| CFDI handling | None inside posawesome (lives in `erpnext_mexico_compliance` sibling app) | Belongs there. Verify no posawesome file imports `erpnext_mexico_compliance` directly — keep coupling at the doctype-event layer. |
| `posa_use_web_route` toggle | `posawesome/hooks.py:326` POS Profile field + `posawesome/www/posapp.py` web route + `frappe-shim.ts` | Phase 1 of `3-SIGMA.md`; doco rolled this out first. Upstream may adopt later, but until then it's a fork divergence. |
| Telemetry doctype | `posawesome/posawesome/doctype/pos_telemetry_event/*` + `api/telemetry.py` | Phase 0 of `3-SIGMA.md` infrastructure. Worth offering upstream as a separate PR, but currently fork-only. |
| Reorganized POS Profile sections (custom fields) | `posawesome/patches/reorganize_pos_profile_sections.py` + the `posa_section_*` custom-field set in `hooks.py:204-209` | Doco's UX preference; offer upstream but tag as fork-default. |
| Heap-snapshot triage scripts | `scripts/heap_topnames.py`, `scripts/heap_strings.py`, `scripts/heap_components.py` (already shipped — `031c1c56`) | Operational tooling tied to our perf-investigation playbook. Useful to upstream but no upstream consumer yet. |
| `dev-refresh.sh` integration | `~/muelle-host/muelle/scripts/dev-refresh.sh` (external) referenced from `ARCHITECTURE.md §11` | Not in repo. Fork-only host tooling. |

Lines that exist for doco operations only (rough census, all hosted in
documentation rather than runtime code):
- `CLAUDE.md` references to `bench` workflows
- `ARCHITECTURE.md §11` host-specific deploy notes
- `3-SIGMA.md` Phase 1.H "Drafts panel auto-refresh" — landed in fork; offer upstream as PR-7.

The runtime code is upstream-compatible. The branch policy and patches
listed above are the only structural fork delta.

---

## Appendix A · The 8 highest-leverage cleanups, ranked

| # | Cleanup | Effort | Payoff |
|---:|---|---|---|
| 1 | PR-2 (contextmanager `ignore_account_permission`) | 1 day | Closes the privilege-leak class entirely. |
| 2 | PR-1 (v-html XSS) | 0.5 day | Closes 11 XSS sinks. |
| 3 | Split `dashboard.py` (PR-4) | 3 days | Unblocks parallel work on dashboard sections. |
| 4 | Split `creation.py` (PR-5) | 5 days | Single largest diff-resolution speedup repo-wide. |
| 5 | Delete vendored libs (PR-3) | 0.5 day | Removes 12 200 LOC from repo. |
| 6 | Convert `Pos.vue` + `Invoice.vue` to `<script setup>` | 3 days | Unblocks composables migration across cart hot path. |
| 7 | Flip `noImplicitAny: true` for `composables/pos/**` | 5 days | First strict TypeScript island. |
| 8 | Mutation tests on `lib/pricingEngine.ts` | 1 day | Sets 6-σ test-quality bar with one example. |

**Total**: ~3 weeks of focused work pays back 12-16 weeks of latent debt
plus closes the highest-severity security finding.

---

## Appendix B · Files that should NEVER exceed 500 LOC

Going forward, the auditor recommends a hard ceiling enforced in CI:

- `posawesome/hooks.py` — orchestrator; can grow, but every new hook should
  reference a function in another module.
- Every Pinia store under `frontend/src/posapp/stores/*.ts`.
- Every `.vue` component (templates split into children if longer).
- Every public `api/<endpoint>.py`.

Suggested CI hook:

```bash
find posawesome frontend/src -type f \( -name '*.py' -o -name '*.vue' -o -name '*.ts' \) \
  -not -path '*/node_modules/*' -not -path '*/libs/*' \
  | xargs wc -l | awk '$1 > 500 && $2 != "total" { print }' \
  | tee /tmp/big-files.txt; \
  test ! -s /tmp/big-files.txt
```

Today this fails on 55 files. The cleanup PRs above bring it down to ~20.
The remaining 20 (e.g. `dashboardService.ts`, `cache.ts`) graduate to the
strict ceiling over the following quarter.

---

End of REVIEW2/06 · code_quality.md
