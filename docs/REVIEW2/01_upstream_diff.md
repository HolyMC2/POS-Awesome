# 01 — Upstream Diff Strategy

> Snapshot 2026-05-18 · branch `doco-customizations` @ `968d8c04` vs
> `upstream/develop` @ `45eb528e` (15.29.1 release).
> Merge-base: `737e993f` (2026-05-03 era).
> Counts: ours +91 unique patches (93 commits − 2 merge), upstream +31.

Companion docs already on disk: `ARCHITECTURE.md`, `AUDIT.md`,
`3-SIGMA.md`, `3-SIGMA-PHASE-5-AUDIT.md`, `POSAWESOME-ROADMAP.md`,
`REGROUPED.md`. This doc supersedes the upstream-comparison section of
`AUDIT.md` and extends it past commit `b5992f70` to current
`upstream/develop`.

---

## 1. Executive Summary

Three months of divergence have produced a clean split:
**our fork owns reliability** (telemetry foundation, web-route shell
bypass, store de-deepening, watcher hygiene, hashed bundles, SW
versioning, 532-test vitest gate, /posapp Playwright smoke);
**upstream owns business-logic depth** (multi-currency payment
precision, RTL pay sidebar, change-payment overpayment rules,
exchange gain/loss accounting, payment-printing dedup, qty-edit
offer re-evaluation, item-sync batching).

**Pull**: every upstream payment/printing/offer commit — they are net
new behaviour, low conflict, ship to all our customers. **Push**:
package our perf/observability work as 8 PRs against
`stage-develop`; the 23-commit perf set + Phase 0/1 web-route
foundation are upstream-worthy and unambiguous wins. **Replace**:
upstream's cart-perf trio (`1000e283`/`881ba161`/`2247c666`) targets
the same hot path we rewrote in `39dfa4df` (native cart table) +
the shallow-ref / watcher-hygiene group — keep ours, drop theirs on
overlapping lines, but cherry-pick their `cartLargeInvoicePerformance`
test as a regression net. **Diverge**: telemetry doctype
(`POS Telemetry Event`), `/posapp` web route, `frappe-shim.ts`,
`POS Awesome Supervisor` role (we use Frappe permissions, not a new
role), Phase 8 dashboard split, and anything tagged `doco-` stays
fork-only until we have customer demand to upstream them. Sequence:
land upstream/develop first via merge (conflicts ≤6 files), defer
`refactoring-repo-architecture-structure` until it lands in
`stage-develop` upstream, then ship our PRs in dependency order
(A→C→D→E→F→G→H→I → web-route → telemetry).

---

## 2. Table A — OUR 91 commits

Cat key: P=perf, F=feat, X=fix, S=security, D=doco/infra, T=test,
M=docs. Conflict-risk vs upstream parallel work (low/med/high) is per
file footprint overlap with upstream's 31. PR-worthy: yes / no
(fork-only) / maybe (needs cleanup).

