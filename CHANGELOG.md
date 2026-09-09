# POSAwesome Changelog

Recent changes and recorded rollout notes. Full older records are linked below; archiving does not mark an entry deployed or complete. Verify status against the deployed revision when it matters.

For new entries, describe the changed behavior and include the commit, affected scope, and migration/rollback requirements when relevant. Link lengthy verification evidence. Read only the entries relevant to the task.

## Unreleased

Original status labels are retained; this section also contains changes reported as deployed.

- **Backend CI fixture isolation (2026-09-09, local verification).**
  Run every API test file in its own interpreter to prevent fake Frappe/package
  modules from leaking between fixtures. Repair obsolete fixture contracts and
  assert both ordered invoice-cancellation hooks. Keep missing-Frappe native
  skips explicit and document the separate v16 execution lane. Verified all
  832 standalone cases on Python 3.10/3.14 (31 explicit skips), four runner
  regressions, and all 36 native cases with rollback-only fixtures in the Doco
  lab mirror. Changes cover workflows, test files, and the new runner; runtime
  code and assets are unchanged. No migration, build or runtime rollout needed.
  See [backend test lanes](docs/testing/backend.md).

- **Self-contained offline fallback (2026-09-09, release candidate).**
  Remove the obsolete fixed-name POS CSS URL from `posawesome/www/offline.html`
  and render its disconnected icon inline. The cached page keeps its existing
  styles and explanation without a network stylesheet or icon-font dependency.
  Verified offline-page resource checks against the existing service-worker
  fallback path. Template-only; existing SPA bundles remain valid, no migration.

- **Coordinated POS integration (2026-09-09, LAB validated; release candidate).**
  Preserve the deployed Cash In guidance and both development/production
  histories while adding MercadoPago terminal-outcome handling: a completed
  unsuccessful outcome stops polling, displays its reason, and offers retry.
  Changed files: `frontend/src/posapp/composables/pos/payments/useMpPointSaleGate.ts`,
  `frontend/tests/mpPointSaleGateStatus.spec.ts`, and
  `docs/MERCADOPAGO_POINT_INTEGRATION.md`. Verified 81 targeted frontend tests,
  strict type checking, production build/artifact checks, and 48 mocked cash,
  safe-transfer and closing tests in `doco-mirror.lab.xoloitzcuintles.com` after
  matching its full POS Python source hash to this candidate. No real payment
  was sent. Deployment requires the rebuilt SPA; no migration or data changes.

- **Cash In balance guidance (2026-09-08).** Insufficient safe funds now show
  the source account, recorded balance and requested amount in Spanish, with
  guidance for cash brought from home or another source. The check uses the
  saved journal's rounded company-currency amounts and preserves ERPNext's
  submission validation. Account mappings and movement types are unchanged.
  Verified with 48 focused tests and rollback-only lab journal checks: a
  $130 withdrawal from $130 succeeds; a $1,000 request fails cleanly.
  Deployment needs a Python reload and translation cache refresh; no migration.

- **POS review corrections (09-06), LAB `review0906-3`; production pending.**
  - Make terminal resume retries return the first successful generation after
    a lost response. Persist protected resume provenance; ordinary money
    requests still require the current generation. Protect terminal fields
    during native updates after submission as well as ordinary saves.
  - Clear a closing fence only after proving that the shift is still open
    with a newer generation. Compare and delete atomically so another tab's
    newer fence survives. No timeout clears an uncertain close result.
  - Separate Spanish labels for change due, changing a kitchen station,
    delivered status and delivered orders; enforce unique translation keys.
  - Retire cancelled invoice claims without losing their source history.
    Rebind only a matching native amendment of the currently linked cancelled
    invoice; reject competing source charges and preserve the retired claim
    if submission fails. Cashiers can release their untouched pinned draft
    after reviewing saved payments, then reload the current repair quote.
  - Stop source callbacks for cancelled invoices and move an eighth failed
    callback to visible Needs Review. Reuse a live charged repair request
    instead of creating another charge on a subsequent source save. Read the
    current locked source quote before preparation and submission.
  - Prepare POS Invoices with profile-derived zero tender rows. Preserve the
    source currency and use native receivable and server exchange-rate rules.
  - Compose POS opening-shift validation through Frappe's controller extension
    hook. The Mexican compliance controller retains its fiscal methods while
    ordinary POSAwesome shifts can submit POS Invoices without creating an
    unrelated ERPNext opening entry. Invoices without a POSAwesome shift keep
    native ERPNext opening validation.
  - Verification: 5,438 frontend tests in 475 files, type-check and production
    build passed (`review0906-3`). 41 native charge/Taller/exception/controller
    regressions passed in 54.6 seconds with fixture rollback, including cancel/amend,
    changed-quote release/reload, zero-tender POS Invoice and USD preparation.
    Four composition cases also passed on DEMO. Both actual LAB tenants use
    the fiscal controller; an isolated resolver case verifies the native base.
    Also passed: 77 focused backend checks, six native terminal/recovery cases,
    22 closing-fence/recovery frontend checks and six translation checks.
    Installed Frappe already maps database error
    1020 to the existing read-only retry; no broad retry was added. Native
    manager recovery preserves a parked sale's original request and posts it
    once after a terminal generation change.
  - Final-bundle read-only LAB smoke passed at 1440px and 390px. The public
    manifest and browser-loaded entry/CSS hashes match the local build.
    Register status fits and opens/closes with zero page errors or attempted
    money writes; the original terminal generation is unchanged. Pending
    Charges is disabled for that profile, so its release dialog is covered
    by component/native tests, not this browser smoke.
  - Eight-hour endurance remains unverified. Native invoice-first locks and
    source-first callback locks can contend; a two-connection cancellation/
    delivery deadlock drill remains outstanding. No generic financial write
    retry or production deployment is included in this correction pass.

