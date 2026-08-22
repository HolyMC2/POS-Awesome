# Riel y Cajón — work log

Append-only. Newest entry on top. Plan: [`POS-RIEL-Y-CAJON-BUILD.md`](POS-RIEL-Y-CAJON-BUILD.md).

Each entry records what actually happened, including what failed. An entry that
only records successes is a log nobody can debug from.

---

## 2026-08-22 · Committed, deployed, and the artboard convergence begins

**13 atomic commits, `926428fa5` → `8a2e655d8`**, explicit staging throughout.
One needed amending: `ItemsSelector.vue` went into the shell-wiring commit
carrying scan-bar affordance bindings the message did not name — the exact
"message must match the cached stat" failure. Amended rather than left wrong.

Deployed, and the served stamp finally reads `8a2e655d875b` = HEAD. That was
the point of committing first: `version.json` stamps the COMMIT hash, so every
build of uncommitted work stamped identically while chunk hashes changed
underneath, and the service worker could neither confirm the new bundle nor
stop offering the old one.

### The AFTER set is valid at last

`Doco Ventas`, `railPresent: true`, `mobileDockVisible: false`. Rail, status
line, customer strip, scan bar with `Browse catalogue Alt + B`, action chips
carrying real resolved chords, and the band — all on a live register.

### And it showed the register saying everything twice

Three totals (band `$0.00`, `ACTIVE SALE MX$0.00`, `0.00 qty`), two count
strips that did not even agree on format, two connection indicators, two
customer names, and a ~270px empty-cart illustration whose copy said *"Add
items from the selector"* — a control that no longer exists.

The triple total is the one that matters: `bandState.ts` guarantees only one
number can be PRODUCED and cannot stop a second being RENDERED elsewhere. Same
gap that let the first double-total through. The fix is a count across the
whole sale surface, not within any one component.

### Wave 6

- **Cart line anatomy** — `Cant | Descripción | Existencia | Precio u. |
  Importe`, quantity first. Stock reads `_base_actual_qty / conversion_factor`,
  the same expression `useItemAddition` clamps against, so the number the
  cashier reads is the number the register enforces — a line sold by the 12-box
  would otherwise claim 24 when 24 counts singles. `Existencia` is INJECTED
  rather than registered, because registering it would make it hideable and
  invisible to every register with a saved column preference. **The category
  ancestry could not be sourced** and renders `IPN001545 · Fundas y Carcasas`
  with no invented parent: on a mis-scan a fabricated category would confirm
  the WRONG variant confidently, which inverts the subtitle's purpose.
- **Top-bar dedup** — retired `StatusIndicator`'s text but kept its BUTTON,
  which carried five things the strip cannot: the panel toggle, the tooltip
  naming the unreachable host, the bootstrap-warning dot, the reconnecting
  spinner, and `Limited` (network up, server down), which the strip's single
  boolean would render as "Sin conexión". Truncation fixed at its cause —
  identity ellipsing plus `overflow: hidden` — with chips dropped whole by
  priority instead of clipped. **Latent bug found:** the stylesheet claimed the
  connection chip was "rendered last and therefore clipped last"; `saldo` was
  pushed after it, so on any saldo tenant the one chip that must never be lost
  was second-to-last.

### Two more translation holes, same shape as the cheat sheet

`components/pos/items` was outside the scan (10 strings, all of them the ones
an operator reads when something fails). Then
`components/pos/invoice` too — 11 more, including `Subtotal`, `qty` and
`discount`, which are on the sale screen in the AFTER screenshot. Both
translated. The lesson is not "add another directory": it is that a scan
scoped by hand goes stale every time a surface moves.

### Agent economics — owner direction

Marco: *"600k plus token per agent session is too much, once this wave is
finish kill and start next waves on fresh agents."* Recorded as
`feedback_agent_fresh_per_task`, with a correction after checking the numbers:
resumption is the smaller cause. **`subagent_type: "fork"` inherits the LEAD's
full context**, so a fork's floor rises with the session regardless of its
task — freshly-spawned forks late in this session opened at 606k, 637k, 687k,
690k, while identical work early on cost 270–330k. The lever is non-fork agents
reading the plan doc, which is exactly why writing that doc early mattered.

## 2026-08-22 · Wave 3 audited, wave 4 fixing

### A1 — accessibility: two HIGH, one MEDIUM, and the drawer passed

