# Cafetería — the golden flow

Status: acceptance contract for the 2026-08-23 cafetería polish round
Companion: `RESTAURANT_UX_MAP.md` (interaction contract, still binding),
`RESTAURANT_TABLES_SPEC.md` (data model), register-hifi artboards
`Cafeteria.dc.html`, `Salon.dc.html`, `SalonCuenta.dc.html`.

This document says **how the cafetería register should feel**: one loop a
waiter can hold in their head, no dead verbs, no jammed panels. Everything in
it was measured against the built register on demo.lab at 1718×1023 on
2026-08-23; the "today" notes name what drifted.

## 0. The two loops

### Counter loop (walk-up, cup on the bar)

```
Venta → search/menu → (variant picker) → cart
      → name on cup (optional) → PAGAR            ← pay-first, artboard Cafeteria
```

Unchanged from what shipped. `PAGAR` stays the primary verb whenever the sale
is **not** owned by a table order.

### Salón loop (seated service)

```
Salón → tap free table → «Abrir mesa» → lands on Menú, mesa context visible
      → add round → «GUARDAR · VOLVER AL SALÓN»   ← save-first, THE missing verb
      → tile fills: name · total · minutes
      → later: tap table → Agregar ronda | Enviar a cocina | Cobrar
      → Cobro settles the ORDER (settleTableOrder), never a bare invoice
      → tile turns «Por limpiar» → Marcar limpia → libre
```

The register's primary verb is **contextual**: a sale owned by a table order
saves-and-returns; a walk-up sale pays. Both loops share the same cart, the
same catalogue, the same Cobro.

## 1. Backing — why the board lied

Table service **requires `invoice_mode = "Record Only"`** on the capability
profile. That is the one mode where the cuenta is backed by a POS Table Order:

- the cart→order line sync (`floorCartSync.ts`) is *deliberately inert* in any
  other mode — this is why a round added to Mesa 1 left `PARTIDAS 0` and the
  tile at `$0.00` on the demo;
- a draft Sales Invoice dies with its shift (close force-deletes drafts), so a
  draft cannot back a table that outlives one waiter's turn;
- the floor snapshot reads POS Table Orders — SI-backed "cuentas" render every
  table free.

Contract: a capability profile that grants `tables` without
`invoice_mode = "Record Only"` is a misconfiguration. The profile's validate
now says so (warning, not throw — existing registers must keep booting).

Demo consequence: the cafetería preset moves to Record Only; the three
showcase cups convert from parked draft SIs to table orders («Sofía» seated on
Mesa 4 per the artboard, «Mesa Terraza» on Terraza 1, «Marco (grande)» a named
tab on the cup rail). The Borradores surface stops being the place cuentas
hide.

## 2. Salón owns the full stage

Today the floor renders inside the 5/12 selector column beside the cart: a
616px-wide authored room in a ~440px slot → horizontal scroll, clipped Barra,
the ticket rail painted over Mesa 3, and a duplicated giant PAGAR band that
belongs to a sale the waiter is not looking at.

Contract (artboard `Salon.dc.html`):

- While Salón is the active view it takes the **full stage** — the invoice
  column is hidden, the sale's band is suppressed (the sale itself stays
  mounted; nothing is lost).
- Layout: plan (flex) + **352px mesa sheet** on the right when a table is
  selected + the salón's own band below.
- The plan fits the authored room with **no horizontal scroll at ≥1280px**;
  below that it fit-scales (the existing fit rule, now with room to work).
- The band is the floor's: selected cuenta identity + big total on the left,
  salón stats (ocupadas x/y · cuentas abiertas · por limpiar) in the middle,
  **COBRAR CUENTA** as the single primary on the right — only when the
  selected cuenta has lines. No second PAGAR anywhere on this screen.
- The mesa sheet follows the artboard: identity row (table, guests, opened,
  age), one card per cuenta on the table (name, total, line count, state
  chips), verb grid (Agregar ronda · Mandar a cocina · Imprimir cuenta ·
  Traspasar · Liberar), split-bill warning when >1 cuenta.
