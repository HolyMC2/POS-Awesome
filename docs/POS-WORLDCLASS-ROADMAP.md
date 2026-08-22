# POSAwesome World-Class Product Roadmap

Status: **v2 — independently audited**  
Owner: Doco Mexico  
Horizon: ideal future state, delivered incrementally  
Scope: POSAwesome, giro presets, demo/tenant seeds, Boat delivery contracts,
and the cross-app checkout seams used by Doco, Taller, Restaurante and Clínica.

Audit record: [`POS-WORLDCLASS-ROADMAP-AUDIT-V1.md`](POS-WORLDCLASS-ROADMAP-AUDIT-V1.md).

This roadmap answers one question: **what must POSAwesome become so a new
Mexican small business can open a register quickly, operate it confidently at
peak hour, and grow without replacing it?**

It is intentionally product-led. Architecture, performance, security and SaaS
operations are requirements of the product, not separate destinations.

V2 preserves the ideal future but separates it from the executable program.
The delivery commitment begins with **Scan Retail** and **Repair + Retail**,
the modes that serve current customers and exercise the strongest existing
seams. Restaurant remains a contracted beta until its correctness gates pass.
The other modes are future product options gated by paid discovery, not implied
commitments for the current team.

---

## 1. Product north star

POSAwesome becomes the fastest, clearest and most dependable point of sale for
Mexican small businesses, from one owner-operated counter to a multi-branch
merchant. One product serves many giros through certified register modes and
configuration, without tenant forks or a generic schema-driven UI.

The product promise:

1. **Ready quickly.** A provisioned tenant can complete a representative sale
   without consulting a manual.
2. **Fast under pressure.** Common actions feel immediate on ordinary Android
   hardware and unreliable shop networks.
3. **Safe with money.** A sale is never silently lost, duplicated, mispriced or
   attributed to the wrong register, shift, company or tenant.
4. **Obvious to operate.** The interface uses the merchant's vocabulary and
   presents the next useful action, not the implementation model.
5. **Adaptable without forks.** Giros provide strong defaults; registers may be
   configured within supported boundaries; tenant extensions use stable seams.
6. **Operable as SaaS.** Every configuration is versioned, observable,
   testable, rollable out by cohort and recoverable.

### North-star outcome

Among eligible self-serve merchants provisioned during a calendar month, at
least 90% complete their mode's instrumented golden flow within seven days
without a support intervention. Report the 7-day and 30-day funnels, sample
size, exclusions, demo/training status and mode separately. Do not claim the
percentage below 30 eligible tenants in a mode; show the raw numerator instead.

Lost, duplicated, cross-tenant and silently mispriced sales are zero-tolerance
incidents, not averages that may be traded against this adoption metric.

---

## 2. Non-negotiable design principles

- **One core, several certified modes.** No per-giro frontend forks.
- **Register-level mode.** A tenant or company may run different modes on
  different POS Profiles.
- **Capabilities, not vertical-name conditionals.** Components consume a
  typed resolver over an immutable shift snapshot.
- **Opinionated defaults, bounded customization.** Configuration cannot create
  untested arbitrary combinations on a money path.
- **Offline is a normal state.** Every surface declares whether it is available,
  queued, cached-read-only or blocked offline.
- **Server authoritative.** Scope, price, discount, stock, shift, authorization,
  payment and idempotency invariants are revalidated on the server.
- **Progressive complexity.** A cashier sees sale tasks; supervisors see
  exceptions; owners see configuration and insight.
- **Local-first latency, durable server truth.** Scan, cart editing and tender
  entry do not wait on avoidable round trips; durable writes reconcile through
  idempotent server contracts.
- **Accessible by construction.** First-party screen flows target WCAG 2.2 AA;
  touch, keyboard, screen-reader, contrast, motion and localization are
  component acceptance criteria. Certified hardware and third-party dialogs
  document unavoidable platform constraints rather than hiding them.
- **Extensions cross explicit seams.** Taller, healthcare, saldo, CFDI,
  terminals and future apps integrate through versioned contracts.

### Explicit non-goals

- A drag-and-drop application builder.
- Arbitrary tenant-authored JavaScript in the POS.
- One UI that exposes every ERPNext feature to every cashier.
- Separate codebases for restaurant, repair, retail or clinic.
- Blind parity with Square, Toast, Lightspeed or Shopify.
- Replacing ERPNext as the accounting and inventory system of record.

---

## 3. Product model

The resolved register experience is:

```text
tenant entitlement
  + installed apps and schema
  + company / branch policy
  + certified register-mode version
  + POS Profile overrides
  + terminal hardware profile
  + user role and approval policy
  + shift-opening snapshot
  = effective POS contract
```

The contract contains only typed, validated fields:

- capabilities and role gates;
- navigation and task layout;
- terminology;
- cart, catalog and payment behavior;
- offline policy;
- print/document bindings;
- hardware bindings;
- approval thresholds;
- service, fulfillment and fiscal policy;
- theme tokens and brand assets;
- contract and seed versions.

Unknown keys are rejected in authoring. Runtime resolution has three explicit
states—never one broad fallback:

- `unconfigured`: a legacy register receives a named, minimal compatibility
  profile whose behavior is documented and migration-safe;
- `invalid`: corrupt, incompatible or impossible configuration blocks shift
  opening and selling with an actionable readiness report;
- `temporarily_unavailable`: the register may use its signed/stamped
  last-known-good contract when the failure is transient and its schema/app
  compatibility still validates.

An invalid profile must never silently become a feature-rich retail profile.
The resolved contract is stamped on the opening shift and queued writes.
Mid-shift product changes wait until the next shift unless an emergency kill
switch removes a dangerous optional capability.

### Runtime configuration layers

Keep the hot-path merge model small:

1. **Certified mode version:** safe product defaults maintained and tested by
   Doco; a giro selects one and supplies seed/catalog/accounting content.
2. **Tenant/register overrides:** an explicit allowlist of operational choices;
   unsupported combinations cannot publish as certified.
3. **Shift snapshot:** immutable effective contract used by the register and
   stamped on queued writes.

A terminal hardware profile is referenced by the contract, not merged as a
fourth policy system. User authorization and approval limits remain server
policy; roles affect presentation but never create authority through config.

Each effective override exposes `value`, `mode default`, `override`, `version`
and `why locked`. Arbitrary navigation ordering, user layouts and raw-JSON
authoring remain deferred until observed merchant demand justifies their test
matrix.

---

## 4. Certified register modes

Giros select a mode and seed; modes define the cashier workflow. The official
set remains small enough to certify end to end.

### 4.1 Scan Retail

Primary giros: abarrotes, comercio, papelería, ferretería, refacciones and
general retail.

Golden flow: open shift → scan mixed basket → quantity/price check → optional
customer → cash/card/split tender → receipt → change → next basket.

Mode requirements:

- barcode-first home position and hardware scanner wedge support;
- instant duplicate-scan quantity behavior, configurable by item class;
- fast unknown-barcode resolution and supervised item creation;
- price check without contaminating the cart;
- suspend/recall, returns, exchange and customer credit;
- high-volume catalog search and category browsing;
- cash drawer, receipt, customer display and label printing;
- stock confidence and low-stock substitution without blocking sale policy;
- cashier-safe shift open, cash movement and close.

### 4.2 Controlled Retail

Primary giros: farmacia, carnicería, frutería, joyería, ropa/calzado and other
businesses where batch, serial, weight, variant or fiscal classification is
central.

Adds to Scan Retail:

- scale/weight capture, tare and price-embedded barcode support;
- batch, expiry and FEFO selection;
- serial/IMEI and warranty identity;
- size/color variant matrix;
- per-item IVA/exento policy and compliance prompts;
- controlled overrides with reason codes and supervisor approval;
- traceable waste, shrink and return disposition.

The giro chooses which identity controls are required; unrelated controls do
not appear.

### 4.3 Quick Service

Primary giro: cafetería/fonda and counter food service.

Golden flow: choose service type → select menu tiles/modifiers → name tab →
send preparation ticket → accept tender → print/announce order.

Mode requirements:

- menu-first tiles optimized for repetition and one-handed use;
- required/optional modifier groups with min/max rules;
- combos, sizes, add-ons and availability/sold-out state;
- named tabs, pickup sequence and customer display;
- dine-in/takeout/delivery vocabulary and tax/document policy;
- kitchen station routing, re-fire/void authorization and durable printing;
- tips where applicable;
- peak-hour queue view and production-ready state.

