# ROADMAP-SAAS — Posawesome multi-tenant readiness

> Synthesis lead, 2026-05-18. Inputs: `REVIEW2/01..08`.
> Companion docs: `PLAN-6SIGMA.md` (phases + workstreams),
> `UPSTREAM-PRS.md` (PR sequence).
>
> What "SaaS-ready" means here: a non-doco tenant can be on-boarded
> without an asterisk in the contract. SOC2 audit gap-list ≤3 highs.
> 4-σ on cart-add / submit / boot for 30 consecutive days. Per-tenant
> rollback < 1 min MTTR. Zero cross-tenant data leaks.

---

## 1. Capacity envelope (cite report 02)

Anchor numbers (`REVIEW2/02 §3`, `REVIEW2/04 §7.2`):

- **Fleet target**: 1,000–5,000 tenants × ~10 terminals/tenant × ~8 h
  shifts.
- **Sustained**: ~115 RPS, derived as
  `5,000 tenants × 10 terminals × ~200 ops/terminal/day ÷ 86,400 s ≈ 115`.
  Do NOT read the bare `5,000 × 200` (which would imply ~11.6 RPS) —
  the per-terminal multiplier is load-bearing. "Ops" here are user-driven
  HTTP requests (item-search, add-to-cart, submit, sync, telemetry beacons).
- **Peak (3-min bursts, MX retail rush 17-21h)**: ~1k RPS realistic;
  ~7k RPS extreme during stock-affecting tx storms.
- **Per-terminal request profile (peak hour)**: ~0.29 RPS / terminal,
  dominated by item-search keystrokes (~600/h) and add-to-cart (~180/h)
  with submit-invoice at ~25/h (`REVIEW2/04 §7.1`).

**Not a million-RPS service.** Anyone reading "millions" should
substitute "millions per day". A real million-RPS POS forces a re-platform
(Frappe replaced by a Go/Rust service tier behind the SPA). That is
**not on the roadmap.** Frappe stays as the system of record for writes;
a thin FastAPI sidecar takes chatty reads when the read-replica isn't
enough (`REVIEW2/02 §3.2 row 1`).

Frappe gunicorn capacity: on a 16-core box, 32–64 sync workers can hold
375 worker-seconds/sec for `submit_invoice` at p99 = 2.5s. Implies
≥5–8 boxes per pod at fleet target. Asynchronous submit on by default
(P2 milestone) drops this 5× — that's the single biggest scaling lever
(`REVIEW2/04 §7.3`).

---

## 2. SaaS-readiness milestones

Each milestone has scope, exit criteria, ETA (in days from
2026-05-18), and workstream dependencies (security S, perf P, mobile M,
code-quality C, api A, devops D, upstream-sync U).

### M-01 — Tenant scope enforcement

- **Scope**: `_scope.py` helper with `assert_company`, `assert_profile`,
  `assert_customer_in_profile`; wired to top-15 write endpoints; client
  `is_supervisor` flag dropped (re-derived from `frappe.get_roles`);
  `permission_query_conditions` hooks for 7 POSA doctypes.
- **Exit criteria**: cross-company write attempt returns 403 (test);
  list-queries via `frappe.get_list` honour scope; `is_supervisor`
  client flag returns 400; sub-15s p99 latency overhead for the scope
  assertion (cache lookups Redis-backed).
- **ETA**: 30 days (P1).
- **Depends**: S (lead), C (split files), U (XSS/authz cherries from
  `refactoring-repo-architecture-structure`).
- **Findings**: `REVIEW2/03 §2.1-2.4, §10 PR-1`,
  `REVIEW2/06 §10.1 (c805f8a0/3c6c75e3/359c0a74)`.

### M-02 — Server-side reprice + payment invariant

- **Scope**: `_reprice.py` re-fetches line rates from `Item Price`
  master; pricing rules re-applied with `ignore_pricing_rule = 0`;
  discount cap enforced via `posa_max_discount_allowed`; payment-vs-total
  invariant `sum(payments) == grand_total ± tolerance`;
  `posa_allow_user_to_edit_rate` honored server-side within ±20% of
  master price; customer auto-create restricted to role allowlist.