**The rail was unreachable by keyboard exactly when it mattered.** Native
`:disabled` alongside `:aria-disabled` — native removes an element from the tab
order AND makes `.focus()` a no-op, so T1's roving tabindex (which deliberately
does not skip disabled entries) was dead code. Two consequences: an
offline-blocked destination's `aria-label` was the ONLY non-colour carrier of
why it was unavailable (the amber dot is `aria-hidden`), and **before the shift
opens every item is disabled, so the register's only desktop navigation had
zero keyboard-reachable controls.**

**The shell did not follow dark mode.** 17 literal colours in the offline
overlay, 11 in the drawer, 9 in the rail — so in dark mode the primary
navigation rendered as a light column beside a `#121212` shell. `ActionBand`
had **zero** and flipped correctly, which proved the fix was cheap.

**The band's label failed AA in light mode only** — `#8b93a0` on white is
3.10:1, and it passes in dark because the background flips and the label does
not.

**The drawer's split semantics passed**, which was the check most worth
running: `trapsFocus = isModal && phase !== 'closed'`, all ARIA computed so a
presentation switch cannot leave stale state, and `display: none` genuinely
removes the closed panel from the accessibility tree.

A1 also corrected itself in public: it first measured the dark primary at
1.77:1 and nearly led with it, having read `--reg-on-accent`'s **fallback**
instead of the resolved value (11.86:1). The "measuring the wrong pair" trap
fires on `var()` fallback chains, not just foreground/background confusion.

### A2 — money: R4 was wrong, and the accent hole is 53 files

Verified all ten offline claims. **`floor` was `blocked` and is `queued`** —
`restaurantQueue.ts` has the full implementation, and
`floorOrderActions.ts:80` says it outright: *"a waiter with no signal still has
to keep adding to the tab."* The wrong value dims Salón in a restaurant and the
waiter stops taking orders while the queue underneath is ready. **`drafts` was
`cachedReadOnly` and is `blocked`** — nothing caches drafts.

Combo arithmetic passed with 105 tests, including R10's arbitrage closure
proven directly: return every part separately, assert the sum is exactly 299.
Band values follow the artboards rather than the stale note. Client-only combo
fields cannot be persisted — the mappers pick fields explicitly with no spread.
Both of W2-B's router hazards verified closed; A2 looked for a third and found
none.

**The accent rainbow is 53 files / 224 occurrences**, tiered: 6 files on the
sale path, 5 on the newly-promoted destinations, ~42 in a long tail led by
`Reports.vue`'s 63.

### A3 — performance: honest about what it could not measure

Measured on a Ryzen 5 7600 against a pinned i5-6500 reference, concluded any
latency number would be optimistic and non-comparable, and **reported none** —
§6 says results without the manifest are observations, and it took that
literally.

What it did measure: **+13.2 kB gzip on the initial path (+1.7%)** for the
whole redesign; nothing became eager (`destinationRegistry.ts` dynamic-imports
every sheet); T2's compositor-only claim verified in the BUILT stylesheet, with
the anchored path carrying no transition at all; and **zero `addEventListener`
in the new shell**, so the leak budget passes by construction.

**Its most valuable finding was a deployment blocker.** After `dev-refresh` the
register sits behind a service-worker "Update available" sheet naming the
previous commit, frozen at 33%; reload re-arms and unregistering does not clear
it. Diagnosis: `version.json` stamps the COMMIT hash, and every build of this
wave's uncommitted work stamps `3fd6049f44a8` identically while the chunk
hashes change underneath. **The SW compares stamps, so it can neither confirm
the new bundle nor stop offering the old one.** Practical consequence for the
endgame: commit BEFORE the final deploy and capture, because the commit is what
mints a stamp the SW can act on.

### Wave 4 — fixes landed so far

- **W4-A rail:** dropped native `disabled`, kept `aria-disabled`, verified
  `activate()` guards all three routes in. Removed `opacity: 0.55` from the
  disabled container rather than only recolouring, **because opacity was the
  mechanism AND it dimmed the focus ring the first fix depends on**. Contrast
  1.66:1 → 4.51:1, passing AA outright instead of leaning on the
  inactive-control exemption. Amber is deliberately theme-constant: a badge
  that changed hue between themes would teach two vocabularies for one signal.
