# C — Git Hygiene Audit (Upstream PR Readiness)

**Auditor mode**: angry. **Scope**: 32 commits across 8 PRs targeting
`defendicon/POS-Awesome-V15:stage-develop`. **Verdict in one breath**:
the *code* is mostly shippable; the *git surface* is a parade of
unforced errors that will make a maintainer side-eye us before they
read line one. Fixable. Required. Do this before you open PR1.

Repo: `/home/holymc2/muelle-host/posawesome`
Branch: `doco-customizations`
Upstream: `defendicon/POS-Awesome-V15.git → stage-develop`
DCO: **not required** by upstream (no `CONTRIBUTING.md`, no
`Signed-off-by` enforcement in workflows, no DCO bot configured —
verified `.github/` contents).
Conventional Commits: not enforced by upstream tooling, but every
recent upstream commit on `stage-develop` uses
`fix:` / `feat:` / `chore:` style — we should match.

---

## 0. Global red flags (apply to ALL 32 commits)

These four issues are systemic. Fix once at the rebase, save 32 reword
operations.

### 0.1 Author identity is wrong
Every commit is authored by `Marco <doco.mexico@gmail.com>`. The user's
project-public git identity per memory + GitHub is **`holymc2 /
marcoantonioponcevaldez@gmail.com`**. Two problems:

