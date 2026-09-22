# Cash custody UI/UX review

Status: implemented, independently reviewed and verified on Doco lab; production rollout pending.

## Ownership

Three fresh Opus worker sessions, explicitly requested by Marco, with no inherited conversation. Runtime identifies the selected model as `claude-opus-5`. Primary Codex owns review, shared integration, tests, lab deployment and final acceptance.

- Cashier worker: bag/count workspace and its focused component tests.
- Counting worker: denomination editor, saved drawer count and bag allocation, plus focused tests.
- Supervisor worker: Desk actions and printable evidence.
- Primary: recovery transport/storage, closing shell integration, translations, independent browser tests and lab financial verification.

No production changes. No worker may alter accounting rules, migrations, permissions or unrelated shared work.

## Acceptance

- Each role sees useful queues, a selected record, permitted actions and a clear completion/return path.
- Touch targets, keyboard focus and readable amounts work at 1440×900, 1024×768 and 390×844, in light and dark themes.
- Cashier can distinguish saved versus edited counts, remaining allocation and blocked-close reasons.
- Denomination entries and manual overrides have clear validation; monetary totals and bags still follow server contracts.
- A lost response preserves the request identity and counted work; retry never implies moving physical money again.
- Failed browser storage explains that no new cash request was sent; corrupt recovery records are preserved for review.
- Supervisor dialogs request the fields required for their specific action, retain network retry identity, and expose useful links and printouts.
- Loading, empty, error, stale-state and self-verification restrictions have actionable copy.
- New user-facing strings have Spanish translations and use the existing Muelle visual language.
- Unit/component checks, type-check/build, UI-only visual checks and real lab transactions are reported separately.

## Baseline evidence

`frontend/tests/visual/check-custody.mjs` uses real components with simulated server responses. Before crew edits, 15 viewport/scenario combinations passed overflow/error checks. This is layout evidence, not proof of a financial transaction.

Artifacts and worker activity: `/tmp/pos-ux-crew/`. Live test credentials stay private and are removed after test users are disabled.

## Implemented and independently reviewed

- Cashier: role/register/shift context; actionable bag and count queues; state-specific actions; independent-verification restrictions explained where they apply. Safe balances collapse for cashiers, and the current task appears before the queue on narrower screens.
- Counting: 48px count steppers, per-denomination subtotals, manual totals clearly identified, saved/edited state, remaining bag allocation, unique-seal guidance and a list of what still prevents closing. The closing shell supplies expected cash only when the profile allows it.
- Recovery: POS and Desk preserve the original instructions/request ID. An interrupted drawer-count save has its own recovery action. No client silently discards corrupt recovery evidence or sends a cash command without first persisting its recovery ID.
- Desk: action-specific dialogs; only required fields collected; contextual queues, counts and related records; clear state and next action; bank confirmation no longer asks for a note the server never stores.
- Evidence: separate full handover sheet and 100×76mm bag label, available from both POS and Desk; translated states, formatted dates/money, names, count details and linked references. Printing checks both read and print permission.
- Spanish translations cover new task, state, validation and recovery text.

### Issues caught by primary review

- Successful recovery left the old submit form available. It now closes and selects the confirmed record.
- A committed Desk action followed by a failed refresh was described as unconfirmed. It now says the action was saved and asks for a refresh without moving the cash again.
- Editing the count while a save was in flight could mark the edited version as saved. The saved signature now belongs to the exact snapshot sent.
- Typing `2.5` in the reused quantity control silently became `25`; invalid quantities now preserve the last valid count and show a correction message. Invalid manual money also stays visible for correction instead of being silently rewritten.
- Clicking a different queue record could discard an entered handover. The screen now asks the cashier to finish or explicitly cancel it first.
- A blind count with an explicit null expected amount could display an expected zero. Null/absent expected amounts remain hidden.
- The initial bag label occupied three physical labels. Its compact layout now reserves signatures and denomination detail for the full sheet; real PDF pagination is checked in the live manager journey.
- The printing unit test originally replaced global framework modules during import. Its stubs are now restored immediately, preserving native Frappe test discovery.

