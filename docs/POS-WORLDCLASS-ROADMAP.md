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
8. remaining giros by demand, reusing the certified mode substrate.

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
profile census, honest failures with actionable details). Remaining for
the P2 exit: golden-flow + provision-from-zero automation (manifest marks
both `manual`), baseline re-record on ~1 day of post-roll traffic, and the
printer/scanner/drawer certification bullet.

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
