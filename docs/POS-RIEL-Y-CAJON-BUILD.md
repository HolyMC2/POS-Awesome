# Riel y Cajón — register shell build plan

Status: **wave 1 in flight**
Owner: Doco Mexico · PM lead + 6 build agents
Design reference: [`muelle-site/design/register-hifi`](../../muelle-site/design/register-hifi) — direction E, 22 artboards, 5 pages
Roadmap authority: [`POS-WORLDCLASS-ROADMAP.md`](POS-WORLDCLASS-ROADMAP.md) §5, §6, §14 Product 2, §17.2, §17.6, §17.7
Work log: [`POS-RIEL-Y-CAJON-LOG.md`](POS-RIEL-Y-CAJON-LOG.md)

Baseline commit: `3fd6049f4` — 238 spec files / 1719 tests green, `vue-tsc --noEmit` clean.
Every number below is measured against that baseline, not against a guess.

---

## 1. What this wave is

The canvas is DESIGN (§17.7). This plan is the part of it that becomes code now:
the **universal register shell**, which every certified mode inherits, plus
**combos**, which §17.6 promoted into Scan Retail and Repair+Retail.

Explicitly NOT in this wave, and not because we ran out of time — because §14
gates them behind contracted evidence: Cafetería (§4.3), Salón (§4.4) and
Controlado (§4.2) mode features. The shell they are drawn on ships; their
mode-specific surfaces do not.

### The two invariants

Both come from §17.7 and both are enforced by tests, not by review, because a
property a reviewer has to remember is a property that decays:

1. **One number, one action.** The bottom band carries exactly one number and
   exactly one primary action at any moment — total, change, difference,
   balance due, refund, recharge, opening float, amount queued. Fixed 60 px,
   one lane, tinted by state.
2. **One accent.** Exactly one saturated colour per screen, on the primary
   button. Amber and green are STATE, never emphasis. This invariant is what
   makes the raised density safe; lose it and the density becomes noise.

---

## 2. Architecture change, stated plainly

This is not a re-skin. Today `Drafts`, `InvoiceManagement`, `SalesOrders`,
`Returns`, cash movement and recargas are **dialogs** mounted inside
`Pos.vue`. The canvas promotes them to **rail destinations**. That converts
modal state into shell routing, and the risk of this wave lives there — in
routing, capability gating and offline availability — not in the CSS.

Nothing that currently works is rewritten. Destinations HOST the existing
components; the dialogs keep their logic.

---

## 3. File ownership map — binding

Six agents write in parallel. Ownership is disjoint by path, and the
integration file is the lead's alone. An agent that needs a change outside its
paths REPORTS it; it does not make it.

| # | Task | Owns (writes only here) |
|---|---|---|
| T1 | Riel — rail navigation | `components/pos/shell/rail/**`, `composables/pos/shell/railDestinations.ts`, `…/useRegisterRail.ts`, `tests/rail*.spec.ts` |
| T2 | Cajón — catalogue drawer | `components/pos/shell/drawer/**`, `composables/pos/shell/useCatalogDrawer.ts`, `tests/catalogDrawer*.spec.ts` |
| T3 | Banda + acento único | `components/pos/shell/band/**`, `composables/pos/shell/bandState.ts`, `styles/register-tokens.css`, `tests/bandState.spec.ts`, `tests/actionBand*.spec.ts`, `tests/singleAccent.spec.ts` |
| T4 | Destinos — dialogs → destinations | `components/pos/shell/destinations/**`, `composables/pos/shell/destinationRegistry.ts`, `…/useDestinationRouting.ts`, `tests/destination*.spec.ts` |
| T5 | Móvil — dock parity + `orden` | `vertical/viewContracts.ts`, `posawesome/doctype/pos_capability_profile/pos_capability_profile.py`, `components/pos/shell/mobile/**`, `tests/dockTab*.spec.ts`, `tests/mobileOffline*.spec.ts` |
| T6 | Combos | `components/pos/combos/**`, `composables/pos/combos/**`, `posawesome/doctype/pos_combo*/**`, `posawesome/api/combos.py`, `tests/combo*.spec.ts` |