- **Exit criteria**: malicious `rate=0.01` payload rejected; legitimate
  manual rate edit within band passes; property-based test
  (`fast-check`) on price invariant green; new error code
  `PAYMENT_TOTAL_MISMATCH` surfaces consistently.
- **ETA**: 45 days (P1 late → P2).
- **Depends**: M-01 (S provides scope helpers); A (PR-API1 envelope).
- **Findings**: `REVIEW2/03 §3, §10 PR-2`.

### M-03 — Edge gateway with idempotency at the door

- **Scope**: Cloudflare Worker (or self-hosted Envoy filter) in front of
  `/api/method/posawesome.*`. Responsibilities: tenant resolution
  (Host → tenant DB), idempotency-key write-through cache
  (`Idempotency-Key` header, 24h TTL), per-tenant token-bucket
  rate-limit (Workers KV), JWT pre-check, CSP+HSTS+X-Frame-Options +
  Permissions-Policy injection. Portable Envoy filters from day 1 to
  avoid Cloudflare lock-in (R-07).
- **Exit criteria**: replay test for 12 write endpoints; per-tenant rate
  storm doesn't starve neighbours; CSP nonce propagates to inline boot
  script; gateway is live on 1 canary tenant.
- **ETA**: 90 days (P2).
- **Depends**: A (PR-API2 idempotency everywhere); M-01.
- **Findings**: `REVIEW2/02 M2`, `REVIEW2/03 §7.2`,
  `REVIEW2/07 §4, §9`.

### M-04 — OpenAPI 3.1 contract surface

- **Scope**: `@posa_api(stability, since, request, response, methods,
  idempotent, replay_key)` decorator backed by Pydantic v2 schemas.
  Emit OpenAPI at `/api/method/posawesome.api.openapi`. TypeScript
  codegen via `openapi-typescript` into `frontend/src/posapp/types/api/*.ts`.
  Top-20 endpoints converted in P2; remaining ~80 in P3.
- **Exit criteria**: spec generates deterministically; CI diff fails on
  uncommitted change; SPA imports typed wrappers (no `as any` for the
  top-20); Redoc panel served at `/posapp/dev-tools/api`.
- **ETA**: 90 days (P2) for top-20; 180 days (P3) for full surface.
- **Depends**: C (split files first for clean schemas); A (lead).
- **Findings**: `REVIEW2/07 §3, §7, §11 PR-4`.

### M-05 — Observability spine (OTel + structlog + RUM)

- **Scope**: Browser RUM already shipped
  (`frontend/src/posapp/utils/telemetry.ts`); push to `stage-develop` as
  `PR-C`. Add backend OpenTelemetry SDK (Python) wrapping
  `@frappe.whitelist()`; OTLP → OTel Collector sidecar → Jaeger/Tempo +
  Loki + Prometheus. Per-tenant labels on every metric. `structlog`
  replaces `frappe.log_error` in `posawesome/api/*` (do not touch
  ERPNext). Prometheus + Grafana + Alertmanager on boat host.
  Multi-window multi-burn-rate alerts (Google SRE pattern).
- **Exit criteria**: 95% of submit_invoice flows visible end-to-end
  trace; SLO burn alerts page; cross-tenant Grafana dashboard live;
  golden signals per surface (`REVIEW2/08 §5.4`) tracked.
- **ETA**: 60 days (P1 collector + structlog) + 30 days (P2 dashboard).
- **Depends**: D (lead); U (PR-C upstream).
- **Findings**: `REVIEW2/02 M8`, `REVIEW2/08 §5/§6/§7`.

### M-06 — Per-tenant blue/green migration

- **Scope**: `boat tenant deploy posawesome <version> --channel
  canary --percent 5 --health-check ... --watch-minutes 60 --auto-
  rollback-threshold-...`. Each tenant has `blue` and `green` slots;
  `bench migrate` on green; health probes (§6 below); atomic
  bind-mount flip + proxy restart. Pre-migrate DB snapshot for rollback.
  Sub-minute MTTR.
- **Out-of-scope for posawesome**: the blue/green orchestrator itself
  lives in the sibling `boat` control-plane repo, not posawesome. This
  milestone tracks the posawesome-side **contract**: health-probe set,
  manifest, version metadata, idempotent migrate, the
  `posa.kill.maintenanceMode` flag, the `assert_no_inflight_writes`
  drain hook. The actual `deploy-tenant.sh` + cohort scheduler + auto-
  rollback is `boat`'s deliverable (`team:control-plane`, R-17 in
  PLAN-6SIGMA §6).
