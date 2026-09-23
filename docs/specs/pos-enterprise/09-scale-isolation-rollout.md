# 09 — Enterprise capacity, isolation, recovery and rollout

Status: proposed engineering qualification contract; no tier below is currently
claimed certified by this specification. Version 1, 2026-09-22.
Owners: POSAwesome transaction/UX contracts; Doco integration contracts; Boat
tenant placement/releases; Muelle runtime/recovery; Vigía observation.
Applies to [01–08](README.md). This is required delivery work, not optional
post-launch optimization.

## 1. Capacity promise and admission

“Supports large tenants” means passing a recorded workload at a named topology,
with correct money, bounded latency, fair resource use and proven recovery.
Record capacity as `Specified`, `LabQualified`, `PilotQualified` or
`ProductionQualified`, separately for each tier/capability. A feature flag or
green unit suite does not qualify a tier.

The following are design targets for qualification, not measurements or current
commercial entitlements. Limits are configurable admission policy, not hardcoded
counts in UI/data models.

| Dimension | Local | Chain | Enterprise target |
| --- | ---: | ---: | ---: |
| Stores per tenant | 1 | 100 | 1,000 |
| Registered cajas | 5 | 2,000 | 20,000 |
| Concurrent selling devices | 5 | 1,000 | 5,000 |
| Additional order-only/manager devices | 5 | 500 | 5,000 |
| Tenant catalog items / customers | 10k / 10k | 200k / 1m | 1m / 10m |
| Historical posted documents | 100k | 10m | 100m |
| Sustained successful sale completions per second | 1 | 50 | 250 |
| Ten-minute burst sale completions per second | 2 | 100 | 500 |
| Concurrent registers at one busy store | 5 | 50 | 100 |
| Unresolved operational cases | 100 | 50k | 1m |

Also qualify one safe serving 100 drawers: 10 mixed preparation/receipt/drop
commands per second for five minutes, with realistic distinct bags and deliberate
same-bag contention. This is an exceptional shift-boundary stress test. Ordinary
sales must remain isolated from safe lock contention.

The platform test includes one enterprise workload alongside at least 99 Local
tenants on the documented shared/dedicated topology. Placement isolation may be
required to pass. Sales per second counts completed canonical transactions,
including inventory/accounting work, not HTTP requests, accepted jobs or mocked
payments. A separate provider-simulator lane isolates internal capacity; real
provider/hardware latency is measured independently.

Before admitting a tenant, compare its store/device counts, peak scans/sales,
SKU/serial/batch model, inventory hotspots, history/retention, reporting patterns,
offline policy and integrations against the qualified envelope. If outside,
benchmark the requested shape first or state the supported limit. No silent
throttling of an already-collected payment is an acceptable admission policy.

## 2. Deployment and tenancy boundary

Keep Frappe's site/database isolation model and the current application stack
for the initial implementation. Tenant identity derives from trusted routing and
authenticated site context. Every job, cache key, object-store path, stream,
export and support action carries an unambiguous site identity.

Company/store/register permissions exist inside that site; database-per-tenant
does not itself enforce store isolation. Conversely, adding `store_id` does not
replace tenant isolation. Cross-tenant analytics use an explicitly authorized
aggregation service/export and cannot query arbitrary tenant DBs from POS APIs.

Large tenants can move to dedicated cell resources while keeping site identity,
canonical URLs and record IDs. Boat owns placement and planned relocation;
Muelle owns execution. A selling register has no synchronous dependency on Boat,
Vigía or regional analytics. One tenant has one authoritative write location.
Read replicas may serve lag-tolerant reports with declared watermarks; money,
permissions, ownership and close prerequisites read the authority.

Do not split a tenant's stores into separate Frappe sites and call the result
transparent scaling: shared catalog, customer credit, stock, accounting, safe
scope and idempotency would become distributed contracts. If the single-writer
enterprise tier fails, first isolate and optimize measured bottlenecks; any
sharding/multi-writer design requires a new ADR and full financial proof before
that tier is sold. Dedicated hardware is not proof that the database scales.