- **W4-B dark mode:** drawer 11 → 0 literals, overlay 17 → 0. The AA fix cost
  **zero new colour** — `--pos-text-muted` is already `#667085`, which is the
  canvas's own muted value from `_parts.txt`, giving 4.97:1 light and 9.37:1
  dark. Found that the drawer used `--ac`, `--ac-soft`, `--ac-edge`:
  **canvas-era names defined nowhere in the app**, always resolving to their
  literal fallbacks. Dead tokens that looked like theming. Dark selectors copied
  from theme.css including the `automatic` media query — a register that
  follows only `[data-theme="dark"]` looks right until a tenant on automatic
  opens it after sunset.
- **W4-C offline claims:** corrected `floor` and `drafts`, and the
  re-verification found **a third A2 had missed** — `closing` is `blocked`, not
  `queued`. `get_closing_data()` early-returns offline, and `OfflineEntityType`
  has no closing entity, so both halves of the original reasoning were wrong.
  Added `backedBy` citations with three guards, and renamed the manifest's
  `service_orders` → `service_order_capture` so the rail's "can the POS PULL a
  Charge Request" and Taller's "can we CAPTURE an order" stop looking like the
  same question.
- **W4-E destinations:** A2's 41 occurrences were mostly `text`/`outlined`
  tints; real action fills were 17 → 2 documented survivors, both irreversible
  acts where red is a safety affordance. Named a primary per destination —
  notably the corte's Submit, where *"a green SUBMIT beside an amber difference
  is precisely what teaches a cashier that green is a button colour rather than
  a signal."*

## 2026-08-22 · AFTER captured — direction E is real on a live register

Deployed to lab via `dev-refresh.sh posawesome`, bundle verified served rather
than assumed (`Pos-x44E-vKH.js`, HTTP 200, 383 kB — the asset-desync lesson
says a green roll and a blank SPA look identical from the deploy log). Captured
at three viewports on `Doco Ventas`, the retail preset, because
`restaurante-mesas` forces lean vertical and the rail would not have rendered
at all.

**Desktop `railPresent: true`, `mobileDockVisible: false`.** What the frame
shows, all of it drawn from `docs/design-evidence/after/desktop-1440/`:

- The rail IS the desktop nav — Sale, Browse, Expense, Drafts, Invoices,
  Return, Recharge, with Close Shift pinned bottom.
- The cajón is **anchored and pushes, never covers**, with its "Anclado" chip,
  its 400px column, and the cart yielding exactly that width.
- The band survives it: full width, one 60px number, one primary. T2's choice
  of `position: absolute` over `fixed` was so the drawer could never reach the
  band, and the screenshot is the proof.
- The scan bar is teleported above the sale, so scanning works with the
  catalogue closed. That is the density argument, working.

### The biggest remaining defect is in the same frame

`InvoiceActionButtons` sits directly above that disciplined band with **eight
buttons in eight saturated colours** — cyan, orange, yellow, blue, black, red,
green, cyan. Pre-existing and untouched by this wave except that W25-A
suppressed its PAY on desktop.

It never enters `singleAccent.spec.ts`, which walks `components/pos/shell/**`
only. **So the invariant is enforced precisely where it was never at risk, and
unenforced where it is most visibly broken.** And it breaks it in the exact way
§17.7 warns about: green means "Sales Return", yellow means "Drafts", red means
"Cancel Sale" — three STATE colours spent as category labels. Once a cashier
learns green is a button colour rather than a signal, the band's green "change
to give" stops meaning anything.

Routed to A2 with the screenshots and one question that decides the scope: is
this one file, or does the per-button `color=` idiom repeat across `Payments`,
`PayView` and the dialogs such that fixing one leaves the register incoherent?

### Three harness gaps, found by reading the output rather than trusting it

Each produced a plausible-looking artifact that was wrong, which is the
recurring theme of this whole wave:

1. **The manifest reported rail items as "not on this preset's rail" that the
   screenshot plainly shows.** A destination rendering as a sheet covered the
   rail, so the next visibility check answered false. Fixed by clearing
   between rail clicks.
2. **The phone run never escaped the opening dialog** and photographed it as
   the sale screen. The close-shift flow raises a snackbar — "ticket print
   failed", because QZ is not present in a headless browser — and at 390px it
   sits directly over Submit and wins the hit test. Fixed by dismissing
   snackbars and scrolling Submit into view.
3. `cajon-abierto` was recorded as missed because `Alt+B` did not fire with
   focus in a text field. Moot in practice — `explorar.png` IS the drawer-open
   state — but the chord path is worth having.

## 2026-08-22 · Wave 2.5 closed — GREEN, and deployed to lab

