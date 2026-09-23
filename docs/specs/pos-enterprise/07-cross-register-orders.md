# 07 — Order continuity across devices and registers

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome coordination; originating app owns its order/service record.
Requires [01](01-store-register-foundation.md), recovery in [06](06-operations-inbox.md).

## 1. Outcome and scope

An employee starts an order on a phone, parks it or sends it to a caja, and an
authorized cashier continues with the customer/items intact. A table account,
repair charge and retail basket arrive through their existing source records.
Only one authorized checkout can settle the same obligation at a time.

Version 1 supports same-store transfer, compatible certified modes and explicit
customer/price/warehouse checks. Cross-store fulfillment, cross-company orders,
automatic currency conversion, concurrent offline collaborative editing and
moving already captured money to a different register are outside scope.

Cash responsibility and orders are separate: changing who edits an unpaid
order does not move a shift, float, posted sale, payment or bank settlement.

## 2. Existing sources and ownership

Reuse [POS Table Order](../../../posawesome/posawesome/doctype/pos_table_order/pos_table_order.json),
[sales-order endpoints](../../../posawesome/posawesome/api/sales_orders.py),
[quotation endpoints](../../../posawesome/posawesome/api/quotations.py),
existing invoice drafts and the versioned charge-request seam from source apps.
The current [table terminal assertion](../../../posawesome/posawesome/api/shift_terminal.py)
requires a shift; enabling true order-only devices requires an explicit new
order-writing authorization path. A fake zero-float selling shift is not a
substitute for that distinction.

`POS Work Ticket` is a proposed coordination envelope linking one canonical
source and settlement scope. It does not copy the source into a second order
ledger. Fields: company/store, source doctype/ID/account, source version,
origin actor/device, current editor assignment, claim generation/expiry,
destination preference, workflow state, checkout attempt reference, revision,
return context and completion references. Unique source/account identity avoids
creating multiple active envelopes for the same obligation.

Source adapters expose `read`, `validate_edit`, `apply_edit`, `quote_checkout`,
`reserve_if_supported`, `settle` and `describe_next_action`. An unsupported
adapter is read-only or hidden with explanation, never a generic write-through.
Canonical row IDs and source version must survive handoff.

## 3. State and ownership

| Work-ticket state | Meaning | Transition authority |
| --- | --- | --- |
| Editing | One editor can change the unpaid source | Source adapter plus edit claim |
| Parked | No active edit claim; source saved | Source adapter |
| Offered | Named caja/person has been offered continuation | Handoff command |
| Claimed | Recipient owns current edit generation | Atomic claim |
| CheckoutPending | One canonical checkout attempt has reserved settlement | Payment/submission service |
| OutcomeUnknown | Financial outcome is unresolved | Canonical recovery only |
| Completed | Source settlement confirmed and linked | Owning source/settlement callback |
| Cancelled | Unpaid obligation cancelled by allowed source action | Source owner |

Partial payment returns a still-open source to its appropriate source state,
with immutable payment references and a remaining balance. Each later tender
is a new attempt against that confirmed balance, not a restart of the old one.

**ORD-01:** Edit ownership uses generation plus source revision. It may expire
after 120 seconds of missing renewal (renew every 30 seconds while editing),
but only if no checkout/financial uncertainty exists. Expiry permits a new
online edit claim; it never transfers payment or terminal possession.

**ORD-02:** Checkout ownership has no timeout-based takeover. Unknown payment
must resolve before another register can charge the same obligation.

**ORD-03:** All source writes, including Desk/REST/other apps, must respect the
canonical revision/settlement guard. Securing only the POS UI is insufficient.

**ORD-04:** The paid document records the register, shift, device and cashier
that actually collected payment. Originating salesperson/waiter/technician
attribution is preserved separately for audit and attribution rules.

## 4. Main worker journeys

### Phone to counter

1. Employee signs into an enrolled order-only device assigned to the store.
   They can browse/create orders but cannot accept cash or open a drawer.
2. Add customer/items and save through the canonical source adapter. The UI
   distinguishes locally saved intent from a server-visible saved order.
3. Select **Enviar a caja**, choose an eligible destination or “Próxima caja”,
   and optionally add a service note. A short pickup code/QR identifies the
   ticket without containing PII, authority or payment credentials.
4. Cashier's queue shows the order and origin. They accept it atomically; the
   phone becomes read-only for that generation. Both see who has the order.
5. The destination revalidates price, tax, inventory, customer credit, source
   eligibility and its own payment configuration. Any change is shown before
   collection with a fresh total and required acknowledgment.
6. Pay through the existing submission/processor path. Successful settlement
   links to the original record; the phone/mesas/repair queue updates once.
7. Receipt and next service/fulfillment action are accessible. Return to the
   destination queue preserves position; source app is not silently navigated away.

### Park and resume elsewhere

Park saves the unpaid source, releases edit ownership and preserves customer,
line identities, notes, reservation expiry and quote policy. Another authorized
caja searches within the store, claims and revalidates it. A local-only unsynced
cart cannot truthfully appear on another device until its source is accepted.

### Partial account/table checkout

The canonical account determines payable lines/quantities and remaining value.
Claim settlement at the account or smallest independently payable obligation,
with source version and remaining-balance check. Two devices cannot both settle
the same quantity or credit allocation. Existing table split/merge invariants
remain in the source adapter; the envelope cannot invent its own balance.

## 5. Pricing, stock and source context

A handoff offers only destinations in the same company/store and a compatible
mode. POS Profile compatibility is explicit, not merely equal profile names.
Destination warehouse must be permitted for the source/fulfillment route.

