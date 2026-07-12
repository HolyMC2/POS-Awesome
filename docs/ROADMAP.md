# POSAwesome fork — working roadmap

Living backlog. Sources: 2026-07-11 full audit (`AUDIT-2026-07-11-full.md`),
POS Profile wiring audit (`POS-PROFILE-SPEC.md`), upstream ledger
(`UPSTREAM.md`). Update statuses here as items land.

## DONE (2026-07-11)

- ✅ Audit quick wins ×17 (see AUDIT-2026-07-11-full.md tables)
- ✅ **Backlog #1 — stock-fetcher cache**: deterministic sha1 keys (were
  per-process `hash()` → cross-worker invisible) + per-warehouse
  invalidation with ancestor scopes (was global flush on EVERY stock write
  → uncached during trading). `item_fetchers.py`; drilled on lab: scoped
  clear hits only its warehouse; get_items warm 30ms vs cold 922ms.
- ✅ Expanded item-detail panel fix + SI/SO/QO test suite (11 cases)
- ✅ Hold-until-confirm + upstream picks/adapts (see UPSTREAM.md)

## NEXT — implementation-ready specs

### 1. POS Profile P0 server backstops (security/money — see POS-PROFILE-SPEC.md)

✅ **LANDED 2026-07-11 `2b73be6d`** (wave 1 + gift-cards):
posting-date backdating gate, is_return gate, delete_invoice gate,
gift-cards feature gate + PKR-default fix. 9 tests (test_profile_gates.py).

✅ ALL P0 LANDED (Marco decided: M-Pesa unused → mutation removed,
customer-credit gated plainly; name-override + delivery-charges gated).

### 2. Offline dead-letter sales surfacing — ✅ LANDED 2026-07-11 (SPEC A)

Dead-lettered sale (5 failed syncs) is invisible today: cash in drawer, no
invoice, no signal. Replay-safety VERIFIED (client_request_id → ledger
replay = no double-bill on late retry).

| File | Change |
|---|---|
| `offline/invoiceOutbox.ts` | `getDeadLetterRows/Count()`, `requeueDeadLetterEntry(crid)` (status→retrying, requeue_count), `exportDeadLetterEntry` (JSON rescue) |
| `stores/syncStore.ts` | `deadLetterCount` state + `requeueDeadLetter` action; emit `crash:offline_sale_dead_letter` on count increase (NOT from offline/ — import cycle) |
| `NavbarAppBar.vue` :73,:173 | badge error-color + count when deadLetterCount>0 |
| `OfflineInvoices.vue` | "Sin sincronizar — atención" section: rows + Reintentar + Exportar JSON |
| `DefaultLayout.vue` | persistent toast (timeout 0) on 0→N |

Edges: corrupt payload → back to dead_letter w/ new last_error (operator
loop, no auto-retry); missed-ack → replay drains ✓; IndexedDB wipe = data
gone (crash: row is the durable trace). Effort M (~1 day incl. drill).

### 3. posawesome → Prometheus export — ✅ LANDED 2026-07-11 (SPEC B; scrape e2e-verified on lab; vigia panel/alert = open follow-up)

saldo's multiproc registry pattern (`saldo/api/telemetry.py:76-135` — guard
import, site label, PROMETHEUS_MULTIPROC_DIR self-heal) + doco's existing
scrape endpoint (`doco.docoutils.observability.endpoint.metrics`,
X-Prometheus-Token) — **posawesome counters ride the same scrape, zero
endpoint work**.

New `api/metrics.py`: `posa_submit_failures_total{site,path=sync|background|resume|outbox}`,
`posa_background_submits_total{site,outcome}`, `posa_ledger_rows_pruned_total{site}`.
Increment sites: submit_in_background_job success/except, resume throws,
_mark_ledger_failed, prune count, outbox submit failure. All guarded — a
metric must never break the money path. vigia follow-up: Grafana panel +
`rate(posa_submit_failures_total[15m]) > 0` → Telegram alert.
Effort S/M.

### 4. Offline + sale-cycle telemetry — ✅ LANDED 2026-07-11 (SPEC C)