**Lead only, nobody else touches:** `shell/Pos.vue`, `styles/theme.css`,
`components/navbar/**`, anything under `components/pos/items/**`,
`components/pos/Invoice.vue`, `components/pos/invoice/**`.

Agents build and unit-test their piece **standalone**. The lead wires them into
`Pos.vue` in wave 2. This is the only arrangement in which six writers on one
tree do not stomp each other.

---

## 4. Tasks

### T1 — Riel (rail navigation)

The rail is the ONLY desktop nav. No hamburger.

- `railDestinations.ts` — pure registry: `{ id, labelKey, icon, badgeSource,
  capability, shortcutActionId, offlineAvailability }`. No Vue import; unit
  testable without mounting.
- `RegisterRail.vue` — **96 px** column, 66 px items, amber badge pill
  top-right, active item white with `#00646f` label, bottom group Corte +
  avatar. (Corrected 08-22 from an earlier 88 px in this plan: T1 measured
  `Main.dc.html` — 96 px column, 9/8 px padding, 3 px gap, 12 px radius — and
  §17.7 makes the canvas the reference of record, so the artboard wins over
  the plan.)
- Order: Venta · Explorar · Orden de servicio · Gasto · Borradores · Facturas ·
  Devolución · Recarga — bottom: Corte de caja · avatar.
- Preset swaps through `verticalStore.t()` and the capability profile:
  cafetería renames Explorar → Menú, adds Salón, drops Recarga. The rail reads
  the preset; it never branches on a vertical NAME (§2).
- **Disabled until the shift opens** (§5.1). Until then the register genuinely
  cannot do anything, and the rail must look like it.
- Keyboard: roving tabindex, ↑/↓/Home/End, Enter/Space activate. `<nav>` with
  `aria-current="page"`, badges announced via `aria-label`, not colour alone.
- Offline: each destination declares available | queued | cached-read-only |
  blocked (§7). The rail dims the blocked ones with the amber dot, exactly as
  the mobile dock dims Cupones.

### T2 — Cajón (catalogue drawer)

The density win. The catalogue stops being a permanent 40 % column and becomes
a drawer over the sale, so the ticket gets the full width.

- `CatalogDrawer.vue` — hosts the EXISTING `ItemsSelector` through a slot. Do
  not rewrite, refactor or restyle `ItemsSelector.vue`; it is not yours and it
  changed last night.
- State machine in `useCatalogDrawer.ts`: closed → opening → open → closing,
  with `openReason` (`rail` | `scan-miss` | `shortcut` | `empty-cart`).
- Focus trap on open, ESC closes, focus returns to the invoking control, body
  scroll locked, scrim click closes.
- Remembers the last category per register within the session.
- **Snappy is a budget, not an adjective:** `transform`/`opacity` only, no
  width or height animation, no layout thrash on open. Honour
  `prefers-reduced-motion`. Target ≤ 200 ms to interactive, and prove it with a
  test that asserts the animated properties are compositor-only.
- Accepts a `categories` prop. Combos arrive through it from T6 — the drawer
  knows nothing about combos.

### T3 — Banda (action band) + acento único + densidad

Owns both invariants.

- `bandState.ts` — pure: `(context) → { value, label, tone, primaryAction,
  primaryEnabled }`. Tones: `neutral` | `positive` (change) | `warning`
  (shortfall) | `queued` (offline). No component imports.
- `ActionBand.vue` — fixed **134 px** band carrying a **60 px** number, one
  lane, tabular-nums. One primary button, and the accent lives only there.
  (Corrected 08-22: this plan said "fixed 60 px" for the BAND. Every artboard
  draws `height: 134px` around a `font-size: 60px`, and the `cheap` annotation
  — "el total baja de 60 px a 34 px" — only parses as type size. T3 built to
  the artboards and flagged the misreading.)
- Test the band against the canvas's own money, from
  `design/register-hifi/_rail.txt`, so the code and the reference cannot drift:
  ticket `B-04812` total `1,129.00` (subtotal 973.28 + IVA 155.72, 6 líneas /
  9 piezas); orden `RS-2048` saldo `2,130.00` (2,510 − 600 anticipo + 220
  mostrador); ticket `C-0184` total `351.00`; corte Caja 2 diferencia `−25`
  (1,500 + 5,120 + 600 − 1,830 = 5,390 esperado, 5,365 contado).
