# POS enterprise operations specifications

Version 1 · 2026-09-22 · Owner: Doco Mexico / POSAwesome.

**Status: complete first specification set; implementation and qualification
pending.** An initial [Cajas y turnos slice](02-cajas-workspace.md#initial-doco-slice-2026-09-22)
now reviews existing shifts; the full store/register foundation remains pending.
These documents describe required future behavior. Existing features
are identified separately with code/evidence links. No document here certifies
the deployed product, authorizes a production rollout or promises an unmeasured
capacity/availability tier.

The requested product is a store with N cajas, clear employee responsibility,
shared safe operations, complete work handoffs and a SaaS platform that can grow
to large retail estates. Each specification was authored as a complete vertical
contract in the order below. Shared invariants are normative across the set.

## 1. Read and implement in this sequence

| # | Specification | Employee/manager outcome | Dependencies |
| --- | --- | --- | --- |
| 01 | [Store and register foundation](01-store-register-foundation.md) | Named independent cajas under stores, with separate device/cashier/shift identities | Current shift/scope/accounting foundations |
| 02 | [Cajas workspace](02-cajas-workspace.md) | See the store, find the affected caja and finish its next action | 01; action adapters from later specs |
| 03 | [Shared safes and transfers](03-shared-safe-transfers.md) | Issue float, receive bags, move change and reconcile custody | 01; existing custody/accounting |
| 04 | [Cashier handover](04-cashier-handover.md) | Break, count, finish and hand over without mixing responsibility | 01, 03 |
| 05 | [Store business-day close](05-store-day-close.md) | Close each caja independently and reconcile the whole store | 01, 03, 04; source adapters |
| 06 | [Operational pending-work inbox](06-operations-inbox.md) | One owned queue of actionable problems with verified completion | 01; source recovery contracts |
| 07 | [Cross-register order continuity](07-cross-register-orders.md) | Start on a phone, continue at the counter and settle once | 01; source adapters; 06 recovery |
| 08 | [Device and equipment readiness](08-device-readiness.md) | Enroll/test equipment and recover without confusing print with payment | 01; existing transports; 06 cases |
| 09 | [Enterprise capacity and rollout](09-scale-isolation-rollout.md) | Measured scale, isolation, recoverability and controlled expansion | Cross-cutting from the first implementation |

Reading order is not permission to postpone resilience until the ninth feature.
The command/scope protocol in 01 and capacity/release gates in 09 apply to the
first change. Specs 02–05 may initially link existing recovery destinations;
spec 06 unifies those adapters without forcing a circular dependency or duplicating
their business logic.

## 2. Product decisions fixed for version 1

| Decision | Chosen behavior | Reason/extension boundary |
| --- | --- | --- |
| Tenant and location | Frappe site → Company → POS Store → POS Register | A store is not a Company, Warehouse or POS Profile |
| Store authority | POSAwesome operational Store; optional explicit channel links | Reuse Storefront Sucursal as a channel reference without requiring Doco for POS |
| Profile reuse | Several registers may inherit one POS Profile | Configuration template is separate from drawer/device identity |
| Cash responsibility | One accountable cashier and selling browser per drawer shift | Preserve the current safety boundary; shared-drawer teams need a new certified policy |
| Cash routing | Exclusive drawer accounting route per cash register initially | Every sale/refund/collection/movement must agree; enterprise account cardinality is a gate |
| Shared safe | One or more safes per store; several eligible registers per safe | No duplicated safe balance per profile; no company-wide lock for sales |
| Physical delivery | Immediate receipt and staged transit are distinct immutable modes | A bag already in the safe must not be posted through transit again |
| Verification | Independent count/receipt evidence; no self-verification | Physical safe placement does not prove the count |
| Handover | Return all physical drawer cash; next shift opens at zero and receives float | Prevent duplicate opening funds and silent PIN-based custody transfer |
| Break | Lock session while responsibility remains with current cashier | A break is not a financial handover |
| Day close | Operational close separate from financial/fiscal completeness | Next-day trading can proceed with disclosed prior obligations |
| Order mobility | Move unpaid source editing/collection opportunity, not posted money | Canonical source and original attribution survive |
| Financial uncertainty | Durable receipt/provider inquiry; never a fresh charge by default | Timeout is not failure proof |
| Offline boundary | Keep certified sale policy; new ownership/cash transfers are online-required | Remote coordination cannot be guaranteed in a network partition |
| Large tenants | Qualify named tiers; allow dedicated cell placement | No unsupported “unlimited”, transparent sharding or active-active promise |

These are proposed engineering defaults, explicit enough for implementation.
A future change to accountability, cash routing, cross-company/currency transfer,
shared drawers or authority placement requires an ADR plus updated acceptance
tests and migration contract. It is not an incidental UI setting.

## 3. Cross-cutting contracts and ownership

Every worker journey must support:

`scoped list → record → permitted contextual action → authoritative result → next action/return`

Store, register, customer/source, draft, filter, cursor and return context remain
attached throughout. Relevant Desk lists/forms use the same commands as the SPA.
No action should open behind an unrelated active view. All phone/tablet routine
flows have one useful vertical scroller and no horizontal page overflow.

Money and evidence rules: server-derived scope; immutable original attribution;
exact amount arithmetic; durable request identity; transactional local effects;
explicit external uncertainty; generation/revision fencing; independently
reviewed differences; canonical source resolution; append-only corrections.
Receipt identity survives retention/restore decisions. Realtime is notification,
not authority. Unknown/offline/stale never becomes zero, free, paid or verified.

| Domain | Owner | Integration obligation |
| --- | --- | --- |
| Cajas/store/shift/order-device experience | POSAwesome | Own canonical operational records and permission/action contracts |
| Ledger, invoice, stock and payment posting | ERPNext with existing approved app services | All routes/corrections reconcile; POS does not create a second ledger |
| Bag/count/transfer responsibility | POSAwesome custody | Preserve current evidence and idempotency, extend explicit store/register scope |
| Source service/order | Originating vertical app or canonical ERP record | Versioned source/settlement adapter; no duplicate balance model |
| Fiscal obligations | Installed Mexico compliance app | POS shows and routes state; fiscal authority remains in the app |
| Processor/top-up outcomes | Installed connector/Saldo | Authenticated callbacks, stable attempt identity and outcome inquiry |
| Print transport and shared Doco integrations | Existing Doco/QZ/connector owners | Typed adapter and physical evidence, no arbitrary payload bypass |
| Placement, desired state and cohort rollout | Boat | Tenant-safe orchestration without runtime selling dependency |
| Runtime, migrations, backups and restore | Muelle | Complete guarded evidence and recovery epoch execution |
| Metrics/alerts | Vigía plus app instrumentation | Observe; never silently repair financial records |

## 4. Delivery slices and exit gates

### Slice A — Identity and read-only operations

Implement 01 records/scope/routing resolver, migration dry run and 02 read-only
workspace. Build test fixtures and instrumentation from 09 immediately. Existing
single-register operation stays compatible. Exit: source/projection comparison,
scope denial, duplicate-open prevention, legacy route parity and mobile navigation.

### Slice B — Two cajas, one safe

Complete all financial routing consumers, shared-safe immediate receipt/drop,
staged change transfers and normal handover. Minimum native scenario: two
cashiers open two cajas, receive separate 1,000 floats from one safe, sell/refund/
collect/expense independently, transfer change, drop takings, close and hand over.
GL, source records, drawer counts, safe bags and clearing must reconcile exactly.
Inject same-bag races, lost responses and an old browser. Exit: FND/CASH/HND gates.

### Slice C — Store close and pending work

Complete source coverage, day/segment cutoffs, operational/reconciled close,
amendments and adapter-driven inbox. Include overnight operation only after its
specific gates pass. Exit: unknown payments/devices prevent false reconciliation;
next day remains usable with disclosed obligations; queue resolution is canonical.

### Slice D — Mobile continuity and equipment

Adapt retail orders first, then eligible table/vertical sources. Deliver enrolled
order-only devices, safe checkout claims and guided equipment checks. Exit:
phone → caja → canonical source completion, wrong-printer and payment-timeout
drills, actual supported physical hardware and no stale-order overwrite.

### Slice E — Chain and enterprise qualification

Run the complete suite at Chain then Enterprise cardinality, noisy-neighbor load,
safe contention, reconnect storms, historical exports and restore size. Fix
measured limits before advancing qualification. Exit: 09 evidence and explicit
supported envelope, not a feature checklist or a date.

## 5. Acceptance traceability

| Requirement family | Tests | Financial/source oracle |
| --- | --- | --- |
| Identity/scope/ownership | FND-T01–T12 | Runtime uniqueness, original shift, invoice/GL routes, grants |
| Workspace/interaction/freshness | CAJ-T01–T12 | Canonical status and scoped DTO/coverage, browser state |
| Cash custody/transfer | CASH-T01–T14 | Counts, bag location, GL balances, reservations and clearing |
| Employee handover | HND-T01–T12 | Count/close evidence, original/new shift and generations |
| Store closing | DAY-T01–T12 | Segment vectors, posted sources, counted assets and amendments |
| Operational recovery | OPS-T01–T12 | Source receipt/attempt/obligation outcome |
| Order continuity | ORD-T01–T12 | Source revision, remaining obligation and settlement identity |
| Equipment | DEV-T01–T12 | Enrollment proof, adapter result and physical observation |
| Enterprise operation | ENT-T01–T12 | Reconciliation plus workload/latency/isolation/restore receipts |

There are 110 named acceptance scenarios. Each is implemented in the appropriate
native, component, browser, physical-device or load lane; a single scenario may
need multiple tests. All required lanes must run rather than silently skip for
missing fixtures. Releases link test evidence to these IDs and record exclusions.

## 6. Migration and rollout review checklist

Before implementation affects a tenant, produce:

1. Inventory/mapping of profiles, stores, warehouses, drawers, safes, open shifts
   and client/queue versions; ambiguity report and unchanged monetary baseline.
2. Additive schema/index plan with measured backfill batches, compatibility
   reader/writer matrix and guarded-migration/DocType preservation checks.
3. Account-routing matrix covering sales, returns, collections, advances,
   expenses, custody, closing, offline replay and source-app checkout.
4. Source/permission/lock-order review with actual ERPNext posting behavior and
   independent transaction tests for race conditions.
5. Activation/rollback boundary per register and version; recovery access after
   hiding a feature; no routine DB rewind after new financial activity.
6. Native/browser/physical/load results, source SHA/CI, backup/restore receipts,
   supported capability/tier and unresolved limitations.

The [existing world-class roadmap](../../POS-WORLDCLASS-ROADMAP.md) remains the
broader product direction. This set supersedes its high-level assumptions only
for the nine specified operational areas. The current
[cash custody implementation record](../../POS-CASH-CUSTODY.md) remains evidence
of the shipped one-pair model; it is not rewritten as if multi-register work
were already deployed. No product changelog entry is warranted for specs alone.

## 7. Evidence and reference basis

Code baseline reviewed: POSAwesome `51dff897882297d25de0919c7a94f95f01c2290c`.
Implementation links in each spec identify the current owning modules. Doco's
`Storefront Sucursal` was inspected as an existing channel/location reference;
it lacks the operational company/custody contract required here.

Primary references checked while specifying the design:

- [Frappe database API](https://docs.frappe.io/framework/user/en/api/database):
  framework transaction behavior is relevant to atomic commands and rollback;
  actual installed-version behavior must be verified in native tests.
- [Frappe multitenancy](https://docs.frappe.io/framework/user/en/bench/guides/setup-multitenancy):
  the site model is the infrastructure starting point; it is not evidence of
  any capacity tier or store-level authorization.
- [Microsoft Dynamics Commerce cash management](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt):
  provides a reference for source/receiver cash reconciliation and store safes.
  Our immediate-drop, independent-verification and close rules deliberately
  retain the existing local custody contract rather than copying its ledger model.

Capacity numbers, schemas, state machines, default policies and delivery gates
are this specification's engineering proposals. They are not attributed to those
external references and are not benchmark results.
