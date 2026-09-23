# 03 — Shared safes, bags and cash transfers

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome custody; ERPNext owns posted accounting.
Requires [01](01-store-register-foundation.md). Consumed by specs 02, 04, 05 and 06.

## 1. Outcome and supported operating model

Several independent drawers receive funds from and return cash to the same
store safe. Every movement names its source, destination, responsible people,
physical package and accounting evidence. A manager can answer where the money
is, who last acknowledged it and what still needs counting.

Version 1 supports multiple safes per store, one active home store per safe,
one company and company currency per transfer, and two-decimal physical cash
denominations. Cross-company, cross-currency and inter-store transport are
explicitly blocked. The schema stores currency/precision and immutable source
and destination scope so future support does not require reinterpreting history.

## 2. Existing guarantees to preserve

The [current custody contract](../../POS-CASH-CUSTODY.md) and
[service](../../../posawesome/posawesome/api/cash_custody/service.py) already
provide independent verification, seal uniqueness, counted bags, reservations,
idempotent requests, protected journals, drawer closing allocations and bank
transit. Multi-register work MUST extend these guarantees rather than creating
another cash balance outside ERPNext.

Current bags/counts/events are scoped to safe plus POS Profile. Migration adds
explicit Store, source register, destination register and protocol version;
existing profile fields remain historical evidence. Safe visibility/authority
becomes store/capability based, not permission to any one profile alone.

## 3. Records and invariants

| Record | Additions or new contract |
| --- | --- |
| `POS Cash Safe` | Store, allowed registers through normalized links, custody policy revision; unique safe-account ownership retained; legacy profile retained for v1 history |
| `POS Cash Bag` | Unique site seal, physical location, accountable custodian, preparation/count evidence, source/destination references, protocol version |
| `POS Cash Transfer` (new) | ID, kind, delivery mode, source/destination resource IDs, currency, declared/dispatched/received minor amounts, dispatch/receipt actors/times, request receipts, count links, journal links, state, revision |
| `POS Cash Transfer Event` (new or typed extension of existing events) | Immutable state transition, actor, approval, reason, source documents and previous/new revision |
| `POS Cash Count` (extend) | Register/store scope, scope snapshot, counter, denominations, manual reason, expected-source watermark, review state |
| `POS Safe Register` (new link) | Unique safe/register pair; active dates; receive/deposit eligibility; same store/company checks |

**CASH-01:** Bags are containers/reservations within a cash account, not extra
assets added to its balance. Preparation never creates cash.

**CASH-02:** No receipt consumes more than once, no bag is simultaneously in
two locations, and no person independently verifies their own preparation/count.
Administrative correction requires a different authorized reviewer and reason.

**CASH-03:** Posted debits equal credits in company currency. Expected drawer
cash, drawer journals, invoice tenders and closing use the same route from 01.
Transfers are neither sales nor expenses unless a separately authorized variance
posting explicitly recognizes a shortage/overage.

**CASH-04:** Physical delivery, verification and accounting completion are
distinct facts. “In the safe” does not mean “count verified”. A browser timeout
does not mean cash returned to the sender.

**CASH-05:** No transaction uses floating-point arithmetic to decide value.
Amounts cross APIs as integer minor-unit decimal strings plus currency/precision;
the server uses exact integers/Decimal. Reject fractions of minor units,
negative counts, non-finite values and overflow before posting.

## 4. Physical and financial state machines

Bag verification retains `Unverified`, `Available`, `Disputed`, `Issued`,
`In Transit`, `Deposited` and `Unpacked`, with explicit physical-location fields.
An unverified bag in a safe is part of safe physical/ledger cash but not
available for routine issue until independent verification or verified receipt.

Transfer lifecycle:

| State | Meaning | Allowed continuation |
| --- | --- | --- |
| Draft | Saved intent; no reservation or posting | Edit, prepare, cancel |
| Prepared | Exact source cash reserved; no physical dispatch | Dispatch, receive immediately where supported, cancel reservation |
| InTransit | Sender recorded physical dispatch and source reduction | Receive, dispute, record authorized physical return |
| ReceivedPendingReview | Receiver records count/possession; discrepancy or verification remains | Independent review, recount under policy |
| Completed | Both physical/accounting obligations satisfied | Read evidence; correction through linked new transaction |
| Disputed | Mismatch, missing package or recipient challenge | Investigate, counted receipt/return, approved variance |
| Cancelled | Pre-dispatch intent/reservation released | Read only |
| Returned | Physical return acknowledged and compensating posting completed | Read only; new transfer required for another attempt |

No cancellation jumps from InTransit to Cancelled. Post-dispatch return requires
physical confirmation and compensating accounting. No timer automatically
receives, verifies, writes off or returns money.

Delivery modes are deliberately distinct:

- `ImmediateReceipt`: recipient counts and accepts during one handover at the
  safe. One committed transfer moves safe → drawer, or drawer → safe after a
  physical safe drop. This preserves existing bag-drop semantics. Independent
  safe verification may remain pending after the ledger movement.
- `InTransit`: physical custody leaves a source before the destination accepts.
  Dispatch moves value into a designated transfer-clearing asset account;
  receipt moves it into the destination. Direct caja-to-caja change delivery
  uses this mode. Bank transit retains its separate existing account/workflow.

Mode is immutable after preparation. A rejected mode change cannot repost the
same cash through the alternative route.

## 5. Posting rules and reconciliation

| Action | Debit | Credit | Additional effect |
| --- | --- | --- | --- |
| Prepare/reserve bag | None | None | Reduce available loose source cash only |
| Receive float immediately | Drawer | Safe | Consume verified bag; link to receiving shift |
| Drop physically into safe | Safe | Drawer | Create Unverified bag; verification still outstanding |
| Dispatch drawer-to-drawer or staged safe handoff | Transfer clearing | Source cash | Record sender/custodian and exact outstanding transfer |
| Receive full staged transfer | Destination cash | Transfer clearing | Receiver's evidence completes custody obligation |
| Dispatch bank bag | Bank transit | Safe | Preserve bank dispatch reference |
| Confirm bank receipt | Bank | Bank transit | Require bank evidence; no inferred settlement |
| Return undelivered staged cash | Original source cash | Transfer clearing | Count physical return; link compensation |

For a 1,000 dispatch with 990 received, first receipt posts 990 to the
destination and leaves 10 in clearing on that transfer. Independent resolution
posts either a later located receipt/return or approved shortage
`Dr variance expense / Cr clearing`. The transfer remains unresolved until the
entire 1,000 is accounted for. If 1,010 is counted, post the undisputed 1,000
receipt; hold the extra 10 as an explicit physical-versus-ledger discrepancy
until authorized overage posting `Dr destination / Cr variance expense`.
Do not silently cap the physical count or make it disappear from close checks.

For a bag already dropped into the safe with immediate posting, its later
shortage is a safe variance, not a second drawer reduction or transfer-clearing
shortage. Snapshot the accounting mode on every case to prevent mixing rules.

Split receipts are allowed only as separate immutable count events against the
same transfer. Lock and recompute its outstanding declared amount before every
receipt/review; the sum of accepted principal cannot exceed dispatch. Extra
physical cash is a discrepancy, not another principal receipt. Receiving zero
records a refusal/dispute without a zero-value journal. Each correction binds
to the unreconciled amount and revision it reviews. A new count cannot overwrite
the dispatch amount or silently mark the remainder received.

Available loose cash equals current eligible account cash minus physically
contained/reserved bag amounts and other active source reservations, using one
consistent transaction snapshot. In-transit cash belongs to its clearing asset,
not to both source and destination. Store totals eliminate internal movements.
Ledger residuals from unresolved shortages remain visible after a physical
drawer has been emptied; the next shift cannot inherit that discrepancy as float.

## 6. Worker journeys

### Supply opening float

Supervisor prepares/counts bags from loose safe cash. Cashier opens an empty
drawer with zero, selects or scans a bag eligible for that caja, counts and
receives it. One movement establishes the float. The opening amount cannot also
include that money. Different cashiers may receive distinct bags concurrently.
Two claims on one bag yield one receipt and one state-conflict response.

### Ask for change

Cashier selects “Solicitar cambio”, amount and denominations wanted. Manager
chooses safe or another eligible caja. Sender sees the named destination and
counts dispatch. Receiver's Pendientes shows “Recibir de Caja 2”; they count,
accept or dispute. The request is separate from the financial transfer and can
be declined before cash moves. Sender cannot accept on the recipient's behalf.

### Drop takings and close

Cashier counts cash, seals bag, confirms physical safe placement and receives a
recorded handover reference. Safe verification remains a manager task; it does
not force a normal cashier to wait at the register after physical/accounting
handover. Closing consumes this same movement once. Printing failure offers
reprint and never rolls back a committed drop.

### Manage safe exceptions

Manager opens safe → pending bags → count → compare → resolve/recount. They
return to the same queue. Missing or disputed cash shows responsible custodian,
last evidence, age and a next action. No routine step requires copying record IDs.

## 7. APIs, permissions and consistency

Use spec 01's command envelope and receipt protocol. Logical actions are
`cash.requests.create/decline`, `cash.transfers.prepare/dispatch/receive/return`,
`cash.bags.verify/unpack`, `cash.counts.save/finalize/review` and existing bank
dispatch/confirmation. Every command returns updated source references,
remaining obligation and allowed next action. Scope is derived from resources.

