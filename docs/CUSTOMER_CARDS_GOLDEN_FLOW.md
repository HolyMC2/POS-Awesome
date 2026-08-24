# Tarjetas — regalo y cliente: the golden flow

Status: acceptance contract for the 2026-08-23 tarjetas round
Companion: `CAFETERIA_GOLDEN_FLOW.md` (same session), `POS-PROFILE-SPEC.md`,
register-hifi artboards `TarjetaRegalo.dc.html`, `Cliente.dc.html`,
`Cobro.dc.html` (nodes 50–54, the wallet line).

Two different promises, kept apart on purpose (walletSummary.ts's standing
rule — "TWO WALLETS, NOT ONE"):

- **Tarjeta de regalo** — bearer value. A code is the owner. Already built:
  `POS Gift Card` + transaction ledger + liability-account JEs +
  issue/top-up/check API + invoice redemption. What's wrong is the surface.
- **Tarjeta de cliente** — customer value. The CUSTOMER is the owner: pesos
  they deposited (monedero = ERPNext customer credit: advances/credit notes,
  already redeemable as a tender) plus cashback they earn (ERPNext Loyalty
  Program, points valued in pesos). What's missing: a deposit flow, the
  accrual read model, an enrolment gesture, and one view where all of it
  lives.

## 1. Tarjeta de regalo — surface fix

Today `GiftCardsView.vue` is a marketing page: hero copy, access badges,
"Scan-Ready" explainers, three stat cards narrating permissions — wrapping
one code field. English-only. No ledger, no card panel.

Contract (artboard `TarjetaRegalo.dc.html`):

- **Lookup-first**: one scan/code field on top, always. Resolving a card
  paints the card panel: balance big and mono, status/expiry chips, the
  card's recent transactions (type · amount · balance-after · date ·
  cashier) from its own ledger.
- Verbs on the panel, gated visibly: **Consultar** (everyone), **Emitir** /
  **Recargar** (supervisor — the gate is a chip on the button, not a
  paragraph). Issue offers "generate code" or scan-your-own.
- A single quiet hint where the money exits: «Se cobra en Cobro, como forma
  de pago» — and in Cobro, when `posa_use_gift_cards` is on, the gift card
  is a reachable tender (code + amount) in the control panel, not a buried
  legacy field.
- es-MX copy throughout (the artboard's), through the existing `__()` path.
- No hero, no badges, no copy that narrates the UI to itself.

## 2. Tarjeta de cliente — the loop

```
Activar   → customer enrolled in the shop's cashback program (one tap,
            from the contact view; program configured once per register)
Depositar → cash/tender in → Payment Entry advance → monedero grows
Comprar   → Cobro shows «Monedero del cliente · $X» and
            «Acumula $Y con esta compra»; monedero redeemable as tender
Cashback  → accrues on submit (ERPNext loyalty), spendable like the rest
```

### Backing (all ERPNext-native, no new ledger)

- **Monedero balance** = `get_available_credit` (advances + credit notes) —
  already what Cobro's wallet line reads.
- **Deposit** = a submitted Payment Entry (party = customer, unallocated,
  paid_to = the tender's account) minted by a new endpoint:
  `stored_value.deposit_stored_value(pos_profile, customer, amount,
  mode_of_payment)` — register-membership + open-shift gated, amount > 0,
  mode must be one of the profile's tenders, cash deposits count in the
  drawer (the closing reconciliation must see them).
- **Cashback** = a Loyalty Program the register designates (new POS Profile
  field `posa_customer_card_program`, Link → Loyalty Program) with the
  profile flag `posa_use_customer_cards` gating the whole surface.
  Enrolment = setting `Customer.loyalty_program` to the designated program
  (the `set_customer_value` path exists).
- **Accrual preview** («Acumula $Y») = server read model
  `stored_value.get_cashback_preview(customer, company, eligible_amount)`
  returning `{points, value}` computed with ERPNext's own rounding — the
  client never re-derives it. This fills the socket `walletSummary.ts`
  deliberately left null.
- **Movements** = `stored_value.get_customer_wallet(customer, company)`:
  balance + enrolment + a unified ledger (deposits, redemptions, cashback
  earned/spent, credit notes) sourced from Payment Entries, invoice credit
  redemptions and Loyalty Point Entry — newest first, capped and saying so
  (the OrderStory convention).

### Cobro

The wallet line (artboard Cobro nodes 50–54) finally tells both truths:
balance AND accrual. Redemption of monedero stays the existing
customer-credit tender; the accrual line renders only for enrolled
customers on card-enabled registers; nothing renders for the rest —
absence, not zeros.

## 3. The contact view (artboard `Cliente.dc.html`)

One surface where the cashier answers «¿quién es esta persona y qué tiene
con nosotros?» — reachable in one tap from the sale's customer strip.

- **Header**: name, phone/contact chips, CRM state chip, card state chip
  («Tarjeta activa» / «Sin tarjeta»).
- **Monedero card**: balance big; **DEPOSITAR** (dialog: amount + tender,
  prints/confirms) and **Activar tarjeta** when not enrolled; cashback
  state (points · pesos · program name) once enrolled.
- **Movements**: the unified ledger from `get_customer_wallet`.
- **Historia**: the purchase timeline (recycled `get_customer_story` /
  OrderStory idiom) with its caps stated on screen.
- **Seguimiento**: the CRM strip (passive + seguimiento), as shipped today.
- The strip's «historial» dialog stays for the quick glance; the contact
  view is the full answer. Gating: view exists for every register; the
  monedero/cashback card renders only under `posa_use_customer_cards`.

## 4. Guardrails

- Bearer and customer value never merge into one figure anywhere.
- No deposit, enrolment or redemption endpoint trusts the client for
  gating: profile flag + register membership server-side (the
  gift-cards P0-3 lesson: a UI flag alone is not a gate).
- Deposits are money-in: they appear in the shift's closing expectations
  for their tender.
- Refusals in Spanish, saying the next safe action.
- Nothing changes for registers with both flags off — retail goldens stay
  green.

## 5. Acceptance

On a card-enabled register (mirror «Doco Ventas»):

1. Contact view opens from the strip; shows balance 0, «Sin tarjeta».
2. Activar → enrolled chip flips; Depositar $200 efectivo → balance $200,
   movement row, drawer expectation +$200.
3. Sale with that customer: Cobro shows balance and «Acumula $Y»; pay part
   with monedero → redemption row; after submit cashback row appears and
   balance reflects both.
4. Gift cards: look up a card → panel with ledger; issue/top-up as
   supervisor; redeem in Cobro by code; balances match the doctype ledger.
5. Registers without the flags: no wallet card, no accrual line, no gift
   card tender — and no dead links to any of it.
