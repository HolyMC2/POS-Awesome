# 07 — API Contracts Audit

Scope: every `@frappe.whitelist()` exposed by the fork, the TS layer that
consumes it, and what's missing to ship those endpoints as a stable
multi-tenant SaaS contract.

Method counts (this branch, `doco-customizations`):
- `@frappe.whitelist()` decorators: **168** across 44 Python files
  (`posawesome/posawesome/api/*` + `posawesome/posawesome/doctype/pos_closing_shift/closing_processing/*`).
- Distinct dotted methods referenced by the SPA: **~80** under
  `posawesome.posawesome.api.*` (`frontend/src/**`).
- That means roughly **half of the whitelisted surface has no observed
  frontend caller in this repo** — either internal, dead, called via
  Frappe Desk, or called by third parties (CFDI, hooks, server scripts).
  Audit treats those as **untyped public surface area** until proven
  otherwise.

Upstream `fix-api-docs-generating` was inspected — despite the name it's
defendicon's everyday feature branch (multi-currency rounding, totals
refresh, payment_processing tweaks). It **does not** contain an OpenAPI
generator, a docs pipeline, or schema annotations. There is no upstream
"api docs" artifact to pull from.

---

## 1. Endpoint inventory

Below: every whitelist endpoint, grouped by file, with the request shape
(positional params from the Python signature), the return shape we
observed, and the primary frontend consumer. Method allowlist defaults
to **GET+POST** (Frappe default) unless `methods=` is set.

### 1.1 Public-facing POS lifecycle

| Method | File:Line | Methods | Args | Returns | Frontend caller |
|---|---|---|---|---|---|
| `api.utils.get_active_pos_profile` | `posawesome/posawesome/api/utils.py:111` | GET/POST | `user=None` | `dict` POS profile or `None` | `frontend/src/utils/pos_profile.ts:82,102` |
| `api.utils.get_default_warehouse` | `api/utils.py:123` | GET/POST | `company=None` | `str` | `components/pos/items/Variants.vue:330` |
| `api.shifts.get_opening_dialog_data` | `api/shifts.py:13` | GET/POST | – | `dict { companies, pos_profiles_data, payments_method, ... }` | `components/pos/shift/OpeningDialog.vue:242` |
| `api.shifts.create_opening_voucher` | `api/shifts.py:59` | GET/POST | `pos_profile, company, balance_details` | `POS Opening Shift` doc | `OpeningDialog.vue` (indirect) |
| `api.shifts.check_opening_shift` | `api/shifts.py:83` | GET/POST | `user` | `dict` or `None` | bootstrap loader |
| `api.utilities.get_app_info` | `api/utilities.py:179` | GET/POST | – | `dict { apps[] }` | `components/navbar/AboutDialog.vue:159` |
| `api.utilities.get_pos_profile_tax_inclusive` | `api/utilities.py:480` | GET/POST | `pos_profile:str` | `dict {posa_tax_inclusive:bool}` | `posapp/layouts/DefaultLayout.vue:1088`, `loader.ts:398` |
| `api.utilities.get_selling_price_lists` | `api/utilities.py:168` | GET/POST | – | `list[str]` | not directly observed |
| `api.utilities.get_current_user_language` / `set_current_user_language` | `api/utilities.py:793,827` | GET/POST | `lang_code` (set) | `dict` | `components/navbar/NavbarMenu.vue:742,781` |
| `api.utilities.get_remote_update_info` | `api/utilities.py:362` | GET/POST | – | `dict { branch, ahead, commits[] }` | `stores/updateStore.ts:432` |
| `api.utilities.get_database_usage` / `get_server_usage` | `api/utilities.py:488,575` | GET/POST | – | `dict` | NavbarMenu / DefaultLayout |
| `api.utilities.log_client_error` | `api/utilities.py:903` | GET/POST | `payload` | `bool` | error reporter |

### 1.2 Items + catalog

| Method | File:Line | Args | Returns | Frontend caller |
|---|---|---|---|---|
| `api.item_processing.search.get_items` | `api/item_processing/search.py:564` | `pos_profile, price_list, item_group, search_value, customer, currency, limit, ...` (kwargs, stringly typed) | `list[ItemRow]` (~25 fields, see §3) | offline worker + `useItemsSelector.ts` |
| `api.item_processing.search.get_items_count` | `search.py:676` | `pos_profile, item_groups=None` | `int` | offline worker |
| `api.item_processing.search.get_items_groups` | `search.py:667` | – | `list[str]` | item selector |
| `api.item_processing.details.get_items_details` | `details.py:11` | `pos_profile, items_data, price_list=None, customer=None` | `list[ItemDetail]` | `components/pos/shell/BarcodePrinting.vue:875`, useItemsSelector |
| `api.item_processing.details.get_item_detail` | `details.py:43` | `item, doc=None, warehouse=None, price_list=None, company=None` | `dict` | `Variants.vue:342` |
| `api.item_processing.details.get_item_variants` | `details.py:194` | `pos_profile, parent_item_code, price_list=None, customer=None` | `list` | `Variants.vue:245` |
| `api.item_processing.details.get_item_attributes` | `details.py:281` | `item_code` | `dict` | – |
| `api.items.get_delta_items` | `api/items.py:87` | `pos_profile, modified_after, price_list=None, limit=...` | `list[delta-row]` | offline worker delta refresh |
| `api.items.get_item_brand` | `api/items.py:221` | `item_code` | `str` | – |
| `api.item_processing.barcode.parse_scale_barcode` | `barcode.py:248` | `barcode:str` | `dict {item_code, qty, weight, ...}` | `components/pos/shell/BarcodePrinting.vue:515` |
| `api.item_processing.barcode.build_scale_barcode` | `barcode.py:266` | `item_code, qty/weight, ...` | `str` | `BarcodePrinting.vue:591` |
| `api.item_processing.barcode.get_items_from_barcode` | `barcode.py:389` | `selling_price_list, currency, barcode` | `list` | barcode scan path |
| `api.item_processing.barcode.search_serial_or_batch_or_barcode_number` (alias `api.items.search_serial_or_batch_or_barcode_number`) | `barcode.py:456` | `search_value, search_serial_no=None, search_batch_no=None` | `dict` | scan dialog |
| `api.item_processing.stock.get_bulk_stock_availability` | `item_processing/stock.py:36` | `items` | `dict[item_code -> qty]` | – |
| `api.item_processing.stock.get_available_qty` (alias `api.items.get_available_qty`) | `item_processing/stock.py:114` | `items` | `dict[item_code -> qty]` | `components/pos/invoice_utils/stock.ts:148` |
| `api.item_processing.price.update_price_list_rate` | `item_processing/price.py:7` | `item_code, price_list, rate, uom=None` | `bool` | – (admin tool) |
| `api.item_processing.price.get_price_for_uom` (alias `api.items.get_price_for_uom`) | `price.py:42` | `item_code, price_list, uom` | `float` | UOM change handler |
| `api.bundles.get_bundle_components` | `api/bundles.py:7` | `bundles` | `dict` | bundle expander |

