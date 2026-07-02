# PLAN-6SIGMA — Posawesome SaaS Roadmap

> Synthesis lead, 2026-05-18. Inputs: `REVIEW2/01..08`.
> Branch: `doco-customizations` @ `968d8c04` vs `upstream/develop` @ `45eb528e`.
> Upstream flow: feature → stage-develop → develop → tag.

---

## 1. Strategic stance (≤300 words)

Six-sigma (99.99966% / 3.4 DPMO) is the North Star. The 12-month real target
is **four-sigma (99.99% / 233 DPMO)**, the floor at which a SaaS POS can take
non-doco tenants without an asterisk in the contract (`REVIEW2/02 §7.3`,
`REVIEW2/03 §12.1`). Six-sigma is structurally unreachable while the server
trusts client-supplied prices (`REVIEW2/03 §3`), permissions are bypassed in
write paths (`REVIEW2/03 §4`), and observability is read from `frappe.log_error`
(`REVIEW2/08 §5.2`). Beat those, then chase the last two nines.

The plan is **upstream-aligned, security-first, SaaS-oriented, mobile-first**.

- Upstream-aligned: every PR targets `stage-develop`, not `develop`
  (`REVIEW2/01 §6`, `REVIEW2/08 §2`). We ride defendicon's
  cart-perf, payment-precision, RTL, and security cherries instead of forking
  them (`REVIEW2/01 §4`, `REVIEW2/06 §10`).
- Security-first: M-Pesa allow_guest oracle, QZ sign_message private-key
  oracle, client-trusted prices, client-trusted `is_supervisor` flag, and
  blanket `ignore_account_permission` are P0 (`REVIEW2/03 §1.2, §3, §12`,
  `REVIEW2/06 D1/F2`).
- SaaS-oriented: tenant scope helper (`_scope.py`), edge gateway with
  idempotency at the door, OpenAPI 3.1 contract surface, OTel spine,
  blue/green per-tenant deploys, feature-flag service (`REVIEW2/02 §4`,
  `REVIEW2/07 §7-9`, `REVIEW2/08 §3.4-9`).
- Mobile-first: 44px touch targets on coarse pointer, swipe-to-delete with
  undo, PWA manifest hardening, BackgroundSync outbox, 2-col phone grid
  (`REVIEW2/05 §1, §3, §5, §13`).

Capacity envelope is ~115 sustained / ~7k peak RPS — derived as
`5,000 tenants × 10 terminals × ~200 ops/terminal/day ÷ 86,400s ≈ 115 RPS`,
not raw tenant×ops. Translates to millions/day, not millions/sec. Anyone
selling "million RPS" is selling fiction (`REVIEW2/02 §3`,
`REVIEW2/04 §7.2`).

---

## 2. Phases

### P0 — Immediate (≤7 days, week of 2026-05-18)

Stop-the-bleed security + visibility + lab-safe fixes.

- Cherry-pick 6 upstream XSS/authz commits (`127207ca`, `fab0bb74`,
  `77443101`, `c805f8a0`, `3c6c75e3`, `359c0a74`) from
  `refactoring-repo-architecture-structure` into a hotfix branch
  (`REVIEW2/01 §5`, `REVIEW2/06 §10.1`).
- Disable `qz.sign_message` for non-supervisor roles; gate envelope shape
  (`REVIEW2/03 §1.6, §12 row 2`).
- Disable `m_pesa.confirmation` `allow_guest` for doco sites (we don't use
  M-Pesa) until HMAC+IP allowlist lands (`REVIEW2/03 §1.2`, `REVIEW2/03 §11.1`).
- Add `methods=["POST"]` to all write endpoints — sweep (`REVIEW2/03 §1.9`,
  `REVIEW2/07 §11 PR-2`).
- Wire real `@frappe.rate_limiter` on `telemetry.ingest`; fix the lying
  docstring at `api/telemetry.py:21` (`REVIEW2/03 §1.7`, `REVIEW2/08 §1.3`).
- Add the 5 DB indexes from `REVIEW2/04 §2.6` via a patch
  (`v15_x/add_perf_indexes.py`).
- Snapshot `doco-customizations` (`backup/pre-upstream-merge-2026-05-18`).
- Add `dependabot.yml` + CodeQL + gitleaks workflows
  (`REVIEW2/08 §1.4 1-3`).

