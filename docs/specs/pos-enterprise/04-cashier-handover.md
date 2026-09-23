# 04 — Cashier responsibility, breaks and handover

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome shifts and custody.
Requires [01](01-store-register-foundation.md) and [03](03-shared-safe-transfers.md).

## 1. Outcome and chosen policy

An employee can take a break, finish a shift or hand a register to a colleague
without losing a cart, mixing cash or leaving an unowned discrepancy. The
system distinguishes the person currently authenticated from the person
accountable for an open drawer.

Default version 1 policy is **one accountable cashier and one selling browser
per drawer shift**. A break locks the register without transferring cash
responsibility. A change of accountable cashier closes the old shift, returns
cash to the safe in counted bags and opens a new zero-float shift that receives
its own float. Retaining loose cash in-place through an implicit PIN switch is
unsupported. Shared-drawer teams and floating till inserts require a later
explicit policy, accounting model and certification.

The [existing employee PIN flow](../../../posawesome/posawesome/api/employees.py)
verifies profile-assigned employees. [Terminal ownership](../../../posawesome/posawesome/api/shift_terminal.py)
belongs to an opening shift. Neither login nor PIN verification transfers that
shift's financial ownership. This distinction MUST survive the new UX.

## 2. Records and evidence

`POS Shift Handover` is a new process record, not another cash ledger. Fields:
register/store/company, source shift/cashier, optional nominated recipient,
intent (`break`, `finish`, `replace`), state, revision, count and closing links,
bag/transfer links, queue-drain evidence, cutoff/generation, unresolved case
links, accepting cashier/new shift, actor/approver, timestamps and reasons.

Queue-drain evidence identifies the installation and binding generation,
local queue schema, last monotonic local sequence, persisted pending-work
manifest hash, server receipt results and server-side in-flight operations.
It does not pretend to prove that an erased/lost browser had no local work.
Unknown coverage becomes a named recovery obligation.

Approvals are scoped records, tied to handover ID, action, amount/revision and
expiry. PINs/secrets are never stored as evidence. An approval cannot be reused
for another register or a later edited count.

## 3. Lifecycle

| State | Meaning | Allowed next step |
| --- | --- | --- |
| Draft | Intent saved; original cashier may still sell | Prepare, cancel |
| Preparing | Drain known work; classify carts and payments | Continue, resolve blocker, cancel |
| Counting | Selling fenced at authoritative cutoff; denomination entry allowed | Save count, recount, abort before transfer |
| ReviewRequired | Count/ownership/payment discrepancy needs authorized action | Review, recover, recount |
| ReturningCash | Count finalized and linked safe allocation executing | Resolve original operation receipt |
| SourceClosed | Closing committed; old shift immutable | Next cashier signs in and opens |
| AwaitingReceipt | New shift exists; float awaits independent receipt | Receive float, dispute |
| Completed | Old responsibility ended and next action confirmed | Return to sales or Cajas |
| Cancelled | No irreversible transfer/closing has occurred | Return to original shift after safe resume |

“Finish shift” completes at SourceClosed when there is no nominated replacement;
the register becomes Available if all opening prerequisites hold. “Replace”
completes only after the new cashier receives their float, or explicitly starts
a policy-permitted zero-cash/cashless session. Prepared float is not cash received.

Break is a separate `Unlocked → Locked → Unlocked` session state. It neither
closes the shift nor releases ownership. Another employee can request manager
help but cannot unlock into the previous person's selling identity.

## 4. Happy path

1. Cashier selects **Entregar caja** from their register. The UI summarizes
   saved orders, pending payments, local sync and cash tasks in plain language.
2. Unpaid carts can be parked with explicit scope/owner; paid or outcome-unknown
   transactions must reconcile. An order handoff follows spec 07. “Clear cart”
   is never an automatic handover side effect.
3. Preparing syncs this device's work, checks server in-flight submissions and
   performs the closing barrier. Other tabs stop accepting sales for this shift.
4. Cashier enters denominations. Blind-count policy hides expected cash until
   the count is finalized. Invalid counts are explained inline and saved drafts
   survive route changes/reload.
5. Cashier allocates all physical cash into return bags, optionally identifying
   next float and takings. Bags have unique seals and sum exactly to the count.
6. Confirmation states the physical action: place those bags into the selected
   safe. Canonical custody/closing commands record the count, movements, posting
   and closing once. Receipt printing is a separate recoverable operation.
7. The prior cashier sees “Turno cerrado” with handover evidence. Sign-out does
   not delete their archived or unresolved local work.
8. Next cashier authenticates, sees “Recibir Caja Mostrador”, opens their own
   zero-float shift, counts/receives the eligible bag, and lands in sales.

Independent verification of safe takings can happen later. A pending bag review
alone must not force the outgoing employee to remain signed in. An unexplained
drawer-account residual is different: version 1 requires its independent review
and correction before the same drawer opens again. The interface identifies
the available supervisor and offers another eligible register; no owner-only
approval bottleneck is introduced.

## 5. Concurrency and closing barrier

The close intent increments a register admission revision and fences new sale
commands under the register/shift locks in spec 01. Existing payment attempts
already durably admitted are allowed to settle under their original identity.
The barrier waits for their terminal results or creates an unresolved recovery
case; it never guesses from an empty browser queue.

