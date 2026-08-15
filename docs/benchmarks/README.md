# Benchmark manifests, baselines and the regression gate

Implements roadmap §6 ([`POS-WORLDCLASS-ROADMAP.md`](../POS-WORLDCLASS-ROADMAP.md)):
*"Pin exact device/browser versions, server topology, concurrency, dataset
hash, cache state and network shaping in the benchmark manifest. Results
without that manifest are observations, not comparable evidence."*

## Layout

| Path | What |
|---|---|
| `manifests/<id>.json` | The comparability contract per named profile (`counter-low`, `counter-standard`, `busy-service`). §6 table rows → live telemetry event names + target p95 / hard-ceiling p99. |
| `baselines/<id>/*.json` | Recorded captures. A capture stamps the manifest sha256, site, window, dataset counts, app SHA, bundle bytes and the filtered telemetry percentiles. |
| `../../scripts/benchmarks/` | `record_baseline.py` (capture), `check_regression.py` (gate), `manifest_lib.py` (pure logic), `test_manifest_lib.py` (standalone tests). |

## Honesty rules

- **Evidence vs observation.** A capture is `evidence` only when the
  manifest's device is pinned AND network shaping applied. Reference
  hardware is not yet named (Marco call) — until then every capture is an
  `observation` and the file says so.
- **Thin data never gates.** An event below `gate.min_samples` (30) yields
  no percentile. Low-traffic money paths (submit ≈17/day) need multi-day
  windows — the summary API's `events` filter makes 7-day windows fit the
  row cap (rolled to a site with the filter; older sites fall back to an
  unfiltered ~1-day window and the capture's `window.truncated` records it).
- **Ceilings report, regressions fail.** Targets are aspirational until
  measured on pinned hardware; the default gate fails only on p95
  regression vs the blessed baseline (> `regression_tolerance_pct`).
  `--strict-ceilings` promotes hard-ceiling breaches to failures.
- **Changed manifest = new world.** The gate refuses cross-manifest-id
  comparisons and downgrades cross-revision (sha mismatch) runs to
  observation-only.

## Record a capture

```bash
# lab
python3 scripts/benchmarks/record_baseline.py \
  --manifest docs/benchmarks/manifests/counter-standard.json \
  --site doco-mirror.lab.xoloitzcuintles.com --via lab --since 2026-08-08

# prod (read-only over ssh contavm)
python3 scripts/benchmarks/record_baseline.py \
  --manifest docs/benchmarks/manifests/counter-standard.json \
  --site ventas.docomexico.com --via prod --since 2026-08-08
```

## Gate a capture

```bash
python3 scripts/benchmarks/check_regression.py \
  --manifest docs/benchmarks/manifests/counter-standard.json \
  --capture  docs/benchmarks/baselines/counter-standard/<new>.json \
  --baseline docs/benchmarks/baselines/counter-standard/<blessed>.json
```

Exit 0 pass · 1 gate failed · 2 invalid/not comparable.

## First recorded reality (2026-08-15, ventas.doco, observation)

- `warm_launch_shell` p95 3405 ms vs 1500 target (p99 3904 > 3000 ceiling)
- `server_search` (get_items round-trip) p95 1109 ms vs 250 target
- `rum:inp` p95 112 ms — comfortably inside budget
- submit/QZ under min samples in a 1-day window (see honesty rules)

## Instrumentation status

Closed with manifest v2 (events appear once the carrying build reaches a
site — until then those rows read NO-DATA):

1. Warm/cold launch split — `pos:launch_warm_ms` / `pos:launch_cold_ms`
   (LCP split by whether a service worker controlled the load; capped like
   the other web vitals).
2. `payment_screen_open` — `perf:pos:pay-open`, tap → panel visible
   including the invoice round-trip.
3. Durable queue acceptance — `perf:pos:offline_save_ms`, the IndexedDB
   persist of an offline sale.
4. Scan/local-search/totals mark pairs now emit ambient telemetry at a 10%
   sample with `__PROF__` off (summary counts under-count ~10x by design;
   `__PROF__` still adds full DevTools marks/measures).
5. `perf:search-worker` was double-prefixed (`perf:perf:…`) and therefore
   invisible — fixed.

Still open:

- Floor/table action mark (busy-service).
- `perf:pos:add-item` p99 polluted by offline enrichment — manifest gates
  its p95 only.