**275 spec files / 2259 tests, zero failures. `vue-tsc --noEmit` exit 0.
`vite build` clean.** Baseline was 238 / 1719, so the program has added 37
spec files and 540 tests and regressed nothing. The two remaining `eslint`
errors are pre-existing deprecated Vuetify `@input` events in
`NewItemDialog.vue` and `RestaurantTipSelector.vue` — neither file was touched
this wave.

### The owner's decision, and what it settled

`comboAvailability()` = `min` over STOCK ITEMS ONLY, floored to whole combos.
Blocking rides the register's existing `posa_block_sale_beyond_available_qty`
flag rather than a new toggle, on the owner's instruction: *"this already is a
setting on pos profile, extend it as recommended."*

The strongest argument for the rule turned out not to be about combos at all.
`update_qty_limits` in `invoice_utils/stock.ts` already opens with *"Clamp only
KNOWN stock items"* and sets `max_qty = undefined` for anything non-stock — so
a combo that let labour cap it would have been the odd one out. The codebase
already had the instinct the owner named.

Edge decisions, each recorded with its asymmetry:

- **Ties → first component in bundle order** (`Product Bundle Item.idx`, the
  order the shop typed it). Picking by lowest stock would flap `limitedBy`
  between two identical answers.
- **Unknown `is_stock_item` → treated as constraining.** A wrong "constrains"
  shows a smaller number a cashier queries; a wrong "does not constrain"
  oversells silently, and §11 makes that the failure to design against.
- **All-labour → `POSITIVE_INFINITY`, not a `999999` sentinel.** A surface that
  renders Infinity unchecked is visibly wrong and gets fixed; `999999` looks
  like a real answer.
- **`COMBO_AVAILABILITY_UNRESOLVED` kept its name and changed meaning** — no
  longer "the rule is undecided" but "no stock reading reached us". Answering 0
  there would read as out-of-stock on a combo the shop may have plenty of.
- **NaN reads as unknown, not unbounded** (T6's defensive fourth case).
  `Number.isFinite(NaN)` is false, so a bad payload would otherwise land in the
  unbounded branch and be reported as "no shelf limit" — the optimistic reading
  of a broken value.

### The ceiling had to survive the second interaction

W25-D shipped the rule; W25-B found it was computed and displayed but not
enforced past the first edit. `useItemBundles.ts:43` sets
`parent.is_stock_item = 0` — correctly, since the substrate decrements the
components and both packed-item handling and the server read that flag — and
`update_qty_limits` early-returns on exactly that, clearing `max_qty`. So the
clamp held on the add and vanished on the next edit.

Fixed by giving a combo parent the ceiling nothing else in the system can
supply, recomputed per call from `_combo_available`, without touching
`is_stock_item` and without weakening the original early-return (whose
reasoning still holds for every non-combo line, with a regression test).
W25-B's predicate is "carries components", NOT the fuller `isComboLine` —
`posa_combo_broken` governs whether a row RENDERS as a combo after a partial
return, but a half-returned combo still consumes its remaining components'
stock, and answering rendering and stock with one predicate is how the ceiling
would silently vanish mid-return.

### Two settings ridden rather than invented

Availability blocking rides `posa_block_sale_beyond_available_qty`. The
low-stock tint rides `posa_low_stock_alert_threshold` (Int, default 10).

Worth knowing: **the artboard and the field disagree.** The mock tints
`quedan 5` and leaves `7`, `10`, `14`, `22` neutral, so its hand-picked cut
sits between 5 and 7, not at the field's default of 10. T6 followed the
setting, per instruction — a mock's value is a mock's value. Threshold `0` or
absent disables the tint, since 0 means "never warn", not "always warn".

### Lab verified, not assumed

`bench migrate` on `doco-mirror`: both custom fields present on `POS Invoice
Item` (`posa_combo_components` Small Text, `posa_combo_broken` Check), the
repair-preset patch logged, and it correctly NO-OP'd — `restaurante-mesas`
carries `tables` and `cafeteria-counter` lists no `floor`, so neither matched
W2-B's rule. Exactly what it predicted when it chose to match on a rule rather
than a preset name.

**T5's lean-vertical question closed with data:
`restaurante-mesas.lean_vertical = 1`.** T5 reasoned this out from
`vertical.py`'s `OVERRIDE_ALLOWLIST` (`merge: "enable_only"` — a register
cannot strip what its mode pins on) without being able to read the value, and
was right. Practical consequence for the evidence lane: the AFTER set must run
on a NON-restaurant profile, because on a lean-vertical preset `railVisible` is
false and the capture would photograph the old shell while claiming to show
the new one.

