# Full app audit — 2026-07-11 (speed · reliability · telemetry)

4 parallel read-only audit agents over posawesome + saldo, grounded in prod
telemetry (ventas.docomexico since 2026-07-10: get_items p99 2.6s,
update_invoice p50 874ms, submit p50 812ms, boot LCP p95 4.6s, qz_print p50
1.9s, INP p99 144ms healthy, 0 crashes). Prior art honored (AUDIT-2026-05-20,
REVIEW2, PERF-get-items) — only new findings.

**Quick wins LANDED same day** (marked ✅). Rest = ranked backlog.

## Reliability

| Sev | Finding | Status |
|---|---|---|
| HIGH | Held draft all-Success but resume lost → stuck forever, badge lies | ✅ `recover_stuck_holds` janitor (*/5m, idempotent) |
| HIGH | Held draft edited in Desk during hold window → background submit skips payments-vs-total invariant → silent outstanding on cash sale | ✅ invariant re-asserted in `submit_in_background_job` (returns exempt) |
| HIGH | Offline dead-letter sales invisible (5 failed syncs → dead_letter, no UI surface, cash in drawer, no invoice) | ❌ BACKLOG (M) — needs dead-letter panel + persistent alert |
| MED | `abandon_held_invoice` allowed Manual Review holds server-side (TAECEL may have charged → money loss) | ✅ MR added to blocked statuses |
| MED | MR-only holds blocked shift close all night (reconciler resolves at 02:00 by design) | ✅ MR-only holds exempt from close block + Comment trail |
| MED | Submission ledger unbounded + FAILED/stale rows invisible | ✅ prune (45d, final states only); ❌ BACKLOG: stale-row surfacing in corte/digest |
| MED | Badge fallback poll only when holds non-empty → empty-forever on failed initial fetch | ✅ unconditional 30s poll |
| LOW | Double-resume race logs scary resume_error though resume runs | ✅ `deduplicate=True` on resume enqueue |
| LOW | abandon unlink not atomic vs delete failure | ✅ savepoint |
| LOW | Background submit failure = realtime-only (dies with closed SPA) | ✅ Comment on draft in except path |

## Backend performance

| Finding | Status |
|---|---|
| Delta polls (60s×terminal) write never-read cache entries (fresh `modified_after` watermark each call) | ✅ cache gated on `not modified_after` |
| `Item Price.modified` / `Bin.modified` unindexed (delta polls full-scan; fine now, real at muelle scale) + ledger `invoice_name` unindexed (hold resume) | ✅ patch `add_pos_delta_sync_indexes` |
| Stock/batch/serial fetcher caches: per-process `hash()` keys (invisible cross-worker) + global flush on EVERY stock write → effectively uncached during trading → main get_items tail feeder | ✅ **LANDED 2026-07-11 (same day)** — deterministic sha1 keys all 8 fetchers + per-warehouse invalidation w/ ancestor scopes; lab-drilled (scoped clear isolation ✓, warm get_items 30ms) |
| update_invoice runs ≥2 full pricing/tax cycles per cart edit (structural ERPNext); submit adds 2 more | ❌ parked (L, risky surgery) |
| Search-string cache churn | ❌ parked (LOW) |

## Frontend performance

| Finding | Status |
|---|---|
| `vuetify` (largest chunk, 164kB gz) missing from preload list → late serial fetch in LCP path | ✅ added to PRELOAD_CHUNK_NAMES |
| First add of ANY distinct item blocked on saldo-meta HTTP round-trip | ✅ `saldo_enabled` ships in get_items payload (guarded) + SPA fast-path skips capture when defined-falsy |
| `pos:add-item` metric polluted (included saldo dialog = cashier typing) | ✅ perf mark moved below capture — metric now honest |
| Sync socket.io script gates first paint on socketio health | ✅ `defer` (shim fallback covers race) |
| `fetchManifest` RTT before bundle import (~50-300ms každý boot) | ❌ BACKLOG (S/M): Jinja-inject bundle URL |
| 15 components × deep watcher on whole posProfile (format mixin) | ❌ BACKLOG (M) |
| Navbar deep watchers on rebuilt computeds; CatalogItemRow per-row v-menu | ❌ parked (LOW) |
| SW eviction serial await in boot path | ❌ parked (micro) |

## Telemetry

| Gap | Status |
|---|---|
| **`qz:` prefix not in ingest allowlist → ALL qz:failure rows silently dropped** (incl. today's fallback counter — feature recorded nothing) | ✅ renamed `warn:qz_failure` (client-side, allowlisted) |
| Hot-method mislabel: `api.utilities.get_active_pricing_rules` vs real `api.pricing_rules.…` → intended-hot method 10%-sampled | ✅ fixed |
| Popup-blocked browser prints invisible → no true print success rate | ✅ `warn:print_popup_blocked` at 3 sites |
| Hold flow blind (holds/day, hold→submit latency, retries, abandons, resume errors) | ✅ `hold.*` structured events via saldo telemetry (created/resumed+wait_seconds/failed/review/resume_error/retried/abandoned/manual_resume) |
| Offline reality unmeasured (transitions, offline invoices, sync failures) | ❌ BACKLOG (M) |
| Cashier-felt sale cycle (first add → receipt) | ❌ BACKLOG (M) |
| posawesome server failures not exported to vigia/prom | ❌ BACKLOG (M) — copy saldo's registry piggyback |
| Ingest-dropped events invisible client-side; shift-close duration | ❌ BACKLOG (S) |

## Next session candidates (by leverage)

1. Stock-fetcher cache keys + granular invalidation (get_items tail — the big one)
2. Offline dead-letter surfacing (money-path reliability)
3. posawesome → prom export (server error visibility in Grafana)
4. Offline + sale-cycle telemetry pair