- **POS exception review and release evidence (09-06), LAB `ready0906-7`.**
  - Add a lazy "Money needing attention" screen from register status and
    Receivables. Combine cashier-owned browser work with permission-scoped
    invoice/payment receipts, paid-order callbacks and enabled provider/fiscal
    exceptions. Report unavailable or failed sources explicitly. Reading the
    screen never writes money; retries reuse the existing queue and request ID.
    Long translated action labels wrap inside phone-sized exception cards.
  - Preserve ordinary queued payments on HTTP-200 business errors, partial
    results, draft documents or missing acknowledgement data. Clear stale
    cashier information on focus/session changes and guard source navigation.
  - Handle offline failures in optional payment/customer/settings reads without
    uncaught promise rejections. Callback-based Frappe calls handle their own
    network errors; promise-only and API-wrapper calls still reject failures.
  - Add a strict release runner with candidate, app, schema and artifact hashes;
    missing, skipped, flaky, stale or incomplete evidence cannot certify a
    release. Lifecycle receipts and hardware sessions require concrete proof.
    Cross-tenant and prior-version rollback verification remain outstanding.
  - Add a durable eight-hour/500-cycle endurance runner with exactly 20 private
    nonstock cash sales, queue reload/reconnect, lost acknowledgements, session
    expiry, native ledger checks, memory/listener budgets and native cleanup.
    Short smoke runs are explicitly noncertifying. Full-shift evidence must be
    read from the completed run journal; implementation alone is not a pass.
  - Verification: 5,422 frontend tests in 473 files and type-check/build passed;
    11 native exception-feed and 29 native accounting/delivery cases passed.
    The five-cycle smoke passed with one real paid sale, zero page errors
    (previously ten), zero duplicate invoices and zero residual queued work.
    Its retained heap stayed between 21.5 and 22.4 MB; listeners were 570–573.
    Separate online/offline acknowledgement smoke variants also passed. The
    full endurance attempt stopped after two completed cycles when the next
    offline cycle sampled 693 CDP event listeners against a 605 limit. Both durable
    stores were empty and browser errors were zero; the cause of that sample
    remains unverified. The eight-hour gate has not passed.
  - Measurements: no exception-feed requests on startup; real desktop/phone
    opening 286–292 ms and warm refresh 47–59 ms (median 53 ms). The native feed's warm median
    was 7.7 ms in the bounded fixture. These are LAB checks, not a full-shift,
    stock, physical-hardware, provider-settlement or production certification.

