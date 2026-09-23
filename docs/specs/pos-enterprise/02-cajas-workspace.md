# 02 — Cajas workspace

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome. Requires [01](01-store-register-foundation.md).
Uses the command/scope protocol in 01 and capacity contract in [09](09-scale-isolation-rollout.md).

## 1. Outcome

A cashier finds and operates their caja. A store manager sees every caja that
needs attention and completes the next action without searching another app.
A regional manager starts with stores and exceptions, not thousands of cards.
No manager must open a selling shift merely to supervise cash operations.

This is an operational workspace. Sales analysis and accounting reports remain
linked destinations; a dashboard aggregate never authorizes a financial action.

## 2. Starting point and new responsibility

The existing [terminal status panel](../../../frontend/src/posapp/components/navbar/ShiftTerminalStatus.vue)
provides shift ownership and replacement recovery inside Offline Status.
The [cash custody view](../../../frontend/src/posapp/components/pos/custody/CashCustodyView.vue)
works in a profile context. Neither is a complete store register directory.
This specification reuses those commands and recovery rules behind a unified
entry point, while replacing technical browser language in routine journeys.

## 3. Information architecture

Primary destinations are **Cajas**, **Caja fuerte**, **Pendientes** and
**Cierre de tienda**. The manager's store selector is persistent. Regional
users can select a granted region or company, then drill into a store.

| Surface | Default content | Next action |
| --- | --- | --- |
| Cashier home | Assigned/current caja, shift and own pending work | Open/resume, receive float, count, handover or close |
| Store Cajas | Needs-attention first, then open, then available cajas | Inspect one caja or add one if authorized |
| Register detail | Responsible cashier, shift, equipment, last contact, cash actions, activity | Execute a state-valid action or resolve the linked blocker |
| Regional overview | Paged store rows with exception counts and freshness | Open affected store while retaining regional filters |
| Register history | Date-filtered shifts and linked sales/movements | Inspect immutable evidence and return to the same list position |

Suggested store card: “Caja Mostrador · Ana · Abierta desde 09:10”. Secondary
facts show cash collection guidance if authorized, unresolved item count and
“Último contacto hace 2 min”. The primary action is contextual; at most two
secondary actions are exposed without opening details.

## 4. Status contract

Keep lifecycle, work state, connectivity and exception severity separate.
One colored dot cannot encode all four.

| Axis | Values | Authority |
| --- | --- | --- |
| Lifecycle | Draft, Ready, Suspended, Retired | Register record |
| Work state | Available, Open, Handover, Closing, Recovery | Runtime pointer plus current shift/operation |
| Connectivity | Fresh, Stale, Unknown | Authenticated heartbeat observation |
| Attention | None known, Informational, Action needed, Blocking | Scoped unresolved source cases |

Connectivity defaults: heartbeat every 30 seconds with jitter while active;
Fresh through 90 seconds; Stale after 90 seconds; Unknown when never observed
or observation service is unavailable. A stale heartbeat means “Sin contacto”,
not “closed”, “free”, “no cash” or “safe to take over”. Thresholds are policy
values and tests use injected clocks.

Each response carries `as_of`, `projection_revision`, `source_watermarks` and
coverage (`complete`, `partial`, `unknown`). Unavailable money is null with an
explanation, never zero. “No pending work” is permitted only for the covered
server sources; the UI separately shows devices whose local work is unknown.

## 5. Cash visibility and permissions

The cashier sees their shift and available actions. With blind counting,
expected drawer amounts, comparison deltas and derived hints are omitted from
all DTOs, exports, counts, notifications and accessible labels until policy
permits disclosure. A collection alert must not indirectly reveal the hidden
expected amount. Manager and auditor amounts require separate capabilities.

Scope checks cover list rows, total counts, filters, autocomplete, details,
event subscriptions and exports. Changing a URL or return context cannot open
another store. The workspace cannot grant authority beyond the underlying
commands. Manager assistance records the approver separately from the operator.

## 6. Complete interaction flows

### Open and resume

Cashier selects an assigned available caja, sees readiness, confirms opening,
receives its float and lands at sales. If already open on this browser, Resume
restores the same shift and cart. If open elsewhere, show responsible person
and “Solicitar ayuda”; authorized recovery is a separate deliberate action.

### Attend an exception

Manager taps an attention count, sees a scoped list, opens a case, executes the
owning workflow and returns to the same filtered Cajas position. The resolved
case disappears only after authoritative confirmation. The register card updates
without jumping under the user's finger or changing their current selection.

### Start from another POS view

Opening Cajas from Cobranza, Mesas, Recargas or Settings preserves the current
draft and return location. The dock shows only actions owned by the active view.
A sales coupon or payment dialog cannot open invisibly behind Cajas. Shared
dialogs have one shell-level host; active-view handlers are mounted/registered
and disposed through the existing workspace contract. Navigation completion
must be acknowledged before focusing a dialog that depends on another view.

### Bulk management

Authorized managers may select registers for nonfinancial operations such as
schedule configuration or request a health check. Selection is capped at 100
per interactive batch, with an explicit preview and per-record result. A
tenant-wide change becomes a resumable job. No bulk “force close all drawers”,
“mark all received” or blind ownership takeover is provided.