## 2026-08-22 · The scanner bug — the find of the wave

W25-B was sent to extract the scan bar out of `ItemsSelector` so the ticket
could take the full width. It found the extraction was already done — and that
the integration shipped a **money-path bug with no visible symptom**.

`useScannerInput` attaches the keyboard wedge to the **document**, not to the
field, behind a singleton flag:

```
onScan.attachTo(document, …)   guarded by document._scannerAttached
onScan.detachFrom(document)    clears it on unmount
```

W2-A had wired `ItemsView` as two `v-if` branches — selector column and drawer
— so `ItemsSelector` unmounted and remounted on every drawer toggle. The
attach/detach pair is symmetric, but the singleton makes it ORDER-DEPENDENT.
Closing the drawer patches the column block first: the new instance mounts,
`initScanner()` sees `_scannerAttached` still true because the old instance has
not unmounted yet, and returns early. Then the drawer block unmounts and clears
the flag.

**Net: the shop's barcode gun stops working the first time a cashier closes the
catalogue.** No error, no visual symptom. Every toggle also discarded the
loaded catalogue, the search worker and any half-typed query. This would have
been found by a shopkeeper, not by us.

### Why the obvious fix would have been worse

A second scan-bar component on the sale screen puts TWO live scan targets on
the register and counts every barcode twice — a money bug wearing a layout
bug's clothes. `ItemHeader.vue` was already standalone and presentational; what
could not move was its state owner, `ItemsSelector.vue` and its ~25
composables. So the one header **teleports** instead: `headerTarget` and
`showCatalog` props, defaulting to `null` / `true`, so every other call site
(purchase, barcode printing) renders byte-for-byte as before.

Single ownership is now **structural rather than conventional**: one
`ItemsSelector`, one `ItemHeader`, rendered either in place or at the target,
never both and never remounted.

### And the density win became real

W2-A's rewire added `invoiceCols` — 12 when the grid is hidden on desktop, 7
beside it — so the ticket takes the width the hidden grid gives up, with the
scan bar teleported above it. That is the density argument that chose direction
E over the rejected direction C, and it did not exist an hour ago.

### Both fixes were mutation-tested, not just run green

W25-B flipped `v-show` to `v-if` and watched `hides the catalogue with v-show,
never v-if` fail by name. W2-A re-added `v-if="catalogInDrawer"` and watched 2
of its 5 assertions fail. Worth the extra step here specifically **because the
defect is invisible until a scanner is in the room** — a green suite proves
nothing about a test that was never seen failing.

### One gap remains, and it came from a bad instruction of mine

I told W2-A to host the never-unmounting `ItemsView` inside T2's
always-rendered drawer layer. W2-A checked and correctly refused: there is no
slot there. `CatalogDrawer.vue` exposes `compat` (line 110) and the default
(line 151), and **both sit inside `<aside v-if="phase !== 'closed'">`** — so
slotting the grid into either would have reproduced the exact remount we were
removing. The drawer's body is deliberately empty for now, commented, and the
grid renders in the selector column beside the drawer chrome rather than within
it. Visual gap, not functional. T2 is adding a `<slot name="persistent">` to
the always-rendered layer.

## 2026-08-22 · Wave 2 closed, wave 2.5 opened

**Wave 2 verified centrally: 266 spec files / 2122 tests, `vue-tsc` exit 0,
`vite build` clean (8.5 s; `Pos` chunk 377 kB / 105 kB gzip).**

Everything is mounted: rail as the desktop nav, destinations behind the router
guard, cajón with categories and ESC/scrim, band fed by `resolveBandState`,
dock carrying `serviceOrder` with testids and offline dimming, offline overlay
stopping short of the dock, tokens imported after `theme.css`, 93 Spanish rows,
repair-preset patch queued for the next migrate.

W2-A's integration decisions worth keeping:

- The navbar was NOT deleted. It still carries settings, printing, language and
  cashier tools — none of which are destinations. The rail replaces navigation,
  not the menu.
- `serviceOrder` is a destination, not a `PosActiveView`. `uiStore`'s union does
  not contain it, so the dock gets a shimmed `activeView`/`setSelectorView`
  triple answered by the destination router for that one id — rail and dock stay
  on one state without widening a store union from outside the owning scope.