- **POS completion and recovery (09-06), on LAB as `ready0906-4`; production pending.**
  - Bind an open shift to a browser possession secret and revocable generation.
    A durable closing fence covers every local money queue. Supervisors can
    authorize a replacement browser without opening their own shift, then
    recover individual saved sales with their original request IDs and an audit
    reason. Historical unverified acknowledgments remain pending for review.
    Direct invoice/cash document writes cannot bypass the terminal gates.
  - Claim Doco charge requests once, pin their currency/source lines, complete
    them in the invoice transaction and retry source callbacks durably. Public
    repair checkout retains source warehouses and an exact invoice backlink.
  - Use ERPNext's date/customer/UOM/batch/quantity price resolver and server
    exchange rates. Reject unapproved zero prices and cross-company draft
    changes; returns preserve original exchange rates. Financial request
    receipts are protected against direct edits and survive invoice pruning.
  - Add supplier credit/debit-note settlement and durable reconciliation replay.
    An unused customer advance refund requires a server payout quote and an
    original-payment reference; its confirmed intent is saved before HTTP and
    remains in pending payments if the result is uncertain.
    The enabled Payments and advances entry works without an outstanding
    invoice. Payment capture preserves the browser's verified shift ownership.
    Journal Entries remain a Desk workflow and are excluded from POS credit
    choices; payment advances and invoice credit notes remain selectable.
  - Load realtime asynchronously so an unavailable socket library cannot hold
    checkout startup. Benchmark search visibility separately from actual
    configured/payable checkout. Golden certification rejects stale reports,
    global errors, skipped-only runs and wrong-run invoice matches.
  - Validation: 5,383 frontend tests in 468 files, type-check and build passed.
    Finance passed 204 focused standalone and 26 real Frappe cases, plus nine
    committed accounting scenarios with native cleanup and zero residual party
    GL. Advance refunds passed nine native cases and two-connection replay/
    competing-refund checks. Doco passed 17 contract/delivery regressions.
    All 12 sale/offline browser drills passed on `ready0906-2` with zero skips,
    unexpected outcomes or flaky retries. The final candidate adds the
    payment-screen terminal-proof correction found by the real refund drill
    and body placement for the recovery panel on both desktop and mobile;
    the desktop placement regression failed before the fix.
    Final-build ordinary-cashier UI refunded a further MXN 20 from the first
    refund's MXN 60 remainder, leaving exactly MXN 40 with the correct native
    allocation and zero browser errors. Both opening refreshes retained verified
    ownership. Four desktop/mobile terminal-panel scenarios passed viewport,
    control hit-testing and close checks; 14 enabled controls were reachable.
  - Paired `hard0906-1` -> `ready0906-4` bundle comparison, five cold/cached
    samples per arm at 40 ms/5 Mbps/4x CPU on the same current backend/template:
    search visibility 4,516.0 -> 4,194.9 ms cold and 1,725.4 -> 1,518.2 ms cached;
    configuration readiness 5,032.8 -> 4,921.5 ms cold and 1,978.1 -> 1,725.6 ms
    cached. LCP was 4,108 -> 3,996 ms cold and 1,708 -> 1,576 ms cached.
    Cold POS JavaScript rose 795,604 -> 801,243 bytes (+0.71%) for the added
    functionality; all 20 navigations used the expected build with zero duplicate
    modules. This is a small sequential LAB observation, not statistical proof
    or a historical full-stack comparison. The manifest was restored to the
    final candidate under the deploy lock.
    A separate final-build check used a real fixture and the normal tender UI:
    search-to-payable-tender probe 1,820.4 ms, with no invoice submission.
    That probe starts after the benchmark's legacy sampling delay; its absolute
    navigation timestamp is not a directly comparable startup-ready metric.
    Three final-build realtime fault drills passed with zero browser/API errors:
    usable checkout in 2,500.3 ms while the library arrived at 12,185.3 ms;
    completely blocked-library checkout in 2,441.9 ms; first-download-failure
    recovery in 1,673.8 ms. Reconnect retained one script and one handler, and
    each probe left an empty cart without submitting an invoice.
  - Native price lookup accuracy adds cost for distinct items: warm median for
    100 unique lines 45.85 -> 63.03 ms, unchanged SQL count. Per-request memoization
    makes 100 identical lookups 39.86 -> 0.75 ms and reduces their SQL calls from
    100 to one. These are price-lookup microbenchmarks, not checkout timings.
  - Rollout requires coordinated Python/assets plus the opening/charge DocType
    migrations. Legacy shifts require browser registration and saved-work
    review; do not clear old browser data. All changes remain LAB-only until
    final acceptance and the production rollout gates pass.

