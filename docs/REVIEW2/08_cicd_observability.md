# REVIEW2 / 08 — CI/CD + Observability

> Audit of release engineering, branch workflow, deploy mechanics, and
> observability for the posawesome fork (`HolyMC2/POS-Awesome`,
> branch `doco-customizations`) vs upstream `defendicon/POS-Awesome-V15`
> (tip `45eb528e`, release `15.29.1`, 2026-05-16) and the muelle/boat
> SaaS control plane that hosts it for our tenants.
>
> Snapshot date: 2026-05-18. Latest local commit: `968d8c04`.
> Latest upstream develop: `45eb528e`. Path conventions:
> `<repo-relative-path>:<line>`.

---

## 0. TL;DR — gap matrix

| Surface | Have | Missing | Severity |
|---|---|---|---|
| Frontend lint+type+unit | yes (`ci-frontend.yml:33-40`) | no coverage upload, no bundle-size gate | M |
| Frontend e2e | Playwright matrix on `/app/posapp` + `/posapp` (`ci-frontend.yml:42-96`) | no Lighthouse, no visual regression, smoke depends on shared lab — single point of failure | M |
| Backend tests | ruff E9/F7 + offline-sync unittests (`ci-backend.yml:53,81`) | no full pytest, no coverage, no `bench run-tests` against posawesome | H |
| Build verify | hashed assets + checksum + electron smoke (`build-verify.yml:32-43`) | no bundle-size diff, no SBOM, no SLSA provenance | M |
| Security | none | no Dependabot, no CodeQL, no `npm audit` / `pip-audit`, no secret scan, no license scan | H |
| Release | semantic-release on `develop` (`release.config.js:11`) | no canary, no per-tenant rollout, no rollback automation | H |
| Branch protection | unknown (not in repo) | no documented required checks for `doco-customizations` | H |
| Observability — browser RUM | yes (`frontend/src/posapp/utils/telemetry.ts:1-327`) | no centralised dashboard, no alerting, no Sentry-class error tracking | M |
| Observability — backend | Frappe Error Log only | no OpenTelemetry, no metrics, no traces, no APM | H |
| SLOs / error budgets | targets defined in `3-SIGMA.md:56-69` | not measured continuously, no error-budget burn alerts | H |
| Per-tenant deploy | `muelle/scripts/dev-refresh.sh` + boat provision | no staged rollout, no health-gated canary | H |
| Feature flags | `posa_use_web_route` POS Profile field (`3-SIGMA.md:116`) | ad-hoc only, no central flag service, no kill switches | M |
| On-call / runbooks | none | no paging, no runbooks | H |
| Synthetic monitoring | none (smoke is PR-gated, not scheduled vs prod) | no canary against prod tenants | M |

---

## 1. Current CI — what runs, what's missing

### 1.1 Inventory

Eight workflow files under `.github/workflows/`:

| File | Trigger | What it does |
|---|---|---|
| `ci-frontend.yml` | push + PR all branches | type-check, lint, vitest, Playwright matrix (`/app/posapp` + `/posapp`) |
| `ci-backend.yml` | push + PR all branches | ruff syntax smoke + Frappe bench bootstrap + offline-sync unittest |
| `build-verify.yml` | push + PR all branches | production build + `verify_build_artifacts.mjs` + electron smoke + provenance upload |
| `release.yml` | `workflow_dispatch` only | re-runs all three gate sets + windows-runner semantic-release |
| `docs.yml` | push + PR all branches | TypeDoc check; auto-commit API ref on `develop`/`main` |
| `format.yml` | manual | prettier + black check or write |
| `need-more-info.yml` | issue events | bot template |
| `snapshot-mirror.yml` | manual | full git mirror tarball with LFS |

### 1.2 Strengths

- **Phase 7 smoke matrix** (`ci-frontend.yml:42-96`) runs Playwright at
  both Desk and web-route paths on every PR, with skip-on-missing-secrets
  + trace upload on failure. This is good. Source: `3-SIGMA.md:274-281`.
- **Build provenance** is uploaded as an artifact
  (`build-verify.yml:44-51`): `version.json` + `checksums.sha256`. The
  verifier (`scripts/verify_build_artifacts.mjs:9-15`) asserts required
  manifest assets, hashed-entry contract, and writes SHA256 for every
  emitted file. This is a real supply-chain control upstream did *not*
  have before `ed1badac` (cherry-picked from us).
