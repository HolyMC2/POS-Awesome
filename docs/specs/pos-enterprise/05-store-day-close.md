# 05 — Store business day and consolidated close

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome operations; ERPNext/compliance retain ledger/fiscal authority.
Requires [01](01-store-register-foundation.md), [03](03-shared-safe-transfers.md)
and [04](04-cashier-handover.md). Exception adapters follow [06](06-operations-inbox.md).

## 1. Outcome

A store manager can finish a business day across all cajas, safes and payment
methods, knowing which obligations are settled, outstanding or unknown.
Individual cashier shifts close independently. A 24-hour store can start the
next business day without pretending the prior day's unresolved money vanished.

Store close is an evidence/reconciliation workflow. It does not repost every
sale, consolidate invoices into a second sale or replace ERPNext period closing.
Fiscal cutoff, legal posting date, processor settlement date and store business
day remain separate fields controlled by their owning domains.

## 2. Time and responsibility model

Each Store has an IANA timezone and local cutoff, default 04:00 when explicitly
accepted during setup. A business date identifies the local interval from its
cutoff to the next cutoff. Persist resolved UTC start/end and timezone-rule
version on each day. For an ambiguous DST cutoff choose the first occurrence;
for a nonexistent cutoff choose the first valid local instant after the gap.
Intervals are contiguous and nonoverlapping, including 23/25-hour days.

Device clocks are evidence only. Server admission assigns `business_day` and
`register_day_epoch` to a financial attempt; delayed completion keeps that
assignment. Opening shifts retain their starting business day but may contain
several day segments in a 24-hour store. Every sale/movement report uses the
transaction's assigned segment, not a guess from the shift's creation date.

Changing timezone/cutoff requires no overlapping day transition and applies to
a future recorded boundary. It never rebuckets submitted documents silently.
Late offline work retains its original shift/device/capture evidence and is
handled as a late item; the accounting owner selects a permitted posting date.

## 3. Records

| Record | Contract |
| --- | --- |
| `POS Business Day` | Unique Store/business date; resolved interval; state; policy version; roster/configuration revision; current review generation |
| `POS Register Day Segment` | Unique register/day/segment sequence; shift and binding; admission epoch; start/end source watermarks; count/carry evidence |
| `POS Store Close` | Day, immutable snapshot generation, completeness by source, register/safe vector, expected/actual tender summaries, exceptions, attestation and report checksum |
| `POS Store Close Line` or normalized detail table | Source type/ID/revision, amount/currency, disposition, evidence link; paged, not one unbounded document payload |
| `POS Close Amendment` | Prior close reference, late/corrected source, reason, financial impact, reviewer and separate signed revision |

Day state is `Open → Collecting → Review → OperationallyClosed → Reconciled`.
Collecting/Review may continue while the next day is Open. OperationallyClosed
means register day admission has moved on and obligations are assigned; it does
not assert balanced cash or settled providers. Reconciled requires the financial
conditions below. Immutable close snapshots document each attestation; later
discoveries create amendments and a visible “Amendment pending” condition.

## 4. Close checklist and policy

The default manager view groups work into **Cajas**, **Caja fuerte**, **Cobros**
and **Diferencias**. Every row has an owner, age and next action.

| Condition | Operational close | Financial reconciliation |
| --- | --- | --- |
| Register with unresolved admitted sale/payment | Can advance day with explicit owned exception | Blocks |
| Open overnight shift with valid day segment/carry evidence | Allowed | Allowed if segment complete and counted per policy |
| Device unreachable with possible local cash work | Record unknown coverage and recovery owner | Blocks; a heartbeat timeout is not proof of zero |
| Safe bag physically received but unverified | Carry named verification obligation | Blocks safe reconciliation until reviewed |
| Staged transfer unreceived/disputed | Carry exact clearing obligation | Blocks clean reconciliation |
| Bank deposit in transit with verified dispatch | Carry bank receivable and evidence | Allowed as outstanding transit, not “deposited” |
| Card capture confirmed, settlement scheduled later | Carry provider receivable | Allowed with matched capture evidence, not “bank settled” |
| Fiscal document pending in owning app | Carry source case | Separate fiscal completeness status; never label fiscal complete |
| Drawer/safe count discrepancy unreviewed | Assign independent reviewer | Blocks |
| Print failure after successful posting | Carry reprint task | Does not block financial reconciliation |

