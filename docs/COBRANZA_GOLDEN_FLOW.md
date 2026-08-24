# Cobranza — the payments ops panel: the golden flow

Status: acceptance contract for the 2026-08-24 cobranza round
Companion: artboard `Cobranza.dc.html` (new). Owner direction: "the one we
have works but is not that obvious and you have to manually search each
time; a reminder or list would be great — more like a payments ops panel,
not just a tool but a toolbox."

The current «Payments» destination is `PayView.vue`: a capture tool you must
FEED — search a customer, search an invoice, every time. The toolbox
inverts it: **the worklist is the surface; search is a refinement; capture
is one tap from a row.**

## 1. The panel (artboard)

- **Buckets** (tabs with counts): «Vencidas» · «Por vencer» (due ≤7 días) ·
  «Todas por cobrar» · «Cobrado hoy». Default lands on Vencidas when it has
  rows, else Todas.
- **Stats row**: Por cobrar (total outstanding) · Vencido (overdue total) ·
  Cobrado hoy (today's collected). One glance answers "how are we doing".
- **List row**: folio · cliente · fecha · vence (aging chip: «hace N días»
  red for overdue, «en N días» otherwise) · total · **pendiente** (the
  number that matters, bold) · estado (Partly Paid = apartado-shaped).
  Keyboard ↑↓/Enter like the ledger family. Search box filters folio or
  cliente — a refinement of the visible bucket, never the entry gesture.
- **Detail panel** (selected row): customer + contact chip, the invoice's
  lines summary, payments received so far (date · mode · amount), and:
  - **COBRAR** (primary): opens the EXISTING payment capture pre-filled
    (invoice, customer, outstanding as the amount) — reuse `PayView`'s
    capture path, do not rebuild it. On success the row updates in place
    (or leaves the bucket if settled).
  - «Recordatorio» (secondary): files a CRM **seguimiento** for the
    customer through the existing crm bridge (the passive+seguimiento rail
    from the CRM round) with the invoice folio and pendiente in the note —
    this is the "reminder" half of the ask.
  - «Estado de cuenta» (secondary): print of the customer's open items
    (may ship as a stub chip that says it isn't built — say so on screen).
- **«Cobrado hoy» bucket**: today's Payment Entries for the company
  (date · cliente · mode · amount · reference), with the day total — the
  reconciliation half of the toolbox.

## 2. Backing

- New read model `api/receivables.py` (no writes):
  `get_receivables(pos_profile, bucket, search)` — submitted Sales
  Invoices (and POS Invoices where that mode is on), company-scoped,
  `outstanding_amount > 0`, aging computed server-side off due_date
  (fallback posting_date); `get_collected_today(pos_profile)` — today's
  submitted Payment Entries (Receive, company); `get_receivables_badge`
  — the overdue count for the rail. All gated on register membership
  (the standing `_scope.assert_profile` pattern); plain field lists (the
  417 trap); capped with the cap stated.
- **Rail badge** = overdue count (`badgeSource` beside
  `floorOpenOrdersCount`'s pattern) — the panel reminds before it is
  opened; that is what makes it an ops panel.
- Deposits/monedero: a customer's available credit renders as a chip in
  the detail («tiene $X en monedero») so the cashier collects smarter —
  read from the existing `get_available_credit`, absence-not-zeros.
- Partly-paid invoices are the apartado shape: this panel is where
  apartados stop being invisible.

## 3. Guardrails

- The panel records nothing itself — capture stays the one existing,
  validated path. No new money-write surface.
- Online-only (`online_required` stays); refusals in Spanish.
- Registers keep today's behavior until the surface ships; the
  destination id stays `payments` (the rail label may become «Cobranza»).

## 4. Acceptance (mirror or demo, browser)

1. Open the destination → land on a POPULATED bucket, zero typing.
2. Overdue badge on the rail equals the Vencidas count.
3. Pick a row → COBRAR → capture arrives pre-filled → record a partial
   payment → pendiente updates, row stays (partly paid); record the rest
   → row leaves; «Cobrado hoy» shows both entries and the day total.
4. «Recordatorio» on a row → seguimiento visible in CRM for that customer
   (idempotent like the CRM round's).
5. Search narrows the bucket by folio and by customer name.
6. A register whose company has nothing outstanding shows an honest empty
   state, not a search box demanding input.