### 4.4 Table Service

Primary giro: restaurante with service at tables.

Golden flow: open table → guest count → add round → send by course/station →
transfer or split → proforma → tip → settle → mark clean.

Mode requirements:

- fast floor, list and search views of the same authoritative order set;
- explicit table state and next actions;
- multiple accounts per table with no aggregate/action ambiguity;
- courses, seat assignment, modifiers, notes and kitchen status;
- transfer, merge and split by item, seat, quantity or amount;
- waiter ownership plus manager visibility and handoff;
- proforma/bill-printed and cleaning state;
- partial payment, split tender, tips and service charges;
- Record-Only open tickets that survive shift boundaries;
- offline-safe order editing with conflict visibility.

### 4.5 Service Counter

Primary giros: barbería, uñas, mascotas, reparto and clinic front desk.

Golden flow: identify customer/appointment/job → load delivered services and
products → capture deposit/balance → tender → receipt/fiscal follow-up.

Mode requirements:

- customer-first search and appointment/job intake boundary;
- services, duration/provider attribution and products on one account;
- deposits, packages, memberships and outstanding balances;
- scheduled pickup/delivery and notification handoff;
- external-document checkout through a stable charge-request contract;
- privacy-aware customer and patient presentation;
- optional tips and provider commissions outside the cashier hot path.

### 4.6 Repair + Retail

Primary giros: celulares, electrónica, taller mecánico and bicicletas.

Golden flow: scan or locate completed Repair Order → verify customer/device →
review labor/parts/deposit/balance → tender → receipt/CFDI → mark delivered.

Mode requirements:

- existing POS Charge Request seam, never a duplicate repair model;
- device, serial/IMEI, job status and pickup authorization context;
- deposits, warranty/no-charge and already-invoiced guards;
- parts, labor, customer-supplied items and WIP accounting integrity;
- retail basket alongside repair checkout;
- repair receipt/document binding and cross-app callback audit trail.

---

## 5. Universal operator experience

### 5.1 First-run register setup

A guided setup validates, rather than merely collects:

1. register mode and branch;
2. warehouse and price list;
3. tax/fiscal posture;
4. tenders and accounts;
5. receipt and document formats;
6. scanner, scale, printer, drawer, customer display and terminal;
7. cashier/supervisor access;
8. sample transaction and reversal;
9. offline readiness;
10. go-live checklist.

The wizard produces a readiness report. A register cannot be certified ready
while a payment method lacks an account, a warehouse is unsuitable, the print
format is missing, or required giro data is absent.

### 5.2 Daily shell

- Home position matches the mode: scanner/search, menu, floor, customer/job.
- One consistent cart and tender mental model across modes.
- Next-action emphasis, no icon-only mystery actions.
- Undo for reversible local actions; confirmation only for consequential ones.
- Clear working state: saving, queued, synced, printing, failed, needs review.
- Keyboard and scanner shortcuts never steal focus from editable controls or
  overlays.
- Phone, tablet and desktop layouts preserve task order rather than merely
  shrinking columns.
- Cashier surfaces are sparse; supervisor functions use an authenticated sheet.

### 5.3 Payments

- Cash, card, transfer, store credit, gift value and supported processors share
  one tender contract.
- Split tender and partial payment are first-class where the mode permits them.
- The server validates paid total, currency, profile, role and approval state.
- Payment and invoice submission are independently idempotent.
- A collected-but-unsubmitted payment is a prominent recoverable state.
- Change due remains visible until acknowledged.
- Terminal status, retry and reconciliation never require interpreting raw API
  errors.

### 5.4 Returns and exceptions

- Return by receipt, item, customer, serial/batch or supervised no-receipt path.
- Original price/tax/tender attribution is preserved.
- Exchange is modeled as linked return + sale, not an opaque cart trick.
- Void, discount, price override, drawer open, reprint and offline exceptions
  carry actor, reason and approval.
- Supervisors receive an exception inbox; cashiers receive a clear next step.

### 5.5 Help and learning

- Contextual microcopy and empty states teach the workflow in place.
- A role- and mode-specific shortcut/help sheet is always reachable.
- Guided practice runs against reversible training transactions.
- Operator-facing errors include the failed task, what was preserved, and what
  to do next.

### 5.6 Universal transaction lifecycle

Every certified mode declares support and ownership for the same lifecycle;
omitting a stage requires an explicit non-goal or external-app handoff.

| Stage | POS contract | Mode-specific examples |
|---|---|---|
| Start | new, customer/job/order recall, device/register scope | scan basket, table account, Repair Order |
| Build | item/service identity, quantity, UOM, modifiers, stock | barcode, weight, batch, course, labor |
| Price | price list, promotion, loyalty, discount, override, rounding | combo, membership, supervised rate |
| Commit intent | suspend/recall, quote/order/deposit, reservation | parked sale, named tab, pickup order |
| Tender | cash/card/transfer/value, split/partial, authorization | change, terminal reversal, deposit allocation |
| Submit | idempotent ERP document, stock/accounting validation | POS Invoice, Sales Invoice, table settle |
| Fulfill | handoff, pickup/delivery, external callback | kitchen, repair delivery, local delivery |
| Document | receipt delivery and optional fiscal workflow | print, email/SMS, CFDI status/action |
| Reverse | cancel, void, return, exchange, refund, charge reversal | original tender, no-receipt approval |
| Reconcile | drawer, tender totals, over/short, pending writes | shift close, processor batch, exception inbox |

Cross-cutting lifecycles include promotions/coupons, loyalty, gift value,
customer credit, multi-branch returns, terminal replacement and device recovery.
These are certified separately when enabled; the presence of a button is not
certification.

ERPNext remains owner of purchasing, receiving, stock reconciliation,
accounting close and inventory transfers. POS exposes only the cashier boundary:
stock confidence, count/adjustment escalation, pickup/fulfillment state and a
deep link or task handoff. Appointment, clinical, repair and delivery source
records remain owned by their vertical apps.

---

## 6. Performance and resilience budgets

Performance is an API and UX contract. Targets are aspirational until measured
on the named benchmark; releases first gate statistically significant regression
against the recorded baseline.

### Benchmark profiles

- **Counter Low:** supported low-cost Android/Chrome, 4 GB RAM, touch + camera,
  10 Mbps/100 ms RTT, 5k items/2k customers, images mixed and warm cache.
- **Counter Standard:** supported Windows/Chrome terminal, 8 GB RAM, USB scanner
  + QZ printer, 30 Mbps/40 ms RTT, 10k items/10k customers, cold and warm runs.
- **Busy Service:** supported tablet/Chrome, 6 GB RAM, touch, 20 Mbps/80 ms RTT,
  100 open orders/50 tables/20 concurrent operators and kitchen printing.

Pin exact device/browser versions, server topology, concurrency, dataset hash,
cache state and network shaping in the benchmark manifest. Results without that
manifest are observations, not comparable evidence.

| Interaction | Target | Hard release ceiling |
|---|---:|---:|
| Warm launch to usable shell | ≤1.5 s p95 | 3.0 s p99 |
| Cold online launch to usable shell | ≤3.0 s p95 | 5.0 s p99 |
| Scan/click to cart paint | ≤50 ms p95 | 100 ms p99 |
| Local search result update | ≤75 ms p95 | 150 ms p99 |
| Server search response | ≤250 ms p95 | 600 ms p99 |
| Cart edit/recalculation | ≤50 ms p95 | 100 ms p99 |
| Payment screen open | ≤150 ms p95 | 300 ms p99 |
| Durable queue acceptance, where enabled | ≤400 ms p95 | 1.0 s p99 |
| ERPNext submission completion, no processor | baseline −20% goal | 3.0 s p99 goal |
| Receipt queued to QZ after completion | ≤300 ms p95 | 1.0 s p99 |
| Floor/table action response | ≤100 ms local / ≤500 ms durable | 1.0 s p99 |

Budgets include:

- JavaScript and CSS transfer/parse budgets per route and lazy feature;
- bounded DOM nodes and reactive objects;
- memory ceilings over an eight-hour shift;
- no listener, timer, worker or object growth across 500 sale cycles;
- query-count and DB-time budgets for every hot endpoint;
- cache correctness and invalidation tests, not cache-hit assumptions;
- synthetic low-bandwidth/high-latency/offline drills;
- graceful degradation when realtime, printer, worker or backend is unavailable.

