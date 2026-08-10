# POS Vertical Profiles — Architecture Plan (v2, post-review)

Status: REVISED — v1 was adversarially audited against the actual codebase
(15 findings, 5 fatal) and checked against industry practice (Square, Odoo,
Shopify POS, Lightspeed, Fowler, SPL literature). This version incorporates
both. Full reports: session scratchpad `plan-critique.md`, `industry-research.md`.
Owner: Marco. Scope: POSAwesome fork inside the muelle multi-tenant stack.

## Problem (unchanged)

One POS codebase must serve visually and functionally different businesses:
phone retail (current), taller/repair delivery desk, restaurants, coffee
shops, autoservice, warehouses. Forking per vertical is maintenance death;
a schema-driven UI engine is a year of work for a mediocre renderer.

## What industry evidence settled

- **One app, not separate vertical apps.** Square ran the split-app
  experiment at scale and publicly reversed it in 2025 ("overhead…
  maintaining many separate tools"); their replacement is one app with
  **7 named modes, mutually exclusive per device** — a closed preset set,
  not a free capability matrix. Real merchants are mixed-vertical (their
  stated trigger), and taller+mercado is exactly that hybrid.
- **Bind the profile per register (POS Profile), not per tenant.** Odoo puts
  `module_pos_restaurant` on `pos.config`; one company runs a restaurant
  register and a retail register side by side. ERPNext's POS Profile is the
  identical hook and we already have it.
- **Fine capability granularity, coarse preset surface.** Odoo ships ~60
  small `pos_*` modules and zero vertical mega-modules; verticals are named
  bundles of small capabilities. We test the presets, never the cross-product.
- **Capability checks live behind a resolver, not scattered `v-if`s.**
  Vertical capabilities are Fowler's longest-lived toggle class; his explicit
  warning is against sprinkling if/else for exactly this category.
- **Offline capability resolution is a correctness requirement.** A POS is
  offline-first; a wrong fallback is a cashier seeing the wrong screen
  mid-sale.

## The axes (revised: four, not three)

1. **Capability profile** — what this register can do. JSON resolved through
   one store (`verticalStore.has(cap)`), enum-valued layout keys, closed
   preset list. Free-form capability mixes are an unsupported/advanced path.
2. **View registry** — how the sales screen is structurally laid out
   (`items_view`, `cart_style`). Hand-crafted lazy views behind typed
   interfaces. **Prerequisite: the decoupling work in M2 below — the audit
   showed today's views are NOT swappable leaves.**
3. **Theme tokens** — visual skin (`--pos-*` vars, per-tenant). Already
   half-built; fully orthogonal; the 2026-08 mobile overhaul hardened it.
4. **Vocabulary + documents** *(new, from audit finding 12)* — a `labels: {}`
   map resolved through a `t(key)` helper falling back to `__()` (Mesa /
   Comanda / Platillo is what makes a restaurant POS feel like one; Frappe
   translation CSVs are per-app, not per-tenant, so this must live in the
   profile), plus per-preset print-format bindings (repair ticket, kitchen
   ticket, pick list are different documents).

Rule #1 stands: components consult capabilities, never vertical names — and
per the audit, they consult them through the resolver, not inline flag reads.

## Corrections the audit forced (v1 → v2)

### C1. The registry is the LAST thing built, not the first (was fatal #1)
`Pos.vue` reaches into `Invoice.vue` imperatively at 7 sites
(`invoicePanel.value?.subtotal`, `?.return_discount_meta`,
`?.handleShowPaymentRequest()`, …) with optional chaining that turns a
missing member into a silent wrong total or a dead Pay button.
`ItemsSelector.vue` exposes 92 members and mounts in THREE contexts (pos,
purchase, barcode-printing). Before any registry:
- move the reached-into state (`subtotal`, `return_discount_meta`,
  `discount_percentage_offer_name`) into `invoiceStore`; replace method
  reach-ins with store actions;
- type the event bus (55 events, 81 emit sites, currently `any`) so a view
  that mishandles the contract fails `vue-tsc`; migrate cart-view-contract
  events to store actions (bus stays for shell fan-out);
- define `CartView` / `ItemsView` TS interfaces; registry keyed on
  **(layout, context)**, never layout alone.
(The bare `eventBus.off("submit_closing_pos")` bug the audit found is
already fixed — f1d5e0f49.)

### C2. Taller seed redefined: delivery-day checkout, not intake (was fatal #2)
Taller is a live 20k-line frappe-ui/Tailwind app with intake, tech flows,
and its own workflow doc (`Repair Order`: status chain, checklist, PIN,
parts/serials; **no invoice until delivery**). Porting intake into a
Vuetify sales-invoice shell is a rewrite wearing a costume.
The honest seed: **`external_document_checkout` capability** — pull a
finished Repair Order into the cart as billable lines at the counter
(~200 lines against the real boundary). Taller stays the first seam test —
it exercises the cross-app boundary harder than a fake intake would — and
the fuller `taller-repair` preset (scan-first layout, repair vocabulary,
repair-ticket print format) builds on that capability. First *layout*
vertical remains coffee (smallest delta), exactly as v1's own M5 conceded.

### C3. M1 is additive, not a port (was fatal #3)
267 frontend read-sites across 85 files consume 76 POS Profile flags (plus
571 backend sites; 79 of 197 test specs fixture them). Nothing "ports".
`verticalStore` ships as a pure addition answering capabilities that have
**no existing flag**; the `posa_*` reads stay where they are and migrate
one at a time only when a second vertical needs that flag to mean something
different. Rehearsal slice first: implement or delete
`posa_lean_vertical_layout` / `posa_lean_wizard_layout` — two shipped,
admin-visible layout flags that are read **nowhere** (audit finding 7).
If a one-preset slice can't ship, six presets won't.

### C4. Naming + delivery reuse what exists (was fatal #4)
Three "vertical" taxonomies already live in this stack: `Doco Vertical`
(+5 child doctypes, in doco), taller's own `vertical` axis
(repair_shop/car_repair_shop/…, domain not layout), and boat's
`Doco Vertical Template` + `execute_apply_template()` (working per-tenant
fixture delivery with usage counting). Therefore:
- the new doctype is **`POS Capability Profile`** (not "Vertical"), holding
  the JSON + enum layout fields;
- it **links** to `Doco Vertical` (`vertical_code`) instead of redeclaring
  the concept — domain axis and layout axis stay distinct (an autoservice
  tenant is `car_repair_shop` × autoservice-layout);
- per-tenant preset delivery goes through `Doco Vertical Template` /
  `execute_apply_template`, not posawesome app fixtures (which are
  app-scoped and would land all six presets on every site).

### C5. Honest bundle/module story (was fatal #5)
One built bundle serves every tenant in a cell (shared `assets` volume);
lazy chunks save download, **not** isolation — a restaurant-module bug
ships to the warehouse tenant's bundle. State that plainly. Heavy vertical
*backend* features are separate Frappe apps installed per tenant via boat
(`install_app` + the existing rebake path in `service_provisioning.py`),
mirroring how saldo integrates today — while acknowledging the saldo
precedent is a build-time alias: posawesome's build grows a hard sibling
dependency per frontend module, which is the price of the shared bundle.

### C6. `items_view` collision (finding 6)
The cashier already owns `items_view` (localStorage, runtime-toggleable,
drives Cards vs Table today). The profile therefore sets
`{ default, allow: [...] }`; the localStorage value survives as an override
validated against `allow`; the profile key gets a distinct name so it never
shadows the shipped ref.

### C7. Offline contract (finding 9 — was an "open question", now closed)
- The capability JSON lives **on POS Profile itself** (JSON field), so the
  existing shift-open snapshot (`persistOpeningEntities` → Dexie
  `pos_profiles`) carries it with zero new offline plumbing. No separate
  doctype fetch on cold boot, no white screen at the counter.
- The profile is **shift-scoped by design**: snapshotted at shift open,
  never refreshed mid-shift (the alternative is the Pay button relocating
  between customers).
- Queued offline invoices get a `capability_profile_version` stamp; replay
  on mismatch is rejected for review. `pos_profile.modified` (already
  tracked in `bootstrapSnapshot`) is the invalidation key.

### C8. Fixture hygiene precedes presets (finding 8)
30 of 139 POS Profile fields exist only in patch scripts, invisible to the
fixture system (including `posa_hide_items_until_search`, which gates the
whole catalog). Before M3: re-export all fields to `custom_field.json`, add
a CI check that fails when a patch inserts a Custom Field absent from
fixtures. Custom Field names are globally unique per site (`{dt}-{fieldname}`,
last writer wins, silently) — per-vertical fieldname prefixes
(`posa_rt_*`, `posa_tl_*`) are mandatory, enforced by a fixture lint.

### C9. Upstream decision made explicit (finding 10)
Upstream is `defendicon/POS-Awesome-V15` (not yrestom), it is alive, and it
merged as recently as 2026-07-28. The fork is 383 commits / 65k insertions
ahead; upstream's three hottest files (Payments 191 commits, Invoice 134,
ItemsSelector 88) are exactly the registry's targets. **Decision required
from Marco before M2**: (a) declare the fork terminal and stop merging —
registry refactors become free; or (b) keep merging — the registry is then
confined to new wrapper files and the three hot files stay structurally
recognizable to `git merge`. The C1 store-extraction work is compatible
with either.