## 3. Data/query and hot-path contracts

- Stable opaque IDs; store-scoped unique human codes; normalized memberships
  and relationships. Do not put 20,000 registers in one child-table document.
- All lists/searches use bounded keyset pagination and permission-aware query
  predicates. Default 50/max 100 rows; exports are resumable jobs. Counts may be
  explicitly approximate for navigation but never for cash reconciliation.
- Request query counts must be measured; a page of 100 registers cannot execute
  100 profile/user/shift queries. Target at most 12 DB round trips for an ordinary
  list/detail response, excluding separately declared canonical financial work.
- Composite indexes match tenant-local store/state/date/ID access paths;
  inspect query plans at full target history. Native constraints protect
  uniqueness; application checks alone do not settle concurrency.
- Catalog and customer search query the eligible store subset; no phone downloads
  a million-item catalog or ten million customers. Offline cache is a bounded
  certified assortment with a visible scope/version, never an implied full copy.
- Incremental read models use transactional outbox events and source checkpoints.
  Rebuilds are bounded, checkpointed and low priority. Command results can read
  canonical records before a projection catches up.
- Do not hold a store/company/global lock for ordinary sales. Serialization is
  per register, source obligation, relevant stock/accounting resource or safe.
  Common high-volume SKU/warehouse/account locks must be measured through actual
  ERPNext posting; splitting a database table does not remove business contention.
- Account-per-drawer routing from 01 is the initial supported cash model. Its
  chart-of-accounts, GL lookup and reporting cost at 20,000 drawers is a specific
  enterprise qualification gate. A consolidated cash subledger is not introduced
  silently as a performance shortcut; it needs its own reconciliation/migration ADR.

Archive large histories through a documented source-preserving policy and
indexed online summaries. Evidence/receipt lookup must survive archival. Avoid
schema partitioning or changing primary keys before measuring their effect on
Frappe/ERPNext queries, migrations and restores.

## 4. Resource fairness and backpressure

Separate interactive sales/receipt resolution, provider reconciliation,
operational projections, exports/reporting, bulk configuration and maintenance
workloads into independently budgeted execution lanes. Existing queues may be
extended, but the scheduler must enforce tenant and workload fairness rather
than relying on FIFO alone.

Apply site/user/device/endpoint-class limits with configurable burst allowances.
Responses include Retry-After where safe. Idempotent retries reuse receipts and
must not multiply queued work. A tenant cannot consume every DB connection or
worker by opening dashboards or requesting exports. Interactive closure can be
prioritized while still allowing already-admitted payments to settle.

Admission occurs before promising an external action. If capacity is exhausted,
reject an unaccepted intent with a clear retryable response. Once durably
accepted, retain and resolve it; never drop it because a queue TTL expired.
The UI distinguishes not accepted, accepted/pending, completed and unknown.

Bulk import/configuration validates rows, previews scope and changes, records a
job receipt, processes bounded batches and reports per-row outcomes. Repeating a
job cannot create duplicate stores/registers. Pause/cancel applies only between
committed units; it does not undo prior financial actions. Configuration fan-out
is staged by store/cohort and activates at declared shift boundaries.

## 5. Performance and availability targets

Preserve existing transaction/UI budgets in the
[world-class roadmap](../../POS-WORLDCLASS-ROADMAP.md); do not replace a stricter
existing gate with a looser enterprise target. Additional targets:

| Measurement | Qualification target |
| --- | --- |
| Cajas/case list authoritative API | p95 ≤ 400 ms, p99 ≤ 1 s at tier workload |
| Normal DB-local ownership/cash command | p95 ≤ 800 ms, p99 ≤ 2 s excluding human/provider time |
| Source-to-store projection lag | p95 ≤ 2 s, p99 ≤ 5 s; visible stale state after 30 s |
| Regional rollup lag | p95 ≤ 30 s, explicit as-of always |
| Commit receipt lookup after lost response | p95 ≤ 500 ms, p99 ≤ 1 s |
| Operational case observation after source event | p95 ≤ 5 s, p99 ≤ 15 s |
| 100-register close preparation | ≤ 60 s to complete a source snapshot, or explicit unresolved-source result |
| Local scan/cart paint | Existing ≤ 50 ms p95 / 100 ms p99 budget at named low-end device |
| Financial command service availability | Target 99.95% per 30-day window after production qualification |
| Projection/report service availability | Target 99.9% separately; outage must not stop sale posting |

Count timeouts, overload rejections and internal errors against service success;
exclude deliberate authorization/validation refusals but report them separately.
Measure provider failures separately without making customer-visible failures
disappear from the end-to-end report. Planned maintenance is reported explicitly,
not removed to manufacture an SLO. Approximately 21.6 minutes is the 99.95%
error budget in a 30-day month; repeated consumption blocks optional rollout.

No silent loss/duplicate/cross-tenant financial mutation is an allowable error
budget. A detected integrity incident halts the affected rollout/path and starts
reconciliation even if availability remains green. p99 applies across the
recorded workload, with per-tenant/store skew also reported.

## 6. Benchmark and certification protocol

Every run records source SHA, schema/fixture versions, seed and dataset hash,
row counts, query plans, CPU/RAM/storage/database settings, cell placement,
browser/OS/device versions, network shaping, cache state, worker counts,
provider simulator behavior and load-generator version. Synthetic credentials
and data cannot hit real payment, messaging or top-up accounts.

Required workload lanes:

1. **Local employee journey:** Android 4 GB, Windows 8 GB, tablet and supported
   mobile browsers; 100 ms RTT/10 Mbps plus cold/warm cache; touch/keyboard/scanner.
2. **Steady tier load:** 30-minute warm-up then two measured hours at sustained
   tier throughput, realistic item/payment mix, returns, collections and stock.
3. **Burst/reconnect:** ten-minute 2× sale burst, simultaneous store opening,
   heartbeat reconnect storm and offline queue drain while online sales continue.
4. **Contended resources:** same SKU/warehouse, same bag, same ticket, same
   register, shared safe and limited payment terminal; verify correct losers.
5. **Eight-hour soak:** sales/navigation/printing plus periodic close/handover;
   memory, DOM, listeners, DB connections and queue depth remain bounded.
6. **History/reporting:** full target historical cardinality, export and regional
   dashboards concurrent with sales; inspect plans and collateral latency.
7. **Failure injection:** worker killed before/after commit, response lost after
   commit, duplicate/out-of-order callbacks, Redis/realtime outage, provider
   timeout, storage full, old client, revoked device and restore fence.

Mix includes cash, card simulation, partial payment, return, credit collection,
discount approval, serialized/batched stock where enabled and cashless orders.
Money acceptance compares expected invoices, payments, GL, stock, receipt keys,
bag locations, transfer clearing and source settlement. Run native independent
database transactions; mock-only race tests are insufficient.

Publish p50/p95/p99, successful completions, rejects/errors, queues, lock waits,
deadlocks/retries, DB/CPU/I/O, memory growth and reconciliation totals. First
record a baseline; passing requires both absolute gates and no unexplained
regression over 10% on established hot paths. Memory after the final 500-cycle
steady-state window must not grow monotonically; investigate retained objects
rather than passing on a single heap reading.

## 7. Security and enterprise administration

Capabilities are explicit; store/region assignments are versioned, bounded and
audited. Bulk grants require preview and separation of grantor/reviewer where
tenant policy requires it. A profile shared across stores never grants those
stores automatically. Permission changes invalidate caches/subscriptions/exports
and are checked again at command execution.