### 1.3 Customers

`api/customers.py` — 10 endpoints (lines 56, 84, 137, 147, 203, 292,
428, 463, 489, 510) plus `api/customer.py:63,68` legacy aliases.

| Method | Args | Returns | Frontend |
|---|---|---|---|
| `customers.get_customer_balance` (legacy: `api.customer.get_customer_balance`) | `customer:str` | `float` | `components/pos/invoice_utils/loader.ts:75` |
| `customers.get_customer_names` | `pos_profile, limit=None, offset=None, start_after=None, modified_after=None` | `list[dict]` | `stores/customersStore.ts:503` |
| `customers.get_customers_count` | `pos_profile` | `int` | `stores/customersStore.ts:599,705` |
| `customers.search_customers` | `pos_profile, search_term, limit=20` | `list[dict]` | offline worker |
| `customers.get_customer_info` | `customer=None, company=None` | `dict` | not observed (server) |
| `customers.create_customer` | `**kwargs` | `dict` | `dialogs/customer/UpdateCustomer.vue:629` |
| `customers.set_customer_info` | `customer, fieldname, value=""` | `bool` | – |
| `customers.get_customer_addresses` | `customer` | `list` | `composables/pos/invoice/useInvoiceDetails.ts:182` |
| `customers.make_address` | `args` (JSON string) | `dict` | `components/pos/customer/NewAddress.vue:109` |
| `customers.get_sales_person_names` (also at `utilities.py:407`) | `pos_profile=None` | `list[str]` | `useInvoiceDetails.ts:269` |

### 1.4 Invoices — drafts, submit, return

| Method | File:Line | Args | Returns | Frontend |
|---|---|---|---|---|
| `invoices.get_draft_invoices` | `api/invoices.py:45` | `pos_opening_shift, doctype="Sales Invoice", limit_page_length=0, company=None, pos_profile=None, cashier=None, is_supervisor=0` | `list[dict]` | `posapp/utils/draftInvoices.ts:28` |
| `invoices.get_draft_invoice_doc` | `invoices.py:107` | `invoice_name, doctype="Sales Invoice"` | full doc dict | `draftInvoices.ts:50` |
| `invoices.delete_invoice` | `invoices.py:121` | `invoice` | `str` (localised) | – (admin) |
| `invoices.fetch_exchange_rate_pair` | `invoices.py:142` | `from_currency, to_currency` | `{exchange_rate, date}` | currency helper |
| `invoices.update_invoice` (facade -> `invoice_processing/creation.py:712`) | – | `data` (JSON string) | full doc dict | `composables/pos/payments/usePaymentMethods.ts:327` |
| `invoices.submit_invoice` (facade -> `creation.py:938`) | – | `invoice, data, submit_in_background=False` | doc dict OR job-handle | `services/invoiceService.ts:16` |
| `invoices.update_invoice_from_order` | `invoices.py:193` | `data` | doc dict | `components/pos/invoice_utils/server.ts:175` |
| `invoices.validate_cart_items` (facade -> `creation.py:1393`) | – | `items, pos_profile=None` | `{valid:bool, errors:[]}` | cart guard |
| `invoice_processing.creation.repair_invoice_submission` | `creation.py:1318` | `client_request_id, company, pos_profile, document_type="Sales Invoice"` | doc dict / `{replayed:true}` | offline outbox repair |
| `invoice_processing.returns.search_invoices_for_return` (alias `api.invoices.search_invoices_for_return`) | `returns.py:15` | search filters | `list` | `components/pos/flows/Returns.vue:691` |
| `invoice_processing.returns.get_invoice_for_return` (alias `api.invoices.get_invoice_for_return`) | `returns.py:220` | `invoice_name, pos_profile=None, doctype="Sales Invoice"` | full doc | `Returns.vue:749` |
| `invoice_processing.returns.validate_return_items` | `returns.py:342` | `original_invoice_name, return_items, doctype="Sales Invoice"` | `{valid, message}` | server-only |
| `invoices.create_sales_invoice_from_order` | `invoices.py:164` | `sales_order` | doc | legacy path |
| `invoices.delete_sales_invoice` | `invoices.py:181` | `sales_invoice` | `bool` | legacy path |
| `invoice_processing.utils.get_price_list_currency` | `invoice_processing/utils.py:142` | `price_list` | `str` | aliased through `invoices` |
| `invoice_processing.utils.get_available_currencies` | `invoice_processing/utils.py:147` | – | `list[str]` | aliased |
| `invoice_processing.data.get_last_invoice_rates` | `invoice_processing/data.py:5` | `customer, item_codes, company=None` | `dict[item_code -> rate]` | last-rate prefill |

