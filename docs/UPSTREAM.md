# Upstream reconciliation ledger — defendicon/POS-Awesome-V15

Rolling record of upstream triage so we never re-review or re-cherry-pick a
commit range twice. **Update the marker after every reconciliation session.**

## Reviewed-up-to marker

| Field | Value |
|---|---|
| **Reviewed up to (upstream/develop)** | `cc8dcaea` — Merge PR #3109 retailmind-release-1.3.0 (2026-07-09) |
| Reviewed on | 2026-07-11 |
| Previous marker | `3dbdf78f` — Release 15.31.0 (2026-06-22), triaged 2026-07-02 (225 commits, 15.29→15.31, CHANGELOG entry) |
| Fork point (merge-base) | `737e993f` — Release 15.29.0 (2026-05-08) |

## How to reconcile (next session)

```bash
git fetch upstream
git log --format="%h %ad %s" --date=short <reviewed-up-to>..upstream/develop
# triage each commit: PICK / ADAPT / HAVE-BETTER / SKIP / EYEBALL
# cherry-pick PICKs with -x (records "cherry picked from commit ..." — that
# marker is how we reconstruct history, never drop it)
# then update the marker table above + append a session section below
```

Verdicts: **PICK** = cherry-pick as-is · **ADAPT** = concept good, reimplement
(our SPA/backend diverged) · **HAVE-BETTER** = our fork already covers it ·
**SKIP** = feature we don't use / noise · **EYEBALL** = Marco decides.

Notes that keep triage honest:
- Our Vue SPA is rebuilt (RecycleScroller, Pinia shallowRef, own offline/) —
  upstream frontend diffs almost never apply; judge the concept.
- Upstream merges its own fork branches (retailmind etc.) → duplicate
  commits with different SHAs; triage by subject once.
