# Catalog table freeze on customer/price-list switch + search

Open issue. Not fixed this session. Documenting for the next one so we
don't reinvent the diagnosis.

## Symptom

After switching customer (or price list) and then typing in the items
search box, the POS hangs for tens of seconds. Operators have reported
this as "POS crashes". Captured on the then-current retail lab site
2026-05-13 at 18:53 UTC.

## Measured evidence

```sql
SELECT event_timestamp, event_name, value FROM `tabPOS Telemetry Event`
WHERE event_timestamp BETWEEN '2026-05-13 18:52:00' AND '2026-05-13 18:54:00'
  AND event_name IN ('rum:longtask', 'rum:inp');
```

- One `rum:longtask` of **32,725 ms** at startTime 204451 ms (18:53:13).
- Multiple `rum:inp` events on `keydown`/`keypress` to the search input
  during the same window, each carrying the same processing-start
  offset that lines up with the longtask. The browser is dropping
  input updates onto the same blocked main thread.

No `perf:*` custom marks fire inside the freeze window. The slow path
does NOT go through `withPerf`, so the existing telemetry won't tell
us *which* function is hot. A devtools profile (Performance tab,
"start recording" → change customer → type fast → "stop") is the
next diagnostic step.

## Root cause hypothesis

Cart-table fix in Phase 2 (commit `fdf1a148`) replaced the cart's
`v-data-table-virtual` with a native `<table>`. The cart only holds
~15 rows, so virtualization was overhead.

The **catalog** table at
`frontend/src/posapp/components/pos/items/ItemsSelectorTable.vue`
holds 5 k+ rows and STILL renders through `v-data-table-virtual`.
That component generates per-row dynamic CSS rules + watchers; when:

1. customer change → fetches details → updates `selected_price_list`
2. price-list change watch fires → `applyPriceListToItems` schedules
   400-row chunks via setTimeout / requestIdleCallback
3. operator types a character → searchItems → filteredItems mutates
   → Vuetify table re-evaluates per-row attrs across the visible
   window

step 2 and step 3 compete for the main thread. While the chunk loop is
still mid-walk through the 5 k items, the search-driven render path
queues up its own per-row work. Result: a single long task that holds
the thread until everything settles.

This is the same shape as the cart-row freeze cured by Phase 2 — same
fix would apply, but the catalog table can't drop virtualization
(5 k rows is too many to render natively). It needs a virtualization
layer that doesn't pay Vuetify's per-row cost.

## Attempted fix (reverted)

Tried swapping `v-data-table-virtual` for `vue-virtual-scroller`'s
`DynamicScroller` + `DynamicScrollerItem` (already in deps). Wrote
~330 LOC replacement that preserved every consumer-side contract:

- `displayedItems` / `headers` props
- emits `row-click(event, { item })` and `list-scroll(event)`
- `itemClass` / `rowProps` as Function | Object | string
- `scrollToIndex(index)` exposed, delegates to `scrollToItem`
- header row pinned, CSS-grid alignment per `header.width`

Smoke spec dropped from 9/9 to 6-7/9. Manual reproduction in the
browser via Playwright showed:

- the search filter still narrowed items (DOM has the right rows)
- `<div data-item-code="IPN…">` was visible at the right viewport
  position
- clicking the row fired the native click handler (capture-phase
  listener saw the event)
- BUT Vue's `@click` binding on the inner div did not invoke
  `handleRowClick` after the row was recycled by DynamicScroller —
  no addItem, no cart total update.

Bypass attempt (delegate `@click` to the scroller wrapper, walk
`event.target.closest("[data-item-code]")`) ALSO did not trigger the
parent's `@row-click` listener consistently. The change was reverted.

The pattern that DOES work today is what `ItemsSelectorCards.vue`
uses with `RecycleScroller`: render a CHILD COMPONENT inside the
slot (`<ItemCard ... @click="handleItemClick">`) — Vue tracks the
component's `emit("click", ...)` independently of DOM recycling.

## Recommended next step

Extract the catalog row into its own SFC (e.g. `CatalogItemRow.vue`)
that receives `item` + the formatter funcs as props and emits
`@click` with `(event, item)`. Render that component inside
`DynamicScrollerItem`. That matches the working pattern in
`ItemsSelectorCards.vue` line 28-68 and side-steps the recycle-vs-Vue
listener mismatch.

Sketch:

```vue
<!-- ItemsSelectorTable.vue -->
<DynamicScroller :items="displayedItems" ...>
  <template #default="{ item, active }">
    <DynamicScrollerItem :item="item" :active="active">
      <CatalogItemRow
        :item="item"
        :columns="columns"
        ...passthrough props...
        @click="handleRowClick"
      />
    </DynamicScrollerItem>
  </template>
</DynamicScroller>
```

```vue
<!-- CatalogItemRow.vue -->
<template>
  <div :class="['posa-row', ...]" @click="$emit('click', $event, item)">
    ...cells with rate / actual_qty slots...
  </div>
</template>
```

Smoke spec already prefers `[data-item-code="…"]` selectors when
present (commit `d951d6e..` line, see addItem helper) — adding the
attribute on the new row component will make the spec match both
implementations without further change.

## Quick-win mitigations to consider FIRST

Before the full virtual-scroller rewrite, a few cheaper experiments:

1. **Debounce searchItems input handler** to 200-300 ms. Today the
   filter recomputes per keystroke. With the catalog still on Vuetify,
   a 250 ms debounce coalesces a fast typer's 5 keystrokes into one
   filter pass.
2. **Defer pricing-rule reschedule** while a search filter is active.
   `schedulePricingRuleApplication` fires on every changeVersion bump;
   if the operator is typing fast, queue the apply for `idle` instead
   of microtask.
3. **Cap displayedItems** to the first ~200 matches when search is
   non-empty. Operators don't scroll past 200 rows of a search result;
   the rest is wasted virtualization budget.

(1) is ~10 LOC + one Playwright test. (2) is a one-line `scheduleIdle`
swap. (3) is the cheapest paint-time win without changing the table
component. Any of them would buy time before the bigger refactor.

## Files mapped during this session (read-only, useful next time)

- `frontend/src/posapp/components/pos/items/ItemsSelectorTable.vue`
  (306 LOC, the freeze site)
- `frontend/src/posapp/components/pos/items/ItemsSelector.vue:120`
  (only caller; consumes `@row-click` + `@list-scroll`)
- `frontend/src/posapp/composables/pos/items/useItemSelection.ts:273`
  (`handleRowClick({ item })` — destructures the payload)
- `frontend/src/posapp/components/pos/items/ItemsSelectorCards.vue:28-68`
  (working RecycleScroller pattern to copy)
- `frontend/src/posapp/stores/itemsStore.ts:732` (`searchItems` —
  debounce target for mitigation 1 above)
- `frontend/src/posapp/components/pos/invoice/invoiceWatchers.ts:147`
  (`changeVersion` watcher that triggers
  `schedulePricingRuleApplication` — defer target for mitigation 2)

## Telemetry queries to keep an eye on

```sql
-- Longest longtasks last 24h
SELECT event_timestamp, value
FROM `tabPOS Telemetry Event`
WHERE event_name = 'rum:longtask' AND event_timestamp >= NOW() - INTERVAL 1 DAY
ORDER BY value DESC LIMIT 20;

-- INP regression check
SELECT DATE(event_timestamp) AS day, MAX(value), COUNT(*)
FROM `tabPOS Telemetry Event`
WHERE event_name = 'rum:inp' AND event_timestamp >= NOW() - INTERVAL 14 DAY
GROUP BY day;
```
