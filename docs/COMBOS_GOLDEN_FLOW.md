# Combos — the golden flow

Status: acceptance contract for the 2026-08-23 combos round
Companion: `POS-WORLDCLASS-ROADMAP.md` §17.6 (the P1 promotion),
`POS-RIEL-Y-CAJON-BUILD.md` §11-D, `api/combos.py` (module docstring is the
data-model contract), `comboAvailability.ts` (the availability decision,
made 2026-08-22).

**Art: already drawn — no new artboard.** The register canvas carries the
combo cart line (`Main.dc.html`: `COMBO · 3` badge, component list, saving),
the drawer's Combos category, the up-sell strip tiles, and the cafetería's
COMBO menu tiles (`Cafeteria.dc.html`). This round converges code and data to
the existing drawings.

## 0. What is already true (verified on branch, 2026-08-23)

- A combo IS an ERPNext **Product Bundle** — components, and per-component
  stock decrement on sale, come free from `packed_item.py`. No second source
  of truth.
- `api/combos.py` read model: `get_combos` / `get_combo_components` return
  bundles enriched with rate, list-price sum, SAVING, per-component
  `actual_qty` + `is_stock_item`; `POS Combo` overlay doctype optionally
  curates which bundles a register shows (none defined → all enabled bundles).
- Availability DECIDED and implemented client-side: min over STOCK components
  only (services/labour never cap), enforcement rides the register's existing
  `posa_block_sale_beyond_available_qty` — no combo-specific policy.
- `ComboCartLine.vue` (badge + components + saving), `ComboSuggestionStrip.vue`
  (Enter hint, savings, low-stock), mobile browse/sale parity, and combo
  return allocation (`comboReturns.ts`, largest-remainder so centavos never
  invent money) are all shipped.

## 1. The one code gap

`Pos.vue` holds `comboOffers = ref([])` behind a stale comment ("not fetched
yet"). Nothing ever calls the read model, so the drawer never grows its
Combos category and the strip never renders, anywhere, with any data.

Contract for the fetch:

- Load once per register activation (profile resolved), refresh on catalog
  sync completion and on customer change ONLY if the price could differ
  (the read model takes `customer` for pricing) — no polling.
- Offline: last successful answer is cached (Dexie, register-scoped) and
  served with the same honesty rules as the item cache; no cache → no combo
  UI, never a stub.
- Failure: log, render nothing, retry on next natural trigger. The strip's
  absence is the degraded state — the sale path never waits on combos.
- The fetch lives in a composable (`useComboOffers`), not inline in the
  shell god-file; `Pos.vue` gains only the call.

## 2. The loop

```
Suggest  → strip under the cart («se suele llevar junto», Enter adds first)
Add      → cart line: COMBO · n badge, components under the name, saving shown
Charge   → normal tender; packed items decrement component stock
Return   → combo line returns whole or partial; refund allocation by
           largest remainder over component list prices
```

Availability chips on tiles and qty ceiling in the cart follow
`comboAvailability.ts` — a combo behaves like a plain line under the
register's own stock policy.

## 3. Demo data (doco side)

The feature is invisible until a tenant has bundles. Seed the flagship demo:

- **Celulares** (the design's reference): `COMBO-PROTECCION` = Case +
  Mica Cristal + Instalación (service, non-stock) at a bundle price with a
  visible saving; a second hardware-only bundle for the availability chip.
- **Cafetería**: `CAFE-COMBO-DESAYUNO` = Café americano CH (variant) + Jugo
  de naranja CH (variant) + Molletes, priced 129 per the artboard; and
  `CAFE-COMBO-CONCHA` (Café + Concha, «ahorra $12»).
- Bundle parents are non-stock sales items with their own Item Price;
  components reference the exact sellable variants. Idempotent dress,
  uuid-stable codes, degradation when Product Bundle is unavailable.
- Optional `POS Combo` overlay rows only if needed to scope per register;
  default (none) is fine for the demo.

## 4. Acceptance (live, both demo registers)

1. Sale view with a case in the cart → strip offers the protección combo
   with its saving; Enter adds it.
2. Cart shows the combo line per the artboard: badge, components, saving;
   qty ceiling respects component stock (hardware bundle) and ignores the
   Instalación service.
3. Submit → component stock decremented (verify per component in bench);
   invoice carries packed items.
4. Return the combo partially → refund allocation matches
   `comboReturns.ts` math, no centavo invented.
5. Cafetería: Combos render as menu tiles; Combo Desayuno adds its three
   components' variants correctly.
6. Offline: with a warmed cache the strip still renders; with a cold cache
   nothing renders and the sale path is unaffected.
7. Golden flow (demo-abarrotes) stays green — a register with no bundles
   shows no combo UI at all.
