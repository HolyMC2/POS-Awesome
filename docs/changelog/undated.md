# posawesome changelog — Undated Unreleased entries

[Current changelog](../../CHANGELOG.md)

Historical records, preserved with their original status labels. These notes do not establish current deployment state or authorize operations. Paths in backticks are relative to the repository root.

Some entries were originally recorded under **Unreleased**, even when their text described a deployment. Archiving does not mark them released or complete.

<a id="entry-031"></a>

- **«En trabajo» is a figure, not a disabled pill** (queue chips row, per the
  updated `Orden.dc.html`): right-aligned wrench + count, tooltip carries the
  provenance sentence. A pill that never presses read as a broken button.

<a id="entry-032"></a>

- **The ticket panel names its day, its customer and its origin** (per the
  updated «Facturas de la caja» artboard): date in the identity line,
  «Cliente» (phone + probe-gated CRM line with a link), «Origen» (the Taller
  order off the remarks marker, which `prepare_charge_request_invoice` now
  extends with the request's `source_label` — marker prefix unchanged, both
  dedup queries still match).

<a id="entry-033"></a>

- **The navbar chip ladder measures its own box** (container queries; the
  viewport ladder let the grown actions cluster push chips under the
  connection button at 1920), and the cashier chip states the first name
  with the full name on its tooltip.

<a id="entry-034"></a>

- **The Cobro pad answers the physical keyboard** — digits/decimal/Backspace
  feed the same buffer as the on-screen keys, Enter applies; keystrokes in
  real fields are never intercepted.

<a id="entry-035"></a>

- **A touch register keeps its keyboard down and its bar inside the glass**
  — mount-time autofocus (Venta search, Cobranza, Orden) is desk-only via a
  shared `coarsePointer()` rule; the cart's column header is static (was
  sticky); the navbar container ladder + first-name chip verified at 1340.

<a id="entry-036"></a>

- **Cart rows show the item's artwork** — 32px reserved slot, the catalogue
  card's thumb→image→neutral-box degradation chain, `v-memo`-safe.

<a id="entry-037"></a>

- **Quick item creation is a real intake form (roadmap §17.2).** The
  six-field dialog now takes purchase price, selling price, **margin**,
  opening quantity, description and IVA in one pass — the "alta rápida"
  a ferretería or tienda china does all day, instead of a trip to Desk.
  Margin is bidirectional (type a markup, get the price; type a price, get
  the markup) and explicitly labelled markup-over-cost, with the profit in
  currency beside it. The arithmetic is a separately unit-tested pure module
  because a rounding slip here becomes a mispriced shelf. Opening stock
  posts to the register's own warehouse and refuses, with a sentence, the
  two cases ERPNext would throw on from deep inside its Item controller
  (no purchase price, no warehouse). The item code auto-derives from the
  name until the operator edits it.

<a id="entry-038"></a>

- **Discount is a button, not a small field (roadmap §17.2).** A clear
  Discount button opens a dialog with percent/amount modes, four presets and
  **the resulting total shown before committing** — money leaving the till
  should be read back first. It owns no pricing logic: it hands the shell the
  operator's intent through the same emits the inline field uses, so the two
  surfaces can never disagree. Guards refuse negative, over-100% and
  larger-than-the-sale discounts; a full 100% comp stays allowed because it
  is a real decision. Permission-gated and offer-lock aware, like the field.

<a id="entry-039"></a>

- **Price checker — checador de precios (roadmap §17.2).** Alt+C opens a
  read-only lookup: scan or type, see name, price, UOM and stock, with the
  answering price list named in the footer. It never touches the sale — its
  own search field, lookup endpoints only, no cart path at all (source-
  scanned by test, because the guarantee is that no such path exists), so a
  cashier can answer "how much is this?" mid-ticket instead of scanning an
  item in and removing it. A text miss on a ≥6-character token retries as a
  barcode; a slow earlier query can never overwrite a newer answer; opening
  clears the previous lookup. Zero new server surface — reuses `get_items`
  and `get_items_from_barcode`. First consumer of the shortcuts engine.

<a id="entry-040"></a>

