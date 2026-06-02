# posawesome — POSAwesome fork (Frappe v16)

> ⚠ **Multi-agent stomping safeguard**: before any edit/restart, read [muelle/AGENTS.md → Coordination](../muelle/AGENTS.md#coordination--multi-agent-freshness-read-before-any-write). Use `bash ../muelle/scripts/muelle-restart.sh <svc> --reason "..."` not raw `docker compose restart`. Memory entries: `feedback_agent_freshness_protocol`, `feedback_restart_coordination`.

Point-of-sale SPA for Frappe / ERPNext v16, branched from
[`HolyMC2/POS-Awesome`](https://github.com/HolyMC2/POS-Awesome) @
`doco-customizations`. Heavy fork — frontend rebuilt around
RecycleScroller + Pinia + shallowRef + Vuetify 3.12.6, backend hardened
with REVIEW2 scope assertions, observability + telemetry, QZ Tray print
pipeline, web-route SPA (`/posapp`) replacing the Desk-shell mount.

Read [`muelle-host/AGENTS.md`](../AGENTS.md) for the broader topology
first, then [`ARCHITECTURE.md`](ARCHITECTURE.md) for the deep dive on
SPA boot / Pinia stores / build pipeline.

## What this app owns

- POS sale flow (cart → pay → submit → print) for two prod tenants:
  `ventas.docomexico.com` (Doco Ventas + Doco Reparaciones + CONTROL)
  + `ventas.mumulenceria.com` (Ventas Mumu Escuinapa)
- `POS Profile` customizations (50+ posa_* fields — QZ printer pin,
  print formats, security flags, telemetry knobs)
- `POS Opening Shift` + `POS Closing Shift` + auto-print of Cierre
  de Caja ticket on close (2026-05-26)
- `POS Invoice Submission Ledger` — idempotent submit dedupe
- `POS Telemetry Event` — RUM web vitals + per-API timing + crash log
- QZ Tray signing oracle (`api/qz.py`) with role allowlist
  + length cap + envelope shape (kept loose after 2026-05-20
  prod break)
- `/posapp` web route (canonical, 2026-05-26) — SPA outside Desk
  shell; `/app/posapp` kept as legacy with `?legacy=1` bypass
- ESC/POS thermal print path: HTML → wkhtmltopdf raster → QZ
  WebSocket → signed envelope → printer
- Offline-tolerant cart via IndexedDB (Dexie) + sw.js
- Phase 1.E `posa_use_web_route` per-profile gate (legacy — every
  profile now opted in by default)

## Repo layout

```
posawesome/
  posawesome/                          ← Python (Frappe app)
    api/
      invoices.py                      ← thin re-export facade
      invoice_processing/
        creation.py                    ← submit_invoice (1900+ lines)
        returns.py / payment.py / data.py / utils.py
        stock.py                       ← _validate_stock_on_invoice
      _scope.py                        ← REVIEW2 scope assertions
      _reprice.py                      ← invariant validators (rate-band, paid==total)
      _perms.py                        ← account_perm_bypass ctx
      qz.py                            ← QZ Tray signing oracle
      telemetry.py                     ← RUM ingest + summary endpoints
      shifts.py                        ← check_opening_shift
      utilities.py                     ← get_server_usage + 30+ helpers
      items.py + items_search.py       ← catalog search
      customers.py
    doctype/
      pos_closing_shift/
        closing_processing/creation.py ← submit_closing_shift
      pos_invoice_submission_ledger/
      pos_telemetry_event/
      ...
    page/posapp/                       ← legacy Desk Page (redirects to /posapp)
      posapp.js                        ← controller — immediate-redirect
      posapp.json
    workspace/pos_awesome/             ← workspace JSON (Page link_type)
    patches/                           ← 30+ ordered patches in patches.txt
      add_closing_shift_print_format_field.py
      add_default_closing_shift_print_format.py
      add_qz_print_quality_fields.py
      add_qz_cut_after_print.py
      set_doco_qz_print_defaults.py
      add_pos_telemetry_event_index.py
      add_p0_perf_indexes.py
      ...
    fixtures/
      custom_field.json                ← all posa_* fields on POS Profile + Sales Invoice
      property_setter.json
      role.json                        ← POS Awesome Supervisor
    public/dist/                       ← built SPA (rsync target on prod deploy)
    www/                               ← web routes
      posapp.py + posapp.html          ← /posapp controller + shell
      sw.js                            ← service worker
      offline.html
    hooks.py
  frontend/                            ← Vue 3 SPA (Vite + Vuetify 3.12.6)
    src/
      web-entry.ts                     ← /posapp boot entry
      loader.ts                        ← /app/posapp boot loader
      posapp/
        utils/
          frappe-shim.ts               ← Desk-shim (csrf, datetime, realtime, client)
          telemetry.ts                 ← RUM client + buffer + flush
          perf.ts                      ← withPerf wrapper
        services/
          api.ts                       ← callEnvelope (timing moved to shim 2026-05-31)
          invoiceService.ts            ← thin Promise wrapper
          qzTray.ts                    ← printDocumentViaQz pipeline
        stores/ (Pinia)
          itemsStore.ts (shallowRef + markRaw)
          customersStore.ts
          invoiceStore.ts
          uiStore.ts
          pricingRulesStore.ts
          socketStore.ts               ← waitForInvoiceProcessed + doc-room subscribe
        composables/
          pos/payments/usePaymentSubmission.ts ← submit pipeline
          pos/payments/usePaymentPrinting.ts
          pos/shared/usePosShift.ts             ← opening/closing
          pos/items/useItemAddition.ts
        components/
          pos/Pos.vue                  ← cart + items selector
          pos/Payments.vue             ← pay dialog
          pos/shell/ClosingDialog.vue
          pos/shell/Pos.vue
          pos/invoice/CartItemRow.vue  ← RecycleScroller row
          navbar/NavbarMenu.vue
    tests/                             ← 569 vitest specs (149 files)
      smoke/posapp.web-route.spec.ts   ← Playwright smoke (web route)
      apiEnvelope.spec.ts
      apiTimingTelemetry.spec.ts       ← per-method timing
      shimErrorCallbackContract.spec.ts
      closingShiftPrintFormat.spec.ts
      buildManifest.spec.ts            ← preload chunk graph
      ...
    build-manifest.js                  ← rollup post-build emits version.json
  ARCHITECTURE.md                      ← deep dive
  CHANGELOG.md                         ← Unreleased + tagged releases
  AUDIT.md                             ← upstream cherry-pick audit
  3-SIGMA.md                           ← /posapp phase plan
  docs/TODO.md                         ← deferred items
```

## Patches active on prod (2026-05)

Latest first. Idempotent — `create_custom_field` no-ops, format inserts
check `frappe.db.exists` first.

> ✅ **DEPLOYED to prod 2026-06-01.** posawesome `89fc7cd4` → `8bebc65a`
> on both tenants. Bundle this session:
> - `d9757dec` perf:api telemetry chokepoint fix (Observability entry below).
>   VERIFIED on prod: 313 perf:api rows, method-level latency attributable.
> - `ee8e1b7d` + saldo `33e8aa7` — saldo per-profile gate. POS Profile
>   `saldo_enabled` (Check, default OFF, field owned/installed by the saldo
>   app, doco-only). Host gate: `InvoiceActionButtons.vue` "Recarga /
>   Servicio" launcher `v-if`, `Pos.vue` `openSaldoPicker()` no-op +
>   `SaldoCatalogPicker v-if`. Backend validate/dispatch gate in saldo
>   `pos_invoice_hooks.py`. **Prod doco profiles flipped ON: Doco Ventas +
>   CONTROL** (mumu OFF). New profiles need the flag set ON manually.
> - `cb3cfb60` searchbar multiword-whitespace fix.
> - `aeaf0216` shim `_server_messages` surfacing — direct `frappe.call`
>   throws now show the real message (was bare "HTTP 417"); close-shift
>   `.catch` added.
> - `bac3f1d5` security CI (CodeQL + gitleaks + Dependabot).
> - `76939d60` cart inline-edit focus crash fix — `ref.value?.focus()` on a
>   `<v-text-field>` instance threw "y.value?.focus is not a function"
>   (Vuetify 3 doesn't expose `.focus` on the instance); `focusInput()`
>   reaches the inner `<input>`. Killed the crash:unhandledrejection rows.
> - `8bebc65a` get_items perf — deep-OFFSET paging fix. Full-catalog load
>   paged 5700 items 100-at-a-time (107 deep-OFFSET round-trips, O(n²)
>   index re-walk). `SearchPlan.fetch_page_size` decouples DB chunk (2000)
>   from result cap. Lab: catalog 2566→402ms cold (6.4×), search
>   1366→356ms. Pure-Python deploy (worker restart only).
>
> **Deploy mechanics (bind-mount prod):** pull source on contavm sibling +
> rsync lab-built `dist/` (gitignored, doesn't travel via git) + migrate
> if patches/fields. SPA-only changes skip migrate + worker restart. NEVER
> `bench build` in the prod backend. After backend `--force-recreate`,
> restart proxy (stale upstream → 502).
>
> ⚠️ **Healthcare landmine (2026-05-31, fixed):** an empty root-owned
> `~/healthcare` bind-mount (no pyproject) made `pip-install-apps.sh` skip
> it, so `apps.txt`-listed `healthcare` crashed `setup_module_map` →
> Desk workspace icons broke + every `bench` cmd threw ModuleNotFound.
> Fixed by populating `~/healthcare` (earthians/marley@a032347e). Clean-boot
> now safe (configurator pip-installs it). NOTE: `~/healthcare` on contavm
> is a manual clone, NOT git-tracked — if wiped, re-clone before `compose
> up`. See [[marley_healthcare_isolation]].

### Closing-shift auto-print (2026-05-26)
- New: POS Profile field `posa_closing_shift_print_format` (Link →
  Print Format). When set, SPA auto-prints the closing ticket on the
  profile-pinned QZ printer right after submit. Default format
  `POSA Cierre de Caja` (80 mm thermal, Jinja sandbox-safe).
  Branded variant `MUMU Cierre de Caja` installed on
  ventas.mumulenceria.com.
- Backend: `submit_closing_pos` in `usePosShift.ts` captures
  active profile, dynamic-imports `qzTray`, fire-and-forget on
  print failure (shift is already submitted; toast guides operator
  to re-print from Desk if QZ daemon down).
- **Files**: [`patches/add_closing_shift_print_format_field.py`](posawesome/patches/add_closing_shift_print_format_field.py),
  [`patches/add_default_closing_shift_print_format.py`](posawesome/patches/add_default_closing_shift_print_format.py),
  [`frontend/src/posapp/composables/pos/shared/usePosShift.ts`](frontend/src/posapp/composables/pos/shared/usePosShift.ts)
- Commits `4e01676b` + `b653c278` (sandbox-safe template fix)

### `/posapp` canonical operator route (2026-05-26)
- `/posapp` (web route, no Desk shell) is now the canonical entry.
  `/app/posapp` legacy stays alive with `?legacy=1` bypass for
  dev / regression testing. `posapp.js` does
  `window.location.replace('/posapp')` immediately on load unless
  bypass present.
- LCP win ~3-5 s on cold load. Baseline DOM ~5 k nodes vs ~150 k
  inside Desk.
- Workspace links stay `link_type=Page link_to=posapp` (v16
  Workspace Link enum doesn't allow URL — would break migrate).
  Controller-side redirect is the workaround. See
  [`docs/TODO.md`](docs/TODO.md) → "Workspace link URL support" for
  the Property Setter cleanup.
- **Files**: [`posawesome/page/posapp/posapp.js`](posawesome/posawesome/page/posapp/posapp.js),
  [`frontend/src/posapp/components/pos/shift/OpeningDialog.vue`](frontend/src/posapp/components/pos/shift/OpeningDialog.vue)
- Commits `f2d99d12` + `95352acf` (workspace JSON revert)

### Observability + LCP preload + INP attribution (2026-05-26; perf:api corrected 2026-05-31)
- `perf:api.<method>.<ok|err>` per-method timing. ORIGINALLY emitted
  from `api.callEnvelope` (commit `8e351c65`) — but the hot methods
  bypass callEnvelope via direct `frappe.call()` (~52 sites), so 0 rows
  ever landed. FIXED `d9757dec` (lab): timing now emits from
  `trackApiTiming()` in `utils/telemetry.ts`, called by the shim
  `frappeCall` chokepoint at all 3 exits; callEnvelope no longer
  self-times. Hot methods always tracked; cold sampled 10%.
- 11 `<link rel=modulepreload>` tags emitted in `posapp.html` head
  for boot-critical chunks (vendor / vue / router / pinia / api /
  format / db / posawesome / Pos / DefaultLayout / ItemsSelector).
- `rum:inp` metadata extended: `route`, `data-perf-tag` ancestor,
  element id / first 2 class tokens.
- Shim `error` callback contract honored — no more `Uncaught (in
  promise) HTTP …` leaks polluting `crash:unhandledrejection`.
- **Files**: [`frontend/src/posapp/services/api.ts`](frontend/src/posapp/services/api.ts),
  [`frontend/src/posapp/utils/frappe-shim.ts`](frontend/src/posapp/utils/frappe-shim.ts),
  [`frontend/src/posapp/utils/telemetry.ts`](frontend/src/posapp/utils/telemetry.ts),
  [`frontend/build-manifest.js`](frontend/build-manifest.js)
- Commit `8e351c65`

### Prod 403/417 saga (2026-05-25, post-`fm → muelle compose` migration)
Seven blocker fixes shipped in `PR #1` (merged `169d9ccf`):
- `6e0c6ffe` scope stamping (pos_profile / company / customer)
- `ffb94fb8` shim datetime helpers (`obj_to_str` / `str_to_obj` /
  `now_date`)
- `805b366b` toast surfacing — extract `_server_messages` text
- `23ca94e6` rate-band cap disabled when `posa_allow_user_to_edit_rate=1`
  (variable-price items like "cambiar pantalla")
- `eb90960f` credit-sale partial-payment exemption
  (`data.is_credit_sale=1` skips paid==grand_total)
- `371d73d1` deferred-print 45s → 8s with DB-poll fallback
- `f130a058` realtime dual-publish to BOTH user + doc rooms
  (web-route shim doesn't auto-join user room)

### QZ Tray fixes (2026-05-20)
- `1ac0d77d` — extended `_QZ_SIGN_ROLES` to include `Sales User` +
  `Sales Manager`. Real-world POS operators lack the standalone
  `POS User` role; gate was over-tight.
- `b902e860` — sw.js skip caching `.woff*`/`.ttf` font files
  (stops the recurring "broken font / tofu icons" pathology
  after every deploy).
- `9d2333dd` — drop strict envelope-shape check on sign_message
  (qz-tray.js sends different payloads at different lifecycle
  phases; whitelist broke handshake).

### Other recent
- `add_qz_print_quality_fields` — interpolation + density per-profile
- `add_qz_cut_after_print` — ESC/POS cut command append
- `add_p0_perf_indexes` — DB indexes on hot query paths
- `add_pos_telemetry_event_index` — telemetry doctype indexing

## Key contracts

### Sale lifecycle
```
Cart → update_invoice (autosave draft) → Pay dialog → submit_invoice
                                                          ↓
                                                  bg job (or inline)
                                                          ↓
                                            _posa_publish_dual → SPA
                                                          ↓
                                                  printDocumentViaQz
                                                          ↓
                                                  QZ Tray → printer
```

### Submit-doc scope assertions (PR-1)
At `submit_invoice` entry (`invoice_processing/creation.py:1025-1027`):
```python
assert_profile(user, invoice.get("pos_profile"))
assert_company(user, invoice.get("company"))
assert_customer_in_profile(user, invoice.get("customer"), pos_profile)
```
All three read from the serialized `invoice` doc. Frontend stamps via
[`usePaymentSubmission.ts:762-770`](frontend/src/posapp/composables/pos/payments/usePaymentSubmission.ts)
as belt-and-suspenders since some flows mutated the doc without
re-seeding from `posProfile`.

### `_posa_publish_dual` realtime
Backend bg-job lifecycle events (`pos_invoice_processed`,
`pos_invoice_submit_error`) publish to BOTH:
- `user:<email>` room (Desk auto-joins via session cookie)
- `doc:Sales Invoice/<name>` room (SPA subscribes via
  `socketStore.subscribeToInvoiceDoc`)

Frappe's `publish_realtime` if-elif chain picks the FIRST matching
target, so two explicit publishes are required.
See [`invoice_processing/creation.py:53-77`](posawesome/posawesome/api/invoice_processing/creation.py).

### Telemetry schema gates
`api/telemetry.py:41` enforces event_name prefix:
```python
ALLOWED_EVENT_PREFIXES = ("rum:", "perf:", "pos:", "crash:", "warn:")
```
Any other prefix is silently dropped. `trackCustomMark` prepends
`perf:` automatically.

### QZ sign_message role allowlist
```python
_QZ_SIGN_ROLES = (
    "POS User", "POS Manager", "POS Awesome Supervisor",
    "Sales User", "Sales Manager",        # added 2026-05-20
    "System Manager",
)
```
Plus length cap 16 KB + non-empty check. Don't tighten the envelope
shape — `9d2333dd` documents why.

### Print pipeline arg shape
```ts
printDocumentViaQz({
  doctype: "Sales Invoice" | "POS Invoice" | "POS Closing Shift",
  name: "ACC-SINV-...",
  printFormat: "POSA Receipt" | "POSA Cierre de Caja" | ...,
  letterhead: profile.letter_head || null,
  noLetterhead: profile.letter_head ? "0" : "1",
  printerName: profile.posa_qz_printer_name || undefined,
  // optional Q3 raster hints
  interpolation, density, cutAfterPrint,
})
```

## Hooks registered (excerpt)

See [`hooks.py`](posawesome/hooks.py) for the full list. Key ones:

| Trigger | Handler | Why |
|---|---|---|
| `before_request` | `frappe.rate_limiter.apply` (Frappe core) | API rate limit |
| `Sales Invoice.on_submit` | `posawesome...invoice_processing...creation.on_pos_invoice_submit` | post-submit payment entries |
| `POS Profile.validate` | scope-config side-effects |  |
| `permission_query_conditions` | per-shop isolation (taller integration) |  |

## Conventions specific to this app

- **Pinia stores use `shallowRef` + `markRaw` for hot paths** —
  `itemsStore.itemsMap` is 1500-15000 entries; deep reactivity
  trashes the main thread.
- **Cart row reactivity gated via `posa_row_id`** — never use array
  index as Vue key; rows mutate in place.
- **Search-while-bg-sync gotcha** — search blocked during catalog
  delta refresh; #131 fixed but `tabPOS Telemetry Event` rows
  may show `rum:inp > 1s` keydown if it returns.
- **`bench build` does NOT work inside the prod backend container**
  (no node in subshell PATH; #125). Deploy by rsync-ing built dist
  from `muelle-host` → `contavm:posawesome/posawesome/public/dist/`.
- **Workspace JSON file-sync direction**: Frappe's workspace_sync
  writes DB → file on migrate. Direct JSON edits get reverted unless
  Workspace was deleted first. Use a patch for fixture-grade changes.
- **Jinja print-format sandbox** — `frappe.get_cached_value` +
  `.format()` blocked. Use `frappe.utils.fmt_money` + `|int`. See
  memory [`reference_jinja_sandbox.md`](../../.claude/projects/-home-holymc2/memory/reference_jinja_sandbox.md).
- **Site `/private/qz/` is a Docker named-volume path** — copy
  the dir explicitly across stack migrations; restic snapshots of
  the host don't capture it. Memory:
  [`project_qz_cert_migration.md`](../../.claude/projects/-home-holymc2/memory/project_qz_cert_migration.md).
- **CAVEMAN mode in commits** — code/commits write normal English;
  caveman applies only to chat replies.

## Companion repos

- [`muelle/`](../muelle/AGENTS.md) — compose stack, recovery bundle,
  proxy config (limit_req zones), gunicorn capacity knobs
- [`doco/`](../doco/) — observability endpoint, Prometheus metrics,
  shared print helpers
- [`taller/`](../taller/AGENTS.md) — Repair Order flow; settled POS
  invoices fire taller's auto-deliver hook
- [`crm/`](../crm/AGENTS.md) — Lead/Deal modal; intake flow lives there
- [`erpnext_mexico_compliance/`](../erpnext_mexico_compliance/) —
  CFDI; emits Sales Invoice variant for fiscal compliance (not
  installed on either prod tenant yet)

## Memory (read-only, persists across sessions)

- `project_posawesome_fork.md` — fork policy, branch strategy
- `project_qz_cert_migration.md` — `<site>/private/qz/` must be
  hand-copied across stack swaps
- `feedback_hotfix_lab_first.md` — fix(critical)/cache/customer/
  payment/security → lab-only deploy then wait for explicit
  "push to prod"
- `feedback_no_bench_build_in_prod_container.md` — rsync built
  dist, never bench-build on the prod backend
- `feedback_muelle_asset_symlinks.md` — sites/assets/<app> symlinks
  resolve per-container; cross-container build = staleness
- `feedback_sw_cache_blocks_fixes.md` — operators may need SW
  unregister + caches.delete after a SPA hotfix
- `reference_jinja_sandbox.md` — `.format()` blocked, fmt_money +
  ljust/rjust/slicing instead

## Deploy

### Lab (auto-pilot per [`feedback_dev_autodeploy.md`](../../.claude/projects/-home-holymc2/memory/feedback_dev_autodeploy.md))
```bash
cd ~/muelle-host
./muelle/scripts/dev-refresh.sh posawesome   # build + sync + proxy restart
docker compose -f muelle/compose.yaml exec -T backend \
  bench --site ventas.lab.xoloitzcuintles.com migrate   # if patches landed
```

### Prod (gated; explicit confirm per [`feedback_prod_readonly.md`](../../.claude/projects/-home-holymc2/memory/feedback_prod_readonly.md))
```bash
# 1. pull source on contavm
ssh contavm "cd /home/contavm/posawesome && \
  git fetch origin doco-customizations && \
  git reset --hard origin/doco-customizations"

# 2. rsync built dist (NOT bench build — no node in prod backend)
rsync -av --delete \
  ~/muelle-host/posawesome/posawesome/public/dist/ \
  contavm:/home/contavm/posawesome/posawesome/public/dist/

# 3. migrate each site if patches added
ssh contavm 'cd /home/contavm/muelle && \
  docker compose exec -T backend bench --site ventas.docomexico.com migrate && \
  docker compose exec -T backend bench --site ventas.mumulenceria.com migrate'

# 4. restart workers
ssh contavm 'cd /home/contavm/muelle && \
  docker compose restart backend queue-short queue-long'
```

For SPA-only changes: skip the migrate. For pure Python: skip the
rsync (source bind-mount picks up immediately on worker reload).

### Test

```bash
cd ~/muelle-host/posawesome/frontend
node_modules/.bin/vitest run         # 569 specs across 149 files
node_modules/.bin/vue-tsc --noEmit   # strict types (must pass)
```

CI runs Playwright smoke at BOTH `/app/posapp` + `/posapp` paths
on every PR — see [`frontend/tests/smoke/posapp.web-route.spec.ts`](frontend/tests/smoke/posapp.web-route.spec.ts).

---

*Living doc. Update when you patch a controller, doctype, hook, or
ship a perf / security fix. Cross-link to companion AGENTS.md and to
specific lines/files. Newest patches on top under "Patches active
on prod".*
