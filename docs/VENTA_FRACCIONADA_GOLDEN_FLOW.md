# Venta fraccionada — por peso y por importe: the golden flow

Status: acceptance contract for the 2026-08-23 fraccionada round
Companion: `POS-WORLDCLASS-ROADMAP.md` §17.2 (weight/fraction selling),
artboard `Controlado.dc.html` (báscula · tara · price-embedded barcode —
the art already exists; this round builds to it).

Gates abarrotes/carnicería/ferretería granel. Three gestures, honestly
tiered by what can be proven without hardware:

| Gesture | v1 (this round) | Gated later |
|---|---|---|
| Por importe («dame $50 de jamón») | ✔ amount → qty | — |
| Por peso, manual (the scale's display, typed) | ✔ decimal qty entry | — |
| Price/weight-embedded barcode (báscula que etiqueta) | ✔ parse on scan | — |
| Báscula viva (serial/QZ read into the register) | ✗ | physical canary — same gate as the drawer-kick |

`posa_scale_barcode_start` is dead-on-arrival config and is REMOVED by this
round (roadmap already slates it).

## 1. Eligibility

An item is fraction-eligible when its UOM allows decimals
(`must_be_whole_number` = 0 — kg, g, L, m). No new per-item flag. The UI
affordances are additionally gated by a new capability token `fractional`
(preset-level: abarrotes/carnicería presets carry it; a phone shop never
sees a grams pad). Server-side, decimal qty for a whole-number UOM is
refused today by ERPNext — keep that as the backstop and test it.

## 2. Por importe

- The qty editor for an eligible item gains an «$ Importe» mode: type the
  pesos, the register computes qty.
- **Rounding is deterministic and in the CUSTOMER's favor**: qty is chosen
  (3 decimals, floor) so that the charged line amount is ≤ the requested
  importe; the difference shown («$50.00 → 0.312 kg · se cobran $49.92»).
  Never round qty up to reach the importe. A pure module owns the math
  with property tests (charged ≤ asked, always, for every rate).
- The line records qty normally — the importe is an input gesture, not a
  stored fact.

## 3. Por peso (manual)

- Eligible items accept decimal qty at the precision the UOM declares;
  the qty stepper offers a decimal pad («0.475») instead of ±1 for them.
- Tara: a simple minus field in the same pad (peso bruto − tara),
  computed client-side, shown on the line note per the artboard.
- **Sub-unit entry (added 2026-08-24).** A cashier reading a scale says «475»,
  not «cero punto cuatro siete cinco», so the weight mode carries entry-unit
  chips — `Kg | Gram`, `Litre | Millilitre`, `Meter | Centimeter` — and opens on
  the sub-unit. The tara is typed in the same unit, and the readout states both
  («475 Gram = 0.475 Kg · $76.00») because the conversion is the one step the
  operator cannot check against a total in their head.
  The PAIRING is a product decision in code (`SUB_UNIT_PAIRS`); the FACTOR is
  read from ERPNext's `UOM Conversion Factor` table and never invented. **No
  conversion row ⇒ no chip**, and the pad keeps the single-unit field it had.
  Conversion happens BEFORE the single floor-to-precision, so a gram entry
  quantizes on the line's own grid; grams are an input gesture exactly like the
  importe, and the line still records plain qty in the pricing UOM.

## 4. Embedded barcode

- EAN-13 prefix 20–25 family (the labeling-scale standard): item code +
  embedded WEIGHT or PRICE per the register's configured scheme. New
  profile field `posa_gr_embedded_barcode_scheme` (blank / weight / price)
  replacing the dead `posa_scale_barcode_start`. The prefix range is FIXED
  at 20–25, not configuration: it is GS1's reserved band for restricted
  circulation inside one company.
  <br>*Built as `posa_gr_…`, not the bare `posa_embedded_barcode_scheme` this
  doc first named: `scripts/check_fixture_coverage.py` requires a per-vertical
  prefix on every new Custom Field, and this round added `posa_gr_` (granel) to
  its `VERTICAL_PREFIXES`.*
- On scan: resolve the item by its short code, derive qty (weight
  directly, or price ÷ rate via the §2 customer-favor rule), add the
  line, and show «etiqueta de báscula» provenance on it.
- A pure parser module with test vectors (both schemes, check digit,
  malformed labels refuse loudly — a mis-parse here is a mis-charge).

## 4b. The precision precondition (found while building, 2026-08-23)

`Sales Invoice Item.qty` is a plain Float, so the site keeps
**System Settings → float_precision** decimals of it — **2** on the doco
mirror. A line saved as 0.312 kg comes back 0.31 kg charging $49.60, so §5.1's
figures require the site (or the register's `posa_decimal_precision`) set to
**3**. Below that nothing breaks: the pad, the «se cobran» sentence and the scan
path all derive from the register's effective precision and quote 0.31, so the
ticket and the invoice agree. Pinned by
`test_fractional_backstop.test_the_site_keeps_only_float_precision_decimals_of_qty`.

## 5. Acceptance (mirror, an abarrotes-style register with `fractional`)

1. Jamón at $160/kg: importe $50 → 0.312 kg, charged $49.92 (≤ 50),
   difference stated on screen. *(Needs float_precision 3 — see §4b.)*
2. Manual 0.475 kg → line at 76.00; tara 0.020 on 0.495 bruto → same.
3. Embedded-weight label for 0.312 kg scans straight to the line;
   embedded-price label for $49.92 derives the same qty; a corrupted
   label refuses with a sentence.
4. A whole-number item (piece SKU) never shows the grams pad or importe
   mode; server refuses decimal qty for it even via raw payload.
5. A register without the capability shows exactly today's UI.
6. Goldens stay green.