## Verification

- Full frontend suite: **489 files / 5,579 tests passed** (`/tmp/pos-ux-crew/full-suite-final.log`). Existing navigation/source contracts were updated for the custody destination and the touch-sized preset strip outside the payment columns; the tests still forbid scrolling payment columns.
- Final print-choice change: **26 focused tests passed**, including both POS print layouts (`print-actions-tests.log`).
- Print renderer: **14 standalone tests passed** for permissions, escaping, readable evidence and layout validation (`printing-tests.log`).
- UI-only browser evidence: **15 layout cases, 6 interactive journeys, 3 Spanish cases**, zero page errors (`visual-final.log`, `visual/`). Real Vue components, simulated financial responses. These checks cover focus, touch dimensions, saved-count readiness and invalidation after edits; they are not ledger proof.
- Scoped ESLint: clean. Vite build includes the complete TypeScript check. Refresh logs are retained; source remains an uncommitted lab candidate, not a CI-certified release.
- Fresh native lab fixture completed the existing **32 financial workflow assertions** before browser verification. QA credentials are private and excluded from evidence.

## Live acceptance and cleanup

The built candidate ran against **doco-mirror.lab.xoloitzcuintles.com**, using the isolated `Custody QA af56655` register. No mocked business endpoints:

- Cashier returned **MX$90** while Playwright deliberately discarded the successful server response. Retrying produced exactly one bag (`CASH-BAG-00022`), then the cashier saved **MX$910**, allocated it to a sealed bag, and closed the shift. No JavaScript page errors.
- Supervisor dispatched `CASH-BAG-00021`, recorded the bank receipt, and retrieved the actual printable evidence. No JavaScript page errors.
- Direct database/accounting verification: final count `CASH-COUNT-00046`, closing `POSA-CS-26-0000546`, count **910**, difference **0**, drawer GL **0**, transit GL **0**, submitted bank journal `ACC-JV-2026-00412`.
- The real bag label PDF is **one page, 100×76mm**. A separate layout stress check with an 80-character seal also fits one label.
- Three QA users were disabled and their sessions cleared; the QA profile is disabled. Temporary password/terminal credentials were removed. The labeled financial evidence remains for audit.

Artifacts: `/tmp/pos-ux-crew/live/` contains `ledger-proof.json`, sanitized `fixture-evidence.json`, screenshots, `bag-handover.html`, `bag-label.html`, `bag-label.pdf`, and `maximum-seal-label.pdf`. Browser logs: `live-cashier.log`, `live-manager.log`. Final Desk wording distinguishes ordinary bank journals from variance corrections; its final **16 tests pass** (`desk-final.log`).

Build/publish logs: `lab-refresh.log`, `lab-final-refresh.log`, `desk-refresh.log`. No new migration was needed for this UI pass. Production custody remains untouched; no claim is made about physical printer hardware or bank API integration.

## Follow-up gap wave — 2026-09-15

Three fresh Opus workers (`claude-opus-5`) addressed the remaining interruption and ageing-data defects. Primary review requested corrections before acceptance; production remains untouched.

- **Unsent cashier forms:** preserve task, count, seal, note, reference and selected record per user/register/shift. Restore only after checking current records and permissions; stale/corrupt drafts cannot be silently overwritten. Before a command, the unsent copy must be released successfully so pending-request recovery becomes the only retry path. Storage refusal blocks sending. Cancel preserves the form if its saved copy cannot be removed.
- **Stale closing counts:** compare cached and server versions, show both amounts, and let the cashier deliberately load the saved count or retain their count for a new save. Preserve bag allocations. Failed verification and unresolved conflicts block closing readiness; an unconfirmed request must be resolved first.
- **Older unresolved work:** every unresolved bag/count remains visible independently of the bounded recent completed history. No arbitrary unresolved-row cap. History ordering uses timestamp plus unique name; the POS explains the limit and links to the appropriately scoped Desk list.
- **Touch correction:** correcting an invalid denomination quantity with a stepper clears the obsolete warning.