**Exit criteria**: hotfix branch green on lab.xolo (vitest 540+, Playwright
smoke); qz.sign_message rejects non-envelope payloads; m_pesa endpoints
return 403 on doco sites; telemetry.ingest rate-limited; indexes applied;
CI fails on secret push / high-severity CVE.

**Prod promotion gate**: every P0 item lands on `ventas.lab.xolo` first.
Per `feedback_hotfix_lab_first.md`, prod cut-over on `ventas` (and any
non-doco SaaS tenant) requires an explicit "push to prod" signal from
Marco after lab soak ≥24h with no regressions. Until that signal, P0 is
lab-only.

### P1 — 30 days

Tenant scope + server-side reprice + observability foundation + cart-perf
adoption.

- Land `posawesome/posawesome/api/_scope.py` with `assert_company`,
  `assert_profile`, `assert_customer_in_profile` and wire to top-15 write
  endpoints (`REVIEW2/03 §2.3, §10 PR-1`).
- Land `_reprice.py`: server-side reprice + discount cap + payment-vs-total
  invariant on `update_invoice`/`submit_invoice` (`REVIEW2/03 §3.3, §10 PR-2`).
- Adopt upstream cart-perf trio + sync optimisations: blend `881ba161`,
  `2247c666`, `9f37d53c`, `7a64031e`, `be5056e5`, `658ec0bb`, `255f88e9`,
  `9af33b58` onto our shallow-ref base (`REVIEW2/01 §4.1-4.3`,
  `REVIEW2/04 §8`).
- Adopt upstream payment chain (11 commits, pure take-theirs):
  `3f2136e7 → b3e64151 → 3a2db227 → dae4286a → df8c3f16 → b9544e06 →
  f5daeeed → cf6a6cb4 → e2ee968d → 51f18d68 → a0438043(payments part)`
  (`REVIEW2/01 §4.4`).
- Adopt upstream print fixes `00fcf847` + `3273eca5` (`REVIEW2/01 §4.5`).
- Replace 19 `frappe.flags.ignore_account_permission = True` sites with a
  `contextmanager` (`REVIEW2/06 D1/F2`, `REVIEW2/06 §12 PR-2`).
- Mobile P0: 44px touch targets on coarse pointer; manifest `start_url`
  fix; iOS meta tags; one `theme_color`; 192/maskable icons
  (`REVIEW2/05 §1, §5, §11 PR-1/PR-2`).
- Wire OTel collector sidecar; replace `frappe.log_error` with structlog in
  `api/*`; ship `read_only_db` decorator for `dashboard.py`
  (`REVIEW2/02 M8, M9`, `REVIEW2/08 §5.2-5.3`).
- Build out 7 runbooks (`REVIEW2/08 §7.3`).
- CI: bundle-size diff, Lighthouse on PR (`perf` label),
  `bench run-tests --app posawesome` in backend gate
  (`REVIEW2/08 §1.4 4-5`, `§10 PR-D`).

**Exit criteria**: zero `ignore_account_permission` without contextmanager
guard; `_scope` asserts on top-15 write endpoints; cart-add p99 < 80ms
(measured); INP p99 on phone < 200ms (Lighthouse); 6-PR cart-perf merge
landed; doco sites still pass full smoke at `/posapp`; OTel spans visible in
Grafana; CodeQL/Dependabot/gitleaks green.

### P2 — 90 days

API contracts + edge gateway + feature flags + per-tenant rooms +
async-submit default + centralization adoption.

- OpenAPI 3.1 emitter at `/api/method/posawesome.api.openapi`; TypeScript
  codegen wired; top-20 endpoints convert to `@posa_api(stability=...,
  request=..., response=...)` schema-validated (`REVIEW2/02 M1`,
  `REVIEW2/07 §7, §11 PR-4`).
- Edge gateway (M2): Cloudflare Worker or Envoy filter in front of
  `/api/method/posawesome.*` with idempotency-key write-through, per-tenant
  token-bucket rate-limit, CSP+security headers (`REVIEW2/02 M2`,
  `REVIEW2/03 §7.2`).
- Idempotency keys at the edge AND server for ALL writes, not just
  invoice paths (`REVIEW2/02 M4`, `REVIEW2/07 §4, §11 PR-3`).
- POS Feature Flag doctype + runtime resolver + `useFeatureFlag.ts` SPA hook
  (`REVIEW2/02 M6`, `REVIEW2/07 §9.3`, `REVIEW2/08 §9.2`).