### 1.5 Payments + reconciliation

| Method | File:Line | Args | Returns | Frontend |
|---|---|---|---|---|
| `payments.create_payment_request` | `api/payments.py:23` | `doc` | `dict` | `usePaymentMethods.ts:336` |
| `payments.get_available_credit` | `payments.py:348` | `customer, company` | `list[dict]` | credit panel |
| `payments.repair_overpayment_change_allocations` | `payments.py:535` | `**args` | `dict` | server repair tool |
| `payment_entry.process_pos_payment` (re-exports `payment_processing.processor.process_pos_payment`) | `payment_processing/processor.py:232` | `payload` (JSON) | `dict` | `usePaymentMethods.ts` (process flow) |
| `payment_entry.auto_reconcile_customer_invoices` (re-exports `payment_processing.reconciliation:13`) | – | reconciliation args | `dict` | reconciliation UI |
| `payment_processing.data.get_outstanding_invoices` | `data.py:135` | filters | `list[dict]` | reconciliation |
| `payment_processing.data.get_unallocated_payments` | `data.py:260` | filters | `list[dict]` | reconciliation |
| `payment_processing.data.get_available_pos_profiles` | `data.py:549` | `company, currency` | `list[dict]` | reconciliation |
| `payment_processing.data.get_unreconciled_entries` | `data.py:560` | filters | `list[dict]` | reconciliation |
| `payment_processing.utils.get_mode_of_payment_accounts` | `utils.py:76` | `company, mode_of_payments` | `dict` | `usePaymentMethods.ts` |
| `stored_value.get_available_stored_value` | `api/stored_value.py:17` | `customer=None, company=None` | `float` | – |
| `stored_value.get_stored_value_summary` | `stored_value.py:27` | `customer=None, company=None` | `dict` | – |
| `m_pesa.confirmation` / `validation` | `api/m_pesa.py:20,48` | `**kwargs` (guest webhook) | `{ResultCode, ResultDesc}` | external Safaricom callback |
| `m_pesa.get_mpesa_mode_of_payment` | `m_pesa.py:54` | `company` | `list[str]` | `composables/pos/payments/usePaymentMethods.ts:64` |
| `m_pesa.get_mpesa_draft_payments` | `m_pesa.py:68` | filters | `list[dict]` | mpesa drawer |
| `m_pesa.submit_mpesa_payment` | `m_pesa.py:105` | `mpesa_payment, customer` | doc | mpesa drawer |

### 1.6 Pricing rules + offers

| Method | File:Line | Args | Returns | Frontend |
|---|---|---|---|---|
| `pricing_rules.flush_pricing_rules_cache` | `api/pricing_rules.py:107` | – | `{flushed:bool}` | admin |
| `pricing_rules.get_active_pricing_rules` | `pricing_rules.py:272` | `params=None, **kwargs` | `list[dict]` | rule sync |
| `pricing_rules.reconcile_line_prices` | `pricing_rules.py:497` | `cart_payload` (dict or JSON) | `{lines:[], freebies:[]}` | `components/pos/invoice_utils/pricing.ts:636` |
| `offers.get_pos_coupon` | `api/offers.py:15` | `coupon, customer, company` | `dict` or `None` | coupon dialog |
| `offers.get_active_gift_coupons` | `offers.py:21` | `customer, company` | `list[dict]` | coupons panel |
| `offers.get_offers` | `offers.py:52` | `profile` | `list[dict]` | offers loader |
| `offers.get_applicable_delivery_charges` | `offers.py:105` | `company, pos_profile, customer, shipping_address_name=None` | `list[dict]` | `components/pos/Invoice.vue:630` |

### 1.7 Sales orders / quotations / purchase / commercial flow

| Method | File:Line | Args | Returns | Frontend |
|---|---|---|---|---|
| `sales_orders.search_orders` | `api/sales_orders.py:20` | `company, currency, order_name=None` | `list[dict]` | `components/pos/flows/SalesOrders.vue:253` |
| `sales_orders.update_sales_order` | `sales_orders.py:86` | `data` | doc | – |
| `sales_orders.submit_sales_order` | `sales_orders.py:139` | `order` | doc | `services/invoiceService.ts:13` |
| `quotations.search_quotations` | `api/quotations.py:56` | filters | `list[dict]` | – |
| `quotations.update_quotation` | `quotations.py:115` | `data` | doc | – |
| `quotations.submit_quotation` | `quotations.py:134` | `order` | doc | `services/invoiceService.ts:15` |
| `purchase_orders.create_supplier` | `api/purchase_orders.py:242` | `data` | doc | `dialogs/purchase/SupplierDialog.vue:118` |
| `purchase_orders.search_suppliers` | `purchase_orders.py:277` | `search_text=None, limit=20` | `list[dict]` | `components/pos/purchase/PurchaseOrders.vue:182` |
| `purchase_orders.get_buying_price_list` | `purchase_orders.py:299` | – | `str` | `PurchaseOrders.vue:387` |
| `purchase_orders.get_supplier_info` | `purchase_orders.py:304` | `supplier` | `dict` | drawer |
| `purchase_orders.get_last_buying_rate` | `purchase_orders.py:328` | `supplier, item_codes, company=None` | `dict` | drawer |
| `purchase_orders.create_purchase_item` | `purchase_orders.py:431` | `data` | doc | new-item flow |
| `purchase_orders.create_purchase_order` | `purchase_orders.py:593` | `data` | doc + receipt + payment | `PurchaseOrders.vue:329` |
| `purchase_orders.search_items` | `purchase_orders.py:747` | `search_text=None, limit=20` | `list[dict]` | drawer |
| `commercial_flow.list_source_documents` | `api/commercial_flow.py:243` | `source, company, currency, ...` | `{items:[], allowed_actions:{}}` | `utils/documentSources.ts:397` |
| `commercial_flow.prepare_document_flow_action` | `commercial_flow.py:288` | `source, doc_name, action, ...` | mapped doc | `documentSources.ts:436` |
| `commercial_flow.commit_document_flow_action` | `commercial_flow.py:376` | `source, doc_name, action, payload` | result | `documentSources.ts:471` |

