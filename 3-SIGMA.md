# Path to 3-σ reliability for POSAwesome

> 3-σ ≈ 99.73 % of operator-actions complete successfully within the SLO
> (input → render < 200 ms; transaction success > 99.9 %; no tab-restart shifts).

This doc answers two questions:

1. **Is the current stack the right choice?** Honest assessment.
2. **What's the path to 3-σ?** Concrete, ordered work.

---

## 1. Stack assessment — what we have today

### Frontend
- **Vue 3.3** + **Pinia** + **Vuetify 3.12** + **Vite 6** + **vue-router 4**
- **Dexie / IndexedDB** for offline cache
- **Service Worker** for asset precache + offline shell
- **socket.io-client** via `frappe.realtime`
- **frappe-ui** style integration (`frappe-vue-style` Vite plugin)
- **vue-virtual-scroller** for item cards
- **OpenCV.js + ZXing** for camera barcode scanning

### Backend
- **Frappe 16 / ERPNext 16** on **Python 3.14**
- **Gunicorn** workers + **socketio** Node process + **rq** background queues + **Redis**
- **MariaDB 10.6 / 11**

### Hosting
- POSAwesome runs INSIDE the Frappe Desk shell at `/app/posapp`. Desk loads sidebar / navbar / workspace / global modals (~150 k DOM nodes baseline) before our SPA even starts.

### Honest assessment

| Layer | Verdict |
|---|---|
| Vue 3 + Pinia + Vuetify | **Right tool, modern, well-maintained.** The recent perf-branch shipped 23 commits of tuning; with `shallowRef + markRaw` discipline + bounded watcher depth, the framework is not the bottleneck. |
| **Vuetify v-data-table-virtual** | **Wrong tool for the cart.** Cart has 4-15 rows, doesn't need virtualisation; the table component generates dynamic CSS rules + watchers that grow during long sessions. Cart is the hottest re-render surface; a 200-line custom `<table>` would be cheaper. |
| **Running inside Frappe Desk shell** | **Wrong host.** Desk's chrome (~150 k DOM nodes) is dead weight. POS doesn't use Desk's sidebar, workspace icons, global search, notifications, etc. Yet they all mount, attach event listeners, allocate watchers, and stay resident for the life of the session. GC mark phase scales with total DOM; eventually trips per-tab OOM on long shifts. |
| Dexie / IDB | **Right tool.** Performance is fine. Schema versioning is the main concern (we have gaps at v2-v6 — see `POSAWESOME-ROADMAP.md` C3). |
| Service Worker + hashed entries | **Right after our `d477e21f` fix.** Stale-chunk-after-deploy is dead. |
| socket.io via `frappe.realtime` | **Right tool, but coupled.** We can't run POS without Frappe's socketio node process up; that's an additional failure point in the chain. |
| **Frappe v16 / Python 3.14** | **Bleeding edge.** We've already paid for it (the `_ModuleLock` deadlock fix `6e9d7222`). Expect more rough edges as Frappe v16 stabilises. |
| ERPNext invoice / Pricing Rule engine | **Correct for compliance / accounting, but slow.** `get_active_pricing_rules` walks doctypes; on big catalogs it's 1-5 s. Our fire-and-forget hides the latency but doesn't fix it. |

### Should we replace the framework? **No.**