Report UI input-to-paint, API server time, WAN end-to-end time, durable queue
acceptance, ERPNext completion, external terminal authorization and physical
print separately. “Acknowledged” never implies “submitted,” “paid,” or “printed.”

The sale path must remain usable during transient backend loss. Cold offline
launch is a certified capability only after the scoped web-route service worker
contract is proven; until then the product must state the limitation honestly.

---

## 7. Offline and synchronization contract

Every resource and mutation declares one of four policies:

- `offline_local`: authoritative record of local operator intent pending reconciliation;
- `offline_queue`: accepted with durable idempotent queueing;
- `offline_read`: cached read with visible freshness;
- `online_required`: blocked before value or money is promised.

Offline acceptance is further classified by financial risk:

| Class | Meaning | Required policy |
|---|---|---|
| A — intent | Local cart/order edit; no value promised | Queue and reconcile; show ownership/freshness |
| B — deferred invoice | Goods/service decision recorded; no payment captured | Merchant-configured limits, visible pending approval |
| C — cash collected | Operator physically accepted cash | Durable local journal, explicit merchant loss policy, mandatory reconciliation |
| D — external payment | Card/terminal/provider authorization | Online/provider-specific; never infer authorization from a queued request |

“Queued” means the operator's intent was preserved; it never means price,
inventory, credit, fiscal state, payment or ERP posting was approved.

For each enabled B/C path, the certified mode states inventory reservation,
maximum amount/discount/credit exposure, fiscal timestamp policy, shift
reassignment, fulfillment permission and rejection ownership. A replay rejected
by server rules becomes a supervisor-owned exception; it is not silently
rewritten.

Required guarantees:

- unsynced sales and payments survive reload, restart and version upgrade;
- every mutation has a stable client request ID and server ledger;
- retry uses exponential backoff and never exhausts in seconds;
- dead letters are visible, exportable, attributable and requeueable;
- configuration/scope changes cannot replay against the wrong profile;
- price, stock, tax, approval and shift rules are revalidated on replay;
- conflicts preserve both operator intent and server truth for review;
- shift close accounts for all pending writes or blocks with a resolution path;
- cache repair never deletes unsynced financial work;
- operator status distinguishes network, authentication, backend and sync health.

Mode-specific rules are explicit: saldo/top-up remains online-required; table
orders may queue edits only under a single-device lease/owner. Cross-device
offline table collaboration is unsupported until reconciled. Payment-terminal
capture follows processor guarantees.

---

## 8. Giro seeds and certification

A giro is not product-ready because its name exists in `GIRO_MAP`. It is ready
only when its entire first-day story is certified.

### Seed bundle contract

Each advertised giro bundle includes:

- vertical and certified register-mode version;
- company/accounting overlay and IVA defaults;
- POS Profile, warehouse, price list and valid payment accounts;
- capability profile and vocabulary;
- realistic item/service catalog with UOM, barcode, tax, stock and identity
  requirements;
- customers, suppliers and role-scoped users;
- printer/document formats and terminal defaults;
- representative history for dashboards;
- one golden scenario and at least one exception scenario;
- expected assertions and cleanup/reseed behavior.

Seeds must be deterministic, idempotent, additive-safe and versioned. Demo
history is clearly tagged and removable. Seeds never select Goods In Transit,
never rewrite a live price list as a test side effect, and never require a real
external credential.

### Certification states

- `mapped`: giro resolves to a platform vertical.
- `seeded`: idempotent catalog/account/profile seed exists.
- `workflow-ready`: representative browser flow passes.
- `contracted-beta`: existing customer commitment with named limitations,
  support owner and rollback path; not promoted as general availability.
- `limited-availability`: intentionally offered to a controlled cohort with
  qualification criteria and measured exit gates.
- `certified`: provisioning, accounting, offline, hardware and rollback gates
  pass on the current supported release.
- `marketed`: sales/signup may promise the tailored experience.

Public self-serve signup may market a tailored experience only for `certified`
giros. Contracted betas and limited-availability modes may be sold only with
their limitations recorded; others receive a transparent baseline or remain
invite-only.

### Initial certification order

1. celulares — flagship Repair + Retail;
2. abarrotes/comercio — Scan Retail baseline;
3. cafetería — Quick Service;
4. restaurante — Table Service;
5. farmacia — Controlled Retail batch/expiry seam;
6. ropa — Controlled Retail variant seam;
7. clínica — Service Counter/privacy seam;
8. remaining giros by demand, reusing the certified mode substrate — the
   named demand list and its mode mapping live in §17.1 (owner direction
   2026-08-17).

---

## 9. SaaS configuration and tenant lifecycle

### 9.1 Versioned artifacts

The control plane tracks independently:

- POSAwesome application/bundle version;
- capability schema version;
- certified mode version;
- giro seed version;
- tenant override revision;
- hardware profile revision;
- print/document revision;
- installed extension-app compatibility.

The current Boat template/importer is insert-only and has no per-record
ownership, update, removal or transactional rollback semantics. V2 therefore
starts with an additive **managed artifact manifest and ownership ledger**:

- artifact/version/hash and required app/schema versions;
- each managed document and field, last-applied value/hash and tenant override;
- validation result, apply job, actor and time;
- additive create/update plan for explicitly supported doctypes;
- rollback instructions and last-known-good contract reference.

Generic removal and arbitrary-doctype rollback are not promised. They arrive
only after each doctype has explicit merge/removal semantics. Existing inserts
are adopted only after current value and ownership are reconciled; vendor
updates never overwrite an unrecognized tenant edit.

### 9.2 Configuration studio

The owner-facing studio uses supported controls, not raw JSON:

- choose mode and approved layout/density;
- order allowed navigation tasks;
- select tenders, service types and fulfillment paths;
- bind print formats and hardware;
- edit terminology and theme tokens;
- set approval thresholds and role gates;
- choose allowed catalog views and offline policies;
- preview phone/tablet/desktop and cashier/supervisor experiences;
- run configuration validation before publish;
- schedule activation at the next shift.

This studio is a Later capability, after at least three real vertical slices
prove the override model. Initial configuration uses curated forms for the
small v1 allowlist. Advanced JSON remains an internal diagnostic/export format. Unsupported
capability combinations cannot be published as certified.

### 9.3 Rollout and rollback

- channels: internal → lab → canary tenants → cohort → general;
- compatibility preflight before code, schema, seed or profile activation;
- immutable build manifest and effective-contract fingerprint;
- health gates based on boot, sale, payment, sync, print and shift-close SLOs;
- automatic cohort halt on regression;
- data migrations are expand/contract and backward-compatible across rollback;
- tenant-level kill switches remove dangerous optional features without moving
  core configuration mid-shift;
- rollback restores code/config compatibility without reversing completed
  financial documents.

### 9.4 Fleet operations

Boat/Vigía expose:

- tenants and terminals by app/mode/seed/config version;
- stale or invalid configuration;
- boot and golden-flow SLOs by cohort;
- offline backlog/dead letters;
- printer, payment-terminal and realtime health;
- queue saturation/noisy tenant detection;
- migration and rollout status;
- security and supervisor exception signals;
- support-safe diagnostics with secrets and customer data redacted.

---

## 10. Extensibility contracts

Supported extensions register typed contributions:

- external document checkout provider;
- payment provider;
- product enrichment/provider marker;
- fiscal document provider;
- printer/terminal transport;
- registered task view;
- report card;
- seed dataset and certification scenario.

Each contribution declares version, required apps, capabilities, offline policy,
roles, data classification and health check. The POS core does not import a
vertical app directly. Missing extensions remove their surfaces cleanly and do
not prevent core sales from booting.

The current POS Charge Request boundary becomes the reference external-checkout
rail, owned by Doco—not yet a finished extension contract. Before calling it
v1, add schema version, currency/tax/discount/deposit allocation, immutable
payload hash and source revision, expiry, atomic claim/lease, cancellation and
reconciliation states, API-only mutation permissions, and a durable callback
outbox. POSAwesome consumes the rail; Taller and other vertical apps own source
truth and callback handling.

Saldo becomes the reference online-required product provider. CFDI becomes the
reference post-sale fiscal workflow. Restaurant becomes the reference
registered operational view.

---