- **Semantic-release pipeline** (`release.config.js:10-103`) is fully
  wired — commit-analyzer → release-notes → changelog → exec
  (`update_version.py` + `yarn build` + `verify:build` + `electron:smoke`
  + windows electron build) → git → github with binary assets.
- **Concurrency lock** (`release.yml:11-13`) prevents concurrent releases.

### 1.3 Gaps (ordered by leverage)

1. **No security scanning.** No CodeQL, no Dependabot, no
   `yarn audit`, no `pip-audit`, no secret scan, no SBOM, no license
   scan. Minimum needed: `github/codeql-action` (JS+Py),
   `.github/dependabot.yml` (yarn root + frontend + pip + actions),
   `gitleaks-action`, `license-checker --failOn 'GPL;AGPL'`.
2. **Backend test coverage is symbolic.** `ci-backend.yml:81` runs only
   `test_offline_sync_*.py`. The `api/` tree has 30+ modules
   (`commercial_flow.py`, `dashboard.py` 231 kB, `idempotency.py`,
   `invoices.py`, `item_fetchers.py`, `payment_entry.py`, …). Should
   run `bench --site example.com run-tests --app posawesome`. Ruff is
   gated on E9/F63/F7 only (`ci-backend.yml:53`); the real lint set in
   `pyproject.toml:32-58` isn't enforced.
3. **No bundle-size gate.** Biggest perf regression risk
   (`3-SIGMA.md:191-201,319-323`). Diff
   `posawesome/public/dist/js/*.js` against the PR base; fail if
   `loader-*.js` / `posawesome-*.js` grow > 10 %.
4. **No Lighthouse CI** — `3-SIGMA.md:308-310` specifies it; not built.
   Run against `/posapp` (baseline 981 DOM nodes, mount < 2 s —
   `3-SIGMA.md:148-152`).
5. **No heap-snapshot regression** (`3-SIGMA.md:310`: 50-action
   scripted shift; `node_count < 3.5 M`, `_o + _s < 60 k`). Scripts
   exist (`scripts/heap_*.py`) but are unwired.
6. **No visual regression.** Vuetify upgrades (`5aa38110` 3.7.5→3.12.6,
   `REGROUPED.md:18`) silently break layout — add Playwright
   `page.screenshot` snapshots for cart / ItemsSelector / Payments.
7. **CI on `["**"]`** (`ci-frontend.yml:5`, `ci-backend.yml:6`, …).
   Costly. Restrict push to
   `[doco-customizations, develop, main, stage-*, feat/**, fix/**]`,
   keep PR trigger broad.
8. **Release on `windows-latest`** for the whole publish job
   (`release.yml:174`) — only NSIS needs Windows. Split: ubuntu for
   changelog/tag/github-release, windows for the electron step only.
9. **No `actions/cache` for Playwright browsers** — ~200 MB redownload
   per job (`ci-frontend.yml:75`, `release.yml:48`).
10. **Action version drift** — `docs.yml:19,22` pins
    `actions/checkout@v6` + `setup-node@v6`; every other workflow is
    `@v4`. Pick one.

### 1.4 Specific actions to add (workflow-level, ranked)

| # | New workflow | Trigger | Job |
|---|---|---|---|
| 1 | `security-codeql.yml` | PR + weekly | CodeQL JS + Python |
| 2 | `dependabot.yml` (config, not workflow) | scheduled | yarn root + frontend + pip + actions |
| 3 | `security-secrets.yml` | PR | gitleaks-action |
| 4 | `bundle-size.yml` | PR | `yarn build` + size-limit / bundlesize diff |
| 5 | `lighthouse.yml` | PR (label `perf`) + nightly | LHCI against staged build |
| 6 | `audit-deps.yml` | nightly | `yarn audit --severity high` + `pip-audit` |
| 7 | `license-scan.yml` | PR | `license-checker --failOn 'GPL;AGPL'` |
| 8 | `synthetic-prod.yml` | every 15 min | Playwright smoke against `${POSA_PROD_URL}` (see §8) |

---

## 2. Branch workflow — align with upstream

### 2.1 Upstream model (defendicon)

Observed from `git log upstream/develop` (commits `45eb528e`,
`a9b3af2f`, `8947095f`, `c7d5ff79`):

```
contributor feature branch
       ↓ PR
defendicon/stage-develop  ← integration / pre-release
       ↓ PR  ("Merge pull request #3021 from defendicon/stage-develop")
defendicon/develop        ← release source for semantic-release
       ↓ workflow_dispatch
tag 15.29.1 (signed by semantic-release-bot)
```

