# Supplier delivery receiving from POS

Status: planned, not implemented. Owner direction: 2026-09-15.
Scope: Scan Retail and Repair + Retail; first verification tenants Doco and Mumu.

## Outcome

A cashier can pause a sale, identify an expected delivery, verify the goods,
record receipt, give the supplier a receipt, and return to the same sale.
The worker does not recreate supplier, product, order or storage information
already held by the system. Receiving, storage placement and supplier payment
are separate recorded actions.

## Complete worker journey

### 1. Entry and sale preservation

Add **Receive delivery** to More, visible to authorized receiving workers.
The destination opens a queue of expected/partial deliveries with supplier,
reference, expected date, destination warehouse and remaining quantities.
Search accepts supplier ID/name, purchase order, supplier delivery reference,
or a supported barcode/QR. Keep customer, basket and return destination.
A sale that cannot be saved stays visible with recovery guidance; do not
silently discard it to begin receiving.

### 2. Identify supplier and delivery

Selecting a delivery carries supplier, company, branch, warehouse, order rows,
units and outstanding quantities into the receipt. Display the supplier's
reference separately from the internal purchase-order number. An ambiguous
reference asks the worker to choose; it never silently chooses another branch.
Only trusted, validated payloads may populate fields from a scanned code.

If no order exists, offer **Receive without an order** only where policy and
role allow it. Require supplier, delivery reference and reason. Unknown items
are matched to existing item/barcode records or sent to a supervisor's item
creation task; do not create near-duplicate items from supplier descriptions.

### 3. Verify physical receipt

Show product, expected outstanding quantity, received quantity, unit and usual
cajón/location. Expected quantities are suggestions; require an explicit
physical-check confirmation. Support barcode counting and case-to-piece
conversion with the conversion visible. Show serial/lot and expiry capture
only for items that require it.

Record shortages, damaged/rejected goods, wrong items and excess deliveries
as explicit exceptions. Only accepted quantities enter available stock.
Over-receipt, substitutions and unexpected cost changes use existing ERPNext
validation and the configured approval policy. Partial receipts leave the
remainder outstanding, unless an authorized worker explicitly closes it.

### 4. Placement decision

- **Put away now:** suggest each item's existing location; confirm actual
  placement and change only exceptions.
- **Put away later:** receive into the branch's configured Receiving warehouse
  or equivalent existing location model and create a placement task. The task
  shows item, quantity, source, destination suggestion and receipt reference.
  Scan/confirm the product and destination, support partial placement, and
  leave remaining units on the task.

Reuse the existing cajón/location owner; do not invent another location table.
ERPNext's `Bin` is the item/warehouse stock balance, not a physical drawer.
Before implementation, document how physical cajones map to the installed
location model and when a warehouse Stock Entry is required. Availability and
POS picking must distinguish receiving-area stock from shelf-ready stock.
Never label goods as being in a suggested cajón before placement is confirmed.

### 5. Review and commit

Show accepted quantities, exceptions, destination and whether placement remains.
Primary action: **Receive [quantity] [unit]** (use a line/item count instead
when mixed units would make a summed quantity misleading).

Create/submit the canonical ERPNext Purchase Receipt through its owning APIs,
linked to the Purchase Order where present. Preserve company, supplier,
warehouse, tax/cost and serial/lot validation. Capture authenticated worker,
server timestamp and optional delivery-note photo/signature according to
policy. A signature is evidence of handoff, not a replacement for stock checks.

The commit needs a durable request identity. Double taps, retries and lost
responses must retrieve the same receipt rather than add stock twice. Confirm
server status before offering another submission after a timeout.

### 6. Supplier receipt and completion

Show the confirmed folio, supplier reference, accepted/rejected quantities and
remaining order quantities. Offer **Print receipt**, **Put away**, and
**Back to sale**. Printing failure does not undo receiving: reprint the same
folio and show “Received; printing needs attention.”

The supplier can retain a signed/stamped copy if store policy requires it.
Receipt creation does not create a supplier payment or mark a Purchase Invoice
paid. Invoice matching, discrepancies, credits and payment remain linked tasks
in the purchasing/accounting owner's workflow.

### 7. Corrections and return to queue

Reopen a receipt to inspect its source order, evidence and placement progress.
Use canonical Purchase Receipt returns/cancellation workflows for corrections,
with role checks and downstream-document checks. Never edit a posted stock
quantity in place. Return the worker to the same filtered receiving queue or
the preserved sale, whichever they came from.

## Failure and recovery behavior

- Connection lost before commit: keep the draft/checklist locally where safe;
  label it **Not received yet**. Do not claim stock is posted offline.
- Unknown commit result: show **Checking receipt status**, look up its request
  identity, then offer recovery. Never show success solely from a local draft.
- Missing permission/configuration: name the prerequisite and provide the
  supervisor/setup continuation without losing entered quantities.
- Order changed while counting: reload and compare outstanding quantities,
  preserving the worker's counts for reconciliation.
- Another worker received the same delivery: prevent duplicate submission and
  link to the recorded receipt; supervisor review for ambiguous references.
- Missing printer: completion remains visible with reprint/download options.
- Shift closes while receiving: preserve the receipt draft; receiving authority
  belongs to the authenticated worker and company, not an invented sales tender.

## Ownership and implementation slices

1. Verify installed receiving/location models, permissions and branch mappings.
   Record the canonical order → receipt → placement → invoice/payment links.
2. Add queue, search, contextual receipt draft and preserved-sale navigation.
3. Add physical counting, discrepancy review, server validation and idempotent
   commit/recovery. No successful-looking offline stock receipts.
4. Add receipt evidence, print/reprint and completion actions.
5. Add immediate/deferred placement and the unfinished-placement queue using
   the existing storage owner's records.
6. Add linked correction/return, invoice matching and supervisor exceptions.
   Complete both tenant journeys before rollout.

## Acceptance and lab verification

- Existing order: identify → count → receive → receipt → return to original sale.
- No-order receipt: permitted role succeeds; disallowed role gets a recoverable
  explanation without losing work.
- Partial, extra, damaged and wrong-item deliveries preserve the correct order
  remainder and accepted stock; no rejected units become saleable.
- Case/piece conversion, required serial/lot/expiry and item matching work.
- Immediate placement and partial deferred placement reconcile receipt quantity
  with source/destination balances and remaining task quantities.
- Double click, connection loss after commit and duplicate supplier reference
  cannot duplicate stock; original receipt remains discoverable.
- Print failure → reprint returns the same folio with no stock mutation.
- Receipt never marks supplier debt paid; invoice/payment links remain correct.
- Correction/return respects downstream constraints and leaves an audit trail.
- Cashier/supervisor roles, branch isolation, Doco cajones and Mumu's actual
  storage setup are exercised in the lab with outbound side effects suppressed.
- Desktop and touchscreen layouts keep the next action reachable; supplier
  receiving cannot erase or unexpectedly replace the active customer basket.

Rollout requires tests for stock/accounting invariants, real lab workflows,
exact-revision CI and normal production authorization. This plan is not evidence
that receiving has been implemented or deployed.