- Versioned realtime channels `v1:<event>:<tenant>:<terminal>`
  (`REVIEW2/02 M5`).
- Async invoice submit on by default (`posa_allow_submissions_in_background_job
  = 1` on new sites) (`REVIEW2/02 §8 Sprint 6`, `REVIEW2/04 §7.4`).
- Adopt upstream `centralization-of-pos-app` after it lands in
  `stage-develop` — coordinated rebase with defendicon (`REVIEW2/01 §5`,
  `REVIEW2/02 §5, §6`).
- Mobile P1: swipe-to-delete cart row with 4-sec undo;
  BackgroundSync outbox; pull-to-refresh; coarse-pointer density override
  (`REVIEW2/05 §3, §5, §11 PR-3/PR-5`).
- Split `dashboard.py` (5,829 LOC) into `api/dashboard/sections/*.py`;
  split `creation.py` (1,420 LOC) into `creation/build|tax|payments|submit.py`
  (`REVIEW2/06 §1.2, §12 PR-4/PR-5`).
- Delete vendored `libs/opencv.js` + `libs/dexie.min.js` — saves 12,200
  LOC (`REVIEW2/06 §6.1, §12 PR-3`).
- Stale-while-revalidate caching on `get_items` lean / `get_customer_names`
  / `get_active_pricing_rules` (`REVIEW2/04 §5.4, §11 PR-E`).
- Convert `Pos.vue` + `Invoice.vue` to `<script setup>`
  (`REVIEW2/06 §1.1, App.A row 6`).

**Exit criteria**: OpenAPI spec generated + diffed in CI; gateway live on
canary tenant; 100% writes carry idempotency-key; flags swap live without
deploy; centralization rebased; phone INP p99 < 100ms on add-to-cart;
no file >1,200 LOC in `posawesome/api/*`.

### P3 — 180 days

Event-sourced invoice lifecycle, read-replica routing, blue/green per-tenant,
data partitioning, full k6 bench gating, IDB at-rest encryption, capability
bootstrap.

- Event-sourced invoice lifecycle (`POS Invoice Event`): events
  `cart_finalized`, `payment_collected`, `submit_started`,
  `submit_succeeded`, `submit_failed`, `cancelled`, `returned`,
  `cfdi_stamped` (`REVIEW2/02 M3`).
- Read-replica routing for dashboard + reports + telemetry summary
  (`REVIEW2/02 M9`, `REVIEW2/04 §2.1`).
- Blue/green per-tenant deploys via boat orchestrator + boat `--channel
  canary --percent 5` (`REVIEW2/02 M7`, `REVIEW2/08 §3.4, §4.2`).
- Per-tenant data partitioning: `posa_archived` flag + nightly archive
  to cold tables; UNION view for reports (`REVIEW2/02 M10`).
- Full k6 bench suite (BENCH-1..7) wired to nightly + gating prod
  (`REVIEW2/04 §9, §11 PR-F`).
- IDB encryption at rest via Dexie + WebCrypto (passphrase on shift open)
  (`REVIEW2/03 §5.3`).
- Capability bootstrap endpoint (`api.session.bootstrap_capabilities`)
  returning `{api_version, features, deprecated}` (`REVIEW2/07 §9.3, §11
  PR-5`).
- Strict TS island: flip `noImplicitAny: true` for
  `composables/pos/**`, then stores, then components
  (`REVIEW2/06 §3.2, App.A row 7`).
- Mutation tests on `lib/pricingEngine.ts`,
  `composables/pos/items/store/*`, `composables/pos/payments/
  usePaymentSubmission.ts` (`REVIEW2/06 §11.2, App.A row 8`).
- GDPR DSR endpoints (`gdpr_export_customer_data`,
  `gdpr_redact_customer`) (`REVIEW2/03 §9.2`).
- POS Security Event doctype + helper + retention policies
  (`REVIEW2/03 §8.5, §10 PR-4`).

**Exit criteria**: 4-σ on cart-add, search, submit-ACK measured 30 days
running; 0 lost transactions; blue/green canary auto-rollback proven on lab;
mutation score ≥85% on the 5 pure modules; passed external pentest;
≤20 files >500 LOC (down from 55).

---

## 3. Workstreams

