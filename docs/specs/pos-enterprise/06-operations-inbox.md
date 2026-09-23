# 06 — Operational pending-work inbox

Status: specified; not implemented. Version 1, 2026-09-22.
Owner: POSAwesome experience and case orchestration; source apps own resolution.
Requires [01](01-store-register-foundation.md); integrates specs 03–05, 07 and 08.

## 1. Outcome

Employees see what needs attention, why it matters, who owns it and the next
safe action. A manager can resolve a lost payment response, an unsynced sale,
a disputed bag or a failed receipt without navigating several unrelated status
panels. Regional users can find aging store problems without seeing private
customer data or receiving a notification for every retry.

The inbox is an operational projection over canonical business records. It
does not replace payment attempts, the offline queue, cash evidence, fiscal
documents, repair orders or the accounting ledger. Marking a case “done” must
never turn an uncertain payment into a successful payment.

## 2. Existing integration points

Reuse [offline submission reconciliation](../../../posawesome/posawesome/api/offline_sync/invoices.py),
[terminal invoice recovery](../../../frontend/src/posapp/components/navbar/TerminalInvoiceRecovery.vue),
[closing recovery](../../../frontend/src/posapp/components/pos/closing/ClosingRecovery.vue)
and [custody commands](../../../posawesome/posawesome/api/cash_custody/service.py).
Fiscal status comes from the installed compliance app, top-up status from Saldo,
provider outcomes from their connectors, and repair obligations from Taller.
An unavailable/uninstalled adapter is reported explicitly; absence is not a
successful empty queue and must not prevent unrelated supported functions.

## 3. Case model

`POS Operational Case` fields: opaque ID; case type; source doctype/ID; source
episode/generation; company/store/register/shift; subject summary; severity;
financial completeness impact; state; accountable team/person; due policy;
first/last observation; source revision; projection revision; correlation IDs;
related cases; safe next actions; resolution evidence; reopen history.

Unique dedupe key is `(adapter, source identity, failure class, episode)` within
the tenant. Repeated retries update observations, not new cases. A recurrence
after true source resolution creates a new linked episode. Each case has an
append-only activity stream for assignments, observations and source outcomes.
Sensitive customer/amount fields are projected only under their own capabilities.

| Type | Canonical owner | Default responsible role | Resolution proof |
| --- | --- | --- | --- |
| Payment outcome unknown | Provider attempt/connector | Cashier plus supervisor | Provider/receipt inquiry establishes outcome or authorized recovery |
| Invoice intent rejected/unsynced | Submission ledger and original local queue | Original cashier; supervisor on escalation | Canonical submission or explicit preserved rejection disposition |
| Terminal replaced with unknown work | Shift ownership recovery | Store supervisor | Reviewed old device evidence or disclosed loss determination |
| Cash transfer/bag discrepancy | Custody records | Independent reviewer | Count and linked posting/receipt obligations settled |
| Shift/day close blocked | Closing/day source records | Store manager | Canonical blocker removed and close succeeds |
| Receipt print failed | Print job | Cashier or equipment lead | Print delivery acknowledgment or explicit nonfinancial disposition |
| Fiscal submission/cancellation failed | Compliance app | Fiscal-authorized staff | Owning fiscal transition; POS cannot fake it |
| Repair/top-up integration pending | Owning app/charge request | Source workflow owner | Source-confirmed settlement/fulfillment |
| Device readiness failure | Device check record | Store equipment lead | Fresh valid check or authorized supported alternative |

## 4. State and severity

Case state is `Open`, `Assigned`, `InProgress`, `WaitingExternal`, `Resolved`
or `Superseded`. Reopened is an event leading back to Open, preserving earlier
resolution evidence. “Snoozed” is an assignment/reminder property, not resolution.

Severity values:

- Critical: possible duplicate/cross-scope money, compromised device or integrity
  failure. Route to supervisor/support immediately; affected action may be blocked.
- Blocking: current sale/handover/reconciliation cannot safely continue.
- Action needed: owned work can continue elsewhere but has a required follow-up.
- Informational: nonfinancial follow-up without false red-alert urgency.

Default acknowledgment targets are immediate for Critical, 15 minutes for
Blocking during staffed hours, two hours for Action needed, and next staffed
shift for Informational. They are internal service targets, not contractual
SLAs. Tenant policy supplies staffing calendars and escalation contacts. Age is
shown in wall time as well as staffed time. Overdue status never auto-resolves.

## 5. Employee workflows

1. A failed/interrupted action shows its immediate recovery state and a link to
   one case; the employee's cart/form remains intact.
2. **Pendientes** opens with “Míos” or “Esta tienda”, severity and age filters.
   Rows explain the business issue (“Verificar si se cobró $…”) before any
   technical error code. Blind-count restrictions still apply.
3. Opening the row shows timeline, known/unknown facts, linked source and one
   recommended action. “Check result” is distinct from “Try a new charge”.
4. The owning action runs with its own permissions/idempotency. Return restores
   the inbox cursor/filter/selection and the original selling task if requested.
5. The case resolves only after its adapter observes canonical resolution.
   “Action accepted” shows progress, not a completed case.

Managers can assign/escalate cases and add notes. Assignment does not grant
source permissions. Regional leads can hand a case to a scoped store team;
they cannot make a cashier from another company responsible for its money.
Bulk assignment is bounded and audited; bulk financial resolution is absent.