Primary review also rejected an initial 500-row unresolved cap and timestamp-only history pagination; these would have moved the hidden-work defect rather than resolved it. No cash posting rules or schema changed.

### Verification of the follow-up

- Frontend: **490 files / 5,623 tests passed**; TypeScript clean. The first full run caught eight missing Spanish translations, which were added before the successful final run.
- Read-model tests: **20 passed**. Count arithmetic: **5 passed**.
- Browser UI fixtures: **15 layouts, 6 interactive journeys, 3 Spanish cases**, no page errors. This is simulated-server layout evidence.
- Native Doco lab: existing **32 financial assertions passed** on a fresh isolated QA register. A separate rollback-only check kept **505 older unresolved bags** visible beneath 205 newer completed records, with cashier count scoping and other-register denial verified.
- Evidence directory: `/tmp/pos-gap-wave/`. Live published-build journey results are recorded below after completion.

### Remaining work outside this gap wave

1. **Release:** isolate the intended revision, obtain passing CI for it, configure/reconcile the real safe and drawer accounts, then perform the explicitly authorized production rollout. Current lab evidence does not replace CI or production activation checks.
2. **Physical operation:** test the actual shop printer/label stock and conduct the first real counted handover with staff. PDF dimensions have been checked; physical hardware has not.
3. **Usability follow-up:** guided safe activation/funding; generated/scannable bag labels where they reduce typing. The next wave below implements drawer guidance and a custody-specific main action band. Float target and drawer limit remain guidance.
4. **Browser coverage:** broaden role journeys for opening/receiving a float, shortage review and terminal replacement. Core native tests cover the financial rules, but those complete browser journeys are not yet all evidenced.

Multi-register safes and automatic bank-feed matching remain outside the requested one-safe/one-drawer implementation; bank receipt confirmation is manual.

### Published-build financial acceptance

On isolated **Custody QA 56e3522 / CASH-SAFE-00004**:

- The unsent MX$90 return form survived a browser reload with its seal/count/reason intact, without sending a command. Deliberately losing the successful command response and retrying created exactly one bag, `CASH-BAG-00029`.
- Closing count `CASH-COUNT-00061` reloaded without a false conflict when unchanged. A deliberate subsequent server save of MX$920 produced the conflict panel; keeping the local MX$910 count and saving completed closing `POSA-CS-26-0000548` with difference zero.
- The live harness was corrected to reopen Closing after a page reload, wait for the saved-count load before toggling manual mode, and wait for save completion before reloading. Failed harness attempts did not repeat the completed cash drop. Successful resumed journey: `live-cashier-resume3.log`, no page errors.
- Supervisor dispatched `CASH-BAG-00028` and confirmed its bank receipt through Desk. Submitted bank journal `ACC-JV-2026-00428`; printable evidence fetched; no page errors (`live-manager.log`).
- Direct ledger proof: drawer **0**, bank transit **0**, one recovered drop **90**, final count **910**, difference **0** (`live/ledger-proof.json`). QA users and profile disabled, sessions cleared, temporary credentials removed.
- Final primary guard: saving and closing readiness stay blocked while the server count is being checked. **29 closing tests** and the complete UI browser fixture pass after that adjustment. The final frontend refresh uses `--no-restart-py` (`lab-final-refresh.log`).

The refresh encountered a cache-clear error for an unrelated stale lab site with a missing database; the Doco target and coordinated refresh completed. No schema migration or production change was performed.

Final publication completed: served `ClosingDialog-CM6nwhe_.js` and `CashCustodyView-CF1CErMZ.js` match the local build byte-for-byte (`/tmp/pos-gap-wave/served-assets.json`). The cache-clear warning is for the archived `_archived-test-tenant.lab.xoloitzcuintles.com.orphan-db` directory, not the Doco integration target. Visual follow-up should also tighten the closing screen's use of horizontal space alongside the custody-specific action band.


