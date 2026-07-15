# get_items performance — state, the deep fix, and why it's deferred

_Last updated 2026-06-02. Owner: doco fork. Status of the deep fix below:
**SCOPED, NOT BUILT.**_

## TL;DR

- `get_items` is the slowest operator-facing call (prod telemetry: ~2424ms
  avg, max ~6580ms).
- The 2026-06-01 deep-OFFSET paging fix (`8bebc65a`) helped **lab** 6.4× but
  **did not move prod** — prod is enrichment-bound, not OFFSET-bound.
- The lab-staged fix is a **deterministic cache key + cross-process pre-warm**
  (`search.py` + `cache_warmer.py`). ⚠️ Frappe's `@redis_cache` keys on
  builtin `hash()` (randomized per process, PYTHONHASHSEED unset) so a
  scheduler/queue worker can't warm the gunicorn web cache. Fixed by keying
  `get_items` on `posa_get_items:v1:<sha1(args)>` instead. The `*/25` prewarm
  then warms a key every web worker shares. Proven **cross-process**:
  separate-process operator walk 220→26ms/page (~8.5×); output byte-identical.
- The **deep fix** below (replace pypika query-building with raw SQL in
  `_prepare_lookup`) is scoped here but **deferred**: once pre-warm is live it
  only helps the rare cache-OFF reset path and the scheduler's own cost, not
  the steady-state operator path. Build it only if those paths prove painful.

## Where the cold time actually goes (prod cProfile, 6459 items)

```
get_items                                   2.475 s  (clean) / 4.0 s (under cProfile)
  _run_item_query                           ~3.6 s
    get_items_details  (×N pages)           2.785 s
      build_details                         2.699 s
        _prepare_lookup (item_fetchers:611) 2.455 s   <-- the cost
          48× get_all                       2.297 s
            MySQL Connection.query          ~0.89 s   (actual DB time)
            pypika get_sql / prepare_query  ~0.80 s   (SQL string BUILDING)
```

`_prepare_lookup` fans out to 8 batched helpers per page:
`get_item_prices`, `get_bin_qty`, `get_item_meta`, `get_uoms`,
`get_barcodes`, `get_bom_costs`, `get_batches`, `get_serials`. Roughly half
the wall-clock is MySQL, the other half is Frappe's pypika query builder
constructing big `... IN (<1000 codes>)` statements.

## The deep fix (proposed, not built)

Convert the `frappe.get_all` / `frappe.qb` calls in the batch helpers to
parameterized raw `frappe.db.sql`, the way `_fetch_item_prices` (already raw)
and parts of `_fetch_batches` are written today. Targets:

| helper | today | convert? |
|---|---|---|
| `_fetch_item_prices` | raw `frappe.db.sql` | already raw — no change |
| `_fetch_item_meta` | `frappe.get_all` (Item) | yes — biggest win (6459-code IN) |
| `_fetch_barcodes` | `frappe.get_all` (Item Barcode) | yes |
| `_fetch_uoms` | `frappe.get_all` (UOM Conversion Detail) | yes |
| `_fetch_bin_qty` | `frappe.qb` (group) / `get_all` (single) | maybe — `get_all` branch |
| `_fetch_batches` | `get_all` + raw sql | partial |
| `_fetch_serials` | `get_all` | optional |
| `_fetch_bom_costs` | (review) | optional |

Expected: removes most of the ~0.8s pypika build overhead on a cold page;
MySQL time (~0.89s) is unchanged. So a cold full walk might drop ~2475ms →
~1600-1700ms. NOT dramatic — the DB work dominates and a composite index
already exists.

## Pros