## 6. Adapter and API contracts

Each installed adapter implements:

| Operation | Required output |
| --- | --- |
| `observe(source_revision)` | Stable source identity/episode, facts, severity, scope, coverage and owner hint |
| `describe_actions(actor)` | Typed allowlisted action IDs, prerequisites, disabled reasons and safe route context |
| `execute(action, receipt)` | Delegation to canonical business command; no generic “set status” |
| `verify_resolution(source)` | Resolved/unresolved/unknown plus authoritative evidence references |
| `reconcile_page(cursor)` | Bounded sweep to recover missed observations after outage |

Logical inbox endpoints: `cases.list`, `cases.detail`, `cases.assign`,
`cases.note`, `cases.snooze`, `cases.execute`, `cases.export` and `cases.coverage`.
They use spec 01's scoped queries and command receipts. `cases.execute` validates
action membership against the installed adapter; it never executes a client
supplied dotted Python method or arbitrary URL. Revision conflicts preserve notes.

List responses include adapter coverage: last successful observation, backlog,
disabled reason and freshness. Overall “all clear” requires complete coverage
for required server adapters plus the device-known-work statement. Unknown local
queues cannot be inferred from server case counts.

Outbox events drive updates; adapter sweep jobs repair omissions. Job uniqueness
and idempotent upserts prevent duplicates. A case transition and notification
intent commit together; notification transport failure does not undo resolution.
Rebuild must recreate active cases without resending historical alerts.

## 7. Retry and notification policy

Classify actions as safe inquiry, idempotent retry, human decision or prohibited
automatic retry. Safe inquiry can back off with jitter: 5 s, 15 s, 60 s, then
up to 5 minutes, respecting provider limits and Retry-After. A fixed retry budget
escalates to WaitingExternal; it does not discard the obligation. External capture
is never retried with a new key solely because the original timed out.

Notify on first actionable occurrence, material severity change, reassignment
and escalation deadline, deduped by event/recipient/channel. Group repeated
equipment/provider incidents into an incident summary while keeping individual
financial source cases. Do not put PINs, payment secrets, full customer PII or
blind-count amounts into notifications.

In-app notifications are the baseline. Email/WhatsApp or other staff channels
require configured recipients, appropriate tenant authorization and delivery
policy; installing this feature does not silently enable outbound messaging.

## 8. Scope, retention and scale

Authorization is applied to rows, search facets, total counts, action descriptors,
source links, realtime and exports. Linked cases do not reveal inaccessible
stores. Support access follows the audited, time-limited policy in spec 09;
platform staff have no implicit permission to take financial actions.

Indexes: `(store, state, severity, due_at, id)`, `(assignee, state, due_at, id)`,
unique dedupe key and `(adapter, source_id, episode)`. Active cases and bounded
recent history have separate access paths; do not scan millions of resolved
episodes for a cashier badge. Lists use cursor pagination and incremental counts.

Queue capacity is separated from sale posting. Provider failure across 5,000
registers must not flood synchronous checkout with repeated recovery inquiries.
Per-tenant, adapter and provider concurrency limits provide fair progress;
Critical work can receive priority without starving durable sale submission.

Resolved case retention follows source financial/fiscal evidence retention and
legal hold. Operational PII may be minimized while preserving required audit
references. No cleanup deletes unresolved cases or dedupe identities still
needed to prevent replay. Export includes snapshot and permission version.

## 9. Failure and migration

Offline UI shows cached cases plus this device's local pending work as separate
sources. Local drafts/notes can be retained but source resolution needs online
authority. A down adapter produces “State unavailable” and a next contact/action,
not a resolved case. An export timeout is resumable with one operation ID.

Backfill current unresolved source records in bounded, checkpointed batches.
Do not import all historical errors as new urgent cases or send an alert storm.
Initially run in shadow mode and compare source counts, then enable read-only
inbox, then canonical actions, then configured escalation. Existing recovery
entry points remain until equivalent employee journeys are proven.

## 10. Acceptance

| ID | Required evidence |
| --- | --- |
| OPS-T01 | Lost payment response creates one case; inquiry confirms one payment; no second capture occurs. |
| OPS-T02 | Repeated event delivery, missed events and restart converge to the correct active case set. |
| OPS-T03 | Resolved source followed by a new failure creates a linked episode with preserved history. |
| OPS-T04 | A generic “resolve” request cannot settle payment/cash/fiscal obligations. |
| OPS-T05 | Adapter outage and unknown local queues prevent a false all-clear statement. |
| OPS-T06 | Assignment, escalation and copied URLs cannot expand store or source-action permissions. |
| OPS-T07 | Bulk provider outage is bounded, deduplicated and does not starve sale posting. |
| OPS-T08 | Blind-count and customer privacy survive badges, notifications, exports and linked cases. |
| OPS-T09 | Notes and return context survive revision conflict, refresh and round-trip to the owning app. |
| OPS-T10 | Shadow backfill creates no duplicate obligations or historical notification storm. |
| OPS-T11 | A lost case-action response resolves via its original receipt and canonical source. |
| OPS-T12 | Mobile, keyboard, screen-reader and large-tenant queries meet specs 02 and 09. |

Measure oldest unresolved obligation, time to acknowledged ownership, source
recovery success, recurrence and false-positive rate. “Fewer open cases” is not
a success metric unless the canonical obligations actually resolved.