| Event | Where | Shape |
|---|---|---|
| `pos:offline_transition` | DefaultLayout watch(serverOnline), 2s debounce, skip boot | meta {online} |
| `pos:offline_invoice_saved` | usePaymentSubmission.ts:904 | value=total, meta {items} |
| `warn:offline_sync_failed` | syncStore sync result failed>0 | value=failed, meta {pending} |
| `pos:sale_cycle_ms` | stamp first add to empty cart (invoiceStore), emit on submit success + held; reset on clear | meta {item_count, held, background} |
| `pos:shift_close_ms` | wrap submitDialog in useClosingShift | meta {invoice_count, drafts} |

No sampling (low volume). Edges: stamp survives customer switch, resets on
Save&Clear/cancel; boot transition suppressed. Effort S/M.

### 5. POS Profile P1/P2 cleanup

- ✅ 6 DEAD fields removed (remove_dead_pos_profile_fields, 2026-07-11)
- Warts: `pose_use_limit_search` typo (document or migrate),
  posa_auto_set_batch dead backend comment, PostingDateRow odd-home note

## Offline-mode hardening audit — 2026-07-11 (6 parallel RO agents, all verified at source)

Full-surface audit of offline mode: persistence/replay, sync engine, IndexedDB
caches, backend sync API, service worker, and the money path E2E. Every finding
below was re-read at the cited line by the lead before ranking.

**LANDED (`10a59f7a`):**
- ✅ **CRITICAL security — offline-sync IDOR.** `offline_sync/common.py _resolve_profile`
  trusted a client-supplied POS Profile (dict verbatim / bare name, no membership
  check); all 6 read endpoints derive scope from it and hit `frappe.get_all`
  (permission layer bypassed). Any cashier could `pos_profile="{}"` → dump the whole
  customer book (name/mobile/email/RFC) or name another store's profile for its
  stock/prices. Fixed: take only the claimed name, `_scope.assert_profile`, load the
  real doc server-side. +4 scope tests (`test_offline_sync_scope.py`), 19/19 green.

