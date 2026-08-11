# POS customer + fiscal surfaces map (CFDI groundwork)

> As of commit ee46f76fd (2026-08-11). Survey of the customer dialog/store/backend chain, EMC mx_* fields, SAT catalogs, validation engine. file:line refs drift — verify. Companion: SPA_CONVENTIONS.md.

## 1. Customer dialog

`components/pos/dialogs/customer/UpdateCustomer.vue` (~770, Options API), hosted by `components/pos/customer/Customer.vue`. Opened via `customersStore.openUpdateCustomerDialog(customerOrNull)` (store-driven, not bus); three openers: Customer.vue new/edit + usePaymentMethods when contact_mobile missing.

Fields today: customer_name*, tax_id (FREE TEXT — no RFC validation), mobile_no, address_line1, city, country (hardcoded 37-country array, default "Pakistan"; profile `posa_default_country` overrides at runtime), email_id, gender, referral_code, birthday (hand-rolled DD-MM-YYYY), customer_group*, territory*. NO pincode, NO state, NO mx_tax_regime, NO mx_cfdi_use. `hideNonEssential` switch (localStorage) hides address+group+territory — including the two REQUIRED fields (trap for new required fields).

Submit → single endpoint `posawesome...api.customers.create_customer` with `method: "create"|"update"`; offline branch → `saveOfflineCustomer`. Error surfacing is 3-way inconsistent: client frappe.throw modals, server rejections deliberately swallowed (sound + console.warn, relies on Frappe dialog), generic toast losing the server message. No :rules/:error-messages/v-form anywhere. Success writes only 6 fields back to the local cache.

## 2. customersStore + offline projection chain

`stores/customersStore.ts` (~870). `StoredCustomer` carries tax_id; NO mx_* anywhere in posawesome (grep zero). Any new field must pass THREE projection bottlenecks or is silently dropped: (1) backend field list in api/customers.py get_customer_names/search; (2) `offline/customers.ts setCustomerStorage` explicit `clean` object; (3) Dexie index `offline/db.ts` customers schema. Caching: Dexie + keyset-cursor paged pull (PAGE_SIZE 1000) + count verify + profile-scope wipe. Search: client-side over Dexie (token AND, field OR across name/customer_name/mobile/email/tax_id) with server fallback `search_customers` (limit 25) when IDB empty; view capped at 50 rows; rows are `shallowRef`+`markRaw` immutable — never mutate per-row in place.

## 3. Backend api/customers.py

Guard pattern: every WRITE endpoint's first statement `_assert_customer_write_allowed(pos_profile_doc, company)`. Reads are group-scoped but trust a client-supplied pos_profile blob. `create_customer`: create writes name/tax_id/contact/referral/birthday/type/gender + group/territory fallbacks; update does NOT touch group/territory; address always `"Shipping"` with **`pincode: ""` hardcoded**; never sets `customer_primary_address`. Duplicate names = idempotent-success (returns existing) under posa_allow_duplicate_customer_names.

**Key gap:** EMC's `overrides/customer.py` uppercases/validates RFC only when `is_mexican` — which reads `customer_primary_address → Address.country`, and POS-created customers never get a primary address ⇒ EMC's RFC machinery is INERT for every POS-created customer. Duplicate tax_id hard-throws (XAXX/XEXX exempt).

## 4. EMC (erpnext_mexico_compliance) inventory

Customer mx_* Custom Fields: `mx_tax_regime` (Link SAT Tax Regime, after tax_id), `mx_cfdi_use` (Link SAT CFDI Use), `mx_addenda`; patch-only (NOT on all sites): mx_csf_id_cif, mx_csf_date. Company-mx_tax_regime exists. Sales Invoice carries ~21 mx_*/cfdi fields (mx_uuid, mx_sat_status, mx_payment_option PUE/PPD, mx_cfdi_use, mx_payment_mode, mx_stamped_xml, cancellation set…); POS Invoice same minus facturapi id. EMC fixture selector is module-broad (self-maintaining) — consuming mx_* needs NO posawesome fixture work; a NEW posawesome-owned field needs a prefix registered in scripts/check_fixture_coverage.py VERTICAL_PREFIXES.

SAT catalogs (all `autoname field:key`, name==key, data fixtures): SAT Tax Regime (19), SAT CFDI Use (24, with tax_regimes child table for régimen-compat), SAT Payment Method (22 formas), SAT Payment Option (PUE/PPD). `key_name` is the ready "CODE - Description" display label.

## 5. Ready-made EMC backends — reuse, don't reinvent

- Cascading uso-by-régimen link query: `controllers/queries.py cfdi_use_query` (frappe link-query signature — 6 positional args from frappe.call).
- Catalog bulk fetch, guest-safe rate-limited: `api/v1/public.py get_catalogs()` → {tax_regimes, cfdi_uses, payment_options}.
- Validation L0 (es-MX messages): `fiscal/validation/engine.py validate_fiscal_input(tax_id, regime, uso, cp, name, deep)`; `validate_entity`; `first_error`; `invoice_is_ready`. Whitelisted wrappers in `fiscal/validation/preflight.py` return `checks[].{code,level,ok,message,field}` where field ∈ tax_id|mx_tax_regime|mx_cfdi_use|zip_code — maps 1:1 onto Vuetify :error-messages. RFC helpers in fiscal/validation/rfc.py (normalize, kind, generic, checksum).
- CSF ingest with confirm-then-apply diff: `fiscal/validation/csf_api.py upload_csf(customer, file_url, apply)`.
- Full stamp path: `overrides/sales_invoice.py stamp_with_review(invoice_name, customer?, …, mutate_existing)` — creates Customer+Address itself when customer falsy; `mutate_existing=False` is the "untrusted input never overwrites existing fiscal identity" guard. Reference consumer: `doco/docoutils/storefront/factura.py` (validates FIRST via engine, then stamps).
- Postal code lives on Address.pincode, NOT Customer (DIR-020/DIR-021 checks). CFDI needs a Billing address with pincode.

## 6. Fixture guard essentials

hooks.py `fixtures` has EXACTLY ONE Custom Field entry (220 names; in-file comment explains why a second entry destroys the export). `scripts/check_fixture_coverage.py` (CI-wired): one-entry invariant, hooks↔json bijection, prefix rule (GRANDFATHERED frozen set + VERTICAL_PREFIXES posa_rt_/posa_tl_), patch fieldname coverage.

## 7. Test conventions (frontend)

Vitest flat `frontend/tests/`, camelCase. Store specs: module-top `vi.mock("../src/offline/index")` full-surface stub; setActivePinia per test; public-API assertions only. Component specs: `// @vitest-environment jsdom` pragma; mock heavy children; REAL Vuetify components can't register (per-component CSS breaks vitest ESM) — hand-rolled defineComponent stubs honoring the instance surface the code touches. Mirror: customersStore.spec.ts, customerSelectorAffordances.spec.ts.