Vue 3 + Pinia + Vuetify is mature, the team knows it, and the framework itself is not the source of our reliability issues. The issues are **architectural** (running inside Desk; using a heavy data-table for a small cart; coupling to ERPNext's pricing engine without a fallback) and **operational** (no telemetry; manual heap-snapshot triage is the only diagnostic loop). Replacing the framework would burn 2 quarters and gain ≤ 10 %.

Where we ARE locked-in:
- Frappe doctypes for Sales Invoice / Customer / Item / Pricing Rule — replacing means abandoning ERPNext accounting / inventory / tax compliance. **Don't.**
- frappe.realtime / socket.io — could go custom WS, but the gain is minor.
- Frappe Desk shell — **this is the lock-in we should break.** Path 3 below.

---

## 2. What 3-σ means here, concretely

Targets, measured continuously (not at deploy time):

| Metric | Target | Today (anecdotal) |
|---|---|---|
| INP p99 (any interaction) | < 200 ms | ~80 ms typical, but with rare spikes to 20-30 s |
| LCP p95 (initial paint) | < 2.5 s | ~5-6 s (Desk-shell-bound) |
| Cart-add success rate | > 99.95 % | ~99 % (rare crashes lose carts) |
| Invoice submit success | > 99.99 % | high but no instrumentation |
| Renderer OOM events / shift | 0 | ~1 per 4-8 hour shift on busy POS |
| Failed-search → no-result events | < 0.1 % | unknown — no telemetry |
| Listener leak growth / hour | flat | flat after `9fee9e46` + `2977e50c` |

**Gating: you cannot defend a 3-σ target without measuring it.** Every other item below depends on telemetry being in place first.

---

## 3. The work, ordered by impact / effort

### Phase 0 — Observability foundation (1 week, prerequisite for everything else)

Without numbers you're guessing. Build the loop first.

1. **Browser RUM endpoint** — `posawesome.posawesome.api.telemetry.ingest` receiving:
   - PerformanceObserver hits for `longtask`, `event` (INP), `largest-contentful-paint`, `layout-shift`
   - Custom marks: `pos:add-item`, `pos:price-list-apply`, `pos:invoice-submit`, etc. (we already have `withPerf` — wire it to send)
   - Crash signal on `error` / `unhandledrejection` / SW `messageerror`
   - Heap snapshot trigger when JS heap > 70 % of `performance.memory.jsHeapSizeLimit`
2. **Server-side observability table** — `Doctype: POS Telemetry Event` (terminal, user, event_name, value, timestamp, build_version). Index by (terminal, timestamp).
3. **Dashboard** — reuse `dashboard.py` patterns: `get_pos_telemetry_summary(profile, since)` returning INP p50/p95/p99, crash count, slow-add count.

**Cost**: ~3 days dev + 1 day dashboard. Touches 5-7 files. **Without this, every subsequent number in this doc is speculation.**

---

### Phase 1 — Bypass Frappe Desk shell (1 week, highest leverage)

`ARCHITECTURE.md §12` already flagged this. Concrete plan:

1. New web route at `/posapp` (existing `posawesome/www/` directory).
2. `posawesome/www/posapp.py` web controller: 40 LOC, validates session, fetches CSRF, renders `posapp.html`.
3. `posawesome/www/posapp.html` template: 30 LOC, just `<script type="module" src="…loader.js">` + the basic shell `<div id="app">`.
4. **`frontend/src/posapp/utils/frappe-shim.ts`** (~250 LOC): replaces every `frappe.*` global the SPA calls (143 distinct call sites; see `ARCHITECTURE.md §10 → 8bf5eba7` analysis):
   - `frappe.call(opts)` → fetch wrapper with CSRF, JSON
   - `frappe.realtime.on(...)` → direct socket.io-client connection
   - `frappe._()` → translation map from boot endpoint
   - `frappe.show_alert` / `frappe.msgprint` → wire to `toastStore`
   - `frappe.boot.*` → fetch `/api/method/frappe.utils.boot.get_bootinfo` once at boot
   - `frappe.utils.play_sound` → `new Audio(url)`
   - `frappe.session.user` → from boot
   - etc.
5. Keep `/app/posapp` Page DocType working — emit a soft redirect notice "POS has moved to /posapp" with a 10 s timer.
6. Update `sw.js` precache to handle both routes.
7. Update `posapp.json` Page DocType `redirect_to_app` (Frappe Page DocType supports this).

**Payoff**: DOM baseline 252 k → ~100 k nodes (60 % cut). GC mark phase scales linearly with DOM, so renderer OOM crashes drop from "1 per shift" to "very rare". LCP drops from 5-6 s to ~2 s.

**Risk**: medium — touches the boot path. Every `frappe.*` API we miss in the shim breaks a specific flow.

**Mitigation**: feature-flag via `posa_use_web_route` POS Profile setting. Operators opt in per-shop; can roll back per-terminal by toggling the flag and reloading.

#### Phase 1 — status (2026-05-12)

Phases 1.A — 1.D landed: `/posapp` web route boots end-to-end. Verified
on lab.

| Step | Status |
|---|---|
| 1.A web controller + Jinja shell | ✅ |
| 1.B `frappe-shim.ts` (~470 LOC) | ✅ |
| 1.C separate Vite entry + manifest plumbing | ✅ |
| 1.D lab smoke + production fixes | ✅ |
| 1.E feature flag `posa_use_web_route` | ✅ |
| 1.F Page DocType redirect notice | ✅ |
| 1.G `sw.js` precache `/posapp` | ✅ |

Smoke fixes uncovered by browser exercise (commits `acecdcd0` +
`8186c671`):
- bundle minifier renames named exports → pin `mountPosApp` on
  `window.__posaMountPosApp`
- vue-router base hard-coded `/app/posapp` → detect from
  `location.pathname`
- template was missing jQuery, socket.io, and `.main-section` class
- shim didn't support positional `frappe.call(method, args)` form
- shim missed window globals (`flt`, `get_currency_symbol`, etc.) that
  Desk attaches directly
- shim missed `frappe.db.get_list / get_value` overload signatures
- shim dropped null arg keys; Desk sends them as empty strings
- telemetry rejected tz-aware ISO timestamps (Python 3.14 +
  MariaDB DATETIME)

**Measured baseline (lab, /posapp, opening shift open, items visible)**:
- DOM: 981 nodes (vs Desk's ~150 k, ~99 % reduction — exceeds the 60 %
  goal because the lab dataset has fewer Desk shells than prod)
- Console errors: 0
- Boot: SPA mounted within 2 s of the Vue mount marker firing

End-to-end verified: cash sale, credit sale (Unpaid invoice with
outstanding balance), draft save (lazy-loaded by Manage all),
customer-create endpoint. Sales recorded as `ACC-SINV-2026-01494…01496`.

Regression coverage now lives in
`frontend/tests/smoke/posapp.web-route.spec.ts` (8 tests covering
boot, cash sale, credit sale, draft save + resume, complex
multi-add+swap flow, customer create, telemetry tz, shim null args).
Run with `POSA_SMOKE_PATH=/posapp` and credentials in
`frontend/.env.local`.

---

### Phase 2 — Replace cart's v-data-table-virtual (2 days) — **landed**

Cart has 4-15 rows. v-data-table-virtual generates per-row dynamic CSS, watchers, scroll machinery — none of it needed. Custom `<table>` with `CartItemRow` rendering directly via `v-for` cuts:
- ~5 k CSS rule allocations per shift
- ~30 deep watchers per row mount
- ~80 ms re-render time per cart edit on slow phones

**Files**: `frontend/src/posapp/components/pos/invoice/ItemsTable.vue` (~270 LOC → ~150 LOC).

Shipped 2026-05-12 (commit `fdf1a148` bundled with Phase 1.H). All
preserved: CartItemRow row contract, expand-on-click, responsive
columns, search filter (via `visibleItems` computed), drag/drop,
empty state, name-edit dialog. Smoke spec stayed green.

### Phase 1.H — Drafts panel auto-refresh — **landed**

`save_and_clear_invoice` emits `eventBus.emit("draft_saved", …)`.
Invoice.vue subscribes via `_busHandlers` and re-fetches drafts
silently (new `quiet` flag in `get_draft_invoices` skips drawer
open + error toast). Operators no longer need to click "Manage all"
to see the count update. Commit `fdf1a148`.

**Risk**: low — only loses `expand-on-click`, `:search`, `:custom-filter` props (cart doesn't use them meaningfully; cart has 10 rows max).

---

### Phase 3 — Move ItemsSelector's catalog table to a dedicated SharedWorker (1 week)

The 5 k-item catalog lives in the main thread today. Every search runs a sync `filter` over the full array; every price-list apply mutates the full array; every detail fetch parses + assigns onto items. This work is parallelisable.

1. New `frontend/src/posapp/workers/catalogWorker.ts` (SharedWorker) owns the catalog Map.
2. Main thread queries via postMessage / Comlink.
3. Catalog operations (search, paginate, apply price list, merge lean results) run on the worker; main thread only receives the small visible window.
4. Multiple tabs share the same SharedWorker → second-tab open doesn't double the heap.

**Files**: new `catalogWorker.ts`; `itemsStore.ts` becomes a thin proxy; `useItemsSearch.ts` mostly removed (worker owns the indexes).

**Risk**: medium-high — debug story across worker boundary is harder; Comlink adds ~3 ms per round-trip. Needs careful design of which operations are sync vs async.

**Payoff**: main-thread heap drops by ~30 MB (catalog moves out); search no longer competes with rendering; price-list apply doesn't block input.

---

### Phase 4 — WASM hot paths (2 weeks, optional)

`_applyLocalPricingRules` is a hot path that walks all rules × all cart items in JS. For shops with many rules + many items, a 5-10 ms pass adds up across cart edits. Same for `performLocalSearch`'s substring matching.

Rust → WASM (`wasm-bindgen`) for:
1. Pricing rule index lookup + apply
2. Fulltext / fuzzy search over the catalog

**Payoff**: 5-10× speedup on those passes. Single-digit ms → sub-millisecond.

**Cost**: high — Rust setup, WASM bundle config, debugging tooling. **Only worth it if telemetry (Phase 0) shows these passes as p95 outliers.** Default verdict: defer.

---

### Phase 5 — Offline-first mutations + queue (3 days)

Today: invoice submit goes through `frappe.call` synchronously. If network blips mid-submit, the operator sees an error and has to retry manually.

1. All write operations (submit, cancel, return) go through `offlineSyncStore`'s outbox.
2. SW intercepts the request; on success, ACK to the SPA. On failure, queue + retry with backoff.
3. SPA shows "pending sync" indicator; operator can keep working.

**Files**: `frontend/src/offline/sync/`, `frontend/src/posapp/composables/pos/payments/usePaymentSubmission.ts`, new `frontend/src/sw-outbox.ts`.

**Risk**: medium — duplicate-submit prevention requires idempotency tokens server-side (`posawesome/posawesome/api/invoices.py` needs `idempotency_key` columns on Sales Invoice).

**Payoff**: 0 lost transactions on network blips. Operator never sees a transient-failure screen.

---

### Phase 6 — Pricing engine cache + reconciliation (1 week)

ERPNext's pricing engine is correct but slow (200 ms — 5 s per call). We fire-and-forget for UX, but the result lands eventually and can flicker.

1. Pre-compute pricing rules client-side from the snapshot (already done by `pricingRulesStore`).
2. Server-side: a "pricing rule index" doctype that we fetch ONCE per shift open and refresh on schedule. The current `get_active_pricing_rules` already builds it — just promote to a cached doctype with TTL.
3. SPA reconciles WITHOUT a server round-trip per cart edit; only on shift open and on explicit "refresh rules" admin action.

**Cost**: medium — touches the pricing API + adds a new doctype.

**Payoff**: 0 server round-trips per cart edit. Pricing apply is a pure 5-10 ms in-memory pass.

---

### Phase 7 — CI / regression-test harness (1 week) — **landed**

Frontend CI split into `static` (type/lint/unit) + matrix `smoke`
that runs Playwright at both `/app/posapp` and `/posapp` on every
PR. Skips cleanly when secrets aren't configured. Web-route spec
self-gates so the Desk leg only runs the existing global-errors
spec. Per-leg artifact upload on failure. Commit `ebf778ce`.

### Phase 8 — Dashboard mega-payload split — **landed**

`get_dashboard_data` kept for back-compat. Backend extracted
`_resolve_dashboard_context` + `_build_dashboard_envelope` and
added 17 per-section whitelisted endpoints + `get_dashboard_envelope`.
Frontend `dashboardService.ts` exports `fetchDashboardEnvelope` /
`fetchDashboardSection` / `DASHBOARD_SECTION_KEYS`. `Reports.vue`
fetches the envelope first, fans sections out via
`Promise.allSettled` with per-section loading/error refs. Commit
`43b57386`. Caveat: per-panel skeletons not wired (state refs
in place, template still keys off global `loading` — cheap follow-up).
vitest 542/542.

### Phase 5 — Offline-first mutations + queue — **audited, not implemented**

Audit landed in `3-SIGMA-PHASE-5-AUDIT.md` (commit `a7bb1b88`).
Existing scaffold is more built-out than the original plan
assumed: idempotency keys, outbox doctype, retry+backoff, server
ledger all already shipped. Real gaps: cancel/return outbox
routing, SW write interception, dead-letter UI, pending-sync
indicator wired to outbox. Honest 3-day landing plan in the audit.



Currently vitest (532 unit tests) + manual Playwright smoke. No regression-test loop.

1. Playwright E2E suite (~30 scenarios covering cart, pricing rules, customer change, M-Pesa, QZ Tray, drafts, returns).
2. Lighthouse CI on lab build → assert LCP / CLS / INP against thresholds.
3. Heap-snapshot regression: after 50-action scripted shift, assert `node_count < 3.5 M`, `_o + _s < 60 k`.
4. Block prod-deploy on red CI.

**Cost**: medium — Playwright write-up + CI plumbing.

**Payoff**: catch regressions before prod. The current cycle (deploy, wait for operator to crash, scramble) is unsustainable at 3-σ.

---

### Phase 8 — Replace the `posawesome.posawesome.api.dashboard.get_dashboard_data` mega-payload (1 week)

4 500-line endpoint returning one giant payload. Listed in `POSAWESOME-ROADMAP.md` Tier 4 (O21). Should be N small section endpoints, tabs lazy-load on demand. Cuts dashboard initial render time significantly. Outside the cart hot-path but affects perceived "snappiness" for owners viewing reports.

---

## 4. Estimated calendar

Assuming 1 dev, no other interruptions:

| Phase | Duration | After this, what's 3-σ-compliant |
|---|---|---|
| 0 — observability | 1 wk | (instrumentation only — no perf gain) |
| 1 — bypass Desk shell | 1 wk | LCP, OOM crashes |
| 2 — custom cart table | 2 d | INP on cart edits |
| 3 — catalog SharedWorker | 1 wk | INP on search, price-list apply |
| 5 — offline mutations | 3 d | invoice-submit reliability |
| 6 — pricing cache | 1 wk | INP on cart edits with pricing rules |
| 7 — CI / regression | 1 wk | future regressions caught early |
| 4 — WASM | 2 wk | (only if Phase 0 telemetry justifies) |
| 8 — dashboard split | 1 wk | dashboard LCP |
| **Total** | **6-8 weeks** | **all metrics in §2 satisfied** |

---

## 5. Recommendation

**Order: 0 → 1 → 2 → 7 → 5 → 6 → 3 → (skip 4 unless data demands) → 8.**

Phase 0 first: without telemetry every later phase is guesswork.

Phase 1 next: biggest leverage (60 % DOM cut, OOM kill, LCP halved). One week.

Phase 2 and 7 in parallel — different files. Custom cart table is cheap; CI harness is the safety net for everything after.

Don't tackle Phase 3 (worker) or 4 (WASM) until telemetry from Phase 0 shows those paths are the live p99 outliers.

Phase 8 last — affects dashboards, not the cart hot-path.

---

## 6. What this WILL NOT fix

Some things are structural and 3-σ requires accepting them:

- **Frappe v16 + Python 3.14 quirks** will keep emerging. Budget for 1 day per quarter chasing weird issues.
- **MariaDB lock contention** under heavy concurrent shift writes. Solved by sharding by terminal / shift, not by frontend work.
- **Browser extension interference** (the `billing.bundle.js` shadow-walk we saw). Operator-side mitigation: locked-down POS terminal profiles with no consumer extensions.
- **Network outages** > 30 s — even offline-first can't fully hide; operator needs visual feedback. Build it into Phase 5.

---

## 7. The 80-20 path

If you only have 2 weeks instead of 6-8: **Phase 0 + Phase 1** alone gets you ~70 % of the gain at ~20 % of the cost. Everything else after that is steady incremental work.