- `register-tokens.css` — the density scale and `--ac` accent variable,
  sourced from `styles/theme.css` values already in the canvas: primary
  `#0097a7`, variant `#00838f`, container `#e0f7fa`, radius 6/10/14/18, touch
  target ≥ 44 px.
- `singleAccent.spec.ts` — **source-scan** every shell surface and fail if more
  than one saturated accent appears outside the primary button. Scan rather
  than mount, because the guarantee is "no such declaration exists".

### T4 — Destinos (dialogs → rail destinations)

- `destinationRegistry.ts` — maps a rail id to its component, its capability
  gate, its offline availability and its shortcut action id.
- `DestinationHost.vue` — renders a destination full-surface. It ADAPTS the
  existing dialog components; it does not fork them.
- Deep link, browser back, and the shortcuts engine (§17.3) all resolve to the
  same destination state. One source of truth for "where am I".
- A destination that is capability-gated off must be unreachable by URL too,
  not merely hidden in the rail.
- Tests: every rail id resolves to a mounted destination; gated ids refuse
  both rail and URL; offline availability is declared for all of them.

### T5 — Móvil (dock parity, `orden` tab, offline overlay)

The mobile contract already exists in code and is parity-tested. Adding a tab
is a **three-link change in one commit**, and the file's own comment says why:
a backend-allowed id missing from the frontend tuple renders a blank tab, and
a missing `DockTabDef` fails `vue-tsc`.

1. `DOCK_TAB_IDS` in `vertical/viewContracts.ts`
2. `VALID_DOCK_TABS` in `pos_capability_profile.py`
3. `DockTabDef` in `buildDockTabDefs`

- Badge source: a new open-count beside `floorOpenOrdersCount`.
- The repair preset spends `floor`, which it never uses, on `orden`.
- **Offline is a state, not a destination**: the overlay sits on top of what
  the cashier was doing, the dock stays visible, and Cupones dims with an
  amber dot because it needs signal.
- Extend the existing cross-stack parity test — do not write a second one.

### T6 — Combos

Money path. Arithmetic goes in pure modules with their own tests, never inside
a component (the pattern `itemPricing.ts` and `discountIntent.ts` already set).

- Bundle doctype with component lines; price override with the displayed
  saving; stock decrement per component; return and partial-return semantics.
- Cart line carries a `COMBO · n` badge, the component list, and the saving.
- A Combos category surfaced to T2's drawer through its `categories` prop.
- Up-sell in the "se suele llevar junto" strip.
- **Open decision — availability.** §17.6 records that
  `availability = min(components)` is the DESIGN's claim and needs a back-end
  decision before build. Create `composables/pos/combos/comboAvailability.ts`
  with the signature, the surrounding context and a `TODO(owner)` marker, and
  build everything else around it. Do not guess this rule; it decides whether
  a combo can oversell.

---

## 5. Verification — what "done" means

Nothing is done on an agent's word. The lead runs all of it centrally.

| Gate | Command | Bar |
|---|---|---|
| Types | `node_modules/.bin/vue-tsc --noEmit` | exit 0 |
| Unit | `node_modules/.bin/vitest run` | ≥ 1719 tests, 0 failures |
| Lint | `node_modules/.bin/eslint .` | no new errors |
| E2E | `pnpm test:smoke` (playwright, both `/app/posapp` and `/posapp`) | green on lab |
| Visual | screenshot harness, 3 viewports | every surface captured, before + after |
| Perf | §6 budgets on the reference hardware (i5-6500 / 8 GB) | no regression |

### Devices

1440×900 desktop · 1024×768 tablet · 390×844 phone. The 1100 px boundary
matters: above it the two-column register is viewport-locked, below it the
compact switcher shows one panel and the 769–1099 band still scrolls through
`.page-content` — `tests/defaultLayoutMainScroller.spec.ts` guards that and
must stay green.