## 11. Security, privacy and fiscal integrity

- All endpoints enforce user → company → POS Profile → opening shift scope
  before reading or writing business data.
- Client roles and flags are presentation hints only.
- Sensitive functions require fresh server authorization and, where configured,
  supervisor PIN/identity bound to the operation.
- Rate, discount, tax, payment, return, stock and fiscal invariants are checked
  server-side and tested with adversarial payloads.
- PII and financial data are minimized in IndexedDB, logs, telemetry, exports
  and customer displays.
- Device/session revocation invalidates future writes without corrupting queued
  evidence.
- Security events record actor, tenant, register, shift, action, reason and
  outcome without secrets.
- Retention and data-subject workflows preserve immutable financial records
  while redacting permissible customer data.
- Dependencies, CSP, headers, secret scanning and authorization matrices are
  continuous release gates.
- CFDI state is explicit: not requested, pending, stamped, failed, cancelled;
  a receipt never implies a fiscal document was stamped.

### Fiscal compatibility boundary

Mexican compliance is an optional tenant app with an explicit compatibility
capability. When absent, the POS clearly offers a commercial receipt only and
does not imply CFDI availability. The compliance app owns SAT catalogs,
customer fiscal validation, factura global/público en general, payment
form/method mapping, PUE/PPD and partialities, timezone/date boundaries,
substitution/cancellation reasons, stamping and cancellation. POSAwesome owns
data collection, eligibility/status presentation and the operator action seam.
Compatibility tests cover app-present and app-absent tenants independently.

---

## 12. Observability and product analytics

Technical telemetry answers whether the system works; product telemetry answers
whether the workflow works. Both are privacy-scoped.

### Golden signals

- availability, latency, errors and saturation for boot/search/submit/sync;
- queue depth and oldest age;
- dead letters and unresolved collected payments;
- print dispatch and confirmation where supported;
- service-worker/bundle activation failures;
- DB query time/count and cache effectiveness;
- memory/DOM/listener growth over a shift.

### Product signals

- time to first item and sale-cycle duration;
- scans/searches that produce no result;
- action retries, backtracks and cancellations;
- payment-screen abandonment and tender correction;
- supervisor interventions by reason;
- offline time, queued work and recovery time;
- shift-close discrepancies;
- first-run setup completion and assisted-support rate;
- mode/giro-specific golden-flow completion.

Every metric is segmentable by release, cohort, mode and anonymized tenant size,
without exposing item, customer, payment or employee content.

---

## 13. Quality system and release definition

### Cross-repository ownership

| Domain | Accountable owner | POSAwesome responsibility |
|---|---|---|
| Operator shell, cart, tender, shift, offline and hardware UX | POSAwesome | Own end to end |
| Effective register contract | POSAwesome | Schema, resolver, snapshot and consumer |
| Giro map, accounting overlays, datasets and Charge Request rail | Doco | Consume typed outputs; do not duplicate |
| Tenant desired state, artifact ledger, apply jobs and rollout | Boat | Publish compatibility/health contract |
| Host/site execution | Muelle agent/operations | Provide idempotent build/migrate/health hooks |
| Repair/clinic/restaurant source records | Vertical app | Load/settle through explicit integration seam |
| CFDI/SAT domain | Mexico compliance app | Collect/show state; never reimplement SAT logic |
| Monitoring and alerts | Vigía | Emit signals; Vigía observes and never writes POS state |

The tenant runtime has no synchronous dependency on Boat or Vigía. Their outage
cannot prevent an already configured register from booting or selling within
its declared online/offline policy.

### Operational acceptance and disaster recovery

- Define and test RPO/RTO separately for tenant database/files, managed
  configuration ledger and unsynced terminal queues.
- Restore drills verify that a restored tenant rejects or safely reconciles
  writes stamped against incompatible future state.
- Terminals are enrolled, named and revocable; lost/stolen device revocation and
  replacement preserve the financial audit trail.
- Support access is time-bounded, least-privilege and audited; impersonation is
  visible and cannot authorize payments invisibly.
- Detect clock drift and do not trust device time for fiscal/accounting truth.
- Browser quota/eviction recovery exports or preserves financial queues before
  destructive cache repair; encryption/key rotation policy is documented.
- Control-plane, monitoring, realtime, printer and external-provider outages
  each have a rehearsed degraded mode and support diagnostic.

### Test pyramid

1. Pure unit tests for money, capabilities, layouts, translations and offline
   state machines.
2. Component contract tests for task actions and accessibility.
3. Live Frappe integration tests for scope, concurrency, idempotency, posting,
   stock and accounting.
4. Browser golden flows for each certified mode and viewport/input class.
5. Hardware contract tests plus a small physical-device certification matrix.
6. Provision-from-zero, upgrade, downgrade/rollback and reseed drills.
7. Load, soak, chaos and network impairment tests.
8. Production canary synthetic transactions that never touch real money or
   external credentials.

Tests that skip because a required profile or schema is absent fail the
certification job unless the job explicitly declares that capability out of
scope. A green command with every relevant test skipped is not a pass.

### Definition of world-class complete

A feature is complete only when:

- operator task and failure behavior are specified;
- phone/tablet/desktop, keyboard/touch/scanner and Spanish are covered;
- online/offline/replay semantics are declared;
- scope, permission and audit behavior are enforced;
- performance budget is met;
- telemetry and support diagnostics exist;
- configuration inheritance and migration are defined;
- tests exercise the real integration path;
- seed/demo and documentation are updated where applicable;
- lab golden flow passes and rollout/rollback are documented.

---

## 14. Delivery program

The sequence is ordered by dependency and customer value. Dates are assigned
only after sizing against current capacity; exit gates, not calendar optimism,
move the program forward.

### Foundation 0 — Baseline and release gate

Execution status (2026-08-13): **restaurant Wave 0 complete**. The UI/UX and
exception-state contract is recorded in
[`RESTAURANT_UX_MAP.md`](RESTAURANT_UX_MAP.md); dirty/free, empty-order and
multiple-account blockers are corrected; 11 focused component contracts,
1,572 full frontend tests, 35 live Frappe restaurant tests, typecheck, lint and
desktop/phone Playwright acceptance are green on `doco-mirror`. Update
(2026-08-15): the legacy-field inventory is complete —
[`LEGACY-FIELD-INVENTORY.md`](LEGACY-FIELD-INVENTORY.md) covers all 117 POS
Profile fields (delta-classified against the 2026-07-11 wiring audit),
capability payload v3 reads and enforcement loci, the four mode presets and the
24-giro map. The certification and artifact vocabulary is established —
[`ARTIFACT-VOCABULARY.md`](ARTIFACT-VOCABULARY.md): the seven §8 states are
machine-readable in doco `giros.py` (`CERTIFICATION_STATES` +
`GIRO_CERTIFICATION` + a ratchet test refusing certified/marketed until the
certification job exists), and each §9.1 artifact is mapped to its current
representation or named gap. Remaining Foundation 0 work is the performance
baseline (the dashboard rendering the vocabulary is Boat/Vigía §9.4 scope).

- Resolve current restaurant audit findings: dirty-table action, empty-order
  charge, multiple-account ambiguity and FloorView navigation coverage.
- Make restaurant integration fixtures runnable on a declared lab site.
- Capture current bundle, boot, scan, search, payment and shift memory baselines.
- Inventory all POS Profile fields, capability reads, mode presets and giros.
- Establish the certification dashboard and artifact/version vocabulary.

Exit: current retail flow and restaurant slice have honest green gates; no
relevant all-skipped suite; baseline is reproducible.

### Foundation 1 — Effective configuration contract

