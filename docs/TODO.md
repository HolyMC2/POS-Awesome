# POSAwesome — TODO

Tracks deferred cleanups + design follow-ups. Newest entries on top.
Cross-link from code with `docs/TODO.md → "<heading>"`.

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
