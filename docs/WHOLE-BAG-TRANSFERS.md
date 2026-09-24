# Whole sealed bag transfers (safe → off-site cash)

Status: implemented in POS and Desk. Verified with standalone tests and the rollback-only
`cash_custody.lab_whole_bag.run` drill on Doco mirror. Production is not configured by this change.

One action moves a sealed cash bag, whole and unopened, from a register's safe to
a separately configured cash ledger, such as the owner's home safe. POS and any bot use
the same custody command, so both get the same scope checks, lock, idempotency and audit event.

## What it is and is not

- **Is:** the ledger record of a physical move the actor has already made and confirms.
  Credit safe, debit the configured off-site Cash account, for the bag's recorded amount.
- **Is not** a bank deposit (use dispatch → confirm bank), an expense, a count, a
  verification, or an unpack. Nothing posts on a timer or threshold.
- The caller never provides the amount or destination. The amount comes from the bag,
  and the destination comes from `POS Cash Safe.offsite_cash_account` at the moment of writing.

## Configuration

`POS Cash Safe.offsite_cash_account` (Link Account, optional, blank by default).
It is blank on existing installs, so the action stays unavailable until a System Manager sets it.
Both the Desk save and **every transfer** reject the account unless it is:

- an active, non-group account with `account_type = Cash`, in the safe's company and currency;
- different from this safe's drawer, safe, transit, bank and variance accounts;
- not a ledger managed elsewhere: another POS Cash Safe's safe, transit, bank or variance account
  (disabled safes included), any POS Profile back-office or default source account, any POS Allowed
  Source Account, any company Mode of Payment default account, or any POS Register drawer account.
  Otherwise cash could reappear in another register without its receipt, count and closing trail.

A safe's own custody accounts also cannot be another safe's off-site destination.
Several safes may share one owner safe. The setting may change later.
Each transferred bag stores its own `transfer_account` and `transfer_journal`,
so changing the setting later does not rewrite history.

## State and fields

`POS Cash Bag.state` gains `Transferred` (terminal). New read-only fields:
`transfer_account`, `transfer_journal`, `transferred_by`, `transferred_on`.

| From | transfer_safe |
|---|---|
| Available | allowed |
| Unverified | allowed: the bag stays marked unverified (`verified_by` stays empty) |
| Disputed, Issued, In Transit, Deposited, Unpacked, Transferred | refused |

`prepared_by`, `verified_by`, `received_by`, `count_json`, `amount`, `seal` and `purpose` do not change.
The transfer creates no POS Cash Count. `bag.note` becomes the transfer reason, as with
unpack and return-from-bank. The earlier note stays in Version history and the journal remark
carries the reason plus bag name and seal.

Read model: `Transferred` is in `COMPLETED_BAG_STATES`, so it appears as finished history.
Reservation logic is unchanged. `loose_balance` reserves only Available/Unverified/Disputed bags.
The bag leaves the reservation and the safe GL together, so loose safe cash is unchanged.
Register retirement blockers (`register_foundation/commands.py`) already treat any state outside
Unverified/Available/Disputed/In Transit as out of custody.

## Accounting

| Action | Debit | Credit |
|---|---|---|
| Transfer whole bag off-site | Off-site cash (configured) | Safe |

Posted through `service.post` → `create_journal_entry(movement_type='Transfer')` with the
profile cost center. Before posting, the current locked safe GL balance must cover the bag.
If it does not, count the safe and review the difference first.
`protect_journal` blocks cancelling the journal, because the custody event's `result_json.journal_entry` names it.

The reverse route (cash coming back from the owner safe) is not part of this action. Post a
normal accounting transfer into the safe account, then prepare a new bag with a new seal.

## API contract (POS and bot)

```
POST /api/method/posawesome.posawesome.api.cash_custody.service.command
action=transfer_safe
payload={"pos_profile": "<profile>", "bag": "<CASH-BAG-…>",
         "request_id": "<16–80 chars [A-Za-z0-9_-], stable per intent>",
         "note": "<8–1000 chars: who moved it, from/to, confirmation>"}
```