### 3.1 Security (lead: `team:security`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | 6-cmt XSS/authz hotfix; qz.sign_message gate; mpesa allow_guest off (doco); methods=POST sweep; telemetry rate-limit | 01 §5, 03 §1.6/1.2/1.7/1.9, 06 §10.1 |
| P1 | `_scope.py` + 15 writes wired; `_reprice.py`; contextmanager for `ignore_account_permission` (19 sites); PIN lockout + constant-time compare; PII redaction in logs | 03 §2.3/3.3/10 PR-1/2/3/4, 06 D1/F2 |
| P2 | CSP nonce + headers; per-tenant M-Pesa HMAC; idempotency for ALL writes; POS Security Event doctype; field-allowlist on `set_customer_info` | 03 §7.2/11.1/8.5/12 row 7, 07 §4.2 |
| P3 | IDB at-rest encryption; GDPR DSR; pentest; PII column encryption (LFPDPPP); QZ cert validity 365d + rotation | 03 §5.3/9.2/9.5 |

### 3.2 Performance (lead: `team:perf`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | 5 DB indexes; `frappe.db.commit()` removed from `m_pesa.py:39` | 04 §2.6/2.3 |
| P1 | Cart-perf upstream block (`881ba161`+`2247c666`+`9f37d53c`+`7a64031e`+`be5056e5`+`658ec0bb`); bg-sync upstream `255f88e9`+`9af33b58`; `get_cached_value` sweep on 30-40 sites; SWR cache; Redis cache-key fix | 01 §4, 04 §2.2/5/8/11 PR-B/E |
| P2 | Worker catalog search (`5dca1ec7` adoption behind flag); Redis pricing-rules pre-warm; lazy-load `Payments.vue`/`InvoiceManagement.vue`/`Reports.vue`; bench k6 BENCH-1..7 wired | 04 §3.4/4.3/9, 02 M9 |
| P3 | Read-replica routing for dashboard + reports; partition + cold-storage; CDN edge for `/assets/posawesome/dist/*` | 02 M9/M10, 04 §5.5 |

### 3.3 Mobile / UX (lead: `team:frontend`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | `--pos-touch-target-min: 44px` token; manifest `start_url: /posapp` | 05 §1/5 |
| P1 | Coarse-pointer override for qty/UOM/customer-edit/nav 44px; 192/maskable icons; `id`/`categories`/`lang`/`dir`/`shortcuts`; apple-touch-icon; `apple-mobile-web-app-capable`; status-bar-style; one `theme_color`; dark splash; `:focus-visible` ring; reduced-motion global; `touch-action: manipulation` on v-btn | 05 §1/4/5/7/11 PR-1/2/4 |
| P2 | Swipe-to-delete + undo on cart row; BackgroundSync outbox; PullToRefresh wrapper; 5-class breakpoint rewrite (`feat-ui-ux-improvements` adoption); 2-col phone grid; KeyboardShortcutsDialog; density mode | 05 §3/6/10/11 PR-3/5, max-pro skill |
| P3 | Brand chip per tenant from boot.brand; runtime theme JSON; locale lazy-load; per-tenant accent | 02 §5/M6, 05 §8/9 |

### 3.4 Code quality (lead: `team:platform`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | Delete `.eslintrc.cjs`; ts-eslint plugin in flat config; CI lint for `pan/cvv/cc_num` | 06 §7, 03 §10 PR-5 |
| P1 | Contextmanager (PR-2); 2 v-html sinks (`PaymentAdditionalInfo`, `DeliveryCharges`) fixed (PR-1); `_ScopedQuery` rolled in; pinned `frappe.flags` audit | 06 §12 PR-1/2/6 |
| P2 | Split `dashboard.py` → sections; split `creation.py` → 4-module package; delete vendored libs (12,200 LOC); script-setup conversion for `Pos.vue` + `Invoice.vue`; `useInvoiceOffers.ts` split (3 files); commitlint+husky | 06 §1/12 PR-3/4/5, App.A |
| P3 | `noImplicitAny: true` strict-island (composables → stores → components); mutation tests (`pricingEngine`, payment submission); contract tests vs ERPNext; `posaRowId` factory | 06 §3.2/5.4/11.2 |