Identity-provider/SSO and user provisioning integrations, when enabled, feed the
canonical User/assignment system. Deprovisioning disables new authority and
creates an accountable handover/recovery task for open shifts. It does not
silently close them. SSO outage behavior and offline authorization age follow a
versioned policy; no indefinite cached login is implied.

Support access is time-limited, tenant-authorized, scoped and audited with a
visible support indicator. Financial approvals retain an actual tenant actor;
support cannot impersonate one invisibly. Break-glass administrative recovery
requires reason, independent review and retained evidence. Device/user secrets
never enter business events or support exports.

Offline authorization cannot observe immediate remote revocation. Certification
therefore specifies maximum offline duration, amount/exposure limits, allowed
actions and reconciliation owner. Initial migration preserves existing permitted
offline behavior; enterprise offline cash requires its own demonstrated policy.
Server reconnect always rechecks current grants and generations; denied intents
remain visible for supervised recovery.

Audit events record site recovery epoch, source/aggregate revision, original
actor, acting/approving identities, command receipt, reason, server time and
before/after references. Normal application roles cannot update/delete them;
the supported write path is append-only. Privileged database administrators
remain outside that application-level guarantee. Enterprise qualification
therefore includes periodically exported, access-separated integrity manifests
for audit/receipt ranges, tested detection of mutation/missing ranges and a
reviewed administrator-access log. Do not market application hooks alone as
cryptographic tamper-proof storage.

Tenant placement declares allowed regions for primary data, replicas, backups,
support processing and exports. Relocation checks that policy before copying
data. At-rest/transport encryption and key custody follow the platform's tested
configuration; restore drills include the required keys. This specification
does not itself confer a compliance certification.

## 8. Backup, restore and disaster recovery

Qualification targets: tenant DB/files/configuration RPO ≤ 5 minutes; RTO ≤ 4
hours for Local/Chain and ≤ 8 hours for Enterprise at the full target dataset.
These are proposed recovery objectives, not existing contractual guarantees.
Measure from fault declaration through verified employee operation, not merely
database restore completion. Faster paid objectives require their own topology
and drill. Zero-RPO regional failover is not promised.

Maintain encrypted backups, required site encryption keys and tested point-in-
time recovery to an isolated target. Restore only with the matching app/schema
and source compatibility record; verify complete DocType inventory, financial
constraints, source documents, files, outbox/receipt integrity and permissions.

Before restoring production authority, change a **site recovery epoch** stored
outside the restored database and registered into the recovered site. Every
device/shift/command capability includes this epoch. It is a cached immutable
validation value, not a lock acquired on each sale. Old/future-generation clients
are fenced until reconciled, even if restored DB IDs look valid.

A DB rewind may also lose idempotency receipts for already completed external
payments. Never replay such captures merely because the restored ledger lacks
them. Reconcile provider records and protected request/audit evidence over the
recovery interval before allowing affected attempts to retry. Retain provider
idempotency keys and external capture IDs for the required evidence lifetime;
an expired provider key is not proof that recapture is safe.

Local-only unsynced browser work has no server backup. Its durability depends
on the original device/storage and any explicitly implemented protected export.
Device loss may make it unrecoverable; disclose this in the offline policy and
record loss/reconciliation evidence. Do not claim server RPO covers those intents.

Outbox events and projection checkpoints restore with canonical data and can
be replayed idempotently. Regional projections must accept an epoch reset and
rebuild, not combine pre-restore future totals with recovered past state.
Control-plane relocation includes writer fencing, queue drain/receipt recovery,
traffic cutover, epoch verification and rollback evidence.

## 9. Retention and observability

Financial histories, receipts, approval evidence, close snapshots and source
links follow the tenant's validated accounting/fiscal retention and legal hold.
This specification does not invent a statutory duration. No purge deletes
unresolved work, active reservations or the identities needed to refuse replay.
If compacting receipts, retain a durable dedupe tombstone plus safe source
references; age alone cannot turn an old request into a new financial command.

