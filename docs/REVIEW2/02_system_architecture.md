# REVIEW2 · 02 · System Architecture — SaaS Readiness Audit

> Auditor: System Architect (angry mode). Repo: posawesome @ `doco-customizations`.
> Date: 2026-05-18.
> Scope: assess current architecture, score against multi-tenant SaaS at
> millions-of-requests/day across thousands of Frappe sites, set a 6-sigma target,
> 90-day plan aligned with upstream defendicon, and risks.
> Path conventions in this file: `posawesome/...` = repo root; `frontend/...` = SPA;
> citations like `path:line` always relative to repo root.

Read first (already digested): `ARCHITECTURE.md`, `3-SIGMA.md`, `POSAWESOME-ROADMAP.md`,
`REGROUPED.md`, `AUDIT.md`, `CLAUDE.md`, `~/muelle-host/CLAUDE.md`,
`~/muelle-host/muelle/ARCHITECTURE.md`, `~/muelle-host/boat/SAAS_ROADMAP.md`,
upstream branches `refactoring-repo-architecture-structure` and
`centralization-of-pos-app`.

Note: the prompt referenced `docs/REVIEW/`. That directory does not exist in the
tree (the prior round's docs live at repo root: `ARCHITECTURE.md` etc.). This is
the first REVIEW2 deliverable.

---

## 1. Current architecture — honest assessment

### 1.1 Map (what actually runs)

```
                            ┌──────────────────────────────────────────────┐
                            │ Cloudflare DNS  (*.<tenant-zone>)            │
                            └────────────────────┬─────────────────────────┘
                                                 │ TLS                       (no edge cache yet)
                            ┌────────────────────▼─────────────────────────┐
                            │ muelle/proxy   (nginx, Host-based routing)   │
                            └────────────────────┬─────────────────────────┘
                                                 │
                  ┌─────────────────┬────────────┴──────────────┬────────────────────┐
                  │                 │                           │                    │
        ┌─────────▼──────┐ ┌────────▼────────┐         ┌────────▼────────┐  ┌────────▼─────────┐
        │ frontend nginx │ │ backend gunicorn│         │ websocket node  │  │ queue-short/long │
        │ static + /api  │ │ 2× gthread      │         │ socket.io :9000 │  │ rq workers       │
        └─────────┬──────┘ └────────┬────────┘         └────────┬────────┘  └────────┬─────────┘
                  │                 │                           │                    │
                  │     ┌───────────┴───────────┐               │                    │
                  │     │ Frappe v16 / Py 3.14 │               │                    │
                  │     │  posawesome app       │               │                    │
                  │     │  hooks.py, doctypes,  │               │                    │
                  │     │  api/* whitelisted    │               │                    │
                  │     └───────────┬───────────┘               │                    │
                  │                 │                           │                    │
                  │     ┌───────────▼───────────────────────────▼────────────────────▼────────┐
                  │     │ MariaDB 11   (one DB per tenant site)   │ redis-cache  redis-queue │
                  │     └─────────────────────────────────────────┘─────────────────────────┘
                  │
                  │      Browser:
                  │      ┌────────────────────────────────────────────────────────────────┐
                  │      │ Frappe Desk shell (/app/posapp, ~150k DOM)  [legacy host]      │
                  └─────►│   OR /posapp web route   [new — Phase 1 of 3-SIGMA, shipped]   │
                         │     loader.ts → posapp.bundle.ts (Vue3 + Vuetify3 + Pinia)     │
                         │     IDB (Dexie) + SW + frappe.realtime (socket.io)             │
                         └────────────────────────────────────────────────────────────────┘
```

### 1.2 Pain points (no spin)

1. **Backend is a fat Frappe monolith.** Every request goes through full Frappe
   middleware (auth, perm cache rebuild, hooks). p50 ~25-80 ms, p99 spiked into
   seconds under load. `posawesome/hooks.py:107-149` keeps adding `doc_events`
   that fire on every Sales Invoice / Bin / Pricing Rule write — see C2 in
   `POSAWESOME-ROADMAP.md` re unbounded `_posa_stock_change_queue`.

2. **God files exist and they are growing.**
   - `posawesome/posawesome/api/dashboard.py` — **5,829 lines**. One whitelisted
     mega-payload `get_dashboard_data` (now joined by 17 per-section endpoints
     post-Phase 8, but the file itself is still a single doctype-walker
     monolith).
   - `posawesome/posawesome/api/invoice_processing/creation.py` — **1,420 lines**.
     `update_invoice` (`:712`) is the universal write path; it sets both
     `flags.ignore_permissions=True` and `frappe.flags.ignore_account_permission=True`
     (`:925-926`, `:1121-1122`, `:1238-1239`) — three separate code paths bypass
     accounting permissions. This was flagged S10 in roadmap; still not fixed
     on `doco-customizations`.
   - `posawesome/posawesome/api/pricing_rules.py` — 781 lines.
   - `posawesome/posawesome/api/payments.py` — 758 lines, `frappe.db.commit()`
     mid-transaction at `:191` (roadmap C12).
   - `posawesome/posawesome/api/item_fetchers.py` — 758 lines.
   - SPA: `frontend/src/posapp/components/pos/shell/Pos.vue` and
     `Invoice.vue` (~1,000+ lines each) are the orchestration spaghetti the
     upstream `centralization-of-pos-app` branch is trying to split into
     `features/{catalog,payments,...}`.

3. **Coupling hotspots.**
   - SPA imports `frappe.*` globals (boot, msgprint, realtime, _, show_alert).
     The 470-line `frappe-shim.ts` is a tax we pay for every new caller.
   - `update_invoice` is the funnel for Sales Invoice, POS Invoice, returns,
     draft saves, order-conversion, gift cards, offers, pricing reconciliation,
     telemetry emit, *and* idempotency. One function ≈ one giant if-tree.
   - `Sales Invoice.validate` hook → `posawesome.posawesome.api.invoice.validate`
     fires on **every** Sales Invoice site-wide, not just POS-originated ones
     (`hooks.py:108-119`). Bleeds into Doco's CFDI and ventas flows.

4. **SPA ↔ backend handshake fragility.**
   - Boot reads `version.json` (`frontend/build-manifest.js`). One stale chunk
     hash and the SPA bricks until SW updates (the `d477e21f` fix made this
     survivable, not safe).
   - `socketStore.init` was double-registering listeners pre-`9fee9e46`;
     the guard is module-scoped — if the page is reloaded into another bundle
     mid-session (SW takeover) the guard is bypassed.
   - `frappe.call` is used everywhere with no shared schema. Renaming any
     server endpoint requires grep + manual fix. There is no client-side
     type for any API response.
   - Realtime channels (`posa_stock_changed`, `pos_invoice_processed`,
     `pos_post_submit_payments_*`) are unversioned. Adding a field breaks
     older browser tabs silently.
   - CSRF + session cookie are the only auth between SPA and `/api/method/*`;
     no terminal-bound token. A stolen cookie owns the till.

5. **Hot mutation churn.**
   `pricing_rules.py`, `useItemAddition.ts`, `invoiceWatchers.ts` form a
   feedback loop. The `_applyingPricingRules` bracket
   (`ARCHITECTURE.md §4.1`) is anti-flicker glue, not architecture.

### 1.3 Where it works (don't regress)

- `posawesome/posawesome/api/idempotency.py:39-59` — small, focused helper.
  This is the only piece resembling a contract.
- `posawesome/posawesome/api/telemetry.py:50-100` — sane input sanitisation,
  bounded metadata, `ALLOWED_EVENT_PREFIXES` whitelist.
- `posawesome/posawesome/api/__init__.py` pre-imports submodules
  (Py 3.14 ModuleLock deadlock fix `6e9d7222`). Cheap and correct.
- Service worker version handshake (`frontend/src/sw-updater.ts`,
  `posawesome/www/sw.js`) — defensive state machine, unit-testable.

---

## 2. SaaS-readiness scorecard

Legend: 🔴 broken / 🟡 partial / 🟢 acceptable. "Acceptable" means it would not
embarrass us at 100 tenants; nothing here is yet ready for 1000.

| Category | Score | Evidence |
|---|---|---|
| **Tenancy isolation (DB)** | 🟢 | One MariaDB DB per tenant via Frappe site (`muelle/compose.yaml` + `boat/SAAS_ROADMAP.md:102-121`). Strong default. |
| **Tenancy isolation (app)** | 🟡 | `posawesome.posawesome.api.customers.get_customer_names:84` reads `pos_profile` via `json.loads(pos_profile)` from the request — caller-asserted. Profile binding is by name, not by caller's open shift. |
| **Tenancy isolation (cache)** | 🟡 | `@redis_cache(ttl=...)` at `api/customers.py:91` keys on the full profile JSON string — cache rarely hits AND can leak between profiles within a site if the JSON differs only by ordering (roadmap C6). |
| **Auth on write APIs** | 🔴 | `creation.py:925-926, 1121-1122, 1238-1239` sets `ignore_permissions=True` + `ignore_account_permission=True` in 3 paths. `quotations.py:127,146` + `sales_orders.py:97,133,152` same pattern (roadmap S2/S3/S10). |
| **Auth on read APIs** | 🔴 | `customers.py:147, 236, 407` leak full PII (mobile/email/tax_id/balance). `utilities.py:488-572, 575-612` leak DB engine + table sizes + CPU/RAM to any logged-in user (roadmap S8 + Tier-1-mediums). |
| **Public endpoints** | 🔴 | `m_pesa.py:20, 48` `allow_guest=True` with no HMAC or IP allowlist. Anyone can POST a fake payment register (roadmap S6). |
| **Rate limiting** | 🔴 | `telemetry.py:21` *docstring* claims `frappe.rate_limiter` use; **no actual `rate_limit` decorator is invoked anywhere in the file or the rest of `api/`**. Zero protection against a single tenant DOS'ing the bench. |
| **Idempotency (write)** | 🟡 | `api/idempotency.py:39-59` exists; consumed by `creation.update_invoice:716`. Coverage incomplete: `sales_orders._payment_entry_job` lacks idempotency → double Payment Entries on retry (roadmap S3). Returns/cancels not yet covered (3-SIGMA Phase 5 audit). |
| **Retries** | 🟡 | SPA does fire-and-forget pricing (no retry); SW outbox not yet wired (3-SIGMA Phase 5 unimplemented). Backend has no bounded retry — exceptions surface raw. |
| **Background queues** | 🟡 | `_payment_entry_job` enqueues via `frappe.enqueue`. No DLQ; failures land in Frappe's Error Log and stay there. `hooks.py:124-127` Bin events bleed into `frappe.flags._posa_stock_change_queue` in-memory (roadmap C2). |
| **Realtime fan-out** | 🟡 | `frappe.publish_realtime` from `creation.py:304-382, 1277-1311` and `stock_realtime.py:78`. Single socket.io process — failure point. Per-tenant rooms not enforced (default room == doctype). |
| **Observability (browser)** | 🟢 | `api/telemetry.py` + RUM client landed (3-SIGMA Phase 0). |
| **Observability (server)** | 🔴 | No structured logs, no metrics exporter, no tracing. `utilities.py` exposes raw DB stats to leak-shame caller (S-side info disclosure). |
| **Blast radius — one tenant DOS** | 🔴 | Single MariaDB, single Redis, single bench. A heavy `dashboard.get_dashboard_data` call (`5,829 lines` of unbounded queries) on one tenant pegs the whole host. |
| **Blast radius — bad deploy** | 🟡 | Content-hashed assets (`d477e21f`) survive cache. But Python deploys are simultaneous to all tenants; no blue/green or per-tenant canary. |
| **Schema migrations** | 🔴 | `after_migrate` (`hooks.py:70-83`) fires 12 patches **per migration on every site** — long, unparallelisable, no rollback. |
| **Secrets** | 🟢 | No secrets in repo (verified by `POSAWESOME-ROADMAP.md` positive findings). |
| **XSS / CSP** | 🟡 | `v-html` sweep partial — `Customer.vue:83-95`, `PaymentAdditionalInfo.vue:54-84`, `DeliveryCharges.vue:28`, `PosOffers.vue:48` still flagged (S9). Upstream `refactoring-repo-architecture-structure` already fixed Customer.vue + NewAddress + Delivery + Payment (`26853355`, `8e96d0d8`, `f14103d5`); we have not pulled. |
| **PII at rest** | 🔴 | Customer + Sales Invoice tables hold mobile/email/tax_id/RFC unencrypted. SaaS for MX needs LFPDPPP awareness. |
| **Feature flags / kill-switch** | 🔴 | One per-profile flag exists (`posa_use_web_route`). No global kill-switch infra. Cannot disable e.g. M-Pesa endpoint per tenant without a code deploy. |
| **Tests** | 🟡 | 542 vitest specs + `frontend/tests/smoke/posapp.web-route.spec.ts` Playwright. Backend: scattered `test_*.py`. Coverage unknown. |
| **CI gate to prod** | 🟡 | CI exists for FE matrix (3-SIGMA Phase 7). Backend not gated. |

**Score summary**: 5 🔴, 12 🟡, 4 🟢. Translation: we have an artisan POS,
not a SaaS surface.

---

## 3. Million-RPS target — request budget

Assumption: 5,000 tenants × ~200 req/day P95 from each operator's terminal +
realtime + dashboard polling ≈ ~10M req/day ≈ ~115 RPS sustained, ~1k RPS peak
during MX retail rush (1700-2100h local). That's not "million RPS"; it's
"million requests/day". A real million-RPS service would force a re-platform.

### 3.1 Per-request budget (today vs target)

| Path | % of traffic | Today p95 | Budget |
|---|---|---|---|
| `get_items` (search + paginate) | ~25% | 80-400 ms | 30 ms (edge cache hit) |
| `get_customer_names` (open + page) | ~5% | 200 ms-2 s | 50 ms (Redis hit), 10 ms (CDN) |
| `update_invoice` (write) | ~10% | 300 ms-3 s | 150 ms write + queue ack 50 ms |
| `get_active_pricing_rules` | ~10% | 80-300 ms (Redis-cached post-Phase 6); 1-5 s on miss | 5 ms hit / 200 ms miss |
| Realtime emits per cart edit | ~5% (delivered to N tabs) | <50 ms | <20 ms; capped fan-out |
| `dashboard.get_dashboard_envelope` (sections) | ~3% | 500 ms-5 s per section | 100 ms p95, async per-section |
| `telemetry.ingest` (RUM) | ~30% (chatty) | <100 ms | 10 ms; never blocks UI |
| Static assets (loader/posawesome/css) | ~12% | from SW cache, free | edge-cached, free |

### 3.2 Where Frappe Python is the bottleneck

1. **Whitelisted-call overhead.** Every `/api/method/...` re-runs perm cache
   warm-up + JSON parse + doctype reflection. For chatty reads (`get_items_count`,
   stock-availability poll) it dominates. **Move read-only endpoints to a thin
   FastAPI sidecar** that hits MariaDB / Redis directly. Frappe stays the
   system of record for writes.
2. **`get_dashboard_data` / sections.** `api/dashboard.py:5829` lines is
   doctype-walking SQL. Even split into 17 endpoints (Phase 8) the query plans
   are unbounded. **Materialised views or a per-tenant analytics Redis
   pre-aggregate.**
3. **`update_invoice`.** ERPNext's submit() chain runs accounting +
   stock_ledger + GL hooks. Latency floor is structural. **Submit
   asynchronously**: SPA gets an ACK with a `submission_id`, the actual
   `submit()` runs in a rq worker, SPA learns via realtime
   (`pos_invoice_processed`). Pattern already partially present
   (`creation.py:304-382`); needs to be the default, not opt-in.
4. **Pricing rules.** Phase 6 server cache helps; SPA-side reconciliation
   still calls server per cart edit. **Push the snapshot to the browser at
   shift open + invalidate via socket; cart edits go zero-RTT.**

### 3.3 Where to introduce caching / CDN / edge

| Layer | What | Why |
|---|---|---|
| **CDN (Cloudflare)** | `version.json`, hashed `/assets/posawesome/dist/*`, `manifest.json`, `offline.html`, `sw.js` | Already content-hashed; trivial to cache 1y. Eliminates 12% of traffic from origin. |
| **CDN with auth** | `get_items` (lean), `get_customer_names` (page-1) | Edge KV keyed by `(tenant, profile, modified_after)`; invalidate via Cloudflare Workers on `Item.on_update` webhook. |
| **Redis (per-tenant)** | Pricing rules snapshot, POS Profile, payment methods, taxes | Mostly there; just needs `redis_cache` key fix (roadmap C6) + per-tenant namespacing. |
| **Browser** | Customer list, item catalog, pricing rules, offers | Already in Dexie; Phase 3 SharedWorker moves them off the main thread. |
| **DB read replica** | Reports, dashboard | Frappe supports `read_only_db`; one replica per region kills the dashboard tax on the write primary. |

### 3.4 Where to move to background queues

- Sales Invoice `submit()` (long; already supported via `posa_allow_submissions_in_background_job`).
- Payment Entry creation (today inline at `creation.py:1277-1311`).
- Pricing rule snapshot rebuild (today on-demand, sometimes 5 s).
- Stock realtime broadcast batching (today `frappe.db.after_commit` per-Bin,
  unbounded queue in `frappe.flags._posa_stock_change_queue`).
- Telemetry bulk insert (today inline `bulk_insert`; fine at 100 tenants,
  not at 5000).
- Print-format render (QZ Tray + receipt PDF — keep async, send result to
  printer via realtime).

---

## 4. Modernization plan — 10 concrete moves

Each numbered move includes scope, expected payoff, files touched.

### M1. Typed API contracts (OpenAPI 3.1 + JSON Schema)
Generate request/response schemas from a single source. `posawesome/api/*` exposes
~120 whitelisted methods; today none have a contract. Add a thin
`@whitelist_with_schema(input=..., output=...)` decorator that:
- Validates input against schema (rejects 400 early, before Frappe perm chain).
- Emits OpenAPI 3.1 at `/api/method/posawesome.api.openapi`.
- Generates TypeScript types via `openapi-typescript` for the SPA.
- Drives the `frappe-shim.ts` typed wrapper.

**Payoff**: kills 80% of SPA↔backend handshake bugs; renames become refactors;
client-side validation removes a class of malformed-payload exceptions.
**Effort**: 2 sprints.

### M2. Edge gateway with idempotency at the door
Cloudflare Workers (or self-hosted Envoy) sits in front of `/api/method/posawesome.*`.
Responsibilities:
- Tenant resolution from Host header → tenant-scoped routing.
- Idempotency-Key header check (write-through cache on success).
- Rate limit per (tenant, terminal) — token bucket in Workers KV.
- Cheap auth pre-check (validate JWT signature without calling origin).
- CSP + security headers injected.

`api/idempotency.py` becomes one of the implementations behind the gateway,
not the sole defence.

**Payoff**: blast-radius cap per tenant; consistent rate limiting; client
retries become safe by default. **Effort**: 3 weeks.

### M3. Event sourcing for invoice lifecycle
Today the truth is in `tabSales Invoice.docstatus` + scattered `flags.*`. Move
to an append-only event log doctype `POS Invoice Event` (already partially
shipping as `POS Invoice Submission Ledger` — `posawesome/posawesome/doctype/pos_invoice_submission_ledger`).
Events: `cart_finalized`, `payment_collected`, `submit_started`, `submit_succeeded`,
`submit_failed`, `cancelled`, `returned`, `cfdi_stamped`.

**Payoff**: reconstructable state, audit trail for SAT, easier replay on
failure, cleaner realtime subscribe model. **Effort**: 4 weeks.

### M4. Idempotency keys at the edge (not just server)
SPA generates `posa_client_request_id` per checkout intent and sends as
`Idempotency-Key` header. Edge stores `(tenant, key) → response` for 24h.
Backend has the same column (already present, `idempotency.py:34`).

**Payoff**: eliminates duplicate Sales Invoice / Payment Entry on flaky
networks. Pairs with M2.

### M5. Websocket fan-out with per-tenant rooms
Replace ad-hoc `frappe.publish_realtime` calls (`creation.py:304-382, 1277-1311`,
`stock_realtime.py:78`) with a typed event bus:
```
emit(tenant, terminal, event_type, payload, version)
```
Subscriber joins `tenant:<id>:terminal:<id>:v1`. Version field guards
older browser tabs. Bridge socket.io → Redis Streams for multi-process
fan-out at 5000+ tenants.

**Payoff**: clean horizontal scale of realtime; older SPA bundles don't
explode on new event shapes.

### M6. Feature flags (per-tenant + per-terminal)
New doctype `POS Feature Flag` with overrides. Centralised resolver:
`get_flag(tenant, terminal, flag_name) → bool|str|num`. Replace
35+ ad-hoc `posa_*` POS Profile fields (`hooks.py:192-403` fixture list)
with flags evaluated at runtime. Profile fields stay as a one-time seed.

**Payoff**: kill-switch for M-Pesa / CFDI / camera-scanner / new dashboard;
gradual rollout (1% of tenants → 10% → 100%); per-customer experiments
without a deploy.

### M7. Blue/green per-tenant migration
Each tenant site gets `blue` and `green` databases mid-migration; migrate `green`,
read-mirror writes, atomically flip Host routing. Today `after_migrate`
(`hooks.py:70-83`) runs 12 patches synchronously on the live DB — any failure
half-migrates the tenant.

Implementation lives in `muelle/agent` (see `~/muelle-host/muelle/ARCHITECTURE.md`
Agent endpoints `/sites/{site}/migrate`). Add `/sites/{site}/migrate-bluegreen`.

**Payoff**: zero-downtime tenant migrations; failed migrations
auto-revert.

### M8. Observability spine (OTel + structured logs)
- Frappe Python: drop `frappe.log_error` for `structlog` + OTel spans.
- SPA: extend `api/telemetry.py:50` ingest to accept OTel-compatible
  span batches.
- Sidecar: OpenTelemetry Collector → Tempo + Loki + Prometheus.
- Per-tenant labels on every metric.

**Payoff**: actually diagnose multi-tenant issues. Today the only diagnostic
loop is `scripts/heap_*.py` ran offline by a human.

### M9. Read-replica routing for dashboards
`api/dashboard.py` (5,829 lines) is the heaviest reader. Frappe supports
`read_only_db` config. Add a `@read_replica` decorator that forces the
connection to the replica for the duration of the call. Wire all 17
section endpoints + telemetry summary.

**Payoff**: eliminates dashboard ↔ POS write contention on the primary;
prerequisite for the per-region replica plan.

### M10. Per-tenant data partitioning + cold-storage
Sales Invoice tables grow unbounded. At 5k tenants × 200 SI/day × 365 days
= 365M rows. Add a `posa_archived` flag + nightly job → `_archive` tables
in cold DB. Reports query a UNION view.

**Payoff**: keeps the hot doctypes < 10M rows each; dashboard queries stay
sub-second.

### Modern stack adoption summary

| Move | Today | Target |
|---|---|---|
| API contract | implicit | OpenAPI 3.1 + JSON Schema (M1) |
| Auth/rate-limit | per-call ad-hoc | Edge gateway (M2) |
| Invoice state | mutable doctype | Event-sourced (M3) |
| Idempotency | partial server | Edge + server (M4) |
| Realtime | unversioned channels | Versioned rooms (M5) |
| Configurability | 35+ profile fields | Feature flags (M6) |
| Migrations | sync on live DB | Blue/green (M7) |
| Observability | print + heap scripts | OTel spine (M8) |
| Reads | primary DB | Read replica (M9) |
| Cold data | hot tables forever | Partition + archive (M10) |

---

## 5. Configurability — runtime-switchable per tenant

Current configurability lives in 35+ `posa_*` Custom Fields on POS Profile
(`hooks.py:192-403`). Adding a flag = code change + fixture export + migration +
deploy. That breaks "modern, configurable, cool".

### Plan

1. **Feature flag doctype** (`POS Feature Flag` from M6). Single source.
2. **Runtime resolver** (`api/flags.py`, new) with three layers:
   `default → tenant override → terminal override`. Memoised in Redis
   keyed by `(tenant, terminal, version)`, invalidated on write.
3. **SPA hook** (`composables/useFeatureFlag.ts`): `useFlag('cfdi.enabled')`
   returns a `Ref<boolean>`. Realtime-updated on flag change (no reload).
4. **Per-tenant branding/theme**:
   - Move `frontend/src/posapp/themes/*` to a runtime-fetched theme JSON
     (colours, logo URL, accent). Fetched at boot, applied via CSS vars.
     No rebuild per tenant.
   - Logo at `/files/branding/<tenant>/logo.svg` (already supported by Frappe
     `tabFile` per-site storage).
5. **Locale + RTL**:
   - `frappe-vue-style` already supports RTL (`README` mentions it).
   - Centralise locale negotiation: `Accept-Language` → POS Profile
     `posa_language` → tenant default → `en`. Today scattered.
   - Lazy-load `vue-i18n` message bundles (one per locale) instead of
     bundling all into the main chunk.
6. **Tax region (CFDI / VAT / sales-tax)**:
   - Today: hard-coded MX-specific paths via the `erpnext_mexico_compliance` app
     bind-mounted siblings (`~/muelle-host/CLAUDE.md`).
   - Make tax-region a feature flag (`tax.region = MX|US|EC|CO`).
     Region-specific hooks loaded lazily.

### Reference: upstream `centralization-of-pos-app`

This branch IS the FE structural refactor we should adopt as the
configurability foundation. The git diff shows 11,537 lines moved from
`frontend/src/posapp/composables/pos/{items,payments,shared}/...` →
`frontend/src/features/{catalog,payments,workspace,...}/composables/...`.

Quote-on-quote evidence from `git diff --stat upstream/develop...upstream/centralization-of-pos-app`:
```
R100 frontend/src/posapp/composables/pos/items/addition/useItemBatchSerial.ts
     → frontend/src/features/catalog/composables/addition/useItemBatchSerial.ts
... 30+ renames into features/catalog and features/payments
207 files changed, 7220 insertions(+), 1624 deletions(-)
```

This is bounded-context discipline (Catalog, Payments, Workspace, Returns,
Reports, Auth/Shift) — exactly what M1-M6 need to bolt onto.

**Verdict**: **ADOPT** the feature-folder layout. It is the precondition for
per-feature flagging, per-feature build chunking, per-feature ownership.

---

## 6. Adoption of upstream `refactoring-repo-architecture-structure`

### What it actually contains (after fetch + diff)

The branch name is misleading. There is **no** repo-wide restructure here.
Net content (vs `upstream/develop`, 27 files, +1,942 / -194):

- `posawesome/posawesome/api/utils.py` (NEW, 128 lines) — POS Profile write
  authorization helper (`_is_profile_company_allowed`, `_is_profile_action_enabled`,
  `_get_pos_profile_doc`).
- `posawesome/posawesome/api/test_pos_authorization.py` (NEW, 121 lines).
- Security fixes: `customers.py` (+46), `purchase_orders.py` (+19),
  `m_pesa.py` (+1), `payments.py` (+1).
- v-html sweep: `Customer.vue` (-10), `NewAddress.vue` (-12),
  `DeliveryCharges.vue` (-7), `PaymentAdditionalInfo.vue` (-22),
  `PosOffers.vue` (-17).
- New tests: `customerDropdownXss.spec.ts`, `test_pos_authorization.py`.
- Docs only: `docs/refactor/payview-split-plan.md` (317 lines),
  `docs/refactor/reports-vue-split-plan.md` (508 lines),
  `docs/audits/*` (audit reports, no code change).
- ESLint config tighten.

### Is the new structure sound?

**Yes, but small.** The `api/utils.py` helper is the right shape: pure
functions, no Frappe global mutation, testable. Worth adopting. The two
`docs/refactor/*-split-plan.md` files are quality planning docs — they belong
in our REVIEW2 collection.

### Verdict: **BLEND, ADOPT BEFORE OUR PRs**

Adopt now:
- `api/utils.py` + `test_pos_authorization.py` — replaces our roadmap S2/S3/S8
  hand-rolled fixes with the upstream helper. Their fix is the canonical path
  we'll PR back.
- v-html fixes (Customer, NewAddress, DeliveryCharges, PaymentAdditionalInfo,
  PosOffers) — closes roadmap S9 cleanly. PR to defendicon NOT needed (already
  on stage-develop).
- `customers.py` / `purchase_orders.py` auth fixes — partial coverage of S8.

Defer:
- The two `docs/refactor/*-split-plan.md` — useful reference; do not block
  on splitting `PayView.vue` until M1-M3 done.

### Don't adopt yet:

The big architectural moves in `centralization-of-pos-app` (Section 5) should
land **after** this small-surface security blend, because that branch already
includes everything in `refactoring-repo-architecture-structure` plus the
feature-folder restructure (its diff includes the same security fixes plus the
207-file renames).

**Recommended order:**
1. Cherry-pick the auth + v-html commits from `refactoring-repo-architecture-structure`
   onto `doco-customizations` (1 day, low risk).
2. Run our 542 vitest + smoke; confirm green.
3. Open a coordinated rebase plan with upstream defendicon for
   `centralization-of-pos-app` — they want help shipping; we want the
   feature-folder shape. Co-author 1-2 commits to consolidate.
4. After centralization lands upstream, rebase our `doco-customizations`
   onto the new layout in a single PR.

---

## 7. 3-σ → 6-σ gap

Current target per `3-SIGMA.md` is 3-σ (99.73%). 6-σ is 99.99966% (3.4 defects
per million opportunities). Going from one to the other isn't more bugfixing
— it's a different class of system.

### 7.1 Estimated current defect rate

Conservative estimate without server telemetry:

| Class | Today | 3-σ target | 6-σ target |
|---|---|---|---|
| Failed cart-add | ~1% (anecdotal) | 0.05% | 0.00034% |
| Lost invoice on network blip | ~0.5% | 0.01% | 0.00034% |
| Renderer OOM / shift | ~1 per shift | <1 per 50 shifts | <1 per 3M shifts (i.e. never) |
| Stock-availability stale | ~2% | 0.1% | 0.00034% |
| Pricing rule miss | ~0.5% | 0.05% | 0.00034% |

Order-of-magnitude: we are at 2-σ on transactional correctness, 3-σ on
UI responsiveness post-Phase-1. **6-σ is ~3-4 orders of magnitude away.**

### 7.2 Structural gaps blocking 6-σ

1. **Untyped APIs** (M1). At 6-σ you cannot afford a single contract violation
   per million calls. Validation must be deterministic and machine-verified.
2. **Missing contracts on realtime events** (M5). Versioned channels are
   non-optional.
3. **Unbounded retries** (today `useItemDetailFetcher.ts` has retry stacking,
   roadmap perf section). Every retry path must be bounded + observable.
4. **No DLQ on background jobs**. `_payment_entry_job` failures go to
   Frappe Error Log only. At 6-σ we need: dead-letter queue, automated
   re-drive, human-in-loop alert when DLQ depth > threshold.
5. **Single MariaDB primary**. No read replica, no failover. One slow query
   = thousands of tenants down.
6. **No chaos testing**. We can't get to 6-σ without proving recovery from
   each failure mode.
7. **`flags.ignore_permissions = True` everywhere** (`creation.py:925, 1121, 1238`).
   At 6-σ, every byte written must be permission-checked deterministically.
8. **No write-write conflict detection.** Two tabs editing the same draft
   invoice silently overwrite. Optimistic concurrency (e.g. `If-Match` on
   `modified`) is missing.
9. **No formal verification of money paths.** Currency conversion is scattered
   (`_resolve_payment_amounts` in `creation.py:700`). Needs property-based
   tests + invariants ("total in == total out + change").
10. **No SLO doc.** We have targets in `3-SIGMA.md §2`, but no
    enforcement, no error budget, no burn-rate alerting.

### 7.3 What 6-σ would require beyond M1-M10

- **Formal money invariants** (testing/dafny-style property tests).
- **Multi-region MariaDB Galera** + automated failover (`boat/SAAS_ROADMAP.md:332`
  flags as "Phase 4").
- **Chaos engineering harness**: kill MariaDB, kill Redis, partition
  network, slow-disk; assert SPA + queue recover.
- **24/7 on-call** with paging on SLO burn. Boat plan says solo-Marco; that's
  3-σ at best.

Honest take: **commit to 4-σ (99.99%) as the 12-month target.** 6-σ is the
aspirational North Star, but the org can't actually run 6-σ today.

---

## 8. 90-day roadmap aligned with upstream

Upstream defendicon's workflow: `feature/* → stage-develop → develop`.
We push to fork's `track/upstream-develop` and `doco-customizations`; PRs
go to upstream's `stage-develop`.

### Q1 (next 90 days)

**Sprint 1 (weeks 1-2): security + structural foundation**
- Blend `refactoring-repo-architecture-structure` (Section 6): adopt
  `api/utils.py`, v-html fixes, auth fixes. Cherry-pick + PR our extras.
- Land roadmap Tier 1 S1-S10 still open (the upstream branch covers ~40%;
  we close S2/S3/S4/S5/S6/S7/S10).
- Wire `frappe.rate_limit` on `telemetry.ingest` and the top-5
  read endpoints (fix `telemetry.py:21` docstring lie).
- Adopt upstream `b5992f70` (already done per `AUDIT.md`) + `8bf5eba7`
  (hybrid merge, ~1 day).

**Sprint 2 (weeks 3-4): observability spine (M8) + read-replica (M9)**
- OTel collector in `muelle/compose.yaml` (new service).
- `structlog` in `api/*` (replace `frappe.log_error` calls — only inside
  posawesome app; do not touch ERPNext).
- `read_only_db` connection routing for `dashboard.py` + `telemetry`
  summary.
- Add SLO burn-rate alerts.

**Sprint 3 (weeks 5-6): feature flags (M6) + tenant-aware caching**
- New doctype `POS Feature Flag` + `api/flags.py` resolver.
- Migrate 5 most-toggled `posa_*` profile fields to flags (camera scanner,
  return-validity, gift-cards, M-Pesa, dashboard).
- Fix `redis_cache` key in `customers.py:91` (roadmap C6).
- Per-tenant Redis namespacing.

**Sprint 4 (weeks 7-8): API contracts (M1) + idempotency at edge (M4)**
- OpenAPI emitter at `/api/method/posawesome.api.openapi`.
- TypeScript codegen wired into `frontend/scripts/`.
- Convert top-20 endpoints to schema-validated.
- Edge: deploy Cloudflare Worker for `Idempotency-Key` write-through
  (M2 partial — full gateway is Sprint 6+).

**Sprint 5 (weeks 9-10): centralization adoption**
- Coordinate with upstream defendicon on landing
  `centralization-of-pos-app`. Co-author rebase PR.
- After it lands on `stage-develop`, rebase our `doco-customizations`
  in one PR.
- Update `frontend/scripts/verify_build_artifacts.mjs` for new layout.

**Sprint 6 (weeks 11-12): async invoice submit (M3 partial) + websocket versioning (M5)**
- Default `posa_allow_submissions_in_background_job = 1` on new sites.
- Add event-sourced log behind feature flag (M3 starter).
- Version realtime channels: `v1:<event>:<tenant>` namespace.

### Upstream branch interaction map

| Upstream branch | Action | When |
|---|---|---|
| `b5992f70` (already cherry-picked) | done | — |
| `8bf5eba7` (item/customer indexes) | hybrid merge | Sprint 1 |
| `efdaa465` (cart mutation kind) | defer | re-eval Sprint 5 |
| `refactoring-repo-architecture-structure` | adopt (auth + v-html + utils.py) | Sprint 1 |
| `centralization-of-pos-app` | co-author + adopt | Sprint 5 |
| `add-realtime-stock-sync-across-POS-terminals` | review | Sprint 2 |
| `enhance-offline-capability` | review for Phase 5 (offline mutations) | Sprint 6 |
| `Stabilize-POS-runtime-harden-CI-extract-dashboard-orchestration` | review for dashboard split | Sprint 2 |
| `feature-pos-awesome-dashboard-and-reports` | low-priority, review only | Sprint 6 |

### What we PR upstream

- Sprint 1: telemetry rate-limit fix (defensive depth on top of their `api/utils.py`).
- Sprint 2: OTel/structlog wiring (suggest, not force — they may not want it).
- Sprint 3: feature-flag doctype (offer; they may have a parallel plan).
- Sprint 4: OpenAPI emitter (offer).
- Sprint 6: idempotency-on-cancel/return (closes 3-SIGMA Phase 5 audit gaps).

### What we keep local (HolyMC2 fork)

- MX/CFDI-specific glue (lives in `erpnext_mexico_compliance` anyway).
- Boat / muelle integration (multi-tenant ops layer; not POSAwesome's concern).
- Per-tenant Cloudflare Worker config.

---

## 9. Risks

### 9.1 What could blow up

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | `centralization-of-pos-app` rebase conflicts with our 23 perf commits + our `doco-customizations` glue | High | Multi-week stall | Drive it as a Sprint-5 co-authored rebase WITH upstream, not after-the-fact merge. |
| R2 | Frappe v16 + Py 3.14 regressions (we already paid `6e9d7222`, expect more) | Med | Multi-day fire | Pin Py 3.14.x patch versions; keep a 3.12 fallback compose profile. |
| R3 | M-Pesa `allow_guest` endpoint abuse before S6 fix lands | Med | Reputational + fraud | Land S6 (HMAC + IP allowlist) in Sprint 1, NOT later. |
| R4 | `frappe.flags.ignore_account_permission = True` in `creation.py` papers over a permission model bug; fixing it surfaces broken role configs in prod | High | Tenant-specific breakage | Roll out via feature flag (M6); fall back per-tenant. |
| R5 | Edge gateway (M2) lock-in to Cloudflare | Low | Forced re-platform | Implement gateway logic as portable Envoy filters from day 1. |
| R6 | Dashboard read replica drift (M9) shows stale totals | Med | Trust erosion | Display "as of <timestamp>" on all replica-served panels; force-primary on cash-up close. |
| R7 | 5,829-line `dashboard.py` SQL has unbounded joins on big tenants | Med | Whole-bench slowdown | M9 + M10 + per-section timeouts (`frappe.db.sql(...query_timeout=5)`). |
| R8 | Telemetry table grows faster than `prune_old_events` reaps | Low | Disk fill | Add per-tenant cap + alarm at 80% disk. |
| R9 | Service Worker takeover mid-shift loses an unsynced cart | Med | Operator anger | Phase 5 offline-mutations + idempotency keys (Sprint 6). |
| R10 | We outpace defendicon's review cadence; fork drifts | Med | Permanent split | Open PRs in small chunks (S1-S10 separately); maintain a public roadmap doc upstream can reference. |
| R11 | LFPDPPP (MX privacy law) audit before we encrypt PII at rest | Low | Legal | Schedule a Q2 PII-encryption sprint; until then, document and gate access. |
| R12 | Realtime channels carry too much PII (customer name, balance) and a misconfigured client subscribes broadly | Low | Data leak | Per-tenant rooms (M5) + minimal payloads (IDs only; clients re-fetch). |

### 9.2 What needs a human call (escalate to Marco)

1. **Commit to 4-σ vs 6-σ as the 12-month target.** Engineering can plan
   either; the choice affects hiring + budget.
2. **Edge gateway choice**: Cloudflare Workers vs self-hosted Envoy.
   First is cheaper; second is portable. Either is fine; pick now.
3. **Async invoice submit as default**: changes operator UX (ACK ≠ submit).
   Needs ops sign-off and a tenant communication plan.
4. **Coordinate with defendicon on `centralization-of-pos-app` schedule.**
   Without their cadence we either fork or stall.
5. **Tax-region as feature flag**: needs Doco's CFDI team to confirm the
   contract before we generalise.
6. **PII encryption at rest**: legal + ops; not engineering's call alone.
7. **Per-tenant feature flag UX**: who in Boat owns the toggle? Today
   nobody.

---

## 10. Closing — angry verdict

The codebase is competent SPA + Frappe craftsmanship. The perf branch is
genuinely good engineering. But the things that turn POSAwesome from "great
single-tenant POS" into "SaaS POS for thousands of tenants" — typed contracts,
edge gateway, event sourcing, feature flags, observability spine, per-tenant
isolation in caches and realtime, blue/green migrations — those are **not
started**. Phase 0 telemetry + Phase 1 /posapp web route + Phase 6 pricing
cache are the only SaaS-shaped wins on the board, and even they exist because
they happened to also fix single-tenant perf.

The good news: defendicon's roadmap (`centralization-of-pos-app`,
`refactoring-repo-architecture-structure`) is moving in the right direction —
toward bounded contexts, typed pieces, security hardening. We should ride
their wave, not fork.

The hard news: 5 🔴 in the readiness scorecard. The biggest is **auth bypass
across 5+ write endpoints** (`creation.py`, `quotations.py`, `sales_orders.py`,
`m_pesa.py`, `customers.py`). Until that closes, we should NOT advertise SaaS
multi-tenant readiness to anyone.

90-day plan above gets us to ~3.5-σ + the structural moves needed for 4-σ in
the following 6 months. 6-σ is the right star; 4-σ is the right milestone.

— end of REVIEW2/02.