- `doco.mexico@gmail.com` leaks the business identity ("doco mexico" =
  docomexico = the user's phone-repair business). Reviewers will
  Google the email. We do not want that visible on an open-source PR.
- The fork on GitHub is `HolyMC2/POS-Awesome`. An author email that
  doesn't map to a HolyMC2 GitHub user means the PR commits won't be
  attributed to the contributing GitHub account on the upstream PR
  page — they'll show as an unlinked gravatar.

**Action**: `git rebase --root --exec 'git commit --amend --no-edit
--author="holymc2 <marcoantonioponcevaldez@gmail.com>"'` on the
per-PR branch we cut from `upstream/stage-develop`, not on
`doco-customizations` (don't rewrite our own history).

### 0.2 No GPG signing
`%G?` returns `N` on every commit. Upstream doesn't *require* it,
but signed commits are a free trust signal on first-time-contributor
PRs. **Optional but recommended** — set `commit.gpgsign = true` and
add the GPG key to the holymc2 GitHub account before opening PR1.

### 0.3 Co-Authored-By: Claude inconsistency
Co-author trailers are present on the 5 QZ Tray commits + 48a87102
(`9ce815b7`, `6aa28fbd`, `30e39cc7`, `b9db3616`, `660ec6f8`,
`48a87102`) but **missing on the other 26 commits** — including the
perf series and telemetry series that were also AI-assisted per the
audit context. Two options:

- **Strip them all** (defensible — Claude was a tool, not a co-author).
- **Add them all** (consistency).

Mixing is the worst option because it implies the un-tagged commits
were 100 % human while the tagged ones were AI-assisted — that
framing will not survive a curious reviewer scanning the log. **Pick
one and apply uniformly during the per-PR rebase**.

### 0.4 Committer == Author on every commit
Good. No rebase noise where `cn != an`. No action.

---

## 1. Per-commit verdicts

Legend: 🟢 ship as-is · 🟡 reword/amend before push · 🔴 must
fix/squash/split.
Format: `hash | subject ≤50ch | flag | findings ≤100ch | action`.

### PR-1 — `fix/python-3.14-module-lock`

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| 6e9d7222 | fix(import): pre-import pricing_rules… | 🟡 | subject 90 chars, exceeds 72 limit. body excellent. 1f/+11. clean diff. | **reword** subject only |

Suggested reword:
`fix(api): pre-import pricing_rules to avoid Py3.14 import deadlock`
(64 chars).

**PR-1 verdict**: SINGLE commit, trivial scope, root-cause body is
genuinely instructive. Reword + author-rewrite + ship. This is your
trust-builder PR. **🟢 GO**.

---

### PR-2 — `chore/vuetify-3.12.6`

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| 5aa38110 | chore(deps): bump vuetify 3.7.5 → 3.12.6… | 🟡 | subject 56 chars OK. body mentions "Tier 3" (fork-internal). "Site-change log" section irrelevant to upstream. 2f/+5-5. | **reword body** (strip "Tier 3", strip site-change log) |
| 2694d8dc | test(build-manifest): update spec for hashed entry contract | 🔴 | **wrong PR**. This commit is the test that pairs with PR-3's `d477e21f` (build-hash entries). It is NOT a Vuetify bump dependency. | **move to PR-3** |

**PR-2 verdict**: PR plan in `01_upstream_diff.md` §6 groups
`2694d8dc` under PR2 — that's a planning error. `2694d8dc` body
literally says "Tier 3 (commit d477e21f) made every entry filename
content-hashed" — it's PR3's test. **Reorganise**: PR2 = just
`5aa38110`. Move `2694d8dc` into PR3 right after `d477e21f`. **🟡
REPLAN before push**.

---

### PR-3 — `perf/build-hashed-entries-sw`

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| d477e21f | perf(build): hash entry filenames so deploys… | 🟢 | subject 71 chars (at limit). body is gold — root cause walked + 4 numbered fix points + test plan. 4f/+85-26. | **ship** (after author rewrite) |
| 5a1a13fc | fix(build): bundle version drift + SW staleness… | 🟡 | subject 60 chars OK. body excellent. BUT this commit is two unrelated fixes (version label + SW registration) bundled. PR plan also has `b4c514ad` in PR3. | **consider splitting** + check PR membership |
| b4c514ad | fix(sw): register at /sw.js?v=<build> so deploys… | 🟢 | subject 73 chars (1 over). re-applies half of an earlier reverted commit; body explains *why* the other half stays out. 1f/+15-1. | **reword** to ≤72 |

Wait — PR plan §6 says PR-3 = `d477e21f, 5a1a13fc, b6d41569`. The
task instructions say PR-3 = `d477e21f 5a1a13fc b4c514ad`. The plan
has `b6d41569` (background sync hidden-tab) while the audit task has
`b4c514ad` (SW v=build registration). These are **different commits
solving adjacent problems**.

`5a1a13fc` already contains the SW `v=<build>` registration patch
(verified: stat shows `frontend/src/posapp/posapp.ts | 15 +++++++++-`
matching the body's "Fix: register at `/sw.js?v=<build-version>`").
`b4c514ad` claims to "re-apply the half of 53c68b1d" — i.e. it's a
**redundant re-application** of the SW URL trick already in
`5a1a13fc`. **🔴 CONFLICT**: `5a1a13fc` and `b4c514ad` overlap on
`posapp.ts`. Squashing them is correct; keeping both is git
archaeology a maintainer will flag.

**PR-3 verdict**: **🔴 REWRITE**. Final PR3 contents should be:
1. `d477e21f` (build hashing) — ship.
2. `2694d8dc` (test for hashed entries) — pulled from PR2.
3. Squash of `5a1a13fc` + `b4c514ad` → one commit
   `fix(sw): register at /sw.js?v=<build> to swap SW instance per deploy`
   (drop the version-drift half of `5a1a13fc` — it relies on the
   "-dirty-<sha1>" label the user himself flagged as noise; or keep it
   but document the rationale in the PR description).
4. **Cherry-pick our `b6d41569` (background-sync hidden-tab) rebased
   on upstream's `255f88e9`/`9af33b58`** per the plan — currently NOT
   in the task list. Add it.

---

### PR-4 — `perf/store-de-deepening`

Nine commits, ~252 LOC delta total (calculated below). Largest PR in
the sequence. Will be the slowest review.

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| 8f3a87e5 | perf(items): shallowRef + markRaw for the catalog… | 🟡 | subject 78 chars. body parens "(Tier 3 root-cause fix)" = fork jargon. 1f/+36-18. | **reword** (strip Tier 3) |
| 06c1d639 | perf(items): shallowRef itemsMap + barcodeIndex… | 🟡 | subject 72 chars (at limit). "(Tier 3 follow-up)" jargon. 1f/+11-3. | **reword** |
| 47d0ca54 | perf(pricing-rules): shallowRef + markRaw rules + plain index Maps | 🟢 | subject 66 chars. clean. 1f/+22-9. | **ship** |
| c9789db6 | fix(pricing-rules): markRaw the inverted index Maps | 🟢 | subject 51 chars. body says "Caught by a second-opinion audit pass" → fine. 1f/+7-3. | **ship** |
| 7f82339d | fix(critical): pricing-rule flicker, customers shallowRef, customer fallback gate | 🔴 | subject **82 chars**. **MIXED CONCERN: 3 unrelated fixes** (pricing flicker + customers shallowRef + customer fallback gate). 2f/+59-34. | **split into 3 commits OR reword to feat() with explicit "three independent bugs in same hotfix" framing** |
| 0d94b966 | fix(critical): bound + de-reactify cache to stop renderer OOM | 🟢 | subject 60 chars. body excellent. 1f/+72-30. | **reword** (drop "critical" — upstream doesn't have a "critical" tier; just use `fix(items):`) |
| 539d8654 | perf(ui): shallowRef the 5 array refs (offers/applicableOffers/drafts/parked/orders) | 🔴 | subject **89 chars**. parenthetical name dump pushes over. 1f/+11-6. | **reword** subject |
| 40407fee | perf(customers): drop dropdown cap to 50 | 🟢 | subject 41 chars. body cites internal heap snapshot file name "Heap-20260510T220928" — flavour but fine. 1f/+8-9. | **ship** |
| 8cc9a311 | perf(items): drop per-search JSON.parse(JSON.stringify(posProfile)) | 🟢 | subject 67 chars. body forensic + excellent. 1f/+13-5. | **ship** |

**PR-4 verdict**: 🔴 **MOST WORK TO DO**.

- Strip "Tier 3" from `8f3a87e5`, `06c1d639` subjects/bodies. Upstream
  has never heard of our Tier 3 audit roadmap; the reference is
  meaningless to them and reads as fork-context bleed.
- `fix(critical):` is not a Conventional Commits type. Replace with
  `fix(pricing):`, `fix(customers):`, `fix(items):` etc. per actual
  scope. Reviewers WILL pick on this.
- `7f82339d` is a **mixed-concern grenade**. Three different bugs
  bundled because the operator reported them together. Split:
  - `fix(pricing): keep _applyingPricingRules set across server pass`
  - `fix(customers): shallowRef customers array + markRaw rows`
  - `fix(customers): correct first-page server-fallback gate condition`
- Order matters for review readability: put the shallowRef
  infrastructure commits first (`8f3a87e5`, `06c1d639`, `47d0ca54`,
  `c9789db6`, `539d8654`), then the cache bounding (`0d94b966`,
  `8eb19103`), then the JSON.parse drop (`8cc9a311`), then the
  customer-cap (`40407fee`). The story: "we de-deepened all the hot
  reactive surfaces, then bounded their growth, then trimmed
  payloads." Current order is roughly chronological — fine but not
  optimal.
- After the split + reword + reorder, PR4 is **11 commits**. That's
  on the high end for a single PR. Consider splitting into:
  - **PR-4a**: shallowRef infrastructure (5 commits)
  - **PR-4b**: bounded caches + payload trims (4 commits)
  - **PR-4c**: customer dropdown cap (1 commit) — could fold into 4b

  But more PRs = more maintainer overhead. Keep as one if you can
  write a tight PR description.

---

### PR-5 — `perf/watcher-listener-hygiene`

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| dc0518f4 | perf(invoice): drop deep:true from posProfile + offers watchers (Tier 3 fix) | 🟡 | subject **80 chars**. "(Tier 3 fix)" again. 1f/+13-2. | **reword** (strip Tier 3, shorten) |
| 5006a5b5 | perf: batch-drop deep:true from 9 hot watchers (Tier 3) | 🟡 | subject 54 chars. no scope token (just `perf:`). body lists 12 actual sites — misleading "9" count. 9f/+36-16. | **reword** (`perf(watchers): drop deep:true from 12 hot watchers`) |
| 9fee9e46 | fix(critical): socketStore.init guard against double-registration (primary listener leak) | 🔴 | subject **94 chars**. `fix(critical)` again. 1f/+12. | **reword** to `fix(socket): guard against double-registration of realtime listeners` |
| 2977e50c | fix(critical): eventBus listener cleanup on PosOffers/PosCoupons/NewAddress | 🟡 | subject **75 chars**. `fix(critical)` again. 3f/+21. | **reword** |
| 8eb19103 | fix(search): bound _lastSearchServerRetryByTerm at 100 entries | 🟢 | subject 62 chars. clean. 1f/+13. | **ship** |

**PR-5 verdict**: 🟡 **5 reword operations, no splits**. Strip
`fix(critical)` everywhere, strip "Tier 3", correct the "9 watchers"
→ "12 watchers" claim in `5006a5b5`. PR depends on PR4 conceptually
(shallowRef infrastructure makes the shallow watches consistent), so
hold PR5 until PR4 lands. **Order in PR5**: `9fee9e46` (primary
leak) → `2977e50c` (secondary leaks) → `dc0518f4` (Invoice.vue) →
`5006a5b5` (batch sweep) → `8eb19103` (cooldown Map bound). Coherent
story: "found the listener leak, fixed it, then dropped the
deep-watch costs that compounded with it, then bounded one last map."

---

### PR-7 — `fix/customer-flow`

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| 0d652a8f | fix(critical): customer-change + background flush no longer block; cap dropdown payload | 🔴 | subject **94 chars**. `fix(critical)`. **MIXED CONCERN**: 3 unrelated fixes (customer-change fire-and-forget + flush fire-and-forget + dropdown cap). 3f/+55-19. | **split into 3 commits** |
| 188fe54f | fix(critical): customer/items freeze when selecting customer with foreign price list | 🔴 | subject **88 chars**. `fix(critical)`. **MIXED CONCERN**: 5 fixes in one commit (updatePriceList fallback drop + invoiceWatchers defer + search gate + new `search_customers` endpoint + customers performSearch). 5f/+212-40. NEW PUBLIC API in same commit as 4 frontend fixes. | **split, urgently** |
| 78750236 | fix(realtime): seed serverOnline from current socket state on mount | 🟢 | subject 67 chars. body excellent (forensic). 1f/+13. | **ship** |

**PR-7 verdict**: 🔴 **MUST SPLIT**.

`188fe54f` is the worst offender in the whole set. It:
- Introduces a brand-new whitelisted Python endpoint
  `posawesome.posawesome.api.customers.search_customers`
- Modifies 4 frontend hot paths
- Touches the `selected_price_list` watcher chain
- 212 lines added across 5 files

A reviewer will reject this on sight as "one commit per concern,
please." Split as:

1. `feat(api): add search_customers whitelisted endpoint` —
   `customers.py` only.
2. `fix(customers): server-fallback when IDB returns empty results` —
   `customersStore.ts` `performSearch` only.
3. `fix(items): drop forceServer fallback in updatePriceList` —
   `itemsStore.ts` only.
4. `fix(invoice): defer watcher invalidation off the synchronous tick`
   — `invoiceWatchers.ts` only.
5. `fix(items): relax 3-char server-fallback gate` —
   `useItemsSelectorSearch.ts` only.

`0d652a8f` similar 3-way split (`customer.ts` fire-and-forget,
`item_updates.ts` fire-and-forget, `customersStore.ts` dropdown cap).

Resulting PR7 is **9 commits**, but every commit is one concern, one
test plan, one reviewable diff. Reviewer thanks you.

---

### PR-8 — `feat/qz-tray-improvements`

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| 9ce815b7 | feat: pass posa_qz_printer_name from POS Profile to QZ Tray | 🟢 | subject 60 chars. has `Co-Authored-By: Claude` trailer ✓. 4f/+4-1. | **ship** |
| 6aa28fbd | feat: inline letterhead images as base64 for QZ Tray printing | 🟢 | subject 62 chars. has co-author trailer. 1f/+60-1. | **ship** |
| 30e39cc7 | fix: pin QZ Tray print viewport to printer width | 🟢 | subject 49 chars. co-author trailer ✓. 1f/+14-3. | **ship** |
| b9db3616 | fix: inset QZ Tray print body by 4mm to avoid thermal printer clipping | 🟡 | subject **71 chars** (at limit). co-author trailer ✓. 1f/+5-4. | **reword** (drop "to avoid…", subject implies it) |
| 660ec6f8 | feat: pre-warm QZ Tray connection when POS Profile has silent_print | 🟢 | subject 68 chars. co-author trailer ✓. 1f/+14. | **ship** |

**PR-8 verdict**: 🟢 **CLEANEST PR IN THE SET**. Five focused
commits, single-file each (except `9ce815b7` which is 4 call-site
edits — fine), all properly co-authored, all body-explained. No
scope token (just `feat:` / `fix:` without `(qz)`), but that's
upstream-acceptable. Optional reword: add `(qz)` scope to all 5 for
consistency.

PR plan §6 also lists `48a87102` here but the user moved it out
(telemetry hook). **Correct exclusion** — see PR-C below.

---

### PR-C — Doco-private (DO NOT PR)

Telemetry trio + the QZ telemetry hook the user pulled from PR8.
These are correctly flagged as **out of upstream scope** in the PR
plan. The audit checks them anyway because someone might be tempted.

| hash | subject ≤50ch | flag | findings | action |
|------|---------------|------|----------|--------|
| 398539c1 | feat(telemetry): frontend RUM client + withPerf sampling hook | 🔴 | 3f/+362-2. clean code. **OUT OF UPSTREAM SCOPE** — couples to our backend doctype. | **do not PR** |
| 6b22d002 | feat(telemetry): ingest + summary endpoints + daily prune scheduler | 🔴 | 3f/+274-17. clean. Contains literal `# Copyright (c) 2026, doco contributors` in `telemetry.py` — **doco identity leak in source comment**. | **do not PR**; if ever generalised, **strip the doco copyright** |
| 3fd64a85 | feat(telemetry): POS Telemetry Event doctype | 🔴 | 3f/+158. Contains `# Copyright (c) 2026, doco contributors and contributors` in the doctype Python module. **identity leak**. | **do not PR**; fix copyright before any future generalisation |
| 48a87102 | fix(qz): telemetry capture for QZ Tray print failures | 🔴 | 1f/+73-14. couples PR8 QZ code to the doco-only `track()` telemetry API. | **do not PR as-is**; either drop the telemetry coupling (`console.warn` fallback) for an upstream variant, or leave fork-only |

**PR-C verdict**: 🟢 **CORRECTLY EXCLUDED** from upstream PRs. The
two doco copyright comments are the only meaningful issue — they're
not in any commit destined for upstream so they don't block, but
flag them now so they don't sneak in if we later try to generalise
the telemetry doctype as a separate upstream contribution.

---

## 2. Cross-cutting findings

### 2.1 Subjects exceeding 72 chars (10 of 32)
`6e9d7222` (90), `8f3a87e5` (78), `06c1d639` (72✓ borderline),
`7f82339d` (82), `539d8654` (89), `dc0518f4` (80), `9fee9e46` (94),
`2977e50c` (75), `0d652a8f` (94), `188fe54f` (88), `b9db3616` (71✓
borderline).

**Volume**: 31 % of commits exceed convention. Mass reword needed.

### 2.2 `fix(critical):` non-standard type (6 commits)
`7f82339d`, `0d94b966`, `9fee9e46`, `2977e50c`, `0d652a8f`,
`188fe54f`. Use real scopes (`pricing`, `items`, `socket`,
`customers`). "critical" is a severity label, not a
Conventional-Commits type.

### 2.3 Fork-internal terminology in bodies/subjects
- "Tier 3" appears in `5aa38110`, `8f3a87e5`, `06c1d639`,
  `dc0518f4`, `5006a5b5` — refers to our internal
  `POSAWESOME-ROADMAP.md` tier. **Meaningless to upstream**. Strip.
- "POSAWESOME-ROADMAP.md line 89/101" references in `8f3a87e5` /
  `dc0518f4` bodies. File doesn't exist upstream. Strip the
  line-number citations or rephrase to "our internal roadmap
  flagged this as the dominant cost."
- "(Phase 2 native cart)" / "Phase 1.H" — appears in some bodies
  outside this audit but be mindful during the reword pass.

### 2.4 Mixed-concern commits (3 commits)
`7f82339d` (3 bugs), `0d652a8f` (3 fixes), `188fe54f` (5 fixes + new
API). **MUST split** before opening PR4 / PR7.

### 2.5 Co-Authored-By inconsistency
6 commits have it (`9ce815b7`, `6aa28fbd`, `30e39cc7`, `b9db3616`,
`660ec6f8`, `48a87102`), 26 don't. Pick one policy and apply
uniformly.

### 2.6 Doco identity leaks in source (NOT in commits-for-upstream)
`telemetry.py` and `pos_telemetry_event.py` carry `# Copyright (c)
2026, doco contributors`. These files are fork-only and not in any
upstream PR. **No block on the 8-PR plan**, but tag for cleanup if
we ever generalise telemetry.

### 2.7 No `.DS_Store` / `*.pyc` / `*.swp` / dist/ / built assets
Verified across all 32 commits via `git show --stat`. **Clean**.

### 2.8 No secrets / .env / .pem / credentials
Verified. **Clean**.

### 2.9 No hostnames / IPs / ports
Grep for `ventas.lab.xolo|docomexico|lab.xolo|dev.docomexico` across
all 32 commit diffs returned **zero hits**. **Clean**.

### 2.10 No doco-business terms (laboratorio/mercado/taller/caja
chica)
Grep returned zero hits across the upstream-bound 28 commits.
**Clean**.

### 2.11 No merge commits inside the curated set
Verified: the two recent merge commits (`fc428f4b`, `0efb72a9`) are
**outside** the audited hashes. The 32 audited commits form a linear
sequence — rebase-friendly. **Clean**.

### 2.12 No WIP / fixup! / squash! markers
Verified. **Clean**.

### 2.13 Body wrapping
Spot-checked — most bodies wrap at ~72 chars. A few code-block
inserts go to 80 chars. Acceptable.

### 2.14 Large commits (>500 LOC)
None. Largest is `188fe54f` at 252 lines, which is already flagged
for split. After splits, no commit exceeds 200 LOC.

### 2.15 Reverts
No revert commits in the audited set. (The PR plan §6 explicitly
defers reverts `0bddc50a`, `ffb4e67d` to backlog.)

### 2.16 CHANGELOG.md / docs in same commit as code
None of the 32 commits touches `CHANGELOG.md` or `README.md`. Bodies
serve as the change log. **Clean**.

---

## 3. PR-level git-ops checklist (per PR, in order)

For each PR, before pushing:

```text
# 1. Branch from fresh upstream
git fetch upstream
git checkout -b <pr-branch-name> upstream/stage-develop

# 2. Cherry-pick the (rewritten) commits in the order specified
git cherry-pick <hash> <hash> ...

# 3. During cherry-pick, for each commit:
#    - amend author to holymc2 <marcoantonioponcevaldez@gmail.com>
#    - reword subject ≤72 chars, strip "Tier 3" / "fix(critical):"
#    - decide co-author trailer policy (apply uniformly)

# 4. After all cherry-picks land:
git rebase -i upstream/stage-develop  # squash/split per audit
# (NB: rebase -i is interactive — do this in a real terminal, not
# from the Claude harness. Hooks rule: do not use git rebase --no-edit.)

# 5. Run vitest + bench build before push:
cd frontend && yarn vitest run --reporter=verbose
cd .. && bench build --app posawesome

# 6. Push to fork:
git push origin <pr-branch-name>

# 7. Open PR via gh / web; copy PR description from
#    docs/REVIEW2/UPSTREAM-PRS.md §<PR-N>
```

### Per-PR ops summary

| PR | rewords | squashes | splits | net commits | risk |
|----|---------|----------|--------|-------------|------|
| 1  | 1       | 0        | 0      | 1           | 🟢 low |
| 2  | 1 + remove `2694d8dc` | 0 | 0 | 1 | 🟢 low |
| 3  | 3 (`d477e21f` no, `5a1a13fc` yes, `b4c514ad` yes) + add `2694d8dc` from PR2 + add `b6d41569` per plan | 1 (`5a1a13fc`+`b4c514ad`) | 0 | 4 | 🟡 med — overlaps upstream's sync work |
| 4  | 7 | 0 | 1 (`7f82339d` → 3 commits) | 11 | 🟡 med — large surface |
| 5  | 5 | 0 | 0 | 5 | 🟢 low |
| 7  | 1 (`78750236` only) | 0 | 2 (`0d652a8f` → 3, `188fe54f` → 5) | 9 | 🔴 high — new public API needs its own commit |
| 8  | 1 (`b9db3616` optional) | 0 | 0 | 5 | 🟢 low |
| 6  | (not in this audit batch) | – | – | – | – |

**Total work**: ~18 reword operations, 1 squash, 3 splits, 1
cross-PR move (`2694d8dc` PR2→PR3), 1 add-from-plan (`b6d41569` to
PR3), 32 author-rewrites.

---

## 4. SHIP-ORDER recommendation

User's stated constraint: **don't dump 23 PRs on maintainers in a
week**. Spacing ≥3 days between PRs gives maintainers room to
breathe; the first 2-3 PRs should be small + obviously-correct to
build trust before we send the big ones.

Ordering criteria (priority order):
1. **Smallest diff** = easiest review = fastest merge = trust built.
2. **Most obvious merit** = harder to bikeshed.
3. **Independent / no upstream conflict** = no "we already have a PR
   in flight for this" rejection.
4. **Critical** = move first only if it blocks others or upstream
   users would benefit immediately.

### Recommended order (≥3 days between each):

| Day | PR | Why this slot |
|-----|----|----|
| **D+0** | **PR-1** `fix/python-3.14-module-lock` | 1 file, 11 lines. Blocking issue for Python 3.14 users. Trivial review. **Mandatory trust-builder**. |
| **D+3** | **PR-8** `feat/qz-tray-improvements` | 5 narrow commits, all single-file. Niche but useful. Maintainers can skim and approve. Builds confidence in our QZ-area expertise. |
| **D+6** | **PR-7** `fix/customer-flow` (after the splits) | 9 commits but each small and focused. New `search_customers` endpoint is a feature reviewers will appreciate. Independent of upstream's parallel cart work. |
| **D+9** | **PR-2** `chore/vuetify-3.12.6` | 1 commit, 2-file yarn.lock + package.json bump. Dep churn, low brain cost. Once merged, **PR-3 unblocks** since hashed entries depend on the build pipeline being current. |
| **D+12** | **PR-3** `perf/build-hashed-entries-sw` | 4 commits after the squash + `b6d41569` rebase. High value (stale-chunk bug class retired). Most upstream users hit this — reviewers will WANT to merge. |
| **D+15** | **PR-5** `perf/watcher-listener-hygiene` | 5 commits, infra-level perf, no API surface changes. Sets up PR-4. |
| **D+18** | **PR-4** `perf/store-de-deepening` | 11 commits, ~252 LOC. Largest PR. Worth doing last in the perf chain because PR-3 + PR-5 prove we know what we're doing reactively. |
| **D+21** | **PR-6** `perf/pricing-fire-and-forget` | (not in this audit batch — see PR plan §6). Slowest because of upstream cart-perf conflict; ship last. |

**Total runway**: 21 days from PR-1 → PR-6 close-out, with built-in
slack between each. If a PR stalls in review, push the next one's
date out accordingly (don't open PR-N+1 while PR-N is still
debating).

### Why this is NOT the order in the PR plan

PR plan §6 orders by numeric `PR1..PR8` which roughly maps to "fix →
chore → perf → fix → perf → perf → fix → feat". Our recommended
ship-order **interleaves small/clean PRs between large perf PRs** to
keep maintainer reviewer-fatigue from compounding. PR-8 (QZ) jumps
ahead of PR-2 (Vuetify) because PR-8 is more interesting + has zero
upstream-conflict risk; PR-2 is boring-but-necessary and benefits
from PR-8's goodwill.

---

## 5. Pre-flight checklist (run before ANY push)

- [ ] All 32 commits author-rewritten to `holymc2
      <marcoantonioponcevaldez@gmail.com>`.
- [ ] Subjects all ≤72 chars.
- [ ] `fix(critical):` → real scope tokens.
- [ ] "Tier 3" / "POSAWESOME-ROADMAP.md" references stripped.
- [ ] `Co-Authored-By: Claude` policy applied uniformly (all or
      none).
- [ ] Mixed-concern commits split per §1.
- [ ] `2694d8dc` moved from PR-2 to PR-3.
- [ ] `b6d41569` (background-sync hidden-tab) added to PR-3 per plan
      §6.
- [ ] `5a1a13fc` + `b4c514ad` squashed.
- [ ] No GPG required, but signing recommended.
- [ ] `vitest 540+/540+` green on each PR branch.
- [ ] `bench build --app posawesome` succeeds on each PR branch.
- [ ] PR description (from `UPSTREAM-PRS.md`) does NOT mention
      "doco" / "Tier 3" / "Phase 2" / "POSAWESOME-ROADMAP.md".

---

## 6. Bottom line

The commits are **technically excellent** — root causes documented,
test plans included, scope tight per intent. The **git surface is
sloppy in repeatable ways**: wrong author, oversize subjects,
fork-internal jargon, inconsistent co-author trailers, three mixed-
concern grenades.

None of this is unfixable. **All 32 commits ship after a focused
2-hour rebase pass** to amend authors + reword subjects + split the
3 mixed commits + squash the 1 overlap. Do that before opening PR-1,
not after maintainer feedback.

**Estimated rebase effort**: 2-3 hours of focused work, single
session, no interruptions.

**Do not open PR-1 until §5 checklist is 100 % green.**

— end audit
