# UPSTREAM-PRS — Sequenced PR Plan Against `stage-develop`

> Target: `defendicon/POS-Awesome-V15` `stage-develop` (NOT `develop`).
> Source aggregation: REVIEW2 reports `01/03/04/05/06/07/08`
> (~33 candidate PRs deduped to 13 below + 2 deferred).
> Snapshot: 2026-05-18 · fork HEAD `968d8c04` · upstream tip `45eb528e`.

Upstream flow recap: `feature/* → stage-develop → develop → tag`
(`REVIEW2/08 §2.1`). All branches in this doc are cut from a fresh
`upstream/stage-develop`. Vitest target ≥ 540/540; `bench build --app
posawesome` clean; Playwright `/posapp` + `/app/posapp` matrix green.

---

## 1. Sequencing graph (which PR blocks which)

```
PR1 (py3.14)  ──┐
                │ independent — ship anytime
PR2 (vuetify) ──┘

PR3 (build/SW/bg-sync) ──► PR-A (smoke matrix, 08) ──► PR-B (build verify, 08)

PR4 (store-de-deepening) ──► PR5 (watcher hygiene) ──► PR6 (pricing fire-and-forget)
                                                             │
PR-C (RUM telemetry, 08) ────────────────────────────────────┘ (needs PR4 floor)

PR7 (customer flow) — independent

PR8 (QZ Tray) ──► PR-SEC1 (qz.sign_message envelope gate, 03)

PR-SEC2 (_scope.py + 15 endpoints, 03) ──► PR-SEC3 (_reprice.py + discount cap, 03)
                                                  │
PR-SEC4 (m_pesa HMAC + PIN lockout + methods=POST sweep, 03)

PR-API1 (error envelope + posa_error helper, 07) ──► PR-API2 (idempotency
        for non-invoice writes, 07)

PR-Q1 (v-html sinks PaymentAdditionalInfo+DeliveryCharges, 06) — independent

PR-UX1 (44px coarse-pointer + manifest hardening, 05) ──► PR-UX2 (BackgroundSync
       outbox, 05) ──► PR-UX3 (swipe-to-delete + undo, 05)

PR-CI1 (CodeQL + Dependabot + gitleaks, 08) — independent, ship FIRST
PR-CI2 (bundle-size diff + Lighthouse + ruff/bench-tests, 08) — after PR-CI1
```

Hard ordering: security PRs (SEC1-SEC4) BEFORE perf cart-blend PRs;
perf cart-blend (PR4/5/6) AFTER upstream cart trio
(`881ba161/2247c666/9f37d53c`) has stabilised on `stage-develop` for
**≥14 days with no revert** (R-01 hard gate in PLAN-6SIGMA §6); CI
hardening first because it gates every other PR.

---

## 2. The 13 PRs

### PR-CI1 · `chore(ci): add codeql + dependabot + gitleaks`

- **Branch**: `chore/ci-security-baseline`
- **Source**: NEW (no fork commit; net-new YAML)
- **Blurb**: Three minimal workflows + one config. CodeQL JS+Py weekly +
  PR; Dependabot for yarn-root + yarn-frontend + pip + actions; gitleaks
  on PR. Closes the "no security scanning" gap
  (`REVIEW2/08 §1.3 row 1, §1.4 1-3`).
- **Conflict risk**: None — net-new files only.
- **Merge gates**: CodeQL green on its own first run; Dependabot config
  loads (cadence/ecosystem decisions deferred to upstream maintainers
  — propose `weekly`+`major-version-bumps-grouped` as a starting point,
  do NOT hardcode "top-5 stale deps"); gitleaks reports zero in main.

### PR-1 · `fix(deps): pre-import pricing_rules to avoid py3.14 ModuleLock`

- **Branch**: `fix/python-3.14-module-lock`
- **Source**: `6e9d7222`
- **Blurb**: One-line fix in `posawesome/posawesome/api/__init__.py`
  pre-imports the `pricing_rules` submodule before any worker thread
  touches it. Closes the `_ModuleLock` deadlock seen on Frappe v16 / Py
  3.14 main bench (`REVIEW2/01 §6 PR1`).
- **Conflict risk**: None — additive 1-line import.
- **Merge gates**: existing test suite; smoke at `/posapp` on Py 3.14.

### PR-2 · `chore(deps): vuetify 3.7.5 → 3.12.6 + buildManifest test`

