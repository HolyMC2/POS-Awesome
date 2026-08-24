# POSAwesome — TODO

Tracks deferred cleanups + design follow-ups. Newest entries on top.
Cross-link from code with `docs/TODO.md → "<heading>"`.

---

## Quirks Mode warning on POSAwesome route

**Status:** open. Spotted 2026-05-26 while exercising the saldo dialog
on `/posapp`. Discovered by saldo phase 11 integration; no functional
impact on the saldo flow itself.

**Symptom.** Firefox DevTools console logs:
> This page is in Quirks Mode. Page layout may be impacted. For
> Standards Mode use "<!DOCTYPE html>".

**What we know.** The top-level `/posapp` route emits `<!doctype html>`
correctly (verified via `curl https://<site>/posapp | head`). The
warning must come from a child HTML resource Frappe loads — print
preview iframe, alert toast iframe, offline.html, or one of the
fragments under `posawesome/posawesome/doctype/*/closing_shift_details.html`
which start with a bare `<div>`.

**Action.** Open DevTools > Network > filter `text/html` on a real POS
session; identify which exact resource Firefox flags. For any fragment
whose first line is `<div>` / `<table>` and that gets loaded as a
top-level document, prepend `<!doctype html>` or rewrap so Frappe
templating injects the doctype header. Low priority — purely cosmetic.

---

## Workspace link URL support

**Status:** workaround in place; cleaner fix deferred.

**Background.** We wanted the "POS Awesome" workspace link / shortcut
to point at the `/posapp` web route directly (`link_type=URL`,
`link_to=/posapp`). Frappe v16's `Workspace Link.link_type` enum only
accepts `DocType / Page / Report`; the URL value broke
`bench migrate` (`Cannot set value DataError: link_type`).

**Current workaround (95352acf):**
- Workspace link stays `link_type=Page link_to=posapp` → resolves
  to `/app/posapp`.
- `posawesome/page/posapp/posapp.js` does an immediate
  `window.location.replace('/posapp')` on load → operator never
  actually sees the Desk shell.
- Bypass for devs: `/app/posapp?legacy=1`.

**Cleaner fix:** ship a Property Setter that extends the
`Workspace Link.link_type` enum to include `URL` (and ideally
upstream the change to Frappe). Patch shape:

```python
# posawesome/patches/add_workspace_link_url_option.py
from frappe.custom.doctype.property_setter.property_setter import make_property_setter
make_property_setter(
    "Workspace Link", "link_type", "options",
    "\nDocType\nPage\nReport\nURL", "Text",
    for_doctype=False,
)
```

After the PS lands, the workspace JSON can use `link_type=URL
link_to=/posapp` directly; operators get a clean nav graph without
the bounce hop through `/app/posapp`. Cost: ~10 LoC patch +
regression test. Reverts cleanly via `frappe.delete_doc("Property
Setter", "Workspace Link-link_type-options")`.

**Acceptance:**
- `bench migrate` clean on a fresh DB.
- Workspace shortcut + 2 link entries point at `/posapp`,
  link_type=URL, no controller-side redirect needed.
- `posapp.js` `shouldStayOnLegacy()` branch can be simplified —
  legacy URL still resolves but operators almost never hit it.

---

## Rate-band cap ✅ DONE 2026-08-23

**Status:** re-enabled. The ±band cap guards rate-edit-enabled registers
again, with the opt-out moved from the whole register to the SKU.

**History.** `assert_rates_within_band` (PR-1 security hardening,
REVIEW2/03 §2.3 §10) enforced a ±20% deviation cap on cart line rates
against the Item Price for the profile's price list. On 2026-05-25
(23ca94e6) it was switched off wholesale whenever
`posa_allow_user_to_edit_rate=1`, because Tere's "cambiar pantalla"
flow legitimately quotes MX$400 against a MX$150 price-list entry (the
customer brings their own display and the labour varies per phone model)
and submit was 403'ing. That made the profile flag a full bypass and lost
the fraud/typo cap — 4000 typed for 400 sailed through.

**What shipped.**
1. `posa_px_skip_rate_band` (Check) on **Item** AND on **Item Group** —
   `add_rate_band_controls` patch, `after_migrate`, exported via the
   hooks.py fixture list. Flagging a group covers a whole category
   ("Servicio Técnico") in one row. The patch also flags `PROPINA`,
   whose rate is by definition whatever the customer left — the
   restaurant/tips.py NOTE asking that no Item Price ever exist for it
   was one price import away from failing.