- Historical audits: `AUDIT.md` (vs b5992f70, 2026-05-11), CHANGELOG
  2026-07-02 entry (15.29→15.31 triage, PRs #2–#6).

## Session 2026-07-11 — 3dbdf78f → cc8dcaea (72 commits, ~54 unique non-merge)

Triaged by 3 parallel read-only agents (money-paths / printing-platform /
frontend-UX), verdicts grounded in diff-vs-our-tree comparison. Nothing
cherry-picked yet — this table IS the review; pick session pending Marco.

### PICK — apply (near-)clean, ranked

**PICKED 2026-07-11 (same day, lab-verified):** all rows below except
`86b1b5f0` (rides the f78d2d0d keyboard-core ADAPT) landed as
`6a16580c`..`b5305fbb` — 8ce1752c→`6a16580c` (backend hunk), f41fc415→
`1bb43876` (backend hunk), 9aa0dde0→`936dff13`, fb44f74d→`c5206a1e`,
1e4f2a02→`6363102a`, d1942886→`8e27b67a`, e2385917→`3feebd6b` (+`b5305fbb`
keeps our no-drafts-no-surface contract, dropped their pre-fetch drawer
open), 9df5c4f8→`bbff9fa2`. Verified: vitest 586/586, vue-tsc, vite build,
bench tests both apps on doco-mirror.lab, dev-refresh deployed. Their
`posawesome-enhancements.md` doc kept deleted. Prod: rides next
posawesome-push-prod + rebake.

| SHA | What | Why us |
|---|---|---|
| `8ce1752c` (backend hunk only) | server-side `_validate_credit_sale_allowed` in submit_invoice | **Security**: our `assert_payments_match_grand_total` skips the invariant on client-sent `is_credit_sale=1`; `posa_allow_credit_sale` only gates the UI. 17 lines. |
| `9aa0dde0` | partial multi-batch return row matching by reference | Our `invoice_utils/validation.ts:81` is the exact pre-fix shape (first-match by item_code → false rejects); refs already populated by our Returns.vue. Returns = daily. |
| `f41fc415` (backend hunk only) | strip client freebies without `auto_free_source` marker | Our `_strip_client_freebies_from_payload` misses unmarked pricing-rule freebies → server re-applies → `_deduplicate_free_items` SUMS qty = double freebie. 4 lines. |
| `fb44f74d` | guard optional-field `set_query` in pos_profile.js | Same unguarded calls in ours; Desk form breaks on tenants with lagging fixtures. Multi-tenant win. |
| `1e4f2a02` | hide offline-cache warnings while online | Shared `bootstrapWarningVisibility.ts`, ours lacks `onlineReady` gate — stale offline warnings show while server reachable. |
| `e2385917` | keyboard control for saved-drafts drawer | `ParkedOrdersList.vue` drift == exactly this commit → near-clean + spec. |
| `d1942886` | keep user-selected catalog columns visible | `useItemsTableResponsive.ts` 10-liner, clean. |
| `9df5c4f8` (adapt hunks) | "Refresh Offline Data" actually re-pulls catalog + forces pricing | Our `DefaultLayout.handleRefreshOfflineData` never refreshes the product catalog; `itemsStore.refreshItems` already exists to call. |
| `86b5b1f0`→`86b1b5f0` | arrow nav from cashier inputs | 34 lines on keyboardNavigation.ts — free once f78d2d0d lands. |

### ADAPT — concept yes, reimplement on our tree

| SHA(s) | What | Notes |
|---|---|---|
| `c988133c`+`cbb684c1`+`7d74d02e` (squash) | customer-credit redemption totals in closing shift + print fields | Daily-used feature, zero credit refs in our `closing_processing/overview.py`; backend ports easy, ShiftOverview UI re-do. |
| `f78d2d0d` | keyboard navigation core (`utils/keyboardNavigation.ts` 253 lines + specs pick clean; component wiring manual) | Biggest cashier speed win. |
| `08b5d170`+`118c8246` | print by server-assigned name in immediate print branch | Our `Payments.vue:614`/`usePaymentPrinting.ts:109` use client `doc.name` → SO/amended invoices print stale name. ~10 lines. |
| `df519349` | focus qty after adding item | No post-add focus in ours; port by hand. |
| `bf150918` | cart field focus flow | `cartFieldFocus.ts` near-clean; Pos.vue hunks manual. |
| `f16ab0be` | pricing-rule `min_amt`/`max_amt`/`max_qty` support | Our engine has min_qty only; insurance before someone configures an amount-threshold rule. |
| `699e7b6b`/`31167649` (concept) | visible toast/confirm when QZ print falls back to browser | Our fallback is silent today; ~15 lines in our catch paths. |

### EYEBALL — Marco decides

| SHA | What |
|---|---|
| `ae2e8ec7` | invoice optional column toggles — 159 lines on drifted Invoice.vue; may not map to our cart UI |
| `aa10090d` | cache-capacity alert suppression — verify our fork even fires the noisy boot alert first |
| `a71c06d7` | only the `bootstrapSnapshot.ts` "Missing prerequisites" diagnostics hunk applies (5 lines) |

### HAVE-BETTER / SKIP (do not revisit)

- `6647b30e` legacy free lines (our `auto_free_source` keying already survives), `afc09679` QZ payload (ours uses `command/hex`, safer than their `plain`), `ed110165` printer persist (ours resolves + validates pinned printer), `fe4c14b1`/`3a5a26a5` lazy imports (we pre-import eagerly, proven), `4fb9eee3` fast counter search (1.6k lines vs our instant server search + barcode indexes).
- `1ed2becd`+`81e5bb12` raw ESC/POS printing subsystem — different arch from our raster+raw-cut pipeline; NOT picked, but note telemetry shows `qz_print` p50 1.9s (send 1.6s = raster payload) — if we ever chase print latency, revisit as inspiration, not cherry-pick.
- `1d898563`/`57511df5`/`25a74f84` tax_contracts module (we don't have it; our inline `posa_tax_inclusive` contract verified on prod; revisit if SO→invoice from POS gets enabled).
- Loyalty chain `962d6deb`/`01613ce5`/`d477935f` (no loyalty program on tenants; re-triage if enabled).
- Purchase-order module block `356168dd`..`a32ab643` + `9479b209` (POS purchasing unused).
- `f2b241b2`/`edb3b4f8` lockfile, `edf109ff`/`245f296c` docker docs, `bd115952`/`274e932f` eslint config.

Upstream's `posawesome-enhancements.md` = their running feature log — skim it first in future recons.