- Unwired counts (`serviceOrderOpenCount`, `draftInvoicesCount`, `comboOffers`,
  `queuedInvoiceCount`) sit at 0 rather than inventing fetches. Zero renders NO
  badge rather than a wrong one, and a shell-level poll for numbers with no read
  model would be new traffic on the hottest path in the product.
- Prettier was deliberately not run: `Pos.vue` is prettier-dirty at HEAD, so
  `--write` would have buried a 435-line integration inside an unrelated
  reformat.

### Wave 2.5 — two defects wave 2 could see but not reach

**W25-A closed both. 270 files / 2146 tests, `vue-tsc` exit 0, build clean.**

- **Two totals, and two PAY buttons.** `InvoiceSummary` and `ActionBand` each
  rendered a total, and each passed its own suite — which is the whole failure
  mode, and the reason the new test counts across BOTH surfaces rather than
  within one. Proven red: forcing the predicate false returns 2 figures.
  The summary now yields the number and the primary; it KEEPS every secondary
  action and the subtotal, **demoted rather than deleted** — the band's 60 px
  figure is the total, and a cashier still needs to see what it is made of.
  Demotion is type-only: collapsing the block would hand the cart height it
  must give back the moment a resize unmounts the band, and `59c5fe1ad`'s
  single-scrollport chain depends on that card staying `flex: 0 0 auto`.
- **`ComboCartLine` mounted** — in `ItemsTable.vue`, where cart rows are
  actually built. It needed a `<tr><td :colspan>` wrapper: `ComboCartLine` is a
  flex `<div>`, and dropped straight into `<tbody>` the HTML parser hoists it
  OUT of the table, rendering as a stray row above the cart — a bug that looks
  like CSS for an hour.

### Two findings from W25-A that need owners

- **Nothing populates `posa_combo_components`.** The arithmetic and the row
  component exist; the add-to-cart path that attaches a bundle's components to
  the line it creates does not. `isComboLine()` is therefore false for every
  line today — the render path is proven by tests, not by traffic. **Combos are
  not visible on screen until that lands**, and a screenshot taken now shows no
  combo row. The API is ready: `api/combos.py` exposes `get_combos` and
  `get_combo_components`.
- **The single-accent invariant has a coverage hole.** `singleAccent.spec.ts`
  walks `components/pos/shell/**` only, so `InvoiceActionButtons`' PAY —
  `color="success"`, a saturated green — never enters the scan. Green is
  supposed to be STATE, not emphasis. Suppressing PAY on desktop incidentally
  helps, but the phone and lean-vertical paths still render a saturated green
  primary. Widening the scan will likely surface pre-existing violations across
  the POS, which makes it an audit finding rather than a quick fix — routed to
  A2.

### One duplication accepted on purpose, with a tripwire

`InvoiceSummary` cannot be told by the shell whether the band is mounted — it
hangs off `Invoice.vue` and no prop carries the answer down. So
`bandLaneOwnership.ts` restates `railVisible` (`leanVerticalLayout || width <
1100`). Unguarded duplication is drift, so a source-scan spec fails if
`railVisible` stops being expressible by those two inputs, or if `<ActionBand>`
is ever mounted on a looser condition than the summary yields to. The right fix
is a shared composable both import; the test exists so that day is chosen
rather than discovered.

## 2026-08-22 · W2-C closed — es.csv, and a defect it exposed

**93 rows appended** (2146 → 2239, LF, validated: zero malformed rows, the one
duplicate key `Invoices,Facturas` predates this wave and both copies agree).
New `registerShellTranslations.spec.ts` scans the shell sources for `__("…")`
AND for the prop-passed `t("…")` shape, and fails the build on any string
without a row — so the next feature that forgets one cannot ship English.
The spec was proven RED before being trusted: a row was deleted, the failure
named the string and its file, the row was restored.

Two things the agents' own reports had missed, both found only by scanning
source instead of trusting the lists:

- **`DestinationHost.vue` takes its translator as a prop** and calls
  `props.t(…)`, so a scan for `__(` misses all seven of its strings —
  including the three refusal bodies an operator reads *precisely when
  something has gone wrong*.
- **`shortcuts/actions.ts` had never been translated at all.** Not the six new
  labels — all 41. `Focus item search`, `Submit sale`, `New customer`: the
  entire keyboard cheat sheet has rendered English on a Spanish register since
  the shortcuts engine shipped. Pre-existing defect, exposed by this wave, now
  fixed.