Execution status (2026-08-14): **first safety slice implemented**. Capability
payload v3 distinguishes `unconfigured`, `invalid`, `resolved` and
`temporarily_unavailable`. Invalid linked profiles render without optional
capabilities or Pay and are blocked again at server submission; transient
resolution can use only a seven-day stamped last-known-good contract. Update
(2026-08-15): the legacy-read classification prerequisite is complete
([`LEGACY-FIELD-INVENTORY.md`](LEGACY-FIELD-INVENTORY.md) §5 names the
override-allowlist candidates, fold-into-token and hardware-profile
extractions, and the never-overridable server-policy set). Immutable shift
stamping is done: POS Opening Shift stores the resolved contract snapshot,
sha256 fingerprint and payload version as read-only submitted fields
(unconfigured registers stamp an explicit marker; mid-shift preset edits
never rewrite the stamp). Next-shift activation and the emergency kill
switch are done: server capability gates, the SPA resume path and
get_capability_json resolve from the open shift's stamp
(`shift_effective_capability_payload`), and site_config
`posa_disabled_capabilities` removes a dangerous optional capability
immediately from stamped and live resolution alike. The typed override
allowlist and provenance inspection are done: `OVERRIDE_ALLOWLIST` (v1:
`layout.lean_vertical`, `layout.hide_items_until_search`, merge rule
enable_only) is merged server-side into the resolved payload, and
`get_contract_provenance` exposes value / mode default / override / why
locked per key, shift-aware, with `pending_next_shift` marking edits that
wait for the next opening. Update (2026-08-15): the Boat artifact ledger and
the thin seed manifest are done — `Doco Applied Artifact` records every
template apply (site, artifact/version, sha256 content hash, outcome, managed
document names; `template_drift()` answers current/stale/never-applied per
tenant), `Doco Vertical Template` carries a human-bumped `template_version`,
and boat `seed_manifests.py` holds the first certification manifest
(`abarrotes-comercio-thin`: catalog/accounting/profile version pins, seven
expected assertions, golden-flow ID, provision-from-zero steps) with the
tenant-side runner in doco `seed_verify.py`. Foundation 1 scope is complete;
per-field override reconciliation stays §9.1 later work by design.

- Publish a small typed capability schema, explicit override allowlist and
  `unconfigured`/`invalid`/`temporarily_unavailable` resolver states.
- Inventory and classify all legacy POS Profile reads before migrating any flag.
- Add minimal provenance inspection and configuration validation.
- Version/stamp effective contract at shift open and on offline writes.
- Introduce next-shift activation and emergency capability removal.
- Add Boat's additive artifact manifest/ownership ledger and last-applied hash.
- Add the thin seed manifest required by certification: catalog/accounting/
  profile versions, expected assertions and golden-flow ID.

Exit: two registers in one tenant can use different certified modes; invalid
configuration blocks safely; transient resolution uses last-known-good;
offline replay detects contract mismatch; managed fields can be planned and
audited without overwriting tenant edits.

### Product 2 — Scan Retail complete slice (Now)

Execution status (2026-08-15): **drawer reconciliation gap closed,
incident-driven**. A production cashier recorded a 900 MXN change fund with
the only available tool — a cash movement — but both existing types
(Expense, Deposit) post cash OUT of the drawer, so closing showed negative
expected cash. New "Cash In" movement type (back-office → drawer, JE debits
the drawer) rides the deposit permission flag; closing reconciliation and
the shift overview now fold movements with sign
(`cash_movement.flow.drawer_delta`). Live-drilled on doco-mirror: JE
direction, journal-entry link, cancel reversal and closing math verified.

Update (2026-08-15): **named benchmark manifests established** — closes the
Foundation 0 performance-baseline leftover. [`benchmarks/`](benchmarks/README.md)
carries the three §6 profile manifests (§6 table rows mapped to live RUM/perf
telemetry event names with targets and hard ceilings), a baseline recorder
(lab/prod, dataset + app + bundle context, manifest-sha stamped) and a
regression gate (fails on p95 regression vs blessed baseline; ceilings report,
`--strict-ceilings` promotes). First prod observation recorded: warm launch
p95 3.4 s vs 1.5 s target, get_items round-trip p95 1.1 s vs 250 ms target,
INP healthy. Captures stay *observations* until reference hardware is pinned
(Marco) and shaping applied. Six instrumentation gaps are named in the README
(launch split, payment-screen mark, queue-acceptance latency, `__PROF__`-gated
marks, floor action, add-item p99). The telemetry summary API gained an
`events` filter so 7-day windows fit the row cap for low-traffic money paths.

Update (2026-08-15 eve): **dead-letter recovery closed on both halves** —
the frontend write_queue already surfaced every entity type (audit r2);
server-side, `ledger_sweep.py` now sweeps stuck non-final submission-ledger
rows daily (SUBMITTED = invoice live without its payment entries gets a
1-hour fuse) into a Prometheus gauge, one grouped Error Log and a
supervisor summary keyed for `repair_invoice_submission`; recovery stays
operator-triggered. The floor-action mark closed the last busy-service
instrumentation gap (`perf:pos:floor-action`). **Thin seed shipped**: boat
template `abarrotes-comercio` (retail_general vertical row +
`abarrotes-mostrador` Scan Retail preset), certification manifest
`abarrotes-comercio-thin` (boat `seed_manifests.py`) and the doco
assertion runner (`seed_verify.verify_thin_seed`: catalog/accounting/
profile census, honest failures with actionable details). The
certification job v1 exists (boat `certification.py` +
agent `/sites/{site}/seed-verify`, allowlisted runner): it runs the
manifest's assertion gates against a tenant, requires exact assertion-key
coverage, and ledgers every run as a `seed-manifest` artifact row.

Update (2026-08-15 night): **golden flow manually PROVEN end to end** on a
lab abarrotes tenant converged from bare (migrate, emc+abordo install, SAT
catalogs, fiscal defaults, dataset acceptance with clave/ITT self-heal,
template apply through the real job — the artifact ledger recorded it —
register creation, cashier assignment): browser drill ran open-shift →
mixed-rate basket with duplicate-scan quantity → exact cash tender →
submit → next basket. The drill caught a REAL contract gap — a 16% item
sold with zero tax rows because only the item-level 0%/exento half was
asserted — closed same-day as manifest v2 +
`accounting.sales_taxes_template_default`; the re-drilled sale carries
IVA 6.21 inclusive on a 127.00 gross and certification v2 passes 8/8.
Remaining for the P2 exit: encode that drill as the automated golden-flow
job (the manifest still says `manual`, honestly), baseline re-record on
~1 day of post-roll traffic, and the printer/scanner/drawer certification
bullet. Giro state promotion (seeded → workflow-ready for
abarrotes/comercio) is now evidenced but stays a human call.

Update (2026-08-17): **P2 waves are on production and the money paths are
proving themselves.** The 08-16 four-app roll (image v76 on both hosts by
08-17) carries the wave work; the first production ledger sweep repaired 16
stuck submission rows with zero money missing. The recarga exception path
closed its last silent states (saldo app, incident-driven): a TAECEL carrier
outage left held drafts that neither notified anyone nor could be abandoned —
the writeQueue submission-ledger row (dynamic link) made `delete_doc` throw,
so the POS «Abandonar» button had been broken since the ledger shipped.
Abandon now clears the ledger rows first; a janitor sweep auto-abandons
held drafts whose recargas ALL terminally failed once the last attempt ages
past `Saldo Settings.auto_abandon_failed_holds_minutes` (live on prod at 15,
first organic auto-abandon + cashier notification verified same day); and the
stuck-holds janitor's date-truncated cutoff (`as_string` formats DATE-only →
same-day stuck holds were invisible until midnight) is fixed. Scorecard rows
served: unreconciled-payment / dead-letter age and shift discrepancy.
**Post-roll baseline re-recorded** (capture `20260817-1355-ventas`, first
against manifest v2, observation class): `server_search` unchanged as THE
hot spot — p95 1184 ms vs 250 target, p99 1812 > 600 ceiling; every other
event below min-samples in the ~1.5-day window, and the six v2 marks read
zero samples because the carrying bundle only reached prod with the 08-17
roll (terminals may still hold the prior service-worker bundle). Re-record
on a full week of v76 traffic before drawing any second conclusion. The
one-shot re-record cron armed 08-15 died silently — recording is manual
until it is wired into a scheduled job.

Update (2026-08-17 night): **golden flow promoted script → job** (manifest
v4). The unattended runner `scripts/certification/golden_flow_job.py` runs
the spec headless as a dedicated `golden@` cashier (created for this — the
run surfaced and fixed two admin-only DOM assumptions plus a Pay-panel race
in the spec), writes a repo-versioned run record under
`docs/certification/golden-flow-runs/`, and ledgers every run on the boat
controller (`record_golden_flow_run`, new `golden-flow` artifact type).
`run_seed_certification` now composes by READING that ledger: a manifest
whose golden_flow says `automation: "job"` requires a fresh
(≤ `max_age_days` = 7) successful row — boat never needs a browser. Proven
end to end on lab: job PASS (37 s) → ledger row → certification `passed`
with `golden_flow_gate: fresh success` and 8/8 assertion coverage. A
systemd user timer on the lab host (`golden-flow.timer`, 05:45 daily) keeps
the evidence inside the freshness window. Honest P2 exit list now: (1)
printer/scanner/drawer certification on reference hardware [Marco]; (2) the
reference-hardware pin itself [Marco] — until pinned, every capture stays
an observation and `server_search` shaping cannot be declared pass/fail.