### 1.8 Employees / shifts (cashier identity)

| Method | File:Line | Args | Returns | Frontend |
|---|---|---|---|---|
| `employees.get_terminal_employees` | `api/employees.py:109` | `pos_profile=None` | `list[dict]` | `components/Navbar.vue:570` |
| `employees.verify_terminal_employee_pin` | `employees.py:151` | `pos_profile, user, pin` | `{ok:bool, is_supervisor:bool}` | NavbarCashierPinForm |
| `employees.get_cashier_pin_status` | `employees.py:177` | `pos_profile=None, user=None` | `dict` | `NavbarCashierPinForm.vue:220` |
| `employees.save_cashier_pin` | `employees.py:199` | `pos_profile, user, new_pin, current_pin=None` | `bool` | `NavbarCashierPinForm.vue:267` |

### 1.9 Cash movement (`api/cash_movement/service.py`)

8 endpoints (lines 105–219): `get_cash_movement_context`,
`create_pos_expense`, `create_cash_deposit`, `get_shift_cash_movements`,
`get_submitted_expenses`, `cancel_cash_movement`, `delete_cash_movement`,
`duplicate_cash_movement`. All consumed by
`frontend/src/posapp/services/cashMovementService.ts:7-49`.

### 1.10 Closing shift (`doctype/pos_closing_shift/closing_processing/`)

| Method | File:Line | Args | Returns |
|---|---|---|---|
| `make_closing_shift_from_opening` | `creation.py:81` | `opening_shift` | doc |
| `submit_closing_shift` | `creation.py:246` | `closing_shift` | doc |
| `get_cashiers` | `data.py:8` | Frappe `txt, searchfield, ...` | `list[tuple]` |
| `get_pos_invoices` | `data.py:20` | `pos_opening_shift, doctype=None, submit_printed=1` | `list[dict]` |
| `get_payments_entries` | `data.py:51` | `pos_opening_shift` | `list[dict]` |
| `get_closing_shift_overview` | `overview.py:12` | `pos_opening_shift` | `dict` (big aggregate) |
| `get_payment_reconciliation_details` | `overview.py:703` | `closing_shift_doc` | `dict` |
| `pos_closing_shift.<self>` method | `pos_closing_shift.py:90` | controller | – |

### 1.11 Offline-sync (PWA bootstrap + delta)

| Method | File:Line | Args | Returns | Notes |
|---|---|---|---|---|
| `offline_sync.bootstrap.sync_bootstrap_config` | `offline_sync/bootstrap.py:36` | `pos_profile, modified_after=None` | `{config, etag}` | first-paint bootstrap |
| `offline_sync.items.sync_items` | `offline_sync/items.py:85` | scoped item delta | `{rows[], cursor, etag}` | worker `useItemSyncWorker` |
| `offline_sync.customers.sync_customers` | `offline_sync/customers.py:54` | scoped customer delta | `{rows[], cursor, etag}` | worker |
| `offline_sync.currencies.sync_currency_scope` | `offline_sync/currencies.py:69` | – | `{rows[], cursor}` | worker |
| `offline_sync.invoices.submit_invoice_outbox_entry` | `offline_sync/invoices.py:29` | `client_request_id, invoice, data=None` | `{state, invoice}` | **mutating**, idempotent via `client_request_id` |
| `offline_sync.invoices.reconcile_invoice_outbox_entry` | `offline_sync/invoices.py:57` | `client_request_id, ...` | `{state}` | idempotent |
| `offline_sync.invoices.repair_invoice_outbox_entry` | `offline_sync/invoices.py:80` | `client_request_id, ...` | `{state}` | idempotent |
| `offline_sync.payment_methods.sync_payment_method_currencies` | `payment_methods.py:25` | scope | `{rows[]}` | worker |
| `offline_sync.stock.sync_stock` | `offline_sync/stock.py:69` | scope | `{rows[], cursor}` | worker |

### 1.12 Dashboard (24 endpoints)

`api/dashboard.py:4789,5472..5821` — `get_dashboard_data`,
`get_dashboard_envelope`, plus 22 `get_dashboard_*_report(**kwargs)`
variants. All consumed by `services/dashboardService.ts` (20 KB of
typed wrappers — see §3 for shape).

### 1.13 QZ / print / telemetry / dev-only

| Method | File:Line | Args | Returns | Notes |
|---|---|---|---|---|
| `qz.get_certificate` / `get_certificate_download` / `sign_message` / `setup_qz_certificate` | `api/qz.py:56,69,85,105` | varies | varies | print signing |
| `print_formats.get_print_formats` | `api/print_formats.py:9` | `doctype` | `list[str]` | `Payments.vue:933` |
| `telemetry.ingest` | `api/telemetry.py:110` | `events:list` (JSON or list) | `{accepted, dropped, duration_ms}` | **POST-only** (only endpoint with explicit `methods=`) |
| `telemetry.get_pos_telemetry_summary` | `api/telemetry.py:179` | filters | `dict` | dev panel |

---

## 2. Stability classification

There is **no formal stability tier** anywhere in the codebase. No
`@deprecated`, no `X-API-Version` header, no semver on routes. Versioning
posture: implicit via app version (`posawesome.__init__.__version__`).

Proposed tiering:

| Tier | Criteria | Examples |
|---|---|---|
| **Public stable** | Called by SPA + offline worker + external integrators (CFDI add-on). Breaking changes need migration. | `submit_invoice`, `update_invoice`, `process_pos_payment`, `get_items`, `get_draft_invoices`, `get_customer_info`, `offline_sync.*`, `telemetry.ingest`, `m_pesa.confirmation`/`validation` (Safaricom contract — **frozen**) |
| **Public unstable** | SPA-only, may iterate. | `commercial_flow.*`, `cash_movement.*`, `employees.*` (PIN flow), all `dashboard.*` |
| **Internal** | Helper aliases, dev / admin paths, alias shims. | `invoices.create_sales_invoice_from_order`, `invoices.delete_sales_invoice`, `payments.repair_overpayment_change_allocations`, `pricing_rules.flush_pricing_rules_cache`, `qz.setup_qz_certificate` |
| **Deprecated/alias** | Re-exports kept for back-compat — schedule for removal once docs land. | `api/customer.py:63,68` (back-compat for `api.customers.*`), `api/payment_entry.py:1-26` (re-export shim), `api/utilities.py:407` duplicate of `customers.get_sales_person_names` |

Action: add an in-code marker (decorator `@posa_api(stability="public", since="0.x.y")`) backed by a registry — see §7.

---

## 3. Contract coverage (schemas)

### 3.1 What is typed

- TS interfaces exist for **dashboard payloads only**:
  `frontend/src/posapp/services/dashboardService.ts:3-83` defines
  `DashboardMetricPayload`, `SalesSummaryPayload`, `FastMovingItem`,
  `LowStockItem`, `SupplierSummaryRow`, `SupplierDayRow`. These are
  hand-mirrored from Python returns — **not generated**, no
  enforcement.
- `frontend/src/posapp/services/api.ts:10-39` defines the **envelope**:
  `ApiEnvelope<T>` discriminated union, `ApiErrorEnvelope`,
  `FrappeResponse<T>` — but `T` is `any` at almost every call site.
- `frontend/src/posapp/types/models.ts` defines `InvoiceDoc`, `POSProfile`
  used in `invoiceService.ts:3` — these are partial, optional-heavy,
  and drift from the Frappe DocType JSON.

### 3.2 What is stringly-typed

- `submit_invoice(invoice, data, ...)` — both `invoice` and `data` are
  **JSON strings** parsed via `json.loads` (`creation.py:715`).
  No schema, no Pydantic, no JSON schema.
- `update_invoice(data)` — same. Mutates dozens of fields; downstream
  TIMESTAMP_MISMATCH errors are classified by **string match** on
  the message (`services/api.ts:155-161`).
- `process_pos_payment(payload)` — JSON string.
- `commercial_flow.*` — JSON-stringy `payload` dict.
- `reconcile_line_prices(cart_payload)` — `dict | str | None`.
- `validate_cart_items(items)` — `items` is JSON string.
- `telemetry.ingest(events)` — JSON string with manual `json.loads` +
  per-row sanitisation (`telemetry.py:50-107`).

### 3.3 Coverage matrix

| Surface | Request schema | Response schema | Generator |
|---|---|---|---|
| Dashboard (24 methods) | None | TS interface, hand-written | None |
| Invoice submit/update | JSON-blob | Frappe DocDict | None |
| Items search/details | kwargs | `list[dict]` (~25 fields, drifts) | None |
| Offline-sync | kwargs | `{rows[], cursor, etag}` (informal) | None |
| Cash movement | TS service wrapper, `payload` opaque | `any` | None |
| Telemetry | JSON list | `{accepted, dropped, duration_ms}` | None |
| Closing shift | kwargs | DocDict | None |
| Everything else | kwargs | `any` | None |

**Coverage: ~5%** of endpoints have a typed response interface. **0%**
have a typed request schema.

---

## 4. Idempotency keys

Audit of writes vs. idempotency support:

### 4.1 Has idempotency

- **Invoice submit path** — `posa_client_request_id` custom field on
  `Sales Invoice`/`POS Invoice`/`Payment Entry`.
  - Generated client-side, propagated through `extract_invoice_client_request_id`
    (`api/idempotency.py:9`).
  - Replay protection via `_get_or_create_submission_ledger`
    (`invoice_processing/creation.py:180`) backed by the
    `POS Invoice Submission Ledger` doctype.
  - `repair_invoice_submission(client_request_id, ...)`
    (`creation.py:1318`) reconciles partial failures.
  - `offline_sync.invoices.submit_invoice_outbox_entry` /
    `reconcile_invoice_outbox_entry` / `repair_invoice_outbox_entry`
    all keyed on `client_request_id`.
- **Payment entries** — `find_payment_entries_by_client_request_id`
  (`api/idempotency.py:62`) joins replay to the same ledger row.

### 4.2 Lacks idempotency (writes)

These are mutating endpoints with **no replay key**. If the SPA
retries on a flaky network, duplicates are possible:

| Endpoint | Risk |
|---|---|
| `customers.create_customer` | Duplicate Customer doc |
| `customers.make_address` | Duplicate Address doc |
| `purchase_orders.create_supplier` | Duplicate Supplier |
| `purchase_orders.create_purchase_order` | Duplicate PO + Receipt + Payment Entry (worst case) |
| `purchase_orders.create_purchase_item` | Duplicate Item |
| `sales_orders.update_sales_order` / `submit_sales_order` | Duplicate SO submit |
| `quotations.update_quotation` / `submit_quotation` | Duplicate quotation |
| `employees.save_cashier_pin` | Replays harmless (overwrite) but no audit |
| `shifts.create_opening_voucher` | Duplicate opening shift |
| `cash_movement.create_pos_expense` / `create_cash_deposit` / `duplicate_cash_movement` | Duplicate cash movement |
| `gift_cards.issue_gift_card` / `top_up_gift_card` | Duplicate gift card / journal |
| `commercial_flow.commit_document_flow_action` | Duplicate mapped doc |
| `payment_entry.process_pos_payment` (writes via posawesome path) | Mitigated by invoice ledger but not all sub-flows |
| `payment_entry.auto_reconcile_customer_invoices` | Replay yields different state |
| `m_pesa.submit_mpesa_payment` | Duplicate Payment Entry |

