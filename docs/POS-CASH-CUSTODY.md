# Cash custody implementation and acceptance

Status: implemented and verified in the lab; production rollout pending. Owner direction: one safe, one drawer, staff prepare and receive floats; owner reviews exceptions. Never infer verification from physical placement.

Reference: [Oracle Xstore 25 Store Safe Maintenance](https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/25.0/rpxmg/store-safe-maintenance.htm) uses unique Safe Bag IDs and counted/undeclared states; [Dynamics Commerce](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt) uses paired cash movements and bank bag references. Bags are containers, not additional ledger balances.

## Contract

- Safe ledger is existing Back Office Cash Account; preparation reserves loose safe cash without posting income or a transfer.
- Drawer receipts/drops reuse POS Cash Movement and its submitted Journal Entry.
- Initial bag receipt opens with zero opening float and posts Cash In, once. Never count the same float in opening balance AND Cash In.
- Every physical package has a unique seal ID and immutable count evidence. Opened packages are consumed; a new package uses a new ID.
- States: Unverified → Available (independent verification), Disputed (mismatch), Issued (received into drawer), In Transit → Deposited (bank reference), Unpacked (returned to loose safe funds).
- Cashier can count their drawer, return it in bags, receive an available bag, and see their register's custody queue. Supervisor verifies another person's counts and resolves discrepancies. No self-verification.
- A transfer command has a required request ID + payload fingerprint. Replay returns its original result; changed payload is refused. Safe row lock serializes balance reservation; shift lock precedes safe lock for drawer operations.
- Counts use exact minor units and retain denominations/manual override reasons. Saved draft counts use optimistic concurrency. Final counts are immutable; review adds a separate audit event and reason.
- Closing snapshots the pre-drop count, drops the allocated cash exactly once, and closes with actual remaining drawer cash. Expected cash is rederived after movements; differences remain visible. Normal closure does not wait for later independent safe verification.
- In-transit bank cash remains on a separate asset account until bank confirmation; receipt posts transit → bank. Corrections have linked compensating entries and reasons.
- Permissions apply through business endpoints AND Desk/REST. Generic document writes cannot forge history. Company/profile/currency/account matching is server-validated.
- Online mutations only; interrupted responses retain request IDs and offer retry. Offline counts remain drafts, never claim a completed cash transfer.

## Required acceptance

1. Prepare 1,000 from funded safe → cashier receives → Cash In and opening expected cash reflect 1,000 once.
2. Sell/refund/expense → denomination count → split float/takings → return drawer to zero → closing preserves variance and count evidence.
3. Next cashier receives new float; previous closing remains immutable and linked.
4. Independent bag verification; discrepancy/recount/review; pending verification never silently becomes available.
5. Safe count reconciles loose cash + physical bags, excluding issued and in-transit bags; shortage review retains evidence.
6. Dispatch bag → transit asset → bank receipt; cancellation returns cash through compensating entry.
7. Concurrent claims/reservations, duplicate request IDs, lost responses, stale edits, forbidden roles, cross-profile/company IDs, self-verification, direct REST tampering and invalid quantities fail safely.
8. Complete real lab journey with GL/stock/payment boundaries checked; browser-mocked tests explicitly identified.

## Shop setup and daily operation

Create one **POS Cash Safe** from Desk for the physical safe/register pair. Configure five distinct company-currency ledger accounts: drawer cash, safe cash, bank transit (asset), bank, and cash over/short (expense). The profile's Back Office Cash Account must be the safe; its default source must be the drawer. Fund the safe through the normal accounting process, not by inventing a custody balance. Activation requires no open shift and a reconciled, empty drawer account. Float target and drawer cash limit are guidance; the latter is not a sales-blocking limit. The cash-custody screen checks the current shift against that limit on entry and refresh. Above the limit it suggests returning enough to retain the configured float target (or the limit when no lower target is configured). The suggestion uses the same expected-cash calculation as closing, never fills a physical count, and is hidden completely for blind-count profiles. Completing a return refreshes it.

1. Supervisor counts loose safe cash into the initial float bag, assigns a unique seal ID, and prints handover evidence if needed. Preparation reserves existing cash; it does not create money.
2. Cashier opens the empty drawer with zero and is sent to Cash custody. Select the float bag, physically count it, and receive it. Another person's unverified bag can be verified by this receipt. A cashier cannot self-verify a bag they prepared.
3. Sales, refunds and cash expenses continue through their existing POS workflows. Excess cash can be counted, sealed and returned to the safe during the shift.
4. At closing, save the drawer denomination count (or an explained manual total), divide it into the next float and takings bags, and assign seals. All cash must be allocated. One close transaction records the pre-drop count, bag deposits, journals and closing. A note is required for a variance.
5. The next cashier independently receives the next float. A supervisor handles disputed bags and cash differences; routine handover does not need the owner to prepare another bag each shift.
6. A supervisor verifies takings, dispatches verified bags to the bank, then confirms the bank reference. A failed trip uses Return undeposited bag; it reverses transit through a new journal and requires verification again.

