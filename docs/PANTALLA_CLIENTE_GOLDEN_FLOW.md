# Pantalla del cliente — the golden flow

Status: acceptance contract for the 2026-08-23 customer-display round
Companion: `POS-RIEL-Y-CAJON-BUILD.md` §13.1 (the ranked revamp list's #1:
"the most brand-visible surface in the product, and nothing in this
programme has touched it"), artboard `PantallaCliente.dc.html` (new),
`CUSTOMER_CARDS_GOLDEN_FLOW.md` (the accrual line it reuses).

The screen the CUSTOMER reads while paying. It is a mirror, never a
control: nothing on it is tappable, it holds no session powers, and it must
be legible from 1.5 m.

## 1. States

```
Idle     → brand mark + «Bienvenido» + (optional) the shop's greeting line
Sale     → lines appear as scanned: name · qty · amount; running total BIG
Tender   → TOTAL dominant; on cash entry: «Recibido $500 · Cambio $152»
Done     → «Gracias» + change reminder + cashback earned («Acumulaste
           $15.00 · saldo $433.00») when the customer is enrolled
         → back to Idle
```

- One number dominates every state (the band invariant, at display scale).
- The cashback line renders only for enrolled customers on card-enabled
  registers — absence, not zeros (walletSummary's standing rule).
- es-MX only; brand tokens from `brand.ts` (the display is the brand's
  face — no posawesome mark).

## 2. Contract

- Existing `components/customer_display/` (its own window/route today) is
  REBUILT to the artboard with the design system's tokens; the transport
  (how the register feeds it) stays whatever it is today — this round is
  presentation, not plumbing. Read the existing mechanism first and state
  it in the report.
- Must survive: register offline (shows the sale it knows, no error
  states aimed at customers), no sale (idle), viewport 1280×800 and
  1920×1080.
- Dark-friendly: the display often runs in a dim shop — the artboard's
  palette must hold contrast AA at both sizes.
- Zero new privileges: the display reads presentation events only. If the
  current transport leaks more than it renders, note it — do not widen it.

## 3. Acceptance

1. Play a sale on the mirror with the display open on a second window:
   lines appear as scanned, total tracks, tender shows recibido/cambio,
   done shows gracias + (enrolled customer) the accrual, then idle.
2. Unknown/walk-in customer: no wallet line ever.
3. Kill the register's network mid-sale: the display keeps the sale,
   shows nothing alarming.
4. Brand check: name/logo from brand tokens; no internal identifiers on
   screen.