- **Exit criteria**: synthetic 5xx storm on canary auto-rollback
  triggers ≤60s (verified end-to-end with boat); blue retained 30d for
  instant rollback; staged-percentage rollout (5% → 25% → 100%)
  demonstrated on lab; posawesome ships the contract surface.
- **ETA**: 150 days (P3) for posawesome contract; boat orchestrator
  ETA tracked separately in `boat/SAAS_ROADMAP.md`.
- **Depends**: M-05 (need health probes); D + `team:control-plane`
  (boat owns the orchestrator).
- **Findings**: `REVIEW2/02 M7`, `REVIEW2/08 §3.4, §4.2-4.4`.

### M-07 — Feature flags + capability bootstrap

- **Scope**: Unleash-based kill-switch service on boat host. `POS Feature
  Flag` Frappe doctype mirrors flag state per tenant (60s poll). SPA
  `useFeatureFlag.ts` returns `Ref<T>` reactively; realtime invalidation
  on flag change (no reload). `api.session.bootstrap_capabilities`
  endpoint returns `{api_version, features, deprecated}` at boot.
  Migrate top-5 toggled `posa_*` POS Profile fields to flags
  (camera scanner, return validity, gift cards, M-Pesa, dashboard).
- **Exit criteria**: `posa.kill.webRoute` flag flip propagates to a live
  POS in <60s; offline-safe (IDB-cached last-known-good); per-tenant +
  per-terminal overrides work; capability bootstrap memoised per
  (tenant, terminal, version) in Redis.
- **ETA**: 90 days (P2).
- **Depends**: A (M-04 for capability schema); D (Unleash on boat).
- **Findings**: `REVIEW2/02 M6, §5`, `REVIEW2/07 §9.3`,
  `REVIEW2/08 §9.2`.

### M-08 — Modern UI / mobile-first parity

- **Scope**:
  - P1 floor: 44px coarse-pointer touch targets, manifest hardening
    (`start_url:/posapp`, single `theme_color`, 192/maskable icons,
    apple-touch-icon, `id`/`categories`/`lang`/`dir`/`shortcuts`).
  - P2: BackgroundSync invoice outbox, swipe-to-delete + undo,
    pull-to-refresh, 5-class breakpoint rewrite (adopt
    `feat-ui-ux-improvements`), KeyboardShortcutsDialog, density mode
    (adopt `integrate-ui-ux-max-pro-skill-in-repo`).
  - P3: Per-tenant brand chip from `boot.brand`; runtime theme JSON
    fetched at boot; per-tenant accent.
- **Exit criteria**: Lighthouse PWA score ≥90; INP p99 on phone <100ms
  on add-to-cart; 0 tap-targets <44 on coarse pointer (custom
  Playwright rule); per-tenant logo swaps live without rebuild.
- **ETA**: 30 days (P1 floor); 90 days (P2 gestures + dock dynamics);
  180 days (P3 brand-per-tenant).
- **Depends**: M (lead); A (M-04 capability bootstrap for tenant brand).
- **Findings**: `REVIEW2/05 §1/§3/§5/§8/§9/§10/§11`.

### M-09 — Async invoice submit as default

- **Scope**: `posa_allow_submissions_in_background_job = 1` on new sites.
  SPA gets ACK with `submission_id`; actual `submit()` runs in
  `pos-submit` rq queue; SPA learns via realtime `pos_invoice_processed`.
  Per-tenant priority routing to stop noisy tenants starving the pool.
  Per-tenant token-bucket Redis rate-limit on the queue.
- **Exit criteria**: submit ACK p99 < 400ms (vs 5–8s sync today);
  durable write p99 < 1.5s; queue depth alarms wired; tenant-cap fires
  before pool exhaustion.
- **ETA**: 120 days (P2 late).
- **Depends**: M-05 (need queue depth metric); M-07 (need flag to gate
  rollout per tenant); operator UX sign-off (R from `02 §9.2 open Q3`).