Default nonfinancial presence retention is 30 days of useful state changes,
with aggregated health thereafter under tenant policy. Raw heartbeat ticks are
not permanent audit documents. Separate personal details from necessary evidence
so access minimization does not break monetary traceability.

Metrics include command result/latency, queue age, projection lag, oldest unknown
payment, unreceived transfers, safe reservation/GL drift, close coverage and
authorization failures. Use bounded labels (operation, result, tier, cell);
tenant/store/record detail belongs in access-controlled logs/traces or bounded
analytics, avoiding millions of metric series. Every user-facing error has a
correlation ID; secrets and payment-sensitive data are redacted.

## 10. Release and rollback contract

1. Implement additive schema and compatibility readers; inspect duplicate/data
   mapping preflight before new constraints. Batch large backfills with durable
   checkpoints and measured DB impact. Do not run a 100m-row rewrite as an
   unbounded request or opaque migration hook.
2. Run shadow projections/resolvers and compare source outcomes. No shadow path
   posts money. Record mismatches by source without changing operator behavior.
3. Run fresh install, upgrade with open legacy work, guarded migration and
   compatible rollback drills. Capture complete migration logs and inspect
   orphan/deletion/after-migrate output.
4. Deploy to Doco lab and a second-tenant compatibility fixture, then a scoped
   pilot store only under rollout authorization. Financial pilot transactions
   use authorized fixtures or explicit real-operation procedures.
5. Expand by store cohort with pinned schema/contract/client compatibility.
   Stop automatically on integrity failures, unacceptable latency/error budget,
   unreconciled drift or migration anomalies. Preserve recovery endpoints.
6. Activate new financial semantics only at drained shift boundaries. Refuse
   incompatible clients with an update/recovery path that preserves local work.
7. Roll back UI/read-model exposure independently where safe. After new money
   records exist, use a compatible application rollback/forward repair; never
   delete new schemas or restore old DB data as a routine code rollback.

Each release receipt contains exact source SHA and CI run URLs, topology/image
digest where applicable, backup/restore evidence, migration inventory, capability
cohort, native/browser/hardware/load results, unresolved limitations and rollback
procedure. No certification advances on skipped required tests. Tenant readiness
and tier qualification are visible to onboarding and support.

## 11. Acceptance and delivery gates

| ID | Required evidence |
| --- | --- |
| ENT-T01 | Qualified tier meets workload/latency with canonical financial and stock reconciliation, including full history. |
| ENT-T02 | One tenant's burst/export/backfill cannot exhaust another tenant's transactional capacity or leak data. |
| ENT-T03 | Same-resource races have correct outcomes; safe contention does not serialize unrelated sales. |
| ENT-T04 | Queued/accepted/completed/unknown remain distinct through every crash and callback injection. |
| ENT-T05 | Scoped cache, search, job, event, export and support-access probes show no cross-tenant/store leakage. |
| ENT-T06 | Eight-hour soak and reconnect storm stay within declared resource and latency budgets. |
| ENT-T07 | Full-cardinality restore meets measured RPO/RTO and fences stale clients/projections with the new epoch. |
| ENT-T08 | Post-restore unknown external payments reconcile without recapture or lost obligation. |
| ENT-T09 | Retention/archival preserves unresolved work, audit links and duplicate-prevention identities. |
| ENT-T10 | Additive rollout, old-client boundary, abort and compatible rollback pass with no unexplained deleted DocTypes. |
| ENT-T11 | Physical device matrix and offline-loss drills disclose unsupported capability and residual device-loss risk. |
| ENT-T12 | Capacity state remains unqualified for every tier whose required evidence is absent. |

Build load instrumentation and fault fixtures during spec 01, not after all
features ship. Qualify Local first, then Chain, then Enterprise using the same
financial invariants. Scope feature exposure to the tier that has passed.
