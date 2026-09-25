# Paquetes — combos with choices

Status: built on branch `feat/pos-combos-cafeteria-20260925` (2026-09-25), not
deployed. Companion to `COMBOS_GOLDEN_FLOW.md` (fixed Product Bundle combos).

A **paquete** is a combo whose customer picks: «Combo Desayuno $129 — elige tu
bebida, elige tu pan, incluye molletes». A Product Bundle cannot say "one of
these", so the POS now has two kinds of `POS Combo`:

| Combo Type | Contents | Sold as |
|---|---|---|
| Product Bundle (existing) | fixed components in an ERPNext Product Bundle | one line; ERPNext's packing list moves component stock |
| Choice Groups (new) | groups of options on the POS Combo itself | the paquete's line + one line per pick |

## Setting one up (Desk → POS Combo → New)

1. **Combo Type**: Choice Groups.
2. **Combo Item**: the item the register sells, e.g. `CAFE-PAQ-DESAYUNO`. It
   needs an Item Price (the paquete's price) and must be a **non-stock** sales
   item that is **not** a Product Bundle and not a template — the picks carry
   the stock.
3. **Groups**, in the order the cashier should ask them:

   | Group | Min Picks | Max Picks | Any Item From |
   |---|---|---|---|
   | Bebida | 1 | 1 | |
   | Pan | 1 | 2 | Panadería |
   | Incluye | 1 | 1 | |
   | Extras | 0 | 2 | |

   Min 0 makes a group optional. Max above 1 lets an option be picked more
   than once («2 panes» = 2 conchas). **Any Item From** offers every sellable
   item of that Item Group (and its subgroups) at no extra charge, so a new
   pan joins the paquete without editing it.
4. **Options**: one row per answer — Group, Item, Qty per Pick (stock units
   one pick puts on the ticket), **Extra Charge** («Latte +$10», added to the
   paquete price per pick) and **Default** (preselected). A group with a
   single option and a required pick is filled automatically; a group whose
   options are all Default and exactly fill it («Incluye: Molletes») shows as
   *Incluido* and cannot be changed at the till.

Options cannot be templates, serial/batch-tracked items or Product Bundles,
and cannot be the paquete's own item. Priority and Targets work as for bundle
combos (lower priority sorts first; targets decide where the «se suele llevar
junto» strip suggests it).

## At the register

- Adding the paquete's item from anywhere — a desk click, a scan, a phone
  tap, the Combos category, the up-sell strip — opens the **picker** instead
  of adding a line. Each group shows its rule (Elige 1 · Elige de 1 a 2 ·
  Opcional · Incluido), options show their extra charge and «Agotado» when
  the register blocks overselling and the shelf is out. The primary names
  what is missing («Elige Pan») and jumps to it; with everything answered it
  adds the paquete at its total. Desk keys: 1–9 pick in the group that still
  needs an answer, Enter adds, + / − change how many paquetes.
- The cart, the payment summary and the phone draw **one row** per paquete
  with its picks listed («Latte +$10.00 + Concha + Molletes») and the extra
  charges in its amount. Tapping the picks (desk) or «Cambiar opciones» in the
  phone's line sheet re-opens the picker on the current picks. Removing the
  paquete removes its picks; changing its quantity scales them.
- A paquete is never merged with another line, and a later plain «Capuchino»
  never merges into a paquete's $0 capuchino.
- Paquetes are sold on a ticket (Invoice). On Order/Quotation the register
  refuses them with a message: Sales Order lines cannot yet name their
  paquete.

## What lands on the invoice

```
Combo Desayuno        1   129.00   ← the paquete item, its own Item Price
  Latte               1    10.00   ← pick: rate = extra charge, pinned
  Concha              1     0.00   ← pick
  Molletes            1     0.00   ← pick
```

- **Money**: the paquete line carries its price; each pick carries only its
  extra charge. Revenue therefore lands on the paquete item (plus upcharges on
  the picked items), taxed by their own item tax templates.
- **Stock**: each pick is a real line, so stock picks move their own stock.
- **Kitchen**: picks route to their stations like any line (the paquete line
  prints too, on its own station or General).
- **CFDI**: Facturapi skips zero-amount lines, so the CFDI shows the paquete
  and any upcharged pick, never $0 conceptos.
- **Fields**: a pick carries `posa_combo_parent` (the paquete line's
  `posa_row_id`) and `posa_combo_group`; the paquete line carries its picks in
  `posa_combo_components` (JSON).

## What the server guarantees

`api/combo_choice.py` answers posawesome's own `posa_price_guard_exemptions`
hook and `assert_combo_lines` runs first on both submit paths. A pick is
vouched for only when the ticket carries the paquete line it names, that
paquete still exists, the item is an option of the named group, the quantity
is whole picks, the price is exactly the option's extra charge with no
discount, and every group lands between its min and max. Anything else is
refused with its reason («Combo Desayuno necesita 1 de «Pan» por paquete; el
ticket tiene 0»), and a pick that is not vouched for still meets the normal
rate guards. Returns are judged against the sale: a returned pick must match
a pick of the original invoice (same paquete line, item, group and price) and
cannot exceed it, so partial returns work. The rules are pure
(`combo_choice_rules.py`) and covered by the standalone suite.

## Table orders

On a cuenta (POS Table Order) the paquete travels in `POS Table Order Item`'s
`combo_parent` / `combo_group` / `combo_components`; resuming a cuenta brings
the picks back pinned, and settle maps them onto the invoice with the same
fields, so the same voucher applies.

## Known limits

- The receipt print format is tenant data: until it indents `posa_combo_parent`
  lines, picks print as their own lines at $0.00.
- A paquete's saving («Ahorras $12») is shown only when the picks' list prices
  exceed the paquete's total.
- Returns: the register's return picker lists the sale's lines as they were
  sold — the paquete line and each pick. Returning the paquete line refunds
  its price; returning a pick refunds its extra charge and puts its stock
  back. Nothing forces them to travel together (a customer may return only
  the juice), and the server checks each returned pick against the sale.
- Paquetes cannot be sold on Sales Orders or Quotations yet.
- Extra charges are in company currency and converted at the invoice's rate.
