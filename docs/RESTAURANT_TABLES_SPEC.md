# Restaurant / Cafeteria Table Management — Spec (v1 draft)

Status: DRAFT for review + hardening. Grounded in a source-level study of Odoo
`pos_restaurant` (18.0 + master), Square for Restaurants, and Toast (research:
session scratchpad `table-mgmt-research.md`). Scope: the `restaurant` /
`cafeteria` vertical of the POSAwesome fork, built on the capability-profile +
view-registry spine already shipped (VERTICAL_PROFILES_PLAN.md, M1–M5).
Owner: Marco.

---

## 0. The one insight that shapes everything

**Table status is derived from orders, not stored.** Odoo — the most mature
open model — has **no `state` column on the table at all**; occupancy is
computed at render time from the set of open tickets referencing the table
(`restaurant_table.js`). Only the two states that *cannot* be derived from
orders + payments need persistence:

- `needs_cleaning` (bussing) — nothing in the ledger implies it.
- `bill_printed_at` (proforma given) — only if the venue prints proformas.

Everything else — free / seated / ordered / sent / paying / paid — is a
function of the tickets on the table. Store the two exceptions on the table
record; derive the rest. This keeps table state and ledger state from ever
disagreeing, which is the failure mode that plagues bolt-on floor plans.

---

## 1. How it fits the vertical-profiles spine (do not rebuild)

The floor screen is a **registered view for the restaurant/cafeteria
vertical**, not a global screen behind an `if`. Concretely:

- **Capability**: a `tables` capability on the preset gates the whole feature
  (`verticalStore.has("tables")`). The `restaurant` / `cafeteria` presets
  declare it; retail/taller do not. Role-gated variants use the existing
  `capability:role` syntax (e.g. `void_ticket:Restaurant Manager`).
- **Layout / view registry**: add `items_panel: "tables"` → a `FloorView`
  registered in `vertical/viewRegistry.ts` keyed `(tables, pos)`. The shell
  mounts it via the existing `<component :is>` path; unknown-key throws stay.
- **Dock tabs**: the preset's `dock_tabs` gains a `floor` id (browse ↔ floor
  ↔ cart ↔ pay). The shell renders it from config exactly like the current
  tabs — grid tracks already follow the count.
- **Vocabulary (axis 4)**: `t("Customer") → "Mesa"`, `t("Order") → "Comanda"`
  via the preset `labels` map. Already wired.
- **Print format**: the preset's `print_format` binds the kitchen-ticket /
  proforma format. Already carried in the capability contract.
- **Route**: a `/floor` Vue route mirrors Odoo's `FloorScreen` page.
- **Realtime**: table occupancy broadcasts ride `stores/socketStore.ts`.
- **Offline**: table/ticket writes ride the existing
  `offline/{writeQueue,invoiceOutbox,idempotency}.ts` +
  `stores/offlineSyncStore.ts`.

Net-new doctypes are the only backend additions; the frontend slots into
existing extension points.

---

## 2. Data model (ERPNext / Frappe doctypes)

Naming follows repo convention (`posawesome/posawesome/doctype/<snake_case>/`,
`POSA-…` autoname hashes).

### 2.1 `POS Floor` — essential