## 7. Layout and accessibility

- At 320–479 CSS pixels, render one column, wrapping labels, full-width primary
  actions and a bottom sheet or full-screen detail with one vertical scroller.
- At tablet sizes, use a responsive list/detail layout when each pane retains
  useful width. Landscape must not hide the footer behind the virtual keyboard.
- Desktop supports denser rows and keyboard navigation; pagination/windowing
  prevents the store's entire estate from entering the DOM.
- No page or nested-panel horizontal scrolling for routine tasks. Wide audit
  data uses column selection, summary rows and record detail, not tiny tables.
- Tap targets are at least 44 × 44 CSS pixels; status includes text/icons;
  visible focus, logical tab order, labeled fields and polite live announcements
  are required. Restore focus after dialogs and preserve scroll on return.
- Transitions last 120–180 ms for view entry/selection, never delay commits,
  and disappear under reduced-motion preference. No animated sorting while
  touching or typing. Critical state changes are announced once.
- Loading skeletons preserve geometry; empty results explain filters and offer
  the relevant creation action. Errors retain the last view with freshness,
  a retry action and correlation ID.

## 8. Read model and APIs

`POS Register Status` is a rebuildable projection keyed by register, with store,
work state, shift/cashier reference, last source revision, last observation,
attention counts by severity and capability-filtered money summary references.
It is not a new accounting ledger. Expected cash is computed by the same shift
calculation used by closing, then projected with its source watermark.

| Query | Contract |
| --- | --- |
| `cajas.list(scope, filters, cursor)` | 50 rows default, 100 max; stable ordering; coverage and scoped totals |
| `cajas.detail(register)` | Current source verification, configuration revision, relevant action descriptors and paged activity links |
| `cajas.stores(scope, cursor)` | Paged rollups; no per-store N+1 requests |
| `cajas.activity(register, cursor)` | Actor, action, source link, server time and immutable reference; sensitive fields redacted |
| `cajas.subscribe(scope, cursor)` | Authorized topic for visible scope; bounded deltas and explicit resync instruction |
| `cajas.export(filters, fields)` | Asynchronous, authorized snapshot, source watermarks, download expiry and audit |

Action descriptors include `action_id`, target, enabled state, blocking reason,
required capability and safe route context. They aid discoverability; the server
still revalidates execution. Arbitrary client method names/redirect URLs are
not accepted.

Indexes cover `(store, work_state, register_id)`,
`(store, attention_severity, updated_at, register_id)` and source event identity.
Search indexes store/register codes and normalized labels. Regional totals use
incremental rollups; page requests never scan all historical invoices or GL.
Read-model lag over 5 seconds is displayed; over 30 seconds makes summaries
explicitly stale. Detail/actions read the authoritative source regardless.

Subscriptions are limited to the visible store or bounded region rollup; no
fan-out of every invoice to every manager. Permission changes revoke the
subscription and invalidate cached scope. Missed/out-of-order events trigger
snapshot refresh. Realtime failure falls back to jittered foreground refresh
at 30 seconds, with backoff and pause for background tabs.

## 9. Offline, failure and recovery

Cached register lists are read-only with timestamp and unknown local-work
coverage. Opening, takeover, financial actions and configuration require online
authority. Own offline sale behavior remains the certified shift policy; this
workspace does not broaden it. Do not clear a cart while trying to inspect cash.

A failed projection worker can be replayed from outbox checkpoints. List health
is reported separately from transactional health. A failed export or dashboard
refresh must not consume checkout worker capacity. A lost command response
uses the original operation receipt and shows “Verificando resultado”.

## 10. Acceptance and release

| ID | Required evidence |
| --- | --- |
| CAJ-T01 | Cashier opens/resumes their caja and returns from custody to the preserved sale. |
| CAJ-T02 | Manager with no shift supervises two cajas and resolves a case without impersonating a cashier. |
| CAJ-T03 | Regional list with 1,000 stores remains paged; requests and DOM stay bounded. |
| CAJ-T04 | Stale, absent and failed heartbeats never show a caja as available or grant takeover. |
| CAJ-T05 | Blind-count users cannot recover expected cash through DTOs, totals, alerts, exports or accessibility text. |
| CAJ-T06 | Cobranza → Cajas → detail → return preserves draft, filters and focus; no hidden sales dialog opens. |
| CAJ-T07 | 320, 390, 768, 844 landscape and 1440 px journeys have no horizontal overflow or unreachable action. |
| CAJ-T08 | Lost, repeated and out-of-order events converge without duplicate rows; projection outage is visible. |
| CAJ-T09 | Grant revocation removes subscriptions and export access as well as command access. |
| CAJ-T10 | Keyboard/screen-reader and reduced-motion journeys complete all routine actions. |
| CAJ-T11 | Concurrent update of an open detail produces an explainable revision conflict, preserving entered work. |
| CAJ-T12 | Load and eight-hour navigation soak satisfy spec 09 with no growing listeners or hidden duplicate modal hosts. |

Ship a read-only workspace first, prove scope and freshness, then expose existing
actions through their owners. Enable multi-register actions only after specs 01
and 03 are activated for the store. Rollback may hide the new entry point while
keeping existing transactional and recovery access available.
