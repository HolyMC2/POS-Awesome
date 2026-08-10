# POS Vertical Profiles — Architecture Plan (v1, pre-review)

Status: DRAFT — pending adversarial audit + industry research pass.
Owner: Marco. Scope: POSAwesome fork (`HolyMC2/POS-Awesome`, `doco-customizations`) inside the muelle multi-tenant stack.

## Problem

One POS codebase must serve visually and functionally different businesses:
phone retail (current), **taller / repair shop (own shop — first-class seed)**,
restaurants, coffee shops, autoservice, warehouses. Today the app is a single
retail-shaped UI configured by scattered `posa_*` flags on POS Profile. Forking
per vertical is maintenance death; a fully schema-driven "UI engine" is a year
of work for a mediocre generic renderer.

## Decision (proposed): three orthogonal axes

### Axis 1 — Capability profile (what the POS does)

New doctype **`POS Vertical Profile`**, linked from POS Profile. Declarative
JSON payload:

```json
{
  "layout": {
    "items_view": "grid-categories",
    "cart_style": "ticket",
    "dock_tabs": ["browse", "orders", "cart", "pay"]
  },
  "capabilities": ["repair_intake", "serial_imei", "device_lookup"],
  "item_fields": ["warranty_months", "device_model"],
  "customer_fields": ["device_imei"],
  "flows": { "checkout": "standard", "park_orders": true }
}
```

- Shipped as **fixtures**: 5–6 official presets (see Seeds below).
- Per-customer tweak = duplicate preset, edit. Versioned, migratable, testable.
- **Rule #1: components check capabilities, never vertical names.**
  `profile.has('tables')`, never `if vertical === 'restaurant'`. Capability
  checks compose (coffee = restaurant − tables + quick-modifiers); name checks
  metastasize into combinatorial if-jungles.
- Frontend: one Pinia store (`verticalStore`) loads the JSON at POS boot
  alongside POS Profile. Components read capabilities/fields from it.

### Axis 2 — View registry (how it looks structurally)

Small registry keyed by layout mode:

- `items_view`: `grid` | `list` | `tile-menu` | `scan-first` …
- `cart_style`: `table` | `ticket` | `cards` …

Each entry = a real hand-crafted Vue component, lazy-loaded via
`defineAsyncComponent` (pattern already used for `Payments.vue`). Warehouse
tenants never download restaurant chunks. Registry itself ≈ 50 lines. Quality
lives here — views are designed, not generated.

### Axis 3 — Theme tokens (visual skin)

Existing `--pos-*` CSS custom properties, formalized into named theme sets per
tenant. Fully independent of the functional axis: warehouse can run dark-dense,
coffee shop warm-spacious, both on `list` view. (The 2026-08 mobile overhaul is
hardening exactly this token layer.)

## Heavy vertical features = modules, not config

Tables/courses/KOT (restaurant), scale integration (warehouse), bay assignment
(autoservice), **repair intake / device history (taller)** are feature
packages: backend doctypes + lazy frontend chunk, activated by a capability
flag. Config decides *if* the module loads; the module itself is normal code.
Taller already exists as its own Frappe app — its POS surface becomes the
first real module consumer, which keeps the abstraction honest.

## Seed presets

| Preset | Layout | Distinctive capabilities |
|---|---|---|
| `retail-phones` (current default) | list + table cart | serial_imei, saldo, offers |
| **`taller-repair` (own shop, seed #2)** | scan-first + ticket cart | repair_intake, device_lookup, serial_imei, service_items, park_orders |
| `restaurant` | tile-menu + ticket | tables, courses, kitchen_ticket, split_bill |
| `coffee-quickserve` | tile-menu + cards | quick_modifiers, order_names, no_tables |
| `autoservice` | list + ticket | bay_assignment, vehicle_lookup, estimates |
| `warehouse` | scan-first + table | bin_locations, bulk_qty, scale, pick_lists |

`taller-repair` is the forcing function: it is a real shop (Marco's), already
has its own app + data model, and is maximally different from retail in flow
(intake → diagnose → quote → repair → deliver) while sharing payments/customers.
If the seams hold for taller, they hold.

## What Frappe already gives us (don't rebuild)

- POS Profile = per-outlet config anchor. Link, don't replace.
- Custom Fields + fixtures = per-vertical data fields on Item/Customer/Invoice.
- Multi-tenant muelle stack = preset→tenant mapping (boat provisioning can
  install vertical fixtures per tenant plan).
- Frappe permissions = role gating per flow.

## Migration path (incremental, no big-bang)

1. **M0 (now)**: mobile overhaul lands design tokens + solid shell.
2. **M1**: extract `verticalStore` reading a hardcoded `retail-phones` JSON;
   port the scattered `posa_*` UI flags that are really capabilities into it.
   Zero visible change.
3. **M2**: view registry for `items_view` + `cart_style`; current components
   become the `list`/`table` entries. Dock tabs become config.
4. **M3**: `POS Vertical Profile` doctype + fixtures; boat installs per tenant.
5. **M4**: `taller-repair` preset + repair-intake module (POS surface for the
   existing taller app).
6. **M5+**: next vertical by market pull (coffee likely smallest delta).

Engine pieces are extracted **when the second consumer forces the seam**, never
speculatively.

## Open questions (for review pass)

- Where does the profile JSON live: dedicated doctype vs JSON field on POS
  Profile vs child tables? (Child tables = better list-view UX for non-dev
  admins; JSON = cheaper migrations. Lean: doctype with JSON field + a few
  top-level select fields for the layout axis.)
- Capability granularity: how fine before config soup? Guardrail proposal: a
  capability must gate ≥1 module or ≥1 registry view or ≥3 components,
  otherwise it's just a boolean setting on the profile.
- Offline: profile JSON must be in the offline cache (posawesome has offline
  invoices) — cache invalidation story when a profile changes mid-shift?
- Upstream drift: we track yrestom/POS-Awesome loosely; how much of the
  registry refactor makes rebases harder? (Fork is already deeply diverged —
  measure before caring.)
- Per-tenant custom fields at scale: fixture collision strategy when two
  verticals define the same fieldname differently.

## Explicitly rejected

- **Fork per vertical** — N× maintenance on every bugfix.
- **Full schema-driven UI engine** (JSON describes every screen, generic
  renderer) — enormous cost, mediocre UX ceiling, abstraction leaks on the
  first genuinely different vertical (restaurant table map).
- **Vertical-name conditionals in components** — see Rule #1.