### Band vocabulary varies by viewport — the design says so, the code cannot

The lead asserted `COBRAR` was design chatter in a comment and that
`PAY,PAGAR` was simply correct. Half right, and the wrong half matters:

| surface | artboard | word |
|---|---|---|
| desktop sale band | `Main.dc.html:376`, `Cajon.dc.html` | `PAGAR` |
| mobile cart primary | `MovilVenta.dc.html:174` | `COBRAR $1,129.00` |

`COBRAR $1,129.00` is a rendered button, not a comment. T3 built ONE
`ActionBand` for every viewport with one `BandActionId` (`sale.pay`) resolving
to one `labelKey`, so mobile will render `PAGAR` where the artboard draws
`COBRAR`, and the amount is inlined in the mobile label but not the desktop
one. `PAY,PAGAR` stays correct for desktop and nothing was changed.

Same class as a second gap: `Cafeteria.dc.html:368` draws `COBRAR Y MANDAR`
(send to kitchen) and the `BandActionId` union has no "collect and send", so
the band cannot express one of the four certified modes. Cafetería is behind a
§14 evidence gate, so neither is this wave's problem — but both will read as
translation bugs to whoever meets them first, which is why they are written
down here rather than left to be rediscovered.

`You can` was corrected from `Puedes` to **`Sí puedes`**, which is what
`MovilOffline.dc.html:128` draws. It is a column heading over a checkmarked
list, not a concatenated fragment — so no placeholder restructuring is needed.

**Open, deferred to a cleanup pass** (editing T1's and T4's registries while
W2-A is mid-wire would stomp it): three source strings say the same thing
twice — `Recharge`/`Top-up`, `Needs connection`/`Needs a connection`,
`Close Shift`/`Close shift`. Both spellings have rows so nothing renders wrong
today; the risk is a future edit pulling a pair apart silently, and no spec
can catch that because both are legitimately present.

**Preset JSON the lead must apply** — `cafeteria-counter` capability profile,
`labels`: `{"Browse": "Menú", "Cart": "Cuenta"}`. `t(key)` returns
`profile.labels[key]` when set and falls through to `__(key)` otherwise, so
the override is the FINAL Spanish string and bypasses `es.csv`. `Floor` →
`Salón` needs no override; it has an `es.csv` row now.

## 2026-08-22 · Wave 2 launched — integration

Three lanes, disjoint: **W2-A** wires the shell inside `Pos.vue`; **W2-B** the
four seams outside it (router guard, `useDialogFullscreen` surface injection,
token import, repair-preset patch); **W2-C** is the single writer for
`es.csv` — one file, six upstream reporters, guaranteed conflict otherwise.

## 2026-08-22 · Wave 1 closed — GREEN

**260 spec files / 2077 tests, zero failures. `vue-tsc --noEmit` exit 0.**
Baseline was 238 / 1719, so the wave added 22 files and 358 tests and
regressed nothing.

| Task | Delivered | Tests |
|---|---|---|
| T1 riel | pure registry + composable + `RegisterRail.vue` | 68 |
| T2 cajón | state machine + `CatalogDrawer.vue` | 59 |
| T3 banda | `bandState.ts` + `ActionBand.vue` + tokens | 78 |
| T4 destinos | registry + routing + `DestinationHost.vue` | 58 |
| T5 móvil | three-link `serviceOrder` + offline overlay | 38 (82 dock-dependent) |
| T6 combos | pricing/returns/catalog/availability + 2 components | 57 |

### What the agents found that the plan had wrong

Three of six corrected their own brief against the source of record, which is
the behaviour the plan asks for and the reason it names §17.7's canvas as
authoritative:

- **The drawer is anchored, not an overlay.** `Cajon.dc.html:328` says it in
  the artboard's own words — *"anchored by default, pushes, never covers"*.
  The lead's brief said overlay. Consequences T2 drew out: an anchored panel
  is NOT a modal, so trapping focus or locking scroll there would be an
  accessibility defect; and pushing IS layout, so an anchored drawer cannot be
  animated compositor-only. It opens instantly (one reflow, once) and only the
  overlay path — forced by geometry below 1100px, not drawn — animates, on
  transform/opacity.
