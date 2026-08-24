# Legacy-field inventory and migration classification (2026-08-15)

Roadmap deliverable: Foundation 0 "inventory all POS Profile fields, capability
reads, mode presets and giros" and the Foundation 1 prerequisite "inventory and
classify all legacy POS Profile reads before migrating any flag"
([`POS-WORLDCLASS-ROADMAP.md`](POS-WORLDCLASS-ROADMAP.md) §14).

Baseline: [`POS-PROFILE-SPEC.md`](POS-PROFILE-SPEC.md) (2026-07-11) traced all
99 then-existing non-layout custom fields and drove the P0 server backstops,
P1 dead-field removal and P2 renames — all closed. This document carries the
inventory forward to today and adds the three legs the roadmap asks for that
the July audit did not cover: capability reads, mode presets and giros.

Classes used below:

- **server-policy** — read on a money/authz path server-side; stays a POS
  Profile field (or moves to server policy), never a client-writable override.
- **presentation** — UI/layout/vocabulary; candidate for the typed capability
  contract / override allowlist.
- **hardware** — printer/scanner/display binding; belongs to the terminal
  hardware profile the contract references (§3), not the merged policy layers.
- **client-domain** — client-only by design and safe there (offline prefs the
  server re-validates at sync, print bindings).
- **DEAD** — defined, zero readers; removal patch candidate.

## 1. POS Profile field delta since 2026-07-11

Current: **117 non-layout custom fields** in `posawesome/fixtures/custom_field.json`
(was 99 + saldo_enabled). Removed since the spec: the 6 dead fields
(`remove_dead_pos_profile_fields` patch), `pose_use_limit_search` (renamed
`posa_use_limit_search`), and `saldo_enabled` (moved to the saldo app's own
fixture). The July verdict tables remain accurate for the surviving fields.

### New fields (24, added 07-11 → 08-15)

| field | consumer | class | disposition |
|---|---|---|---|
| posa_capability_profile | `api/vertical.py` resolver | **the seam** | Link → POS Capability Profile; stays. This IS the contract pointer. |
| posa_use_charge_requests | `charge_requests.py:65` (server) | server-policy | **Legacy duplicate** of capability token `external_document_checkout` — code accepts either (`charge_requests.py:10`). Migration: fold into the token, deprecate the flag after tenant sweep. |
| posa_lean_vertical_layout | `verticalStore.ts` | presentation | Deliberate two-level pair: preset `layout.lean_vertical` is an OPTIONAL default, this flag is the per-register override (verticalStore.ts:44-50). This is the override-allowlist pattern in miniature — generalize it, don't deprecate it. |
| posa_hide_items_until_search | `ItemsSelector.vue` | presentation | override-allowlist candidate. |
| posa_allow_source_account_override | `cash_movement/validation.py`, `service.py` | server-policy | stays. |
| posa_allowed_source_accounts | cash_movement validation/service | server-policy | stays. |
| posa_allowed_expense_accounts | cash_movement validation | server-policy | stays. |
| posa_default_source_account | cash_movement validation | server-policy | stays. |
| posa_bank_deposit_account | `safe_transfer/service.py` | server-policy | stays. |
| posa_enable_safe_transfer | safe_transfer service | server-policy | stays. |
| posa_safe_transfer_max_amount | safe_transfer service | server-policy | stays. |
| posa_force_close_stale_shift | `shifts.py`, `invoice_processing/creation.py` | server-policy | stays. |
| posa_cfdi_enable_stamping | `api/cfdi.py` + FE | server-policy | stays; fiscal boundary flag (§11). |
| posa_enable_awesome_dashboard | `api/dashboard.py` | server-policy | stays (dashboard endpoints gate on it). |
| posa_allow_company_dashboard_scope | `api/dashboard.py` | server-policy | stays. |
| posa_low_stock_alert_threshold | `api/dashboard.py` + Reports FE | server-policy | stays. |
| posa_closing_shift_print_format | `usePosShift.ts` | client-domain | print/document binding; later joins the contract's print bindings. |
| posa_enable_customer_display | Pos FE | hardware | → terminal hardware profile. |
| posa_auto_open_customer_display | FE | hardware | → terminal hardware profile. |
| posa_qz_printer_name | print pipeline FE | hardware | → terminal hardware profile. |
| posa_qz_density | `qzTray.ts` | hardware | → terminal hardware profile. |
| posa_qz_interpolation | `qzTray.ts` | hardware | → terminal hardware profile. |
| posa_qz_cut_after_print | `qzTray.ts` | hardware | → terminal hardware profile. |
| ~~posa_scale_barcode_start~~ | — | **REMOVED 2026-08-23** | `add_embedded_barcode_scheme` deletes the Custom Field, the fixture record and the hooks entry. `posa_gr_embedded_barcode_scheme` (Select: blank / weight / price) is what now answers the question this Int appeared to ask; the 20–25 prefix range is fixed by GS1 and is not configuration. |

Site-config (not profile) money kill-switches, for completeness:
`posa_mpesa_enabled` (`api/m_pesa.py`, `frappe.conf`). Class server-policy.

## 2. Capability contract — current state (payload v3)

Source of truth: `doctype/pos_capability_profile/pos_capability_profile.py` +
`api/vertical.py`.

- **Payload version:** `CAPABILITY_PAYLOAD_VERSION = 3`. Stamped on the payload;
  the offline write queue stamps it on queued invoices and drafts a
  `capability_version_mismatch` fallback instead of replaying across a shape
  change (`offline/invoices.ts`).