Recommendation: standardise on a `request_id` arg (the SPA already
generates one in `services/api.ts:90-95`). Server-side wrap each write
with a generic ledger keyed by `(method, request_id, user)`.

---

## 5. Pagination + filter conventions

**Chaotic.** Eight different shapes for "give me a page":

| Style | Endpoint | Params |
|---|---|---|
| Frappe-style | `customers.get_customer_names` | `limit, offset, start_after, modified_after` |
| Frappe-classic | `get_pos_invoices` | `limit_page_length` (positional in `get_draft_invoices`) |
| `limit_start/limit_page_length` pair | `cash_movement.get_submitted_expenses` | – |
| `limit` only | `purchase_orders.search_suppliers/search_items`, `customers.search_customers` | `limit=20` |
| No pagination | `get_items` returns up to whatever the query LIMIT says; cursor managed via `modified_after` | – |
| Cursor (modified_after) | `offline_sync.*`, `items.get_delta_items` | `modified_after` |
| `**kwargs` blob | `dashboard.*` | freeform |
| Implicit "all" | `offers.get_offers`, `get_terminal_employees` | – |

Filters: same — sometimes `pos_profile`, sometimes `profile`,
sometimes `pos_opening_shift`. `company` is sometimes positional,
sometimes optional, sometimes derived from session.

Recommendation: define a `PageRequest { limit, cursor? }` and a
`PageResponse<T> { rows, cursor?, has_more }` contract; migrate
incrementally.

---

## 6. Error model

### 6.1 What exists

- **Envelope (frontend-side)**:
  `frontend/src/posapp/services/api.ts:25-39` defines a discriminated
  union `ApiEnvelope<T>` with `ok`, `data`, `error`, `requestId`,
  `serverTime`. Codes already in use:
  `TIMESTAMP_MISMATCH`, `RETURN_PAYMENT_AMOUNT_SIGN`,
  `INSUFFICIENT_STOCK`, `BUSINESS_RULE`, `HTTP_ERROR`,
  `TRANSPORT_ERROR`, `TIMEOUT`, `ABORTED`, `UNKNOWN`.
  See `api.ts:148-172` (`classifyBusinessCode`) and
  `api.ts:184-307` (envelope normalisation).
- **Server side**: virtually **all** errors are `frappe.throw(_("..."))`
  with a localised string. `posa_error_code` is **not** set on any
  observed throw. Code classification is done by **string matching the
  English message** on the client (`api.ts:154-170`) — this breaks
  every time:
  - The user runs in another language (`_("...")` localises the throw).
  - A maintainer rewords the message.
  - A new business rule lands without updating the regex.
- **HTTP status codes**: Frappe returns 200 even for business errors;
  the envelope detects via `response.exc` or `message.error`. Only
  transport errors carry meaningful HTTP codes
  (`api.ts:174-181` treats 408/429/5xx as retryable).
- **Server envelope**: `normalizeExistingEnvelope`
  (`api.ts:212-243`) shows the client **already understands** a server
  envelope of shape `{ok, data, error:{code,message,retryable}}` — but
  almost no server endpoint actually returns one. Only the bare
  `_ledger_response` path in `creation.py` is structured.

### 6.2 What's missing

- Server-side `posa_error(code, message, retryable, http_status=400)`
  helper that throws a typed exception class and writes the envelope.
- Stable error code registry (currently 4 codes — `TIMESTAMP_MISMATCH`,
  `RETURN_PAYMENT_AMOUNT_SIGN`, `INSUFFICIENT_STOCK`, `BUSINESS_RULE`
  — discovered by string match).
- HTTP code mapping. `telemetry.ingest` is the only endpoint with an
  explicit `methods=["POST"]` allowlist.
- Validation errors (cart, return, write-off limit) are mixed in with
  permission errors and generic exceptions — same handler.

---

## 7. OpenAPI plan

### 7.1 Recommendation

**Build it custom on top of `@frappe.whitelist` introspection.**

Reasons:
- Upstream `fix-api-docs-generating` (defendicon) is *not* an API docs
  branch despite the name; it's an active feature branch and shouldn't
  be relied on for tooling.
- `frappe-api-docs` (community) generates a flat function list from
  the whitelist registry — not OpenAPI, no schema typing, no
  consumer-friendly tagging.
- We already have `posawesome/posawesome/api/__init__.py` re-exporting
  the public surface, which is a natural docstring/schema attachment
  point.

### 7.2 Implementation outline

1. Introduce `posawesome/posawesome/api/_contract.py`:
   ```python
   def posa_api(*, stability, since, request=None, response=None,
                tags=(), methods=("POST",), idempotent=False, replay_key=None):
       def deco(fn):
           fn._posa_contract = dict(...)
           return frappe.whitelist(methods=list(methods))(fn)
       return deco
   ```
2. Replace `@frappe.whitelist()` -> `@posa_api(...)` incrementally
   starting with the Tier 1 list in §2.
3. Use Pydantic v2 models for request/response — store them next to the
   handler (`*_schema.py`). Pydantic gives JSON Schema for free, which
   OpenAPI 3.1 consumes natively.