### 3.5 API contracts (lead: `team:api`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | `methods=["POST"]` sweep on writes; `request_id` forwarded on all `api.callEnvelope` writes | 07 §11 PR-2, 03 §1.9 |
| P1 | `posa_error(code, message, retryable)` helper; replace localised throws in invoice submit + payments with stable codes; envelope normalisation server-side | 07 §6.2/11 PR-1 |
| P2 | `@posa_api` decorator + Pydantic v2 schemas on top-20; OpenAPI 3.1 generator + Redoc panel; `bootstrap_capabilities` endpoint; idempotency for non-invoice writes (customer/supplier/PO/cash-mvt/gift-card/mpesa) | 07 §7/9/11 PR-3/4/5 |
| P3 | Pagination unification (`PageRequest`/`PageResponse<T>`); date-versioned API headers (`X-POSA-API: 2026-Q2`); contract tests CI-gated diff vs main | 07 §5/9.3/8 |

### 3.6 DevOps / observability (lead: `team:devops`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | Dependabot + CodeQL + gitleaks; document branch-protection rules; restrict push triggers; align action versions; cache Playwright browsers | 08 §1.3/1.4/2.4 |
| P1 | OTel collector + structlog in `api/*`; bundle-size diff gate; Lighthouse CI on PR; full ruff + `bench run-tests` in backend CI; 7 runbooks; SBOM via `@cyclonedx/yarn-plugin-cyclonedx` + `cyclonedx-py` | 08 §1.4/3.3/5.3/7.3/10 PR-D |
| P2 | Prometheus + Grafana + Alertmanager on boat host; multi-window multi-burn-rate alerts; synthetic-prod (15-min cadence); Unleash kill-switch service; visual regression snapshots | 08 §5/6.3/7/8/9 |
| P3 | Blue/green per-tenant `deploy-tenant.sh`; canary cohort + auto-rollback; SLSA L2 provenance via `actions/attest-build-provenance`; signed tags; nightly k6 BENCH-1..7 gating prod | 08 §3.4/4.2/3.3/4.4 |

### 3.7 Upstream-sync (lead: `team:platform`)

| Phase | Deliverables | Cite |
|---|---|---|
| P0 | Cherry-pick 6 security commits from `refactoring-repo-architecture-structure`; tag pre-merge backup | 01 §5/7, 06 §10.1 |
| P1 | Merge `upstream/develop` (cart trio + payments chain + RTL + print) into `merge/upstream-develop-2026-05-18`; resolve 6-file conflict per `01 §7`; ship 8 PRs to `stage-develop` (PR1..PR8 from `01 §6`) | 01 §6/7, 02 §8 |
| P2 | Coordinated rebase of `centralization-of-pos-app` with defendicon; pull 6 bug-fix cherries from that branch; offer RUM/OpenAPI/contract upstream as 3 separate PRs | 02 §6/§5, 06 §10.5, 07 §11 PR-4 |
| P3 | Maintain monthly sync cadence with `upstream/stage-develop` tip; doco-only carry-on list reviewed quarterly | 01 §6 "Doco-only", 02 §9.1 R10 |

---

## 4. Exit criteria per phase (measurable)

### P0 exit
- `qz.sign_message` rejects non-JSON-envelope payload (unit test).
- `m_pesa.confirmation` returns 403 on doco sites (smoke).
- 5 DB indexes present in `bench --site ventas.lab.xolo migrate` output.
- Telemetry ingest 429s after >10 req/s/session (load smoke).
- CodeQL + Dependabot + gitleaks workflows green.
- All write endpoints carry `methods=["POST"]` (lint check).

### P1 exit
- `_scope.assert_company` called from top-15 write endpoints (grep + test).
- `update_invoice` re-prices line items server-side from `Item Price`
  master (`tests/security/reprice.spec.py`).
- 19 `ignore_account_permission` sites use `with ignore_account_permission():`
  (grep returns 0 raw `frappe.flags.ignore_account_permission = True`).
- Cart-add INP p99 < 80ms on phone (Lighthouse + bench).
- 8 PRs landed on `defendicon/stage-develop`.
- OTel spans visible on `submit_invoice` in Grafana.
- Manifest fixed: `start_url:/posapp`, single `theme_color`, 192/maskable
  icons present.

### P2 exit
- OpenAPI 3.1 spec generated; `scripts/gen_openapi.py` CI-diff gate.
- Edge gateway live on 1 canary tenant; idempotency-key replay test green.
- Feature-flag service swaps `posa.kill.webRoute` live in <60s.
- `centralization-of-pos-app` rebased into our `doco-customizations`.
- `dashboard.py` ≤500 LOC; 17 section endpoints each ≤300 LOC.
- `creation.py` ≤500 LOC; 4 sibling modules each ≤500 LOC.
- BackgroundSync drains 100% of pending invoices after tab-kill (smoke).
- Phone INP p99 < 100ms on add-to-cart.

