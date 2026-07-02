# POSAwesome ⇄ mercadopago_connector — "Cobrar con terminal MP" button

Implementation guide for adding a **Point push-to-terminal** button to POSAwesome.
The **mercadopago_connector backend is done + tested** (it pushes the order to the
terminal, books the payment, and auto-matches it to the invoice). This document
specifies the connector contract (frozen) and hands the **POSAwesome Vue work** to
a posawesome-focused agent.

> Scope marker: tag every POSAwesome edit with `// MP-INTEGRATION-POINT` so the
> fork stays rebase-safe (same convention as saldo's `SALDO-INTEGRATION-POINT`).
> Everything is flag-gated and must no-op when disabled.

---

## 1. What the connector already does (don't rebuild)

- `create_point_order` → POSTs an order to the MP terminal (Orders API),
  `external_reference = POS Invoice name`.
- The terminal charge completes → MP `orders` webhook (or a janitor poll backstop)
  → connector **books the MercadoPago Payment** and, because `external_reference`
  is the invoice, **confidently auto-matches** it (status → `Reconciled`,
  stamps `mp_payment_id`/`mp_external_reference` onto the existing Payment Entry).
- **PE ownership unchanged:** POSAwesome still creates the Payment Entry via the
  *MercadoPago Point* Mode of Payment when the sale is finalized. The connector
  **never creates a second PE.** The button only *confirms the terminal charge
  succeeded*; the normal MoP flow books the money.

So the POSAwesome job is purely UX: trigger the charge, show status, and let the
cashier finalize once approved.

---

## 2. Connector API contract (frozen)

All under `mercadopago_connector.api.point.*`. Roles: System Manager, Accounts
Manager/User, Sales Manager/User (cashiers). Call via `frappe.call`.

| Method | HTTP | Args | Returns |
|---|---|---|---|
| `create_point_order` | POST | `pos_invoice` (str, optional — pass the invoice name so it auto-matches), `amount` (number, required), `terminal_id` (str, optional — defaults to Settings) | `{ ok, order: { name, order_status, mp_order_id, error_message } }` |
| `point_order_status` | GET | `order` (the order `name` from create) | `{ order_status, error, payment: { status, amount_gross } | null }` |
| `cancel_point_order` | POST | `order` | `{ ok }` (only while `created`/`at_terminal`) |
| `list_enabled_terminals` | GET | — | `[ { terminal_id, pos_id, store_id, operating_mode } ]` |

**`order_status`** lifecycle: `Local Draft → created → at_terminal → processing →
finished` (terminal), or `expired` / `canceled` / `error`.

**On `finished`**, read `payment.status`:
- `Approved` → success (charge captured). Proceed to finalize the sale.
- `Rejected` / order `expired` / `canceled` → not paid; let the cashier retry or
  pick another method.

**Realtime (best-effort):** the connector also emits a `mercadopago_order` event
after each state change:
```json
{ "order": "...", "external_reference": "...", "pos_invoice": "...",
  "status": "created|at_terminal|processing|finished|expired|canceled|error",
  "detail": null, "payment": "MPP-..." }
```
⚠️ It is published from a background worker, so it may not reach the cashier's
session reliably. **Use polling (`point_order_status` every ~2s) as the primary
mechanism**; treat `mercadopago_order` as an optional latency optimization. (If you
want realtime to be authoritative, the connector must publish to a room keyed by
`external_reference` and the POS subscribe to it — out of scope here.)

---

## 3. Gating (must no-op when off)

Show the button only when **both**:
- `frappe.boot.mercadopago?.enabled` (the connector sets this via `boot_session`), and
- the active **POS Profile** has `mp_point_enabled = 1` (custom field already
  installed by the connector).

When off, render nothing — zero behavior change for mumu/retail profiles.

---

## 4. UX flow

1. Cashier adds the **MercadoPago Point** Mode of Payment for the amount.
2. Clicks **"Cobrar con terminal MP"** (next to that MoP row).
3. Frontend resolves a `terminal_id` (Settings default, or a picker via
   `list_enabled_terminals`) and the `pos_invoice` name (pass the current
   draft/POS invoice name so auto-match works — see §5), then calls
   `create_point_order({ pos_invoice, amount, terminal_id })`.
4. Open a **status modal**: "Enviando a la terminal…". If `create` returns
   `ok:false` / `error_message`, show it and stop.
5. **Poll** `point_order_status(order.name)` every ~2s:
   - `created`/`at_terminal` → "Esperando que el cliente pague en la terminal…"
     (show a **Cancelar** button → `cancel_point_order`).
   - `processing` → "Procesando…".
   - `finished` + `payment.status == "Approved"` → "✅ Pago aprobado" → close,
     mark that MoP row as paid, enable finalizing the sale.
   - `finished` + other / `expired` / `canceled` / `error` → "❌ No se completó"
     → let the cashier retry or choose another method.
   - Stop polling after a timeout (e.g. matches Settings `order_expiration`, ~15 min)
     and show "Tiempo agotado — verifica la terminal".
6. Finalize the sale normally (the MoP PE is created by POSAwesome; the connector
   auto-matches the booked payment to the invoice in the background).

---

## 5. `pos_invoice` / external_reference note

Auto-match needs `external_reference` to equal the POS Invoice name. At payment
time POSAwesome usually has a draft/named invoice — **pass that name** as
`pos_invoice`. If the invoice isn't named yet, omit `pos_invoice`; the charge
still books (unmatched) and an operator reconciles it later (`Match to Invoice`).
Prefer naming the invoice first so the match is automatic.

---

## 6. Implementation tasks for the POSAwesome agent

- [ ] Add a small service `mp_point.js/ts` wrapping the 4 `frappe.call`s above.
- [ ] Add the **"Cobrar con terminal MP"** button in the payments component, next
      to the *MercadoPago Point* MoP row, gated per §3. Mark `// MP-INTEGRATION-POINT`.
- [ ] Add a **status modal** Vue component (states per §4); reuse POSAwesome's
      existing dialog/modal style.
- [ ] Read gating from `frappe.boot.mercadopago` + active POS Profile
      `mp_point_enabled`.
- [ ] Polling loop (~2s, with timeout); optional `frappe.realtime.on('mercadopago_order', …)`
      to short-circuit the poll when an event arrives for this `external_reference`.
- [ ] Keep all edits flag-gated + marked; no behavior when the connector is disabled.
- [ ] Confirm exact file locations in the `doco-customizations` branch (payments
      component, dialogs, services dir) — this guide intentionally leaves the Vue
      file paths to you.

---

## 7. Build / deploy / test

- **Lab:** `cd ~/muelle-host/muelle && ./scripts/dev-refresh.sh posawesome`
  (Vite build + asset sync + proxy). After deploy you may need a Service Worker
  unregister + `caches.delete` in the browser (POSAwesome SW serves stale chunks).
- **Prod (gated):** commit the fork, then `./scripts/posawesome-push-prod.sh [--build] --yes`.
- **Test without hardware:** set MercadoPago Settings `Base URL = mock://mercadopago`.
  Then either click the button or, from a bench console:
  ```python
  from mercadopago_connector.services import point
  name = point.create_and_dispatch(amount=120.0, terminal_id="MOCKTERM1", external_reference="INV-PT-0")
  point.poll_order_once(name)   # mock terminal "finishes" → payment booked
  ```
  (external_reference ending in `0` → approved/finished; ending in `2` → stays
  processing — handy for exercising the modal's waiting state.)
- Playwright on lab POS to screenshot the button + modal states.

---

## 8. Hardware reality

Push-to-terminal needs a **Smart terminal in PDV / Orders-API mode**. The current
shops use **standalone** terminals (cashier keys the amount on the device) — so on
that hardware this button can't drive the terminal; it's ready for when PDV
terminals are enabled. Until then, the connector's standalone **reconciliation**
flow (v1) is what runs in production.