| Hash | Subject | Cat | PR? | Conflict | Notes |
|---|---|---|---|---|---|
| `968d8c04` | chore: ignore .claude-flow tool cache dirs | D | no | low | local tooling |
| `48a87102` | fix(qz): telemetry capture for QZ Tray print failures | X | maybe | low | depends on our telemetry doctype |
| `fa6f90e8` | fix(types): printerName?: string in printViaQz | X | yes | low | trivial type fix |
| `fc428f4b` | Merge fork branch | — | no | — | merge commit |
| `0efb72a9` | Merge track/upstream-develop | — | no | — | merge commit |
| `8e3e928e` | fix(items): hide-unavailable filter must skip non-stock items | X | yes | low | duplicate of `26cd3c86` post-merge |
| `6edb8a2d` | fix(invoice): PAY button above the fold + tighter action grid | F | yes | med | overlaps upstream `3f2136e7` PayView |
| `3c46dff0` | fix(items): catalog Name column wider + instant server search on typing | F | yes | low | items selector polish |
| `96386e5d` | fix(cart): explicit cart column widths + fixed table-layout | P | yes | high | bundled with our native cart table (Phase 2) |
| `570a3a74` | fix(cache): coalesce persist + bulk UOMs (30s freeze RC) | P | yes | low | useItemsCache new behaviour |
| `cc6f36de` | fix(items): safety cap + phase timings to prevent mass-load OOM | P | yes | low | itemsStore guards |
| `9f4edcbb` | perf(pricing,items): instrument phase timings on freeze hot paths | P | yes | low | observability |
| `880d5eae` | perf(pricing): empty-cart fast path + bump debounce 150→350ms | P | yes | med | useInvoiceOffers — upstream touches same file (`7a64031e`, `be5056e5`, `1000e283`) |
| `c2c78ebc` | fix(items): lean search accept term override | X | yes | low | follow-up to `ade09ea1` |
| `09f6e04c` | fix(items): catalog scroller min-height + search during bg sync | X | yes | low | UI polish |
| `4b9f2e10` | fix(items): page-mode boolean + harden search focus guard | X | yes | low | |
| `a0b6a3a3` | fix(items): read search_input + polish header | X | yes | low | |
| `f853fbb2` | perf(items): RecycleScroller replaces v-data-table-virtual | P | yes | med | catalog table swap; touches ItemsSelector.vue (upstream `4c630bc8` also edits it) |
| `c91686ce` | fix(web-route): substitute {N} placeholders in shim __() | D | no | low | shim-only (fork-only feature) |
| `5a1a13fc` | fix(sw): register at /sw.js?v=<build> | P | yes | low | SW version param |
| `ffb4e67d` | Revert "perf(items): enable search debounce + cap" | — | no | — | revert pair |
| `3a9c15de` | perf(items): enable search debounce + cap results at 200 | P | no | — | reverted by `ffb4e67d` |
| `0dbb7e92` | docs: CATALOG-FREEZE.md | M | maybe | low | open issue doc |
| `0bddc50a` | Revert "fix(build): bundle version drift + SW staleness" | — | no | — | revert pair |
| `b4c514ad` | fix(build): bundle version drift + SW staleness | P | no | — | reverted; superseded by `d477e21f` |
| `25dbb58f` | Phase 3 (partial): catalog search Worker behind flag | P | maybe | med | feature-flagged worker; not production-on |
| `865a0900` | Phase 6 (partial): Redis cache for get_active_pricing_rules | P | yes | low | backend api/pricing_rules |
| `3d469739` | feat(reports): per-panel skeletons for Phase 8 section state | F | yes | med | depends on `a993826b` |
| `a6a91eb3` | docs(3-SIGMA): mark Phase 7+8 landed | M | no | low | doc-only |
| `a993826b` | Phase 8: split dashboard payload into per-section endpoints | F | yes | low | api/dashboard refactor |
| `b2553bd0` | docs(3-SIGMA): Phase 5 audit | M | no | low | doc-only |
| `d56befd8` | Phase 7: CI matrix runs smoke at /app/posapp + /posapp | T | maybe | low | half fork-only (web-route leg) |
| `4d519407` | docs(3-SIGMA): mark Phase 2 + 1.H landed | M | no | low | doc-only |
| `39dfa4df` | Phase 2 + 1.H: native cart table + auto-refresh drafts | P | yes | **high** | direct conflict w/ upstream `a0438043`, `1000e283`, `881ba161` |
| `ce7aa47e` | Phase 1.E + 1.F: posa_use_web_route flag + Desk redirect | D | no | low | fork-only feature |
| `f14e7010` | Phase 1.G: service worker precache for /posapp | D | no | low | fork-only feature |
| `ce7b1cdd` | test(smoke): locators + auth modes — 8 tests pass | T | maybe | low | half fork-only |
| `35e1acf3` | test(smoke): /posapp web-route e2e spec | T | no | low | fork-only |
| `4f70f958` | fix(web-route,telemetry): manual smoke fixes | D | no | low | fork-only |
| `6e83e02d` | fix(web-route): make /posapp boot end-to-end | D | no | low | fork-only |
| `b827243f` | feat(web-route): web-entry.ts + Vite input + version.json | D | no | low | fork-only |
| `9cce3144` | feat(web-route): frappe-shim.ts (window.frappe surface) | D | no | low | fork-only |
| `cc180855` | feat(web-route): /posapp Frappe web route foundation | D | no | low | fork-only |
| `398539c1` | feat(telemetry): frontend RUM client + withPerf hook | D | maybe | low | needs doctype + dashboard before PR-worthy |
| `6b22d002` | feat(telemetry): ingest + summary endpoints + scheduler | D | maybe | low | depends on doctype |
| `3fd64a85` | feat(telemetry): POS Telemetry Event doctype | D | maybe | low | new doctype, fork-only until PR |
| `d25973d6` | docs: REGROUPED.md + 3-SIGMA.md | M | no | low | doc-only |
| `8eb19103` | fix(search): bound _lastSearchServerRetryByTerm at 100 | P | yes | low | audit follow-up |
| `c9789db6` | fix(pricing-rules): markRaw inverted index Maps | P | yes | low | audit follow-up |
| `786d0a91` | fix(items): generation-id guard on chunked applyPriceListToItems | P | yes | low | audit follow-up |
| `345a59c1` | fix(pricing): timeout the server fire-and-forget guard (5s) | P | yes | med | useItemAddition — upstream `1000e283`, `9f37d53c` touch siblings |
| `d794f191` | docs: AUDIT.md | M | no | low | doc-only |
| `6f1f6296` | refactor: Safe startup and bundle performance (cherry-pick) | P | no | — | already upstream as `b5992f70` |
| `f1cbef7d` | docs: ARCHITECTURE.md | M | no | low | doc-only |
| `031c1c56` | chore(scripts): heap-snapshot triage tools | D | maybe | low | new top-level `scripts/` |
| `5aa38110` | chore(deps): vuetify 3.7.5 → 3.12.6 | P | yes | low | yarn.lock churn |
| `8cc9a311` | perf(items): drop per-search JSON.parse(stringify(posProfile)) | P | yes | low | loadItemsRequest.ts |
| `6e9d7222` | fix(import): pre-import pricing_rules — Py3.14 ModuleLock | X | yes | low | api/__init__.py |
| `40407fee` | perf(customers): drop dropdown cap to 50 | P | yes | low | customersStore.ts |
| `539d8654` | perf(ui): shallowRef 5 array refs (offers/drafts/parked/orders) | P | yes | low | uiStore.ts |
| `5006a5b5` | perf: batch-drop deep:true from 9 hot watchers | P | yes | med | touches `useInvoiceOffers.ts` which upstream rewrites |
| `dc0518f4` | perf(invoice): drop deep:true from posProfile + offers watchers | P | yes | low | Invoice.vue |
| `47d0ca54` | perf(pricing-rules): shallowRef + markRaw + plain index Maps | P | yes | low | pricingRulesStore.ts |
| `0d94b966` | fix(critical): bound + de-reactify cache (renderer OOM) | P | yes | low | useItemsCache.ts |
| `2977e50c` | fix(critical): eventBus listener cleanup | P | yes | low | PosOffers / PosCoupons / NewAddress |
| `9fee9e46` | fix(critical): socketStore.init double-registration guard | P | yes | low | socketStore.ts |
| `06c1d639` | perf(items): shallowRef itemsMap + barcodeIndex | P | yes | low | useItemsSearch.ts |
| `7f82339d` | fix(critical): pricing flicker, customers shallowRef, fallback gate | P | yes | low | multi-store |
| `8f3a87e5` | perf(items): shallowRef + markRaw catalog | P | yes | low | itemsStore.ts |
| `4607145e` | fix(search): drop cacheEmpty gate; per-term cooldown | P | yes | low | useItemsSelectorSearch.ts |
| `0d652a8f` | fix(critical): customer-change + flush + dropdown cap | P | yes | low | customer.ts + customersStore |
| `96e91137` | fix(critical): add-to-cart no longer blocks on pricing | P | yes | **high** | useItemAddition.ts — upstream `1000e283`, `881ba161` rewrite same file |
| `ade09ea1` | fix(critical): lean server-side search fallback | P | yes | low | useItemsIntegration + loadItemsRequest |
| `7bbbea2c` | fix(critical): chunk applyPriceListToItems | P | yes | low | itemsStore.ts |
| `188fe54f` | fix(critical): customer/items freeze (foreign price list) | P | yes | med | invoiceWatchers + new search_customers endpoint |
| `2694d8dc` | test(build-manifest): update spec for hashed entry contract | T | yes | low | trivial |
| `4a5d39ae` | perf: Tier 0 cleanups — dead branches, idle polling | P | yes | low | broad cleanup |
| `d477e21f` | perf(build): hash entry filenames | P | yes | low | build-manifest + vite.config |
| `78750236` | fix(realtime): seed serverOnline from current socket state | X | yes | low | useNetworkLifecycle.ts |
| `5c0475f5` | fix(items): guard vm.displayedItems access in enter_event | X | yes | low | trivial |
| `851e80f4` | feat(diag): in-page perf badge for low-end-device triage | F | maybe | low | nice-to-have; opt-in flag |
| `6ea73016` | perf(items): code-split + lazy-mount heavy dialogs | P | yes | low | Pos.vue |
| `deca7686` | perf(items): server fallback for cache-miss searches | P | yes | low | search path |
| `b6d41569` | perf(items): pause background item sync while tab hidden | P | yes | med | useItemSync — upstream `9af33b58`, `255f88e9` rewrite same file |
| `1d0ff2cf` | ci: remove ci.yml — keeps failing on bench install | D | no | low | CI-only |
| `40047764` | docs: NOTES.md — open POSAwesome scanner issues | M | no | low | doc-only |
| `6a17091b` | fix(scanner): self-heal scanner lock on dialog close | X | yes | low | camera scanner |
| `26cd3c86` | fix(items): hide-unavailable filter skip non-stock | X | yes | low | duplicate filed twice (`8e3e928e`); squash before PR |
| `660ec6f8` | feat: pre-warm QZ Tray when POS Profile has silent_print | F | yes | low | QZ Tray |
| `b9db3616` | fix: inset QZ Tray print body by 4mm | X | yes | low | QZ Tray |
| `30e39cc7` | fix: pin QZ Tray print viewport to printer width | X | yes | low | QZ Tray |
| `6aa28fbd` | feat: inline letterhead images as base64 for QZ Tray | F | yes | low | QZ Tray |
| `9ce815b7` | feat: pass posa_qz_printer_name from POS Profile | F | yes | low | QZ Tray |