Update (2026-08-17, late): **reference hardware PINNED (Marco): Intel Core
i5-6500, 8 GB RAM** — benchmark manifests v3 carry the pin. Captures remain
observations until network shaping is also applied (`evidence_class`
requires both); the remaining perf work is the shaping harness on the
reference box plus the `server_search` shaping itself. P2 exit now waits on
exactly one human gate: the physical printer/scanner/drawer canary.

- Complete scan/search/cart/payment/print/next-sale task path.
- Cover the universal lifecycle: suspend/recall, discounts/promotions, tender,
  submit, receipt, return/refund and drawer/shift reconciliation.
- Define and enforce offline cash risk policy and exception ownership.
- Standardize pending/error/recovery language and supervisor approvals.
- Establish the named benchmark manifests, record baseline and gate regressions.
- Finish dead-letter recovery for every financial write queue.
- Certify printer/scanner/drawer/customer-display setup and health.
- Ship an abarrotes/comercio thin seed with accounting assertions and provision-
  from-zero browser flow.

Exit: Scan Retail golden flow meets latency, durability and eight-hour soak
budgets on reference hardware; seed, accounting, offline and rollback gates are
one reproducible certification job.

### Product 3 — Repair + Retail complete slice (Next)

- Harden Doco POS Charge Request into the v1 claimed, versioned, immutable and
  reconcilable integration rail with callback outbox.
- Certify the completed-Repair-Order → payment → ERP accounting → receipt/CFDI
  → delivered callback flow.
- Cover deposit, warranty/no-charge, already-invoiced, customer-supplied part,
  offline rejection and callback-failure exceptions.
- Ship and certify the celulares seed/current-tenant compatibility contract.

Exit: current phone-repair tenants can complete and recover the full cross-app
money flow with no manual orphan state; the integration rail is narrow enough
for a second producer without POS importing it.

### Product 4 — Restaurant contracted beta

- Resolve dirty/empty/multiple-account floor behavior and test shell navigation.
- Complete kitchen durability, table ownership, multi-account selection,
  split/merge, course, proforma, tip, settlement and cleaning paths.
- Define single-device offline lease; do not claim cross-device offline service.
- Certify counter and table presets separately with current starter seed.
- Keep limitations/support owner visible while status is contracted beta.

Exit: restaurant moves from contracted beta to certified GA only after golden,
exception, accounting, kitchen, offline-policy and shift-boundary gates pass.

### Platform 5 — Generalize after three slices

- Extract deterministic seed builders and versioned mode artifacts from the
  three proven slices rather than designing a universal factory first.
- Add supported-doctype plan/dry-run/apply/audit and compatibility preflight.
- Expose certification status to signup and sales surfaces.
- Roll out by tenant cohort with health gates and kill switches.
- Provide fleet diagnostics and redacted support bundles.
- Build a limited owner configuration form only for overrides proven necessary;
  defer the broad studio until usage evidence exists.

Exit: supported artifact upgrades are canaried, measured, halted and reversed
within their documented merge semantics without manual database surgery.

### Later — evidence-gated modes and scale

- Quick Service, Controlled Retail and Service Counter enter discovery one at a
  time only with committed customer evidence, an owner and a defined cut line.
- Complete remaining giro bundles by demand; mapped is never called certified.
- Default safe asynchronous durable submit where measured beneficial.
- Isolate noisy tenants and scale read-heavy catalog/report paths.
- Formalize extension SDK/contracts and compatibility tests.
- Add branch/multi-register management and cross-register operations.
- Continuously optimize from product telemetry and merchant research.

Entry gate for each later mode: paid discovery or contracted demand, named
product owner, smallest complete golden/exception lifecycle, seed/accounting
contract, effort estimate, dependencies and a kill criterion.

---

## 15. Program scorecard

The roadmap is governed by outcomes, not feature count:

- golden-flow completion without help;
- p95/p99 interaction and durable-write latency;
- duplicate/lost/mispriced sale count (target zero);
- unreconciled payment and dead-letter age;
- crash-free shifts and eight-hour memory stability;
- setup readiness and first-sale time;
- support contacts per 1,000 transactions;
- shift discrepancy rate;
- configuration drift and failed upgrade rate;
- rollback time and canary regression detection;
- certified/marketed giro coverage;
- accessibility and hardware certification coverage.

Any roadmap item that cannot name the score it improves is challenged before
implementation.

---

## 16. Independent audit disposition

The v1 audit rated vision 8/10, complete POS definition 6/10, measurable speed
5/10, bounded configurability 5/10 and small-team deliverability 3/10. V2
accepts and resolves its five P0 conclusions:

1. retail fallback is replaced by explicit configuration failure states;
2. additive artifact ownership and thin seed manifests move into Foundation 1;
3. certification now delivers seed + accounting + browser flow together;
4. offline intent and money/value risk classes are distinct;
5. committed delivery is cut to Scan Retail + Repair Retail, with restaurant as
   a gated contracted beta and all other modes evidence-gated Later work.

V2 also adds the universal transaction lifecycle, Mexican fiscal boundary,
named benchmark profiles, hardened Charge Request requirements, repository
ownership, operational/DR acceptance and explicit GA/beta states. The roadmap
must be re-audited whenever a Later mode enters committed delivery or the
configuration/rollout model expands beyond its bounded v1 contract.

---

## 17. Owner direction 2026-08-17 — giro breadth, POS parity, shortcuts engine, SaaS brand

Marco's stated direction, mapped onto the existing architecture so it lands
as seeds, slices and substrate — NOT as new register modes (the audit's
small-team constraint stands; nothing here triggers a re-audit by itself).

### 17.1 Giro breadth maps to the existing mode substrate

Named demand: ferreterías, jugueterías, librerías, muebles, belleza, ropa y
zapatos, abarrotes, cafetería, panadería, electrónica, clínicas dentales,
clínicas médicas, restaurantes, tienda china. Every one resolves to a mode
that already exists in §4 — the list changes certification ORDER pressure
and seed-factory throughput, never the mode count:

| Mode (§4) | Giros from the list |
|---|---|
| Scan Retail | abarrotes, tienda china, ferretería, juguetería, librería, panadería (mostrador) |
| Controlled Retail | ropa y zapatos (variantes), electrónica (series/IMEI), belleza, muebles (big-ticket → cotización/entrega) |
| Quick Service | cafetería, panadería (consumo) |
| Table Service | restaurantes |
| Service Counter | clínica dental, clínica médica (privacy seam) |
| Repair + Retail | celulares (flagship, unchanged) |

Giro = seed bundle + preset on a certified mode (§8). The scaling asset is
the seed FACTORY (Platform 5 extracts it from three proven slices), not
per-giro code. `mapped` is still never called `certified`.

### 17.2 POS-parity feature backlog (the "cosas por añadir")

Classified by which slice owns them; each item names its scorecard row
before implementation, per §15.

**Universal lifecycle affordances (Product 2 scope, giro-agnostic):**
touch-first cart row actions — clearer DISCOUNT button, REMOVE button,
QUANTITY button; drawer-kick button (QZ rail exists, needs the visible
control + permission flag); price-list switch and price override
(permission-gated, provenance-logged); full customer create (all fields,
not just name/phone); quick-item FULL create (name, description, buy/sell
price, margin, qty, IVA, barcode — the tienda-china/abarrotes onboarding
path); price checker (checador de precios — read-only lookup surface,
kiosk-able later).

