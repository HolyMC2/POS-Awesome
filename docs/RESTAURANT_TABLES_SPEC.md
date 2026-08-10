# Restaurant / Cafeteria Table Management — Spec (v2.1, hardened)

Status: **HARDENED** (v2). v1 was a source-level study of Odoo `pos_restaurant`
(18.0 + master), Square for Restaurants, and Toast. v2 adds: a Frappe-ecosystem
survey (KirkGamo `restaurant_pos`, Rocket-Quack `erpnext_restaurant`, alphabit
`erpnext-restaurant`, URY), and **three** verification passes against **this
fork's actual code** (the `_scope` security surface + capability doctype; the
offline write-queue / idempotency / snapshot layer; and a third pass against
the **running lab bench, the Frappe source inside the container, and the live
lab database**). Those passes turned five of v1's open questions into firm
recommendations, overturned one v1 assumption outright (§0.1), and **corrected
five v2 claims** — see §11. Scope: the `restaurante` vertical of the POSAwesome
fork, built on the capability-profile + view-registry spine already shipped
(VERTICAL_PROFILES_PLAN.md, M1–M5). Owner: Marco.

This is a **spec, not an implementation**. Nothing here is built. Verticals
survey confirmed: `table_no|kot|waiter|table_number` = **zero hits** across the
fork — table management is fully greenfield here.

> **Read §11 (Adversarial findings) before estimating.** Three blockers sit in
> the current design, and none is a matter of opinion: F1 is shipped code plus
> 409 rows of live lab data; F3 is Frappe's naming source; F5 is a two-line
> filter in `api/shifts.py` plus five open shifts on the lab tenant.

**Terminology correction (v2.1):** the platform vertical code is **`restaurante`**
(Spanish, singular) — `doco/docoutils/giros.py:45-46`. **`cafeteria` is not a
vertical**; it is a *giro* that resolves to `restaurante` (`giros.py:137-139`,
asserted in `test_giros.py:64`), and it is the **only** food-service giro the
signup site sells ("Cafetería / fonda", `muelle-site/src/lib/signup.ts:507`).
Domain and layout are independent by design (`pos_capability_profile.json`,
`vertical` field: *"Layout is independent of domain"*), so the right shape is
**two capability profiles both linking `vertical = restaurante`**:
`cafeteria-counter` (tabs, no floor) and `restaurante-mesas` (floor + tabs).
See D1 in §8 for the product consequence.

---

## 0. The insights that shape everything

### 0.1 A draft Sales Invoice is NOT a safe backing for an open table ticket (v2 correction)

v1 assumed "POSAwesome's open ticket is a draft Sales Invoice, reuse it." The
codebase verification pass shows that is **unsafe for table service**. The
third pass pins down the exact mechanism, and it is worse than "auto-deleted
or force-submitted":

`POS Closing Shift.on_submit()` calls `delete_draft_invoices()`
(`pos_closing_shift.py:147-151, 167-168`). That function
(`closing_processing/invoices.py:100-125`) checks `POS Profile.posa_allow_delete`,
raw-SQL selects every row where
`docstatus = 0 AND posa_is_printed = 0 AND posa_pos_opening_shift = %s`, and
calls **`frappe.delete_doc(doctype, name, force=1)`** on each. `force=1`
bypasses link and permission checks entirely.

The dilemma is total, and both horns are fatal for table service:

- `posa_allow_delete = 1` → closing a shift **hard-deletes every un-printed
  open table ticket**.
- `posa_allow_delete = 0` → closing is **blocked** while any draft exists
  (`usePosShift.ts:338-350`), so a waiter can never close their shift while a
  table is open.

Live lab data, today: one open shift holds **exactly 165** such drafts (others
168, 75, 1); **all 409 POS drafts have `posa_is_printed = 0`**, i.e. every one
is in the deletion set; and both profiles carrying them have
`posa_allow_delete = 1`. Compounding it, **shifts are per-user** (F5), so
"closing a shift" is a routine end-of-turn act, not an end-of-day one — and
`VERTICAL_PROFILES_PLAN.md` C11 (lines 193-197) explicitly puts the
closing-shift flow **out of scope for verticals through M5**, so "just patch
the close path" is not available.

Retail hold-tickets are ephemeral within a shift; a table order is not.

The Frappe ecosystem already solved this. KirkGamo's `restaurant_pos` exposes
`invoice_mode: Record Only | Sales Invoice | POS Invoice` — the floor runs with
**no ERPNext accounting document until settle**. Adopt that shape:

- **Recommendation:** back the open table order with a **lightweight
  `POS Table Order`** doctype (Record-Only), and materialise a Sales Invoice /
  POS Invoice **only at settle**. Make it a preset-level `invoice_mode` so a
  counter-only cafeteria can still choose "Sales Invoice per ticket" if it wants
  the shift-close semantics. See §2.3 for the doctype and §0.2 for why this also
  cleans up idempotency.

This is the one v1→v2 reversal. Everything downstream (offline merge, shift
close, split, coursing) gets simpler once the table order is a first-class,
shift-durable record rather than a repurposed draft invoice.

### 0.2 Table status is derived from orders, not stored

Odoo — the most mature open model — has **no `state` column on the table**;
occupancy is computed at render from the set of open orders on the table. Two
verticals independently confirm this: alphabit models `status` as a Python
`@property` (a COUNT over open orders, **zero stored status, zero drift**), and
transfer is trivial precisely because status is derived (`self.table = t; save()`).

Only the states that *cannot* be derived from orders + payments need storage:

- `needs_cleaning` (bussing) — nothing in the ledger implies it.
- `bill_printed_at` (proforma given) — only if the venue prints proformas.