Counts: 41 P, 9 F, 13 X, 0 S, 18 D, 4 T, 8 M (after de-dup of merges
+ reverts). Net PR-worthy: ~58 commits across 8 PRs (see §6).

---

## 3. Table B — UPSTREAM 31 missing commits

Branch-origin abbreviations: `sd`=stage-develop merges,
`fix-api-docs`=fix-api-docs-generating, `mcp-prec`=Manaa0-0
fix/multi-currency-payment-precision. Action codes: CP=cherry-pick
clean, M=accept-on-merge, R=replace-with-ours, S=skip, B=blend.

| Hash | Subject | Branch | Action | Risk | Prereq |
|---|---|---|---|---|---|
| `45eb528e` | Release: 15.29.1 — 2026-05-16 | develop | S | low | skip release marker |
| `6f6c5095` | docs: update generated API reference [skip ci] | develop | M | low | auto-regen on our build |
| `a9b3af2f` | Merge #3021 stage-develop | merge | S | low | merge commit |
| `21bc3e51` | Merge #3022 fix-api-docs-generating | merge | S | low | merge commit |
| `a0438043` | triggerUpdateTotals + CartItemRow log guard + console.log cleanup | fix-api-docs | **B** | **high** | overlaps our `39dfa4df`, `96e91137` |
| `e0d3042a` | Merge #3020 | merge | S | low | merge |
| `cf6a6cb4` | exchange gain loss + promise.all in pospay + minor bugs | fix-api-docs | CP | med | depends on `3f2136e7` chain |
| `e2ee968d` | test: pospay mock rtl composable in pay totals sidebar tests | sd | CP | low | depends on `dae4286a` |
| `3e5828d8` | Merge #3015 mcp-precision | merge | S | low | merge |
| `f5daeeed` | fix: prevent negative remaining amount on overpaid sales | mcp-prec | CP | low | independent payment fix |
| `b9544e06` | fix: skip change payment entry when cash tender returns change | mcp-prec | CP | low | api/invoice_processing/payment.py — disjoint from ours |
| `df8c3f16` | fix: allow split payment overpayments to calculate change | mcp-prec | CP | low | independent |
| `dae4286a` | fix: RTL support & UI improvements for pay sidebar | mcp-prec | CP | med | PayTotalsSidebar.vue — we have no patches here, accept |
| `4fbc375e` | doxs: pos profile in related docs | sd | M | low | doc-only |
| `255f88e9` | fix: Speed up background item sync batching | sd | **B** | med | overlaps our `b6d41569`; useItemsSync.ts |
| `19bad71d` | docs: add agent file and docs files for codex | sd | M | low | tooling-doc |
| `9af33b58` | fix: Optimize background item sync detail refresh | sd | **B** | med | overlaps our `b6d41569`; useItemSync.ts |
| `00fcf847` | fix: print in-page when new tab printing disabled | sd | CP | low | usePaymentPrinting.ts — disjoint from ours |
| `3273eca5` | fix: prevent duplicate browser print prompts | sd | CP | low | usePaymentPrinting.ts |
| `7a64031e` | fix: re-evaluate offers and pricing rules after qty edits | sd | CP | med | useInvoiceItems.ts — adjacent to our `880d5eae` |
| `be5056e5` | fix: sync active sale totals after offers and pricing rules | sd | CP | med | item_updates.ts + pricing.ts + useInvoiceOffers — overlaps our `5006a5b5` |
| `658ec0bb` | fix: update item amounts/totals during rapid cart merges | sd | CP | med | invoiceStore.ts (178±)/useDiscounts/useStockUtils |
| `9f37d53c` | fix: merge cache builds stable invoiceStore.itemOrder | sd | **B** | med | useItemMerging + useItemAddition — overlaps our `96e91137` |
| `2247c666` | fix: remove deep item-map watcher | sd | **R** | med | conceptual overlap with our entire watcher-hygiene set (D group) |
| `881ba161` | fix: cart performance + incremental qty/totals addition | sd | **B** | **high** | invoiceStore.ts (208±) — our `39dfa4df` rewrote ItemsTable, conflicts on store side |
| `1000e283` | refactor: improve cart item addition performance | sd | **B** | **high** | useInvoiceOffers + useItemMerging + useItemAddition — direct conflict w/ our `96e91137`, `5006a5b5` |
| `4c630bc8` | fix: get item call on price list change | sd | CP | med | ItemsSelector + useItemsSelectorPriceListSync; our `f853fbb2` rewrote ItemsSelector |
| `51f18d68` | fix: improve payment UI | sd | CP | low | PayInvoicesTable + PayTotalsSidebar; we have no patches |
| `b3e64151` | fix: multi-currency payment precision and display | mcp-prec | CP | med | PayView + PayTotalsSidebar + usePosPaySubmission + payment_processing |
| `3a2db227` | fix: multi-currency payment precision and display | mcp-prec | CP | med | dup-subject partial of `b3e64151` |
| `3f2136e7` | fix: multi-currency payment mode selection + UI | mcp-prec | CP | med | first of the payment chain — adopt before the others |