Status (2026-08-18): **price checker SHIPPED LAB** — the first parity
affordance, chosen first because it was wholly missing (the others largely
exist: cart rows already carry quantity/remove/rate controls) and because it
is READ-ONLY, so it earns its keep with no money-path risk.
`PriceCheckDialog.vue` owns its own search field, calls only lookup
endpoints (`get_items`, `get_items_from_barcode` — zero new server surface),
and has no path to the cart at all; that negative property is source-scanned
by a test rather than mounted, because the guarantee is "no such code path
exists". Bound to the new `items.priceCheck` action on Alt+C — the first
feature to ride the shortcuts engine, which is what the substrate was for.
Behavior worth naming: a text miss on a ≥6-char token retries as a barcode
(a scan that misses is the likeliest reason anyone is here); responses carry
a sequence so a slow earlier query cannot overwrite a newer answer; opening
clears the previous lookup so one customer's price is never quoted to the
next; and the footer names the price list that answered, because with a
price-list switch coming a bare number is a promise the till may not honour.
Verified live on lab: Alt+C → "Tortilla de maíz (kg) · Kilogramo · Stock 80
· MX$25.00" from Standard Selling, **cart still empty afterwards**.
Update (2026-08-18, later): **cluster closed except the hardware one.**
Reality check first, which saved two rebuilds: cart rows already carried
quantity/remove/rate controls, the price-list switch already exists
(`ItemActionToolbar` + `ItemSettingsDialog`, gated by
`posa_enable_price_list_dropdown`), per-line price override already exists,
and full customer create already covers address + the CFDI fiscal block
(tax_id, régimen, uso, CP). None were rebuilt.

Built instead, both money-facing and therefore both with their arithmetic
in separately unit-tested pure modules rather than inside a dialog:

- **Quick item** (`itemPricing.ts` + rebuilt `NewItemDialog.vue`): purchase
  price, selling price, margin, opening quantity, description and IVA in one
  pass. Margin is bidirectional and labelled markup-over-cost — the Mexican
  counter meaning — with profit in currency beside it; the field being typed
  is never recomputed, because a typed 22 visibly jumps to 22.01 once the
  price rounds to a cent (the round-trip test says so out loud). Opening
  stock pins the register's warehouse in `item_defaults` and refuses, in a
  sentence, the two cases ERPNext throws on from inside its Item controller.
  Item code derives from the name until touched.
- **Discount** (`discountIntent.ts` + `DiscountDialog.vue`): a clear button
  opening percent/amount modes, four presets and the resulting total shown
  BEFORE committing. It owns no pricing — it hands the shell the operator's
  intent through the same emits the inline field uses, so the surfaces
  cannot drift. Refuses negative, >100% and larger-than-the-sale; allows
  exactly 100%, which is a real decision. Permission- and offer-lock aware.

Still open, deliberately: the **drawer-kick button**. There is no QZ
raw-command path in the frontend at all today (the drawer opens as a side
effect of printing), so it needs a real design plus verification on the
physical canary — the same gate P2 already waits on. Building it blind
would ship hardware code nobody can prove.

**Front page (2026-08-18):** muelle.mx now leads with the POS
(`muelle-site` `2c0e257`) — hero headline plus a six-card "Muelle POS"
section under it. ⚠ The site must not be published before the posawesome
prod roll: four cards describe lab-only work, and the hero product shot
still shows the pre-brand navbar and wants retaking on the same roll.

**Weight/fraction selling (new capability, Scan Retail seam):** venta
fraccionada por importe (amount → qty = importe/rate) and por peso; báscula
button (scale read). `posa_scale_barcode_start` is dead-on-arrival and
slated for removal — the scale integration needs a real design (QZ/serial
bridge vs weight-embedded barcodes), and sell-by-amount must round in the
CUSTOMER's favor deterministically. Gates abarrotes/carnicería/ferretería
granel.

**Documents (Product 2/3 seam):** cotizaciones — ERPNext Quotation exists;
the POS needs create/recall/convert-to-sale (muebles/ferretería depend on
it); notas de crédito — the return/credit rail exists (saldo refunds mint
credit notes today); needs a first-class POS surface: partial credit,
apply-to-later-sale, print format.

### 17.3 Shortcuts engine — substrate, build once

Actions become a first-class REGISTRY (stable action IDs decoupled from key
bindings); a keymap is a versioned §9.1 artifact bound per capability
preset, override-allowlisted per tenant, with a user layer on top.
Discoverability ships with it (cheat-sheet overlay, conflict detection).
"Big POS defaults": keymap PACKS that emulate incumbent Mexican POS
layouts so a migrating cashier's fingers still work — friction at the till
is the real switching cost. HONESTY RULE: a pack is authored only from
evidence (a real migrating operator or the incumbent's documented
defaults), never invented from memory; ship `muelle-default` first and add
packs as migrations actually happen. This is Foundation-flavored substrate:
it must exist BEFORE the giro wave, because presets carry keymaps.

Status (2026-08-18): **ENGINE SHIPPED LAB.** `posapp/shortcuts/` is the
substrate: `actions.ts` (28 stable action ids + category/label/hint for the
cheat sheet), `keymap.ts` (versioned packs; `muelle-default` v1 carries the
bindings POSAwesome already shipped, verbatim), `engine.ts` (chord parse →
event match → resolution with conflict detection, override layer and
cheat-sheet projection), `index.ts` (memoized active keymap +
`configureShortcuts`, the seam the capability payload plugs into).
`invoiceShortcuts.ts` kept every effect and lost every key: its 24-branch
if-chain is now a dispatch table keyed by action id.
Discoverability shipped with it: `ShortcutsCheatSheet.vue` (Alt+H, bus-driven
so the shell god-file gains no state) prints the live keymap grouped by
category and names the pack revision, so "my keys are wrong" is a reportable
fact. Inherited quirks (Alt+Shift fires Alt bindings; F-keys ignore
modifiers) are preserved deliberately and are now DATA with tests naming
them, so fixing them later is a keymap decision instead of archaeology.
Parity is pinned by a table of all 28 legacy chords in
`tests/shortcutsEngine.spec.ts` (53 new tests; 1655 total green; verified in
a real browser on lab: Alt+H renders the sheet, Alt+3 still lands on the
item search input; golden flow green after the refactor).
Update (2026-08-18): **rung closed — server plumbing shipped.** POS
Capability Profile gains `keymap_id` (validated against `VALID_KEYMAPS`, so
an unknown pack fails at a manager's desk rather than on a cashier's
keyboard); the resolved payload carries a `shortcuts` group; the register
override lands as allowlist entry `shortcuts.keymap_id` → POS Profile
`posa_ux_keymap_id` with a new `replace` merge rule (a keymap is a choice,
not a power, so unlike the bool flags a register REPLACES rather than
enables). `kind: "data"` normalizes ""/whitespace to None so an untouched
field can never blank the mode's pack — pinned by its own test after the
live drill proved the failure mode. `posa_ux_` is a new fixture prefix for
cross-vertical operator-experience fields (the CI coverage check demands
one; shortcuts belong to every giro, not to a vertical). uiStore watches
the capability payload with `flush: "sync"` — the keyboard must not answer
to the previous register for even one microtask. Payload version NOT
bumped: a keymap cannot change how a queued offline sale replays.
Verified: 1662 frontend + 31 server tests green, live drill on the mirror
(preset pack reaches the payload, register override replaces it, blank and
whitespace do not strip it), golden flow green.
Still open for a future rung: the first incumbent pack, blocked on EVIDENCE
from a real migration, and a per-action override map (the allowlist carries
the pack id today, not individual rebindings).

### 17.4 SaaS brand: Muelle POS as a layer, not a rename

The app stays `posawesome` (fork hygiene — UPSTREAM.md merge discipline
survives). Branding becomes a thin layer: display name "Muelle POS", logo,
PWA manifest, page title, login copy and receipt footer resolve from brand
tokens; `/pos` route alias beside `/posapp`. Per-tenant brand override is a
LATER §9.1 artifact once the token layer exists. Service-worker/PWA icon
caching is the known trap (see SW-cache memory) — brand assets must be
versioned like any other precached asset. Test selectors and DOM stay
stable so the suites don't care what the brand says.

Status (2026-08-17 late): **SHIPPED LAB.** `frontend/src/brand.ts` is the
single token source; navbar wordmark, titles, PWA manifest, failure/loading/
offline copy and the `/pos` → `/posapp` alias are live on the mirror;
`tests/brandConsistency.spec.ts` pins frontend + www together and proves
no leak into internal identity (PWA id/start_url, storage keys, telemetry).
1603 frontend tests + golden flow green on the branded bundle. Remaining:
the logo ART stays the posawesome mark until Marco supplies/blesses Muelle
art (icon swap = versioned-asset + SW precache slice), and prod ships with
the next posawesome-push-prod (gated).