### Screenshot evidence

Captured to `docs/design-evidence/`, before and after, at all three
viewports, so the change can be judged against the canvas rather than
described. The lead builds this harness during wave 1 and captures the
BEFORE set from the baseline commit.

---

## 6. Waves

- **Wave 1 (in flight)** — T1…T6 build standalone components + unit tests.
  Lead in parallel: this plan, the log, the screenshot harness, the BEFORE
  capture.
- **Wave 2** — lead integrates into `Pos.vue`, runs every gate, captures
  AFTER, deploys to lab via `dev-refresh.sh`.
- **Wave 3** — three auditors, no more (audit waves stay small): contrast and
  WCAG 2.2 AA; money-path and invariant conformance; performance against §6.

---

## 7. Rules every agent follows

- Re-read a file immediately before editing it. Parallel writers land between
  your reads.
- Write ONLY inside your owned paths. Need something else changed? Report it.
- No `git add`, no `git commit`, no `bench`, no `docker`, no `ssh`, no
  `dev-refresh.sh`. The lead owns every commit and every deploy.
- Spanish is the operator language; new strings go to
  `posawesome/translations/es.csv` **by report, not by edit** — one file, six
  writers, guaranteed conflict.
- Comments explain WHY, in the voice the surrounding code already uses. Match
  the density you find; this repo comments load-bearing decisions and skips
  the obvious.
- Deliver your report as your FINAL MESSAGE in structured markdown. Report
  files are hook-blocked; the lead persists what it needs.

---

## 8. Rulings made during the wave

Recorded here rather than in chat, because an agent joining late needs them.

### R1 — Destination ids are English, single namespace (08-22)

T1 shipped `railDestinations.ts` with English ids (`sale`, `browse`,
`serviceOrder`, `expense`, `drafts`, `invoices`, `return`, `recharge`,
`closing`); T4 had begun with Spanish (`venta`). **English wins**, and every
surface — rail, destinations, dock, evidence lane — imports the one exported
union rather than re-declaring it.

Three reasons. Every existing cross-stack id is already English
(`DOCK_TAB_IDS = ["browse","offers","cart","coupons","pay","floor"]`), and the
parity test spans a Python backend where a lone Spanish tuple would stay odd
forever. Operator language belongs in `t()` / `__()`, never in an identifier —
the same rule §2 states as "capabilities, not vertical-name conditionals", and
the reason a cafetería can rename Explorar to Menú without touching an id.
And one namespace with a slug applied at the router boundary
(`serviceOrder` → `/service-order`) beats two id sets kept in sync by hand.

**Deviation on the record:** roadmap §17.6's addendum writes the new dock id
as `orden`. That is prose describing the change, not a code contract, and the
lead overrode it. The three-link change lands as `serviceOrder` on all three
links.

### R2 — Rail is 96 px (08-22)

Corrected in §4 above. The artboard is the reference of record.

### R3 — Gated destinations are absent, not disabled (08-22)

A carnicería's rail has no Recarga at all, rather than a greyed one. §4.2's
rule is that what the giro does not use does not appear. Accepted.

### R4 — Offline availability is an unverified design claim (08-22)

Nothing in the app declared per-surface offline availability before this wave,
so T1's `blocked` markings on `floor`, `serviceOrder`, `invoices`, `return`
and `recharge` are design assertions, not measurements. A wrong `blocked`
hides a surface that would have worked — the worse direction of the two
errors. **Routed to a wave-3 audit against the actual offline queue
implementation.** It does not ship on assertion, and the module says so in a
comment.

### R5 — Test-hook attribute is `data-testid` (08-22)

The repo carries both: `data-test` (139 uses, older) and `data-testid` (49,
all from the 2026-08 features — discount dialog, price check, change-due,
cash-movement direction). New shell code uses `data-testid`. Noted because the
raw counts argue the other way and a future "standardize on the common one"
sweep would break the newest specs.

### R6 — `tests/visual/**` excluded from vitest (08-22)

`vitest.config.ts` excluded `tests/smoke/**` and `tests/e2e/**` but not the
new `visual/**`, so vitest collected a Playwright spec and failed on its
fixture — surfacing as mystery unit failures in several agents' full-suite
runs. Fixed at the config, not by moving the lane.

