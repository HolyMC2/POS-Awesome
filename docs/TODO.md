# POSAwesome — TODO

Tracks deferred cleanups + design follow-ups. Newest entries on top.
Cross-link from code with `docs/TODO.md → "<heading>"`.

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

## Rate-band cap

**Status:** disabled 2026-05-25 in `_reprice.py:261` after blocking a
legit prod flow.

**Background.** `assert_rates_within_band` (PR-1 security hardening,
REVIEW2/03 §2.3 §10) enforced a ±20% deviation cap on cart line rates
against the Item Price for the profile's price list. Throws
`PermissionError` → HTTP 403 on submit when exceeded.

**Why it broke prod.** Tere's flow: "cambiar pantalla" service item
priced at MX$150 in the price list (labor estimate) but actual quote
is MX$400 because the customer brings their own display and the labor
varies per phone model + repair difficulty. Submit blocked, operator
stuck. `posa_allow_user_to_edit_rate` was ON for the profile (so the
UI let her type the new rate) but the server band still rejected.

**Current state.** When `posa_allow_user_to_edit_rate=1`, the band
check is skipped entirely. Operator judgment rules. Profile flag is
effectively a full bypass.

**Why this is fine for now.**
- Profile flag is still gating: profiles with `posa_allow_user_to_edit_rate=0`
  still require exact price-list match (master_rate equality branch
  untouched).
- Only trusted POS users have edit-enabled profiles.

**Why this is not the right long-term shape.**
- All-or-nothing per profile. Can't combine "cashier can tweak ±5% on
  retail SKUs" + "cashier can set any rate on labor SKUs" on the same
  profile.
- Loses the fraud-cap intent of the original guard (catch typos like
  4000 instead of 400).

**Cleaner fix (do this when time allows):**
1. Add `posa_skip_rate_band` checkbox on **Item** doctype (or Item
   Group, if you'd rather flag categories like "Mano de Obra").
2. `assert_rates_within_band` skips items with the flag set; band
   still applies to everything else.
3. Optionally promote `DEFAULT_RATE_BAND_PCT` (currently hardcoded
   20%) to a POS Profile field so the cap is tunable per location
   without code changes.
4. Backfill the flag on the variable-price SKUs (cambiar pantalla,
   mano de obra, otros servicios).
5. Restore the band enforcement branch in `_reprice.py:261` —
   re-enable for items WITHOUT the skip flag.

**Files to touch:**
- `posawesome/posawesome/api/_reprice.py:261` — re-add band check
  guarded by the per-item / per-group flag.
- `posawesome/posawesome/doctype/item/` (or fixtures) — custom field
  `posa_skip_rate_band`.
- `posawesome/posawesome/doctype/pos_profile/pos_profile.json` — add
  `posa_max_rate_change_pct` (optional, default 20).
- `posawesome/tests/test_reprice.py` — add cases for flagged item
  bypass + per-profile cap override.

**Acceptance:**
- Cambiar pantalla item with flag → any rate accepted at submit.
- Regular retail item → submit at 2× price-list still 403s with
  current error message (already routed through new toast surfacing
  fix; operator sees the actual reason).
- POS Profile with `posa_allow_user_to_edit_rate=0` → still requires
  exact match (unchanged).
