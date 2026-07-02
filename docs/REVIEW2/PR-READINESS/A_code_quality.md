# A · Code-quality audit — fork commits proposed for upstream

> Snapshot 2026-05-18 · fork `doco-customizations` · upstream
> `defendicon/POS-Awesome-V15` · target `stage-develop` (tip
> `21bc3e51`). Audit per `UPSTREAM-PRS.md` and `06_code_quality.md`.
> READ-ONLY review. No code modified. No PRs opened.
>
> Severity legend: 🟢 ship-ready · 🟡 amend before ship · 🔴 hold (must
> fix or split).

---

## PR-1 · `fix/python-3.14-module-lock`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `6e9d7222` | fix(import): pre-import pricing_rules Py3.14 lock | 🟢 | +11 LOC additive; only `api/__init__.py`; `# noqa: F401`; commit msg complete |

**Verdict: ship-as-is.** Single concern, single file, zero risk, no
doco coupling, no test needed (deadlock is import-graph topology not
runtime behaviour). The 8-line comment above the import explains
*why* — exactly the kind of one-line obvious win that builds maintainer
trust. **This is the starter PR. Ship first.**

---

## PR-2 · `chore/vuetify-3.12.6`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `5aa38110` | chore(deps): bump vuetify 3.7.5 → 3.12.6 | 🟢 | clean — package.json + yarn.lock only, no app code |
| `2694d8dc` | test(build-manifest): hashed entry contract | 🔴 | belongs to PR-3 d477e21f, NOT PR-2 — depends on build code not in this PR |

**Verdict: split-into-smaller-PRs.**

