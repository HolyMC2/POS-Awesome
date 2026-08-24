# Documentos — cotizaciones y notas de crédito: the golden flow

Status: acceptance contract for the 2026-08-23 documentos round
Companion: `POS-WORLDCLASS-ROADMAP.md` §17.2 («Documents» seam), artboards
`Cotizacion.dc.html` (new), `Devolucion.dc.html` (the NC creation moment),
`Cobro.dc.html` (the redemption side — already the monedero lane).

Two documents, one principle: **the POS never grows a second ledger.** A
cotización IS an ERPNext Quotation; a nota de crédito IS the credit note the
return rail already mints. What is missing is the register surface for each.

## 1. Cotización (muebles / ferretería / big-ticket)

### The loop

```
Build the cart → «Guardar cotización» (validity days, note)
             → printed/PDF quote leaves with the customer
Later        → Cotizaciones surface: find it (folio, customer, estado)
             → «Cargar a la venta» → cart loads with QUOTED prices
             → normal tender; the quotation is marked converted, linked
```

### Contract

- **Create from the cart**: action beside «Guardar y Limpiar», enabled when
  the cart has lines and a real customer (a quote to «Público en General» is
  refused with a sentence — quotes are promises to someone). Fields:
  validity (days, register default), optional note. Creates a real
  Quotation (items, rates, taxes, customer) and clears the register.
- **Recall surface**: a Cotizaciones lane in the flows family (beside
  Borradores/Devoluciones): rows = folio · customer · date · vence ·
  total · estado (Vigente / Por vencer / Vencida / Convertida). Detail
  panel: lines, validity, totals, actions.
- **Convert**: «Cargar a la venta» hydrates the cart from the quotation.
  Within validity, the QUOTED rate wins over today's list rate and the line
  says so (provenance, same idiom as price overrides). An expired quote
  loads at TODAY's prices with a visible warning naming both totals. Submit
  links the invoice to the quotation (ERPNext's own mapping — investigate
  `make_sales_invoice` from Quotation and use the real linkage); a
  converted quotation shows Convertida with the invoice folio and cannot be
  silently converted twice (loading it again warns and links the first
  invoice).
- v1 converts whole quotes (the cart is editable after load); per-line
  partial conversion is out of scope and said so on screen when relevant.
- Offline: creation requires the server (a folio is a promise) — offline
  the action is disabled with the standard offline affordance. Recall is
  online-only like Facturas.

## 2. Nota de crédito

The redemption side already exists and is being finished in the tarjetas
round: a customer's credit notes ARE part of `get_available_credit`, spent
in Cobro as the monedero tender. This round builds the CREATION and
VISIBILITY sides:

- **In Devolución**: the refund method is an explicit choice —
  «Efectivo» (as today) or «Nota de crédito». Choosing NC mints the credit
  note against the customer (a return to Público en General cannot choose
  NC — credit needs an owner), prints it (folio + amount + customer +
  QR/code), and says where it lives: «se abona al monedero de {cliente};
  se usa en cualquier compra». Partial returns already pick lines; the NC
  covers exactly the returned amount.
- **Visibility**: the customer's NCs appear in the contact view's
  movements (the tarjetas round's `get_customer_wallet` already sources
  credit notes) and the return detail links its NC.
- **Print format**: a real 80mm NC format in the fork's print-format
  family, es-MX.

## 3. Guardrails

- Quoted-price honoring is bounded by validity — no eternal price locks.
- Both surfaces are register-scoped and permission-checked server-side
  (profile membership; the P0-3 lesson).
- Retail goldens stay green; registers never showing these surfaces render
  no dead links.

## 4. Acceptance (live on the mirror)

1. Cart with 2 items + real customer → Guardar cotización (7 días) →
   Quotation exists, register clean, printable.
2. Cotizaciones lane lists it Vigente; Cargar a la venta → same rates even
   after a price-list change on one item (provenance shown); submit →
   quotation Convertida, linked both ways.
3. Re-load the converted quote → warned + linked, no second silent sale.
4. Expire a quote (backdate validity) → load reprices at today with the
   two-totals warning.
5. Return one line of a sale, refund as NC → credit note minted, printed,
   visible in the contact view; pay part of a NEW sale with it in Cobro.
6. Público en General: quote refused, NC refund not offered — both with
   the explaining sentence.