Net: **22 cherry-pickable directly** (payments, prints, RTL,
docs, gain/loss, qty re-evals), **6 blend/replace** (cart-perf
trio + sync + totals), **3 skip** (merges + release marker),
**0 hard reject**.

---

## 4. Overlap analysis (hotspots)

### 4.1 Cart performance — upstream cart trio vs our 23 perf commits

Upstream's `4c630bc8 → 1000e283 → 881ba161 → 2247c666 → 9f37d53c`
chain is their answer to the same cart-edit latency / freeze
problem our `188fe54f → 7bbbea2c → 96e91137 → 8f3a87e5 → 06c1d639
→ 47d0ca54 → 5006a5b5 → dc0518f4` chain solved.

| Topic | Their commit | Our equivalent | Recommendation |
|---|---|---|---|
| Item-map watcher depth | `2247c666` "remove deep item-map watcher" | `5006a5b5` (drop deep:true from 9 watchers) + `dc0518f4` (Invoice.vue) + `8f3a87e5` (shallowRef catalog) | **keep-ours**: ours is the structural fix; theirs is a single watcher patch with the same intent. Already covered. |
| Cart-row totals recompute | `881ba161` + `658ec0bb` "incremental qty/totals" — adds a totals-bookkeeping path in invoiceStore | our `39dfa4df` rewrote `ItemsTable.vue` to a native table (cart has 10 rows max so virtualisation gone); pricing path untouched | **blend**: their incremental-totals work on `invoiceStore.ts:items/itemOrder` is a different layer and is genuinely useful. Take their invoiceStore deltas, drop the CartItemRow.vue / items-table-styles.css edits (we own that file now via Phase 2). |
| Cart pricing serialised on server pricing rules | `1000e283` "improve cart item addition performance" — fixes the same useItemAddition.ts hot path | our `96e91137` "add-to-cart no longer blocks on server pricing rules" | **keep-ours**: ours is the bigger functional fix (fire-and-forget the server pricing pass entirely). Theirs touches CartItemRow.vue + items-table-styles.css + useInvoiceOffers + tests. Take their tests (`cartLargeInvoicePerformance.spec.ts`, `useItemAddition.spec.ts`), discard the runtime edits on overlapping lines. |
| Item merge stability | `9f37d53c` "merge cache builds stable itemOrder + itemsData" — adds 44 lines to `useItemMerging.ts` | we don't touch `useItemMerging.ts` | **take-theirs**: pure additive on a file we never modified. CP clean. |
| Get-item on price-list change | `4c630bc8` removes 1 stray call in `ItemsSelector.vue` + `useItemsSelectorPriceListSync.ts` | our `f853fbb2` rewrote `ItemsSelector.vue` template (RecycleScroller) but kept the script section intact | **blend**: their 1-line script removal can be re-applied on top of ours by hand. Take the `itemsStoreLoadItems.spec.ts` + `useItemsSelectorPriceListSync.spec.ts` additions wholesale. |
| triggerUpdateTotals metadata refresh | `a0438043` "triggerUpdateTotals touches metadata after recomputing totals" | our `39dfa4df` doesn't have this concept | **take-theirs (mostly)**: cherry-pick the `useDiscounts.ts` + `invoiceStore.ts` + tests pieces. Skip the CartItemRow.vue 11-line console.log removal (we already cleaned that in Phase 2). Skip the `payment_processing/creation.py` 6-line fix unless we're also taking the payment chain. |

