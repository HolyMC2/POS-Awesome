# Audit — fork perf branch vs upstream `b5992f70`

> Snapshot 2026-05-11 · branch `track/upstream-develop`

This doc tracks how each commit on our perf branch interacts with upstream's parallel performance work, and ends with the agent-pipeline workflow used to coordinate the analysis.

---

## 1. Audit table

Upstream `b5992f70` ("refactor: Safe startup and bundle performance" from `defendicon/POS-Awesome-V15` `fix-app-performance-issues`) was cherry-picked on top of our 23 perf commits. The cherry-pick produced 3 file conflicts and 17 clean auto-merges. Below is the per-commit reconciliation.

| Hash | Subject | Reconciliation with `b5992f70` |
|---|---|---|
| `188fe54f` | Defer cache invalidation + customer fallback | COMPATIBLE — both touch `invoiceWatchers.ts`, theirs only adds `debugLog` import |
| `7bbbea2c` | Chunked `applyPriceListToItems` | COMPATIBLE — different section of `itemsStore.ts` |
| `ade09ea1` | Lean server-side search fallback | COMPATIBLE — different section of `useItemsIntegration.ts` |
| `96e91137` | Server pricing fire-and-forget + drop console.log | CONFLICT (resolved) — kept their `debugLog(...)` (gated, observability restored), kept our pricing fire-and-forget |
| `0d652a8f` | Customer-change + flush + dropdown cap | COMPATIBLE — `invoice_utils/customer.ts` untouched by them |
| `4607145e` | Search fallback gate | COMPATIBLE — `useItemsSelectorSearch.ts` untouched by them |
| `8f3a87e5` | itemsStore shallowRef + markRaw | COMPATIBLE — different section of `itemsStore.ts` |
| `7f82339d` | Pricing flicker + customer cap + customers shallowRef | COMPATIBLE — `pricing.ts`, `customersStore.ts` untouched |
| `06c1d639` | itemsMap + barcodeIndex shallowRef | COMPATIBLE — `useItemsSearch.ts` untouched by them |
| `9fee9e46` | socketStore.init guard | COMPATIBLE — `socketStore.ts` untouched |
| `2977e50c` | eventBus cleanup PosOffers/PosCoupons/NewAddress | PARTIALLY SUPERSEDED — their refactor removed `eventBus.on("open_new_address")` entirely (replaced with prop-based `openRequest` watcher); our `beforeUnmount{eventBus.off("open_new_address")}` was dead code → removed in the cherry-pick fixup. PosOffers + PosCoupons cleanup still active (those still register listeners). |
| `0d94b966` | Cache bounded + de-reactified | COMPATIBLE — `useItemsCache.ts` untouched |
| `47d0ca54` | Pricing rules shallowRef + plain index Maps | COMPATIBLE — `pricingRulesStore.ts` untouched |
| `dc0518f4` | Drop deep:true on Invoice posProfile + offers watchers | COMPATIBLE — `Invoice.vue` untouched |
| `5006a5b5` | Drop deep:true from 12 hot watchers | COMPATIBLE — disjoint files |
| `539d8654` | uiStore shallowRef on 5 array refs | COMPATIBLE — `uiStore.ts` untouched |
| `40407fee` | Customer dropdown cap 50 | COMPATIBLE — disjoint section of `customersStore.ts` |
| `6e9d7222` | Pre-import pricing_rules in api/__init__ (Py3.14 deadlock fix) | COMPATIBLE — Python-side, untouched by them |
| `8cc9a311` | JSON.parse(JSON.stringify(posProfile)) → shallow spread | COMPATIBLE — `loadItemsRequest.ts` untouched |
| `5aa38110` | Vuetify 3.7.5 → 3.12.6 | COMPATIBLE — `package.json` untouched |
| `031c1c56` | Heap-snapshot triage scripts under `scripts/` | COMPATIBLE — disjoint |
| `f1cbef7d` | ARCHITECTURE.md | COMPATIBLE — new doc |
| `2694d8dc` | Update buildManifest spec for hashed entries | COMPATIBLE — `frontend/tests/buildManifest.spec.ts` untouched |

**Summary**
- 1 file-level conflict resolved (CartItemRow / ItemsSelector / useItemAddition: take their `debugLog`, drop our deletion)
- 1 partial supersession (NewAddress + Mpesa cleanup is dead code post-merge — removed in the same cherry-pick fixup)
- 1 auto-merge artefact (duplicate `const CameraScanner` from both lazy-children + standalone import — deduplicated)
- 21 commits fully compatible

vitest: 532/532 (530 ours + 2 net new from `b5992f70`).

---

## 2. What `b5992f70` actually adds

Net-new behaviour from upstream that we now inherit:

1. **Non-blocking boot** — `loader.ts` defers `runPosBootSync()` to a `setTimeout(…, 0)`. Frappe Desk shell renders before our SPA starts streaming dependencies.
2. **Prop-driven dialog opens** — `NewAddress.vue` / `Mpesa-Payments.vue` / `Returns.vue` (partial) replaced their `eventBus.on("open_…")` registrations in `created()` with a prop watcher (`openRequest: { handler, immediate: true }`). `Pos.vue` now drives the lifecycle via `<NewAddress v-if="newAddressMounted" :open-request="newAddressOpenRequest" />` etc. — listeners go away with the component, no manual `.off` needed.
3. **`utils/debug.ts`** — gated `debugLog()` helper (`localStorage.posa_debug=1` opt-in). Restores observability for triage without runtime cost. Used in CartItemRow, useItemAddition, invoiceWatchers, useStockUtils, usePosShift, etc.
4. **Chunk-load recovery test** + **payment-printing lazy-deps test** — two new vitest specs (`chunkLoadRecovery.spec.ts`, `paymentPrintingLazyDeps.spec.ts`).

Items that DO NOT come from `b5992f70` (still our work):
- All store-level shallowRef + markRaw (catalog / customers / cache / pricing rules / uiStore arrays)
- Drop deep:true from 14 hot watchers
- socketStore double-init guard
- Pricing fire-and-forget bracketing + flicker fix
- Lean server-side search fallback + customer server fallback
- `JSON.parse(JSON.stringify(posProfile))` → shallow spread
- Vuetify 3.12.6 upgrade
- `pricing_rules` pre-import (Py 3.14 deadlock)
- Cache LRU + de-reactification
- Heap-snapshot triage scripts
- ARCHITECTURE.md

---

## 3. What's still pending from upstream

Two more commits sit on `upstream/fix-app-performance-issues` (verdict from `ARCHITECTURE.md` §10):

| Hash | Subject | Verdict | Notes |
|---|---|---|---|
| `8bf5eba7` | Item / customer data architecture | HYBRID (3-way merge) | Keep our shallowRef; cherry-pick their 5 normalized indexes (`itemByCode`, `priceByItemAndPriceList`, `stockByItemAndWarehouse`, `uomConversionByItem`, `itemNameSearchIndex`) + Dexie `startsWithIgnoreCase` token search. ~1 day. |
| `efdaa465` | Cart and pricing performance | DEFER | Novel `CartMutationKind` + per-row totals cache. No file conflict but different mental model from our debounced `recalculateTotals`. Re-evaluate after `8bf5eba7` lands and we run another long test cycle. |

---

## 4. Workflow — coder + reviewer agent pipeline

User asked whether to use a separate Claude Code session for the reviewer. Answer: **same session is better.** Claude Code's `Agent` tool spawns named subagents that can `SendMessage` each other; a single lead session coordinates without cross-tab copy-paste.

### Pattern (from `CLAUDE.md`)

```js
// Spawn both at once, in ONE message, with run_in_background
Agent({
  subagent_type: "coder",
  name: "coder",
  run_in_background: true,
  prompt: `Implement <task>. Touch only <scope>.
           When done: SendMessage to 'reviewer' with:
             - file:line summary of changes
             - vitest pass/fail
             - any concerns you want flagged`,
});

Agent({
  subagent_type: "reviewer",
  name: "reviewer",
  run_in_background: true,
  prompt: `Wait for 'coder'. Review the diff:
             - severity: 🔴 critical / 🟡 high / 🔵 low / ❓ question
             - cite file:line
             - propose fix; do NOT implement
           SendMessage findings back to 'coder'.
           If clean: SendMessage 'approved' to lead.`,
});

// Kick off
SendMessage({ to: "coder", message: "Start. Acknowledge by SendMessage to 'reviewer' when ready." });
```

### When to use a separate session instead

- **Independent verification** of security-sensitive changes (auth, payments, crypto). Lead context can bias the reviewer toward "this is fine because we agreed earlier".
- **Long-running review cycles** that would clog the lead session's context with diff dumps.

### Cavecrew variants (lower-token)

For high-volume review rounds, swap to:
- `cavecrew-builder` instead of `coder` (caveman-compressed diff receipts)
- `cavecrew-reviewer` instead of `reviewer` (one-line-per-finding, severity-tagged)

Output is ~60 % smaller; saves the lead session's context budget.

### Don'ts

- Don't poll `agent_status` — agents `SendMessage` back automatically.
- Don't spawn one at a time — both go in a single message with `run_in_background: true`.
- Don't omit `name:` — without it the agent isn't addressable via `SendMessage`.
- Don't have the lead also do parallel coding work — race conditions on the same files.