| Action | Debit | Credit |
|---|---|---|
| Prepare a safe bag | No posting; reserve loose cash | — |
| Receive float | Drawer | Safe |
| Return/drop bag | Safe | Drawer |
| Dispatch to bank | Transit | Safe |
| Confirm bank receipt | Bank | Transit |
| Confirm shortage | Cash over/short | Affected cash account |
| Confirm overage | Affected cash account | Cash over/short |

A physical zero drawer with an unreviewed shortage can temporarily have a ledger residual. The closing count exposes it; independent review posts the separate correction. Counts, original bag preparation, both movement links, and review events remain available as evidence.

### Recovery

- **Unconfirmed response:** retry the saved request. Never move the physical cash again solely because the browser showed a network error. POS lists unconfirmed actions after reload; successful replay returns the original transfer.
- **Wrong count / disputed bag:** the receiving drawer is unchanged. Supervisor independently reviews the difference or recounts. An older count cannot override a newer bag/safe count.
- **Another window changed the draft:** reload its saved count before editing. Do not overwrite it with a stale timestamp.
- **Concurrent preparation:** the safe is serialized; read-only lock conflicts retry automatically, and the loser receives an ordinary insufficient-loose-cash refusal if funds have been reserved.
- **Printer unavailable:** custody remains recorded. Use the printable evidence later; printing is not the cash transaction.

## Verification evidence — 2026-09-15

Lab only, isolated `Custody QA` profiles/accounts/users on `doco-mirror.lab.xoloitzcuintles.com`. No production custody configuration changed.

- Native Frappe/ERPNext drill: 32 assertions for sale, actual refund, replacement sale, expense, drops, closing, next cashier, bank transit/return/receipt, bag discrepancy, permissions, stale edits, replay, print evidence and journal-cancellation protection.
- Drawer-shortage variant: 34 assertions, including preserved closing amount, outstanding variance, independent review and reconciled drawer GL.
- Two independent database transactions competing for the same loose safe cash: exactly one reservation; the other receives ValidationError after automatic read-only lock retry. Final loose balance equals starting balance minus one bag.
- Existing cash movement/safe transfer/closing regressions: 54 passing tests.
- Frontend request recovery plus closing/recovery/navigation regressions: 104 tests (one old source assertion updated to cover the opt-in opening destination).
- Count arithmetic: five tests, including manual-count serialization round trip and invalid/non-finite/fractional input rejection.
- Type-check and Vite production build via guarded lab refresh.
- Guarded migrations completed without orphan deletion. Complete logs retained under `/tmp/migrate-doco-mirror.lab.xoloitzcuintles.com-20260915-*.log`.

Reproducible lab helpers: `posawesome.posawesome.api.cash_custody.lab_drill.run()` (rollback by default; `drawer_shortage=10` tests variance), `lab_concurrency.run(profile,user)` (commits isolated QA reservations), and `frontend/tests/e2e/cash-custody-*-lab.mjs` (real lab HTTP/browser workflows). Browser credentials are deliberately kept outside the repository in a mode-0600 temporary fixture.

Scope: one safe/register pair, online financial actions, company currency with two decimal minor units. No bank API confirmation is inferred; a supervisor records the bank receipt. Lab QA cash entries are clearly labeled and are not production operating balances.

Final browser evidence (`/tmp/cash-custody-e2e/`):

- Cashier: actual transfer committed despite an intentionally lost response; retry showed one bag, then saved count/allocation/close completed with zero JavaScript errors.
- Supervisor: Desk bag → dispatch → bank receipt → printable handover completed with zero JavaScript errors.
- `cashier-recovered-drop.png`, `closing-count.png`, `manager-in-transit.png`, `manager-bank-confirmed.png`, and `bag-handover.html` document the journeys.

Temporary QA users were disabled and sessions cleared after verification; both QA registers are disabled, with evidence retained. The Doco/Mumu operating profiles have not been opted into custody. Mumu lab read-only compatibility check returned `enabled: false` successfully. Regenerate an isolated fixture with `run(persist=True)` for another browser run; do not put its password or terminal credentials in source control.


### UI/UX crew follow-up

The cashier, counting and supervisor surfaces received an Opus crew pass followed by primary review, real lab journeys and ledger checks. See [the UI/UX review and evidence](POS-CASH-CUSTODY-UX-REVIEW.md). Counts retain their saved/edited state, unconfirmed actions replay safely, invalid amounts are not silently rewritten, and bag labels are separate from full handover sheets. This follow-up is lab verified and is not a production rollout.

## Release activation checks — 2026-09-16

Enabling custody requires cash movements and deposits enabled, no per-movement
maximum, and the same company cash account for both the payment method and drawer.
The movement maximum is protected while custody is active. Seal IDs are unique
across the entire site; duplicate IDs receive a clear refusal. Blind closings
require a handover note before final submission. Existing profiles are not opted
in by migration. Supervisor actions retain the existing closing-supervisor role
policy; review staff roles before enabling custody for a register.