Each carried item remains linked to its original day. A manager cannot lower
a money-critical blocker to a warning simply to obtain a green close. Defined
nonfinancial policy differences are versioned and visible in the report.

## 5. Manager journey

1. Open **Cierre de tienda**. Default to the oldest unfinished business day;
   show current store, interval and last-refresh coverage.
2. “Preparar cierre” builds a source snapshot and paged checklist. It does not
   close drawers, move cash or call external settlement APIs.
3. Select a caja needing close/handover, resolve through its owning workflow,
   then return to the checklist with filters and position preserved.
4. Count safe cash with explicit bag inclusion; review transfers and cash
   differences; match confirmed card/transfer payments to evidence available.
5. Review summary by tender and cash location. Distinguish sales, refunds,
   collections, float, expenses, internal movements and bank dispatch.
6. If obligations remain, finish operational close with assigned owners and
   disclosed gaps. The next day can operate under its own epoch.
7. When reconciliation prerequisites pass, reviewer confirms the exact snapshot
   revision. Generate immutable close evidence, with printable/exportable links
   and a clear route back to Cajas or the next unfinished day.

On phones, this is a grouped checklist with detail records, not a horizontally
scrolling spreadsheet. Desktop may add tender comparison columns. Blind-count
restrictions persist in the linked counting flow even if the manager can see
aggregate amounts elsewhere.

## 6. Snapshot and cutoff algorithm

1. Create/reuse a close operation receipt and pin the day's store/register/safe
   roster revision. New register activation is routed to the current open day;
   it cannot be inserted retrospectively into a sealed roster.
2. For each included register, a short transaction under its runtime/shift lock
   installs the next day epoch at the scheduled boundary or administrative
   transition. Record all already-admitted financial attempts under the old
   epoch. Do not hold all register locks for the whole store.
3. Drain/resolve those admitted operations. A background completion is recorded
   against the original epoch and advances that segment's source watermark.
   New-day sales proceed on that register independently.
4. For overnight shifts, perform the same admission barrier around a boundary
   cash count. Record opening carry, period movements and counted closing carry;
   the next segment receives the identical physical carry once. The accountable
   cashier/shift continues. Any difference becomes a review case. A policy
   requiring a counted segment cannot substitute an estimated carry as verified.
5. Snapshot safe/transfer/payment sources with their own sequence/watermark and
   outstanding obligations. Reconciliation uses a vector of completed source
   revisions, not wall-clock timestamps or a tenant-global write counter.
6. Build totals in bounded jobs. A final authoritative check verifies all
   required source segments are complete and unchanged before attestation.
   If the vector changed, mark the preview superseded and recalculate.
7. Commit close snapshot, disposition links, attestation and outbox atomically.
   No long DB transaction remains open during human review or report rendering.

Ordinary sales consult their locked register's admission epoch; a store-wide
row is not locked on every invoice. Boundary propagation is recoverable and
idempotent per register. Partial completion is shown as “Preparing 18 of 20”,
never a completed store cut. Server-side epoch validation must handle a register
that missed the boundary job before admitting its next sale.

Every immediate multi-resource cash movement stamps both posting legs with one
business-day identity and one source event. All participating register epochs
must be current before admission. A staged transfer may dispatch on day D and
receive on D+1; the intervening balance is explicitly transfer clearing. Store
totals are reconstructed from these tagged events and opening carries, never
by summing unrelated live balances sampled at different moments. A safe count
taken after cutoff is bridged back with the intervening recorded movements;
if that bridge has unknown coverage, the prior day cannot be reconciled.
The final check also rejects a snapshot containing only one leg of a committed
internal movement. This is required even when each individual source projection
appears fresh.

## 7. Arithmetic and evidence