- **Resolution states:** `resolved` / `invalid` (dangling link blocks Pay and
  server submission via `assert_capability_configuration`) / last-known-good
  (7-day Redis stamp) for transient failure / `None` = unconfigured legacy →
  FE built-in `retail-phones` defaults. No silent retail fallback for a LINKED
  profile — F1 safety slice, done 2026-08-14.
- **Schema (all typed, validated at edit time):** layout
  (`items_view` list|card, `items_panel` standard, `cart_style` table,
  `dock_tabs` ⊆ browse|offers|cart|coupons|pay|floor, `lean_vertical`),
  `capabilities` CSV with optional `:Role` suffix, `labels` JSON vocabulary,
  `print_format`, `invoice_mode` ∈ ""|Sales Invoice|POS Invoice|Record Only.
- **Known capability tokens (5)** and their enforcement locus:

| token | UI consumer | server enforcement |
|---|---|---|
| tables | floor/dock | `restaurant/_tickets.assert_tables_capability` — 12 endpoints, role-suffix enforced (audit r2 840679b47) |
| tips | settle sheet | `restaurant/tips.py:_tips_capability_enabled` — settle refuses tips without the token |
| external_document_checkout | verticalStore | `charge_requests.py` — token OR legacy `posa_use_charge_requests`, role-suffix enforced (Wave B4) |
| service_types | vocabulary/UI | UI-only (document/tax policy still server-validated generally) |
| tab_identity | ticket naming UI | UI-only |

- **FE resolver:** `posapp/stores/verticalStore.ts` — single consumer, merges a
  sparse preset over retail-phones defaults; `has()` is the only capability
  read API components use.

## 3. Mode presets (POS Capability Profile rows)

| preset | invoice_mode | capabilities | seeded by |
|---|---|---|---|
| retail-phones | (built-in) | — | FE default; no row, used when `posa_capability_profile` is empty |
| cafeteria-counter | Sales Invoice | tab_identity, service_types | boat `seed/vertical_templates.py` |
| restaurante-mesas | Record Only | tab_identity, service_types, tables, tips (lean_vertical=1) | boat template + abordo `setup/presets/restaurante.py` (first-writer wins, rows identical by test) |
| clinica-mostrador | Sales Invoice | tab_identity | boat template (copy of abordo clinica preset) |

Repair-shop and retail giros deliberately ship NO preset row (retail-phones
default + profile flags). The roadmap's certified-mode versioning (F1 "certified
mode version") is NOT yet represented — presets have no version field of their
own; only the payload schema is versioned.

## 4. Giros → verticals (doco `docoutils/giros.py` GIRO_MAP, 24 entries)

| vertical | giros |
|---|---|
| retail_general (12) | abarrotes, carniceria, comercio, farmacia, ferreteria, florería, fruteria, joyeria, mueble, otro, papeleria, refacciones |
| repair_shop (4) | bicicletas, celulares, electronica, taller_mecanico |
| servicios (4) | barberia, mascotas, reparto, unas |
| restaurante (2) | cafeteria, restaurante |
| ropa_moda (1) | ropa |
| clinica (1) | clinica |

`KNOWN_VERTICALS` = the 6 above. Certification status vocabulary (§8 of the
roadmap) is not yet stored anywhere machine-readable — `mapped` is implicit in
GIRO_MAP membership; `seeded`/`workflow-ready`/… have no ledger. That gap is
the F0 "certification dashboard and artifact vocabulary" item.

## 5. Migration classification summary

Feeding the F1 typed override allowlist:

1. **Override-allowlist v1 candidates (presentation, already client-only✓ in
   the July tables + above):** items view/density/dock ordering are ALREADY in
   the capability contract; `posa_lean_vertical_layout` already implements the
   preset-default + per-register-override pair the allowlist should generalize.
   Stragglers worth admitting: `posa_hide_items_until_search` and the July
   CLIENT-ONLY✓ display prefs (`posa_display_*`, `posa_input_qty`,
   `posa_new_line`, card/list defaults).
2. **Fold-into-token:** `posa_use_charge_requests` →
   `external_document_checkout` (dual-path code already exists).
3. **Hardware profile extraction:** the 6 hardware-class fields above plus the
   July print prefs (`posa_silent_print`, `posa_open_print_in_new_tab`,
   `posa_print_format_rules`) — these are terminal facts, not register policy,
   and today they force one printer config per profile.
4. **Never overridable (server-policy):** every money/authz field — the July
   WIRED set plus the new cash-movement/safe-transfer/dashboard/cfdi/stale-shift
   groups. Client roles/flags remain presentation hints (§11).
5. ~~**Removal patch:** `posa_scale_barcode_start` (DEAD on arrival).~~ ✅ done
   2026-08-23 — `add_embedded_barcode_scheme` removes it and ships the field
   that replaces it (POS-PROFILE-SPEC, «Added 2026-08-23 — venta fraccionada»).

## 6. Open F1 code work this inventory unblocks

- Typed override allowlist over the candidates in §5.1.
- Immutable server-side contract stamp: the payload rides the opening RESPONSE
  and the offline snapshot, but the POS Opening Shift row itself carries no
  contract fingerprint — server-side replay checks rely on the client-stamped
  version. F1 asks for the stamp on the shift row.
- Provenance inspection (`value` / `mode default` / `override` / `why locked`).
- Next-shift activation + emergency capability removal.
- Preset (certified-mode) versioning distinct from payload-schema versioning.
