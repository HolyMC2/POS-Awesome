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

### 2. Offline dead-letter sales surfacing (reliability HIGH) — SPEC A

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

### 3. posawesome → Prometheus export — SPEC B

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

### 4. Offline + sale-cycle telemetry — SPEC C

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

## PARKED (documented, deliberate)

- update_invoice/submit multi-cycle tax recalc (structural ERPNext, L, risky)
- Fast counter search / invoice column toggles / cache-capacity suppression
  (upstream EYEBALL rows — see UPSTREAM.md)
- Web-entry manifest RTT (Jinja-inject bundle URL), format-mixin deep
  watchers, CatalogItemRow lazy menus (LOW perf)
- Raw ESC/POS printing (revisit only if qz_print latency becomes a target)

## Standing rules

- Lab first, prod gated. Every landed item: tests + lab drill + ledger/docs
  status update + push.
- Upstream recon: start from `UPSTREAM.md` marker, never re-review.