### 4.2 Item sync — upstream sync optimisation vs our background-sync pause

| Topic | Their commit | Our equivalent | Recommendation |
|---|---|---|---|
| Sync batching speed | `255f88e9` — useItemsSync.ts (+23 lines, batching cadence + 93-line test) | our `b6d41569` pauses sync entirely when tab hidden | **blend**: orthogonal. Pause-when-hidden + faster-when-active is the right combined behaviour. CP `255f88e9` and rebase our 18-line `b6d41569` delta on top. |
| Detail refresh optimisation | `9af33b58` — useItemSync.ts (+61 lines, 70-line test) | our `b6d41569` (touched useItemSync.ts for hidden-tab guard) | **blend**: theirs is the bigger structural change. Take theirs as base, re-apply our hidden-tab guard. |

### 4.3 Pricing & offers re-eval

| Topic | Their commit | Our equivalent | Recommendation |
|---|---|---|---|
| Re-eval offers/pricing after qty edits | `7a64031e` | our `880d5eae` (empty-cart fast path + debounce 150→350ms) | **blend, take-theirs**: orthogonal — ours debounces, theirs adds the re-eval trigger. Both belong. |
| Sync totals after offers | `be5056e5` | partially overlaps our `5006a5b5` (drop deep:true on useInvoiceOffers watcher) | **blend, careful**: take their pricing.ts + item_updates.ts deltas, reconcile useInvoiceOffers.ts manually (their +19 lines vs our 1-line watcher edit). |

### 4.4 Payments — pure take-theirs

The entire payment chain (`3f2136e7 → b3e64151 → 3a2db227 →
dae4286a → df8c3f16 → b9544e06 → f5daeeed → cf6a6cb4 → e2ee968d →
51f18d68 → a0438043(payments part)`) is **net-new** for us:

- We never touched `frontend/src/posapp/components/pos_pay/`
- We never touched `frontend/src/posapp/components/pos/shell/PayView.vue`
- We never touched `posawesome/posawesome/api/payment_processing/`
- We never touched `posawesome/posawesome/api/invoice_processing/payment.py`

So 11 of upstream's 31 commits cherry-pick clean. This is the
fastest win in the merge.

### 4.5 Printing — pure take-theirs

`00fcf847` + `3273eca5` touch `usePaymentPrinting.ts`. Our QZ Tray
commits (`9ce815b7..660ec6f8`) live in
`frontend/src/posapp/composables/pos/payments/usePrinter.ts` (or
similar separate path — verify on merge). Disjoint files; cherry-pick
clean.

---

## 5. `refactoring-repo-architecture-structure` analysis

Branch HEAD `d115eeee`, ahead of `upstream/develop` by 25 commits,
**not** merged into `stage-develop` or `develop` yet.

Footprint (25 commits, +2546/-904 across 39 files):

- **Security fixes** that *should* land upstream soon — possibly
  before our next sync:
  - `127207ca` v-html XSS in `Customer.vue`
  - `fab0bb74` v-html XSS in `frontend` (broader sweep)
  - `77443101` memory leak in `newaddress.vue`
  - `c805f8a0`/`3c6c75e3`/`359c0a74` POS profile write authorization
    helper + customer + purchase API guards
- **Refactor docs** (no runtime cost): `docs/refactor/payview-split-plan.md`,
  `docs/refactor/reports-vue-split-plan.md`,
  `docs/audits/stage-develop-code-audit.md`,
  `docs/electron/packaging-audit.md`
- **Runtime touches**:
  - `c47083b9` chore: lint TypeScript with ESLint (large yarn.lock churn)
  - `143ce0bf` fix: route cart item mutations through invoiceStore totals
    (this is the **third** approach to the same itemsTable/invoiceStore
    issue our `39dfa4df` and upstream's `881ba161` already addressed —
    conflict guaranteed)
  - `1323ab67`/`43de8cfe`/`32f53b9f` "itemservice cleanup + fly animation"

### Does it conflict with our `doco-customizations`?

Yes, on three axes:

1. **Cart store**: `143ce0bf` rewrites `invoiceStore.ts` totals flow —
   conflict with our `39dfa4df` (Phase 2 native cart) AND upstream's
   `881ba161` already on develop. Whoever lands last has to triple-merge.
2. **POS Awesome Supervisor role**: `08b9582f`/`beb07715` introduce a
   new role and migrate "POS supervisor" permissions to it. We use
   Frappe Permission Manager directly for our doco scoping
   (laboratorio / mercado / taller) — pulling this in adds a role we
   don't want to maintain. Patch likely needs adaptation per-site.