`release.config.js:11` confirms: `branches: ["develop"]`. Tag cadence
~3-4 weeks (`15.27.0`, `15.28.0`, `15.28.1`, `15.28.2`, `15.29.0`,
`15.29.1`). No `production` branch in upstream — `develop` IS the
release branch; tags are the production marker.

### 2.2 Our model today

- `doco-customizations` — long-lived fork branch, 60+ commits ahead of
  `upstream/develop` (perf branch + telemetry + web-route + fixes; see
  `REGROUPED.md:3`, `AUDIT.md:1-46`).
- `track/upstream-develop` — clean upstream tracking branch (used as
  rebase substrate for the perf branch — `REGROUPED.md:3`).
- `perf/before-cleanup` — historical snapshot before `b5992f70`
  cherry-pick (`AUDIT.md:11`).

No `stage-develop` equivalent. No clean PR-back-to-upstream story.

### 2.3 Recommended branching

```
contributor feature branch (feat/*, fix/*)
       ↓ PR — fork CI green
HolyMC2/doco-customizations      ← prod-equivalent integration
       ↓ tag doco-15.29.1-<n>     ← per-tenant rollout source
       ↓ cherry-pick / rebase  (back-merge path)
HolyMC2/upstream-prep             ← upstream-PR staging (clean of doco-only)
       ↓ PR
defendicon/stage-develop
       ↓ PR
defendicon/develop
```

Naming convention:

| Prefix | Use |
|---|---|
| `feat/<area>-<short>` | new behaviour |
| `fix/<area>-<short>` | bug fix |
| `perf/<area>-<short>` | perf only |
| `chore/<area>-<short>` | tooling, formatting, deps |
| `doco/<area>-<short>` | doco-customer-specific, NEVER PRed upstream |
| `track/upstream-<branch>` | upstream tracking branches |

### 2.4 Required checks (branch protection)

Protect `doco-customizations`: 1 PR approval; required status checks
= Frontend CI `static`, `smoke (/app/posapp)`, `smoke (/posapp)`;
Backend CI `backend`; Build Verify; Docs `docs-check`; (new)
Security `codeql`, `secret-scan`; (new) Bundle-size `diff`. Require
branches up to date; require linear history (matches semantic-release);
restrict push to release-bot + maintainers.

### 2.5 Cherry-pick policy (doco → upstream)

Maintain `UPSTREAM_PR_QUEUE.md` listing upstream-mergeable commits.
Allow: pure perf/security/correctness, generic CI/telemetry. Block:
anything referencing `doco`/`muelle`/tenant config or boat's
per-tenant API. PR candidates (see §10) rebase onto
`track/upstream-develop`, clean, then PR against
`defendicon/stage-develop`.

---

## 3. Release engineering

### 3.1 Versioning

Today: semantic-release tag scheme `${version}` (no `v` prefix —
`release.config.js:12`). Matches upstream (tags `15.29.1`, `15.29.0`,
`15.28.2`). `posawesome/__init__.py` updated by
`scripts/update_version.py` (called from `release.config.js:80`),
asset hash baked into `posawesome/public/dist/js/version.json`
(`scripts/verify_build_artifacts.mjs:46-92`).

Recommendation: stay aligned, but add a doco-suffixed pre-release
channel:

```js
// release.config.js — proposed extension
branches: [
  "develop",                                      // upstream-style
  { name: "doco-customizations", prerelease: "doco" },  // doco-15.29.1-doco.4
  { name: "track/upstream-develop", prerelease: "rc" }, // 15.30.0-rc.1
]
```

This lets us tag doco builds without conflicting with upstream's
linear `15.x.y`.

### 3.2 Changelog generation

Already good: `release.config.js:20-69` emits sectioned changelog with
deterministic ordering (Features → Bug Fixes → Performance → Docs →
Maintenance). Keep. One nit: emoji headings (`✨ Features`) break
plaintext changelogs ingested by some pipelines — fine for humans.

### 3.3 Asset hashing + SW versioning

Solid foundation:

- Vite entry hashing landed at `d477e21f` (`REGROUPED.md:17`).
- SW registered at `/sw.js?v=<build>` (`5a1a13fc` per git log) so
  deploys force a new SW instance.
- `version.json.assets` maps logical name → `/assets/posawesome/dist/js/loader-<hash>.js`
  (consumed by `scripts/verify_build_artifacts.mjs:64-70`).