### R7 — `_rail.txt`'s corte is one peso stale (08-22)

T3 found the shared note and the artboards disagree, and the artboards are the
copies that reconcile across screens:

| | `_rail.txt` | `Corte.dc.html` |
|---|---:|---:|
| salidas | 1,830 | **1,829** |
| esperado | 5,390 | **5,391** |
| contado | 5,365 | **5,366** |

Both sets yield −25, which is why it went unnoticed. `Apertura.dc.html` reads
"Ayer cerró con **$5,366**", matching the artboard and §17.7's own claim that
the close hands forward to the opening. **The artboards win**; the code asserts
their values and a test pins the drift, so correcting the note later cannot
silently "fix" the code the wrong way.

### R8 — the default keymap must bind every registered action (08-22)

The lead added five action ids to `shortcuts/actions.ts` believing an unbound
action was legal — `actions.ts` said so in a comment. It is not:
`shortcutsEngine.spec.ts` asserts `resolved.unbound` is empty AND that every
bound action has an entry in `INVOICE_SHORTCUT_EFFECTS`. **Registering an
action is a three-file change**: name it (`actions.ts`), give it a chord
(`keymap.ts`), implement it (`invoiceShortcuts.ts`). The misleading comment is
fixed.

Chords chosen: `alt+g` gasto · `alt+i` invoices · `alt+o` orden · `alt+t`
tiempo aire · `alt+b` catalogue · `f9` close shift (joining `f7` details and
`f8` lock). Mnemonics follow the OPERATOR's Spanish word, because that is the
word in the cashier's head. **Deliberately not F4**, which the artboard draws
on the catalogue: F4 has meant `employee.switch` since before the engine
existed and this pack's contract is that trained fingers keep working. The
mock's chip is the thing that is wrong.

The six effects emit ONE bus event carrying a destination id
(`open_destination`), not six named events — the rail, the router and the
chord all name the same destination, so a tenth destination should cost a
registry entry and nothing else.

### R9 — combos reuse ERPNext Product Bundle (08-22)

The plan said "bundle doctype with component lines". T6 checked reality first
and found that doctype already exists: ERPNext `Product Bundle`, already read
by `posawesome/api/bundles.py::get_bundle_components`, and
`erpnext/stock/doctype/packed_item/packed_item.py:102` already builds a
packing list for any sold item that is a non-disabled bundle's
`new_item_code`. **Per-component stock decrement is solved by the substrate.**
A parallel posawesome doctype would have forfeited that and forced a
hand-rolled decrement — the exact path to negative stock §11 calls
zero-tolerance.

`POS Combo` is therefore a thin overlay adding only `priority` and `targets`.
Optional: with zero rows every enabled bundle is offered, so combos work the
moment a bundle exists.

### R10 — partial combo returns refund the allocated share (08-22)

Returning one component of a 299 combo refunds its allocated share (70.35),
not its 80 list price. Refunding list hands back money never paid and is
arbitrageable: buy at 299, return one part at list, keep the rest for 219,
repeatably. Allocation is largest-remainder in integer cents so shares sum
exactly. The remainder keeps its discount and is marked `broken` rather than
repriced — repricing survivors at list raises a price *during a return*,
which is indefensible at the counter.

---

## 9. Wave 3 — audit scope

Three auditors, no more. Audit waves stay small because a wide one produces
findings nobody has time to verify, and an unverified finding is noise.

### A1 — accessibility and contrast (WCAG 2.2 AA)

Rail keyboard model and ARIA (roving tabindex, `aria-current`, badge counts
announced rather than shown by colour alone); the drawer's split semantics —
**anchored is not modal**, so a focus trap or `aria-modal` on the anchored
path is a defect, not a hardening; band contrast in light AND dark; touch
targets ≥ 44 px; `prefers-reduced-motion`. Measure contrast, do not eyeball
it — see the contrast-measurement traps memory: AA is 4.5:1 for body text and
the common error is measuring the wrong pair.

### A2 — money paths and invariant conformance