- `FloorView` stays mounted with the shell (dock badge, socket room) exactly
  as today; only its width changes.
- Cup rail («named tabs») keeps its lane; its empty copy must not say «sin
  cuentas abiertas» while a mesa cuenta is open — it is the *table-less* rail
  and says so.

## 3. The mesa-owned sale (artboard `SalonCuenta.dc.html`)

When the cart holds a table order (`floorStore.activeOrder` set):

- A **context strip** above the ticket: `Mesa 1 · Interior · 2 personas ·
  Comer aquí · abierta hace 12 min`, with a «Volver al salón» link. This
  replaces guessing from the generic customer row.
- The identity fields row (Nombre en cuenta · comensales · servicio) stays for
  cup/tab sales; for a mesa sale the mesa strip carries identity and the name
  field edits the cuenta label.
- **Band primary: `GUARDAR · VOLVER AL SALÓN`** — flushes the line sync,
  detaches the order, clears the register, lands on Salón. This is the verb
  that exists today only as an 800ms debounce nobody can see. Secondary,
  same band: «Enviar a cocina» (fire, stay), «Cobrar» (payment path).
- Sync visibility: while the debounce/push is in flight the strip shows
  «guardando…», settling to «guardado» — the waiter must never wonder whether
  the round landed.
- «Cancelar venta» on a mesa sale abandons the *cart edits*, never the order:
  copy says so.
- Charging a mesa sale routes `settleTableOrder` (flush → settle → board
  repaint). Success clears cart AND detaches the order; the tile flips to
  «Por limpiar».

## 4. The cart earns its ticket look

The invoice table today at cart widths: item-name column crushed to one
letter, headers truncated («Tasa de List», «Descuer»), eight columns fighting
for 900px. The artboard ticket is three things per line: `2× Capuchino grande
· 96.00` with a modifier subline.

Contract:

- The item **name never collapses**: it is the flexible column with a real
  minimum; price-list rate / discount% / discount amount **collapse into the
  expanded row editor** below a measured width threshold instead of
  truncating headers. Qty, name, amount survive at every width.
- No column may render narrower than its own header.
- This is responsive-by-measured-width (the cart lives beside a drawer whose
  width changes), not a vertical fork — retail benefits identically.

## 5. Catalogue footprint

Both anchored modes take the floating footprint: **LISTA and TARJETA anchored
= `min(62%, 720px)`** (the floating card width Marco approved). Floating
stays as is. The cart's responsive collapse (§4) is what makes the wider
drawer safe at 1280px.

## 6. Small regressions in scope

- **Borradores list**: ticket ids wrap into the next row's line
  (`ACC-SINV-2026-00192` colliding). Id cell: nowrap, ellipsis, min-width.
- **Identity fields**: a value typed into «Nombre en cuenta» renders under
  its floating label; «Comensales» label clips to «Co…». Labels must float
  when filled and fit when empty, at the one-row sizes.
- **Variant leak**: typed search offers «Jugo de Naranja Chico» beside its
  template (and with a placeholder image) even with
  `posa_hide_variants_items = 1` — the hide filter must hold on every read
  path the register uses (server search AND the offline cache the typed
  search actually hits). One tile per drink; sizes live in the picker.

## 7. Acceptance

At 1718×1023 and at 1280×900, on the cafetería demo:

1. Free table → open → add 2 items → **GUARDAR · VOLVER** → tile shows name,
   total, minutes; cup rail unchanged.
2. Reopen the table → both lines present → add 1 → guardando→guardado →
   volver; tile total updated.
3. Cobrar from the mesa sheet → Cobro completes → order settled (server row
   gone), tile «por limpiar» → marcar limpia → libre.
4. Named tab from the cup rail: same loop, no floor occupancy.
5. No horizontal scroll on Salón; no second PAGAR while Salón or a mesa sheet
   is on stage; no cart column narrower than its header with the drawer
   anchored open in both LISTA and TARJETA.
6. Walk-up sale with no table: exactly the shipped counter behaviour,
   PAGAR primary.
7. Golden flow (demo-abarrotes) stays green — retail must not notice this
   round.
