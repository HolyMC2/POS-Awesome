# Phase 5 Audit — Offline-first mutations + queue

Status snapshot taken 2026-05-12 before opening any new code on Phase
5. Goal: figure out which 3-SIGMA Phase 5 sub-tasks are already
shipped, which are partial, which are missing, and what an honest
3-day landing plan looks like.

## What 3-SIGMA Phase 5 calls for

> 1. All write operations (submit, cancel, return) go through
>    `offlineSyncStore`'s outbox.
> 2. SW intercepts the request; on success, ACK to the SPA. On
>    failure, queue + retry with backoff.
> 3. SPA shows "pending sync" indicator; operator can keep working.
>
> Risk: medium — duplicate-submit prevention requires idempotency
> tokens server-side (`posawesome/posawesome/api/invoices.py` needs
> `idempotency_key` columns on Sales Invoice).

## What already exists

| Piece | Status | Evidence |
|---|---|---|
| Server idempotency for submit | **Done** | `posa_client_request_id` Custom Field on Sales Invoice, POS Invoice, Payment Entry. `submit_invoice` in `creation.py:939` consults the **POS Submission Ledger** doctype + `find_invoice_by_client_request_id` to short-circuit replays. Unit-tested in `test_creation.py:1141..1382`. |
| Outbox doctype (client-side) | **Done** | `frontend/src/offline/invoiceOutbox.ts` — 260 LOC. `enqueueInvoiceOutboxEntry`, retry-with-backoff (5 attempts, 5 s → 5 min), terminal states (`acknowledged`, `dead_letter`). |
| Outbox doctype (server-side) | **Done** | `posawesome.posawesome.api.offline_sync.invoices` accepts the queued payloads + writes Sales Invoice / Payment Entry while honoring `posa_client_request_id`. |
| Outbox writer for invoice submit | **Partial** | `saveOfflineInvoice` in `frontend/src/offline/invoices.ts:214` calls `enqueueInvoiceOutboxEntry` — but only when `shouldWriteInvoiceOutbox()` returns true. That's gated by the `invoice_outbox_mode` setting (`off / dual_write / coordinator`). Default is **`off`** in lab. |
| Pending-sync indicator | **Partial** | `syncStore.pendingInvoicesCount` exists; the navbar shows "View offline invoices (0)" — but the count only reflects the *legacy* offline queue, not the outbox. |
| SW interception of writes | **Missing** | `posawesome/public/sw.js` (post-Phase 1.G) intercepts only navigation + asset GETs. POS API POSTs flow direct to network. |
| Outbox routing for cancel | **Missing** | `cancel_invoice` in `actions.ts:139` calls `posawesome.posawesome.api.invoices.delete_invoice` directly via `frappe.call`. No retry, no outbox. |
| Outbox routing for sales return | **Missing** | Sales return is an `is_return` invoice — it goes through the same `submit_invoice` path so it inherits idempotency, but the outbox-mode gate above still applies. |
| Cancel idempotency | **Missing** | No `posa_client_request_id` lookup in `delete_invoice`. A second cancel after a network blip will throw "DoesNotExist" instead of returning the prior result. |

## Gap → ordered backlog

A. **Flip default outbox mode to `dual_write` on opt-in shops** (~1 h)
   - Add a flag check + telemetry; no schema change.
   - Lets the outbox warm up against real load before becoming
     authoritative.

B. **Wire cancel through outbox** (~3 h)
   - Add `posa_client_request_id` consultation to `delete_invoice`
     so a replayed cancel returns the prior result instead of
     throwing.
   - `cancel_invoice` action generates a client_request_id, calls
     a new `enqueueCancelOutboxEntry` helper, marks the cart cleared
     optimistically, then resolves via the outbox ACK.

C. **Pending-sync indicator wired to outbox** (~2 h)
   - `syncStore` reads `invoice_outbox` table size + the legacy
     queue, sums them, exposes via the existing badge.
   - Tooltip lists the per-status counts (`pending`, `retrying`,
     `dead_letter`).

D. **SW interception of POS writes** (~1.5 d)
   - New `frontend/src/sw-outbox.ts` (referenced in 3-SIGMA but
     never created).
   - SW listens for fetch events whose URL matches a small allowlist
     (`submit_invoice`, `delete_invoice`, `update_invoice`).
   - On `navigator.onLine === false` OR fetch error → enqueue +
     respond 202 with `Retry-After`.
   - On success → ACK message to the SPA via BroadcastChannel.
   - Most-bug-prone slice; needs careful test coverage in the
     existing `frontend/tests/sw.spec.ts`.

E. **Dead-letter operator UI** (~2 h)
   - List, retry, discard. Reuses Invoice Management drawer space.
   - Today the outbox can stuck a payload at `dead_letter` with no
     way to surface it.

## Risks the audit clarified

1. **Double-submit on the existing partial wiring**: when
   `invoice_outbox_mode = dual_write`, the SPA writes both to the
   write queue AND the outbox. Server-side
   `find_invoice_by_client_request_id` should dedupe — but it only
   runs on `submit_invoice`. If two clients race a `delete_invoice`,
   the second one currently throws.
2. **Outbox ACK timing**: today the outbox is poll-driven from
   `syncStore`. Phase 5's "operator never sees a transient-failure
   screen" requires the SPA to know within ~1 s if the network
   recovered. A push channel (BroadcastChannel from SW) is part
   of D, not free.
3. **Dead-letter is silent**: an outbox entry that exhausts retries
   today logs to console and stays in IDB forever. Operators won't
   notice. E above is a hard prerequisite for declaring Phase 5
   "shipped".

## Honest landing plan

| Day | Tasks |
|---|---|
| 1 | A + B (1 h + 3 h) — small, ships immediate value, low risk |
| 2 | C + start D (2 h + ~6 h on SW write-intercept skeleton + spec coverage) |
| 3 | Finish D + E (~6 h SW happy path / 2 h dead-letter UI) |

If a 3-day window isn't available, the *minimum viable Phase 5* is
**A + B + C** (~6 h total, 1 day). It hardens the existing path and
surfaces the correct pending count without committing to the SW
interception layer. D + E can land in a follow-up phase.

## Files most likely touched (per task)

- A: `posawesome/posawesome/api/offline_sync/bootstrap.py`,
  `frontend/src/posapp/stores/offlineSyncStore.ts`.
- B: `frontend/src/posapp/components/pos/invoice_utils/actions.ts`,
  `frontend/src/offline/invoiceOutbox.ts` (extend for cancel
  payloads), `posawesome/posawesome/api/invoices.py:delete_invoice`.
- C: `frontend/src/posapp/stores/syncStore.ts`,
  `frontend/src/posapp/components/Navbar.vue`.
- D: new `frontend/src/sw-outbox.ts`,
  `posawesome/public/sw.js`, `frontend/tests/sw.spec.ts`.
- E: `frontend/src/posapp/components/pos/flows/InvoiceManagement.vue`.

## Recommendation

Spawn one coder agent per task. A + B can run sequentially in one
session (single small commit each). D should be its own dedicated
session given the SW debugging cost.

Do not start Phase 5 implementation without first deciding the
outbox-mode default. If Doco prod is going to stay on `off` for
another quarter, only A + part of C are worth shipping today.