- **Findings**: `REVIEW2/02 §3.2 row 3`, `REVIEW2/04 §7.3-7.4`.

### M-10 — Read-replica routing + partition / cold storage

- **Scope**: `@read_replica` decorator forces connection to MariaDB read
  replica for the duration of the call. Wired across `dashboard.py`'s 17
  section endpoints + `telemetry.get_pos_telemetry_summary`. Per-region
  read replica (M9 in `REVIEW2/02`). `posa_archived` flag + nightly job
  → `_archive` tables in cold DB; UNION view for reports.
- **Exit criteria**: dashboard p99 < 2s on the replica; primary write
  contention drops 60%+; "as of <timestamp>" badge on replica-served
  panels (R-08); hot SI/POSI tables stay <10M rows.
- **ETA**: 150 days (P3).
- **Depends**: M-05 (metrics to prove drift); D + ops sign-off.
- **Findings**: `REVIEW2/02 M9/M10`, `REVIEW2/04 §2.1, §7.3 row 2`.

### M-11 — Event-sourced invoice lifecycle

- **Scope**: Append-only `POS Invoice Event` doctype (extends existing
  `POS Invoice Submission Ledger`). Events: `cart_finalized`,
  `payment_collected`, `submit_started`, `submit_succeeded`,
  `submit_failed`, `cancelled`, `returned`, `cfdi_stamped`.
  Reconstructable state for audit. Replay on failure.
- **Exit criteria**: round-trip submit reproducible from event log;
  cancellation+return path adds events not mutates flags; CFDI add-on
  consumes `cfdi_stamped` event.
- **ETA**: 180 days (P3).
- **Depends**: M-07 (gated rollout); CFDI team coordination
  (R from `02 §9.2 open Q5`).
- **Findings**: `REVIEW2/02 M3`.

### M-12 — Security baseline (CSP + headers + audit log + GDPR DSR)

- **Scope**:
  - CSP nonce in `posawesome/www/posapp.html` inline boot script;
    response-header CSP + HSTS + X-Frame-Options + Referrer-Policy +
    Permissions-Policy + COOP + COEP. Helmet-equivalent baseline at
    `REVIEW2/03 §7.2`.
  - `POS Security Event` doctype + helper `log_security_event`; wire to
    every `_scope.assert_*` failure, PIN events, privileged ops.
  - Retention: telemetry 30d, security 2y (GDPR+SOC2), submission ledger
    1y, posa-tagged Error Log 90d.
  - GDPR DSR endpoints: `gdpr_export_customer_data(customer)`,
    `gdpr_redact_customer(customer)` (anonymise while keeping financial
    ledger intact).
  - QZ cert validity → 365 days (was 11,499 — out of policy).
- **Exit criteria**: external pentest 0 critical / ≤3 high; SOC2
  CC6.1/CC6.3/CC6.7 controls pass; GDPR Article 15-22 endpoints exist;
  Lighthouse `Best Practices` ≥95.
- **ETA**: 180 days (P3).
- **Depends**: M-01 (scope is the substrate of the audit log); M-07
  (kill-switch per tenant for emergency disable).
- **Findings**: `REVIEW2/03 §7/§8/§9, §10 PR-4/PR-5`,
  `REVIEW2/08 §1.3 row 1`.

---

## 3. Milestone dependency graph

```
M-01 (scope) ──► M-02 (reprice) ──► M-12 (audit/CSP/GDPR)
   │                  │
   ▼                  ▼
M-05 (OTel) ────► M-06 (blue/green) ──► M-10 (read-replica/partition)
   │                  │                     │
   │                  ▼                     │
   │              M-07 (flags) ◄────────────┘
   │                  │
   ▼                  ▼
M-04 (OpenAPI) ──► M-03 (gateway) ──► M-09 (async submit)
                                          │
                                          ▼
                                       M-11 (event sourcing)

M-08 (mobile) ── depends on M-04 (capability bootstrap)
```

Critical paths:
- **Security spine**: M-01 → M-02 → M-12 (3 milestones, 180d)
- **Contract spine**: M-04 → M-03 → M-09 → M-11 (4 milestones, 180d)
- **Observability spine**: M-05 → M-06 → M-10 (3 milestones, 150d)
- **UX spine**: M-08 (independent, 180d total, P1-P3)
- **Configuration spine**: M-07 (gates many others, 90d)