- `checksums.sha256` written deterministically (sorted) for every
  emitted file (`scripts/verify_build_artifacts.mjs:77-85`).

Gaps:

- **No SBOM**. Add `@cyclonedx/yarn-plugin-cyclonedx` + `cyclonedx-py`
  to emit `sbom.cdx.json` alongside `checksums.sha256`, upload as
  release asset.
- **No SLSA provenance**. The `actions/attest-build-provenance` action
  generates SLSA L2 provenance — cheap to add and matches federal SaaS
  procurement requirements.
- **No signed tags**. Configure `gpg-sign` in semantic-release's git
  plugin: `["@semantic-release/git", { "gpgSign": true }]`.

### 3.4 Blue/green per-tenant migration

Posawesome runs bind-mounted inside the muelle stack (see
`~/muelle-host/CLAUDE.md` "Bind-mounted apps + pip install -e").
Today's migration is in-place via `dev-refresh.sh` — wrong for prod.

Proposed: (1) boat tags each tenant `posawesome_channel:
stable|canary|beta`; (2) per release, build artifact
`POSAwesome-<version>.tar.gz` of `posawesome/public/dist/` pushed to
registry (or GitHub Releases); (3) new `muelle/scripts/deploy-tenant.sh`
pre-creates `-blue` + `-green` slots on tenant volume, runs
`bench migrate` on green, probes (§4.3), atomically flips the
bind-mount + restarts proxy (template:
`muelle/scripts/dev-refresh.sh:163-164`); (4) keep blue 30 d for
instant rollback.

### 3.5 Rollback

Today: `git revert` → `dev-refresh.sh` → manual restart. Slow.
Target: `boat tenant rollback <tenant> --to-version 15.29.0` flips
the symlink, restarts proxy, emits event. Sub-minute MTTR.
Migration rollback (`bench migrate` is forward-only) requires a
`before-migrate` MariaDB dump per tenant — partially shipped in
`muelle/scripts/backup.sh`.

### 3.6 Canary path

Tag `15.29.2-doco.1` → promote to `canary` channel (boat updates
~5 % of tenants, low-risk shops) → watch SLO dashboard for 24 h
(INP p99, crash count, `pos:invoice-submit` success) → green ⇒
promote to `stable`; red ⇒ auto-rollback (§3.5). Boat needs a
small "channel" concept addition.

---

## 4. Per-tenant deploy mechanics

### 4.1 Today

The reference deploy mechanism lives at
`muelle/scripts/dev-refresh.sh:1-167`. Critical operations:

| Step | Lines | Purpose |
|---|---|---|
| SPA build (Vite) | `dev-refresh.sh:41-67` | rebuild apps that own `frontend/package.json` (posawesome, taller) |
| `bench build` | `dev-refresh.sh:70-85` | bench-esbuild for non-Vite apps |
| Sync dist → shared volume | `dev-refresh.sh:110-140` | only copy `apps/.../public` over `sites/assets/<app>` for Vite SPAs; bench-esbuild apps already wrote there |
| Restart workers | `dev-refresh.sh:142-146` | backend + queue-short + queue-long + scheduler |
| Clear per-site Redis cache | `dev-refresh.sh:148-158` | required for client-script reload |
| Restart proxy | `dev-refresh.sh:163-164` | flush stale upstream IP + asset-hash cache |

This works for dev (single-host muelle stack on `holymc2`). It
explicitly is **not** a multi-tenant prod deploy tool —
`/home/holymc2/muelle-host/CLAUDE.md` calls out "the muelle stack
that runs on the dockervm VPS" as a separate host where the same
compose file runs.

### 4.2 Staged-percentage rollout

Boat provisions sites via `muelle/scripts/provision.sh`. Extension:

```
boat deploy posawesome 15.29.2 --channel canary --percent 5 \
  --health-check '/api/method/posawesome.posawesome.api.telemetry.get_pos_telemetry_summary' \
  --watch-minutes 60 --auto-rollback-threshold-crashes 3 \
  --auto-rollback-threshold-inp-p99-ms 500
```

Steps: (1) boat picks 5 % of tenants deterministically; (2) per
tenant: stop traffic → DB snapshot → swap bind-mount →
`bench migrate` → health probe → resume; (3) aggregate canary cohort
telemetry vs stable (invoice-submit p99, `crash:*` rate, proxy 5xx);
(4) auto-rollback all canary tenants on breach + page on-call.

### 4.3 Health-check gate

Per-tenant post-deploy probes:

| Probe | Expectation |
|---|---|
| `GET /api/method/ping` | 200 `{"message":"pong"}` |
| `GET /posapp` | 200 + HTML with `id="app"` (`posawesome/www/posapp.py`) |
| `GET /assets/posawesome/dist/js/version.json` | 200 + matches deployed SHA (`scripts/verify_build_artifacts.mjs:46-92`) |
| `sha256sum -c checksums.sha256` server-side | clean |
| `posawesome.api.telemetry.ingest` with `rum:deploy_probe` | 200 |
| Reduced Playwright spec | green (subset of `posapp.web-route.spec.ts`) |

Any failure → tenant `quarantine`, don't promote.

### 4.4 Auto-rollback

Same machinery as §3.5 (symlink flip + proxy restart + event). Cohort
triggers: tenant 5xx > 5 % for 5 min; aggregate `crash:*` > 3× pre-deploy;
`pos:invoice-submit` p99 > 2× baseline; sync lag > 60 s.

---

## 5. Observability spine

### 5.1 RUM (browser)

`frontend/src/posapp/utils/telemetry.ts:1-327` already covers:

- PerformanceObserver: `longtask`, `event` (INP), LCP, CLS, FCP
  (`telemetry.ts:215-219`).
- Custom marks via `track()` + `withPerf` (commit `398539c1`).
- Crash hooks (`error`, `unhandledrejection` —
  `telemetry.ts:223-238`).
- Heap pressure 70 % threshold every 30 s (`:241-255`).
- Backpressure: 1000-event buffer cap (`:29`); 30 s flush;
  sendBeacon on `visibilitychange→hidden`/`pagehide` (`:257-271`).
- QZ Tray print-fail capture (commit `48a87102`).

Backend ingest: `posawesome/posawesome/api/telemetry.py` —
event-prefix allow-list `rum:|perf:|pos:|crash:|warn:`
(`telemetry.py:40-46`), `MAX_EVENTS_PER_BATCH=200` (`:35`), daily
prune via `prune_old_events`.

### 5.2 Gaps in the observability spine

| Pillar | Status | Gap | Recommendation |
|---|---|---|---|
| Browser RUM | shipped | per-tenant aggregation only in `dashboard.py` (Frappe), no central rollup across tenants | Pipe `posawesome.posawesome.api.telemetry.ingest` events to a central time-series store via boat |
| Backend tracing | none | no OpenTelemetry, no traces, no spans | Wrap `@frappe.whitelist()` calls in `posawesome/posawesome/api/__init__.py:1-30` with an OTel decorator; export OTLP to a tenant-aware collector |
| Backend metrics | none | no Prometheus exposition | Add `posawesome.posawesome.api.metrics.metrics` endpoint emitting Prometheus text format; scrape from boat |
| Structured logs | partial | Frappe Error Log captures tracebacks; access log is nginx text | Switch app logs to JSON via `frappe.utils.logger` JSON formatter; ship via fluent-bit |
| Error tracking | Frappe Error Log + RUM `crash:*` | no aggregation, no Sentry-class fingerprinting | Add Sentry SDK (`@sentry/vue` frontend + `sentry-sdk[frappe]` backend) OR build a central Frappe site that ingests `crash:*` events and dedupes by stack fingerprint |
| Dashboards | per-tenant Frappe dashboard | no cross-tenant SLO dashboard | Build a Grafana instance on the boat host scraping (a) prometheus exporter, (b) `posawesome.api.telemetry.get_pos_telemetry_summary` via SQL exporter |
| Synthetic | none against prod | smoke runs on PR only | See §8 |

### 5.3 Recommended stack (defensible minimum)

Frontend RUM (existing) → `posawesome.api.telemetry.ingest` → MariaDB
`POS Telemetry Event` → scheduled prom-exporter → Prometheus
(boat host) → Grafana + Alertmanager → Slack/email.

Backend: Frappe whitelisted methods → OpenTelemetry SDK (Python) →
OTel Collector sidecar → OTLP → Jaeger/Tempo → Grafana.

New components: Prometheus, Grafana, Alertmanager, Jaeger/Tempo, OTel
Collector. All OSS, dockerisable next to the muelle proxy. ~3-4 days
to wire.

### 5.4 Golden signals per surface