**LANDED wave 2 (`8e89c3db`, `c77ac7dd` — backlog #3 + #1):**
- ✅ **HIGH data-loss — IndexedDB auto-wipe.** `isCorruptionError` (db.ts) no longer
  treats transient `InvalidStateError`/`NotFoundError` (multi-tab upgrade races) as
  corruption, so `repairDbAfterFailedHealthCheck` won't `Dexie.delete` unsynced sales.
  Narrowed to `VersionError`/"corrupt". +test.
- ✅ **HIGH money — saldo offline.** `useItemAddition.addItem` now blocks a saldo item
  offline (pure `shouldBlockSaldoOffline` helper) instead of posting a referencia-less
  line → no more cash-collected-without-airtime. Mirrors the gift-card block. +5 tests.
  615/615 vitest + vue-tsc + vite build green. Remaining money-path saldo backstop at
  payment-submit is optional defense-in-depth (add-to-cart is the capture chokepoint).

**RANKED BACKLOG (not yet landed):**

| Rank | Sev | Where | Defect → fix |
|---|---|---|---|
| 1 | HIGH money | `usePaymentSubmission.ts:915-920` + `useItemAddition.ts:362-390` | Saldo (airtime) sale offline: capture no-ops (live `fetchMeta` fails offline), item posts as a plain line, cash collected, **no airtime, no invoice** (dead-letters on sync; carrier is fail-closed so no WRONG airtime). Fix: hard-block saldo items offline at add-to-cart AND payment — mirror the gift-card `throw` at :916. |
| 2 | HIGH money | `offline/invoices.ts:341-369` | Legacy drain's draft-fallback calls `update_invoice` (non-idempotent, `posa_client_request_id` only NON-unique indexed) then marks entry **synced**. Ack-miss → orphan duplicate draft w/ colliding request-id → double-bill if submitted from Desk. Fix: route fallback through idempotent `submit_invoice`, or unique partial index on `posa_client_request_id`. |
| 3 | HIGH data-loss | `offline/db.ts:207-216,844-846` | `isCorruptionError` treats transient `InvalidStateError`/`NotFoundError` (multi-tab upgrade races) as corruption → `Dexie.delete` wipes `write_queue`/`invoice_outbox` = **unsynced sales gone**. Fix: narrow to `VersionError`/"corrupt"; export outbox before any destructive delete; retry/backoff transient reopen failures. |
| 4 | HIGH correctness | `sync/SyncCoordinator.ts:375-392` + `syncState.ts:47` | Coordinator's post-run `updateResourceState` persists `scopeSignature:null`, clobbering the adapter's value on the same `&key` row every run → profile/company/warehouse **scope-change wipe is dead** (stale cross-scope customers/stock survive a profile switch) and `full_resync_required` is **stuck in "limited" forever**. Fix: carry `scopeSignature` through `ResourceSyncResult`; stop the coordinator overwriting adapter-owned fields (also stops persisting the full `response` blob). |
| 5 | HIGH reliability | `offline/writeQueue.ts:429-469,524-551` | Write-queue path (payments/cash — prod default) has NO retry backoff: a brief 5xx burst burns all 5 retries in seconds → premature `dead_letter`, and write_queue dead-letters have NO UI surface/requeue (that shipped for the outbox only). Fix: exp backoff on `next_attempt_at`; extend the dead-letter panel to write_queue entities. |
| 6 | HIGH functional | `offline/cache.ts` saveItems (~359,418,436) + `customers.ts:190` | Bulk writers swallow errors and return void; readiness = `count>0`, no completeness marker → a quota-truncated/partial catalog is marked "ready" and sold offline against stale/incomplete data. Fix: propagate write failures; gate readiness on expected-total or a snapshot-complete marker. |
| 7 | HIGH reconciliation | `usePosShift.ts:235-328` + `shifts.py:153-182` | Shift close ignores the client offline queue (`getPendingOfflineInvoiceCount`); server `assert_shift_not_stale` returns early when status≠Open → offline sales sync into an already-closed shift, absent from the corte. Fix: block/warn close when pending>0; server guard rejecting submit into a CLOSED opening shift. |
| 8 | HIGH functional (prod) | `posapp.ts:101-127` vs `web-entry.ts:62-114` | The `/posapp` web route (prod) NEVER registers the SW **by design** (a "/"-scoped SW 404s `/files/*` images), so cold-boot-offline (reload/reboot during an outage → can't open POS at all) works only on the Desk route. In-session offline (page stays loaded) still queues fine. Decide: accept, or a scoped SW / offline shell for the web route. |
| 9 | MED | `sw.js:198-206,289,366` + `loader.ts:89` | `version.json?t=<ts>` (unique key each call) accretes >1000 cache entries over a shift; `enforceCacheLimit` FIFO-evicts the **install-time precache first** → offline cold-boot loses the bundle. Fix: don't runtime-cache `version.json` (or evict by age, not FIFO); precache vendor/vuetify chunks. |
| 10 | MED | `useOnlineStatus.ts` (Invoice.vue/Customer.vue) + `useNetwork.ts:164` | Sale-critical components read raw `navigator.onLine`, not the probed `serverOnline`; reachability counts 401/403 as "online" → captive-portal / expired-session shows "Online" while nothing saves. Fix: sale paths read `serverOnline`; add an auth dimension to the probe. |
| 11 | MED data leak | `item_fetchers.py:598` / `item_processing/search.py:361` → `offline_sync/items.py` | Sync item payload ships `valuation_rate`/`standard_rate` (cost basis) to every cashier's IndexedDB. Fix: whitelist selling fields, strip cost. |
| 12 | MED | multiple | Customer-credit redemption not blocked offline (gift cards are); returns offline weakly gated; stale price accepted on replay when `posa_allow_user_to_edit_rate=1`; `clearAllCache` misses several PII/financial memory caches (`db.ts:714-779`). See agent reports for line-level detail. |

Notes: idempotency (server ledger keyed on `posa_client_request_id`) is sound — late
retries can't double-bill except via rank #2's non-idempotent fallback. Backend
re-validates scope/shift/discount/rate/payment==total/stock on EVERY replay, so
offline is not a trust bypass for totals. `_UNDER_BENCH` skip pattern applies to
the new scope test too (run standalone: `python3 test_offline_sync_scope.py`).

## PARKED (documented, deliberate)

- update_invoice/submit multi-cycle tax recalc (structural ERPNext, L, risky)
- Fast counter search / invoice column toggles / cache-capacity suppression
  (upstream EYEBALL rows — see UPSTREAM.md)
- ✅ Web-entry manifest RTT + format-mixin watchers + gadget cadence
  landed 2026-07-11 (perf wave); CatalogItemRow lazy menus deliberately
  kept (bounded by scroller)
- Raw ESC/POS printing (revisit only if qz_print latency becomes a target)

## Standing rules

- Lab first, prod gated. Every landed item: tests + lab drill + ledger/docs
  status update + push.
- Upstream recon: start from `UPSTREAM.md` marker, never re-review.