- **Further POS hardening (09-06), on lab as `hard0906-1`; production pending.**
  - Collection validates finite nonnegative tender input, allowed payment
    methods and active company Bank/Cash accounts. Current locked invoice
    balances replace client-supplied outstanding/conversion data; party locks
    and current request-ID reads serialize retries with refunds. Changed
    retries, false credit notes and wrong-direction reconciliation are rejected.
    Per-operation savepoints undo failed Payment Entry/ledger work, and payment
    read/reconciliation endpoints enforce company/profile/customer access.
  - Cash refunds use submitted cash/bank tender and actual later receipts,
    deduct prior payouts, and account for write-offs, credit offsets, currency
    conversion and cancelled payments. Shared party/original-invoice locks
    protect the remaining refund budget; one cent over the limit is rejected.
  - Shift closing reads durable invoice/payment/cash/restaurant queues and the
    outbox before both preparing and submitting a close. Unreadable or pending
    local money blocks closure. A verified submitted outbox acknowledgment
    atomically completes its same-owner write-queue mirror; draft/cancelled or
    ambiguous responses stay pending for retry/review.
  - Offline receipts escape data, autoescape custom templates and sanitize the
    final HTML with pinned DOMPurify 3.4.15. Rich terms remain supported; scripts
    and event handlers cannot execute. Partial credit-sale receipts show the
    actual paid amount. Receipt, calendar and camera libraries leave startup's
    dependency tree; calendar and receipt first use works offline after cache
    installation. New operator messages include Spanish translations.
  - Validation: 5,328 frontend tests, 118 focused backend tests, five translation
    checks, type-check and production build passed. Eight browser scenarios
    passed, including offline first-use and hostile receipt HTML. The mixed-tax
    drill initially hit depleted fixture stock; after a lab Material Receipt it
    passed with exact per-line/total quantities checked before payment. Real
    rollback-only accounting tests covered later receipts, refunds, currencies,
    retry identity, foreign-company denial and failure after ledger submission;
    two DB processes verified party-lock waiting/release.
  - Paired frontend comparison on the same current lab backend, medians of five
    cold/cached runs at 40 ms latency, 5 Mbps and 4x CPU slowdown: search-field
    visibility 4,718.6 -> 4,560.3 ms cold (3.35% lower), 1,638.3 -> 1,601.4 ms
    cached (2.25% lower). Cold JavaScript transfer 903,292 -> 795,604 bytes
    (11.92% lower), with zero duplicate module paths. LCP worsened: cold
    4,208 -> 4,336 ms; cached 1,580 -> 1,700 ms. These small timing differences
    are observations, not statistical proof of a general speedup. An earlier
    unpaired cohort had slower readiness; one initial standalone probe timed
    out and was not reproduced in the subsequent diagnostic/paired runs.
  - Limits: this does not certify every workflow as feature-complete. Other
    devices' pending work cannot be seen by a browser closing guard; historical
    ambiguous outbox acknowledgments still require reconciliation. Concurrent
    committed collections, external M-Pesa settlement and separate-party-account
    advance reconciliation were not live exercised. Lab remains `hard0906-1`.

- **POS audit fixes (09-06), on lab as `aud0906-3`; production pending.**
  - Offline Item, Customer and Stock sync drains every page before advancing
    its saved timestamp. Database-ordered cursors, scope recovery and durable
    deletion failures prevent skipped records. The legacy item delta follows
    the same path. Real mirror parity: 5,541 eligible items across 40 pages,
    zero missing/extra/duplicate items; 2,349 excluded-item tombstones.
  - Offline stock uses signed stock quantities/UOM conversion, reduces stock
    once per durable sale, and restores returns. One box of 12 from 12 units
    now leaves 0, where the old calculation left 11.
  - Queue/outbox operations enforce cashier/profile ownership and detect stale
    login cookies. Legacy unassigned work is preserved for manager recovery;
    cache clearing and failed corruption recovery cannot erase pending sales.
    Browser storage persistence is requested and its actual status is shown.
  - Existing-draft submission checks the stored owner/profile/company.
    Zero-price promotion exemptions require server-verified offer/rule
    eligibility, including gift quantity limits and original free-item returns.
  - Hashed module preloads use the same URLs as imports. Cached item groups
    render before network refresh; unchanged responses skip reactive updates
    and cache/readiness writes. Search-worker indexing is lazy and only
    replaces IndexedDB search for a complete resident catalog; its compiled
    JavaScript is included in the offline manifest. The worker remains opt-in.
    Performance wrappers emit one telemetry event per operation.
  - Validation: 5,311 frontend tests, 162 focused backend tests, type-check and
    production build passed. Seven browser drills passed (mixed-tax cash sale,
    offline reload/reconnect, lost acknowledgments and offline worker startup).
    Seven real promotion integration cases passed with all temporary records
    rolled back. New operator messages include Spanish translations.
  - Controlled lab measurements, medians of five runs per cold/cached mode,
    40 ms latency, 5 Mbps download and 4× CPU slowdown: search-field-visible
    time 5,700.8 → 4,645.3 ms cold (18.5% lower), 1,706.7 → 1,488.7 ms cached
    (12.8% lower). Cold JavaScript transfer 1,634,115 → 903,292 bytes (44.7%
    lower); duplicate module paths 10 → 0. Cold LCP 5,432 → 4,520 ms; warm
    LCP did not improve (1,584 → 1,640 ms). These are lab observations, not
    production latency guarantees. Reproduce with
    `scripts/benchmarks/measure_register.mjs` and lab smoke credentials.