| Surface | Latency | Errors | Saturation |
|---|---|---|---|
| `/posapp` boot | LCP p95 | `crash:*` count | heap pressure ratio |
| Cart add | INP p99, `perf:add_item` p99 | `crash:add_item` | watcher count |
| Invoice submit | `pos:invoice-submit` p99 | submit fail rate | outbox depth |
| Catalog search | `perf:catalog_search` p95 | no-result rate | itemsStore size |
| Pricing apply | `perf:pricing_apply` p95 | reconcile failures | rules cache hit |
| Offline sync | outbox drain p95 | sync fail rate | outbox depth |
| Frappe API | p99 by method | 5xx by method | redis queue depth |
| MariaDB | query p99 | error rate | connection pool used |

(Traffic = rps/sessions-per-min, captured by the same store; omitted
from the table for brevity.)

---

## 6. SLOs + error budgets

### 6.1 Proposed SLOs

Anchored to `3-SIGMA.md:56-69` (already authored targets):

| Metric | Target (3-σ ≈ 99.73 %) | Target (6-σ ≈ 99.99966 %) | Window |
|---|---|---|---|
| `/posapp` availability (HTTP 2xx/3xx) per tenant | 99.9 % | 99.99 % | 30 d rolling |
| Cart add INP p99 | < 200 ms | < 200 ms | 7 d rolling |
| Invoice submit success | > 99.9 % | > 99.999 % | 30 d rolling |
| Invoice submit p99 latency | < 1.5 s | < 1.5 s | 7 d rolling |
| Sync lag (offline → server) p95 | < 30 s | < 5 s | 24 h rolling |
| Renderer OOM events per shift | 0 | 0 | per shift |
| Asset 404 (stale SW deploy) per deploy | 0 | 0 | per deploy |

Note: 6-σ on latency is unrealistic — defects in 6-σ math are
binary success/fail. Apply 6-σ only to **defect rates**, not
percentiles.

### 6.2 6-σ defect math

6-σ ⇒ ≤ 3.4 DPMO. For 50 tenants × 200 invoices/day × 30 days =
300 000 invoices/month:

- 3-σ (0.27 %) → 810 failed/month
- 4-σ → 1863; 5-σ → 70; **6-σ → ~1 failed submit/month all tenants**

`pos:invoice-submit` isn't reliably wired yet (`3-SIGMA.md:81` flags
it as a custom mark to wire via `withPerf`); Phase 5 outbox +
idempotency (`posawesome/posawesome/api/idempotency.py`,
`3-SIGMA-PHASE-5-AUDIT.md`) lays the floor.

### 6.3 Error budget burn

30-day 99.9 % avail ⇒ 43.2 min/month allowed downtime. Fast burn:
> 10 min in 1 h → page. Slow burn: > 14.4 min in 6 h → ticket.
Implement via Prometheus multi-window multi-burn-rate alerts
(Google SRE pattern) → Alertmanager.

---

## 7. Alerting + on-call

### 7.1 What pages

- Tenant 5xx > 5 % for 5 min.
- `crash:*` rate > 3× 7-day baseline for 10 min.
- INP p99 > 500 ms for 15 min.
- Invoice submit success < 99 % for 15 min.
- Outbox depth > 1000 events for 5 min.
- Deploy in progress + canary cohort breaching any SLO.

### 7.2 What does NOT page

- Single-tenant transient errors.
- Single user's `crash:*` (could be browser extension —
  `3-SIGMA.md:365-366`).
- Asset 404 below 1 % (likely client-side stale tab from before SW
  update).
- Backend warnings in Frappe Error Log without spike.

### 7.3 Runbooks (none exist today)

Store under `posawesome/docs/runbooks/`. Minimum set:

| Runbook | Trigger | First action |
|---|---|---|
| `RB-001-deploy-rollback` | canary cohort breach | `boat tenant rollback --cohort canary` |
| `RB-002-stale-asset` | asset 404 spike post-deploy | proxy restart + force SW unregister via flag |
| `RB-003-pricing-rule-slow` | `perf:pricing_apply` p99 > 5 s | `flush_pricing_rules_cache` (`3-SIGMA.md:247`) |
| `RB-004-outbox-backlog` | outbox depth alert | check redis queue depth + scheduler health |
| `RB-005-mariadb-locked` | submit failure + lock-wait | identify contending shift, restart its queue worker |
| `RB-006-renderer-oom` | `warn:heap_pressure` > 5/h | confirm Phase 1 web-route flag on for affected tenant |
| `RB-007-frappe-v16-deadlock` | `_ModuleLock` traceback | apply `6e9d7222`-style pre-import workaround (`AUDIT.md:33`) |