4. Generator script `scripts/gen_openapi.py`:
   - Walk `posawesome.posawesome.api` recursively.
   - For each `_posa_contract`, emit a `paths` entry under
     `/api/method/{dotted.path}` with `requestBody` = JSON schema
     of `request`, `responses[200]` = JSON schema of `response`,
     `responses[default]` = the standard envelope error.
   - Group by `tags`; promote `stability` to `x-stability`.
   - Output `posawesome/docs/openapi.yaml` + `openapi.json`.
5. Wire into CI (lint job): run generator, fail if uncommitted diff.
6. Serve at `/posa/openapi.json` via a `frappe.whitelist(allow_guest=False)`
   handler so the SPA can render a Redoc panel under
   `/posapp/dev-tools/api`.

### 7.3 Why not generate from runtime call traffic

Tempting (we have telemetry), but:
- Telemetry is sampled and event-shape-only, not request/response shape.
- Multi-tenant: each tenant exercises a different subset; the spec
  must be deterministic from source.

---

## 8. Contract tests (consumer-driven, Pact-style)

Currently: zero contract tests. Tests exist (`test_invoices.py`,
`test_creation.py`, `test_payments.py`, etc.) but they're black-box
service tests in Python — they don't verify the wire shape the SPA
actually depends on.

Proposed:

1. **Consumer recordings** — instrument `api.callEnvelope`
   (`frontend/src/posapp/services/api.ts:316`) under `NODE_ENV=test`
   to dump `{method, args, response_envelope, requestId}` into
   `frontend/tests/__contracts__/*.json` during the existing Vitest
   suite + Playwright flows.
2. **Provider verification** — Python test suite picks up the JSON
   shards, replays each `args` against the live function, compares
   the response envelope to the recording. Pact tooling is overkill;
   a 100-line `pytest` collector covers it.
3. **Schema enforcement** — every recorded shape is validated against
   the OpenAPI schema (§7). A new optional field is allowed; a removed
   field is a failing contract.
4. **Backwards-compat job** — diff the generated OpenAPI against `main`;
   block PRs that introduce breaking changes without bumping the
   `x-stability` tier or the `Deprecated` flag.

---

## 9. Multi-tenant + feature-flag versioning

### 9.1 Current state

- No per-tenant API surface. Whitelist is global.
- Feature flags exist but as **POS Profile booleans**:
  `create_pos_invoice_instead_of_sales_invoice`,
  `posa_allow_submissions_in_background_job`,
  `posa_create_only_sales_order`, `posa_tax_inclusive`,
  `posa_use_pos_awesome_payments_in_background_job`, etc.
  Each is fetched ad-hoc from the POS Profile in the relevant handler
  (e.g. `creation.py:725`, `invoiceService.ts:12-16`).
- "Capability negotiation" — there is no `/capabilities` endpoint;
  the SPA infers what the backend supports by trying calls and
  catching exceptions, or by reading bootstrap dicts.
- The current bootstrap surface (`offline_sync.bootstrap.sync_bootstrap_config`)
  returns config but **does not enumerate enabled methods or
  feature flags as a capability matrix**.

### 9.2 SaaS gap

For Doco/muelle SaaS, each tenant needs:
- Pinned API version (`X-POSA-API: 2026-05-01`) so a frontend rev can
  declare which contract it expects.
- Per-tenant feature flags surfaced at boot so the SPA can hide UI
  rather than 500.
- Deprecation runway when an endpoint is retired upstream — the
  control plane (`boat`) needs to know which tenants are still pinned
  to the old contract.

### 9.3 Recommendation

1. Add `posawesome.posawesome.api.session.bootstrap_capabilities`:
   returns `{api_version, enabled_features: {...}, deprecated: [...]}`
   computed from POS Profile + Site Config. Cache per tenant.
2. SPA calls it once at boot, hangs the result off a Pinia store
   (`stores/capabilityStore.ts`), every composable consults it
   instead of re-querying POS Profile booleans.
3. Adopt date-versioned API headers (Stripe-style):
   `X-POSA-API: 2026-Q2`. Server reads it from request headers, maps
   to a per-version compatibility shim.
4. Feature flags become tri-state (`disabled`, `beta`, `enabled`) so
   the control plane can dark-launch features per tenant.

---

## 10. Frontend HTTP layer audit

### 10.1 What exists

- Central client: `frontend/src/posapp/services/api.ts` exports
  `api.call`, `api.callEnvelope`, `api.getDoc`, `api.setValue`.
  - Timeout: configurable, default `30_000` ms (`api.ts:41`).
  - Abort: `AbortSignal` honoured (`api.ts:334-355`).
  - Envelope normalisation: full implementation (`api.ts:212-307`).
  - RequestId generation: yes, UUID-prefixed `posa-*`
    (`api.ts:90-95`).
- Domain services thin-wrap `api.call`/`callEnvelope`:
  `cashMovementService.ts`, `itemService.ts`, `invoiceService.ts`,
  `dashboardService.ts` (well-typed return interfaces).

### 10.2 What's missing

| Concern | Status |
|---|---|
| Retry on retryable codes | **Missing**. `retryable: true` is set in the envelope but no wrapper auto-retries. Each composable handles it ad-hoc, mostly by not handling it. |
| Idempotency forwarding | Partial. `request_id` flows for invoice paths only; other writes don't send it. |
| Telemetry hook | Missing. `api.call` does **not** emit a `frappe.call` event to `posapp/utils/telemetry.ts`, so we have no client-side RUM for call latency, error code distribution, or top-N slow methods. |
| Method-level circuit breaker | Missing. A 500 storm on `get_items` will keep firing. |
| Auth refresh | Not applicable to Frappe session, but **CSRF token rotation** isn't handled here either — relies on Frappe global. |
| Mock layer for tests | Tests stub `frappe.call` ad-hoc; no shared mock client. |
| Cancellation on route change | Done in some composables (`useInvoiceDetails.ts`), missing in most. |
| 401 / session-expired flow | Implicit — Frappe redirects. SPA has no clean "session expired" envelope code. |