Combo pricing, the largest-remainder allocation and both return paths against
worked examples; band values against the artboards (§8 R7 — the artboards
win, `_rail.txt` is one peso stale); the single-accent scan's coverage, not
just its result; destination gating including by URL.

**Its first job is R4.** T1's `offlineAvailability` values are design claims,
never measured, and at least one is likely wrong: `frontend/src/offline/`
carries `restaurantQueue.ts`, `cash_movements.ts`, `invoices.ts`,
`invoiceOutbox.ts`, `customers.ts` and `stock.ts` — so `floor`, which T1 marks
`blocked`, has a queue implementation and is more plausibly `queued`. Verify
each of the ten destinations against what the queue and cache actually
support, and cross-check T5's independent `offlineSurfaceManifest.ts`, which
answers a DIFFERENT question ("usable with no server at all?") from
`offlineSyncStore.capabilitySummaries` ("has the cache downloaded this?").
Where the two disagree, that disagreement is the finding.

### A3 — performance against §6 budgets

The relevant ceilings, quoted: scan/click to cart paint ≤ 50 ms p95;
cart edit/recalculation ≤ 50 ms p95; local search result update ≤ 75 ms p95;
payment screen open ≤ 150 ms p95 (the closest analogue for the drawer and the
destination switch); warm launch to usable shell ≤ 1.5 s p95. Also the
budgets that are not latency: bundle transfer/parse per route, bounded DOM
nodes, and no listener/timer/worker growth across 500 sale cycles — a rail
and a drawer that mount once per shift are cheap; one that re-registers a
listener per destination change is not.

Reference hardware is pinned at i5-6500 / 8 GB. A number without the
benchmark manifest §6 requires is an observation, not evidence.

### Not an audit, but wave 3's other half

Re-capture the AFTER evidence set at all three viewports and lay it beside
`before/` and beside the artboards. The comparison is the deliverable; the
screenshots on their own are not.

---

## 10. Environment notes that cost agents time

Written down because three separate agents each rediscovered the first one.

- **`wrapper.emitted()` does not record component emits in this repo.** VTU
  captures only the native event that bubbles to the root, so an emit
  assertion fails while the component emits perfectly well. Use listener props
  (`{ props: { onPrimary: vi.fn() } }`). Already documented at
  `tests/changeDueDialog.spec.ts:93`; hoisted here because it was found the
  hard way three times in one wave.
- **In `<script setup>` the template's `$emit` is not bound on the setup
  proxy** — an inline `@click="$emit(...)"` compiles and never fires. Use the
  `defineEmits` return.
- **A top-level comment in a Vue template is itself a root node**, silently
  making the component a fragment and breaking `wrapper.attributes()`.
- **`node:fs` / `node:url` / `node:path` named imports do not interop under
  `@vitest-environment jsdom`.** File-reading specs must be node-env — that is
  why `cartActionBarLayout.spec.ts` is.
- **Four components import `../../stores/invoiceStore.js` against a `.ts`
  file** (`Invoice.vue`, `Returns.vue`, `SalesOrders.vue`, `Variants.vue`).
  Fine in the Vite build, throws under the vitest transform when those
  components load async. Stub the async component map in the spec.
- **`CatalogDrawer`'s panel never unmounts** (added 08-22 with the persistent
  slot). Anything passed to its default slot stays mounted for the register's
  lifetime. After the `useScannerInput` incident that is the right default, but
  it is a behaviour change: do not put something expensive there expecting it
  to be torn down on close.
- **`useScannerInput` attaches the keyboard wedge to the DOCUMENT**, behind a
  `document._scannerAttached` singleton. Any `v-if` that unmounts
  `ItemsSelector` makes attach/detach order-dependent and silently kills the
  shop's barcode gun. Never `v-if` that component; hide it with `v-show`.

---

## 11. Convergence checklist — `Main.dc.html`, node by node

Owner direction 2026-08-22: *"keep moving towards the artboard, that's golden."*
So convergence stops being impressionistic. `Main.dc.html` renders **133 text
nodes**; every one is listed below with its state. "Closer to the artboard" is
now a number.

### Shipped