---

## 8. Synthetic monitoring

### 8.1 Today

Playwright smoke runs on PR + push (`ci-frontend.yml:42-96`). Two
matrix legs: `/app/posapp` (Desk shell) + `/posapp` (web route).
Skips when secrets aren't set. Trace artifacts uploaded on failure
(`ci-frontend.yml:87-96`).

This catches regressions in CI but does NOT validate prod tenants
between deploys.

### 8.2 Recommendation — scheduled prod synthetics

Add `.github/workflows/synthetic-prod.yml`:

- Trigger: `schedule: cron: '*/15 * * * *'` + `workflow_dispatch`.
- Job per prod tenant URL (matrix from secret JSON
  `POSA_PROD_TENANTS`).
- Run a tightened subset of `frontend/tests/smoke/posapp.web-route.spec.ts`
  — just boot + add-item + cancel; no invoice submit (don't pollute
  prod data).
- On failure: open a GitHub issue (auto-deduped by tenant) + alert
  via Alertmanager webhook.

Optional: run from multiple GitHub-hosted-runner regions (`runs-on:
ubuntu-latest` from different `runs-on` per region) to detect regional
latency.

---

## 9. Feature flags

### 9.1 What we have

Today's flag system is ad-hoc per setting:

- `posa_use_web_route` — POS Profile field (`3-SIGMA.md:116`).
- `posa_rum` — localStorage opt-out (`telemetry.ts:62`).
- `posa_debug` — localStorage opt-in for `debugLog`
  (`AUDIT.md:54`).
- POS Profile fields for various toggles, mutated via Frappe Desk.

No central kill-switch service. To disable a misbehaving feature
across all tenants we'd need to either:

- Push a config change + run `dev-refresh.sh` on every tenant; OR
- Manually toggle POS Profile per tenant in the Desk.

Neither scales.

### 9.2 Recommendation

**Unleash** (OSS, dockerable, no external telemetry). PostHog and
GrowthBook are heavier (analytics-coupled). LaunchDarkly is paid.

Flow: Unleash server (boat host) ← 60 s poll ← Frappe per tenant
(`posawesome.posawesome.api.flags.get_flags`) ← `frappe.call` from
SPA boot → small store keyed by flag + tenant.

Minimum flag taxonomy:

| Flag | Default | Purpose |
|---|---|---|
| `posa.kill.webRoute` | false | force back to `/app/posapp` |
| `posa.kill.rum` | false | global RUM disable |
| `posa.kill.pricingCache` | false | bypass pricing-rules cache |
| `posa.kill.sharedWorkerCatalog` | false | disable Phase 3 worker |
| `posa.feature.outboxWrite` | false | enable Phase 5 SW writes |
| `posa.experiment.cartTableLayout` | "fixed" | A/B (variant `fluid`) |

Kill switches: < 60 s global reach, offline-safe (IndexedDB cached
last-known-good), failures emit `crash:flag_unreachable`.

---

## 10. PR-worthy upstream contributions

Target `defendicon/stage-develop`, priority order:

**PR-A — Playwright smoke matrix on `/app/posapp` + `/posapp`.**
Source `ci-frontend.yml:42-96`. Upstream has the web route but no
matrix gate. Small, secrets-gated, low risk.

**PR-B — Build artifact verifier + checksum gate.** Source
`scripts/verify_build_artifacts.mjs:1-108` + `.test.mjs` +
`build-verify.yml:1-52`. Defends against the recurring
"stale-bundle-after-deploy" class (their `5dc0e516` / our
`b4c514ad`). Our checksum + manifest contract extends their existing
`ed1badac` build-integrity gates.

**PR-C — RUM telemetry client + ingest.** Source
`frontend/src/posapp/utils/telemetry.ts:1-327` +
`posawesome/posawesome/api/telemetry.py` + `POS Telemetry Event`
doctype (commit `3fd64a85`). Upstream has zero RUM; 3-σ is
impossible without it (`3-SIGMA.md:71`). Medium effort (~8 files);
strip `pos:*` event names if doco-specific.

**PR-D — Backend ruff full-lint + `bench run-tests`.** Extend
`ci-backend.yml:53` from `E9,F63,F7` to the full set in
`pyproject.toml:32-58`; add `bench --site example.com run-tests
--app posawesome` before `:81`. Low CI cost; lint backlog may take a
day to clear.

Optional: **CodeQL + Dependabot config** — universally useful, no
fork-specific knowledge needed.

---