Quotation price locks, promotions, discounts and approvals follow their owning
rules. Uncommitted retail baskets reprice according to the current permitted
policy; display old/new totals and reasons. A changed total invalidates amount-
bound approval and any unconfirmed tender entry. Never silently reuse a payment
authorization for a different amount or invoice. Price changes do not mutate
already settled lines.

Parking is not stock reservation unless the source adapter actually owns a
reservation with expiry and release semantics. Show “Availability last checked”
or a true reservation reference. Checkout revalidates stock and serial/batch
requirements. Transfers preserve source records for repairs, deposits, loyalty
and fiscal identity without copying stale balances into the payment form.

## 6. APIs and concurrency

| Logical action | Preconditions | Durable result |
| --- | --- | --- |
| `tickets.park` | Current editor/source revision; no financial attempt | Saved source and released edit claim |
| `tickets.offer` | Eligible source/destination; compatible scope | Offered continuation with original ownership history |
| `tickets.claim` | No incompatible active claim/checkout; current revision | New editor generation and canonical source snapshot |
| `tickets.renew/release` | Current editor generation | Updated lease or release |
| `tickets.checkout` | Own selling shift/terminal; validated source quote | One attempt bound to source revision, amount and destination |
| `tickets.status` | Source and store read permission | Work state, source freshness, claim and outcome references |
| `tickets.recover` | Source-specific supervisor authority | Canonical attempt inquiry/recovery; no generic paid flag |

Use the common request protocol in 01. Claim/checkout locks the coordination
aggregate and canonical source after register/shift locks when those are needed,
and before any safe/accounting resources. Payment services and source hooks
must share this order. Checkout uses unique settlement-attempt identity plus
database locks, not a UI-disabled Pay button or a volatile Redis lease alone.

External payment calls run outside long DB locks after persisting their intent.
Provider callbacks map to the original attempt and are authenticated, deduped
and checked for amount/currency/merchant identity. The source moves to Completed
only when canonical settlement confirms it; a successful web request is not
enough. A compensation/refund remains a linked financial action.

Indexes cover `(store, state, destination, modified, id)`, unique source/account,
claim generation, unresolved attempt and source revision. Queue pages are capped
at 100; only visible or subscribed tickets receive realtime deltas. Hot table
accounts serialize their own mutations, not the whole restaurant/store.

## 7. Permissions and privacy

Order-only capability is scoped independently of selling and cash. It cannot
create invoices marked paid, request a drawer kick, bypass terminal proof or
execute custody commands. A cashier needs both source eligibility and their
own register authority to collect. Regional read access does not imply edit.

Pickup codes are opaque, rate-limited and scoped; possession alone grants no
access. A QR is a locator, not an authentication bearer. Source attachments and
customer details follow their owner permissions. Reassignment records both
actors and cannot overwrite original sales attribution.

## 8. Offline and failures

Offline order edits are local intents only under the certified mode's policy.
Cross-device offer, claim and checkout require online authority. If an editor
goes offline and its claim later expires, its saved changes remain a separate
conflicting intent. On reconnect the server refuses stale generation writes,
shows differences and allows deliberate reapplication to a fresh unpaid version.
No last-write-wins overwrite of a completed or changed order is allowed.

Lost handoff/claim replies are resolved by receipt lookup. A declined offer
returns the work to Parked/original editor as an explicit transition. A closed
destination caja makes the offer reroutable; it does not move payment attempts.
When payment is uncertain, both devices see the same locked financial state
and the same recovery case from spec 06.

## 9. Migration and rollout

Adapt one source at a time: unpaid retail drafts first, then table accounts,
then versioned vertical charge requests. Do not bulk wrap historical completed
orders. Create envelopes on first eligible use with source uniqueness guards.
Existing source APIs remain compatible but gain server-side revision guards.

Enable only on migrated stores with compatible client versions. Original
single-device offline work can finish through the existing route; it is not
automatically imported into a shared queue. Rollback hides new offers while
preserving existing claims, checkout recovery and source settlement support.

## 10. Acceptance

| ID | Required evidence |
| --- | --- |
| ORD-T01 | Phone → Caja 1 preserves customer, line IDs, notes and source; one payment and one source completion result. |
| ORD-T02 | Two cajas claiming/charging the same obligation yield one allowed checkout; losing UI explains ownership. |
| ORD-T03 | Expired edit lease allows safe re-edit but never takeover of an unknown payment. |
| ORD-T04 | Stale offline edits cannot overwrite another cashier's changes or a completed order. |
| ORD-T05 | Repricing/stock change is shown and confirmed before payment; stale amount-bound approval is invalidated. |
| ORD-T06 | Split/partial table payments cannot settle the same lines, quantities or balance twice. |
| ORD-T07 | Closed destination can reroute an unpaid offer while preserving origin attribution. |
| ORD-T08 | Lost replies and repeated provider callbacks produce one settlement and consistent source state. |
| ORD-T09 | Cross-store/company/warehouse or incompatible-mode offers fail safely. |
| ORD-T10 | Order-only credentials, copied pickup code and QR cannot authorize cash or source access. |
| ORD-T11 | Desk/source-app edits obey the same revision and settlement guard as the POS. |
| ORD-T12 | Large store queue, mobile handoff and adapter outage meet specs 02, 06 and 09. |

Measure successful handoff completion, time to collection, stale-edit conflicts,
abandoned offers and duplicate-prevention incidents. Do not claim omnichannel
support from this same-store contract alone.