| Artboard | Where |
|---|---|
| Rail: Venta · Explorar (badge 4) · Orden de servicio · Gasto · Borradores · Facturas · Devolución · Recarga · Corte | `RegisterRail.vue` |
| `Muelle POS` wordmark | navbar, §17.4 brand layer |
| `Escanear, buscar o explorar artículo…` | `ItemHeader`, teleported to `#register-scan-bar` |
| Cajón anchored, pushes, never covers | `CatalogDrawer.vue` |
| `PAGAR` on a 134 px band with a 60 px number | `ActionBand.vue` |
| `COMBO · 3` · `ahorra $41` · component list | `ComboCartLine.vue` |
| `quedan 10` availability figure | `comboAvailabilityDisplay.ts` |

### In flight (wave 4)

| Artboard | Owner |
|---|---|
| Customer strip: name · `Cliente frecuente · 11 compras · última hace 3 semanas` · `cambiar` · `Monedero $418` `CFDI 4.0 listo` `Lista Mostrador` `Garantía 90 d` | W4-F |
| `6 líneas · 9 piezas` · `Descuenta 9 piezas al cobrar` | W4-D |
| `F3 Borrador` `F5 Factura` `Esc Cancelar` chips replacing the button grid | W4-D |
| Totals as label/value pairs on one line | W4-D |
| One accent per screen across sale path and destinations | W4-D, W4-E |
| Dark mode, rail keyboard reach, band label contrast | W4-A, W4-B |

### Not yet built — the remaining gap, ranked

**A. The status line (nodes 13–19).** The artboard puts the register's whole
state on one line: `Ticket B-04812` · `Doco Ventas · Caja 2 · Jenni · turno
desde 09:02` · `vie 22 ago · 19:52` · `31 tickets hoy` · `Impresora lista` ·
`En línea · sincronizado` · `Saldo $1,240`. We carry printer, connection and
saldo as ICONS in the navbar, which is denser in pixels and thinner in
information — an icon says "printer" and the artboard says "printer ready".
Cheapest high-value item on this list: the data already exists in the shift
payload and the stores.

**B. Cart line anatomy (nodes 32–92).** Ours is `Name | QTY | Rate | Amount |
Actions`. The artboard is `Cant | Descripción | Existencia | Precio u. |
Importe`, and three differences carry weight:
- **Quantity comes FIRST**, as a `− 1 +` stepper, not a field to tab into.
- **`Existencia` is a column we do not have.** `quedan 5` on every line, not
  only on combos. A cashier learns stock without leaving the sale.
- **A subtitle per line**: `IPN001545 · Accesorios › Fundas y Carcasas` — code
  plus category breadcrumb, which is how an operator confirms they scanned the
  right variant.

**C. Scan-bar affordances (nodes 21–24).** `último: IPN001902` — what the last
scan actually resolved to, which is the fastest way to catch a mis-scan — plus
the `F2` chord chip and the `Explorar catálogo` button beside it. Note the
chips must render the BOUND chord, not the mock's: R8 stands, `alt+b` opens
the catalogue.

**D. `Se suele llevar junto` (nodes 93–107).** `ComboSuggestionStrip.vue`
exists and renders. The artboard adds `Enter para agregar el primero` and four
tiles with price and stock. Needs wiring to a real suggestion source and a
screenshot before it can be called shipped.

**E. `Cobrar con: Efectivo · Tarjeta · Transfer. · Mixto` (nodes 127–131).**
Tender chosen BEFORE the primary action, so PAGAR completes a decision already
made rather than opening a screen to make it. Real interaction-model change,
not decoration — it removes a step from every cash sale.

**F. `Margen estimado $457` · `Costo $672` (nodes 113–116).** Live margin and
cost beside the total. Genuinely new capability with a permissions question
attached — cost is not something every cashier should see. **Gate it behind a
role before building it**, and note §17.2 already shipped bidirectional margin
in `itemPricing.ts`, so the arithmetic exists.

Order: A, C and B are the register's information density and are cheap
relative to their effect. D is finishing something already built. E changes an
interaction and deserves its own decision. F needs a permission model first.