## 11. Doco-specific CI / observability (keep in fork)

Coupled to our SaaS posture; NOT for upstream PR.

### 11.1 Per-tenant pipeline (`deploy-tenant.yml`)

- `workflow_dispatch` with `tenant_name` + `version` + `channel`.
- Pull boat's tenant registry via service-account token.
- Build deploy bundle, SSH to tenant host, run §4.3 health probes,
  post deploy event to boat.
- Fork-only: knows boat, muelle volume layout, our DNS/cert setup.

### 11.2 Lab-first hotfix gate (`hotfix-lab-gate.yml`)

Per the operating contract (`feedback_hotfix_lab_first.md`):
`fix(critical|cache|customer|payment|security):` commits must deploy
to lab only, then wait for explicit prod push.

- Trigger: PR labelled `hotfix` OR commit subject matching that regex.
- Auto-deploy to `lab` channel only.
- Require `/promote-to-prod` slash-command from maintainer to ship the
  same SHA to prod.
- Block direct merges to `doco-customizations` without a lab-green run.

### 11.3 Site-change log enforcement

`feedback_site_change_log.md`: every site-touching change must
document verify steps + safe-to-skip path. Add a CI step that
inspects PR commit messages and fails if any
`feat|fix|perf|chore` commit lacks a `Verify:` section.

### 11.4 Prod-confirmation gate

GitHub Environments + reviewers on the `prod` channel target of
`deploy-tenant.yml`. Aligned with `feedback_operating_contract.md`
("prod confirmation, changelog, reversibility").

### 11.5 Multi-fork coordination

Boat orchestrates 6 forks (doco, boat, taller, crm, posawesome,
erpnext_mexico_compliance). A doco-side schema migration triggered by
a posawesome RUM change needs coordinated deploys across forks —
upstream has no concept of that.

---

## 12. Concrete next steps — ordered by leverage

1. **Document branch protection rules** in `.github/branch-protection.md`
   and apply them on `HolyMC2/POS-Awesome` for `doco-customizations`.
   (1 hour, no code.)
2. **Add `dependabot.yml`** + **CodeQL workflow** + **gitleaks
   workflow**. (2 hours.)
3. **Add bundle-size diff check** to PR CI. (3 hours.)
4. **Extend backend CI** to full ruff + bench run-tests.
   (1 day; PR-D candidate above.)
5. **Wire a central telemetry dashboard** on the boat host —
   Prometheus + Grafana scraping
   `posawesome.posawesome.api.telemetry.get_pos_telemetry_summary`.
   (2 days.)
6. **Add scheduled prod synthetic** (`synthetic-prod.yml`,
   15-min cadence, all prod tenants). (4 hours.)
7. **Spec the blue/green tenant deploy** (`muelle/scripts/deploy-tenant.sh`).
   Implement after telemetry dashboard exists. (1 week.)
8. **Pick a feature-flag service** (Unleash recommended) and add a
   3-flag kill-switch table. (3 days incl. SPA wiring.)
9. **Write the 7 runbooks** listed in §7.3. (1 day.)
10. **Open PRs A–D** upstream once the local dust has settled. (2 days
    cleanup work each.)

---

## 13. Path citations

- Workflows: `.github/workflows/{ci-frontend,ci-backend,build-verify,release,docs,format,snapshot-mirror,need-more-info}.yml`.
- Release config: `release.config.js:10-103`. Root package
  `package.json:1-113`. Frontend `frontend/package.json:1-72`.
- Build verifier: `scripts/verify_build_artifacts.mjs:1-108` +
  `.test.mjs`.
- RUM: `frontend/src/posapp/utils/telemetry.ts:1-327` +
  `posawesome/posawesome/api/telemetry.py:1-80+`.
- Architecture: `ARCHITECTURE.md`, `3-SIGMA.md`, `AUDIT.md`,
  `REGROUPED.md`, `3-SIGMA-PHASE-5-AUDIT.md`.
- Tenant deploy template: `~/muelle-host/muelle/scripts/dev-refresh.sh:1-167`.
- Upstream tip: `defendicon/POS-Awesome-V15@45eb528e` (15.29.1,
  2026-05-16). Upstream has an extra `.github/workflows/ci.yml` (full
  Frappe bootstrap) we replaced with `ci-backend.yml`.
- Local tags: `15.29.1, 15.29.0, 15.28.2, 15.28.1, 15.28.0, 15.27.0,
  15.26.0, …` (matching upstream cadence).