2. `posa_px_max_rate_change_pct` (Percent, default 20) on **POS Profile**,
   same patch. Precedence: explicit `band_pct` argument → profile field
   → hardcoded 20. **0 means "not configured" and falls back to 20**,
   not "no deviation allowed": the patch default does reach existing
   rows, but the column is NOT NULL DEFAULT 0, so 0 is what a cleared
   or meta-bypassing write leaves behind, and reading it as a
   zero-width band would 403 every rate edit on that till. A
   **negative** value is the deliberate per-register kill switch.
3. `_reprice.assert_rates_within_band` enforces the band on
   rate-edit-enabled registers for items without the flag. It judges the
   PRE-discount price the line asserts, so a declared discount (offers,
   pricing rules) passes — discount size stays `enforce_discount_limit`'s
   job and double-gating it would 403 every offer line. Zero/comp lines
   remain the operator's prerogative, unchanged. The rate-edit-OFF branch
   is untouched. An unreadable opt-out flag (code deployed ahead of the
   patch) fails open, because enforcing a band whose exemption cannot be
   read re-creates the May outage.
4. Refusal message names the item, the typed rate, the allowed range, the
   price-list rate and the band — the operator reads it at a till.

**Verified 2026-08-23** on doco-mirror over HTTP, same register
("Doco Ventas", rate edit ON, band 20), same item, same payload, flag the
only difference: unflagged → HTTP 403 carrying the message; flagged →
past the band entirely. Flagged `ST00007` submitted green at 400 against
its 150 list price. Unit suite `api/test_reprice.py` 38 → 56 tests.

**Backfill is per-site and still open.** The flag is deliberately NOT
backfilled by the patch — which SKUs are variable-price is tenant
knowledge, not ours. Per site, flag the labour category rather than the
items:

```
bench --site <site> execute frappe.client.set_value --kwargs \
  "{'doctype':'Item Group','name':'Servicio Técnico','fieldname':'posa_px_skip_rate_band','value':1}"
```

`Recargas` needs the same treatment: an airtime top-up is sold at the
amount the customer asked for, not at a list rate, and on the mirror
TEL010 sold 35 times at 14 against a list 10 (40% over) — it would 403.

Flagging categories is not enough on its own. The item the taller app
bills labour through is named by `Taller App Settings.labor_item_code`,
not by its group — on the mirror that is `MANO-OBRA-TEST`, sitting in
`WHP Child` rather than under Servicio Técnico, so the category flag
missed it and `charge_request_read_model`'s quoted rates would have been
refused. Read that setting per site and flag the item it names.

Then check what a rate-edit register would now refuse before anyone is
standing at it — anything the band would have blocked in the last 90 days
is a candidate for the flag or for a corrected price list. Read the
result by category: a labour/recharge group means "flag it", a retail
group means "the price list is wrong, fix the price list". On the mirror
the 30 hits split 13 Servicio Técnico + 1 Recargas (flagged) against 12
retail SKUs across Celulares / Pantallas / Cargadores / Fundas / Micas /
Activaciones — those last are stale list prices, e.g. MOD00013 listed at
5300 and sold between 500 and 1500.

```
select ii.item_code, i.item_group, count(*) n, min(ii.rate), max(ii.rate), ip.price_list_rate
from `tabSales Invoice Item` ii
join `tabSales Invoice` si on si.name = ii.parent and si.docstatus = 1
join `tabItem` i on i.name = ii.item_code
join `tabItem Price` ip on ip.item_code = ii.item_code and ip.price_list = si.selling_price_list
where si.posting_date >= date_sub(curdate(), interval 90 day)
  and ip.price_list_rate > 0
  and abs(ii.rate - ip.price_list_rate) > ip.price_list_rate * 0.20
group by ii.item_code, i.item_group, ip.price_list_rate
order by n desc;
```

**Open: the band is only as good as the price list it compares against.**
ERPNext's `insert_item_price` (stock/get_item_details.py) rewrites the
Item Price from the transaction rate when Stock Settings
`auto_insert_price_list_rate_if_missing` is on and the acting user can
write Item Price. On doco-mirror that setting is ON with
`update_price_list_based_on = Rate`, `update_existing_price_list_rate =
1`, and three of four cashiers on Doco Ventas hold **Sales Master
Manager** — so `update_invoice` moves the price list to whatever they
typed, and the band at submit then compares against the new number and
passes. Two levers, both Marco's call and both outside this change:
drop `Sales Master Manager` from cashier roles, or turn off
`auto_insert_price_list_rate_if_missing`. Verify the same three values on
prod before assuming the band bites there.
