# Restaurant / Cafeteria Table Management — Spec (v2, hardened)

Status: **HARDENED** (v2). v1 was a source-level study of Odoo `pos_restaurant`
(18.0 + master), Square for Restaurants, and Toast. v2 adds: a Frappe-ecosystem
survey (KirkGamo `restaurant_pos`, Rocket-Quack `erpnext_restaurant`, alphabit
`erpnext-restaurant`, URY), and two verification passes against **this fork's
actual code** (the `_scope` security surface + capability doctype; the offline
write-queue / idempotency / snapshot layer). Those passes turned five of v1's
open questions into firm, grounded recommendations — and overturned one v1
assumption outright (§0.1). Scope: the `restaurant` / `cafeteria` vertical of
the POSAwesome fork, built on the capability-profile + view-registry spine
already shipped (VERTICAL_PROFILES_PLAN.md, M1–M5). Owner: Marco.

This is a **spec, not an implementation**. Nothing here is built. Verticals
survey confirmed: `table_no|kot|waiter|table_number` = **zero hits** across the
fork — table management is fully greenfield here.

---

## 0. The insights that shape everything

### 0.1 A draft Sales Invoice is NOT a safe backing for an open table ticket (v2 correction)

v1 assumed "POSAwesome's open ticket is a draft Sales Invoice, reuse it." The
codebase verification pass shows that is **unsafe for table service**: a
POSAwesome held ticket is a `docstatus=0` Sales Invoice (or POS Invoice) that
is **auto-deleted or force-submitted at shift close**. A restaurant table left
open across a shift boundary (night audit, register handover, a party that sits
through close) would have its ticket silently destroyed or prematurely posted.
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
- **Layout / view registry**: add an `items_panel: "tables"` key → a `FloorView`
  registered in `vertical/viewRegistry.ts` under key `"tables:pos"`. The shell
  mounts it via the existing `resolveItemsView(...)` + `<component :is>` path
  (`components/pos/shell/Pos.vue:372`); the registry throws on unknown keys, so
  a typo fails loud, never a blank counter. **Three synchronized edits** to add
  the panel key: `VALID_ITEMS_PANELS` in `pos_capability_profile.py`, the
  registry map, and the preset.
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

Naming follows repo convention (`posawesome/posawesome/doctype/<snake_case>/`,
`POSA-…` autoname). Custom fields ship via `hooks.py` + `custom_field.json`
under the CI coverage guard — and note the guard's invariant: **exactly one
Custom Field fixtures entry** in `hooks.py` (a second entry silently overwrites
the first's export file). New `posa_*` fields append to the single existing
entry.

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

- `autoname`: `POSA-TBL-.#####`; **unique index on (`floor`, `table_label`)**
  enforced in `validate()` (a bare `field:table_label` collides across floors).
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
| `pos_opening_shift` | Link POS Opening Shift | binds the order to a shift **without** inheriting draft-invoice-delete-at-close (§0.1). A settle spanning a shift boundary is a policy choice, not a silent data loss. |
| `status` | Select `Open / Settling / Settled / Cancelled` | the order's own lifecycle; table *board* colour stays derived (§0.2) |
| `guest_count` | Int | Odoo's `customer_count` |
| `service_type` | Link POS Service Type *or* Select Dine In/Takeout/Delivery | drives pricelist + **tax template** |
| `tab_name` | Data | Odoo's `floating_order_name` — the cafeteria "name on the cup" |
| `opened_by` | Link User | owning server |
| `customer` | Link Customer | optional; defaults to the profile's walk-in |
| `posa_client_request_id` | Data | idempotency key, mirrors the invoice field (§6.2) |
| `items` | Table → `POS Table Order Item` | order lines (item_code, qty, rate, uom, notes, `course_idx`, `fired`) |
| `sales_invoice` | Link Sales Invoice | set at settle; the accounting document |

- `invoice_mode` (preset-level, resolved from the capability profile): `Record
  Only` (default for tables) materialises the Sales Invoice at settle; `Sales
  Invoice` / `POS Invoice` create the accounting doc immediately (the legacy
  hold-ticket behaviour, for a counter cafeteria that wants it).
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

| Field | Type | Notes |
|---|---|---|
| `posa_table` | Link POS Table | which table this sale settled from (nullable) |
| `posa_table_order` | Link POS Table Order | back-reference to the Record-Only order |
| `posa_guest_count` | Int | |
| `posa_service_type` | Data/Link | as resolved at settle |

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
= zero open orders." Cap splits sanely (Odoo throws past 26). Pin the "open"
predicate down **once** (status Open, unsettled, current shift) and use the SAME
predicate in the floor render, the delete guard, and the re-open query.

### 6.7 Realtime occupancy — room + reconnect gap (verified)

- Broadcast occupancy on the **`doc:POS Profile/<name>`** socket room — it is
  **permission-gated** (Frappe only delivers `doc:<dt>/<name>` events to users
  who can read that doc), giving clean tenant isolation for free. Do **not** use
  the site-wide `"all"` room (it leaks across tenants).
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
- **`invoice_mode` default per vertical:** `restaurant` → Record Only is clear;
  `cafeteria` (fast counter) — Record Only, or Sales-Invoice-per-cup? Depends on
  whether the cafeteria wants a table order at all or just tab-name tickets.
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

*v2 hardening sources: Frappe-ecosystem survey (scratchpad `frappe-ecosystem-tables.md`);
codebase verification passes on `_scope.py` + POS Capability Profile, and on
`offline/{writeQueue,invoices,idempotency,invoiceOutbox}.ts` +
`api/invoice_processing/creation.py` + `offline_sync/`. External POS
cross-checks (Lightspeed / TouchBistro / Clover) in flight — confirmatory only;
they converge on the same floor-plan / tab-name / transfer-gesture / KOT-routing
patterns already captured.*