- **Branch**: `chore/vuetify-3.12.6`
- **Source**: `5aa38110`, `2694d8dc`
- **Note (replay-of-already-shipped)**: Our fork already runs Vuetify
  3.12.6 in production lab + shipped this in the 23-commit perf push.
  This PR ships that bump back upstream — it is a **port of validated
  fork work**, not a speculative bump. Frame the PR description as
  "production-validated for N tenant-months; here's the delta + smoke
  matrix" so upstream reviewers know we've already paid the integration
  cost.
- **Blurb**: Bump Vuetify to pick up the v-virtual-scroll deep-watch fix
  shipped in 3.8; update `buildManifest` spec for hashed entries
  (`REVIEW2/01 §6 PR2`, `REVIEW2/04 §3.4`).
- **Conflict risk**: Medium — `yarn.lock` churn (222 lines). Re-resolve
  from `package.json` on PR branch (`yarn install`) rather than carrying
  lockfile (R-15).
- **Merge gates**: vitest 540+; Playwright smoke matrix; visual diff on
  ItemsSelector + Payments dialog.

### PR-3 · `perf(build): hashed entries + SW versioning + bg-sync hidden-tab guard`

- **Branch**: `perf/build-hashed-entries-sw`
- **Source**: `d477e21f`, `5a1a13fc`, `b6d41569` (rebased on upstream
  `255f88e9`+`9af33b58`)
- **Blurb**: Hash entry filenames to eliminate stale-chunk after deploy;
  register SW at `/sw.js?v=<build>`; pause background item sync when tab
  hidden — rebased ON TOP of upstream's `255f88e9` batching + `9af33b58`
  detail-refresh (`REVIEW2/01 §6 PR3, §4.2`, `REVIEW2/08 §3.3`).
- **Conflict risk**: Medium — `useItemsSync.ts`/`useItemSync.ts` overlap;
  rebase order is take-upstream-as-base, re-apply our hidden-tab guard.
- **Merge gates**: SW updates without orphan chunks (build-verify); bg
  sync stops within 200ms of `visibilitychange=hidden`.

### PR-4 · `perf(stores): shallowRef + markRaw across 8 hot store paths`

- **Branch**: `perf/store-de-deepening`
- **Source**: `8f3a87e5`, `06c1d639`, `47d0ca54`, `c9789db6`, `7f82339d`,
  `0d94b966`, `539d8654`, `40407fee`, `8cc9a311`
- **Blurb**: Nine commits that move 5+ hot Pinia arrays + the itemsMap +
  barcodeIndex + pricingRules inverted index from deep-reactive to
  `shallowRef` + `markRaw`; drops per-search `JSON.parse(stringify
  (posProfile))`; caps customers dropdown to 50. Largest single perf
  delta (`REVIEW2/01 §6 PR4`, `REVIEW2/04 §3.1`).