3. **Customer.vue v-html sweep**: `127207ca` rewrites Customer.vue
   template chunks; this file is a hot path for our /posapp web-route
   smoke tests. Re-run smoke after merge.

### Recommended timing

**After our PR sequence merges, not before.**

Reason: this branch is upstream's own pending PR — they'll merge it
into `stage-develop` and then `develop` on their schedule. If we pull
it now we risk:
- Triple-merging the cart store (our PR2 cart-perf + upstream's
  `881ba161` already on develop + this branch's `143ce0bf`)
- Inheriting the Supervisor role migration without time to map it to
  our doco scoping
- Diverging further from the canonical upstream sequence

**Instead**: file a comment on the upstream PR flagging:
1. The XSS fixes and POS-profile authorization helpers should be split
   into a fast-merge security PR — those we want urgently.
2. The Supervisor role rename + the third cart-totals refactor should
   wait until `881ba161` stabilises.

In our fork: cherry-pick `127207ca` + `fab0bb74` + `77443101` +
`c805f8a0` + `3c6c75e3` + `359c0a74` (security only, ~6 commits) into
a hotfix branch RIGHT NOW since they're CVE-shaped XSS fixes. Don't
take the rest until upstream lands the parent branch.

---

## 6. PR plan back to `stage-develop`

Target: `defendicon/POS-Awesome-V15` `stage-develop` (NOT `develop`
directly — see project_posawesome_fork.md + upstream README).

Each PR branches from a fresh `upstream/stage-develop`, takes the
indicated commits, runs `bench build --app posawesome` + `vitest`
(target 540+/540+) before push. Strict scope per PR — reviewers reject
mixed PRs.

| # | Branch name | Commits (cherry-pick order) | Scope blurb | Expected reaction |
|---|---|---|---|---|
| **PR1** | `fix/python-3.14-module-lock` | `6e9d7222` | One-line Python 3.14 deadlock fix — pre-import `pricing_rules` in `api/__init__.py`. Critical for anyone on F16 main bench. | Merged in <48 h. Trivial, blocking, no debate. |
| **PR2** | `chore/vuetify-3.12.6` | `5aa38110`, `2694d8dc` | Vuetify 3.7.5 → 3.12.6 (gets v-virtual-scroll deep-watch fix from 3.8); update buildManifest test for hashed entries. | Some yarn.lock churn debate. Likely merged after one round. |
| **PR3** | `perf/build-hashed-entries-sw` | `d477e21f`, `5a1a13fc`, `b6d41569` (bg sync hidden-tab guard only, rebased on upstream `255f88e9`/`9af33b58`) | Hash entry filenames → no stale-chunk on deploy; SW version param; pause bg sync when tab hidden. | High value — every upstream user hits the stale-chunk issue. Merged after smoke. |
| **PR4** | `perf/store-de-deepening` | `8f3a87e5`, `06c1d639`, `47d0ca54`, `c9789db6`, `7f82339d`, `0d94b966`, `539d8654`, `40407fee`, `8cc9a311` | The 8-commit shallowRef + markRaw set from REGROUPED.md §C + §K. Largest perf delta. | Will need a long PR description with before/after heap snapshots. Likely lands after 1-2 rounds of review (size makes it daunting). |
| **PR5** | `perf/watcher-listener-hygiene` | `dc0518f4`, `5006a5b5`, `9fee9e46`, `2977e50c`, `8eb19103` | Drop `deep:true` from 14 hot watchers; socketStore double-init guard; listener cleanup. Depends on PR4 conceptually. | Clean merge once PR4 lands. |
| **PR6** | `perf/pricing-fire-and-forget` | `345a59c1`, `4607145e`, `7bbbea2c`, `786d0a91`, `ade09ea1`, `c2c78ebc` | Pricing fire-and-forget with 5s timeout; chunked applyPriceListToItems with gen-id guard; lean search fallback. **NOTE**: needs careful 3-way merge with upstream's `1000e283`/`881ba161`/`9f37d53c` cart trio. | Conflict-heavy review. Worth doing but slowest PR. |
| **PR7** | `fix/customer-flow` | `0d652a8f`, `188fe54f`, `78750236` | `search_customers` whitelisted endpoint; defer `selected_price_list` watcher invalidation; `serverOnline` seed-from-socket-state. | Clean merge. |
| **PR8** | `feat/qz-tray-improvements` | `9ce815b7`, `6aa28fbd`, `30e39cc7`, `b9db3616`, `660ec6f8`, `48a87102` (telemetry hook removed for PR) | QZ Tray hardening: profile-driven printer name, base64 letterhead, viewport pinning, body inset, pre-warm. | Niche but useful — silent merge once Marco confirms. |

Optional / out-of-scope PRs (track in backlog, don't ship now):

| # | Branch | Commits | Why deferred |
|---|---|---|---|
| PR9 | `feat/dashboard-section-split` | `a993826b`, `3d469739` | Touches dashboard API contract — needs upstream signal first. |
| PR10 | `perf/redis-pricing-rules-cache` | `865a0900` | Backend caching — needs ops-side review. |
| PR11 | `fix/scanner-self-heal` | `6a17091b` | Niche; bundle with next QZ/scanner round. |

**Doco-only — DO NOT PR**:

- All 9 web-route commits (`cc180855`, `9cce3144`, `b827243f`,
  `6e83e02d`, `4f70f958`, `c91686ce`, `ce7aa47e`, `f14e7010`,
  `35e1acf3`, `ce7b1cdd`)
- Telemetry doctype + API + frontend client (`3fd64a85`, `6b22d002`,
  `398539c1`) — could be PR'd later once we generalise the schema,
  but right now it's coupled to our dashboards
- `851e80f4` perf badge — opt-in flag is fine for us, upstream won't
  want it on
- `1d0ff2cf` ci.yml removal
- `d56befd8` Phase 7 CI matrix — fork-only because the `/posapp` leg
  doesn't exist upstream
- `40047764`, `0dbb7e92`, `f1cbef7d`, `d794f191`, `d25973d6`,
  `b2553bd0`, `a6a91eb3`, `4d519407` — all docs (3-SIGMA, AUDIT,
  ARCHITECTURE, REGROUPED, NOTES, CATALOG-FREEZE) live in our fork
- The Phase 2 native cart + Phase 1.H drafts (`39dfa4df`,
  `96386e5d`) — too entangled with upstream's parallel cart-perf
  effort; revisit after upstream's `881ba161` matures and we can
  show a clean diff
- Reverts (`0bddc50a`, `ffb4e67d`) and their reverted originals
- The Phase 3 worker `25dbb58f` (flagged-off, not production-on)

---

## 7. Sync sequence

Phase A — pull upstream/develop into our fork:

```bash
cd /home/holymc2/muelle-host/posawesome

# 1. Snapshot current state
git checkout doco-customizations
git tag -a backup/pre-upstream-merge-2026-05-18 -m "pre-merge snapshot"

# 2. Pre-flight: hotfix the XSS / authz cherries from
#    refactoring-repo-architecture-structure ONLY (security urgent)
git checkout -b security/upstream-xss-authz-2026-05
git cherry-pick 127207ca fab0bb74 77443101 c805f8a0 3c6c75e3 359c0a74
# resolve any conflicts manually; run vitest; verify on lab
bench build --app posawesome && \
  npx vitest run --reporter=verbose

# 3. Branch for the develop merge (do not merge on doco-customizations
#    directly — keep a clean review surface)
git checkout doco-customizations
git checkout -b merge/upstream-develop-2026-05-18
git fetch upstream
git merge upstream/develop
# expected conflicts (≤6 files):
#   frontend/src/posapp/composables/pos/items/useItemAddition.ts
#   frontend/src/posapp/components/pos/invoice/CartItemRow.vue (theirs touches lines we deleted in Phase 2)
#   frontend/src/posapp/composables/pos/invoice/useInvoiceOffers.ts
#   frontend/src/posapp/stores/invoiceStore.ts
#   frontend/src/posapp/composables/pos/items/store/useItemsSync.ts
#   frontend/src/posapp/composables/pos/items/useItemSync.ts
# resolution rules (see §4):
#   - cart store + useInvoiceOffers: blend upstream's incremental totals
#     on top of our shallow-ref / debounce work
#   - useItemAddition: keep ours wholesale; take their tests
#   - sync files: take upstream as base, re-apply our hidden-tab guard
#   - CartItemRow.vue: keep ours (Phase 2 native table)

bench build --app posawesome
npx vitest run
# smoke at /app/posapp AND /posapp on lab.xolo before merging back

# 4. Once green:
git checkout doco-customizations
git merge --no-ff merge/upstream-develop-2026-05-18
# push to origin/HolyMC2 only — never to upstream
git push origin doco-customizations
```

Phase B — replay PR-worthy commits onto clean upstream branches:

```bash
# For each PR in §6, work from a clean upstream/stage-develop base:
git fetch upstream
git checkout -b fix/python-3.14-module-lock upstream/stage-develop
git cherry-pick 6e9d7222
# build + test
git push origin fix/python-3.14-module-lock
# Open PR on github.com/defendicon/POS-Awesome-V15 targeting
# stage-develop (not develop).

# Repeat per branch in §6 in order PR1 → PR8.
# Branches do not depend on each other beyond what §6's "depends on"
# column states. The store-de-deepening PR4 must precede PR5 (watcher
# hygiene) and PR6 (pricing fire-and-forget) on the upstream review
# track, but in OUR fork they're already in place.
```

Phase C — defer:

- `refactoring-repo-architecture-structure` remainder (after security
  cherries): wait for upstream to land it in stage-develop. Then
  re-evaluate the Supervisor role + cart-totals refactor against
  whatever state our fork is in.
- Phase 8 dashboard split PR9: open only after PR4 + PR5 + PR6 land.
- Doco-only commits: stay on `doco-customizations` indefinitely.

---

## 8. Risks & unknowns

| Risk | Severity | Mitigation / human call |
|---|---|---|
| Merge of upstream cart trio (`1000e283`/`881ba161`/`9f37d53c`) silently undoes our Phase 2 native cart performance gains | high | Pin a Lighthouse / heap-snapshot baseline NOW (pre-merge). Re-run after merge. If INP regresses on cart edits, revert specific upstream patches and document in a new AUDIT2.md. |
| Upstream's POS Awesome Supervisor role (in refactoring branch, may land in next stage-develop merge) breaks our existing site permissions on ventas.lab.xolo / prod | high | DO NOT install upstream's `recreate_pos_awesome_workspace.py` patch automatically. Diff role bindings before `bench migrate` on any upstream merge. |
| Payment-precision chain (`3f2136e7` → `b3e64151` → `cf6a6cb4`) may interact badly with `erpnext_mexico_compliance`'s CFDI multi-currency handling | high | Test on lab with a multi-currency CFDI invoice flow BEFORE merging. Marco call: do we run CFDI in non-MXN currencies? If yes, full regression. |
| Upstream's `2247c666` (remove deep item-map watcher) targets the same root cause as our `5006a5b5` / `dc0518f4` / `8f3a87e5`; if reviewers don't see the dependency, PR5 will be closed as duplicate | medium | PR4 + PR5 description should explicitly reference `2247c666` and explain why ours is the structural fix. Submit AUDIT.md as supporting doc. |
| Our `188fe54f` introduced `posawesome.posawesome.api.customers.search_customers` — upstream may have introduced (or be about to introduce) the same endpoint name with different signature | medium | Grep upstream/refactoring branch for `def search_customers` before opening PR7. Rename our endpoint if collision exists. |
| `851e80f4` perf badge + `398539c1` RUM client both depend on our telemetry doctype `3fd64a85`. PR-ing the perf badge alone breaks upstream's bench | medium | Bundle telemetry doctype + ingest + RUM together if/when we do submit it. Don't split. |
| Vuetify 3.12.6 (`5aa38110`) churns 222-line yarn.lock — may not apply cleanly to upstream's lockfile state | low | Re-resolve from `package.json` on the PR branch (`yarn install`) rather than carrying our lockfile. |
| `f853fbb2` RecycleScroller replaces `v-data-table-virtual` in ItemsSelector — if upstream's `4c630bc8` script change conflicts on the same file, our PR may not be acceptable without backporting the catalog to v-data-table-virtual | medium | Don't include `f853fbb2` in any upstream PR until we've checked with upstream maintainers that RecycleScroller is acceptable. Keep it fork-only for now. |
| The `/posapp` web route + `frappe-shim.ts` (~470 LOC) is a 9-commit architectural divergence — every upstream change to `Pos.vue` / `loader.ts` / `posapp.js` Page lifecycle may need shim updates | high | Maintain a "shim coverage" checklist in `frontend/src/posapp/utils/frappe-shim.ts` header comment. Each upstream merge: smoke at `/posapp` first, before signing off. |
| MariaDB-MCP, lab.xolo, ventas.prod all run different snapshot stages — a "merged on lab" doesn't mean "safe on prod" | medium | Follow the existing `feedback_dev_testing_flow.md` rule: lab.xolo first, contavm dev only on explicit signal, prod gated by Marco. |
| The 31 missing upstream commits include several `mcp-precision` PRs (`3a2db227` + `b3e64151`) that look like dup-subject patches — we may end up with redundant code paths | low | When cherry-picking the payment chain, take the merged result (i.e., what's on `upstream/develop` HEAD) rather than each PR commit individually; squash if needed. |
| Our doco-customizations branch has no `production` mirror; we can't compare against upstream's `production` branch (released stable) to know if our state matches a known-good upstream tag | medium | Tag `doco-customizations` at major milestones (`doco-2026-05-18-pre-upstream-merge`). Match upstream `production` tag adoption cadence quarterly. |

Open questions for a human call (Marco):

1. **Submit telemetry doctype upstream?** — requires deciding whether
   we want the canonical POS telemetry schema to be upstream-owned
   (good for ecosystem) or doco-owned (faster iteration). Don't
   submit until decided.
2. **Submit `/posapp` web route upstream?** — this is the biggest
   strategic divergence. Pro: huge reliability win for the
   ecosystem. Con: 470 LOC of `frappe.*` shim to maintain forever.
   If upstream rejects, we're stuck maintaining a shim that drifts
   each Frappe minor.
3. **CFDI × multi-currency**: any active customer running CFDI with
   non-MXN tender? If yes, payment-precision chain needs full
   regression. If no, take theirs cleanly.
4. **POS Supervisor role**: replace our Permission Manager scoping
   with upstream's new role when refactoring branch lands? Big
   migration on existing sites if yes.

---

## Appendix — File paths cited

- `/home/holymc2/muelle-host/posawesome/AUDIT.md` (prior fork×upstream reconciliation, b5992f70 era)
- `/home/holymc2/muelle-host/posawesome/3-SIGMA.md` (Phase 0-8 plan, Phase 1+2+1.H+6+7+8 landed)
- `/home/holymc2/muelle-host/posawesome/3-SIGMA-PHASE-5-AUDIT.md` (outbox/idempotency gap)
- `/home/holymc2/muelle-host/posawesome/ARCHITECTURE.md` (system overview, boot sequence)
- `/home/holymc2/muelle-host/posawesome/POSAWESOME-ROADMAP.md` (Tier 0-4 backlog)
- `/home/holymc2/muelle-host/posawesome/REGROUPED.md` (commits by area, cherry-pick plan)
- `/home/holymc2/muelle-host/posawesome/CATALOG-FREEZE.md` (open issue)
- `/home/holymc2/muelle-host/posawesome/NOTES.md` (open scanner issues)
- `/home/holymc2/muelle-host/posawesome/frontend/src/posapp/utils/frappe-shim.ts` (web-route shim)
- `/home/holymc2/muelle-host/posawesome/frontend/src/posapp/composables/pos/items/useItemAddition.ts` (cart hot path — 3-way conflict zone)
- `/home/holymc2/muelle-host/posawesome/frontend/src/posapp/stores/invoiceStore.ts` (cart totals — 3-way conflict zone)
- `/home/holymc2/muelle-host/posawesome/frontend/src/posapp/components/pos/invoice/ItemsTable.vue` (Phase 2 native cart)
- `/home/holymc2/muelle-host/posawesome/posawesome/posawesome/doctype/pos_telemetry_event/` (telemetry doctype, fork-only)
- `/home/holymc2/muelle-host/posawesome/posawesome/www/posapp.py` + `posapp.html` (web route, fork-only)