Cashiers can act only on their own open drawer and eligible received bags.
Safe custodians can prepare/receive safe cash; reviewers can resolve differences;
bank dispatch and bank confirmation are separate capabilities. Thresholds may
require an independent approver. Role combinations cannot bypass no-self-review.
Cashiers need not see the full safe balance or bags assigned to other drawers.

Use the global lock order from 01. InTransit receive may lock only the receiver's
active resources and transfer; it must not require reopening a closed source
shift. Dispatch/close races serialize on the source shift. Closed source shifts
retain links to unresolved transfers but never accept fresh dispatches.

Safe rows serialize reservations/issue/drop for that physical safe; ordinary
sales do not lock the safe. Do not serialize a whole company to issue a float.
Direct transfers acquire both register resources in deterministic order when
both participate in a single command. Outbox publication occurs after commit.

Registered custody accounts must route all balance-affecting application writes,
including authorized general journals, imports and cancellations, through a
shared cash-resource lock/validation adapter. Otherwise generic accounting could
change the balance during a reservation. Direct alteration of custody journals
remains blocked. ERPNext's posted GL remains authoritative; any fast cash
position table is transactionally maintained, independently reconciled and
rebuildable. Until that adapter is proven, use indexed authoritative GL reads
under the required locks; a cached dashboard balance never approves a transfer.

Indexes cover active bag state by safe, source/destination transfer state,
open clearing obligations by transfer ID, seal uniqueness, request uniqueness
and shift movement chronology. Monetary histories are cursor-paged; computing
available cash cannot load every historical bag into application memory.

## 8. Offline and interruption rules

Counts/requests may be saved locally as drafts with owner/scope and revision.
Financial transfer, reservation, verification, return and bank confirmation are
online-required. Display that restriction before instructing physical movement.
Interrupted responses retain the same request ID and offer receipt lookup/retry.
“Do not move the cash again while the result is being checked” is explicit.

If staff physically move cash during an outage anyway, record a recovery case
with original physical time, people and evidence. A supervisor reconciles the
actual movement through the canonical posting path; the UI does not fabricate
an earlier successful server acknowledgment. No offline time grants ownership.

## 9. Migration and operational safeguards

Add Store links and protocol version while retaining v1 readers. An approved
mapping groups legacy safes only after reconciling every account, bag and count.
Do not merge two ledger accounts or reassign historical bags merely because the
same physical safe label was used. One existing safe can be linked to more
registers only after their account routes and scope checks are validated.

Drop the profile uniqueness dependency for migrated safes only after dual-read
compatibility and new scope enforcement pass; retain unique safe-account
ownership. Cut over with no unconfirmed legacy commands and a signed count
baseline. In-flight v1 bags finish under v1 accounting semantics. Both modes
must coexist safely until those obligations settle.

Monitor unmatched clearing amounts, oldest unreceived transfer, disputed bags,
reservation/GL drift, safe lock waits, duplicate receipt attempts and count
revision conflicts. Escalation creates one deduplicated case, not repeated alerts.

## 10. Acceptance

| ID | Required evidence |
| --- | --- |
| CASH-T01 | Two registers receive different floats from one safe; drawer/safe GL, bags and expected shift cash agree exactly. |
| CASH-T02 | Concurrent claims on one bag and reservations exceeding loose cash yield one valid winner without negative availability. |
| CASH-T03 | 1,000 dispatched, 990 received, 10 approved shortage leaves zero clearing and complete original count evidence. |
| CASH-T04 | An over-receipt remains visible and blocks clean reconciliation until approved; no rounding/capping hides it. |
| CASH-T05 | Immediate safe drop with later shortage adjusts safe only; neither drawer nor transfer clearing is charged twice. |
| CASH-T06 | Dispatch → physical return uses compensating journal; cancel/retry never erases dispatch. |
| CASH-T07 | Sender cannot receive their own staged transfer or verify their own preparation through any API. |
| CASH-T08 | Closing and dispatch races yield a consistent winner; destination receipt can settle a transfer after source shift closure. |
| CASH-T09 | Lost response, duplicate request and browser reload produce one posting and one bag transition. |
| CASH-T10 | Generic journals/imports/cancellations cannot bypass custody locking or journal protection. |
| CASH-T11 | Bank transit and register transit remain distinct, and bank confirmation requires its own evidence. |
| CASH-T12 | Cross-store/company/currency/profile tampering is rejected without disclosure. |
| CASH-T13 | Legacy bags migrate/settle with unchanged ledger totals; no duplicate opening float is introduced. |
| CASH-T14 | Shared-safe burst load meets spec 09 without reducing unrelated sale throughput. |

Implementation order: account routing and scope adapter; shared-safe links and
legacy migration; immediate float/drop flows; staged transfers and discrepancy
resolution; employee/manager queues; concurrency and full GL/browser drills.