### 17.5 Sequencing opinion (recorded, Marco decides)

1. Brand layer — small, independent, sell-readiness benefits now.
2. Shortcuts engine substrate — before the giro wave, presets ride it.
3. Parity affordances — inside Product 2/3 slices they already belong to.
4. Weight/fraction + cotizaciones/NC — the two real capability builds.
5. Giro seed factory throughput — Platform 5, after three proven slices,
   then the fourteen-giro list is seed work, not code work.

### 17.6 Odoo POS parity audit and the real gap list

Trigger (2026-08-22): a marketing post (`muchconsulting.com/blog/odoo-2/
odoo-pos-69`) read as if Odoo POS was far ahead. It is not a feature spec —
about twenty bullets, no Odoo version named, no depth. Audited every claim
against this repo before letting it touch the plan.

**Result: 12 of the 13 things that post names are already shipped here.**
The gap it exposed is marketing, not product. Building a roadmap from that
post would have funded a rebuild of kitchen displays and table management
we already have, while the genuine gaps go unmentioned in it.

Claim-by-claim, with repo evidence:

| Post claims | State | Evidence |
|---|---|---|
| Online + offline, syncs on reconnect | shipped | offline queue, `pos_invoice_submission_ledger` |
| Multi-device | shipped | PWA, `service-worker.ts` |
| Customisable interface | shipped | `pos_capability_profile` |
| Cash / card / digital payments | shipped | `Payments.vue`, `mpesa_*` |
| Loyalty + customer tracking | shipped | `wallet/`, `pos_coupon`, `referral_code` |
| Integrated inventory + accounting | shipped | ERPNext substrate |
| Multi-store / franchise | partial | ERPNext multi-company yes; no register-level store switcher |
| Barcode scanning | shipped | + `scale_barcode_settings` |
| Promotions and discounts | shipped | `pos_offer`, `pos_offer_detail` |
| Real-time stock sync | shipped | |
| Kitchen display, order priority | shipped | `pos_kitchen_station`, `..._item_group` |
| Table + delivery service | shipped | `pos_floor`, `pos_table`, `pos_table_order`, `FloorEditor.vue`, `delivery_charges` |
| Tickets / memberships | absent | §4.5 deposits/packages/memberships remain unbuilt |

Ours-and-not-theirs (do not lose these in any parity framing): CFDI 4.0
timbrado inline, bolsa de saldo, recargas y tiempo aire, taller/repair-order
integration, QZ Tray printing, offline folio reservation.

#### Verified gaps, by priority

Priority is by docomexico/mumulenceria revenue, not by Odoo's feature count.
Each entry names the score it improves (§15) or it does not get built.

- **P1 — Combos / bundles.** `combo` appears twice in this document (§4.3
  Quick Service, §5.6 price lifecycle "later" column) and three incidental
  times in code. It is currently scoped as a Quick Service concern; that is
  wrong. Scan Retail and Repair+Retail both sell case+mica+instalación every
  day, and the manual version already exists as the "se suele llevar junto"
  strip. Needs: bundle doctype with component lines, price override with
  displayed saving, availability = min(components), stock decrement per
  component, and return/partial-return semantics. Score: ticket average,
  and it is the cheapest real revenue item on this list.
- **P1 — Self-order / QR menu / kiosk.** Zero hits for `kiosk`, `self order`,
  `qr menu` in frontend or app. Odoo 17+ headline feature. Genuinely absent —
  but it is a Quick Service capability, and Quick Service is evidence-gated
  under §14 "Later". Do not start it until a cafetería is contracted. Score:
  certified giro coverage.
- **P2 — Split bill.** Four incidental hits; table orders exist, per-diner
  splitting does not. Already named inside Product 4 restaurant beta
  ("split/merge"). Keep it there; do not promote.
- **P2 — Loyalty points program.** `wallet/` gives stored value (monedero);
  there are no earning rules, tiers or expiry. Coupons and gift cards exist
  as separate doctypes. Needs a rules layer, not a new store. Score: repeat
  purchase rate.
- **P2 — Register-level store switcher.** Zero hits for `multi-store`. ERPNext
  handles multi-company; the register cannot move between sucursales without
  re-login. Bites any tenant with three branches. Overlaps the §14 "Later"
  line "branch/multi-register management".
- **P3 — Ship later / scheduled delivery.** Zero hits. `delivery_charges`
  exists; scheduling does not. Low value for repair+retail.
- **P3 — Memberships / subscriptions / packages.** §4.5 Service Counter
  already lists "deposits, packages, memberships and outstanding balances"
  as unbuilt. Confirmed absent. Leave with Service Counter's evidence gate.

#### Disposition

Only **combos** moves. It is promoted out of §4.3 Quick Service into the
Scan Retail (Product 2) and Repair+Retail (Product 3) slices, because those
are the two certified paths and both sell bundles today. Everything else on
this list is either already scheduled inside an existing wave or is
correctly parked behind the §14 entry gate — none of it is promoted on the
strength of a blog post.

Status (2026-08-22): **DESIGN ONLY.** Combos are drawn into the register
mockups (`muelle-site/design/register-hifi`, direction E): a combo cart line
carrying a `COMBO · n` badge, the component list and the saving; a Combos
category in the catalogue drawer filtered by the customer's device; and a
combo up-sell in the "se suele llevar junto" strip. Nothing is implemented.
Availability shown as min(components) is the design's claim and needs a
back-end decision before build.

The marketing finding stands on its own and belongs to the SaaS side, not
here: our feature surface beats the post we were worried about, and our
description of it does not. That is a §17.4-adjacent brand/collateral task.

Addendum (2026-08-22, same day): the register mockups promote **Orden de
servicio from dialog to rail destination**, with a pending-count badge on the
rail item the way Salón already carries one. Desktop needs no contract change —
it is a shell route beside Venta. Mobile does: `DOCK_TAB_IDS`
(`vertical/viewContracts.ts`) and `VALID_DOCK_TABS`
(`pos_capability_profile.py`) currently hold the same six ids in the same order
and a parity test asserts both. Adding `orden` is a three-link change in one
commit — frontend tuple, backend tuple, and a `DockTabDef` in
`buildDockTabDefs` (the file's own comment: a backend-allowed id absent from
the frontend tuple renders a blank tab, and a missing def fails `vue-tsc`).
The repair preset would spend `floor`, which it never uses, on `orden`. Badge
source would be a new count alongside `floorOpenOrdersCount`.

### 17.7 The register reference canvas

`muelle-site/design/register-hifi` is now the visual reference for this
document — direction E (rail + drawer), sixteen artboards on five pages:
Turno, Venta, Modos, Móvil, Descartada. It is DESIGN, not committed scope;
each mode still answers to its own §14 gate.

Coverage against §5.6's lifecycle: every stage has a screen. **Reverse** was
the only stage with none — `Devolución` was a rail item that dead-ended — and
now carries return by ticket/item/customer/serial/no-receipt-with-signature,
original tender attribution, exchange as linked return + sale, and the
supervisor exception inbox §5.4 asks for. **Start** gained §5.1: the readiness
check is verified, not collected, and the rail renders disabled until the
shift opens, because until then the register genuinely cannot do anything.

Coverage against §4: all four certified modes are drawn — 4.2 Controlled
(weight + tare + price-embedded barcode, lot/expiry with FEFO, exento beside
gravado on one ticket, merma with reason), 4.3 Quick Service, 4.4 Table
Service, 4.6 Repair + Retail. 4.2 also renders the rule that "the giro chooses
which identity controls are required": serial, IMEI, size and colour are
absent from a carnicería, stated on screen.

Two invariants hold across all sixteen and are the thing to preserve if
anyone edits them:

1. **One number, one action.** The bottom band always carries the single
   number that matters at that moment and the single primary action — total,
   change, difference, balance due, amount to refund, amount to recharge,
   opening float, amount queued. Same 60 px, same lane, tint by state.
2. **One accent.** Exactly one saturated colour per screen, on the primary
   button. Amber and green are state, never emphasis. Density was raised
   twice without breaking this; it is the property that makes the density
   safe.

Money reconciles across artboards on purpose: the $149 return of ticket
B-04788 is the same line in the corte's movements, and the corte's closing
$5,366 is the "ayer cerró con" on the opening screen. If a future edit breaks
one of those, the reference is lying about being one register.