## More recent changes — full records

- [The pay screen and Cobranza join the keyboard — keymap v6 (09-05), ON LAB, prod pending «push to prod».](docs/changelog/2026-09.md#entry-006)
- [The keyboard-driven register — keymap v5 (09-05), ON LAB, prod pending «push to prod».](docs/changelog/2026-09.md#entry-007)
- [Series y lotes — the register's own serial / IMEI and batch lookup (09-05), ON LAB, prod pending «push to prod».](docs/changelog/2026-09.md#entry-008)
- [MercadoPago + partial/split payments hardened across the register (09-05) — ON PROD both tenants, `1b3fc5209 → 37210bcc8150`, Marco «push to prod».](docs/changelog/2026-09.md#entry-009)
- [A sale queued offline now syncs even when the reconnect beats the boot (09-05).](docs/changelog/2026-09.md#entry-010)
- [The phone can ring up a sale while offline (09-04).](docs/changelog/2026-09.md#entry-011)
- [The offline sale now actually syncs, and a lost ack no longer leaves the cashier holding the cart (09-04) — ON PROD both tenants, `b32a7071b → 087831a25`, stamp `087831a255df`, Marco «push to prod».](docs/changelog/2026-09.md#entry-012)

## Older Unreleased and rollout/follow-up records

These links keep historical Unreleased, lab, or follow-up notes visible. Some may already be superseded; this is not a verified list of current defects or pending deployments.

- [The ticket panel is a bottom sheet on phones (08-31).](docs/changelog/2026-08.md#entry-013)
- [The hosted ledger on a phone stops sliding, sits under the drawer, and gets a phone layout (08-31).](docs/changelog/2026-08.md#entry-014)
- [The rate band is visible while typing (08-29, critique C3).](docs/changelog/2026-08.md#entry-015)
- [The retail tip moment (08-29, critique C2).](docs/changelog/2026-08.md#entry-016)
- [The self-service kiosk (08-29, critique D2).](docs/changelog/2026-08.md#entry-017)
- [The order hub, register side (08-29, critique D3).](docs/changelog/2026-08.md#entry-018)
- [Courses and seats on the line — «phase 2» ships (08-29, critique B4).](docs/changelog/2026-08.md#entry-019)
- [The kitchen display (08-29, critique D1).](docs/changelog/2026-08.md#entry-020)
- [The kitchen ticket grows a lifecycle — the bump (08-29, critique B3).](docs/changelog/2026-08.md#entry-021)
- [The comandas board (08-29, critique B2).](docs/changelog/2026-08.md#entry-022)
- [«Dividir entre N» at the payment screen (08-29, critique C1).](docs/changelog/2026-08.md#entry-023)
- [Firing a comanda now moves the world (08-29, critique B1).](docs/changelog/2026-08.md#entry-024)
- [The band stops lying on hosted destinations (08-29, critique A1/A2).](docs/changelog/2026-08.md#entry-025)
- [The corte counts tips out (08-29, critique B5).](docs/changelog/2026-08.md#entry-026)
- [POS Profile settings live in their own «POS Awesome» tab, and the descriptions finally tell the truth (08-29).](docs/changelog/2026-08.md#entry-027)
- [Safe-transfer profile settings removed (08-29).](docs/changelog/2026-08.md#entry-028)
- [The rate band is drawn around the list that priced the cart (08-29).](docs/changelog/2026-08.md#entry-029)
- [Orden de servicio queue is fed by Taller's pull flow (08-24, lab).](docs/changelog/2026-08.md#entry-030)
- [«En trabajo» is a figure, not a disabled pill](docs/changelog/undated.md#entry-031)
- [The ticket panel names its day, its customer and its origin](docs/changelog/undated.md#entry-032)
- [The navbar chip ladder measures its own box](docs/changelog/undated.md#entry-033)
- [The Cobro pad answers the physical keyboard](docs/changelog/undated.md#entry-034)
- [A touch register keeps its keyboard down and its bar inside the glass](docs/changelog/undated.md#entry-035)
- [Cart rows show the item's artwork](docs/changelog/undated.md#entry-036)
- [Quick item creation is a real intake form (roadmap §17.2).](docs/changelog/undated.md#entry-037)
- [Discount is a button, not a small field (roadmap §17.2).](docs/changelog/undated.md#entry-038)
- [Price checker — checador de precios (roadmap §17.2).](docs/changelog/undated.md#entry-039)
- [Shortcuts engine (roadmap §17.3).](docs/changelog/undated.md#entry-040)
- [Muelle POS brand layer (roadmap §17.4).](docs/changelog/undated.md#entry-041)
- [Golden flow promoted script → job (roadmap P2).](docs/changelog/undated.md#entry-042)
- [POS drafts recover their register after a browser/runtime reset.](docs/changelog/undated.md#entry-043)
- [Capability resolution now fails closed without breaking legacy tills.](docs/changelog/undated.md#entry-044)
- [Restaurant Wave 0 is interaction-safe and browser-certified.](docs/changelog/undated.md#entry-045)
- [World-class POS roadmap v2.](docs/changelog/undated.md#entry-046)
- [Restore `/posapp` offline reloads during backend restarts.](docs/changelog/undated.md#entry-047)
- [Durable restaurant print fan-out.](docs/changelog/undated.md#entry-048)
- [Print health, guided install, and a first-terminal setup wizard — printing works out of the box.](docs/changelog/undated.md#entry-049)
- [Print-pipeline hardening (full-backtrace blocker wave).](docs/changelog/undated.md#entry-050)
- [`posa_force_close_stale_shift` survives tenants that never got the patch.](docs/changelog/undated.md#entry-051)
- [Deferred print no longer abandons the ticket at ~9s.](docs/changelog/undated.md#entry-052)
- [Submit gets a 120s client timeout instead of the 30s api.ts default.](docs/changelog/undated.md#entry-053)
- [`/posapp` SPA is now the default boot path (opt-in → opt-out)](docs/changelog/undated.md#entry-054)
- [2026-07-11 (LAB — pending prod) — hold-until-confirm, upstream recon, audit sweep, profile security, roadmap + perf waves](docs/changelog/2026-07.md#entry-056)
- [2026-07-03 (LAB) — invisible selected item in dropdown menus (black-on-black)](docs/changelog/2026-07.md#entry-057)
- [2026-07-02 (lab) — audit-fix + upstream-pick batch, CI unbroken, test runner unbroken](docs/changelog/2026-07.md#entry-059)
- [2026-06-14 (lab only) — telemetry hygiene: web-vital outlier cap + usage-endpoint caching](docs/changelog/2026-06.md#entry-060)
- [2026-06-12 (lab only) — fix: first payment of session opened with blank default amount](docs/changelog/2026-06.md#entry-061)
- [Unreleased — 2026-05-31 / 2026-06-01 (DEPLOYED to prod)](docs/changelog/2026-05.md#entry-064)
- [Unreleased — 2026-05-25 / 2026-05-26](docs/changelog/2026-05.md#entry-065)

## Archives

Full entries retain verification, migration, rollback, and commit details. Dates follow the original entry headings; undated entries are kept separately.

- [2026-09](docs/changelog/2026-09.md) — 7 entries.
- [2026-08](docs/changelog/2026-08.md) — 18 entries.
- [2026-07](docs/changelog/2026-07.md) — 5 entries.
- [2026-06](docs/changelog/2026-06.md) — 4 entries.
- [2026-05](docs/changelog/2026-05.md) — 3 entries.
- [2026-04](docs/changelog/2026-04.md) — 4 entries.
- [2026-03](docs/changelog/2026-03.md) — 10 entries.
- [2026-02](docs/changelog/2026-02.md) — 6 entries.
- [2026-01](docs/changelog/2026-01.md) — 4 entries.
- [2025-12](docs/changelog/2025-12.md) — 6 entries.
- [2025-11](docs/changelog/2025-11.md) — 3 entries.
- [2025-10](docs/changelog/2025-10.md) — 1 entry.
- [2025-09](docs/changelog/2025-09.md) — 3 entries.
- [2025-08](docs/changelog/2025-08.md) — 13 entries.
- [Undated Unreleased entries](docs/changelog/undated.md) — 24 entries.