- **Shortcuts engine (roadmap §17.3).** Keys and behaviors are now separate
  things: `posapp/shortcuts/` holds 28 stable action ids, versioned keymap
  packs (`muelle-default` v1 = exactly the bindings already shipped), and a
  resolver with conflict detection, an override layer and cheat-sheet
  projection. `invoiceShortcuts.ts` keeps every effect verbatim and no
  longer knows a single chord — its if-chain became a dispatch table. New
  Alt+H cheat sheet (bus-driven, names the keymap revision) makes the
  bindings discoverable and reportable. A 28-chord parity table pins that
  nothing moved under a cashier's fingers; two inherited quirks (Alt+Shift
  fires Alt bindings, F-keys ignore modifiers) are preserved on purpose and
  now documented by tests instead of hiding in control flow. This is the
  substrate incumbent-emulating packs ride on — and those stay blocked on
  evidence from a real migration, never authored from memory.
  Server half (needs `bench migrate`): POS Capability Profile carries
  `keymap_id` validated against `VALID_KEYMAPS`; the resolved capability
  payload gains a `shortcuts` group; a register may replace the mode's pack
  through the typed override allowlist (`shortcuts.keymap_id` → POS Profile
  `posa_ux_keymap_id`, new `replace` merge rule). Blank and whitespace-only
  register values mean "not set" and cannot strip the mode's pack. The SPA
  reconfigures synchronously when the payload lands.

<a id="entry-041"></a>

- **Muelle POS brand layer (roadmap §17.4).** The user-facing brand now
  lives in ONE module (`frontend/src/brand.ts`): navbar wordmark
  ("Muelle POS"), window/PWA titles, failure dialogs, loading and offline
  copy, `www/manifest.json` name/short_name and a `/pos` → `/posapp`
  redirect alias. The app remains `posawesome` internally — storage keys,
  telemetry names, DOM test ids, PWA `id`/`start_url` and API paths are
  untouched (upstream-merge hygiene), and `tests/brandConsistency.spec.ts`
  pins the frontend module and the www shell together while proving the
  brand never leaks into internal identity. Verified live on lab: branded
  title/manifest/loading, `/pos` 301, golden flow green on the branded
  bundle.

<a id="entry-042"></a>