- Cuts ~0.8s of pure CPU (query construction) off every **cold** page walk.
- Helps the cache-OFF reset / force-reload path (which pre-warm can't touch).
- Makes the scheduler's own pre-warm run cheaper (less backend CPU per cycle).
- Mirrors an existing in-file pattern (`_fetch_item_prices`) — not a new idiom.

## Cons / why it's deferred

- **Pre-warm already covers the steady-state operator path.** After pre-warm,
  operators hit the 70ms warm path; cold pages are paid by the scheduler, off
  the critical path. The deep fix's operator-visible benefit is then small.
- **Modest, DB-bound ceiling.** Even a perfect build-overhead removal leaves
  ~0.89s of MySQL per cold walk. Not a 6× lever.
- **Surface area & regression risk** (see below) is higher than the pre-warm,
  for a smaller, narrower payoff.

## What can break (raw-SQL conversion risk register)

1. **Field aliasing.** Downstream maps read specific keys (`row.item_code`,
   `row.actual_qty`, `name as batch_no`, `item as item_code`, `parent`, …).
   Every aliased column must be reproduced exactly or maps silently go empty
   (items render with no price/stock/uom). Mitigation: golden-output test
   comparing raw-SQL rows to the current get_all rows for a fixed code set.
2. **Dynamic columns.** `_fetch_item_meta` conditionally appends `default_bom`
   / `valuation_rate` via `frappe.db.has_column`. Raw SQL must keep that guard
   or it errors on sites lacking the column.
3. **SQL injection.** Item codes flow from the profile/items, not user free
   text, but raw SQL MUST stay parameterized (`%(codes)s` + tuple), never
   f-string interpolation. Follow `_fetch_item_prices`.
4. **Permissions — NOT a risk here.** `frappe.get_all` already runs with
   permissions ignored (unlike `get_list`); raw SQL behaves the same, so the
   conversion does not change row visibility. (Confirm no helper was secretly
   using `get_list`.)
5. **Reserved words / quoting.** Backtick all table/column identifiers; some
   field names (`uom`, `currency`) are fine but quote defensively.
6. **NULL semantics.** get_all filters vs SQL `IN` / `IFNULL` handling must
   match (e.g. the price query's `IFNULL(customer,'')` logic).
7. **Empty `item_codes`.** Every helper early-returns `[]` on empty input;
   raw SQL with `IN ()` is a syntax error — preserve the guards.
8. **Test churn.** `test_item_fetchers.py` mocks/asserts the current calls;
   conversion needs those updated + a new parity test.

## Recommendation

Ship the pre-warm (done, lab-staged). **Defer the raw-SQL deep fix** until
telemetry shows the cache-OFF reset path or scheduler cost is actually
hurting. If built later, gate it behind a golden-output parity test
(risk #1) and land it helper-by-helper, not all eight at once.

## 2026-07-15 update — compute is SOLVED; the bottleneck is now PAYLOAD

The pre-warm/cache work above paid off: prod `get_items` **server compute is
now ~50-85ms warm** (140ms cold) for the full 5291-item catalog on
`ventas.docomexico.com` — down from the ~2424ms this doc opened with. The
"slowest operator call" framing is stale. The remaining cost is entirely
**payload size** (client `JSON.parse` + building N reactive objects) and the
wire hop.

### Measured (prod, full no-limit call)
- **4.7 MB JSON / 5291 items** (~888 B/item). Client round-trip telemetry
  (`perf:api.items.get_items.ok`): p50 ~500ms, **p95 1.2s**, avg 612ms. The
  scary maxes (31–76s) are **background/suspended-tab flushes** in low-load
  minutes, not server or queue — confirmed by busy-minute correlation.
- Per-field byte totals across the catalog: `item_attributes` 410K,
  `item_uoms` 215K, `item_name` 172K, `modified` 148K, `item_barcode` 148K,
  `item_group` 96K, `item_code`/`name` 58K each, `variant_of` 47K,
  `attributes` 33K.

### What we DID ship (2026-07-15)
- **nginx gzip on the origin→Cloudflare hop** (`muelle` proxy
  `nginx.conf.template`): origin was sending everything uncompressed to CF
  (CF re-brotli's to clients, but the origin hop was raw). `application/json`
  + text now gzip'd → the 4.7 MB origin→CF hop drops to ~1 MB. Verified: a
  proxied `/login` returns `Content-Encoding: gzip`. **This is the payload win
  that matters** — it's the only lever that's both real and zero-risk.

### What we deliberately did NOT do (and why)
- **Do NOT trim `item_attributes` (410 KB).** It LOOKS like dead weight, but
  it is **load-bearing for OFFLINE variant selection**. Trace:
  `add_item`→`handleVariantItem` (`useItemCreation.ts`) does
  `items.filter(it => it.variant_of == parent)` against the LOCAL catalog and
  only calls `get_item_variants` `if (!variants.length)`. For a fully-synced
  offline catalog the variants are always local ⇒ the fetch is skipped ⇒ the
  variant dialog builds its attribute filter from the **catalog rows'
  `item_attributes`** (`Variants.vue:286-293`). Trimming it silently breaks
  variant items (sizes/colours/storage) offline. `attributes` (33 KB) + `idx`
  + `default_bom` + `conversion_rate==1` are the only genuinely-safe trims —
  ~50–100 KB pre-gzip / ~10–20 KB post-gzip — not worth the cache-version
  churn now.
- **Delta-first bootstrap is ALREADY built** and is not a task.
  `itemsStore.initialize` reads IndexedDB first (`loadCachedItems`) and skips
  the full pull on a warm cache; the `SyncCoordinator`/`sync_items` resource
  (`offline/sync/adapters/items.ts`) is a proper watermark delta with
  deletion reconciliation + a separate `item_prices` resource (so it does NOT
  have the "price change doesn't bump `Item.modified`" staleness trap that a
  naive `get_items(modified_after=…)` would). On Doco (`posa_use_limit_search=1`)
  the itemsStore does server-side search and never full-pulls in normal ops;
  the 4.7 MB only fires on force-reload.

### Tech-debt: the two-writer double-fetch (scoped, low urgency)
Two systems write the same IndexedDB `items` store:
1. `itemsStore.backgroundSyncItems` (`useItemsSync.ts`) — a full `get_items`
   pager, **no watermark, no deletion handling** (the inferior one). Gated by
   `shouldPersistItems()` which is **false when `limitSearchEnabled`**.
2. `SyncCoordinator` `syncItemsResource` — the correct delta sync.

So the double-fetch only fires on **limit-search-OFF** tenants
(`ventas.mumulenceria.com`, the near-idle one); **Doco is unaffected**
(Writer 1 gated off). Proper fix = **retire Writer 1's full-pager, make the
SyncCoordinator the single catalog persister, hydrate the itemsStore display
from IndexedDB** (`loadCachedItems` already exists). But it touches the
boot/display/client-search hot path for a win confined to the idle tenant, and
gzip already covers the wire cost — so treat it as **deliberate tech-debt: do
it when that area is next touched, not as a standalone perf sprint.**
