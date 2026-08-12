# Restaurant Tips (Propinas) — Spec v1

Status: DRAFT for build (Marco ordered 2026-08-12: "make sure tips are fold into
restaurant mode"). Companion to RESTAURANT_TABLES_SPEC.md v2.1 — same spine, same
security contract (§1.1 there), same offline discipline (§6 there).

## 0. Shape of the feature

A tip is captured at **settle time** on a table ticket, chosen by the guest after
seeing the total. It is money the business collects on behalf of staff — it must
ride the accounting document (auditable, CFDI-compatible), never a side memo.

Scope v1: the **restaurant settle path only** (`settle_table_order`). Counter-mode
Pagar (`cafeteria-counter`, direct Sales Invoice) is explicitly OUT — revisit if a
counter tenant asks. Gate: new capability token `tips` (additive — no
CAPABILITY_PAYLOAD_VERSION bump; absent token = feature invisible, same rule as
`tables`).

## 1. Data model

**No new doctype.** Three pieces:

1. **Tip item** — one non-stock service Item per company, `item_code
   "PROPINA"`, `is_stock_item 0`, `is_sales_item 1`, excluded from KOT routing
   and from item-selector search (same exclusion mechanism the fixture items
   use). Created lazily server-side on first tip settle (`get_or_create`,
   idempotent, race-safe via unique item_code + IntegrityError catch — see
   reference_frappe_unique_index_exception).
   - Income account: company default on create. The contador repoints it to a
     liability account («Propinas por Pagar») when they want agent treatment —
     spec deliberately does NOT hardcode fiscal policy. Document in the
     contador packet.
   - Tax: ships with NO item tax template (inherits none → follows invoice
     taxes only if operator adds one). SAT nuance (voluntary propina outside
     IVA base vs mandatory service charge inside it) is the operator's item
     tax template call, exactly like Tasa-0%/Exento elsewhere.

2. **Settle parameter** — `settle_table_order(..., tip_amount=0)`.
   - Server-side validation: `flt(tip_amount) >= 0`, cap at
     `2 × order line total` (fat-finger guard; configurable later if a real
     venue hits it).
   - Server appends the tip line in `_invoice_items(order)` output
     (settle.py:58) — the payload NEVER carries the tip line itself. Same
     principle as lines: "the payload does not get a vote", the tip rides a
     first-class parameter, so a crafted payload can't smuggle arbitrary
     rate/item combinations under the tip flag.
   - Payments in the payload must total `grand_total` INCLUDING the tip line —
     the existing payment-vs-total validation in the invoice_processing path
     already enforces this once the line is in. No paid_amount>total hacks.

3. **Provenance stamp** — `posa_rt_tip_amount` (Currency) custom field on
   Sales Invoice + POS Invoice, fixture-delivered next to the existing
   `posa_rt_*` family (settle.py:117-125 comment covers graceful degradation on
   unmigrated sites — same applies). Reporting reads the stamp, not the line
   (line scan breaks the day an operator renames the item).
   `posa_rt_waiter` already exists → "propinas por mesero/turno" is a plain
   query, phase 2 report.

## 2. Idempotency + replay

The tip is part of the settle request → rides `client_request_id` dedup as-is.
Replay branches in settle.py return the already-settled response and MUST NOT
re-append or re-validate the tip (they never rebuild the invoice — verified,
no code change needed, but add the regression test).

## 3. Offline

- Offline settle queue entry gains optional `tip_amount` → **bump
  SYNC_SCHEMA_VERSION** (new date) in ALL copies — grep for the constant; it is
  deliberately duplicated ×7 (see project memory: same-id replay is a server
  NO-OP, union coalesce trap).
- Frozen settle response contract (settle.py:130-154) is UNCHANGED — do not add
  keys.
- Tip captured while offline uses the cached order total for the % quick
  buttons; server revalidates on replay (cap rule) — a drifted total degrades
  to a validation error surfaced through the existing failed-settle → Open
  revert drill path.

## 4. UX (build exactly this, skip the rest)

Settle sheet (the existing table-ticket payment flow in
`usePaymentSubmission`/floor cart bridge):

- One row above the payment methods: `Propina — [10%] [15%] [20%] [Otro] [Sin]`.
  Default **Sin propina** (never pre-select — this is a legal/UX line in MX).
- Percentages compute on the ORDER lines total (pre-tip grand total), rounded
  to whole pesos (`round`, not truncate).
- `Otro` = numeric input, same keypad component the payment amount uses.
- Chosen tip renders as a cart line preview + bumps the total the payment rows
  must cover; change math follows automatically.
- Floor/kanban cards, KOT, bill-print-before-settle: NO tip anywhere (tip is
  chosen at the end; a pre-printed bill with a tip line is upsell pressure and
  a SAT smell).
- Ticket print after settle: tip prints as its own line (it is an item line —
  free).

Vocabulary: label key `Tip` → es «Propina» via the existing capability `labels`
map — restaurante presets already carry labels, extend them.

## 5. Capability + seed touchpoints (cross-repo, THE trap)

Token `tips` added to `capabilities` on the `restaurante-mesas` preset in **all
three seed sources** (they must not disagree — same rule as the template §2.8):

1. posawesome: preset fixture/test expectations (check_fixture_coverage lint
   will catch strays — run it).
2. boat: `boat/muelle/seed/vertical_templates.py` restaurante-mesas record.
3. abordo: `abordo/setup/presets/restaurante.py`.

**Template import is INSERT-ONLY** (apply2 drill: inserted=0/skipped=8) — sites
that already carry the preset (lab doco-mirror, prod demo.xolo) do NOT get the
token from a re-apply. Ship a posawesome patch (`add_tips_capability_to_mesas`)
that string-appends `tips` to existing `restaurante-mesas` rows where absent —
idempotent, migrate-delivered. (Fresh installs skip patches — fixture must
already carry it; patch is only the converge path. See
reference_fresh_install_skips_patches.)

## 6. Tests (gate: whole suite green, not just new files)

- settle with tip → invoice has PROPINA line + stamp; payments must cover.
- tip_amount 0 / absent → no line, no stamp (nulls stay null).
- cap violation → throw, order stays Open.
- replay with same client_request_id → idempotent response, ONE tip line.
- offline queue entry with tip → replay settles once, exact amount.
- capability token absent → UI hides tip row (frontend test); endpoint still
  validates independently (backend never trusts UI gating — §1.1).
- fixture coverage lint + payload version guard untouched.
- vue-tsc + vitest + bench suite: ALL green before handoff.

## 6.5 Audit outcomes folded in (2026-08-12, opus money-path audit)

- `posa_rt_tip_amount` is stamped UNCONDITIONALLY (0 when tip-free) — a
  conditional assign let a crafted payload forge the payout stamp (H2).
- `validate_tip_amount` short-circuits on zero — the cap must never reject a
  tip-free settle on a return-heavy (negative-total) order (M1).
- «Otro» rounds to whole pesos like the % buttons — fractional tips desync
  rounded_total from the server's re-round and strand centavos (M2).
- Existing-item path re-asserts `is_stock_item == 0` with a clear error (M5).
  CONTADOR RULE: never add an Item Price for PROPINA — a master price trips
  the rate-band assert on profiles without rate editing.
- Item Default rows: fieldname is `income_account`; `default_warehouse` is
  forced to `""` (global-default injection trap — see memory
  reference_frappe_child_row_default_fill_trap). Tip item lives in its own
  defaults-free `Servicios POS` leaf group.
- Stamp reads back 0.0, not NULL — Currency custom fields materialise as 0.
- KNOWN UX (M3, accepted v1): tip picked AFTER the cashier manually typed a
  payment amount doesn't re-sync the payment row; settle rejects with the
  payments-must-cover message and the cashier corrects. Manual lab pass
  before prod roll.
- Cap anchors to gross lines pre-discount (M4) — documented fat-finger guard,
  not a guest-protection policy.
- INHERITED fix shipped alongside (H1): `creation.py` foreground submit now
  re-asserts payments-vs-grand-total after the draft save, mirroring the
  background path — closes the client-declared-totals underpayment window on
  EVERY POS sale, not just tips.

## 6.6 Second audit folded in (2026-08-12, opus offline/replay/capability)

- H1 (tip after touched payment): applyRestaurantTipTotal now follows the tip
  when the cashier's entry exactly covered the prior total ("exact" intent);
  a deliberate over/under tender is never rewritten — shortfall stays visible.
- H2 (Naming Series tenants): Item autoname rewrites the item_code FIELD, so
  get_or_create restores `item_code = "PROPINA"` post-insert (db_set) — no
  orphan tip items, selector exclusion holds. Both prod tenants verified
  `item_naming_by = "Item Code"` today; this closes the latent arm.
- M4: selector resets local choice when the parent zeroes the tip (reopened
  sheet can't show a highlighted % over a 0 tip). "Otro" exempt — it emits 0
  before the amount is typed.
- CORRECTION to §1: ONE global PROPINA item with per-company item_defaults
  rows (not one item per company). The build is right; earlier text was not.
- CORRECTION to §6: zero/absent tip → no line, stamp = 0.0 (not NULL).
- M8 — OPEN MARCO RULING: the settle endpoint does not refuse tips when the
  profile lacks the `tips` token (matches the `tables` precedent: capability
  tokens gate UI, not the API). Confirm or order a backend gate.
- Accepted v1 (documented, no code): M3 stale tip base when a gift
  card/coupon lands while the sheet is open (fails loudly at the invariant);
  M7 tip % base can lag the cart by the 800ms cart-sync debounce (server cap
  uses fresh totals; guest pays slightly less at worst); positive tip on a
  fully-comped zero-total ticket throws (cap = 0).

## 7. Deliberately rejected (v1)

- Tip as payment-overage / paid_amount>total: fights ERPNext change math and
  CFDI totals; every rail downstream assumes payments==total.
- Tip % service charge auto-added: mandatory service charge is a DIFFERENT
  fiscal object (IVA base), out of scope.
- Per-waiter tip pooling/distribution ledger: payroll territory, phase 2+.
- Card-terminal tip capture (MP Point etc.): connector-specific, phase 2.
- Counter-mode tips: not restaurant mode; revisit on demand.