Counting snapshots expected cash at an explicit source watermark. If an
admitted transaction changes expected cash before finalization, invalidate the
comparison and request refresh/review while preserving the physical count.
No ordinary new sale is admitted after the cutoff. A late provider callback
is reconciled through its original attempt, not discarded or moved to the next
cashier. Closing remains blocked while its financial outcome is unknown.

`finalize_handover` atomically records finalized count, allocations, immediate
safe deposits, closing, runtime release, receipt and outbox where all effects
are database-local. Long preparation does not hold DB locks while a human counts.
Transient draft changes use optimistic revisions; money finalization revalidates
all facts under lock. Count finalization alone is not a closing success.

A race between finalization and cancel yields one state transition. Once money
moves or closing commits, Cancel is replaced by the correct linked recovery or
compensating action. Resume after a rejected/aborted close advances the terminal
generation so a delayed prior close cannot later terminate a resumed shift.

## 6. APIs and authorization

| Logical operation | Preconditions | Result |
| --- | --- | --- |
| `handover.begin` | Own open shift; terminal possession; revision | Process record and work checklist |
| `handover.prepare` | Correct generation; source queue manifest | Barrier revision, admitted-work status and blockers |
| `handover.save_count` | Counting state; count revision | Durable draft/count reference |
| `handover.review` | Independent reviewer; action-bound approval | Resolution event, not overwritten count |
| `handover.finalize` | Drained known work; no unknown payment; valid allocation | Original closing/custody references and register state |
| `handover.accept` | Intended/eligible recipient authenticated as themselves | Own new shift and receipt workflow |
| `handover.cancel/resume` | Pre-transfer state and current proof | Audited cancellation or fenced resume |
| `handover.status` | Owner, intended recipient or scoped supervisor | Receipt status, blockers, allowed actions |

Commands use spec 01's request IDs, expected revisions and scope checks. A
supervisor may review/recover but does not invisibly become the cashier.
An incoming employee cannot finalize the outgoing employee's count. Physical
emergency closure of an absent employee requires supervisor authority, a named
independent counter, reason and recovery evidence, all visible in the report.

Index handovers by `(register, state, modified, id)`, source shift, recipient
and unresolved review owner. One active replacement process per source shift
is enforced by its locked runtime pointer. Avoid partial-unique assumptions
that the deployed database cannot enforce.

## 7. Exceptional journeys

- **Cashier absent:** manager inspects known work, performs authorized recovery,
  records physical count and explains missing employee acknowledgment. Evidence
  distinguishes witnessed acceptance from administrative recovery.
- **Device lost:** old generation is revoked; unknown local work remains an
  exception. The new browser cannot claim its local queue was drained.
- **Recipient leaves:** replace the nomination before receipt with revision,
  reason and new permission check. No cash changes merely from renaming a person.
- **Wrong bag/short bag:** receipt is disputed; new drawer is credited only by
  the canonical accepted amount. The source count is never edited retrospectively.
- **Printer failure:** show source closing number and reprint; never reopen a
  financially closed shift just to obtain a ticket.
- **Break during an uncertain payment:** lock is allowed for privacy, but recovery
  remains tied to the original shift and must be resolved before handover.

## 8. Offline and mobile behavior

Lock/unlock of an already authorized local session follows the existing offline
policy; a new accountable cashier, opening, financial handover and manager
approval require online validation. Local denomination drafts may be preserved,
clearly labeled “Sin enviar”. They do not free a register for another device.

The flow is a short stepper with a persistent register/cashier context, visible
saved state, one main action and an explicit return. At narrow widths each step
uses a single vertical scroller; denomination entry uses numeric input without
shrinking labels. Confirmation lists bag count, total and destination. Motion
signals completed steps, respects reduced motion and never masks a blocked step.

## 9. Migration and acceptance

Introduce the handover orchestrator around existing closing/custody commands;
do not fork their posting calculations. Existing PIN switching remains available
for authentication, with a clear guard when it would abandon an accountable
open shift. Legacy open shifts complete under their existing contract before
the new default activates.

| ID | Required evidence |
| --- | --- |
| HND-T01 | Sale → break → unlock resumes the same cashier, drawer and cart without a cash movement. |
| HND-T02 | Full A → safe → B handover yields separate shifts and one float receipt, with immutable A evidence. |
| HND-T03 | PIN switching cannot sell on another person's accountable shift or reveal their local queue. |
| HND-T04 | Two tabs, delayed close and concurrent payment completion cannot bypass the barrier or close a resumed shift. |
| HND-T05 | Unknown provider outcome blocks financial close, even when local queue count is zero. |
| HND-T06 | Blind count stays blind through hints, errors, review and recipient screens. |
| HND-T07 | Shortage review clears the old drawer residual before next opening; pending safe verification alone does not block it. |
| HND-T08 | Crash after drop/close commit resolves to the original records on retry with no duplicate cash. |
| HND-T09 | Supervisor emergency recovery records missing acknowledgments and preserves unknown-device obligations. |
| HND-T10 | Cancel after dispatch is refused with the valid recovery path; pre-transfer abort safely restores selling with a new generation. |
| HND-T11 | Incoming cashier without profile/store eligibility cannot receive or open even through a copied handover URL. |
| HND-T12 | Phone, tablet, keyboard and printer-failure journeys finish without copying IDs, hidden actions or lost drafts. |

Ship break/identity clarification, then guided normal handover, then emergency
recovery. Measure handover duration, blocker reason/age, discrepancies and
abandonment; never reward faster closure by suppressing unresolved money.