---

## 4. Specific findings → milestone map

| Finding (`REVIEW2/Nx`) | Milestone |
|---|---|
| 03 §1.6 qz.sign_message oracle | M-12 P0 immediate; also `UPSTREAM-PRS PR-SEC1` |
| 03 §1.2 m_pesa.confirmation allow_guest | M-12 P0 immediate; `PR-SEC4` |
| 03 §3 client-trusted prices | M-02 |
| 03 §1.5 PIN no lockout + non-const-time | M-12; `PR-SEC4` |
| 03 §2.1-2.4 client-trusted scope | M-01 |
| 03 §5.2 IDB unencrypted PII | M-12 P3 |
| 03 §7 no CSP/HSTS | M-12 |
| 03 §8.2 PII in error logs | M-12 |
| 03 §9.2 no GDPR DSR | M-12 |
| 04 §2.6 5 missing DB indexes | P0 immediate (PR not needed — patch ships) |
| 04 §2.2 74 get_value N+1 in creation.py | code-quality split + `get_cached_value` sweep, P1 |
| 04 §3.4 catalog freeze residual | M-08 (worker search adoption P2) |
| 04 §6.1 single socketio process | M-03 (per-tenant rooms via Redis Streams) |
| 04 §7.4 sync submit pool starvation | M-09 |
| 05 §1 24px qty buttons | M-08 P1 |
| 05 §5 PWA manifest D+ grade | M-08 P1 |
| 05 §3 no swipe/long-press | M-08 P2 |
| 06 §1 55 god files | code-quality workstream (independent, P2) |
| 06 §3 type-safety theatre | C P3 (strict TS island) |
| 06 §3.1 1,073 `: any` | C P3 |
| 06 D1/F2 19 ignore_account_permission | M-01 precursor (contextmanager P1) |
| 06 V1 11 v-html sinks | M-12 P0; `PR-Q1` + upstream cherries |
| 07 §3 5% typed responses | M-04 |
| 07 §6 brittle locale-string errors | M-04 (PR-API1 helper) |
| 07 §4.2 idempotency only on invoice | M-03 (PR-API2 everywhere) |
| 07 §9 no capability bootstrap | M-07 |
| 08 §1.3 no security scanning | D P0; `PR-CI1` |
| 08 §3.4 no blue/green | M-06 |
| 08 §5.2 no OTel/metrics/traces | M-05 |
| 08 §6.3 no SLO burn alerts | M-05 |
| 08 §9 no feature-flag service | M-07 |

---

## 5. Upstream branches → milestone dependencies