| Field | Type | Notes |
|---|---|---|
| `floor_name` | Data, reqd | |
| `company` | Link Company, reqd | tenant scope |
| `pos_profile` | Link POS Profile | v1: one profile per floor. Promote to a child-table M2M (`POS Floor Profile`) only if a floor must serve multiple registers (Odoo's `pos_config_ids`). |
| `sequence` | Int, default 1 | tab order on the floor switcher |
| `is_active` | Check, default 1 | **soft delete — never hard-delete** |
| `layout` | JSON | canvas size, background colour/image ref, decor. Native `JSON` fieldtype; `Code`(options JSON) on older Frappe. |

### 2.2 `POS Table` — essential (standalone doctype, NOT a child of Floor — orders must Link it)

| Field | Type | Notes |
|---|---|---|
| `table_label` | Data, reqd | **Text, not Integer** (Odoo's Integer `table_number` cannot model "Barra 3" / "Terraza A" — pitfall 7). Optional `table_sort` Int for numeric ordering. |
| `floor` | Link POS Floor, reqd | indexed |
| `seats` | Int, default 2 | default cover count |
| `is_active` | Check, default 1 | soft delete |
| `layout` | JSON | `{left, top, width, height, rotation, scale, shape, color, roundedCorner}`. Do NOT shred into 8 columns — Odoo tried for years and moved to JSON. |
| `needs_cleaning` | Check, default 0 | **the one status field worth storing** (§0) |
| `bill_printed_at` | Datetime | optional; clear on payment/close |
| `parent_table` | Link POS Table | **phase 2** — merge chain; MUST be cycle-guarded (`_has_cycle`) |
| `parent_side` | Select left/right/top/bottom | phase 2 — child render side |

- `autoname`: `POSA-TBL-.#####`; **unique index on (`floor`, `table_label`)** enforced in `validate()` (`field:table_label` collides across floors).
- Cycle guard on `parent_table` in `validate()`; roll back on cycle.
- `on_trash` / delete guard: refuse while an open ticket or open shift references it (Odoo's `are_orders_still_in_draft` / `_unlink_except_active_pos_session`). Soft-delete via `is_active`.

### 2.3 Ticket ↔ table binding — essential (order → table, on the ticket)

POSAwesome's open ticket is a draft **Sales Invoice** (layaway uses on-hold
Sales Orders). Custom fields on Sales Invoice (+ POS Invoice):

| Field | Type | Notes |
|---|---|---|
| `posa_table` | Link POS Table | **nullable** — null = counter/takeaway ticket. NO unique constraint (one table → many open tickets is what makes split bills work). |
| `posa_guest_count` | Int | Odoo's `customer_count` |
| `posa_service_type` | Link POS Service Type *or* Select Dine In/Takeout/Delivery | drives pricelist + **tax template** |
| `posa_tab_name` | Data | Odoo's `floating_order_name` — the cafeteria "name on the cup" |
| `posa_opened_by` | Link User | owning server |

Derived rules:
- Ticket identity = `posa_table.table_label || posa_tab_name` (Odoo's `_getOrderName`).
- Re-open on tap: query open tickets where `posa_table = X and docstatus = 0 and pos_profile = current`.
- Merged tables (phase 2): resolve to the ROOT of the `parent_table` chain before querying — child tables never own tickets.
- Table "free" predicate = **count(open tickets) == 0**. Pin "open" down once (docstatus 0 / unpaid / not-yet-closed shift) and use the SAME predicate in the floor render, the delete guard, and the re-open query (pitfall 6).

### 2.4 Coursing — phase 2

- Catalog `POS Course`: `course_name` (Data, reqd, unique), `sequence` (Int), `item_groups` (Table → Link Item Group) so a category implies a default course (Odoo's `pos.category.course_id`).
- Per-ticket: child table `POS Ticket Course` on the invoice (`course` Link, `idx` Int, `fired` Check, `fired_at` Datetime); on Sales Invoice Item a plain `posa_course_idx` Int pointing at the row's `idx`. **Integer index, not a Link** — Frappe child rows are poor Link targets (the one place NOT to copy Odoo's Many2one line→course literally).

### 2.5 Fixtures / delivery

Custom fields ship via `hooks.py` + `custom_field.json` (the CI coverage guard
enforces it). Floor/table *records* are per-tenant data, delivered via boat's
`Doco Vertical Template` — NOT app fixtures (they must not land on retail
tenants). A `restaurant` / `cafeteria` `POS Capability Profile` preset declares
`items_panel: tables`, the `floor` dock tab, `tables` capability, vocabulary,
and the kitchen print format.

---

## 3. State machine

| State | Meaning | Entered by | Storage |
|---|---|---|---|
| `free` | no open ticket references the table | default | **derived**: open-ticket count == 0 |
| `seated` | ticket open, 0 lines | server taps table (occupancy auto-confirmed on tap) | **derived**: open ticket, 0 lines |
| `ordered` | lines exist, nothing pending for kitchen | adding lines | **derived** |
| `sent` | lines dispatched to prep | Send/Fire | **derived**: unsent-change count == 0 and ≥1 fired course |
| `bill_printed` | proforma given | print-bill | **stored** `bill_printed_at` (cannot derive) |
| `paying` | ≥1 payment, balance > 0 | first partial payment | **derived** from payments |
| `paid` | balance 0, finalised | payment validated | **derived** |
| `needs_cleaning` | paid, awaiting bussing | payment validated (auto-set) | **stored** `needs_cleaning` (cannot derive) |
| `reserved` | future booking overlaps now | booking system | **out of v1** (Odoo puts it in a separate module) |

- Transition ownership: **the act of tapping/opening the table IS the transition** (Odoo has no "seat guests" button, no manual status dropdown). "Release table" cancels occupancy for an empty ticket.
- Timer escalation (Square): optional `Turn Yellow After` / `Turn Red After` colour on the tile — orthogonal to state, layer it on top.

---

## 4. UX (proven patterns to copy; skip-list for v1)

**Copy:**
- **Floor screen as default landing** for the vertical, per-floor tab bar. Preset `Default Screen` escape hatch (Tables vs Register) for counter-only venues.
- **Render**: plain DOM divs on a relative container, positioned with CSS `transform: translate() rotate() scale()` — NOT canvas/SVG, NOT `left/top` (keeps drag/zoom on the compositor). Counter-rotate the label so the number stays upright. One `<div class="floor-table {shape}" data-table-id>` per table + an absolute badge for the unsent-kitchen-change count. `syncing` class while mid-sync; child tables at `opacity: 0.5`.
- **Opacity = free/occupied** (0.3 → 1.0), **colour = the user's own semantic** (section/station/VIP). One visual variable, no legend. **Badges** for the volatile counts (order count, unsent changes).
- **Tap table → straight into the order.** No "seat party" dialog. One open ticket → open it; none → create one.
- **Table Selector / "Jump"**: numpad to jump to a table by label. A number matching no table can create a direct ticket (Odoo).
- **Transfer as a modal gesture**: press Transfer → sticky banner → whole floor becomes a target → tap destination. Empty = move (pure FK reparent), occupied = confirm merge. One gesture, two outcomes.
- **Named tabs as a first-class peer of tables** (`Set Table` vs `Set Tab`) — this is what makes ONE build serve both a restaurant and a coffee shop. Cafeteria = tab-name (name on the cup) is the default identity; tables optional.
- **Kanban fallback on small screens** (Odoo's `isKanban()` when `ui.isSmall`, persisted in localStorage) — a drag-positioned plan need not be usable on a phone.
- **Empty state routes to the editor** ("No tables yet — Edit your floor plan").

**Skip for v1:** full drag/rotate/snap/undo editor with decor (ship a backend
grid form: Table Label, Seats, Shape, opt. W/H/Colour, + simple drag-to-move);
seat-level ordering (neither Odoo 18 nor master models a seat — `seats` is just
capacity); split-by-seat / evenly-by-N (Odoo ships only split-by-item);
course-timing automation (manual "Fire course N"); bill-printed state unless
proformas are printed today; reservations.

---

## 5. Kitchen routing (KOT)

- Route **by product category → printer/station** (Odoo's model): a `POS Kitchen Station` maps Item Groups → a printer or KDS target. The kitchen ticket is a **separate materialised projection** of the order (a KOT doc), not the order itself — diff against the last-fired snapshot to print only changes, and get a cancellation ticket for free.
- Conditional routing by service type / area (Toast's distinctive capability) is **phase 2**: a rule `(service_type|area) → reroute_from → reroute_to[]` that can duplicate a ticket to two stations.
- First "Send" fires course 1 automatically; everything else is explicit "Fire Course N" — so a venue that ignores coursing never notices it exists.

---

## 6. Offline + concurrency — the load-bearing risks

These are where naive builds break. All grounded in Odoo's shipped repair code.

1. **Two servers on one table WILL happen.** Odoo carries dedicated repair code
   ("The only way to get here is if there is several waiters on the same table")
   that resolves by **line-level union** — reparent every competing order's
   lines onto the oldest synced order, delete the losers, drop nobody's items.
   **Never last-write-wins** (silently deletes a waiter's order). This union
   belongs at the point where queued ticket writes reconcile
   (`offline/*` + `offlineSyncStore`).
2. **Floor-plan edits vs live sync.** A whole-document save that deactivates
   anything missing from the payload means the second concurrent manager wipes
   the first's additions. Add an **optimistic-concurrency token** (`modified`
   timestamp check) — Odoo has none and only defers refreshes during edit mode.
   Echo the originating `device_identifier` so a device ignores its own
   broadcast.
3. **Never hard-delete tables/floors** — a table referenced by a historical
   order breaks reporting. Soft-delete (`is_active`), and block even that while
   an open ticket / open shift references it.
4. **Merged-table billing** (phase 2): cycle-guard `parent_table`; normalise
   every tap to the root table before looking up the ticket, or a child spawns a
   second invisible ticket for the same party.
5. **Split bills**: decide up front whether a split-off portion keeps
   `posa_table` (shows on the floor as a 2nd ticket → "free" must mean "no open
   tickets", not "no ticket") or floats free (Odoo's default; the floor stops
   showing it). Cap splits sanely (Odoo throws past 26).
6. **Derive status from ONE agreed "open" predicate** everywhere (floor render,
   delete guard, re-open query). Odoo deliberately counts still-on-tip-screen
   finalised orders so a table doesn't flip to free while the server collects a
   tip.
7. **Offline table state**: keep the floor usable offline (swallow
   connection-lost, re-raise async for the banner) but refuse to open a table
   whose ticket is mid-sync. **Caveat for multi-device**: two tablets offline
   *from the server but not each other* need a LAN-local coordinator (Toast's
   "local hub device") to see each other's tables — a single Frappe server is a
   cloud coordinator, so document that "offline" here means each device sees
   only its own tables until reconnect. This bounds the multi-waiter collision,
   not eliminates it — hence the union-merge in (1).

---

## 7. Phasing

- **v1 (table service MVP)**: `POS Floor` + `POS Table` doctypes; backend grid
  editor + simple drag-to-move; floor view registered for the `restaurant`
  vertical; tap → open/create ticket; `posa_table`/`posa_tab_name`/guest count
  binding; derived status render (opacity + badges); transfer (move/merge-less);
  named-tab identity for cafeteria; kanban fallback; soft-delete + delete guard;
  multi-waiter union-merge on sync. Kitchen routing by category → one KOT.
- **Phase 2**: merges (`parent_table`), `needs_cleaning` bussing flow,
  coursing (`POS Course` + fire), conditional kitchen routing, timer colours,
  optimistic-concurrency token on floor edits.
- **Later / skip**: reservations, seat-level ordering + per-seat split, full
  drag/rotate/decor editor, LAN-local offline coordinator.

---

## 8. Open questions (for the review + hardening pass)

- Ticket doctype: is the open ticket always a draft Sales Invoice, or does
  table service want a lighter "POS Order" the way Odoo separates `pos.order`
  from the accounting invoice? (Trade-off: reuse the shipped invoice flow vs a
  cleaner table-order lifecycle. Measure against the existing draft-invoice +
  charge-request machinery before adding a doctype.)
- Split-off ticket ↔ table: keep the FK (floor shows both halves) or float
  (Odoo default)? Servers' expectation decides.
- One profile per floor vs M2M for shared registers — start with a Link, and
  only promote if a real venue needs it.
- Where does the floor-occupancy broadcast fan out — per-profile socket room,
  or per-company? (Concurrency + tenant isolation.)
- KOT as its own doctype vs a print-only projection with a stored last-fired
  snapshot for diffing.
- Reservations: bolt-on module later, or never (is this a booking product's
  job)?

---

## 9. Deliberately rejected

- **Storing derived table status** (free/seated/ordered/…): recomputable from
  tickets; storing it invites drift. Store only `needs_cleaning` +
  `bill_printed_at`.
- **Integer table numbers**: cannot model "Barra 3"; text from day one.
- **Geometry as columns**: JSON blob (Odoo's own direction of travel).
- **Table as a child of Floor**: orders must Link it; standalone doctype.
- **A global floor screen behind an `if`**: it's a registered view for the
  vertical, gated by the `tables` capability.