- **Conflict risk**: Low after upstream cart trio lands; high before
  (overlaps `2247c666`'s deep watcher removal).
- **Merge gates**: heap snapshot baseline (node_count < 3.5M); INP p99 on
  cart-add < 200ms; before/after profiler attached to PR.

### PR-5 · `perf(watchers): drop deep:true + listener cleanup + socket guard`

- **Branch**: `perf/watcher-listener-hygiene`
- **Source**: `dc0518f4`, `5006a5b5`, `9fee9e46`, `2977e50c`, `8eb19103`
- **Blurb**: Strip `deep: true` from 14 hot watchers; cleanup eventBus
  listeners in `PosOffers`/`PosCoupons`/`NewAddress`; idempotent guard on
  `socketStore.init`; bound `_lastSearchServerRetryByTerm` at 100
  (`REVIEW2/01 §6 PR5`, `REVIEW2/04 §3.1`).
- **Conflict risk**: Low — depends on PR4 conceptually, files distinct.
  Note `2247c666` overlap — PR description must reference it and explain
  why ours is the structural fix (R-01).
- **Merge gates**: socket emit count down ≥50% post-edit storm; no
  listener leak in `chunkLoadRecovery.spec.ts`.

### PR-6 · `perf(pricing): fire-and-forget + chunked apply + lean fallback`

- **Branch**: `perf/pricing-fire-and-forget`
- **Source**: `345a59c1`, `4607145e`, `7bbbea2c`, `786d0a91`, `ade09ea1`,
  `c2c78ebc`
- **Blurb**: 5s timeout on server pricing fire-and-forget; chunk
  `applyPriceListToItems` with generation-id guard; lean server search
  fallback; drop cacheEmpty gate + per-term cooldown. Six commits
  (`REVIEW2/01 §6 PR6`, `REVIEW2/04 §2.2`).
- **Conflict risk**: HIGH — needs careful 3-way merge with upstream
  `1000e283`+`881ba161`+`9f37d53c` cart trio. Slowest PR to land
  (`REVIEW2/01 §8`). After upstream cart trio is on `stage-develop`,
  ours is incremental.
- **Merge gates**: cart-add p99 < 80ms with active pricing rules;
  pricing timeout fires only on >5s upstream stall.

### PR-7 · `fix(customer): search_customers + selected_price_list watcher + socket seed`

- **Branch**: `fix/customer-flow`
- **Source**: `0d652a8f`, `188fe54f`, `78750236`
- **Blurb**: New `search_customers` whitelisted endpoint scoped by POS
  profile customer-groups; defer `selected_price_list` watcher
  invalidation; seed `serverOnline` from current socket state
  (`REVIEW2/01 §6 PR7`).
- **Conflict risk**: Low — but grep upstream/refactoring branch for
  `def search_customers` before opening; rename our endpoint if collision
  (R from `01 §8`).
- **Merge gates**: customer-change p99 < 300ms on cached price-list;
  network-online glitch doesn't double-toggle realtime banner.

### PR-8 · `feat(qz-tray): hardening — printer name, base64 letterhead, viewport, pre-warm`

- **Branch**: `feat/qz-tray-improvements`
- **Source**: `9ce815b7`, `6aa28fbd`, `30e39cc7`, `b9db3616`, `660ec6f8`
  (telemetry hook `48a87102` stripped for PR; lives in PR-C)
- **Blurb**: Pass `posa_qz_printer_name` from POS Profile; inline
  letterhead images as base64; pin print viewport to printer width; inset
  print body by 4mm; pre-warm QZ Tray when profile has silent_print
  (`REVIEW2/01 §6 PR8`).
- **Conflict risk**: Low — niche file scope; verify path
  `frontend/src/posapp/composables/pos/payments/usePrinter.ts` doesn't
  collide with upstream `00fcf847`/`3273eca5` (already on develop).
- **Merge gates**: silent print on supported printer pre-warms in <200ms;
  letterhead renders identical to non-base64 path.

### PR-SEC1 · `fix(security): qz.sign_message envelope-gated + supervisor-only`

- **Branch**: `fix/qz-sign-message-envelope`
- **Source**: NEW + commit suffix on `api/qz.py` (cherry-pick of
  forthcoming doco fix)
- **Blurb**: Gate `qz.sign_message` (`api/qz.py:85`) to
  `frappe.only_for(["POS Awesome Print Authority", "System Manager"])`
  AND validate the message is a JSON envelope `{"call":"qz.*", ...}`;
  reject anything else; reduce QZ cert validity at `api/qz.py:155` to 365
  days. Closes the **second worst endpoint** in the codebase: any logged-in
  user can currently sign arbitrary messages with the site's private key
  (`REVIEW2/03 §1.6, §12 row 2`).
- **Conflict risk**: Low — single file.
- **Merge gates**: existing print flow signs successfully; non-envelope
  POST returns 403; cashier role cannot call.

### PR-SEC2 · `feat(security): _scope.py + tenant scope assertions on 15 write endpoints`

- **Branch**: `feat/security-scope-helpers`
- **Source**: NEW (replaces our roadmap S2/S3/S8 hand-rolled fixes with a
  unified helper; aligns with upstream `c805f8a0`/`3c6c75e3`/`359c0a74`
  from `refactoring-repo-architecture-structure` but applies them across
  the whole write surface)
- **Blurb**: New `posawesome/posawesome/api/_scope.py` with
  `assert_company`, `assert_profile`, `assert_customer_in_profile`,
  `get_allowed_companies`, `get_allowed_pos_profiles`. Wire to
  `update_invoice`, `submit_invoice`, `delete_invoice`,
  `delete_sales_invoice`, `get_draft_invoice_doc`, `get_customer_info`,
  `get_customer_addresses`, `get_customer_balance`,
  `get_available_credit`, `create_sales_invoice_from_order`,
  `repair_invoice_submission`, `get_invoice_for_return`,
  `search_invoices_for_return`, `make_address`, `set_customer_info`.
  Drop client-supplied `is_supervisor` arg; re-derive from session roles.
  **Uncomment + wire actual handlers for `permission_query_conditions`
  + `has_permission` hooks** for 7 POSA doctypes — `hooks.py:95-101`
  currently holds the dict scaffold commented out (`REVIEW2/03 §1.10`);
  this PR replaces the comment with the implementation, not adds a new
  hook block (`REVIEW2/03 §2.3, §10 PR-1`).
- **Conflict risk**: Medium — overlaps upstream's
  `api/utils.py:_is_profile_company_allowed` from
  `refactoring-repo-architecture-structure`. Recommend co-authoring with
  upstream maintainer to consolidate naming.
- **Merge gates**: existing `test_creation.py` passes; new
  `test_scope_assertions.py` enforces 15 endpoints; cross-company write
  attempt returns 403.

### PR-SEC3 · `feat(security): server-side reprice + discount cap + payment vs total invariant`

- **Branch**: `feat/security-server-side-reprice`
- **Source**: NEW
- **Blurb**: New `posawesome/posawesome/api/_reprice.py` re-fetches line
  rates from `Item Price` master scoped to `selling_price_list`, re-applies
  pricing rules with `ignore_pricing_rule = 0` server-side. Wired before
  `set_missing_values` in `update_invoice`/`submit_invoice`. New
  `enforce_discount_limit` honors `posa_max_discount_allowed` server-side.
  New `assert_payments_match_grand_total` enforces sum(payments) ==
  grand_total within configurable tolerance. Honors
  `posa_allow_user_to_edit_rate` only if caller's profile permits AND
  within ±20% of master price. Restricts auto-create-customer at
  `creation.py:756-772` to role allowlist. Closes the **single highest-leverage
  fix** in the audit (`REVIEW2/03 §3, §10 PR-2`).
- **Conflict risk**: Medium-high — touches `creation.py` (the
  most-modified file in the repo, `REVIEW2/06 §1.2`). Must coordinate with
  PR-SEC2 (needs `_scope`) and the cart-perf block (PR4/5/6).
- **Merge gates**: property-based test on price invariant (`fast-check`);
  malicious `rate=0.01` payload rejected; legitimate manual rate edit
  within band passes; payment-vs-total mismatch returns 400 with stable
  code `PAYMENT_TOTAL_MISMATCH`.

### PR-SEC4 · `fix(security): M-Pesa HMAC + PIN lockout + methods=POST sweep`

- **Branch**: `fix/security-mpesa-pin-method-allowlist`
- **Source**: NEW
- **Blurb**: `m_pesa.confirmation` requires Safaricom IP allowlist (from
  site config) + HMAC of body against per-tenant shared secret; drops
  `**kwargs` for explicit fields. Strips PII (MSISDN/name) from error log
  at `m_pesa.py:43` to log only `TransID` + error class.
  `verify_terminal_employee_pin` replaces `stored_pin != pin` with
  `hmac.compare_digest`; **adds lockout via Frappe's built-in
  `@frappe.rate_limiter(key='pin_attempts', limit=5, seconds=900)`**
  (do NOT roll a bespoke Redis lockout — Frappe ships this and uses the
  same Redis pool). PIN reset (`save_cashier_pin`) requires supervisor
  role OR self-password re-auth. Sweep all write endpoints to
  `methods=["POST"]` — closes the single `methods=POST`-only endpoint
  gap (`telemetry.ingest`) by making it uniform
  (`REVIEW2/03 §1.2/1.5/1.9, §10 PR-3`, `REVIEW2/07 §11 PR-2`).
- **Conflict risk**: Low — disjoint files; ~30 call sites touched for the
  method sweep but each one-line.
- **Merge gates**: M-Pesa callback rejects without HMAC (smoke); 6th PIN
  attempt in 15min returns 429 via `frappe.rate_limiter`;
  `GET ?cmd=submit_invoice` returns 405.

### PR-API1 · `feat(api): posa_error envelope + stable error codes`

- **Branch**: `feat/api-error-envelope`
- **Source**: NEW
- **Blurb**: Port `frontend/src/posapp/services/api.ts` envelope into a
  server-side helper `posa_error(code, message, retryable=False,
  http_status=400)`. Codes: `TIMESTAMP_MISMATCH`,
  `RETURN_PAYMENT_AMOUNT_SIGN`, `INSUFFICIENT_STOCK`, `BUSINESS_RULE`,
  `PERMISSION_SCOPE`, `PAYMENT_TOTAL_MISMATCH`, `IDEMPOTENT_REPLAY`.
  Replace `frappe.throw(_("..."))` in `invoice_processing/*` + `payment
  _processing/*` with typed envelope. Eliminates the brittle English-
  message regex in `services/api.ts:148-172` (`REVIEW2/07 §6.2/§11 PR-1`).
- **Conflict risk**: Medium — touches every throw in invoice/payment
  paths; conflicts with R-09 (creation.py concurrent change).
- **Merge gates**: SPA classification works in non-English locales (test
  with `frappe.local.lang = 'es'`); existing client-side code paths still
  match new codes (envelope back-compat).

### PR-API2 · `feat(api): idempotency-key on all writes (customer/supplier/PO/cash/gift/mpesa)`

- **Branch**: `feat/api-idempotency-everywhere`
- **Source**: NEW + extends `api/idempotency.py` helpers
- **Blurb**: Extend `posa_client_request_id` pattern from invoice paths
  to: `create_customer`, `make_address`, `create_supplier`,
  `create_purchase_order`, `create_purchase_item`,
  `cash_movement.create_pos_expense`, `cash_movement.create_cash_deposit`,
  `gift_cards.issue_gift_card`, `gift_cards.top_up_gift_card`,
  `m_pesa.submit_mpesa_payment`, `commercial_flow.commit_document_flow_action`,
  `shifts.create_opening_voucher`. Generic ledger keyed by `(method,
  request_id, user)` (`REVIEW2/07 §4.2/§11 PR-3`).
- **Conflict risk**: Low — additive helper + per-endpoint wrap.
- **Merge gates**: replay test for each endpoint asserts second call
  returns same response without duplicate doc; `IDEMPOTENT_REPLAY` code
  emitted on second call.

### PR-Q1 · `fix(security): remove v-html across 4 components (13 sinks)`

- **Branch**: `fix/security-vhtml-sweep`
- **Source**: NEW (companion to upstream `26853355` (generic v-html
  removal) + `8e96d0d8` (Customer.vue) which together cover the
  remaining 5 sinks in `Customer.vue` — tracked via upstream-sync, NOT
  duplicated here)
- **Blurb**: Replace 13 `v-html` sinks with `{{ }}` / safe formatting
  helpers:
  - `payments/PaymentAdditionalInfo.vue:54,59,66,70,73,76,79,84` (8 sinks)
  - `invoice/DeliveryCharges.vue:28,30` (2 sinks)
  - `invoice/ItemsTableExpandedRow.vue:369,372` (2 sinks; batch_no list)
  - `offers/PosOffers.vue:48` (1 sink; offer description via
    `handleNewLine` — replace newline rendering with `white-space:
    pre-line` CSS)
  Co-credits upstream XSS sweep (`REVIEW2/06 §12 PR-1`,
  `REVIEW2/03 §10 PR-5`).
  Verification: `grep -rn 'v-html' frontend/src --include='*.vue'`
  returns 18 occurrences; this PR closes 13; remaining 5 ride upstream
  cherries. Post-merge target is 0.
- **Conflict risk**: Low — leaf templates.
- **Merge gates**: new `tests/security/vhtml-xss.spec.ts` asserts
  crafted payloads (`<script>`, `<img onerror>`, javascript: URL) in
  each field are escaped; `grep` verifies zero `v-html` remains in the
  4 files post-PR.

### PR-UX1 · `feat(ux): coarse-pointer 44px tap targets + PWA manifest hardening`

- **Branch**: `feat/ux-touch-targets-pwa-manifest`
- **Source**: NEW + adapts upstream `feat-ui-ux-improvements`
  `--pos-touch-target-min` token
- **Blurb**: Single CSS block in `theme.css` adds
  `--pos-touch-target-min: 44px` + `--pos-focus-ring`. Coarse-pointer
  media query lifts qty-control-btn / qty-display / action-btn / Customer
  icons / NavbarAppBar icons from 24-40px → 44px (~14 surfaces).
  Manifest: `start_url:/posapp`, single `theme_color: #0f172a`, dark
  splash, add 192/maskable/monochrome icons, `id`, `categories`, `lang`,
  `dir`, `description`, 3 `shortcuts`. Posapp.html: apple-touch-icon
  180×180, `apple-mobile-web-app-capable: yes`, status-bar-style. Adds
  `touch-action: manipulation` to all v-btn. (`REVIEW2/05 §1, §5, §11
  PR-1/2/4`).
- **Conflict risk**: Low — single CSS file + manifest + posapp.html;
  hardcoded 36px sites in `ItemActionToolbar.vue` need follow-up token
  swap.
- **Merge gates**: Lighthouse PWA score ≥90; Playwright touch-target
  audit (custom rule) passes on every interactive selector; no
  desktop layout regression (visual diff).

### PR-UX2 · `feat(offline): BackgroundSync registration for invoice outbox`

- **Branch**: `feat/offline-bg-sync-outbox`
- **Source**: NEW
- **Blurb**: Register a `sync` event in `posawesome/www/sw.js`; fire from
  `offlineSyncStore` when an invoice is enqueued. Survives the user
  closing the tab. Adds visible pendingInvoices badge to mobile dock.
  Surfaces server-online state as a 4-px coloured strip across the top of
  the shell (green/amber/red). Adds conflict-resolution sheet on 409 from
  submit (`REVIEW2/05 §6, §11 PR-3`).
- **Conflict risk**: Low — additive SW code + new component.
- **Merge gates**: tab-kill mid-pending drains outbox within 60s on
  reconnect (synthetic); badge updates within 500ms of enqueue.

### PR-UX3 · `feat(ux): swipe-to-delete cart row with 4-sec undo`

- **Branch**: `feat/ux-swipe-delete-cart-row`
- **Source**: NEW + adopts upstream `0b824198` empty-state polish
- **Blurb**: Pointer-event swipe handler on `CartItemRow.vue` (~60 lines);
  4-sec undo via existing `toastStore`. Replaces the missing dedicated
  remove button (currently the 24-px overflow trash icon). Replaces
  `:draggable="true"` HTML5 drag in `ItemCard.vue` with Pointer Events
  (HTML5 drag doesn't fire on iOS touch). Adopts empty-state art from
  `0b824198` (`REVIEW2/05 §3, §11 PR-5`).
- **Conflict risk**: Medium — `CartItemRow.vue` is hot path; coordinate
  with PR4/5/6 cart-perf block.
- **Merge gates**: 2x swipe-velocity = remove with undo; tap-then-swipe
  doesn't trigger (false-positive guard); iOS Safari touch parity test.

### PR-A · `ci(smoke): playwright matrix /app/posapp + /posapp`

- **Branch**: `ci/playwright-smoke-matrix`
- **Source**: `d56befd8` (Phase 7) — half fork-only (web-route leg) but
  the Desk leg is universally useful
- **Blurb**: Two matrix legs (`/app/posapp` Desk shell + `/posapp` web
  route, the latter gated on `posa_use_web_route=1`), trace upload on
  failure, skip-on-missing-secrets. Upstream has the web route but no
  matrix gate (`REVIEW2/08 §10 PR-A`).
- **Conflict risk**: None — net-new workflow file.
- **Merge gates**: smoke green for both legs in <5min; trace artifact
  uploaded on injected failure.

### PR-B · `chore(build): hashed-entry verifier + checksums + provenance upload`

- **Branch**: `chore/build-verify-checksums`
- **Source**: `d477e21f` + `scripts/verify_build_artifacts.mjs` +
  `.github/workflows/build-verify.yml`
- **Blurb**: Defends against stale-bundle-after-deploy class
  (their `5dc0e516` / our `b4c514ad`). Asserts required manifest assets,
  hashed-entry contract, writes deterministic SHA256 for every emitted
  file. Extends their existing `ed1badac` build-integrity gates
  (`REVIEW2/08 §3.3/§10 PR-B`).
- **Conflict risk**: Low — net-new script + workflow.
- **Merge gates**: tamper-injection (modify one byte in dist) makes the
  verifier exit non-zero.

### PR-C · `feat(observability): RUM telemetry client + ingest + doctype (generic core only)`

- **Branch**: `feat/observability-rum`
- **Source**: genericised subset of `398539c1`, `6b22d002`, `3fd64a85`,
  `48a87102`
- **Split rationale (resolves §4 contradiction)**: the same commits
  power BOTH the upstream-shaped RUM (this PR) AND the doco-only
  dashboard payload + per-tenant retention (which stays fork-only, see
  §4 "Telemetry doctype + ingest + RUM"). Concretely:
  - **In this PR (genericised)**: `telemetry.ts` client, ingest
    endpoint, `POS Telemetry Event` doctype, prefix allow-list
    (`rum:|perf:|crash:|warn:`), batch cap, sendBeacon on
    `visibilitychange→hidden`, generic QZ Tray print-failure event
    schema. No `pos:*` prefix, no doco brand fields, no per-tenant
    retention policy. Defaults to event purge at 30 days.
  - **Stays fork-only**: `pos:*` prefix events (doco-specific surfaces),
    the `get_pos_telemetry_summary` payload shape Doco's dashboard
    consumes, per-tenant retention overrides, the muelle-host event
    pipeline. Reference doco branch (NOT this PR) for those.
- **Blurb**: `frontend/src/posapp/utils/telemetry.ts` + ingest + summary
  + `POS Telemetry Event` doctype with the generic event taxonomy.
  Includes `48a87102` QZ Tray print-failure capture as a vendor-agnostic
  schema (event name `crash:print` not `pos:qz_failure`)
  (`REVIEW2/08 §10 PR-C`).
- **Open question for Marco**: should the doctype shape itself ship
  upstream, or keep doco-owned for faster iteration? (Q-08 in ROADMAP
  §9.) Default: upstream owns the doctype, doco extends via Custom Fields.
- **Conflict risk**: Low — net-new files; the doctype needs a one-line
  hook to `scheduler_events.daily` for `prune_old_events`.
- **Merge gates**: ingest accepts batches up to 200, drops oversize;
  `get_pos_telemetry_summary` returns within 1s for 30-day window;
  generic test fixture asserts `pos:*` events are not in the schema.

### PR-CI2 · `ci(quality): bundle-size diff + lighthouse + full ruff + bench run-tests`

- **Branch**: `ci/quality-gates`
- **Source**: NEW
- **Blurb**: Adds bundle-size diff (fail if `loader-*.js` /
  `posawesome-*.js` grow >10%), Lighthouse on PR with `perf` label, full
  ruff lint set from `pyproject.toml:32-58`, `bench --site example.com
  run-tests --app posawesome` (current backend CI only runs offline-sync
  unittests) (`REVIEW2/08 §1.3 row 2/3, §1.4 4-5, §10 PR-D`).
- **Conflict risk**: Low — workflow additions; lint backlog may take a
  day to clear before merge.
- **Merge gates**: full ruff passes on main; bench tests pass on bench
  v15 (CI target); bundle-size baseline written.

---

## 3. Optional / deferred PRs

| # | Branch | Source | Why deferred |
|---|---|---|---|
| Deferred-1 | `feat/dashboard-section-split` | `a993826b`, `3d469739` | Dashboard API contract touches — needs upstream signal first; defer to P2 after centralization (`REVIEW2/01 §6 PR9`) |
| Deferred-2 | `perf/redis-pricing-rules-cache` | `865a0900` | Backend Redis caching — needs ops-side review; defer to P2 after observability landed (`REVIEW2/01 §6 PR10`) |
| Deferred-3 | `fix/scanner-self-heal` | `6a17091b` | Niche; bundle with next QZ/scanner round (`REVIEW2/01 §6 PR11`) |
| Deferred-4 | `feat/api-openapi-redoc` | NEW (P2) | OpenAPI generator + Redoc panel — needs `@posa_api` decorator infra first; defer to P2 (`REVIEW2/07 §11 PR-4`) |
| Deferred-5 | `feat/api-capability-bootstrap` | NEW (P3) | Capability endpoint + tenant feature negotiation — needs feature-flag service first (`REVIEW2/07 §11 PR-5`) |
| Deferred-6 | `refactor(invoice): split creation.py into 4 modules` | NEW (P2) | Split `creation.py` (1,420 LOC) into `creation/build|tax|payments|submit.py`. Wait until cart-perf and security PRs land — most-modified file (`REVIEW2/06 §12 PR-5`) |
| Deferred-7 | `refactor(dashboard): extract sections into api/dashboard/sections/*` | NEW (P2) | Split `dashboard.py` (5,829 LOC). Defer until after `Deferred-1` lands and centralization rebase resolves (`REVIEW2/06 §12 PR-4`) |
| Deferred-8 | `chore(deps): remove vendored opencv.js + dexie.min.js` | NEW (P2) | Saves 12,200 LOC. Defer until build path verified — SW precache assumptions need checking (`REVIEW2/06 §12 PR-3`) |
| Deferred-9 | `refactor(api): contextmanager for ignore_account_permission` | NEW (P1) | Wraps 19 sites with `with ignore_account_permission():`. Defer until after `PR-SEC2` so the scope-assert is in place to make permission discipline meaningful (`REVIEW2/06 §12 PR-2`) |
| Deferred-10 | `feat(audit): POS Security Event doctype + retention` | NEW (P3) | Audit log for scope-assert failures, PIN events, privileged ops. Defer until `PR-SEC2` + `PR-SEC4` land — those are the events being logged (`REVIEW2/03 §10 PR-4`) |

---

## 4. Doco-fork-only commits — NEVER PR upstream

Per `REVIEW2/01 §6` "Doco-only — DO NOT PR":

| File / commit set | Why stays fork |
|---|---|
| **Web-route `/posapp`** — `cc180855`, `9cce3144`, `b827243f`, `6e83e02d`, `4f70f958`, `c91686ce`, `ce7aa47e`, `f14e7010`, `35e1acf3`, `ce7b1cdd` (10 commits) | 470-LOC `frappe-shim.ts` is doco-specific Desk-bypass; other deployments may want Desk shell. Re-evaluate once shim is generalised (`REVIEW2/02 §6, §9.2 open Q2`) |
| **Telemetry doctype + ingest + RUM** as a doco-only feature: `3fd64a85`, `6b22d002`, `398539c1` | We DO ship the same code as `PR-C` upstream, but the doco-specific dashboard payload + per-tenant retention stays fork-only. Marco call required before generalising (`REVIEW2/01 §8 open Q1`) |
| **Hashed entry bundles via `version.json`** (fork-only side) | `d477e21f` ships as PR-3 upstream. The doco `verify_build_artifacts.mjs` + per-tenant deploy probe in `4.3` stays fork |
| **`frappe-shim.ts`** (~470 LOC) | Web-route enabler; upstream may reject. Maintain coverage checklist in shim header (`REVIEW2/02 R-shim`) |
| **Doco-specific perf hacks** | `851e80f4` (perf badge — opt-in flag), `25dbb58f` (Phase 3 worker — flagged-off), `865a0900` (Redis pricing cache, ship as Deferred-2 if upstream wants it) |
| **Doco CI / fork tooling** | `1d0ff2cf` ci.yml removal, `d56befd8` Phase 7 CI matrix (web-route leg only — Desk leg ships in PR-A) |
| **Doco fixtures** | POS Awesome Supervisor role override, doco's `posa_*` defaults, MX/RFC validation in `validate(tax_id)`, doco-only `posa_telemetry_enabled` toggle (REVIEW2/03 §11) |
| **Boat / muelle integration** | Per-tenant Cloudflare Worker config; `muelle/scripts/deploy-tenant.sh`; per-tenant feature-flag service binding; muelle outbox table variants of `offline_sync.invoices.*` (`REVIEW2/07 §12`) |
| **Documentation** | `AUDIT.md`, `3-SIGMA.md`, `3-SIGMA-PHASE-5-AUDIT.md`, `ARCHITECTURE.md`, `POSAWESOME-ROADMAP.md`, `REGROUPED.md`, `NOTES.md`, `CATALOG-FREEZE.md`, all REVIEW2/* — fork-internal planning. None go upstream |
| **Phase 2 native cart + Phase 1.H drafts** — `39dfa4df`, `96386e5d` | Too entangled with upstream's parallel cart-perf effort; revisit after `881ba161` matures, then submit a clean diff if upstream interested |
| **CFDI / MX glue** | All `erpnext_mexico_compliance` interplay lives in the sibling app; posawesome stays generic. RFC validation in `create_customer` is the only doco patch that touches posawesome runtime (`REVIEW2/03 §11.2`) |
| **Per-tenant scoping leaked into posawesome** | Verified clean as of 2026-05-18 via `git grep -in 'laboratorio\|\bshop_id\b\|tabShop\|\bmercado\b\|\btaller\b' -- ':!docs/' ':!*.md' ':!CLAUDE.md'` → **0 matches** in code. Add this grep to CI as a guard so cross-app scope tokens can't silently land in posawesome. Re-run before each upstream PR opens (`REVIEW2/03 §2.2`) |
| **Reverts and reverted originals** | `0bddc50a`, `ffb4e67d` + their originals — local-only |
| **Tag prefixes** | `doco-15.29.1-<n>` pre-release tags for fork channel; upstream stays on `15.x.y` linear (`REVIEW2/08 §3.1`) |

---

## 5. PR sequencing checklist (Phase B replay order)

After Phase A `merge/upstream-develop-2026-05-18` lands on `doco-customizations`
(`REVIEW2/01 §7`), open PRs in this order from fresh `upstream/stage-develop`:

1. `PR-CI1` (no code dependencies — green-light other PRs)
2. `PR-1` (1-line, unblocks F16+Py3.14 main bench reviewers)
3. `PR-Q1` (XSS — security urgency)
4. `PR-SEC1` (qz oracle — security urgency)
5. `PR-SEC4` (M-Pesa + PIN + methods sweep — security urgency)
6. `PR-2` (Vuetify bump — independent)
7. `PR-3` (build/SW/bg-sync rebased on upstream `255f88e9`/`9af33b58`)
8. `PR-A` + `PR-B` (CI smoke + build verify — depend on PR-3 manifest)
9. `PR-C` (RUM — wants PR4 floor)
10. `PR-4` → `PR-5` → `PR-6` (perf block — sequenced after upstream cart trio)
11. `PR-7` (customer flow — independent)
12. `PR-8` (QZ Tray — independent)
13. `PR-API1` → `PR-API2` (error envelope + idempotency)
14. `PR-SEC2` → `PR-SEC3` (scope + reprice — wait until SEC1/SEC4 + API1 land)
15. `PR-UX1` → `PR-UX2` → `PR-UX3` (mobile sequence)
16. `PR-CI2` (bundle/Lighthouse/ruff/bench-tests — needs all above PRs stable
    to set baselines)

Total: 13 active + 10 deferred = 23 sequenced PRs aggregated from ~33
candidates across reports 01/03/04/05/06/07/08.

— synth-lead, 2026-05-18.