For each drawer segment: opening physical carry + recorded cash receipts -
refunds - cash expenses + incoming movements - outgoing movements = expected
closing cash. Counted closing minus expected is the variance. Preserve both
values; do not edit expected to make them match.

Store cash assets are drawers + safe + internal transfer clearing + bank transit,
each counted once. Bags are included within their physical/account location,
not added again. Moving money caja → safe → bank changes location, not sales.
Cobranza receipts and advance deposits are distinguished from current-day sales;
provider fees/settlement differences stay in the owning accounting workflow.

Reports include source-document links, actor/approver, count evidence, cutoff
vector, policy/config versions, currency precision, unknown coverage, outstanding
transit and amendments. Multi-company and multi-currency regional reports group
separately; no implicit cross-company netting or unlabelled exchange conversion.

## 8. API, security and performance

Logical operations: `store_close.prepare`, `store_close.status`,
`store_close.list_items`, `store_close.operational_close`,
`store_close.reconcile`, `store_close.amend`, `store_close.export`.
Use spec 01 receipts/revisions. Prepare/export return operation IDs; progress
and per-source failures are durable. Finalization requires the preview revision
the manager actually reviewed.

Store managers prepare and assign cases. Financial reviewers attest within
their company/store authority; no self-review of their own discrepancy. Read-only
auditors can export source evidence but cannot change it. Regional close jobs
orchestrate separate store operations and expose partial results, never a
cross-store transaction that locks all drawers.

Indexes cover store/business-date uniqueness, segment day/epoch, attempts by
segment/state, close generation, unresolved disposition and amendment source.
Reuse incremental posted-document summaries with source checkpoints; avoid
repeated full-history GL scans. Final correctness checks use canonical sources.
Historical report generation has bounded workers and separate queue capacity.

## 9. Failure, migration and retention

An outage during preparation resumes from per-source checkpoints. A lost
finalization response resolves through its receipt. Source projection lag shows
incomplete coverage and blocks reconciliation, not ordinary new-day operation.
Closing UI is cached read-only offline; draft notes may be retained locally.

A late accepted transaction after a sealed day produces an amendment with
original intent day, actual posting date and reason. It does not overwrite a
signed report. An irrecoverably lost device requires an authorized loss/recovery
determination with disclosed limitations; the system never manufactures a
successful queue-drain acknowledgment.

Legacy shifts initially group into explicitly marked historical reports using
existing dates. Do not relabel them as newly verified closes. Enable business-day
epochs at a planned boundary after register migration. Retention and legal hold
follow spec 09; closing evidence cannot expire before its underlying records.

## 10. Acceptance

| ID | Required evidence |
| --- | --- |
| DAY-T01 | Two cajas close separately; store totals match sales, receipts, refunds, movements and GL without counting bags twice. |
| DAY-T02 | One unresolved provider outcome permits disclosed operational close but blocks reconciliation. |
| DAY-T03 | Midnight, 04:00 cutoff, DST gap/overlap and timezone change yield contiguous, reproducible intervals. |
| DAY-T04 | An overnight shift crosses a counted segment boundary without a second float or loss of cashier attribution. |
| DAY-T05 | A payment admitted before cutoff and completed afterward belongs to exactly one original segment; internal transfer legs cannot be split across inconsistent snapshots. |
| DAY-T06 | New-day selling continues while prior-day review runs; no store-wide sale lock appears under load. |
| DAY-T07 | Missing device or lagged adapter produces unknown coverage, never zero pending cash. |
| DAY-T08 | Store snapshot changes during review reject stale attestation and retain entered notes. |
| DAY-T09 | Late offline work creates a visible amendment with legal posting handled by its owner. |
| DAY-T10 | Interrupted 100-register preparation resumes without duplicate close lines or lost source obligations. |
| DAY-T11 | Bank transit and card receivables remain separately disclosed rather than falsely settled. |
| DAY-T12 | Regional exports honor scope/company/currency, stable snapshot and revoked permissions. |

Implementation order: business-day identity/epochs; source completeness adapters;
snapshot/checklist; operational close; reconciled attestations; overnight segments;
amendments and regional orchestration. A store requiring overnight operation
cannot be activated until that segment gate passes.