**This stack already ships a working instance of the principle — copy it.**
`Taller Floor Plan` (`taller/repair/doctype/taller_floor_plan/`) is a
warehouse-scoped plan whose only stored payload is a `layout` JSON of
`{"objects": []}`. `taller/api/floor_plan.py:36-76` returns that stored
positions-only layout **enriched at read time** with each shelf's LIVE fill,
and `save()` **strips the derived enrichment before persisting**
(`:138-140`, comment: *"Never persist derived fill — keep the stored layout
positions-only"*). It also demonstrates the two operational details this spec
needs: **one grouped query instead of N+1** (`:44-64`) and a scope gate on
every endpoint (`require_warehouse_access`). The whole thing is 491 lines of
Vue plus 155 of Python. Two caveats before copying wholesale: it uses
`Code`/`options: JSON` rather than the native `JSON` fieldtype (predates the
need), and its `save()` has **no concurrency token** — it reads the doc and
overwrites `layout` (`:143-147`), i.e. last-write-wins, exactly the gap §6.3
tells us to close.

Store those two; derive the rest (free / seated / ordered / sent / paying /
paid). This keeps table state and ledger state from ever disagreeing — the
failure mode that plagues bolt-on floor plans. Optional fast-repaint
optimisation (from alphabit + URY): cache an indexed `occupied` Check on the
table, **reconciled from the count**, so the floor repaints without a COUNT per
tile per render. The count stays the source of truth; the flag is a hint.

### 0.3 The floor is a registered view on the existing spine, not a new app

The floor screen is a **registered view for the restaurant/cafeteria vertical**,
gated by a `tables` capability — not a global screen behind an `if`. This is the
whole point of the vertical-profiles work already shipped; §1 spells out the
exact extension points, all of which exist today.

---

## 1. How it fits the vertical-profiles spine (do not rebuild)

Verified against the live code — every hook below exists:

- **Capability**: a `tables` capability on the preset gates the feature
  (`verticalStore.has("tables")`, `stores/verticalStore.ts`). Role-gated
  variants use the shipped `capability:role` syntax (e.g.
  `void_ticket:Restaurant Manager`) which reads `frappe.boot.user.roles`.
- **Layout / view registry — CORRECTED (v2.1). The floor is NOT an items
  panel.** v2 proposed `items_panel: "tables"` → registry key `"tables:pos"`.
  Three problems, all verified:
  1. **Name collision.** `CartStyle = "table"` already exists
     (`viewContracts.ts:58`) meaning *the tabular cart*, and the registry
     already holds `"table:pos"` (`viewRegistry.ts:27`). A `POS Table` doctype
     plus a `tables` panel key plus a `table` cart style is three unrelated
     meanings of "table" in one config surface. **Use `floor`** for the
     restaurant concept, everywhere.
  2. **The items panel is a column, not a screen.** `Pos.vue:67` mounts
     `<component :is="ItemsView" context="pos" />` in the selector column with
     the cart column permanently mounted beside it (`Pos.vue:116`; panels use
     `v-show`, never `v-if` — see the comment at `Pos.vue:562-564`). Swapping
     the items panel for a floor plan leaves a cart rendered next to a floor
     you have not opened a ticket on, and **removes the item browser** — the
     waiter can see the floor but cannot add food.
  3. **Views resolve once, not reactively.** `Pos.vue:374-375` calls
     `markRaw(resolveItemsView(...))` into a `const` during `setup()`, so the
     mounted view cannot change without a remount. Consistent with the
     shift-scoped profile (C7), but it means "switch to the floor" cannot be a
     registry swap at runtime.

  **Corrected design: the floor is a fifth `activeView`.** The shell already
  has the mechanism — `uiStore.activeView` (`uiStore.ts:48`, today
  `items | offers | coupons | payment`, each with a `v-show` block at
  `Pos.vue:59/70/81/93`). Add `floor`: one `v-show` block mounting `FloorView`
  (async), one `DOCK_TAB_DEFS.floor` entry, and tighten `activeView` from
  `ref<string>` to a union so the new value has a compile-time guard. **The
  view registry stays untouched for v1.** Revisit only if a restaurant needs a
  genuinely different *item browser* (a tile menu) — that is M5
  `coffee-quickserve`'s job and an independent change.

  Exact edit list (six places, not three):

  | # | File | Change |
  |---|---|---|
  | 1 | `pos_capability_profile.py:14` | `VALID_DOCK_TABS` += `"floor"` |
  | 2 | `pos_capability_profile.py:18` | `VALID_ITEMS_PANELS` — **no change** |
  | 3 | `pos_capability_profile.json` | `dock_tabs` `description` lists valid ids |
  | 4 | `viewContracts.ts:62` | `DockTabId` += `"floor"` |
  | 5 | `Pos.vue:571` | `DOCK_TAB_DEFS.floor` (**must have `icon`**) |
  | 6 | `uiStore.ts:48` | `activeView` accepts `"floor"` |

  Two silent-failure traps here: `pos_capability_profile.py:67` **drops unknown
  dock tabs from the payload without error**, while `validate()` at `:38-43`
  **throws** on them — so a preset applied before the code ships aborts the
  whole template import (the agent importer re-raises on first failure), and a
  tab whose def lacks an `icon` is dropped by `Pos.vue:622-623` with no
  warning. **Ship the app code before applying the template.**
- **Dock tabs**: the preset's `dock_tabs` gains a `floor` id. Adding a dock id
  requires the documented **three synchronized edits**: `VALID_DOCK_TABS`
  (`pos_capability_profile.py:14`), `DockTabId` (`viewContracts.ts:62`), and a
  `DOCK_TAB_DEFS` entry (`Pos.vue:571`). Grid tracks already follow
  `--dock-tab-count`; unknown ids are dropped by `.filter(tab => tab.icon)`.
- **Vocabulary (axis 4)**: `t("Customer") → "Mesa"`, `t("Order") → "Comanda"`
  via the preset `labels` map. Already wired (`verticalStore.t(key)`).
- **Print format**: the preset's `print_format` binds the kitchen-ticket /
  proforma format. Already carried in the capability contract.
- **Route**: a `/floor` Vue route. `router/index.ts` confirms clean insertion —
  append before the `:pathMatch(.*)*` catch-all (which must stay last), lazy
  `() => import(...)` so it joins the chunk-recovery / offline-fallback
  machinery, `meta:{title, layout:"default"}`. **No route-level capability guard
  exists today** — a `tables`-gated `/floor` needs either a new `meta` flag
  handled in the single `beforeEach`, or a redirect inside the view. (The
  existing `requiresSupervisor` guard is the pattern to copy.)
- **Realtime**: occupancy broadcasts ride `stores/socketStore.ts`. See §6.7 for
  the room + reconnect gap the verification pass surfaced.
- **Offline**: table/ticket writes ride the existing
  `offline/{writeQueue,invoiceOutbox,idempotency}.ts` +
  `stores/offlineSyncStore.ts`. See §6 for the exact seams and their gaps.

New backend doctypes are the only backend additions; the frontend slots into
existing extension points.

### 1.1 Security contract for every new backend endpoint (verified, non-negotiable)

The `_scope.py` surface is the tenant boundary. Any new whitelisted **write**
endpoint (open table, transfer, merge, settle, edit floor) MUST mirror this
exact shape, **before the first DB touch**:

```python
@frappe.whitelist(methods=["POST"])
def open_table(pos_profile, company, table, ...):
    from posawesome.posawesome.api._scope import assert_profile, assert_company
    assert_profile(frappe.session.user, pos_profile)      # blank profile is FATAL
    assert_company(frappe.session.user, company)          # blank = derive downstream
    # ... only now touch the DB
```

- `assert_profile` — blank `pos_profile` raises; profile not in the user's
  assigned set raises. `assert_company` — blank is a legal no-op (delegates the
  boundary to the profile), a named company not in the allowed set raises.
- Guest **always** raises; System Manager bypasses; Sales/POS Manager do **not**
  bypass (workflow roles ≠ security overrides).
- Assert off a **fetched** value, never client input, when the company comes
  from a referenced doc (pattern at `invoices.py:265-273`).
- Feature-gated actions (behind a POS Profile checkbox) use
  `assert_profile_feature(user, pos_profile, "posa_<flag>", company)`.
- Any `ignore_account_permission` need wraps in `_perms.account_perm_bypass()`
  (restore-not-clear), never an inline flag set.
- **Read-only** endpoints (the floor list, occupancy poll) follow
  `vertical.get_capability_json`'s pattern instead:
  `frappe.has_permission("POS Table", "read", name, throw=True)` — no `_scope`.

The POS Capability Profile doctype is **System Manager CRUD, Supervisor
read-only** — do not add an endpoint that lets a cashier mutate presets; it
would break that posture. Table *records* are cashier-writable data, presets are
not.

---

## 2. Data model (ERPNext / Frappe doctypes)

Naming follows repo convention (`posawesome/posawesome/doctype/<snake_case>/`).
Custom fields ship via `hooks.py` + `custom_field.json` under the CI coverage
guard — and note the guard's invariant: **exactly one Custom Field fixtures
entry** in `hooks.py` (a second entry silently overwrites the first's export
file). New fields append to the single existing entry.

### 2.0 Two naming rules that are not stylistic (v2.1)

**(a) Every new custom field takes the `posa_rt_` prefix.**
`VERTICAL_PROFILES_PLAN.md` C8 (lines 167-173) makes per-vertical fieldname
prefixes **mandatory**: *"Custom Field names are globally unique per site
(`{dt}-{fieldname}`, last writer wins, silently) — per-vertical fieldname
prefixes (`posa_rt_*`, `posa_tl_*`) are mandatory, enforced by a fixture
lint."* The risk is concrete: Sales Invoice on the lab tenant already carries
**51 custom fields from six-plus apps** (`posa_*`, `mx_*` ×11 from
erpnext_mexico_compliance, `saldo_*`, `crm_deal`, `repair_order`, `branch`, …).
A generic `posa_table` is exactly what a future app collides with, and the
collision is a **silent overwrite**. Verified: **no `posa_rt_*` field exists
yet** and `scripts/check_fixture_coverage.py` contains **no prefix check** — so
this feature both establishes the convention and must add the missing lint.

**(b) Autoname must be deterministic, not a series.** Any doctype delivered by
`Doco Vertical Template` needs `field:`-based naming — see **F3**. A
`POSA-TBL-.#####` series makes template re-apply create duplicates, because
`frappe/model/naming.py:158-159` discards an explicitly supplied `name` for any
non-`prompt`/`uuid` autoname and boat's importer is insert-only. Use
`autoname: field:<uid>` with a client-generated UUID: deterministic
(`naming.py:216-231`), re-apply-safe, and the same value doubles as the
offline upsert key. Precedent in-app: `POS Capability Profile` uses
`autoname: field:profile_name`.

**Frappe version note:** the bench runs **v16.28.0** and `JSON` is a native
fieldtype (`frappe/model/__init__.py:42`), already used in-app
(`pos_telemetry_event.json:84`). The "`Code`(options JSON) on older Frappe"
hedge below is unnecessary. **Indexing note:** Frappe indexes a column **only**
when the field declares `search_index` (or `unique`) —
`frappe/database/schema.py:105`: `set_index=field.get("search_index")`. Link
fields are **not** auto-indexed, so "indexed" in the tables below means
`"search_index": 1` must be written explicitly.

### 2.1 `POS Floor` — essential

| Field | Type | Notes |
|---|---|---|
| `floor_name` | Data, reqd | |
| `company` | Link Company, reqd | tenant scope |
| `pos_profile` | Link POS Profile | v1: one profile per floor. Promote to a child-table M2M (`POS Floor Profile`) only if a floor must serve multiple registers. **Decision: start with the Link** (below). |
| `sequence` | Int, default 1 | tab order on the floor switcher |
| `is_active` | Check, default 1 | **soft delete — never hard-delete** |
| `layout` | JSON | canvas size, background colour/image ref, decor. Native `JSON` fieldtype; `Code`(options JSON) on older Frappe. |

**Resolved open question (one-profile-vs-M2M):** start with the `pos_profile`
Link. Rocket-Quack and Odoo both support multi-config floors, but neither of
Marco's own venues (taller, docomexico) needs one register serving two physical
floor plans simultaneously. Promote to `POS Floor Profile` (child M2M) only when
a real venue demands it — the migration is additive (add the child table, keep
the Link as the default row).

### 2.2 `POS Table` — essential (standalone doctype, NOT a child of Floor)

Orders must Link it, so it cannot be a child row.

| Field | Type | Notes |
|---|---|---|
| `table_label` | Data, reqd | **Text, not Integer** (Odoo's Integer `table_number` cannot model "Barra 3" / "Terraza A"). Optional `table_sort` Int for numeric ordering. alphabit's `Code`-blob-of-CSS-strings geometry is the anti-pattern — avoid. |
| `floor` | Link POS Floor, reqd | indexed |
| `seats` | Int, default 2 | default cover count (no seat-level model — neither Odoo 18 nor master models a seat) |
| `is_active` | Check, default 1 | soft delete |
| `layout` | JSON | `{left, top, width, height, rotation, scale, shape, color, roundedCorner}`. Do NOT shred into 8 columns — Odoo tried for years and moved to JSON. See §2.6 for the multi-plan alternative. |
| `needs_cleaning` | Check, default 0 | **the one status field worth storing** (§0.2) |
| `bill_printed_at` | Datetime | optional; clear on payment/close |
| `occupied` | Check, default 0 | **optional fast-repaint hint** (§0.2), reconciled from the open-order count; never the source of truth |
| `parent_table` | Link POS Table | **phase 2** — merge chain; MUST be cycle-guarded |
| `parent_side` | Select left/right/top/bottom | phase 2 — child render side |

- `autoname`: **`field:table_uid`** (`naming_rule: By fieldname`) over a
  client-generated UUID — **not** `POSA-TBL-.#####`, which breaks vertical-
  template idempotency (§2.0b, F3). **Uniqueness of (`floor`, `table_label`)**
  is then enforced in `validate()` (a bare `field:table_label` collides across
  floors, and the label must stay renameable).
- Bound the `parent_table` cycle walk (e.g. 32 hops) as well as detecting
  revisits, so a cycle already written by a bad migration cannot hang a
  request.
- The `layout` JSON should carry a **reference frame**, not bare pixels: store
  the floor's `{cols, rows, cell}` canvas and table `{x, y, w, h}` in grid
  units. Odoo stores centre-based pixels with no canvas size, so a plan
  authored on a desk screen needs guesswork on a tablet (research pitfall 12).
  The in-house precedent already solves it this way — taller's constructor
  positions on a fixed `COLS × ROWS × CELL` grid
  (`taller/frontend/src/pages/BinsConstructor.vue:379, 387`).
- Cycle guard on `parent_table` in `validate()`; roll back on cycle (URY carries
  4 throw-guards + a BFS cluster check for exactly this).
- `on_trash` / delete guard: refuse while an open order or open shift references
  the table (Odoo's `are_orders_still_in_draft` /
  `_unlink_except_active_pos_session`). Soft-delete via `is_active`.

### 2.3 `POS Table Order` — essential (the Record-Only ticket, §0.1)

The open table ticket. **Not** a draft Sales Invoice (§0.1). A lightweight,
shift-durable order that materialises an accounting document only at settle.

| Field | Type | Notes |
|---|---|---|
| `table` | Link POS Table | **nullable** — null = counter/takeaway/tab-only. NO unique constraint (one table → many open orders is what makes split bills work). |
| `pos_profile` | Link POS Profile, reqd | scope + re-open filter |
| `company` | Link Company, reqd | tenant scope |
| `pos_opening_shift` | Link POS Opening Shift, `search_index: 1` | binds the order to a shift **without** inheriting draft-invoice-delete-at-close (§0.1). A settle spanning a shift boundary is a policy choice, not a silent data loss. **Do not filter the floor by the caller's own shift** — shifts are per-user and a floor is shared; scope by the register's set of open shifts (§6.6, F5). |
| `status` | Select `Open / Settling / Settled / Cancelled` | the order's own lifecycle; table *board* colour stays derived (§0.2) |
| `guest_count` | Int | Odoo's `customer_count` |
| `service_type` | Link POS Service Type *or* Select Dine In/Takeout/Delivery | drives pricelist + **tax template** |
| `tab_name` | Data | Odoo's `floating_order_name` — the cafeteria "name on the cup" |
| `opened_by` | Link User | owning server |
| `customer` | Link Customer | optional; defaults to the profile's walk-in |
| `posa_client_request_id` | Data | idempotency key, mirrors the invoice field (§6.2) |
| `items` | Table → `POS Table Order Item` | order lines (item_code, qty, rate, uom, notes, `course_idx`, `fired`) |
| `sales_invoice` | Link Sales Invoice | set at settle; the accounting document |

- **`invoice_mode`** (preset-level, resolved from the capability profile) —
  three modes, **default chosen per profile, not globally**:
  - **`Sales Invoice`** — **the shipping default for `cafeteria-counter`**
    ("Sales Invoice per cup", decided 2026-08-10). Each ticket creates + submits
    its accounting document the moment it is paid — exactly the shipped retail
    flow. **Zero new machinery:** no `POS Table Order`, no settle step, no
    shift-close hazard (a submitted invoice is `docstatus=1`, never in the
    draft-delete set of §0.1). A cup held open before payment is an ordinary
    short-lived draft, submitted at pay within the shift.
  - **`POS Invoice`** — as above but writes POS Invoice, honouring the existing
    `create_pos_invoice_instead_of_sales_invoice` profile flag.
  - **`Record Only`** — **the default for `restaurante-mesas`**. The open ticket
    is a `POS Table Order` carrying no accounting document; a Sales / POS Invoice
    is materialised only at settle. This is the mode that needs the doctype in
    this section and the offline union-merge of §6.1.
  The mode is a **register-level** choice (it rides the capability profile), so
  one tenant can run a counter (`Sales Invoice`) and a dining room (`Record
  Only`) side by side. Because the sold food-service giro today is the counter
  cafeteria, the shipping path needs **none** of the Record-Only machinery — it
  is the existing per-ticket invoice flow with the `cafeteria-counter` vocabulary
  and tab-name identity on top.
- Settle = validate + submit the linked/created Sales Invoice through the
  **existing** `invoice_processing.creation.submit_invoice` idempotency ledger
  (SHA-256 over `client_request_id|company|pos_profile|doctype`), so the durable
  dedupe machinery is reused, not reinvented.

> **Alternative considered and rejected for tables:** custom fields on Sales
> Invoice (`posa_table`, etc.) with the draft invoice AS the ticket. Rejected by
> §0.1 (shift-close deletion). Those custom fields still ship — but on the
> *settled* invoice (§2.4), for reporting, not as the open-ticket backing.

### 2.4 Settled-invoice provenance fields — essential

On Sales Invoice (+ POS Invoice), for reporting/reprint on the accounting doc:

Field names take the mandatory `posa_rt_` vertical prefix (§2.0a) — v2's
unprefixed `posa_table` / `posa_guest_count` violate C8 and risk a silent
cross-app overwrite.

| Field | Type | Notes |
|---|---|---|
| `posa_rt_table` | Link POS Table | which table this sale settled from (nullable). `search_index: 1` — this is the floor screen's hot path (F9). |
| `posa_rt_table_order` | Link POS Table Order | back-reference to the Record-Only order. `search_index: 1`. |
| `posa_rt_guest_count` | Int | |
| `posa_rt_service_type` | Link POS Service Type | as resolved at settle |
| `posa_rt_waiter` | Link User | named `waiter`, not `opened_by`: ownership transfers at handover, and `owner` already means "who inserted the row" |

These ship on **both** `Sales Invoice` and `POS Invoice` — the POS Invoice
doctype is live in this stack (828 rows and 63 custom fields on the lab
tenant), and `delete_draft_invoices` already branches on
`create_pos_invoice_instead_of_sales_invoice`
(`closing_processing/invoices.py:102-110`), so a single-doctype rollout would
leave half the tenants unfielded.

Offline note (verified): these fields on Sales Invoice **survive the offline
write-queue round-trip with zero snapshot-layer changes** — invoices are
write-only in the sync registry, the queued payload is the live `doc` cloned
whole, and `update_invoice`/`submit_invoice` keep any real fieldname. Only the
Custom Field must exist (`custom_field.json` + the single `hooks.py` entry) and
the SPA must set it. No offline read-list edit needed for invoice-side fields.

### 2.5 Coursing — phase 2

- Catalog `POS Course`: `course_name` (Data, reqd, unique), `sequence` (Int),
  `item_groups` (Table → Link Item Group) so a category implies a default course
  (Odoo's `pos.category.course_id`).
- Per-order: the course lives as `course_idx` (Int) + `fired`/`fired_at` on the
  `POS Table Order Item` row, plus an optional `POS Table Order Course` child for
  fire-timing. **Integer index, not a child→child Link** — Frappe child rows are
  poor Link targets (the one place NOT to copy Odoo's Many2one line→course).

### 2.6 Geometry model — pick per-venue (v2 offers both)

- **v1 default — JSON-on-table** (§2.2 `layout`): simplest, fine when one table
  belongs to exactly one plan. Odoo's own direction of travel.
- **Multi-plan — `POS Floor Plan Table` junction** (Rocket-Quack's model): a
  child of `POS Floor` (`table` Link, `pos_x`, `pos_y`, `width`, `height`,
  `rotation`, `z_index`) so ONE physical table appears in MULTIPLE plans
  (terrace vs indoor) and geometry is queryable, not a blob. Adopt only when a
  venue reuses a table across plans; otherwise the JSON blob wins on simplicity.

Document the trade-off in the preset; don't force one on every tenant.

### 2.7 `POS Table Session` — optional, phase 2 (stored occupancy/lifecycle)

Rocket-Quack's occupancy record, if dwell-time + bussing analytics matter: 5
timestamps (`opened_at, first_order_at, last_paid_at, cleaning_started_at,
cleaning_done_at`), `status` Open|Cleaning|Closed|Cancelled, `waiter`, `guests`.
This is a **legitimately stored lifecycle record** (not derived) and is the
clean home for `needs_cleaning` + `bill_printed_at` + dwell + waiter — cleaner
than flags on the table when analytics are wanted. Keep the bare two-flags model
(§0.2) for v1; promote to a Session when bussing/analytics become real.

### 2.8 Fixtures / delivery

Custom fields ship via `hooks.py` + `custom_field.json` (CI coverage guard,
single entry invariant). Floor/table/order *records* are per-tenant data,
delivered via boat's `Doco Vertical Template` — **NOT** app fixtures (must not
land on retail tenants). A `restaurant` / `cafeteria` `POS Capability Profile`
preset declares `items_panel: tables`, the `floor` dock tab, the `tables`
capability, `invoice_mode`, vocabulary, and the kitchen print format. The POS
Capability Profile doctype itself stays out of `fixtures` (presets are
per-tenant).

---

## 3. State machine

| State | Meaning | Entered by | Storage |
|---|---|---|---|
| `free` | no open order references the table | default | **derived**: open-order count == 0 |
| `seated` | order open, 0 lines | server taps table | **derived**: open order, 0 lines |
| `ordered` | lines exist, nothing pending for kitchen | adding lines | **derived** |
| `sent` | lines dispatched to prep | Send/Fire | **derived**: unsent-change count == 0 and ≥1 fired course |
| `bill_printed` | proforma given | print-bill | **stored** `bill_printed_at` |
| `paying` | ≥1 payment, balance > 0 | first partial payment | **derived** from payments |
| `settling` | settle in progress | Settle tapped | **stored** on `POS Table Order.status` (guards double-settle) |
| `paid` | balance 0, finalised | invoice submitted | **derived** |
| `needs_cleaning` | paid, awaiting bussing | settle (auto-set) | **stored** `needs_cleaning` |
| `reserved` | future booking overlaps now | booking system | **out of v1** |

- Transition ownership: **tapping/opening the table IS the transition** (Odoo has
  no "seat guests" button, no status dropdown). "Release table" cancels an empty
  order.
- `settling` is the one *stored* transient beyond the two board flags — it
  exists only to make settle idempotent under a lost ack (§6). It is on the
  order, not the table.
- Timer escalation (Square): optional `Turn Yellow After` / `Turn Red After`
  colour on the tile — orthogonal to state, layered on top.

---

## 4. UX (proven patterns to copy; skip-list for v1)

**Copy** (converged across Odoo / Square / Toast / the Frappe verticals):
- **Floor screen as default landing** for the vertical, per-floor tab bar. Preset
  `Default Screen` escape hatch (Tables vs Register) for counter-only venues.
- **Render**: plain DOM divs on a relative container, positioned with CSS
  `transform: translate() rotate() scale()` — NOT canvas/SVG, NOT `left/top`
  (keeps drag/zoom on the compositor). Counter-rotate the label so the number
  stays upright. One `<div class="floor-table {shape}" data-table-id>` per table
  + an absolute badge for the unsent-kitchen-change count. `syncing` class while
  mid-sync; child tables at `opacity: 0.5`.
- **Opacity = free/occupied** (0.3 → 1.0), **colour = the user's own semantic**
  (section/station/VIP). One visual variable, no legend. **Badges** for volatile
  counts (order count, unsent changes).
- **Tap table → straight into the order.** No "seat party" dialog. One open
  order → open it; none → create one.
- **Table Selector / "Jump"**: numpad to jump to a table by label; a number
  matching no table can create a direct ticket.
- **Transfer as a modal gesture**: press Transfer → sticky banner → whole floor
  becomes a target → tap destination. Empty = move (pure FK reparent), occupied
  = confirm merge. One gesture, two outcomes. Trivial because status is derived.
- **Named tabs as a first-class peer of tables** (`Set Table` vs `Set Tab`) —
  this is what makes ONE build serve both a restaurant and a coffee shop.
  Cafeteria = tab-name (name on the cup) is the default identity; tables optional.
- **Kanban fallback on small screens** (Odoo's `isKanban()` when `ui.isSmall`,
  persisted in localStorage) — a drag-positioned plan need not be phone-usable.
- **Empty state routes to the editor** ("No tables yet — Edit your floor plan").

**Skip for v1:** full drag/rotate/snap/undo editor with decor (ship a backend
grid form + simple drag-to-move); seat-level ordering; split-by-seat /
evenly-by-N (Odoo ships only split-by-item); course-timing automation (manual
"Fire course N"); bill-printed state unless proformas are printed today;
reservations; the `POS Table Session` record; the multi-plan junction.

---

## 5. Kitchen routing (KOT)

- Route **by product category → printer/station** (Odoo's model): a
  `POS Kitchen Station` maps Item Groups → a printer or KDS target. The kitchen
  ticket is a **separate materialised projection** of the order (a KOT doc), not
  the order itself — diff against the last-fired snapshot to print only changes,
  and get a cancellation ticket for free.
- Conditional routing by service type / area (Toast's distinctive capability) is
  **phase 2**: a rule `(service_type|area) → reroute_from → reroute_to[]` that
  can duplicate a ticket to two stations.
- First "Send" fires course 1 automatically; everything else is explicit "Fire
  Course N" — a venue that ignores coursing never notices it exists.
- **Resolved open question (KOT doctype vs projection):** print-only projection
  with a **stored last-fired snapshot** for diffing. A full KOT doctype earns its
  keep only with a KDS (kitchen display) — defer it to whenever a KDS is on the
  roadmap. The snapshot lives on the `POS Table Order` (a `last_fired` JSON) so
  the diff survives offline.

---

## 6. Offline + concurrency — the load-bearing risks (verified against this fork)

This section is rewritten against the actual `offline/` layer. Line references
are to the fork as of this spec.

### 6.1 Two servers on one table WILL happen — line-level union merge

Odoo carries dedicated repair code ("The only way to get here is if there is
several waiters on the same table") that resolves by **line-level union**:
reparent every competing order's lines onto the oldest synced order, delete the
losers, drop nobody's items. **Never last-write-wins** (silently deletes a
waiter's order).

Verified seams in this fork:
- The prod-default drain path is `syncOfflineInvoices` (mode `"off"`), and it
  **discards the submit response** at `offline/invoices.ts:422-435` — the
  `frappe.call(...)` result is not even bound. **That is the exact insertion
  point** for a union-merge hook: capture the response, reconcile the server
  order's lines against the local queued lines, before `markWriteQueueEntrySynced`.
- The alternate outbox path (`invoiceOutbox.ts:280-293`) captures the response
  but extracts only the name. If the merge must work in both modes, hoist a
  shared `applySubmitResponse(entry, response)` called from both seams.
- **There is no backend merge seam.** Every conflict point resolves by overwrite:
  `creation.py:1336-1338` strips the client `modified`; `_save_draft_with_latest_timestamp`
  re-reads and does `latest_doc.update(current_state)` (a **full child-table
  clobber** — concurrent server-side line additions are silently lost, 2 retries
  then re-raise). A line-union merge must be **built**, not slotted in.
- The **only** in-repo precedent for merging two queued writes is the
  `customer:update:*` **coalesce** (`writeQueue.ts:257-269`, `362-372`) — a
  whole-payload last-write-wins replace. It must be **generalised to a per-line
  union** for table orders; it is not reusable as-is.

Because §0.1 moves the table ticket to a `POS Table Order` (not a Sales
Invoice), the union operates on `POS Table Order.items` rows keyed by a
per-line client id — cleaner than fighting the invoice submit machinery.

### 6.2 Idempotency — reuse the shipped machinery

The fork already stamps `posa_client_request_id` = `inv-<epoch_ms>-<8×base36>`
(prefix `pay-`, `cm-` for other entities) and dedupes server-side via a durable
**submission ledger** (SHA-256 over `client_request_id|company|pos_profile|doctype`),
race-safe on the DocType PK (`DuplicateEntryError` → fetch existing). **Settle
routes through this** (§2.3). Mirror `posa_client_request_id` onto
`POS Table Order` so an open-table write is idempotent too.

Caveat surfaced by the pass: `update_invoice` (the draft path) does **no** ledger
lookup — two `update_invoice` calls with the same id make **two drafts**. The
`POS Table Order` open/append endpoints must therefore do their **own** dedupe on
`posa_client_request_id` (or the queue's `idempotency_key`), not rely on the
submit ledger, which only guards settle.

### 6.3 Floor-plan edits vs live sync — optimistic-concurrency token

A whole-document floor save that deactivates anything missing from the payload
lets the second concurrent manager wipe the first's additions. Add a `modified`
timestamp check on `POS Floor` / `POS Table` writes (Frappe's built-in
`TimestampMismatchError` is the lever — but note the invoice path *strips*
`modified` to avoid it; the floor path must **keep and honour** it). Echo the
originating `device_identifier` so a device ignores its own broadcast.

### 6.4 Never hard-delete tables/floors/orders

A table referenced by a historical settled invoice breaks reporting. Soft-delete
(`is_active`), and block even that while an open order / open shift references
it (the same delete guard as §2.2).

### 6.5 Merged-table billing (phase 2)

Cycle-guard `parent_table`; **normalise every tap to the root** before looking
up the order, or a child spawns a second invisible order for the same party. URY
separates **table merge** (geometry: `merged_with` CSV + BFS cluster) from **bill
merge** (combining checks: `custom_merged_pos_invoice`) — the spec's phase-2
"merge" means **table merge** (one party across adjacent tables). Bill merge
(combining two parties' checks) is a separate, later feature — do not conflate.

### 6.6 Split bills — one agreed "open" predicate

Decide up front whether a split-off portion keeps `table` (shows on the floor as
a 2nd order → "free" must mean "no open orders", not "no order") or floats free
(Odoo's default; the floor stops showing it). **Recommendation: keep the FK**
(both halves visible) — a server splitting a check expects to still see both on
the table until each settles; that matches the derived-status model where "free
= zero open orders." Cap splits sanely (Odoo throws past 26).

**The predicate — one function, three call sites, and NOT "current shift"
(v2.1 correction).** v2 wrote the scope as *"status Open, unsettled, current
shift"*. The third verification pass shows "current shift" is a **blocker**:
`check_opening_shift(user)` filters `{"user": user, ...}`
(`posawesome/posawesome/api/shifts.py:138-149`) — **shifts are per-user**. The
lab tenant right now has **three simultaneously-open shifts on the same POS
Profile under three different users**. Waiter A's order carries A's shift; a
predicate scoped to B's shift cannot see it, so B's floor shows the table free
and B seats a second party on it. That is the multi-waiter collision arriving
through the data model, with both waiters **online** — so §6.1's union-merge
does not cover it.

```python
# posawesome/posawesome/api/restaurant/_tickets.py — THE definition.
def open_order_filters(table=None, shifts=None):
    """Every caller uses this: floor render, delete guard, re-open-on-tap.
    Diverging is how table state and ledger state start disagreeing.

    `shifts` = the set of OPEN shifts for the REGISTER, never the caller's
    own shift (shifts are per-user, api/shifts.py:138-149).
    """
    f = {"docstatus": 0, "status": "Open"}
    if table is not None:
        f["table"] = table
    if shifts is not None:
        f["pos_opening_shift"] = ["in", list(shifts)]
    return f
```

Bound that shift set by staleness, or a zombie shift poisons it — the lab has
one open since 2025-07-22. **Related trap:** `is_shift_stale` treats *any*
shift started on a previous calendar day as stale (`shifts.py:128-134`) and the
SPA "routes a stale shift straight into the closing flow" (`shifts.py:155-157`),
so **a dinner service crossing midnight forces the closing flow mid-service**.
A restaurant needs a business-day boundary, not a calendar-day one (D3).

Fast-repaint corollary: `reconcile_table_occupancy(table)` sets the cached
`occupied` Check from `count(open_order_filters(...)) > 0` and is the **only**
writer of that field (`read_only: 1` on the doctype enforces it).

### 6.7 Realtime occupancy — room + reconnect gap (verified)

**Correction (v2.1): the leak is intra-tenant, not cross-tenant.** v2 said the
`"all"` room "leaks across tenants". Verified against Frappe source in the
running container — it does not:

- `emit_via_redis` publishes `{event, message, room, namespace: frappe.local.site}`
  (`frappe/realtime.py:113-115`) and the socket server does
  `io.of("/" + message.namespace).to(message.room).emit(...)`
  (`frappe/realtime/index.js:79-81`). **Tenant isolation is the socket.io
  namespace, keyed on site name.** Two tenants on one bench cannot see each
  other's events, whatever the room.
- The real exposure is *inside* a tenant: `get_site_room()` returns the literal
  string `"all"` (`frappe/realtime.py:171-172`) and **every System User
  auto-joins it on connect** (`frappe/realtime/handlers.js:4-9`). So a bare
  `publish_realtime(event, msg)` reaches every POS user on the site **across
  every company and every register**. That is the reason to scope, and it is
  still a sufficient reason.
- **You cannot invent a room.** `handlers.js` exposes join handlers only for
  `doctype_subscribe` (`:32-36`), `doc_subscribe` (`:57-61`) and task rooms —
  there is **no generic room-join**, so a custom room like
  `posa_floor:<profile>` can be published to but never subscribed to from the
  browser.

- Broadcast occupancy on a **`doc:<DocType>/<name>`** room and have the client
  `doc_subscribe` to it. Permission-gating comes free: `doc_subscribe` calls
  `/api/method/frappe.realtime.has_permission`, which is
  `frappe.has_permission(doctype, doc=name, throw=True)`
  (`frappe/realtime.py:119-122`). **Prefer `doc:POS Floor/<floor>` over
  `doc:POS Profile/<name>`**: it is the natural fan-out unit (a device shows
  one floor at a time), and it avoids granting read on POS Profile — a
  configuration document — merely to receive occupancy pings.
- **Gap:** socket delivery has **no reconnect replay** — a device that was
  disconnected during a broadcast never receives it. Occupancy MUST therefore
  **pair every broadcast with an authoritative pull** on reconnect and on tab
  `visibilitychange` (re-query open orders for the floor's tables). Treat the
  socket as a latency optimisation over the pull, never as the source of truth.

### 6.8 Offline floor usability — the table catalog is NOT cached today

Verified: `POS Table` / `POS Floor` are **not** in the offline sync registry
(`offline/sync/resourceRegistry.ts` lists 13 resources; none is a table). Items
and customers ARE pulled, each with a **hardcoded field list** (no `["*"]`) and a
`SYNC_SCHEMA_VERSION` gate. To make the floor usable offline, the tables catalog
must be added as **new pulled resources**, following the shipped pattern:

- a read endpoint under `offline_sync/` with an explicit field list,
- a `resourceRegistry` entry (watermark by `modified`, full-resync supported),
- a Dexie table + read-mirror,
- and, on any field-list change, a `SYNC_SCHEMA_VERSION` bump (`common.py:7` +
  the per-module copy) to force a full resync.

Guard any doco-only column with `frappe.db.has_column` (the `saldo_enabled`
precedent at `item_processing/search.py:215`) so non-doco tenants don't break.

**Multi-device caveat:** two tablets offline *from the server but not each other*
cannot see each other's tables — a single Frappe server is the only coordinator.
Document that "offline" here means each device sees only its own open orders
until reconnect; this **bounds** the multi-waiter collision (§6.1), it does not
eliminate it. A LAN-local coordinator (Toast's "local hub device") is
explicitly out of scope.

### 6.9 Capability-version guard — inert for the common case

Verified: `CAPABILITY_PAYLOAD_VERSION` (`vertical.py`) rides the opening payload
as a sibling key and gates queued-invoice **replay** — a version mismatch routes
a sale to `update_invoice` (draft-for-review) instead of blind submit. Two gaps
to write into the build:
- it only moves on payload **shape** change, not preset **content** change —
  editing a `restaurant` preset's dock tabs does not invalidate a queued order;
- the guard is **inert when either side is `undefined`** (no preset linked = the
  retail default = the common case).

Implication: a change to the table-order *schema* (new required field on
`POS Table Order`) needs a deliberate `CAPABILITY_PAYLOAD_VERSION` bump **and**
the `SYNC_SCHEMA_VERSION` lever (§6.8) — neither is automatic.

---

## 7. Phasing

- **v1 (table service MVP):** `POS Floor` + `POS Table` + `POS Table Order`
  (Record-Only, `invoice_mode`); backend grid editor + simple drag-to-move;
  floor view registered for the `restaurant` vertical (`tables:pos`), `floor`
  dock tab, `tables` capability, `/floor` route; tap → open/create order;
  `table`/`tab_name`/guest-count binding; derived status render (opacity +
  badges); transfer (move only, merge-less); named-tab identity for cafeteria;
  kanban fallback; soft-delete + delete guard; settle → Sales Invoice through the
  submission ledger; **multi-waiter per-line union-merge on sync** (§6.1);
  occupancy via `doc:POS Profile/<name>` + reconnect pull (§6.7); tables catalog
  added to the offline sync registry (§6.8). Kitchen routing by category → one
  KOT projection with a stored last-fired snapshot.
- **Phase 2:** merges (`parent_table`, root-normalise, cycle-guard);
  `needs_cleaning` bussing flow; coursing (`POS Course` + fire); conditional
  kitchen routing; timer colours; optimistic-concurrency token on floor edits
  (§6.3); `POS Table Session` if analytics wanted; multi-plan
  `POS Floor Plan Table` junction if a venue reuses tables across plans; bill
  merge (distinct from table merge, §6.5).
- **Later / skip:** reservations; seat-level ordering + per-seat split; full
  drag/rotate/decor editor; KOT-as-doctype (until a KDS lands); LAN-local offline
  coordinator.

---

## 8. Open questions — status after the hardening pass

| # | v1 question | v2 resolution |
|---|---|---|
| 1 | Ticket = draft Sales Invoice, or a lighter order? | **RESOLVED → lighter `POS Table Order` (Record-Only), `invoice_mode` preset toggle.** Draft Sales Invoice is deleted at shift close (§0.1). |
| 2 | Split-off ticket: keep FK or float? | **RESOLVED → keep the FK** (both halves visible; matches derived-status "free = 0 open orders"). §6.6. |
| 3 | One profile per floor vs M2M? | **RESOLVED → start with the Link**, promote to `POS Floor Profile` child only on real demand. §2.1. |
| 4 | Occupancy broadcast room — per-profile or per-company? | **RESOLVED → per-profile `doc:POS Profile/<name>`** (permission-gated, tenant-isolated) + authoritative reconnect pull (no socket replay). §6.7. |
| 5 | KOT own doctype vs print projection? | **RESOLVED → print projection + stored last-fired snapshot**; KOT doctype deferred to a KDS. §5. |
| 6 | Reservations — bolt-on later or never? | **Deferred, likely never in this product.** A booking module's job; revisit only if a venue asks. |
| — | *(new)* Geometry: JSON-on-table or junction? | **Per-venue:** JSON default (v1), `POS Floor Plan Table` junction only for multi-plan reuse. §2.6. |
| — | *(new)* Store occupancy lifecycle? | **Two flags v1; `POS Table Session` phase 2** when dwell/bussing analytics matter. §2.7. |

Still genuinely open (needs Marco / a real venue to decide):
- **D1 — Is there a customer for table service yet?** The signup funnel sells
  exactly one food-service giro, **"Cafetería / fonda"**
  (`muelle-site/src/lib/signup.ts:507`), which resolves to `restaurante`. A
  full floor plan may be building for a segment that cannot currently be
  bought. Either add a table-service giro to the funnel first, or scope v1 to
  the **cafetería slice** — service types + `tab_name` + guest count, no floor
  plan — and let demand pull the rest. This is the single highest-leverage
  scoping decision in the document, and it is a product call, not a technical
  one.
- **D3 — Business-day boundary.** F5: `is_shift_stale` uses a calendar day
  (`shifts.py:128-134`), so a venue closing after midnight is routed into the
  closing flow mid-service. Restaurant-only setting, or a POS-wide fix?
- **`invoice_mode` default per profile — DECIDED (Marco, 2026-08-10):**
  `cafeteria-counter` → **`Sales Invoice` (per cup)**; `restaurante-mesas` →
  `Record Only`. The cafetería is the only food-service giro sold today (D1), so
  the shipping default is the zero-new-machinery per-cup flow; Record Only is
  opt-in for full table service. §2.3.
- **Proforma printing:** do any target venues print a proforma bill? If none,
  drop `bill_printed_at` from v1 entirely.
- **Coursing demand:** is any target venue actually course-driven, or is
  fire-on-send enough? Determines whether §2.5 is v1 or dead weight.

---

## 9. Deliberately rejected

- **Draft Sales Invoice as the open-table ticket** — deleted/submitted at shift
  close (§0.1). Use `POS Table Order` (Record-Only).
- **Storing derived table status** (free/seated/ordered/…) — recomputable from
  orders; storing invites drift. Store only `needs_cleaning`, `bill_printed_at`,
  and the transient `settling` on the order. Optional reconciled `occupied` hint
  is allowed but is never the truth.
- **Integer table numbers** — cannot model "Barra 3"; text from day one.
- **Geometry as columns / CSS-string blobs** (alphabit's anti-pattern) — JSON, or
  the numeric junction for multi-plan.
- **Table as a child of Floor** — orders must Link it; standalone doctype.
- **A global floor screen behind an `if`** — it is a registered view for the
  vertical, gated by the `tables` capability.
- **Last-write-wins on ticket sync** — silently drops a waiter's lines; per-line
  union required (§6.1).
- **Site-wide `"all"` socket room for occupancy** — leaks across tenants; use
  the permission-gated per-profile room.

---

## 10. Licensing (for any code borrowing)

POSAwesome is GPL-3, so borrowing GPL *ideas* is fine; **never paste** code from:
URY (AGPL, network-copyleft), alphabit / Rocket-Quack / ERPNext-restaurant
(GPL/AGPL — ideas only), or KirkGamo (**no license = all rights reserved** — the
`invoice_mode` *idea* is fine; ask the author before any code). Cleanest sources
to read closely for implementation detail: **Odoo `pos_restaurant` (LGPL-3)** and
Floreant (MRPL). Everything cited in this spec is a modeling idea, not copied
code.

---

## 11. Adversarial findings (ranked)

Findings from the third verification pass — the running bench, Frappe source
inside the container, and the live lab database. Each carries a severity, the
evidence, and the fix. **F1, F3 and F5 are blockers.**

### F1 — BLOCKER. Shift close force-deletes every held ticket
Already folded into §0.1. Summary: `POS Closing Shift.on_submit()` →
`delete_draft_invoices()` → `frappe.delete_doc(..., force=1)` over
`docstatus=0 AND posa_is_printed=0 AND posa_pos_opening_shift=<shift>`
(`pos_closing_shift.py:147-151, 167-168`; `closing_processing/invoices.py:100-125`).
165 drafts sit on one lab shift right now; all 409 are in the deletion set;
both carrying profiles have `posa_allow_delete = 1`. **Fix:** `POS Table Order`
(Record-Only) as §0.1 already specifies — this finding is the proof, not a new
proposal. Note C11 forbids patching the close path through M5, which removes
the alternative.

### F2 — SERIOUS. `posa_is_printed` is load-bearing; do not overload it
**Risk.** v1/research proposed reusing `posa_is_printed` as `bill_printed`. It
is not a display flag — it is the **survival flag** for shift close.
**Evidence.** Both `get_pending_draft_invoices` (`invoices.py:79-97`) and
`delete_draft_invoices` (`:100-125`) filter `posa_is_printed = 0`. A printed
draft is therefore *neither warned about nor deleted* — it is silently stranded
on the closed shift forever. Printing a proforma would silently change a
ticket's deletion semantics and hide it from the closer's list.
**Fix.** Track bill-printed on `POS Table Order` / `POS Table Session`
(`bill_printed_at`), never by reusing `posa_is_printed`. The stranding
behaviour is arguably a pre-existing bug worth logging separately.

### F3 — BLOCKER. Series autoname breaks vertical-template delivery
**Risk.** §2.8 delivers floor/table records via `Doco Vertical Template`. With a
`POSA-TBL-.#####` autoname, applying the template twice creates duplicates.
**Evidence.** boat's importer skips only when the fixture carries a `name` that
already exists, else `frappe.get_doc(item).insert()`
(`muelle/agent/sites.py:1703-1713`). But `frappe/model/naming.py:158-159`:
`if autoname.lower() not in ("prompt","uuid") and not frappe.flags.in_import: doc.name = None`
— the importer does not set `in_import`, so the fixture's `name` is
**discarded**, the first apply yields `POSA-TBL-00001`, and the second apply's
`exists()` check misses → duplicate. Same failure shape as Odoo bug #24831
(tables duplicate on session resume), reached by a different route.
**Fix.** `autoname: field:<uid>` over a client-generated UUID (§2.0b).
Deterministic per `naming.py:216-231`, therefore re-apply-safe, and it doubles
as the offline upsert key.

### F4 — SERIOUS. Occupancy broadcasts leak across companies inside a tenant
Folded into §6.7. Cross-tenant isolation is sound (namespace = site name);
the exposure is the site-wide `"all"` room that every System User auto-joins
(`frappe/realtime.py:171-172`; `handlers.js:4-9`). And no generic room-join
handler exists, so an invented room can be published to but never subscribed
to. **Fix:** `doc:POS Floor/<floor>` + `doc_subscribe`, permission-gated by
`frappe.realtime.has_permission`.

### F5 — BLOCKER. Shifts are per-user, so a shift-scoped predicate blinds waiters
Folded into §6.6. `check_opening_shift(user)` filters on `user`
(`api/shifts.py:138-149`); the lab tenant has three concurrent open shifts on
one profile under three users. **Fix:** scope to the register's set of open
shifts, staleness-bounded. Second-order: `is_shift_stale` uses a calendar-day
boundary (`shifts.py:128-134`), so a service crossing midnight is routed into
the closing flow mid-service.

### F6 — SERIOUS. The capability spine has never carried a real preset
**Risk.** The spec builds on the M1–M5 spine as though it were exercised. The
code shipped; the path has not run.
**Evidence.** On the lab tenant: **zero `POS Capability Profile` records
exist**, and **zero of five POS Profiles** set `posa_capability_profile`. Every
register runs the hardcoded `retail-phones` fallback
(`verticalStore.ts:56-67`). No `restaurante` preset exists anywhere, and
`VERTICAL_PROFILES_PLAN.md` M5 lists `coffee-quickserve` as the *first* full
layout vertical — still unbuilt.
**Fix.** Do not budget this as "add a view to a working spine". Budget a
preset-delivery shakedown first: create one profile, apply it end-to-end
through `Doco Vertical Template`, verify it survives the shift-open snapshot
and a cold offline boot, and check retail regression — cheap now, expensive as
a discovery.

### F7 — SERIOUS. Deployment ordering will abort the template import
**Risk.** Applying the restaurant template to a tenant whose posawesome is not
yet updated fails the **entire** import, not just the bad row.
**Evidence.** `pos_capability_profile.py:38-43` throws on an unknown dock tab,
and the agent's importer re-raises on the first failure
(`muelle/agent/sites.py:1708-1713`), aborting the batch before
`frappe.db.commit()`. Meanwhile `as_frontend_payload()` at `:67` *silently
drops* unknown tabs — so the two halves fail differently.
**Fix.** Gate the runbook: app code (new `VALID_DOCK_TABS`) ships first, then
the template. Add a template precondition check.

### F8 — SERIOUS. Unprefixed field names collide silently, and no lint catches it
Folded into §2.0a. C8:167-173 mandates `posa_rt_*`; verified that **no
`posa_rt_*` field exists** and `check_fixture_coverage.py` has **no prefix
check**. Custom Field records are `{dt}-{fieldname}`, globally unique per site,
**last writer wins silently**, and Sales Invoice already carries 51 fields from
six-plus apps. **Fix:** prefix every new field **and** add the missing lint as
part of this work.

### F9 — SERIOUS. The floor screen's hot path runs on unindexed columns
**Evidence.** `posa_pos_opening_shift` is fieldtype **Data** (not Link) and
carries **no index**; `tabSales Invoice` has exactly eight indexes
(`creation`, `customer`, `debit_to`, `inter_company_invoice_reference`,
`posa_client_request_id`, `posting_date`, `project`, `return_against`) — none
on `docstatus`. Frappe indexes only what declares `search_index`
(`frappe/database/schema.py:105`). Invisible at 4,849 rows; not invisible at a
year of restaurant volume with a polling floor.
**Fix.** `search_index: 1` on `posa_rt_table`, `table`, `floor`,
`pos_opening_shift`; serve the floor from one grouped snapshot query
(`taller/api/floor_plan.py:44-64` pattern), never per-tile counts.

### F10 — NIT, but decide now. Split-bill FK-vs-float blast radius
§6.6 already picks "keep the FK". The finding is that the **blast radius is
small only if the predicate is one function**. `alphabit` keeps the link and
changes the *predicate* instead (`status=Invoiced; show_in_pos=0`), which is
the same move. Decide before writing the predicate, not after.

### F11 — NIT. "Merge" is two features
Already correct in §6.5 (table merge vs bill merge). Retained here so the
ranked list is complete.

### F12 — NIT. Licensing hygiene
Already correct in §10.

---

## 12. Verified against codebase (file:line)

Read directly on 2026-08-10: source files in the tree, Frappe source **inside
the running lab container**, and the live lab database (read-only).

**v2 claims this pass corrected:** the `items_panel: "tables"` mount design
(§1); the realtime leak direction (§6.7); `POSA-TBL-.#####` autoname (§2.2);
unprefixed `posa_*` field names (§2.4); the "current shift" open predicate
(§6.6). Plus terminology: the vertical code is `restaurante`, and `cafeteria`
is a giro, not a vertical.

| Area | Citation |
|---|---|
| View registry keys; throw on unknown | `frontend/src/posapp/vertical/viewRegistry.ts:26-34, 36-49` |
| Async-view precedent noted in-registry | `viewRegistry.ts:15-18` |
| `CartStyle` / `ItemsPanelStyle` / `DockTabId` | `frontend/src/posapp/vertical/viewContracts.ts:55-62` |
| Cart/items required-event contracts | `viewContracts.ts:21-30, 45-52` |
| Capability resolution, role gating, `t()` | `frontend/src/posapp/stores/verticalStore.ts:143-168, 209-216` |
| Hardcoded `retail-phones` fallback | `verticalStore.ts:56-67` |
| Views resolved once in `setup()` | `Pos.vue:374-375` |
| Items/cart mount points, `context` prop | `Pos.vue:67, 116`; `v-show` rationale `:562-564` |
| `activeView` panels | `Pos.vue:59, 70, 81, 93`; `uiStore.ts:48` |
| Dock tabs from config; icon-less dropped | `Pos.vue:568-571, 622-623` |
| Typed `Events` map (mitt, 63 events) | `frontend/src/posapp/bus.ts:49-126, 128` |
| Capability doctype + validation + payload | `pos_capability_profile.py:14, 18-19, 31-43, 67`; `.json` (`autoname: field:profile_name`) |
| Scope guards | `posawesome/posawesome/api/_scope.py:205-221, 224-241, 244-284` |
| Shift resolution is per-user | `posawesome/posawesome/api/shifts.py:138-149` |
| Stale-shift rule + closing-flow routing | `shifts.py:128-134, 155-157` |
| Draft deletion at close (`force=1`) | `pos_closing_shift.py:147-151, 167-168`; `closing_processing/invoices.py:100-125` |
| Pending-draft enumeration (`posa_is_printed=0`) | `closing_processing/invoices.py:79-97` |
| Close prompt + block paths | `closing_processing/creation.py:259-290`; `usePosShift.ts:328-350` |
| Frappe version / native `JSON` | container: `frappe/__init__.py` (16.28.0); `frappe/model/__init__.py:42` |
| Autoname discards explicit name; `field:` deterministic | container: `frappe/model/naming.py:158-159, 216-231` |
| Index only when `search_index` | container: `frappe/database/schema.py:105` |
| Realtime namespace = site; room `"all"` | container: `frappe/realtime.py:113-115, 171-172`; `realtime/index.js:79-81` |
| Socket joins + permission gate | container: `frappe/realtime/handlers.js:4-9, 32-36, 57-61`; `frappe/realtime.py:119-122` |
| Template apply → agent import (insert-only) | `boat/boat/muelle/jobs.py:1305-1348`; `muelle/agent/sites.py:1646-1729` (snippet `1703-1713`) |
| `Doco Vertical Template` shape | `boat/.../doco_vertical_template/doco_vertical_template.py:9-20` |
| Vertical codes; cafeteria → restaurante | `doco/docoutils/giros.py:45-46, 137-139`; `test_giros.py:64` |
| Signup giro catalog | `muelle-site/src/lib/signup.ts:489-511` (food service `:507`) |
| Floor-plan precedent (derive-at-read, strip-on-save, no token) | `taller/taller/api/floor_plan.py:36-76, 138-140, 143-155`; `taller_floor_plan.py:8-19` |
| Grid-snapped rendering precedent | `taller/frontend/src/pages/BinsConstructor.vue:379, 387` |
| Plan constraints C4/C5/C7/C8/C11 | `docs/VERTICAL_PROFILES_PLAN.md:122-135, 138-145, 154-164, 167-173, 193-197` |

**Live lab database (read-only):**

| Observation | Value |
|---|---|
| Sales Invoice by docstatus | draft 571 / submitted 4156 / cancelled 122 |
| POS drafts are `is_pos=0`; submitted `is_pos=1` | 408 vs 3813 |
| POS drafts missing `pos_profile` | **408 of 409** — v1's `pos_profile=current` predicate matched zero rows |
| POS drafts with `posa_is_printed=0` | **409 of 409** (all deletable) |
| Drafts per open shift | 168 / **165** / 75 / 1 — oldest 2026-05-12 |
| Profiles with `posa_allow_delete=1` | 3 of 5, including both carrying the drafts |
| Simultaneously-open shifts | 5 across 2 profiles, 5 distinct users; oldest 2025-07-22 |
| `POS Capability Profile` records | **0** |
| POS Profiles setting `posa_capability_profile` | **0 of 5** |
| Custom Fields: Sales Invoice / POS Invoice | 51 / 63 |
| `tabSales Invoice` indexes | 8; includes `posa_client_request_id`, excludes `posa_pos_opening_shift` and `docstatus` |

---

*v2 hardening sources: Frappe-ecosystem survey (scratchpad `frappe-ecosystem-tables.md`);
codebase verification passes on `_scope.py` + POS Capability Profile, and on
`offline/{writeQueue,invoices,idempotency,invoiceOutbox}.ts` +
`api/invoice_processing/creation.py` + `offline_sync/`. External POS
cross-checks (Lightspeed / TouchBistro / Clover) in flight — confirmatory only;
they converge on the same floor-plan / tab-name / transfer-gesture / KOT-routing
patterns already captured.*

*v2.1 hardening (§11, §12, and the five inline corrections): a third pass
against the running lab bench, Frappe v16.28.0 source inside the container, the
boat/agent template-delivery path, the taller floor-plan precedent, and the live
lab database. Every claim in §12 was read at the cited location rather than
recalled.*