### P3 exit
- 4-σ on cart-add INP p99, search keystroke INP, submit-ACK measured for
  30 consecutive days.
- 0 lost transactions across 1M synthetic submits.
- Blue/green auto-rollback fires on synthetic 5xx storm on lab cohort.
- Mutation score ≥85% on `pricingEngine`, `useItemAddition`,
  `usePaymentSubmission`.
- External pentest report with 0 critical, ≤3 high.
- ≤20 files >500 LOC repo-wide.
- IDB encryption verified on 5 device classes.

---

## 5. Six-sigma defect math — DPMO per surface

Baseline volumes: 5,000 tenants × 200 invoices/day × 30 days = 30M
invoices/month; 1M shift-openings/month; 150M cart-adds/month;
600M catalog taps/month; 30M payments/month; 30M prints/month;
50M sync events/month.

| Surface | Today DPMO | P1 target | P2 target | P3 target (4-σ) | 6-σ aspiration |
|---|---:|---:|---:|---:|---:|
| `/posapp` boot (white screen / stale chunk) | ~5,000 | 500 | 100 | 63 | 3.4 |
| Add-to-cart mis-fire (24px button on phone) | ~80,000 (Fitts model, not measured) | 12,000 (44px coarse) | 2,000 | 233 | 3.4 |
| Submit invoice — duplicate write | ~50 (idempotency on invoice path only) | 10 (extend to all writes) | 5 | 3 | 3.4 |
| Submit invoice — wrong total (client-trusted prices) | ~10,000 (model — synthetic abuse not measured) | 0 (server reprice) | 0 | 0 | 0 |
| Payment mis-charge / change-allocation drift | ~5,000 (no payment-precision chain) | 200 (upstream chain) | 20 | 6 | 3.4 |
| Print failure / silent loss | ~2,000 (QZ flicker) | 500 | 100 | 63 | 3.4 |
| Sync — lost outbox entry | ~500 (tab-killed) | 200 | 10 (BackgroundSync) | 3 | <1 |
| Cross-tenant data leak (PII) | ~unknown, ≥1,000 | 100 (_scope.py) | 10 | <1 | 0 |
| Renderer OOM/shift | ~10,000 (1/100 shifts) | 1,000 | 100 | <10 | 0 (hard) |

Sources: `REVIEW2/02 §7.1`, `REVIEW2/04 §10`, `REVIEW2/05 §13`,
`REVIEW2/08 §6.2`.

Honest call: 6-σ on `wrong total` and `cross-tenant leak` IS achievable
because they're correctness invariants (server reprice + scope assert
deterministically reject before any DB write). Latency-percentile 6-σ on
INP / boot is **not** achievable on commodity Android — 4-σ is the
realistic ceiling.

---

## 6. Risk register (R-01..R-15)

