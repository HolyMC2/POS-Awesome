# POSAwesome Changelog


Recent changes and recorded rollout notes. Full older records are linked below; archiving does not mark an entry deployed or complete. Verify status against the deployed revision when it matters.

For new entries, describe the changed behavior and include the commit, affected scope, and migration/rollback requirements when relevant. Link lengthy verification evidence. Read only the entries relevant to the task.

## Unreleased

- **Scans read fresh stock and prices (2026-09-25, doco-mirror).**
  `get_items` no longer serves or stores a cached page for a `search_value`
  lookup. Typed register searches already asked with the cache off; barcode
  scans sent the saved profile, so on Doco Ventas a scanned item's stock and
  price could be up to 30 minutes old. Uncached scans measured ~50 ms.
  Catalogue pages stay cached and pre-warmed. No migration; rollback restores
  source. See docs/PERF-get-items.md (2026-09-25) for the search-limit numbers.

- **Item search ranks by relevance (2026-09-24, doco-mirror).**
  «ip 13» at the Doco Ventas register listed iPhone 11/XS screens first and
  missed «Pantalla iPhone 13»: limit-search anchored on the first word as a
  name prefix, «13» matched digits inside codes and barcodes, and results were
  sorted by name. Typed searches (3+ characters) now rank on the server
  (`item_processing/relevance.py`, same algorithm as doco's shared ranker) and
  in the SPA (`utils/relevance.ts`: displayed list, local and IndexedDB
  search): every word must start a word of the name, group, brand or
  description, codes/barcodes/serials match by prefix or a 4+ digit fragment,
  and the exact model comes first. Scanned barcodes still resolve directly.
  `GET_ITEMS_CACHE_VERSION` v3 drops cached search pages. No migration;
  rollback restores source/assets.

- **Provider-financed credit sales (2026-09-24, doco-mirror).** On a register
  with mercado's «Ventas a crédito con proveedor», Cobro offers «Vender a
  crédito»: provider, the items on credit, and the approval's total credit
  price and down payment (0 allowed), plan optional. The register prices the
  covered lines itself — at the credit price when the provider's Mode of
  Payment is on the register (its share is recorded there), else at the down
  payment — pins them, refreshes the payment screen and restores their own
  prices if the credit is removed; «Hoy cobras» shows the down payment plus any
  other item. The rate band and discount cap skip those lines through the new
  `posa_price_guard_exemptions` hook, which mercado answers only for a declared
  credit sale's covered lines; the payments-vs-total check still applies. The
  sale then opens
  its paperwork: provider documents (camera/file), till expenses linked to the
  invoice (POS Cash Movement `sales_invoice`), plan and notes. A «Ventas a
  crédito» queue and a ledger action reopen it; shop managers lock complete
  paperwork. Tickets print the provider's «Ticket de enganche» without the
  credit price; margins never reach the register. Each step says what it is
  for: the sheet's sections, the recorded-only plan, what «Aplicar crédito»
  does, who pays the financed part and when, and «Quitar crédito y restaurar
  precios». Online only. Requires mercado
  `feat/pos-credit-sales-20260924` and guarded migrations of both apps.
  Commits `010e9edda`, `584e98f8c`, `bb6d3fd23`. Rollback restores prior
  assets/translations; the new fields are additive. Evidence:
  `~/muelle-releases/pos-credit-sales-20260924/`.

- **Cash bags explain every control (2026-09-24).**
  Cash custody describes each starting task, each bag or count action (prints
  included) and the active queue filter, and keeps a legend of what every bag
  and count state means. Safe targets say what the float and drawer limit are
  for; bag purpose names say where the bag goes, also at closing, where each
  seal field keeps its hint. POS, Desk (form, list queues with tooltips) and
  printed slips now share one set of state names («Verificada en caja fuerte»,
  «Retenida para revisión del supervisor», «Entregada a una caja»,
  «En tránsito al banco»). POS Cash Bag fields carry descriptions; guarded
  migration syncs that metadata. No custody state, balance or permission changes.

- **Saved print preferences apply at the register (2026-09-24, not deployed).**
  The POS asked doco's GET-only `get_my_preference` with POST; every request
  was refused (403) and printing silently used the profile defaults. It now
  reads with GET. Frontend only; no migration. Rollback restores the prior
  assets.

- **Cash bag identification and closing labels (2026-09-23, doco-mirror).**
  Desk lists show the physical folio, amount, state, preparation date and people,
  with focused queues and single/batch printing. Successful POS closings offer
  labels for only that closing's saved bags, or their details to copy by hand.
  Reprinting is read-only and enforces read/print permission on every bag.
  Formats: 80 mm receipt, 100 × 76 mm label and full handover sheet. Guarded
  migration updates list metadata; no cash balances or custody states change.
  Rollback restores source/assets and resynchronizes POS Cash Bag metadata.
  Evidence: `~/muelle-releases/cash-bag-workspace-20260923/`.

- **Cajas y turnos workspace (2026-09-22, doco-mirror candidate).**
  Adds attention/open/history queues, scoped shift details, cash activity and
  contextual routes to selling, counting, movements and browser recovery.
  Available before opening a shift; mobile uses a focused detail step with one
  scroll surface. Reads cannot submit printed drafts or move money; blind-count
  amounts are withheld by the server. Uses existing profile/shift identities;
  physical register and shared-safe foundations remain specified. No migration.
  Rollback restores prior assets/translations and removes the new read-only API.
  Release evidence: `~/muelle-releases/pos-cajas-workspace-20260922/`.

- **Category navigation and settings cleanup (2026-09-22, doco-mirror).**
  Category boxes start automatically on touchscreens; each device can choose
  categories or products everywhere. Both catalogue layouts use the complete
  category list. Search/scanning go directly to products. Catalogue settings
  have a visible mobile entry, consistent Save/Cancel and grouped controls;
  shared caching policy stays in POS Profile. The obsolete web-route preference
  is removed; `/posapp` is always canonical. Guarded migration removes only
  Custom Field metadata and preserves the old profile column. Rollback restores
  prior source/assets and the saved Custom Field metadata. Evidence:
  `~/muelle-releases/pos-category-navigation-20260922/`.


- **Cash custody workspace and contextual dock (2026-09-22, doco-mirror candidate).**
  Includes the existing cash-custody foundation: sealed bags, denomination counts,
  independent verification, safe/drawer movements, bank handoffs and recoverable
  closing allocation. Employees start from their pending queue, open a focused
  count/transfer with explicit source and destination, and return without losing
  filters. Unsent forms and unconfirmed requests retain their existing recovery.
  Compact workspaces replace sale controls with their own action and a return to
  sale. Coupon/offer/catalogue shortcuts dismiss the covering workspace immediately.
  Subtle arrival and press feedback respects reduced motion. Closing has one
  canonical surface; blind-count profiles reset their reconciliation headers.
  Source: `fix/pos-responsive-20260922`. Lab already has the custody schema and
  backend; this rollout publishes assets and additive Spanish translations only.
  Fresh sites require guarded migration for the four custody DocTypes and closing
  evidence link. Restore prior assets/translations for the lab UI rollback;
  preserve financial records and custody backend/schema. Evidence:
  `~/muelle-releases/pos-cash-workspace-20260922/`.

- **Mesas finding and account actions (2026-09-22, lab release candidate).**
  Search finds tables and account names across floors and shows each result's
  location. Cards name the parties, identify split accounts and mark the selected
  table. Split accounts offer their own Add items and Charge actions, hydrating
  the exact chosen order before handing off to payment. Queued payments explain
  the connection wait and withhold repeat actions. Compact landscape spacing
  preserves room for tables. Frontend and one Spanish translation only; no
  migration. Restore prior assets and translations together to roll back.

- **Mesas workflow polish (2026-09-22, lab release candidate).** Compact floors
  start with readable searchable tables and occupied/free/cleaning filters.
  Floor switching and named accounts fit without sideways scrolling; list/map
  controls are visible. Short screens scroll the floor and ticket together.
  Table dialogs have a reachable close action and clearer split-account context.
  New named accounts accept names and continue to the catalogue. Desktop table
  details expose New account; active tickets show their table and account with
  wrapping actions. No schema changes; restore prior assets and Spanish
  translations together to roll back.


- **2026-09-15 · lab verified · Cash custody UI/UX crew pass (uncommitted candidate).** Three Opus workers improved cashier queues, denomination counts/closing allocation, supervisor Desk actions and print evidence; primary integration fixed recovery, in-flight save and invalid-input issues. Spanish copy, 48px count targets, separate one-label bag tags and full handover sheets. Full frontend suite 5,579 passing, final print/Desk checks, responsive browser journeys and real lost-response/close/bank journeys with reconciled ledgers. [Review and evidence](docs/POS-CASH-CUSTODY-UX-REVIEW.md). No additional schema migration; production rollout pending. UI rollback preserves the custody records and journals described in the core custody entry below.

- **2026-09-15 · lab verified · Cash custody (uncommitted candidate).** Opt-in safe/register workflow with sealed float/takings bags, denomination evidence, drawer handover, independent discrepancy review, bank transit and receipt, and Desk/print actions. Financial commands retain retry IDs and serialize safe reservations; legacy registers remain unchanged. Requires guarded DocType migration and explicit safe/account configuration. Evidence and setup: [Cash custody](docs/POS-CASH-CUSTODY.md). Production rollout pending; preserve custody records/journals during rollback and use compensating corrections after any real activity.

- **2026-09-15 · local development · Taller → POS handoff.** `/posapp?taller_order=…`
  opens Pending Charges for that exact Repair Order after the register/shift is ready.
  A persistent return link restores Taller's billing tab; unsupported registers explain
  the restriction. Queue reads retain company/profile permissions and filter before
  pagination; opening the link never claims or pays a request, and loading refuses to
  overwrite an occupied cart. Files: `NavbarMenu.vue`, `ChargeRequestsDialog.vue`,
  `utils/tallerHandoff.ts`, `api/charge_requests.py`, and focused frontend/scope tests.
  No schema migration; not deployed. Rollback: revert these source changes and rebuild.

Original status labels are retained; this section also contains changes reported as deployed.

- **Mobile reading and return flow (2026-09-22, lab release candidate).** Catalogue
  cards show complete product names at a readable size, with prices aligned.
  The navigation drawer has a 44px close button. Invoice search uses phone-sized
  inputs; ticket details keep their identifier and close action visible, contain
  focus, and return to the same list row without losing the filter or scroll.
  Enter and arrow keys continue from that returned row.
  Short screens scroll the entire ticket sheet. Frontend only; no migration.
  Rollback: restore the previous POS asset manifest and matching bundles.

- **Responsive POS scrolling (2026-09-22, lab release candidate).** Long forms,
  cart, reports and compact closing use one vertical scroll area; Recargas keeps
  its action reachable above the dock, including reduced keyboard viewports.
  Invoice, Cobranza and recharge tables adapt into readable records on phones
  without sideways scrolling. Filters wrap within the screen. Payment actions wrap, and Help remains in the actions
  menu without covering register controls. Source: `fix/pos-responsive-20260922`.
  Frontend only; no migration. Roll back by restoring the prior POS asset manifest
  and bundles together. Browser regression coverage includes 320–1920 px widths,
  short landscape, keyboard viewport changes, long lists and no sideways scroll.

- **The server-side bundle batch hint is removed from the submit path
  (2026-09-12, lab verification, not committed).** Supersedes the repair in the
  entry below, per the wave-3 decision record: `api/utilities.py` loses both
  `set_batch_nos_for_bundels` and `pick_batch_for_packed_item`, and
  `invoice_processing/creation.py` no longer calls either on submit. On ERPNext
  16 a packed (Product Bundle) row's batches are allocated by ERPNext itself
  through a Serial and Batch Bundle: submit clears `packed_items.batch_no`, the
  allocation is identical with the pick disabled, and one row can split across
  batches, which that single field cannot express. So the hint wrote a value
  nothing read, and its `throw` branch could only refuse sales ERPNext completes
  correctly. ~97 lines leave a money path. The bench proof moved with it:
  `api/test_bundle_batch_native.py` now asserts that the draft carries no hint
  and that the sale still submits, allocates from the right batch, moves the
  component out of the profile warehouse, skips an expired batch and splits a
  line larger than any single batch. The standalone stub suite for the deleted
  functions is replaced by `api/test_utilities_global_resolution.py`, which keeps
  the guard that matters — every `LOAD_GLOBAL` in `utilities.py` must resolve
  after import, the bug class the CI ruff selection (`E9,F63,F7`, no F821) cannot
  see — and pins the two retired names as retired. No migration, no fixtures; no
  behaviour change for an invoice without packed rows.

- **Bundle batch crash on submit, dark MP Point audit line, offline-queue
  failures reported (2026-09-12, lab verification, not committed).** Wave 2 of
  the `boat/docs/LOGGING_MAP.md` audit: the section 7 `set_batch_nos_for_bundels`
  and `mp_point` findings, plus gap G10.
  - `api/utilities.py::set_batch_nos_for_bundels` referenced `get_batch_no`,
    `get_batch_qty`, `flt` and `_` without importing any of them, and
    `invoice_processing/creation.py` calls it with `throw=True` on every POS
    submit. Only an invoice with packed (Product Bundle) rows whose component
    Item is batch-tracked reaches the loop body, so that sale failed with a
    NameError and nothing else did. `git log -S` places the loss in `742e831dc`
    (Api refactor #469, 2025-06-26), which copied the function out of
    `api/posapp.py` and left its
    `from erpnext.stock.doctype.batch.batch import get_batch_no, get_batch_qty`
    behind; `5dc4a4819` then deleted `posapp.py` and the only working copy with
    it. `get_batch_no` cannot simply be imported back: ERPNext's Serial and
    Batch Bundle rewrite changed it to `get_batch_no(bundle_id)` returning a
    {batch: qty} map (installed erpnext 16.32.0), so the old positional call
    would be a TypeError. The auto-pick now uses
    `get_batch_qty(item_code=..., warehouse=...)`, the same v15+ pick the return
    path already uses in `invoice_processing/stock.py`. It is also deliberately
    non-blocking: measured on the lab, ERPNext allocates the component itself on
    submit through a Serial and Batch Bundle, clears `packed_items.batch_no` and
    ignores what this function wrote — with the pick disabled the allocation was
    identical, and the bundle can split one line across batches, which a single
    `batch_no` cannot express. A row no single batch can cover therefore logs a
    breadcrumb and leaves the allocation to ERPNext instead of refusing a sale
    ERPNext completes. Also fixes `get_language_info`, which called a
    `_validate_language_code` that was never written: the endpoint raised
    NameError on its first statement, answered "Failed to get language info" for
    every request and wrote one Error Log row per call. The validator also bounds
    a value that is interpolated into a translations path.
  - `api/mp_audit.py::log_mp_override` reported every supervisor override of the
    MercadoPago Point sale gate through `frappe.logger("mp_point")`, its own
    logger name at ERROR, so no override was ever logged and the invoice Comment
    was the only trace. It now goes through `_posa_warn`, which resolves the
    shared `posawesome` logger per call and raises that site's level to INFO
    once. Verified on the lab: level 40 as handed out, the file grew 1118 → 1519
    bytes, and the JSON line landed with scope `mp_override`, the user, the
    invoice and the request id.
  - The offline queue's failure branches now also report through
    `posapp/utils/errorReporting.ts` as kind `offline_error` (gap G10): a sale
    that could not be serialised into the queue, a replay the server refused, a
    capability-version mismatch drafted for review, an entry dead-lettered
    because its draft fallback failed too (one of those branches had no console
    line at all), IndexedDB init / reopen / upgrade-blocked / newer-version /
    corruption, and a persist whose worker write and main-thread fallback both
    failed. Informational `console.log` is untouched by design. The payload is a
    scope, an error name and message, and a closed set of scalars (queue length,
    client request id, queue row id, entity type, key, reason) — no customer
    data; the scope travels as `filename`, which is part of the server-side
    dedupe signature, so one recurring failure is one row with a count. Volume
    is bounded by the wave-1 guard, not by the client.
  - Backend suite 956 tests over 95 files, 0 failures, 32 skips (baseline 929
    over 92). Frontend 5,484 tests over 482 files, `vue-tsc --noEmit` and eslint
    clean, `vite build` green. Lab drill on the Doco mirror: the bundle+batch
    sale submits and its Serial and Batch Bundle names the picked batch; the
    override line is on disk; the endpoint accepted `offline_error` over real
    HTTP and wrote one row, with the second identical signature deduped. Rows,
    guard keys and fixtures removed afterwards. Deploy is a source pull plus a
    worker restart for the Python half; the offline reporting is SPA code and
    needs the built `dist` pushed, so registers will not report until their
    service worker serves the new chunks.

- **POS client-error funnel guard and named swallowers (2026-09-12, lab
  verification, not committed).** Closes gaps G8 and the posawesome half of G9
  in `boat/docs/LOGGING_MAP.md`. `api/utilities.py::log_client_error` now bounds
  the browser-error funnel server side: a signature dedupe (kind plus the
  message with ids, row numbers and bundle hashes normalised away, file, line)
  writes one Error Log row per signature per site per 10 minutes and counts
  repeats in `frappe.cache()`, rolling `[xN]` into the row it already wrote at
  most once every 30 seconds; an insert budget of 20 per site per minute; and a
  storm latch that drops further inserts for an hour behind exactly one row
  reading `client error storm: dropped N in the last hour`. The body is capped
  at 64 KB before `json.loads`, the stored row is capped again, the guard's own
  failure is latched to one row per site per hour instead of the old
  unconditional second `frappe.log_error`, and nothing raises back to the
  browser. Tunables sit in one block above the endpoint, mirroring
  `boat/boat/muelle/incidents.py`. The payload now carries the site and
  `frappe.local.request_id` when present. The eleven `except: pass` swallowers
  in `api/utilities.py` (8) and `api/invoice_processing/creation.py` (3) now log
  a JSON breadcrumb on the rotating `posawesome` logs with scope, site,
  document and exception class; the two money-path handlers that mark a
  submission ledger FAILED and annotate a stuck draft keep their control flow
  byte-identical, pinned by tests. Those breadcrumbs go through a
  `_posa_site_logger()` helper in both files, modelled on saldo's
  `_site_logger()`: Frappe caches one logger and its file handlers per
  `<module>-<site>` pair, and off a dev server it hands them out at ERROR
  (`DEV_SERVER` unset and no `log_level` on the lab and on cell-0), so a plain
  `frappe.logger("posawesome").warning(...)` resolved once at import writes zero
  bytes and can also pin one tenant's lines to another tenant's file. The helper
  resolves per call and raises that site's logger to INFO once. Measured on the
  lab: level 40 as handed out, 0 bytes written, then level 20 and the line lands
  in both `logs/posawesome.log` and `sites/<site>/logs/posawesome.log`. The
  estate-wide alternative (`log_level` in common_site_config.json) is a decision
  for Marco and was not set. Lab drill on the Doco mirror: 773 calls wrote
  6 rows (200 identical errors became 1 row titled `[x201]`, 40 id-bearing
  variants of one bug became 1 row), and 531 distinct signatures wrote 21 (20
  budgeted plus one storm row titled `POS Client Error Storm [dropped x511]`).
  Backend suite 929 tests over 92 files, 0 failures, 31 skips (baseline 893 over
  91). Pure Python, no migration, no SPA build: deploy is a source pull plus a
  worker restart.

- **Registration promos: gift offers, coupons and consent (2026-09-10, lab
  verification).** Branch `feat/registration-promos-20260910`, not pushed.
  POS Coupon `one_use` limits reuse of that coupon (its applied rows) instead of
  any coupon the customer used (`d2d9151db`). A Give Product offer with
  `apply_type` Item Group accepts a gift from `apply_item_group` or a
  descendant, below `less_then`, within `given_qty`, with the offer's purchase,
  coupon and validity checks; anything else is still rejected (`83a498858`).
  Coupons and offers added in the register reach the sale again: since
  `5006a5b54` a typed coupon or a customer's gift cards never surfaced a
  coupon-based offer (`4a9cfbdb4`). Submitting a sale redeems the coupon rows
  whose offer it carries, so gift cards are counted as used (`5283d3296`).
  Customer quick-create shows a consent checkbox when another app adds
  `Customer.marketing_opt_in`, requires mobile and email when ticked, and writes
  the flag (and `marketing_opt_in_source` = Mostrador when that field exists)
  online and on offline replay (`98c70ab6b`, `d38ac9f19`). The dialog keeps a
  short label and shows the field's description as the consent text, or a
  generic line when it is empty; the opening payload carries it, so the offline
  dialog shows the same wording (`a6a1d54d4`). Review fixes: a POS return or
  Desk credit note never counts or releases a coupon use and clears the copied
  applied flags (`d6f17fffd`); coupon uses count with one guarded UPDATE, so a
  disabled offer no longer fails a paid sale, and an exhausted coupon is refused
  with its reason, offline replays included, since the server has no reliable
  offline marker (`54b97dc2a`); consent is offered only while the field is
  visible, and Mostrador is set only when the Select offers it (`43db8f022`);
  the dialog sends consent only when the cashier changed it (`efbd4ec71`).
  Lab: credit note ACC-SINV-2026-03231 of an exhausted gift-card sale,
  disabled-offer sale ACC-SINV-2026-03232 counted and then cancelled back to
  zero. The register cannot pay a POS return: its band stays disabled on a
  negative total. Verified on the Doco
  lab mirror: item-group gift sales ACC-SINV-2026-03228 (before the redemption
  fix), 03229 and 03230 (second gift card redeemed after the first), and the
  checkbox with a temporary custom field. Python and SPA change, no migration:
  deploy needs the SPA build and a worker restart. A Give Product offer must set
  a discount (for example Discount Percentage 100) for the register to price the
  gift at zero; the Desk form requires it, scripts must set it.

- **Clinic charge identity (2026-09-10, private canary verified).** Preserve an
  explicitly selected Patient after validating its billing Customer; a shared
  family payer no longer selects an arbitrary patient. Trusted charge sources
  prepare and validate their own native references without widening client
  invoice fields. Verified scoped tests, native partial collection/credit/amendment
  and competing cashiers with the coordinated Clínica/Doco package. Python-only
  POS change, no POS schema or frontend build; deploy/rollback the compatible
  source contract together. Exact commits and proof are in the clinic release
  manifest and [billing validation](../clinica/clinica/billing/VALIDATION.md).

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