- **The band is 134px with a 60px number**, not a 60px band. See R2/§4.
- **Combos already had a doctype.** See R9 — reusing ERPNext Product Bundle
  keeps the substrate's per-component stock decrement instead of hand-rolling
  the path to negative stock.

### What the lead got wrong, and it cost the wave a red build

Adding five action ids to `shortcuts/actions.ts` on the belief that an unbound
action was legal. It is not — the repo enforces bound-and-implemented. Three
agents independently reported the failure and correctly refused to own it. R8
records the real contract. Every action now has a chord and an effect; the
misleading comment in `actions.ts` is fixed.

### Two shared-config traps fixed, both corrupting other agents' results

- `vitest.config.ts` excluded `tests/smoke/**` and `tests/e2e/**` but not the
  new `tests/visual/**`, so vitest collected a Playwright spec and failed on
  its fixture — reported by several agents as ~29 mystery failures.
- `playwright.config.ts` leaves `actionTimeout` at Playwright's default of
  **0, meaning no timeout**. Correct for the assertion lanes; fatal for a
  capture lane whose design is "try, record the miss, move on" — an un-timed
  click on a control the profile does not offer blocks forever, so the
  `.catch()` meant to record the miss never runs. Two full capture runs died
  at the 300s test timeout having written nothing. Scoped
  `test.use({ actionTimeout: 8_000 })` to the visual file only.

### Lab findings, none of them about our code

- **The `playwright-bot` password had drifted** — every visual and e2e run
  against `doco-mirror` was returning HTTP 401. Re-synced from `.env.local`;
  login is 200. ⚠ The `frappe-lab` MCP credentials are STILL 401 and need
  rotating separately — two agents could not verify preset data because of it.
- **The bot carried an 11-day-old shift on a restaurant preset**, so the first
  1440×900 capture rendered the mobile dock with a Floor tab. The capability
  preset, not the viewport, was choosing the layout. **T5 investigated and it
  is designed behaviour, not a bug**: `vertical.py`'s `OVERRIDE_ALLOWLIST`
  declares `layout.lean_vertical` with `merge: "enable_only"`, so a register
  cannot strip what its mode pins on. `posa_lean_vertical_layout = 0` on the
  POS Profile is not evidence of anything.

### Evidence lane

BEFORE set captured at three viewports — `docs/design-evidence/before/`. Six
surfaces on desktop and tablet with a two-line basket, five on phone. Every
manifest records the profile that answered, the cart depth, whether the mobile
dock was visible, and what could not be reached, so a thin set reads as thin
rather than passing as complete coverage.

⚠ The BEFORE set is on the restaurant preset, not `Doco Ventas` — the
close-shift path did not return the register to the opening dialog, so the
capture never got to name its profile. Honest in the manifest, but it means
the desktop BEFORE shows the lean-vertical single panel, not the Scan Retail
two-column register. Worth a re-capture before the AFTER set is taken.

---

## 2026-08-22 · Wave 1 launched


**Lead — baseline established.** Found ~380 lines uncommitted on
`doco-customizations` from the night of 08-21, touching exactly the files this
change needs. `vue-tsc` clean and 238/238 spec files green on the dirty tree,
so the work was finished, not abandoned. Owner chose commit-first. Split into
four atomic commits with explicit staging — never `git add -A` in this
workspace:

| Commit | What |
|---|---|
| `59c5fe1ad` | `fix(layout)` — one scrollport on the desktop register, not three |
| `649f2ba66` | `feat(cash)` — the movement form says which way the money goes |
| `224dc79f9` | `docs(roadmap)` — Odoo parity audited; register canvas becomes the reference |
| `3fd6049f4` | `chore(certification)` — golden-flow runs 08-18 → 08-22 |

**Baseline of record:** `3fd6049f4` · 238 spec files · 1719 tests · `vue-tsc`
exit 0.

**Scope decided by owner.** Universal shell + combos. Cafetería, Salón and
Controlado mode features stay behind their §14 evidence gates — the shell they
are drawn on ships, their mode surfaces do not.

**Wave 1 dispatched** — six build agents, disjoint path ownership, `Pos.vue`
reserved for the lead. T1 riel · T2 cajón · T3 banda + acento · T4 destinos ·
T5 móvil · T6 combos.

**Open decision carried into the wave:** combo availability. §17.6 records
`availability = min(components)` as the design's claim, needing a back-end
decision before build. T6 builds around a stubbed
`comboAvailability.ts` rather than guessing — the rule decides whether a combo
can oversell, and that is not an implementation detail.