### C10. Roles enter the capability function (finding 13)
The frontend has zero role awareness today (all gating is backend
whitelist — buttons render for everyone and the API rejects the click).
Capability resolution is `f(profile, roles)`: roles ride the boot payload,
and role-gated capabilities (`void_kitchen_ticket: manager`) resolve
per-user. Aligns with the standing manager-only approver rule.

### C11. Explicit non-goals (finding 14)
Through M5, verticals do **not** change: Reports (5,393 lines),
InvoiceManagement (3,251), closing shift, offline invoice management —
every tenant gets the retail set. Named here so it's a decision, not a
discovery. Per-vertical reporting is its own future program.

### C12. Live-tenant migration (finding 15)
M3 ships the link **nullable** with `null ⇒ retail-phones` resolution in
`verticalStore` — every existing tenant keeps working with zero data
change. Backfill is per-tenant, explicitly gated, with the rollback
(switch a tenant back to null) written before the roll-forward. Fresh
installs skip patches (known trap) — presets must land identically via
fixture import on both fresh and migrated sites, verified in the B16 drill.

## Revised milestones

- **M0 (done)**: mobile overhaul — tokens + solid shell + the bus fix.
- **M1**: rehearsal slice: implement `posa_lean_vertical_layout` as the
  first profile-driven layout (or delete both dead flags). Additive
  `verticalStore` with hardcoded `retail-phones`; zero flag ports.
- **M1.5**: fixture hygiene (C8) + bus typing + store extraction (C1).
  Upstream decision (C9) gates the depth of C1.
- **M2**: typed `CartView`/`ItemsView` interfaces; registry keyed
  (layout, context); current components become the `list`/`table` entries.
  Dock tabs become config.
- **M3**: `POS Capability Profile` (JSON on POS Profile per C7; doctype
  linked to `Doco Vertical` per C4); delivery via `Doco Vertical Template`;
  nullable + default per C12.
- **M4**: `external_document_checkout` — Repair Order → cart at delivery
  (the taller seam test, C2). Repair vocabulary + repair-ticket print
  format via axis 4.
- **M5**: `coffee-quickserve` — first full layout vertical (tile-menu +
  quick modifiers). `taller-repair` preset completes on top of M4.
- **M6+**: next vertical by market pull.

## What survived v1 unchanged

Theme-token axis; capability-not-name rule; `defineAsyncComponent`
precedent; closed official preset set with per-customer derived profiles;
incremental extraction ("engine pieces extracted when the second consumer
forces the seam") — the audit reinforced rather than refuted that instinct,
it just moved the seam-forcing work (C1) in front of the registry instead
of behind it.