## Next cash-workflow wave — 2026-09-15

Three fresh Opus workers (`claude-opus-5`) implemented the contextual action band, closing layout and drawer-limit guidance. The primary integrated the shell and guidance component and owns published-build verification. Lab only; production unchanged.

- **Contextual cash action:** the large footer displays the selected cash amount and next permitted task. Opening a task does not transfer cash. Confirm uses the same native form validation and existing command/recovery functions; unresolved requests take priority. Leaving the screen removes its band and listener.
- **Closing layout:** named container queries adapt to actual available width. Wide surfaces show count, bag allocation and payment review alongside one another; narrower surfaces stack them. The close action remains pinned outside one body scroll area. No financial handlers changed.
- **Drawer guidance:** read-only, scoped to the register and cashier/supervisor. Uses canonical expected closing cash, advises a return above the configured limit, and refreshes after a completed cash task. Expected cash is explicitly distinguished from a physical count; no count is prefilled. Blind-count responses contain no amounts. Failure offers Retry without blocking work.
- **Native guidance verification:** fresh isolated register `Custody QA b8e83ec`, safe `CASH-SAFE-00005`, expected 1000, limit 950, suggested return 200 retaining 800. Another cashier was denied; a supervisor was allowed; blind responses hid all figures; financial record counts remained unchanged. Test configuration changes for blind mode were rolled back.
- Evidence: `/tmp/pos-next-wave/`. Four-width closing geometry checks cover custody, ordinary and blind closing, pinned actions, touch targets, overflow and scrolling. Browser fixtures use simulated responses; live ledger acceptance is recorded separately below.

Remaining: guided activation/funding, optional generated/scannable seals, more complete float-receipt/shortage/terminal-replacement browser journeys, physical printer/staff acceptance, isolated revision and CI, and explicitly authorized production activation. The reconciliation table still scrolls sideways on intermediate widths; the page itself does not overflow.

### Next-wave acceptance

- Full frontend suite: **491 files / 5,648 tests passed** (`full-tests-final.log`); standalone backend guidance/context/model: **40 tests passed**; TypeScript and scoped ESLint clean.
- UI browser regression: **15 layout cases, 6 interactive journeys, 3 Spanish cases**, no page errors (`visual-custody.log`). Full closing layout checks separately cover four widths and ordinary/blind/custody modes.
- Published-build cashier journey: guidance suggested 200 against expected 1000/limit 950; cashier entered a real test count of 90. The unsent form survived reload. The large footer submitted and retried a deliberately discarded successful response, creating exactly one returned bag. Guidance then showed the drawer within its limit. Saved-count conflict recovery and closing completed with no page errors (`live-cashier.log`). An earlier run stopped at login while the coordinated restart was still running and performed no cash action.
- Supervisor completed Desk bank dispatch, receipt and printable evidence with no page errors (`live-manager.log`).
- Direct ledger evidence: `CASH-COUNT-00076`, closing `POSA-CS-26-0000550`, amount **910**, difference **0**; one retried drop `CASH-BAG-00036` for **90**; deposited bank bag `CASH-BAG-00035`, submitted journal `ACC-JV-2026-00444`; drawer and transit balances **0**. Three QA users and the profile were disabled, sessions cleared and temporary credentials removed (`live/ledger-proof.json`).
- Primary visual review corrected denomination labels breaking inside numbers. Whole banknotes omit unnecessary cents and allow a break between currency and value; subtotals and arithmetic are unchanged. **101 focused tests passed** after this presentation change (`final-label-tests.log`). Final publication is frontend-only (`lab-final-refresh.log`).
- Lab refresh again reported the known missing database for the unrelated archived tenant directory; Doco refresh completed. No migration or production change.