| ID | Risk | Sev | Cite | Mitigation | Owner-slot |
|---|---|---|---|---|---|
| R-01 | Upstream cart trio merge silently undoes Phase 2 native cart gains | H | 01 §8 | Pin Lighthouse + heap baseline pre-merge; re-run post-merge; revert per-commit if INP regresses. **Hard gate**: PR-4/PR-5/PR-6 (cart-perf-blend) DO NOT open until `upstream/stage-develop` carries `881ba161`+`2247c666`+`9f37d53c` for ≥14 days with no upstream revert. Until then keep `f853fbb2` RecycleScroller fork-only (R-16) | team:perf |
| R-02 | `POS Awesome Supervisor` role (in refactoring branch) breaks ventas.lab.xolo + prod permissions | H | 01 §8, 02 R3/§9.2 | Do NOT install upstream's `recreate_pos_awesome_workspace.py` patch; diff role bindings before `bench migrate`; gate adoption behind flag | team:platform |
| R-03 | Payment-precision chain (`3f2136e7..cf6a6cb4`, PR #3015 from `Manaa0-0/fix/multi-currency-payment-precision`) breaks CFDI multi-currency on sibling `erpnext_mexico_compliance` app | H | 01 §8 | **Hard gate**: lab smoke on `ventas.lab.xolo` with multi-currency CFDI invoice flow + stamp cycle BEFORE merging the chain into `merge/upstream-develop-2026-05-18`. Marco call on non-MXN tender prevalence + CFDI rounding semantics. CFDI test plan: USD→MXN cash, USD→MXN credit-card, MXN-only baseline, EUR→MXN edge | team:cfdi |
| R-04 | M-Pesa `confirmation` `allow_guest` abuse in window before HMAC ships | M | 03 §1.2, R3 | P0 disable for doco (we don't use); doco patch raises PermissionError; opt-in per tenant via Site Config | team:security |
| R-05 | `qz.sign_message` private-key oracle compromise across multi-tenant bench | H | 03 §1.6/§12 row 2 | P0 envelope gate + supervisor-only role; rotate per-tenant cert; revoke compromised keys | team:security |
| R-06 | `flags.ignore_account_permission` blanket fix surfaces broken role configs in prod | H | 02 R4 | Roll out via feature flag (`posa.kill.scopeAssert`); per-tenant rollback path; canary on lab first | team:security |
| R-07 | Edge gateway lock-in to Cloudflare | L | 02 R5 | Implement as portable Envoy filters from day 1; CloudflareWorker is one deploy target | team:devops |
| R-08 | Dashboard read-replica drift shows stale totals | M | 02 R6 | Display "as of <timestamp>" on replica-served panels; force-primary on cash-up close | team:platform |
| R-09 | 5,829-LOC `dashboard.py` SQL unbounded joins peg whole bench | M | 02 R7, 04 §2.1 | M9 read-replica + M10 partition + per-section `query_timeout=5`; cap pages | team:perf |
| R-10 | Service Worker takeover mid-shift loses unsynced cart | M | 02 R9 | Phase 5 offline mutations + BackgroundSync + idempotency keys (P2) | team:frontend |
| R-11 | We outpace defendicon's review cadence; fork drifts permanently | M | 02 R10 | Open small single-concern PRs (8 in §6); maintain `UPSTREAM_PR_QUEUE.md`; co-author centralization | team:platform |
| R-12 | LFPDPPP audit before PII encryption at rest lands | L | 02 R11 | Schedule Q2 PII encryption sprint; document + access-gate until then | team:security |
| R-13 | Realtime channels leak PII (customer name, balance) on misconfigured subscriber | L | 02 R12, 03 §5.2 | M5 per-tenant rooms + ID-only payloads; client re-fetches | team:platform |
| R-14 | Telemetry table outgrows `prune_old_events` reap | L | 02 R8, 04 §7.3 | Per-tenant cap + 80% disk alarm; ClickHouse for hot summary if needed | team:devops |
| R-15 | Vuetify 3.12.6 yarn.lock churn breaks upstream PR2 | L | 01 §8, 04 §3.4 | Re-resolve from `package.json` on PR branch (`yarn install`) instead of carrying lockfile | team:platform |
| R-16 | RecycleScroller swap (`f853fbb2`) blocks upstream's `4c630bc8` script change | M | 01 §8 | Keep fork-only until upstream maintainers approve; rebase ItemsSelector by hand each merge. See R-01 hard gate | team:frontend |
| R-17 | `boat` control-plane is currently NOT instrumented for per-tenant blue/green deploys; M-06 has no working substrate | H | this doc §3.6/§9 | Either (a) open boat instrumentation milestone owned by `team:control-plane` (boat repo not posawesome), or (b) scope M-06 out of posawesome plan and track in `boat/SAAS_ROADMAP.md`. Default: scope out — boat owns its own roadmap | team:control-plane |
| R-18 | PR-Q1 covers 10 of 18 v-html sinks; 3 fork-only (ItemsTableExpandedRow×2, PosOffers×1) ride along; 5 (Customer.vue) ride upstream `26853355`+`8e96d0d8` | M | this doc §3.4 | Expand PR-Q1 to 13 sinks (DeliveryCharges 2 + PaymentAdditionalInfo 8 + ItemsTableExpandedRow 2 + PosOffers 1); track Customer.vue 5 via upstream-sync, NOT a separate PR | team:platform |

---

## 7. Owners + sequencing graph

Slots are role labels — not headcount. Whether 1 person rotates through
all slots or 8 people share them is out of scope. ROADMAP §10 mentions
"4 paired devs" as one feasible staffing; that number is illustrative,
not a commitment, and is reconciled here as the assumed-but-unconfirmed
allocation pending Marco's call (Q-12 in ROADMAP §9).

- `team:security` — `_scope.py`, `_reprice.py`, methods sweep, PIN, headers,
  GDPR
- `team:perf` — cart-perf merges, indexes, caching, k6, read-replica
- `team:frontend` — mobile, PWA, swipe, BackgroundSync, density, themes
- `team:api` — OpenAPI, capability bootstrap, idempotency, error envelope
- `team:devops` — CI, OTel, Prometheus, feature-flag service
- `team:cfdi` — payment-chain regression on CFDI
- `team:control-plane` — boat instrumentation, blue/green orchestrator
  (owned by `boat` repo, NOT posawesome — see R-17)
- `team:platform` — upstream sync, code-quality splits, centralization rebase

Sequencing (DAG):

```
P0: security-hotfix ──┐
                      ├─► P1: _scope.py ──► _reprice.py ──► OTel + read-replica ──┐
upstream-merge ───────┘                                                            │
                                                                                   ├─► P2: OpenAPI ──► edge-gateway ──► feature-flags ──► async-submit-default
cart-perf-block ──────────────────────────────────────────────────────────────────┘             │
                                                                                                 ├─► P3: event-source ──► blue/green ──► k6 gating ──► IDB encrypt
mobile-P0 (44px+manifest) ──► mobile-P1 (swipe+BG sync+density) ────────────────────────────────┘

code-quality-splits (dashboard.py, creation.py) — independent track, run parallel to P1+P2
```

Critical-path predecessors:

- `_reprice.py` ⟵ `_scope.py` (need scope helpers before reprice can throw)
- edge-gateway ⟵ idempotency-everywhere ⟵ OpenAPI contracts
- centralization-rebase ⟵ upstream-sync (defendicon must land it first)
- blue/green ⟵ OTel + Prometheus + feature-flags (need probes + canary
  cohort + kill-switch)
- async-submit-default ⟵ async-submit-tested (lab soak)
- event-source ⟵ feature-flag (gated rollout)

---

## 8. Workstream dependency matrix

|  | sec | perf | mob | code | api | dev | sync |
|---|---|---|---|---|---|---|---|
| **security** | — | — | — | needs ctxmgr (P1) | error envelope shared (P1) | OTel for security events (P1) | XSS cherries (P0) |
| **perf** | needs scope (won't reprice without scope) | — | — | dashboard split unblocks read-replica routing | SWR cache via headers | bundle-size gate, Lighthouse | cart trio + payments chain |
| **mobile** | needs CSP from sec (P2) | needs INP measurement infra | — | needs script-setup conversion of Pos/Invoice | needs capability bootstrap for tenant brand | needs BackgroundSync ingest endpoint typed | adopts upstream `feat-ui-ux-improvements`, `max-pro-skill`, `overhaul-responsive` |
| **code-quality** | — | provides shallow-ref discipline to splits | — | — | — | — | careful with refactor branches (NEVER bulk-merge) |
| **api** | needs PIN lockout + scope before exposing OpenAPI | needs idempotency-on-writes (perf benefit) | needs capability bootstrap for SPA | needs split files for clean schemas | — | needs CI diff gate | upstream PR-1 (envelope) |
| **devops** | dependabot + CodeQL P0 | bench gating prod P3 | Lighthouse on coarse-pointer P1 | bundle-size + ruff gates | OpenAPI diff gate P2 | — | upstream PR-A (smoke matrix) |
| **upstream-sync** | XSS cherries P0; verify auth helpers don't conflict | cart trio + payments chain P1; defer cart-perf-blend until upstream stable | adopt feat-ui-ux P2 | adopt centralization P2 | offer OpenAPI back P2 | offer CI gates back P2 | — |

---

## 9. Honest closing

Posawesome has world-class single-tenant perf engineering (the 23-commit
push is genuinely impressive — `REVIEW2/02 §10`, `REVIEW2/04 §1`). What's
missing is everything that makes the leap from "great POS" to "SaaS POS":
tenant scope, server-side reprice, observability spine, edge gateway, event
sourcing, feature flags, blue/green, per-tenant rooms. None of those are
started.

The 90-day plan above gets us to ~3.5-σ + the structural foundations for
4-σ in the following 6 months. 6-σ is the right star; 4-σ is the right
milestone (`REVIEW2/02 §7.3` concurs). Anyone who tells you they're going
to hit 6-σ on commodity Android with a Vue 3 SPA is selling something.

— synth-lead, 2026-05-18.