- **Golden flow promoted script → job (roadmap P2).** New
  `scripts/certification/golden_flow_job.py` runs the Scan Retail golden-flow
  spec unattended as a dedicated cashier, writes a run record under
  `docs/certification/golden-flow-runs/` and ledgers the outcome on the boat
  controller; a lab systemd timer keeps the evidence fresh. The spec itself
  was hardened for cashier reality: single-option Company/Profile arrive
  pre-selected (skip, don't stall), the nav drawer's company label shadows
  the dropdown option (scope to overlay list items), and a resumed-shift Pay
  click can outrun the payment panel (one measured re-click). A skipped
  Playwright run counts as FAILURE — an unattended job that ran nothing must
  never ledger success. Pure logic in `golden_flow_lib.py` with standalone
  tests.

<a id="entry-043"></a>

- **POS drafts recover their register after a browser/runtime reset.** A named
  POS draft whose transient request lost both `pos_profile` and opening-shift
  fields now follows its own persisted opening shift back to the profile before
  the normal membership/company/customer scope checks run. This fixes Pay being
  blocked with "POS Profile is required for this action" after state loss while
  ordinary Desk drafts without a persisted POS shift remain refused.

<a id="entry-044"></a>

- **Capability resolution now fails closed without breaking legacy tills.** An
  unlinked POS Profile remains an explicit `unconfigured` compatibility state,
  but a dangling/invalid linked profile receives no optional capabilities, no
  Pay dock action, and is rejected again by `submit_invoice`. Successfully
  resolved contracts are cached for seven days; a transient resolver failure
  may use only that stamped last-known-good contract and reports
  `temporarily_unavailable`. Payload schema is now v3. This removes the prior
  path where any backend resolution exception silently enabled the full
  retail-phone capability set.

<a id="entry-045"></a>

- **Restaurant Wave 0 is interaction-safe and browser-certified.** Dirty free
  tables now offer only “Mark clean”; an empty open account cannot be charged;
  and a table with multiple accounts presents an explicit account chooser
  instead of a misleading combined action. Choosing an account resumes that
  exact order. The complete restaurant shell/action/exception contract is
  mapped in `docs/RESTAURANT_UX_MAP.md`. Component coverage includes the five
  FloorView routes and six table-sheet states, while live Playwright acceptance
  covers the deployed lab register at desktop and 390×844 phone viewports.

<a id="entry-046"></a>

- **World-class POS roadmap v2.** Added the independently audited ideal-future
  roadmap and its audit record. Delivery is dependency-ordered around bounded
  effective configuration, artifact ownership, thin seeds, measurable
  performance, and complete Scan Retail plus Repair Retail slices before
  promoting restaurant from contracted beta.

<a id="entry-047"></a>

- **Restore `/posapp` offline reloads during backend restarts.** The web-route
  entry deleted the active POS service worker and every `posawesome-cache-*`
  cache on each boot, even though the mounted SPA immediately registered that
  same worker again. A refresh during an outage therefore erased the cached
  shell before it could be used. The web entry now preserves the worker/cache;
  `/files/*` uploads bypass the worker instead, retaining the original broken
  item-image fix without sacrificing offline boot. Covered by the service
  worker navigation/cache suite and a mutable-file interception regression.

<a id="entry-048"></a>

- **Durable restaurant print fan-out.** `fire_course` now freezes its delta,
  advances `last_fired`, and inserts one idempotent Doco print job per kitchen
  station in the same transaction. A replay with the same request ID returns
  the original batch/projection instead of an empty ticket, closing the lost-
  response gap. Kitchen stations can target an administrator-managed terminal
  group and carry their own Print Format and paper width. The jobs remain inert
  until the shared terminal listener is enabled.

<a id="entry-049"></a>

- **Print health, guided install, and a first-terminal setup wizard — printing
  works out of the box.** Six terminal-side checks (installer bundle published,
  QZ connection, tray version vs the site's bundle, live cert+sign round-trip,
  printer selection, operator-confirmed self-test) roll up into a navbar dot
  on silent-print registers; PrintHealthDialog shows the checklist with
  per-item fixes, downloads the tenant installer straight from the POS
  (win/linux, served by `download_qz_bundle`), and prints a test slip that
  only counts once the operator answers «¿Salió el ticket?» — a send proves
  the job left the websocket, not that paper came out, so the verdict is
  human. `pos:print_selftest` feeds `get_qz_fleet.last_selftest`.
  PrintSetupWizard auto-opens ONCE on a terminal that has never met it
  (detect → install → printer → confirmed test → done; skippable everywhere;
  `pos:print_setup_wizard` telemetry per step; a connected tray jumps straight
  to printer pick). Backtrace warning wave riding along: doctype-aware
  lifecycle-event rooms (POS Invoice tills joined the wrong doc room),
  «Submit & Print» on duplicate-recovery now prints, blocked popups on the
  offline/new-tab/PayView/reprint paths all surface + count,
  `warn:print_never_printed` makes the worst outcome countable, socketStore
  maps capped, dead deferred branches deleted.

<a id="entry-050"></a>

- **Print-pipeline hardening (full-backtrace blocker wave).**
  `pos_invoice_processed` now publishes `after_commit=True` — consumers fetch
  + print the doc the moment it arrives, and a mid-transaction publish made
  them read docstatus 0 (draft receipts pre-`b722e4f08`; spurious patient-wait
  toast + 10-18 s ticket delay on every healthy background sale after it).
  `qz.print` gets a 60 s ceiling (qz-tray.js has none: an unanswered trust
  dialog kept the promise pending forever, wedging the in-flight guards and
  taking the till's printing offline until reload). The reprint cache
  (`setLastInvoice`) is docstatus-gated — a background submit answers with
  docstatus 0 and the navbar reprint printed a DRAFT; the deferred workflow
  stamps it once confirmed. Invoice-list reprint fixed (`posProfile.value` in
  an Options-API method = ReferenceError → QZ silent print was unreachable
  from that surface, 100% fallback to the browser dialog). Patient wait polls
  immediately before its first sleep (~18 s → ~8 s typical slow path) and no
  longer discards a lifecycle event that lands mid-check.

<a id="entry-051"></a>

- **`posa_force_close_stale_shift` survives tenants that never got the patch.**
  The column was PATCH-only schema; `set_all_patches_as_completed` marks every
  patch as run at install time, so any site provisioned after 2026-07-02 (both
  prod demo cells, every future B16 tenant) was missing it — and
  `assert_shift_not_stale`'s raw `db.get_value` turned EVERY `submit_invoice`
  into a 500 (`1054 Unknown column`, hit live on demo.muelle.mx 2026-07-29).
  The Custom Field now ships in fixtures (created on install AND every
  migrate), and both readers go through `_profile_force_close_stale_shift`,
  which falls back to the schema default (ON) when the column is absent —
  fresh tenants keep the cash-reconciliation gate instead of crashing.

<a id="entry-052"></a>

- **Deferred print no longer abandons the ticket at ~9s.** With
  `posa_allow_submissions_in_background_job` ON, prod submit lag runs 45-230s
  when the shared RQ queue is congested (5 of 7 docomexico sales on
  2026-07-28/29) — the old flow threw after one 8s socket wait + one DB check,
  so the receipt silently never printed and the cashier resorted to «print
  last invoice». `runDeferredPrintWorkflow` now falls back to
  `waitForLateSubmission` (`usePatientSubmitWait.ts`): doc-room lifecycle
  event raced against a 10s DB docstatus poll under a 300s ceiling (the RQ
  job timeout), with an info toast telling the operator the ticket will print
  once the sale confirms. Server-reported submit failures and cancellations
  abort (within one poll interval). Audit hardening: the wait never prints on
  the socket's word alone — socketStore fabricates `{status:"processed"}`
  while disconnected, so every print is gated on a DB `docstatus == 1`
  confirm (no draft receipts); and a submit the server already reported
  FAILED skips the reassuring toast + patient wait and surfaces the real
  error. The FAST path is gated the same way: the doc fetched for printing
  must be docstatus 1, else the flow routes into the patient wait instead of
  printing a draft (socket-down whole-sale case — audit P1).
  Spec: `tests/patientSubmitWait.spec.ts` (7 tests).

<a id="entry-053"></a>

- **Submit gets a 120s client timeout instead of the 30s api.ts default.** The
  server is allowed 120s (gunicorn `--timeout=120`), and the shim's fetch has no
  AbortController — so a 30s client timeout told the cashier "failed" while the
  request kept running and the sale submitted anyway. On 2026-07-24 the recargas
  that took 60-300s (hold-until-confirm behind a starved RQ queue — see the
  saldo CHANGELOG) surfaced as false failures, and a re-press stacked a second
  server-side execution (harmless: idempotent on `posa_client_request_id`, but
  it doubled the load causing the stall). Matched to the server ceiling so the
  client gives up only once the server truly has.

<a id="entry-054"></a>

- **`/posapp` SPA is now the default boot path (opt-in → opt-out)**. The
  `posa_use_web_route` POS Profile flag shipped with `default 0` while
  `page/posapp/posapp.js` bounces every bare `/app/posapp` hit back to
  `/posapp` — so any user whose profiles all sat at 0 (every profile created
  after the flag landed, plus users with no POS Profile row at all) ping-ponged
  between the two routes forever. `posa_user_opted_into_web_route`
  (`api/utilities.py`) now returns True for no-profile users and on DB error
  (fail open), False only when EVERY matching enabled profile is explicitly 0;
  `www/posapp.py` redirects opt-outs to `/app/posapp?legacy=1` so the Desk
  fallback no longer bounces back. Fixture default flipped to `1`, label /
  description rewritten as a rollback switch, and patch
  `set_web_route_default_on` backfills existing profiles (prod state before the
  patch: `CONTROL` = 0 on `ventas.docomexico.com`, i.e. that cashier was
  looping; `Doco Ventas` + `Ventas Mumu Escuinapa` already 1). Regression suite
  `api/test_web_route_default.py` (9 tests) covers the decision table + guards
  the `?legacy=1` suffix.