Critical cross-PR consistency violation: `2694d8dc` is a *test
update* that asserts the post-`d477e21f` `getEntryFileName` contract
(every entry hashed). If `2694d8dc` ships in PR-2 without `d477e21f`,
vitest fails on its own merge — the spec asserts
`"[name]-[hash].js"` but vite.config still emits `"[name].js"` for
shell entries until PR-3 lands. If `d477e21f` ships in PR-3 without
`2694d8dc`, the OLD spec still asserts stable shell names and breaks
too (per `2694d8dc`'s commit msg: "the lone vitest failure (1/530)").

**Fix**: move `2694d8dc` into PR-3 alongside `d477e21f`. PR-2 then
ships `5aa38110` alone — a clean two-line `package.json` change plus
re-resolved `yarn.lock` (per UPSTREAM-PRS R-15: re-resolve, don't
carry our lockfile). Re-resolved lockfile must be regenerated on the
PR branch from PR-3-clean `package.json`; the four-line `yarn.lock`
delta in this commit cannot be carried as-is across upstream's
lockfile state.

After split: PR-2 single-commit, 🟢 ship-as-is for Vuetify bump.
Risk: medium yarn.lock conflict; mitigated by re-resolve.

---

## PR-3 · `perf/build-hashed-entries-sw`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `d477e21f` | perf(build): hash entry filenames | 🟡 | strong commit msg; missing test (test lives in 2694d8dc, separated) |
| `5a1a13fc` | fix(sw): register at /sw.js?v=<build> | 🟢 | +15 LOC one file, re-applies safe half of reverted b4c514ad |
| `b4c514ad` | fix(build): version drift + SW staleness | 🔴 | REVERTED in fork by 0f5d8a44 + 0bddc50a — must NOT ship |

**Verdict: amend-before-ship.**

Three corrections needed before opening PR-3:

1. **DROP `b4c514ad`.** It was reverted twice in the fork
   (`0f5d8a44`, `0bddc50a`) for telemetry noise from the
   `-dirty-<hash>` version-label. `5a1a13fc` already re-applies the
   only useful half (SW `?v=<build>` registration). Shipping
   `b4c514ad` upstream would push code the fork itself rejected.
   This is the most dangerous mistake in the user-supplied commit
   list.

2. **PULL `2694d8dc` IN from PR-2.** Per PR-2 finding: the
   buildManifest spec update belongs with the build-manifest code
   change. Without it `d477e21f` ships a build behaviour that
   contradicts the test suite (per `d477e21f` shipping alone vs the
   pre-`2694d8dc` spec, vitest would have 1/N failing).

3. **PULL `b6d41569` IN.** UPSTREAM-PRS PR-3 plan lists
   `d477e21f, 5a1a13fc, b6d41569` (bg-sync hidden-tab guard).
   User-supplied list substitutes the reverted `b4c514ad` for
   `b6d41569`. `b6d41569` is the actual third member: pauses bg
   item sync on `document.hidden`, +37 LOC, two files
   (`useItemSync.ts` + `backgroundSync.ts`), idempotent guard, clear
   commit msg, no doco coupling. Ship-ready.

Final PR-3 set: `d477e21f` + `2694d8dc` + `5a1a13fc` + `b6d41569`
(four commits, total ~155 LOC, 8 files). All atomic per concern;
each commit compiles on top of the previous; no debug code; no doco
refs. The build-manifest+SW pair is risky-by-nature (deploy/cache
behaviour) but the commit msgs document the repro/test path.

Conflict risk with upstream `255f88e9`+`9af33b58` (cart batching +
detail-refresh) is **medium** — `useItemSync.ts` overlap on
`b6d41569`. Per UPSTREAM-PRS: take-upstream-as-base, re-apply our
hidden-tab guard.

---

## PR-4 · `perf/store-de-deepening`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `8f3a87e5` | perf(items): shallowRef + markRaw catalog | 🟢 | itemsStore.ts only; pinned by `_detailSynced` reactive contract |
| `06c1d639` | perf(items): shallowRef itemsMap+barcodeIndex | 🟢 | useItemsSearch.ts only; pattern-consistent with 8f3a87e5 |
| `47d0ca54` | perf(pricing-rules): shallowRef + markRaw | 🟢 | pricingRulesStore.ts only; tight scope |
| `c9789db6` | fix(pricing-rules): markRaw inverted index Maps | 🟡 | follow-up to 47d0ca54 — squash into 47d0ca54 before PR |
| `7f82339d` | fix(critical): 3 unrelated fixes | 🔴 | NOT ATOMIC — bundles pricing flicker + customers fallback + shallowRef |
| `0d94b966` | fix(critical): bound + de-reactify cache | 🟡 | commit msg references 9fee9e46+2977e50c (PR-5) as predecessor |
| `539d8654` | perf(ui): shallowRef 5 array refs | 🟢 | uiStore.ts only; consistent pattern |
| `40407fee` | perf(customers): drop dropdown cap to 50 | 🟢 | customersStore.ts +8/-9; trivial tuning |
| `8cc9a311` | perf(items): drop per-search JSON.parse clone | 🟢 | loadItemsRequest.ts only; isolated wallop |

**Verdict: split-into-smaller-PRs.**

This is the most expensive PR in the queue and the user-supplied
commit set is structurally wrong. Three issues:

1. **`7f82339d` violates atomicity hard.** Its own commit message
   advertises three independent fixes:
   - pricing flicker (`invoice_utils/pricing.ts` re-bracketing
     `_applyingPricingRules`)
   - customer search fallback gate
     (`customersStore.ts: page.value === FIRST_PAGE + 1` → `page.value === 0`)
   - customersStore `customers` ref → `shallowRef + markRaw`

   The customer-fallback gate fix BELONGS TO PR-7
   (`188fe54f` introduced the broken gate). The pricing flicker fix
   has no perf-store-deepening relevance — it's a cart watcher
   bracketing bug. Only the customersStore shallowRef change fits
   PR-4. **Must split into three sibling commits before any PR
   opens.**

2. **`c9789db6` is a fixup to `47d0ca54`.** Both touch
   `pricingRulesStore.ts`; `c9789db6` itself says "Caught by a
   second-opinion audit pass." Squash before opening PR — upstream
   maintainers do not want to land a 7-LOC follow-up commit they
   could have had in the original.

3. **`0d94b966` declares a cross-PR dependency on PR-5.** Commit msg
   line 1: "After the listener-leak fixes (9fee9e46, 2977e50c)
   restored INP to 80 ms, the operator still hit Aw-Snap." That
   reads as "this commit only makes sense after PR-5 lands." If PR-4
   ships standalone, the OOM thesis in `0d94b966`'s msg is
   unverifiable for upstream reviewers. Either restate the commit
   msg to stand on its own performance argument, or sequence PR-4
   AFTER PR-5 on the merge train.

Doco coupling check: none of the PR-4 commits reference
`posa_use_web_route`, doco Custom Fields, or doco-specific
DocTypes. The `posa_local_storage`, `posa_use_server_cache`,
`posa_force_reload_items` flags referenced in `8cc9a311` and
`8f3a87e5` test plans ARE upstream POS Profile fields. Clean on
that front.

Regression risk for non-doco / default-config users: the shallowRef
contract is fragile. Any consumer that watches the items / customers
array DEEPLY (looking for inner mutations) will break silently after
this PR. The fork has shipped this in production for tenant-months
(per UPSTREAM-PRS PR-4 framing), but upstream cherry-pickers without
the full reactive surface audit risk regressions. **PR must include
a heap-baseline + INP-baseline before/after the way UPSTREAM-PRS
already proposes.**

Size: 9 commits, ~310 LOC delta. After split and squash: ~6 commits,
~290 LOC. Still the largest PR in this batch. Best landed AFTER
upstream cart trio (`881ba161/2247c666/9f37d53c`) is on
stage-develop for ≥14 days (R-01 in UPSTREAM-PRS), otherwise
`2247c666`'s deep-watcher removal will produce a 3-way merge that
nobody enjoys.

---

## PR-5 · `perf/watcher-listener-hygiene`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `dc0518f4` | perf(invoice): drop deep:true posProfile+offers | 🟢 | Invoice.vue only +13/-2 |
| `5006a5b5` | perf: batch-drop deep:true from 9 hot watchers | 🟢 | 9 files, +36/-16, consistent pattern, no test added |
| `9fee9e46` | fix(critical): socketStore.init double-reg guard | 🟢 | +12 LOC, single file, idempotency flag, clean |
| `2977e50c` | fix(critical): eventBus cleanup PosOffers/Coupons/NewAddress | 🟢 | 3 files +21 LOC, `beforeUnmount` hooks added |
| `8eb19103` | fix(search): bound _lastSearchServerRetryByTerm | 🟢 | +13 LOC, FIFO cap at 100, no behaviour change |

**Verdict: ship-as-is** (with one caveat — see below).

This is the cleanest PR in the queue. Every commit is single-concern,
single (or near-single) file, with explicit Before/After commit
messages and listener-count diagnostics. Pattern is consistent across
all commits (drop `deep: true`, add `beforeUnmount` cleanup, add
idempotency / bounds).

Caveats:

- **No tests added** for any of the 5 commits. `dc0518f4` /
  `5006a5b5` change 14 hot watchers — a snapshot test asserting the
  watcher's reactive trigger fires on reference replacement only
  (not nested mutation) would catch regressions cheaply. Not a
  blocker for ship, but upstream maintainers may ask.
- `5006a5b5` rewrites `useInvoiceOffers.ts:107` from
  `watch(invoiceStore.metadata, …, { deep: true })` to watching
  `invoiceStore.metadata.changeVersion`. This is correct IF the
  cart-edit path always bumps `changeVersion`. Verify with a
  scenario test before claiming "vitest 530/530 green" covers it —
  the existing 530 specs may not exercise the metadata path.
- `8eb19103`'s 100-entry cap is a Map-iteration-order assumption.
  V8 / SpiderMonkey both guarantee insertion order on `Map.keys()`
  per ES2015 — fine — but the commit msg should cite the spec, not
  imply it's an implementation detail.

Conflict risk: upstream `2247c666` also drops deep watchers — PR
description must reference it and frame ours as the structural fix
(per UPSTREAM-PRS PR-5 conflict-risk note). Files distinct from PR-4.

**Ship order: PR-5 BEFORE PR-4.** PR-4 (`0d94b966`) explicitly
declares PR-5 as predecessor. Inverting the order forces upstream to
read PR-4 with un-grounded "INP at 80 ms" claims.

---

## PR-7 · `fix/customer-flow`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `0d652a8f` | fix(critical): customer-change no-block + dropdown cap | 🟡 | 3 files, 3 concerns: cust fetch async + flush async + dropdown cap |
| `188fe54f` | fix(critical): customer freeze foreign price-list | 🟡 | 5 files, 5 concerns; broke fallback gate fixed in 7f82339d (PR-4) |
| `78750236` | fix(realtime): seed serverOnline from socket | 🟢 | +13 LOC one file, isolated, well-motivated |

**Verdict: amend-before-ship.**

Two issues:

1. **`188fe54f` introduces a bug `7f82339d` fixes.** `188fe54f` adds
   the `page.value === FIRST_PAGE + 1` server-fallback gate that
   `7f82339d` (currently mis-bucketed in PR-4) corrects to
   `page.value === 0`. If PR-7 ships with `188fe54f` standalone, the
   customer search fallback ships broken — empty dropdowns during
   IDB sync. The fix from `7f82339d` MUST be folded into `188fe54f`
   (squash) or follow as a separate `188fe54f`-companion commit
   inside PR-7. **Cannot ship PR-7 without that fix in the same PR.**

2. **`0d652a8f` and `188fe54f` each bundle 3-5 concerns.** `0d652a8f`
   touches customer-fetch async + background-flush async + dropdown
   cap. `188fe54f` touches updatePriceList fallback + watcher
   deferral + search-fallback gate + new endpoint + customersStore
   server fallback. Both work as-is functionally, but the per-commit
   blast radius is large enough that upstream reviewers will ask for
   splits. Decision: either re-author each as 3 / 5 sibling commits,
   or land as-is with very-clear PR description sectioning by file.
   Recommendation: leave as-is for the PR text but break the test
   plan into one bullet per concern.

Doco coupling check: `search_customers` (new endpoint at
`customers.py:148`) is scoped to POS Profile `customer_groups` —
that's a stock POS Profile field, not doco-specific. Clean.

`78750236` is independent and ship-ready on its own; could be split
into a trivial PR-7a if upstream balks at the bundle size.

Regression risk: HIGH on the cart-fetch / background-flush
fire-and-forget changes (`0d652a8f`). Operators on flaky networks
will now see stale prices for a window after customer-change while
the async fetch resolves. UPSTREAM-PRS merge gates list "customer
change p99 < 300ms" — but they don't list a *correctness*
verification that prices eventually settle. Need to add: after the
fetch resolves, asserting cart line totals match the new price-list.

---

## PR-8 · `feat/qz-tray-improvements`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `9ce815b7` | feat: pass posa_qz_printer_name from POS Profile | 🔴 | reads Custom Field that has NO upstream definition — silent no-op for non-doco |
| `6aa28fbd` | feat: inline letterhead as base64 | 🟢 | qzTray.ts only, +60 LOC, isolated, fallback path safe |
| `30e39cc7` | fix: pin print viewport to printer width | 🟢 | qzTray.ts +14/-3, `widthMm` option, 80mm default |
| `b9db3616` | fix: inset print body 4mm thermal clipping | 🟢 | qzTray.ts +5/-4, replaces ineffective margin:auto |
| `660ec6f8` | feat: pre-warm QZ Tray when silent_print | 🟢 | Pos.vue +14 LOC, error-swallowing |

**Verdict: hold.**

`9ce815b7` is the blocker. It reads `pos_profile.value?.posa_qz_printer_name`
from the POS Profile JSON, but `posa_qz_printer_name` is NOT defined
as a Custom Field or DocField anywhere in `posawesome/`:

```
$ grep -rn "posa_qz_printer_name" posawesome/posawesome/ --include="*.json"
(no results)
$ grep -rn "posa_qz_printer_name" posawesome/posawesome/ --include="*.py"
(no results)
```

The field exists only as a doco-side Custom Field on our deployment.
For any upstream user without that Custom Field, `pos_profile.value
.posa_qz_printer_name` is `undefined`, the `|| undefined` fallback
kicks in, and the localStorage selection wins — i.e. the commit
silently no-ops. Worse: `QzTrayDialog.vue:305` writes back to the
field on save, which on a non-doco install will fail or attach the
value to a phantom dict that doesn't persist. Either:

- **(a) Add a `posawesome/fixtures/custom_field.json`** entry that
  defines `posa_qz_printer_name` on POS Profile (Data, length 140,
  insert_after=`update_stock` or whichever section). Bundle into
  PR-8.
- **(b) Move the field onto the POS Profile DocType itself** (PR-8
  ships the JSON schema change). Cleaner long-term, but means
  upstream owns the field schema going forward.

Without (a) or (b), PR-8 cannot ship — it depends on a fixture that
doesn't exist in the upstream tree.

Other 4 commits are clean:
- `6aa28fbd` letterhead-base64: well-scoped, per-URL cache, fallback
  to placeholder if fetch fails.
- `30e39cc7` viewport: honors caller's `widthMm`, defaults to 80mm.
- `b9db3616` 4mm inset: replaces a known-broken `margin:0-auto`
  approach; minimal LOC.
- `660ec6f8` pre-warm: error-swallowing per design, no-op when
  silent_print disabled.

Cross-cutting: 4 of 5 commits touch `qzTray.ts`. Squashing into one
"hardening" commit + the Pos.vue pre-warm = clean 2-commit PR after
the Custom Field issue is resolved. Telemetry hook `48a87102` is
correctly stripped to PR-C (per UPSTREAM-PRS).

Debug-code audit: pre-existing `console.warn` lines in `qzTray.ts`
(L283/311/381/410) are NOT introduced by these commits — they
predate the PR-8 set. Worth replacing with the telemetry track call
introduced in `48a87102` (PR-C), but that's a future cleanup, not a
PR-8 blocker.

Doco coupling: only `9ce815b7` (resolvable per above). The
letterhead / viewport / inset / pre-warm commits are
deployment-neutral.

---

## PR-C · `feat/rum-telemetry`

| hash | subject (≤50) | sev | finding (≤80) |
|---|---|:-:|---|
| `3fd64a85` | feat(telemetry): POS Telemetry Event doctype | 🟡 | new DocType clean; copyright "doco contributors" needs genericise |
| `6b22d002` | feat(telemetry): ingest+summary+prune endpoints | 🟡 | api/telemetry.py +263 LOC; ignore_permissions=True on insert; needs rate-limit |
| `398539c1` | feat(telemetry): frontend RUM + withPerf hook | 🟡 | +362 LOC new file telemetry.ts; PerformanceObserver budget OK; no tests |
| `48a87102` | fix(qz): telemetry capture for QZ failures | 🟢 | qzTray.ts +73/-14; bounded at 10 events/session; depends on PR-C base |

**Verdict: amend-before-ship.**

This is a substantial new feature, not a fix. Upstream maintainers
will scrutinise it harder than the perf PRs. Concerns:

1. **DocType copyright lines name "doco contributors"** — both
   `pos_telemetry_event.py:1` and `api/telemetry.py:1`. Trivial to
   fix; rename to "POSAwesome contributors" or "Frappe Technologies"
   per upstream convention before opening the PR. Five-second fix
   but a tell-tale sign of fork-origin code.

2. **`6b22d002` writes via `frappe.get_doc(...).insert(ignore_permissions=True)`.**
   Per REVIEW2/03 §D1 audit: this pattern leaks privileges if it
   throws on the failure path. Wrap in the `ignore_account_permission`
   context manager pattern the audit recommends, OR justify in the
   PR description why the `ignore_permissions=True` is necessary on
   a write-only endpoint (cart-edit hot path can't see perm
   failures — fair, but document it).

3. **No rate-limit on `ingest`.** Endpoint accepts 200 events per
   batch with a "POST-only, whitelisted" gate. A malicious or buggy
   client can hammer the endpoint and fill the DocType. Add either:
   - `frappe.rate_limit(limit=60, seconds=60)` per-user/session, or
   - a session-scoped event-count ceiling matching the
     frontend's 1000-buffered drop policy.

4. **`398539c1` ships `telemetry.ts` (326 LOC) without a vitest
   spec.** UPSTREAM-PRS PR-C merge gates do not require it but
   upstream's CI will benefit from at least:
   - sendBeacon firing on `visibilitychange=hidden`
   - opt-out via `localStorage.posa_rum = "off"`
   - bounded backpressure at 1000

5. **`48a87102` depends on `398539c1`'s `track()` API.** Must ship
   in this PR (which the user-supplied commit list correctly does),
   not separately. Verified.

6. **`api/__init__.py` pre-import.** `6b22d002` adds the same Py3.14
   `_ModuleLock` workaround pattern as PR-1 — `from .telemetry
   import ...`. Good — consistent with PR-1. BUT this means PR-C
   technically depends on PR-1 being merged first (otherwise the
   pre-import is the only one in `__init__.py`). Trivial in
   practice; document as a sequence note in PR description.

Doco coupling: zero references to `posa_use_web_route`, doco
DocTypes, or doco fixtures. The DocType is a clean greenfield
addition. Just the copyright string needs genericising.

Size: 4 commits, ~960 LOC delta (320 backend, 360 frontend, 280
DocType). Largest PR by LOC after PR-4, but mostly new files (low
conflict risk).

Conflict risk: low. Net-new files dominate; only `api/__init__.py`,
`hooks.py`, and `qzTray.ts` (last touched by PR-8 commits) overlap
existing code.

---

## Cross-PR audit summary table

| PR | atomicity | isolation | tests | doco coupling | size LOC | verdict |
|---|:-:|:-:|:-:|:-:|---:|---|
| PR-1 | ✅ | ✅ | ⚠ none needed | ✅ none | ~12 | ship-as-is |
| PR-2 | ❌ wrong commits | ✅ | ❌ test in wrong PR | ✅ none | ~10 + lock | split |
| PR-3 | ⚠ misnamed commit | ✅ | ❌ test in wrong PR | ✅ none | ~155 | amend |
| PR-4 | ❌ 7f82339d violates | ⚠ depends on PR-5 | ⚠ heap baseline only | ✅ none | ~310 | split |
| PR-5 | ✅ | ✅ | ⚠ no new tests | ✅ none | ~95 | ship-as-is |
| PR-7 | ❌ 188fe54f buggy | ⚠ 7f82339d co-required | ⚠ no new tests | ✅ none | ~290 | amend |
| PR-8 | ⚠ field undefined | ✅ | ⚠ existing only | ❌ Custom Field | ~100 | hold |
| PR-C | ⚠ copyright + perm | ✅ | ❌ no tests | ✅ none | ~960 | amend |

---

## Recommended SHIP-ORDER

Ranking by (a) starter-PR maintainer-trust value, (b) size small
first, (c) standalone-ness, (d) conflict risk vs upstream parallel
work:

| Rank | PR | Why this position |
|:-:|---|---|
| 1 | **PR-1** | 12-LOC additive `__init__.py` pre-import. Highest-clarity commit msg in the queue. Critical bug on Py3.14 + Frappe v16. No conflict possible. **Ship FIRST as the trust-builder.** Targets <48h merge. |
| 2 | **PR-2** (split, just `5aa38110`) | Dependency bump only. `package.json` 2 LOC. Re-resolved `yarn.lock` on the PR branch. No code changes. Builds maintainer reflex for fast-path merge of low-risk dep bumps. |
| 3 | **PR-5** | Five clean commits, ~95 LOC, watchers + listeners hygiene. Independent of every other PR. Predecessor to PR-4 per `0d94b966`'s own commit msg. Ship before PR-4. |
| 4 | **PR-3** (amended: `d477e21f` + `2694d8dc` + `5a1a13fc` + `b6d41569`, drop `b4c514ad`) | Build/SW/bg-sync. Medium-conflict-risk vs upstream `255f88e9`+`9af33b58` but per UPSTREAM-PRS the rebase order is take-upstream-as-base, re-apply hidden-tab guard. |
| 5 | **PR-7** (amended: fold `7f82339d` customer fallback fix in) | Customer-flow critical fixes. Independent of PR-4/5 functionally. Wait for `78750236` ack as PR-7a if upstream balks at the bundle size — `78750236` is one-line trust-builder and could split out. |
| 6 | **PR-4** (split + reordered after PR-5) | Largest. Wait until upstream cart trio (`881ba161/2247c666/9f37d53c`) is on stage-develop ≥14 days (R-01). Heap-baseline + INP-baseline mandatory. After split + squash → ~6 commits. |
| 7 | **PR-C** (after copyright + rate-limit + spec) | New feature, not a fix. Largest LOC. Lowest priority — upstream may want to discuss DocType ownership / governance before accepting. Best landed AFTER the perf/fix PRs prove fork-quality. |
| 8 | **PR-8** (after Custom Field fixture lands) | Held until either (a) the `posa_qz_printer_name` Custom Field ships in a `fixtures/custom_field.json`, or (b) moved onto the POS Profile DocType. Without that, the headline commit (`9ce815b7`) silently no-ops on upstream installs. Last because (i) niche scope (silent print users only), (ii) needs fixture decision, (iii) other 4 commits in the set are fine — could ship the 4 clean commits as PR-8a before resolving the Custom Field. |

Optional ordering tweak: if upstream-relations are cold, swap rank 2
(PR-2 Vuetify) and rank 3 (PR-5 watchers). PR-5 demonstrates
*engineering value* (real INP improvements with diagnostics), PR-2
demonstrates *housekeeping*. The first is the better trust-builder
once PR-1 is on the books.

---

## Hard "do NOT push" list

- **`b4c514ad`** — reverted in fork by `0f5d8a44` and `0bddc50a`.
  User-supplied PR-3 list includes it; UPSTREAM-PRS correctly
  substitutes `b6d41569`. If this commit lands upstream the
  `-dirty-<hash>` version label telemetry noise (the original
  reason for the fork revert) ships to every upstream user.
- **`7f82339d` as a single unit** — three independent fixes
  (pricing flicker / customer fallback gate / customersStore
  shallowRef) bundled. Must split into three commits before any
  PR opens; the pieces belong to PR-4, PR-7, and PR-4 respectively.
- **`9ce815b7` without the matching Custom Field fixture** — would
  silently no-op on every upstream install. Worse: writes back to
  a phantom field via `QzTrayDialog.vue:305`.
- **`2694d8dc` without `d477e21f`** (and vice versa) — the test
  asserts a build behaviour that the build code doesn't ship until
  PR-3 lands. Mutually-dependent commits MUST be in the same PR.

---

## Open questions for the user before opening any PR

1. PR-3 bg-sync commit — confirm `b6d41569` substitutes for
   `b4c514ad` (per UPSTREAM-PRS) before audit signs off PR-3.
2. PR-4 reordering — confirm willingness to land PR-5 first (per
   `0d94b966`'s own commit msg dependency).
3. PR-7 `188fe54f`+`7f82339d` co-ship — confirm the gate fix from
   `7f82339d` will be folded into PR-7 (currently mis-listed
   under PR-4).
4. PR-8 — Custom Field strategy: ship fixture (a) or move to
   DocType (b)? Decision blocks PR-8.
5. PR-C — Copyright string genericisation: "POSAwesome contributors"
   or "Frappe Technologies"? Decision blocks PR-C.

---

## Citations

Per-file:line references already inline above. Key paths:

- `posawesome/posawesome/api/__init__.py:44-55` (PR-1 import)
- `frontend/vite.config.js`, `frontend/build-manifest.js`,
  `posawesome/www/sw.js`, `posawesome/posawesome/page/posapp/posapp.js`
  (PR-3 entry-hash chain)
- `frontend/tests/buildManifest.spec.ts` (PR-2 misbucketed test)
- `frontend/src/posapp/stores/itemsStore.ts`,
  `frontend/src/posapp/stores/customersStore.ts`,
  `frontend/src/posapp/stores/pricingRulesStore.ts`,
  `frontend/src/posapp/stores/uiStore.ts`,
  `frontend/src/posapp/composables/pos/items/store/useItemsCache.ts`,
  `frontend/src/posapp/composables/pos/items/store/useItemsSearch.ts`,
  `frontend/src/posapp/stores/items/loadItemsRequest.ts` (PR-4 stores)
- `frontend/src/posapp/components/pos/Invoice.vue`,
  `frontend/src/posapp/stores/socketStore.ts`,
  `frontend/src/posapp/components/pos/offers/PosOffers.vue`,
  `frontend/src/posapp/components/pos/offers/PosCoupons.vue`,
  `frontend/src/posapp/components/pos/customer/NewAddress.vue` (PR-5)
- `posawesome/posawesome/api/customers.py:148` (PR-7 new endpoint),
  `frontend/src/posapp/components/pos/invoice_utils/customer.ts`,
  `frontend/src/posapp/components/pos/invoice/invoiceWatchers.ts`,
  `frontend/src/posapp/composables/runtime/useNetworkLifecycle.ts` (PR-7)
- `frontend/src/posapp/services/qzTray.ts`,
  `frontend/src/posapp/components/navbar/QzTrayDialog.vue:305`,
  `frontend/src/posapp/components/pos/shell/Pos.vue` (PR-8)
- `posawesome/posawesome/doctype/pos_telemetry_event/`,
  `posawesome/posawesome/api/telemetry.py`,
  `frontend/src/posapp/utils/telemetry.ts`,
  `frontend/src/posapp/utils/perf.ts` (PR-C)

Fork-reverts:
- `0f5d8a44`, `0bddc50a` (both revert `b4c514ad`)

Upstream parallel commits (referenced for conflict risk):
- `255f88e9` (cart batching), `9af33b58` (detail-refresh),
  `881ba161`/`2247c666`/`9f37d53c` (cart trio),
  `00fcf847`/`3273eca5` (QZ on develop)