### 10.3 Recommendation

Promote `api.callEnvelope` to a single entrypoint:
1. Add a `retry: { attempts, backoffMs }` option (default no-retry).
2. Auto-include `request_id` on every call (already generated;
   forward to **all** mutating endpoints, not just invoice paths).
3. Emit a telemetry event per call: `{method, durationMs, code,
   retryable, attempts}` -> `telemetry.ingest`.
4. Add a `posa-session-expired` error code; redirect-to-login on
   detection.
5. Ban direct `frappe.call` usage outside `services/api.ts`
   (lint rule).

---

## 11. PR-worthy API PRs back to upstream

Ranked by signal-to-noise for upstream defendicon repo:

1. **Standardise error envelopes** — port `services/api.ts`
   envelope into a server-side helper `posa_error(code, message,
   retryable=False)`. Replace `frappe.throw(_("..."))` in the invoice
   submit path first, then payments. Eliminates the brittle
   message-string regex in `services/api.ts:148-172`. *(Touches
   `invoice_processing/*`, `payment_processing/*`, `services/api.ts`.)*

2. **`telemetry.ingest` method allowlist consistency** — only
   `telemetry.ingest` declares `methods=["POST"]`. Audit all writes
   (`create_*`, `update_*`, `submit_*`, `delete_*`, `cancel_*`, all
   `offline_sync/invoices.*`) and add `methods=["POST"]` so they
   can't be triggered via `GET ?cmd=...`. CSRF + browser preflight
   correctness.

3. **Idempotency for non-invoice writes** — extend the
   `posa_client_request_id` pattern from invoices to
   `create_customer`, `create_supplier`, `create_purchase_order`,
   `create_pos_expense`, `create_cash_deposit`, `issue_gift_card`,
   `top_up_gift_card`, `submit_mpesa_payment`. Reuses
   `api/idempotency.py` helpers.

4. **OpenAPI generator + Redoc panel** — add `scripts/gen_openapi.py`
   walking `_posa_contract` metadata, output `posawesome/docs/openapi.yaml`,
   serve at `/posa/openapi.json`, render under `/posapp/dev-tools/api`.
   Replace the (non-existent) `fix-api-docs-generating` story.

5. **Capability bootstrap endpoint** — `api.session.bootstrap_capabilities`
   returning `{api_version, features, deprecated}`. Unblocks
   multi-tenant SaaS and dark-launch flags. Backward-compatible.

Stretch:

6. **Pagination unification** — introduce `PageRequest`/`PageResponse`
   and migrate `get_customer_names`, `get_submitted_expenses`,
   `search_*` family.

---

## 12. Doco-specific API endpoints to keep in fork

Endpoints whose semantics are tied to Doco/CFDI/Muelle SaaS — should
NOT be upstreamed:

- **CFDI integration glue** — every place we call into
  `erpnext_mexico_compliance` from POSAwesome. Currently coupled
  through hooks (`hooks.py`) and `invoice_processing/utils.py`'s
  `_build_invoice_remarks` mexico-specific fields. Keep in fork.
- **Tenant capability endpoint** (`bootstrap_capabilities`, §9.3) once
  it learns about `boat`/muelle tenant flags — the *generic* form can
  upstream; the muelle-aware reading from a control-plane table stays
  in fork.
- **Idempotency replay endpoints in muelle's queue model** — if/when
  `offline_sync.invoices.*` learns to talk to a muelle outbox table
  instead of a local doctype, that variant stays in fork.
- **Doco-specific dashboard reports** — any new `get_dashboard_*`
  added for muelle SaaS reporting (per-tenant ARR, terminal heatmap)
  should be on the fork's branch only.
- **`get_remote_update_info`** (`utilities.py:362`) — already reads
  the on-disk git tree of bind-mounted apps; muelle-specific.
  Either upstream a sanitised version that's a no-op when not in a
  muelle layout, or keep it fork-only.
- **`api.utilities.get_database_usage` / `get_server_usage`** — these
  are useful but currently read host-level filesystems; in a
  multi-tenant SaaS the implementation must be tenant-scoped, so keep
  the muelle-tenant version local and upstream only the interface.

---

## Appendix: files cited

- `posawesome/posawesome/api/__init__.py:1-99` — public re-export surface.
- `posawesome/posawesome/api/idempotency.py:1-83` — replay key infrastructure.
- `posawesome/posawesome/api/invoice_processing/creation.py:180-246,712,938,1318,1393` — ledger + submit.
- `posawesome/posawesome/api/invoices.py:45,107,121,142,164,181,193` — invoice facade.
- `posawesome/posawesome/api/customers.py:56-510` — 10 endpoints.
- `posawesome/posawesome/api/dashboard.py:4789-5821` — 24 dashboard endpoints.
- `posawesome/posawesome/api/cash_movement/service.py:105-219` — 8 cash endpoints.
- `posawesome/posawesome/api/offline_sync/*` — 9 offline-sync endpoints.
- `posawesome/posawesome/api/telemetry.py:110,179` — only `methods=["POST"]` endpoint.
- `posawesome/posawesome/api/payment_entry.py:1-26` — pure re-export shim.
- `posawesome/posawesome/doctype/pos_closing_shift/closing_processing/*.py` — 7 closing endpoints.
- `frontend/src/posapp/services/api.ts:1-446` — central HTTP client + envelope.
- `frontend/src/posapp/services/dashboardService.ts:1-83` — only typed response interfaces.
- `frontend/src/posapp/services/invoiceService.ts:1-57` — typed submit wrapper.
- `frontend/src/posapp/services/cashMovementService.ts:1-49` — typed cash wrapper.
- `frontend/src/posapp/services/itemService.ts` — uses `callEnvelope`.