- Authenticate as a real user who is a closing supervisor with scope for the profile and company.
  An API key/secret user needs the same roles and User Permissions. No hidden bypass exists.
- The payload is refused if it contains any of `amount`, `count`, `account`, `target_account`,
  `transfer_account` or `offsite_cash_account`.
- Success returns
  `{"bag", "amount", "state": "Transferred", "transfer_account", "journal_entry"}`.
- **Retries:** after a timeout or lost response, resend the *identical* payload with the *same*
  `request_id`. The server replays the original result and posts nothing new. The same ID with any
  other field changed is refused ("already used for different cash instructions"). Use a new ID only
  for a new intent. A second request for a bag that already moved is refused by state.
- A bot must confirm the physical whole, sealed bag movement with its authorized user before calling.
  POS and Desk require a confirmation checkbox; the API trusts that caller confirmation.
- A bot must not post generic Journal Entries for custody cash. Use this command only.
- Availability: `service.context(pos_profile)` returns `offsite_cash_account`,
  `offsite_cash_account_name`, `can_transfer` (supervisor AND a valid destination) and
  `transfer_blocker` (a human-readable reason, or null). This is a hint. The write rechecks everything.

Concurrency: the command locks the safe row (`for_update`), rereads the event under lock,
then locks the bag row before checking state. Two concurrent transfers of one bag serialize:
the second sees `Transferred` and is refused, or replays if it used the same request ID.

## Operator surfaces

POS quick access and the opening-shift dialog link to Cash custody. A supervisor can
choose an authorized register without opening a shift, select the sealed bag, review
its full amount and configured destination, confirm the physical move and record it.
Desk offers the same command on the bag form. Both surfaces preserve the original
request for a retry after an unknown response.

Moved bags appear under Completed with destination, actor, time and journal. The bag
label, ticket and handover preserve the seal and show whether it was independently
verified. Photos stay attached under the original register's access scope.

## Native drill (lab only, never production data)

On a lab site with a funded, enabled POS Cash Safe:

1. Create a Cash ledger `Caja fuerte casa - LAB` (non-group, company currency). Set it as
   `offsite_cash_account`. Confirm the save refuses the bank, variance, drawer and safe accounts,
   another safe's account, and a Mode of Payment account.
2. As cashier A, prepare or drop a bag with seal `LAB-OFFSITE-01` (Unverified). Record safe GL,
   `loose_balance`, and the bag's fields.
3. As supervisor B, run `transfer_safe` with request ID `lab-offsite-transfer-0001`. Check the
   single submitted JE (Dr home / Cr safe) for the bag amount. Check that `loose_balance` is
   unchanged, the bag is `Transferred` with `verified_by` empty, and no new POS Cash Count exists.
4. Replay the same request and get an identical result with no second JE. Change the note while
   keeping the ID and get a refusal. Use a new ID for the same bag and get a state refusal.
5. From two bench consoles, run two transfers of a second bag with different IDs at once.
   Expect exactly one JE and one refusal.
6. Try Disputed, In Transit and Issued bags, a cashier user, and a user from another profile.
   All are refused with no GL change.
7. Clear `offsite_cash_account`. The context shows `can_transfer=false` and writes are refused.
8. Try to cancel the transfer JE. `protect_journal` refuses it.

## Risks and edge cases

- **Unverified bags leave with only the preparer's count.** This is intended, and the record says so.
  Any recount happens off-site, outside POS.
- **Safe shortage:** if safe GL < bag amount (for example, an unreviewed shortage), the transfer is
  refused rather than driving the safe negative. Reconcile first.
- **Destination guard breadth:** it covers known POS-managed ledgers only. Another ERPNext Cash
  ledger (such as petty cash) passes if configured. Choosing it is a deliberate owner decision.
- **Later collisions:** if a profile, register or safe is later pointed at the configured off-site
  account, the next transfer is refused (rechecked on every write) until someone fixes the setting.
- `context()` now runs the destination guard, a few small reads, on each load when configured.