| Upstream branch | Affects milestone | Action |
|---|---|---|
| `refactoring-repo-architecture-structure` | M-01, M-12 | P0 cherry-pick 6 security commits; rest defer until upstream lands it (R-02) |
| `centralization-of-pos-app` | M-04, code-quality | P2 co-author rebase with defendicon; bounded contexts unblock per-feature flagging |
| `feat-ui-ux-improvements` | M-08 | P2 adopt wholesale (highest-value UX branch); rebase carefully on our cart-perf work |
| `integrate-ui-ux-max-pro-skill-in-repo` | M-08 | P2 selective adoption (KeyboardShortcutsDialog, density, focus rings) |
| `overhaul-responsive-cashier-flow-and-restore-frontend-build` | M-08 | P2 cherry-pick small targeted fixes (8 commits listed in `REVIEW2/05 §10`) |
| `move-offline-item-search-to-worker` (`5dca1ec7`) | M-04 (perf side) | P2 cherry-pick worker search behind `posa_use_worker_search` flag |
| `add-realtime-stock-sync-across-POS-terminals` | — | **Already adopted** (`stock_realtime.py` + `useItemAvailability.ts`); do NOT re-pull |
| `fix-app-performance-issues` (cart trio: `881ba161`, `2247c666`, `9f37d53c`) | M-02 precursor | P1 blend on top of our perf work; sequenced in `UPSTREAM-PRS PR-4..6` |
| Payment-precision chain (PR #3015 from `Manaa0-0/fix/multi-currency-payment-precision`, hashes `3f2136e7..cf6a6cb4`) | M-02 (currency invariant) | P1 cherry-pick clean (11 commits, pure take-theirs); CFDI lab regression on `ventas.lab.xolo` first per R-03 hard gate |

We MISS 31 commits on develop (`REVIEW2/01 §3`): 22 cherry-pickable
directly (payments, prints, RTL, docs, gain/loss, qty re-evals); 6
blend/replace (cart-perf trio + sync + totals); 3 skip; 0 hard reject.

---

## 6. Per-tenant rollout health-probe set

Run after every blue/green flip (`REVIEW2/08 §4.3`):

| Probe | Expectation |
|---|---|
| `GET /api/method/ping` | 200 `{"message":"pong"}` |
| `GET /posapp` | 200 + HTML with `id="app"` (`posawesome/www/posapp.py`) |
| `GET /assets/posawesome/dist/js/version.json` | 200 + matches deployed SHA |
| `sha256sum -c checksums.sha256` server-side | clean |
| `posawesome.api.telemetry.ingest` with `rum:deploy_probe` | 200 |
| Reduced Playwright spec | green (boot + add-item + cancel; no submit so we don't pollute) |
| `_scope.assert_company` synthetic write attempt | 403 (proves M-01 holds) |
| `_reprice.py` synthetic `rate=0.01` payload | 400 (proves M-02 holds) |
| Realtime channel join + emit cycle | <500ms p95 (proves M-03 fan-out) |

Any failure → tenant `quarantine`, don't promote.

---

## 7. Cost / scale levers

Ordered by leverage-per-dollar (`REVIEW2/02 §3.3`, `REVIEW2/04 §5/§6`,
`REVIEW2/08 §5.3`):

1. **Read-replica routing (M-10)**: 60%+ reduction in primary write
   contention; dashboard p99 drops from 5s to <2s. One replica per region.
2. **CDN edge for `/assets/posawesome/dist/*`** (Cloudflare / Bunny /
   Fastly): hashed filenames already make this trivial; eliminates ~12% of
   traffic from origin; LCP -200–800ms for distant clients. ~1 day to wire.
3. **OpenTelemetry collector + Prometheus + Grafana** (M-05): existing OSS
   stack on boat host; replaces ad-hoc `scripts/heap_*.py` triage; enables
   blue/green decisions. ~3-4 days to wire.
4. **WebSocket sharding per tenant**: at 10,000+ sockets / process, shard
   socketio via Frappe's per-site `socketio_port`, or move stock events to
   Redis Streams / NATS. Cost: marginal (single Node process is fine to
   ~10k sockets `REVIEW2/04 §6.1`).
5. **Async invoice submit as default (M-09)**: turns the bottleneck from
   "5 boxes for 150 submits/sec" into "queue-bound" (5× capacity at same
   hardware).
6. **Per-tenant Redis namespacing**: fixes the `redis_cache` key in
   `customers.py:91` (roadmap C6); per-tenant cache hit-rate moves from
   ~rare to ~hot. ~0.5 day fix.
7. **`get_cached_value` sweep**: 30-40 sites convert from
   `frappe.db.get_value` to `frappe.get_cached_value` on
   Company/Price List/Warehouse/Loyalty Program/POS Profile. Saves
   80–200ms per submit cold. At 1M submits/day = 20-40 minutes of DB-time
   clawed back per day per tenant. `REVIEW2/04 §2.2`.
8. **SWR on lean reads**: `get_items` lean / `get_customer_names` /
   `get_active_pricing_rules` cache 60s with `stale-while-revalidate=300`
   kills thundering-herd spikes. ~1 day.
9. **Stream telemetry to ClickHouse / Loki**: Frappe doctype as thin
   index, time-series in a real TSDB. P3 — only needed beyond ~500
   tenants.
10. **Edge gateway as portable Envoy filter**: same code path runs in
    Cloudflare Worker OR self-hosted Envoy; avoid vendor lock-in (R-07).

---

## 8. What we are NOT doing (and why)

- **Framework swap (Vue → React, Pinia → Redux, Vuetify → Mantine)**:
  current stack is fine; the 23-commit perf push proved the shallow-ref
  discipline works (`REVIEW2/04 §12`).
- **WASM hot paths**: telemetry has not justified the complexity
  (`REVIEW2/04 §12`).
- **Custom socket.io / sticky sessions for 100k+ sockets**: Frappe
  socketio is adequate to ~10k sockets/process; shard per-tenant first.
- **Full microservices decomposition**: Frappe stays as the system of
  record; only chatty reads move to a FastAPI sidecar IF read-replica
  isn't enough (`REVIEW2/02 §3.2`).
- **Replacing MariaDB with Postgres**: Frappe v16 supports both but
  migration cost outweighs benefit for our scale; defer indefinitely.
- **Replacing `qz-tray` with a different print bridge**: qz@2.2.5 is
  pinned, works, has signing. Move to 3.x only if forced.
- **Adding Electron release as a primary deploy**: `electron-builder` is
  in `knip.json` ignore lists. Whether to keep the `electron/` directory
  is a Marco call — added as Q-12 below — NOT a unilateral synth
  decision. Default: keep until Marco confirms (`REVIEW2/06 §6.1 row
  "electron-builder"`).

---

## 9. Open questions for Marco (deferred decisions)

Carried forward from `REVIEW2/01 §8 open questions`,
`REVIEW2/02 §9.2`, `REVIEW2/05 §12`, `REVIEW2/07 §12`:

1. **4-σ vs 6-σ as the 12-month engineering target.** Both are planned in
   `PLAN-6SIGMA.md`; the choice affects hiring + budget.
2. **Edge gateway choice**: Cloudflare Workers vs self-hosted Envoy.
   Recommended: implement as portable Envoy filters from day 1 so we can
   run either.
3. **Async invoice submit as default**: changes operator UX (ACK ≠ submit).
   Needs ops sign-off + tenant communication plan.
4. **Coordinate with defendicon on `centralization-of-pos-app` schedule**:
   without their cadence we either stall or diverge.
5. **Tax-region as feature flag**: needs Doco's CFDI team to confirm the
   contract before we generalise.
6. **PII encryption at rest**: legal + ops; not engineering's call alone.
7. **Per-tenant feature-flag UX in boat**: who owns the toggle? Today
   nobody.
8. **Submit telemetry doctype upstream as canonical RUM contract**, or
   keep doco-owned for faster iteration?
9. **Submit `/posapp` web route upstream**: 470 LOC of `frappe.*` shim to
   maintain forever, vs huge reliability win for the ecosystem.
10. **CFDI × multi-currency**: any active customer running CFDI with
    non-MXN tender? Drives PR-2 (payment chain) regression depth.
11. **POS Supervisor role**: replace our Permission Manager scoping with
    upstream's new role when refactoring branch lands? Big per-tenant
    migration if yes.
12. **Electron `electron/` directory**: keep or drop? Knip flags it
    unused. If no current/planned native-desktop deliverable, P2 cleanup
    can save ~50 LOC config + simplify build. Default: keep.
13. **Staffing assumption**: PLAN §7 lists 8 role slots; ROADMAP §10
    assumes "4 paired devs" as illustrative. Reconcile with actual
    headcount + rotation plan before P1 kicks off.

---

## 10. Honest milestone math

At the planned cadence (illustrative: 4 paired devs, single calendar — see
Q-13 in §9, NOT a committed headcount; PLAN §7 names 8 role slots that
can rotate within this team):

- **30 days**: P1 ships → 3-σ baseline solid + scope/reprice in
- **90 days**: P2 ships → 3.5-σ + structural SaaS foundations
- **180 days**: P3 ships → 4-σ measured 30 days continuous
- **365 days**: 4-σ everywhere + external pentest + SOC2 readiness gap
  closed; 5-σ in sight on the deterministic invariants (reprice,
  scope, idempotency).

6-σ on cart-add INP / boot LCP / submit-durable latency stays the
aspirational North Star — those are latency percentiles on commodity
hardware. 6-σ on the **defect rate** (wrong-total, cross-tenant leak,
duplicate write) is achievable in P3 because those are deterministic
rejections, not flaky percentiles.

The bottleneck is not engineering capability. It's defendicon's
review cadence + coordinating the centralization rebase + ops capacity
for blue/green per-tenant rollouts. All three are dependencies the
control-plane team (boat) owns.

— synth-lead, 2026-05-18.
