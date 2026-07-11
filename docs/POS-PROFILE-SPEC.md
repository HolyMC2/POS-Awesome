# POS Profile — field wiring audit + remediation spec (2026-07-11)

Full trace of all 99 non-layout custom fields (fixtures) + saldo_enabled,
by two parallel research agents, verified against code. Profile payload =
the FULL doc (`shifts.update_opening_shift_data` sends `frappe.get_doc`) —
every field reaches the SPA; nothing is payload-dead.

Verdicts: **WIRED** (consumed + enforced where it matters) · **CLIENT-ONLY**
(SPA-only; fine for UX prefs, a hole for money/permission flags) · **DEAD**
(zero consumers) · **BROKEN/SUSPECT**.

## P0 — CLIENT-ONLY money/permission flags → add server backstops

Same class as `posa_allow_credit_sale` (fixed 2026-07-11). Each is a small
server-side check; pattern exists.

| # | field | hole | fix point |
|---|---|---|---|
| 1 ✅ `2b73be6d` | `posa_allow_change_posting_date` | client can backdate sales into closed accounting periods; `_apply_manual_posting_controls` (creation.py:618) accepts client posting_date without reading the flag | reject client-supplied posting date/time when flag OFF |
| 2 ✅ `2b73be6d` | `posa_allow_return` | return invoices (negative totals → cash refunds) submittable on profiles with returns disabled — zero server reads | check on `is_return` in submit_invoice |
| 3 ✅ `2b73be6d` | `posa_use_gift_cards` | gift-card issue/top-up/redeem endpoints never read the feature flag (only supervisor ROLE gates); also `issue_gift_card(currency="PKR")` upstream default mints PKR cards on bare calls | feature check in gift_cards.py entrypoints + default currency from company |
| 4 ✅ `2b73be6d` | `posa_allow_delete` | split-brain: closing purge honors it, `delete_invoice` endpoint (invoices.py:187) ignores it (only printed-guard + scope) | flag check in delete_invoice |
| 5 | `use_customer_credit` | UI gate only AND M-Pesa flow force-mutates it client-side (`usePaymentMethods.ts:213 profile.use_customer_credit = true`) to bypass its own gate; redemption AMOUNTS are server-validated vs real advances, the feature gate is fiction | profile check in the customer-credit redemption path; decide the M-Pesa exception server-side |
| 6 | `posa_allow_line_item_name_override` | `_apply_item_name_overrides` applies client name overrides unconditionally — receipt-text tampering (low) | gate on flag |
| 7 | `posa_use_delivery_charges` | server accepts delivery-charge rows regardless (payment invariant limits theft to mislabeling) | flag check when rows present (low) |

Mitigated-by-design (no action): rate/discount edit flags (server rate band
±20% + `posa_max_discount_allowed` cap + write_off_limit clamp back them),
print/display prefs, offline flags (server re-validates at sync).

## P1 — DEAD fields (remove field+fixture, or wire deliberately)

`posa_allow_supervisor_manage_gift_cards` (superseded by role gate),
`posa_allow_zero_rated_items`, `posa_apply_customer_discount`,
`posa_default_card_view`, `posa_fetch_coupon`, `posa_smart_reload_mode`.
Removal = fixture churn + patch; batch them in one cleanup commit.

## P2 — warts

- `pose_use_limit_search` — fieldname TYPO (`pose_`), works but invisible to
  any `posa_`-prefix tooling. Rename needs migration + fixture; document or
  fix deliberately.
- `posa_auto_set_batch` — backend call site commented out (creation.py:1388);
  batch auto-set is client-driven now. Confirm intent, delete dead comment.
- `posa_show_customer_balance` renders inside PostingDateRow.vue — odd home,
  functional.
- `custom_allow_create_quotation` / `custom_allow_select_sales_order` —
  UI-only gates on document-type flows; SO/QO endpoints are scope-gated but
  not flag-gated (no stock/GL movement → low).

## Full field tables

### First half (create_pos_invoice… → posa_decimal_precision)

| field | verdict | consumer | note |
|---|---|---|---|
| create_pos_invoice_instead_of_sales_invoice | WIRED | creation.py:~1137 +closing | target doctype selection |
| custom_allow_create_quotation | CLIENT-ONLY | documentSources.ts:163 | no server gate (low) |
| custom_allow_select_sales_order | CLIENT-ONLY | InvoiceActionButtons.vue:75 | UI only |
| hide_expected_amount | CLIENT-ONLY✓ | ClosingDialog.vue:212 | by design |
| posa_allow_cancel_submitted_cash_movement | WIRED | cash_movement/permissions.py:23 | |
| posa_allow_cash_deposit | WIRED | permissions.py:18 | |
| posa_allow_change_posting_date | **CLIENT-ONLY⚠** | Invoice.vue:78 | P0-1 |
| posa_allow_create_purchase_items | WIRED | purchase_orders.py:442 | |
| posa_allow_create_purchase_suppliers | WIRED | purchase_orders.py:252 | |
| posa_allow_credit_sale | WIRED | creation.py `_validate_credit_sale_allowed` | backstop 2026-07-11 |
| posa_allow_customer_purchase_order | CLIENT-ONLY✓ | PaymentPurchaseOrder.vue | metadata only |
| posa_allow_delete | **SUSPECT⚠** | actions.ts:159 / closing invoices.py:101 | P0-4 split-brain |
| posa_allow_delete_cancelled_cash_movement | WIRED | permissions.py:28 | |
| posa_allow_delete_offline_invoice | CLIENT-ONLY✓ | OfflineInvoices.vue:295 | client-domain |
| posa_allow_duplicate_customer_names | WIRED | customers.py:346 | |
| posa_allow_free_batch_return | WIRED | stock.py:206 | |
| posa_allow_line_item_name_override | CLIENT-ONLY⚠ | CartItemRow.vue:50 | P0-6 |
| posa_allow_make_new_payments | WIRED | processor.py:266 | |
| posa_allow_mpesa_reconcile_payments | WIRED | processor.py:268 | |
| posa_allow_multi_currency | WIRED | item_fetchers.py:613 | |
| posa_allow_offline_sale_without_stock_verification | CLIENT-ONLY✓ | offline/invoices.ts:75 | server re-validates at sync |
| posa_allow_partial_payment | WIRED | creation.py:482 | |
| posa_allow_pos_expense | WIRED | permissions.py:16 | |
| posa_allow_price_list_rate_change | CLIENT-ONLY (mitigated) | ItemsTableExpandedRow.vue:155 | server band uses master price |
| posa_allow_print_draft_invoices | CLIENT-ONLY✓ | useInvoicePrinting.ts:30 | |
| posa_allow_print_last_invoice | CLIENT-ONLY✓ | NavbarMenu.vue:423 | endpoint owner-scoped |
| posa_allow_purchase_order | WIRED | purchase_orders.py:607 | |
| posa_allow_purchase_receipt | WIRED | purchase_orders.py:611 | |
| posa_allow_reconcile_payments | WIRED | processor.py:267 | |
| posa_allow_return | **CLIENT-ONLY⚠** | InvoiceManagement.vue:312 | P0-2 |
| posa_allow_return_without_invoice | WIRED | stock.py:201 | |
| posa_allow_sales_order | WIRED | invoice.py:157 | |
| posa_allow_select_print_format_in_payments | CLIENT-ONLY✓ | Payments.vue:230 | |
| posa_allow_submissions_in_background_job | WIRED | creation.py:1419 | |
| posa_allow_supervisor_manage_gift_cards | **DEAD** | — | role gate superseded |
| posa_allow_user_to_edit_additional_discount | CLIENT-ONLY (mitigated) | Pos.vue:138 | discount cap backs it |
| posa_allow_user_to_edit_item_discount | CLIENT-ONLY (mitigated) | CartItemRow.vue:537 | |
| posa_allow_user_to_edit_rate | WIRED | _reprice.py:223 | rate band |
| posa_allow_write_off_change | CLIENT-ONLY (mitigated) | PaymentOptions.vue:18 | write_off_limit clamps |
| posa_allow_zero_rated_items | **DEAD** | — | |
| posa_apply_customer_discount | **DEAD** | — | |
| posa_auto_set_batch | WIRED (client) | useItemAddition.ts:287 | BE site commented out |
| posa_auto_set_delivery_charges | WIRED | invoice.py:241 | |
| posa_back_office_cash_account | WIRED | cash_movement/validation.py:150 | |
| posa_block_sale_beyond_available_qty | WIRED | stock.py:63 | |
| posa_camera_scan_type | CLIENT-ONLY✓ | ItemsSelector.vue:176 | |
| posa_cash_mode_of_payment | WIRED | overview.py:84 | |
| posa_cash_movement_max_amount | WIRED | validation.py:48 | |
| posa_create_only_sales_order | CLIENT-ONLY✓ | invoiceService.ts:12 | |
| posa_decimal_precision | CLIENT-ONLY✓ | format.ts:219 | |

### Second half (posa_default_card_view → use_customer_credit + saldo)

| field | verdict | consumer | note |
|---|---|---|---|
| posa_default_card_view | **DEAD** | — | |
| posa_default_country | WIRED (client) | UpdateCustomer.vue | |
| posa_default_expense_account | WIRED | cash_movement | |
| posa_default_sales_order | CLIENT-ONLY✓ | useItemAddition.ts | |
| posa_display_additional_notes | CLIENT-ONLY✓ | PaymentAdditionalInfo.vue | |
| posa_display_authorization_code | CLIENT-ONLY✓ | PaymentAdditionalInfo.vue | |
| posa_display_discount_amount | CLIENT-ONLY✓ | useInvoiceItems.ts | |
| posa_display_discount_percentage | CLIENT-ONLY✓ | useInvoiceItems.ts | |
| posa_display_item_code | CLIENT-ONLY✓ | itemsTableHeaders.ts | |
| posa_display_items_in_stock | WIRED | items.py/search.py | |
| posa_enable_camera_scanning | CLIENT-ONLY✓ | ItemsSelector.vue | |
| posa_enable_cash_movement | WIRED | cash_movement | |
| posa_enable_return_validity | WIRED | invoice_processing/utils.py | |
| posa_fetch_coupon | **DEAD** | — | |
| posa_force_price_from_customer_price_list | CLIENT-ONLY (mitigated) | item_updates.ts | band caps |
| posa_force_reload_items | WIRED | search.py | |
| posa_force_server_items | CLIENT-ONLY✓ | useItemsSelectorSettings.ts | |
| posa_gift_card_liability_account | WIRED | gift_cards.py:96 | |
| posa_hide_closing_shift | CLIENT-ONLY✓ | NavbarMenu.vue | |
| posa_hide_variants_items | WIRED | items.py/search.py | |
| posa_input_qty | CLIENT-ONLY✓ | ItemHeader.vue | |
| posa_language | WIRED | shifts.py:187 | |
| posa_local_storage | CLIENT-ONLY✓ | useOffers.ts | |
| posa_max_discount_allowed | WIRED | _reprice.py | server money cap ✓ |
| posa_new_line | CLIENT-ONLY✓ | ItemsSelector.vue | |
| posa_open_print_in_new_tab | CLIENT-ONLY✓ | usePaymentPrinting.ts | |
| posa_print_format_rules | CLIENT-ONLY✓ | paymentPrintFormat.ts | |
| posa_require_cash_movement_remarks | WIRED | cash_movement | |
| posa_return_validity_days | WIRED | invoice_processing/utils.py | |
| posa_sales_persons | WIRED | api/utils.py | |
| posa_search_batch_no | WIRED | search.py | |
| posa_search_limit | WIRED | cache_warmer.py | |
| posa_search_serial_no | WIRED | search.py | |
| posa_server_cache_duration | WIRED | cache_warmer.py | |
| posa_show_custom_name_marker_on_print | CLIENT-ONLY✓ | offline_print_template.ts | |
| posa_show_customer_balance | CLIENT-ONLY✓ | PostingDateRow.vue:33 | odd home |
| posa_show_template_items | WIRED | items.py ×8 | |
| posa_silent_print | CLIENT-ONLY✓ | print pipeline ×8 | |
| posa_smart_reload_mode | **DEAD** | — | |
| posa_tax_inclusive | WIRED | utilities.py + creation.py | prod-verified |
| posa_use_delivery_charges | CLIENT-ONLY⚠ | DeliveryCharges.vue | P0-7 |
| posa_use_gift_cards | **CLIENT-ONLY⚠** | Navbar.vue, Payments.vue | P0-3 |
| posa_use_percentage_discount | CLIENT-ONLY (mitigated) | ×25 | cap backs it |
| posa_use_pos_awesome_payments | WIRED | processor.py | |
| posa_use_server_cache | WIRED | cache_warmer.py ×8 | |
| posa_use_web_route | WIRED (server) | utilities.py | |
| pose_use_limit_search | CLIENT-ONLY (typo) | itemsStore.ts +5 | P2 rename |
| use_cashback | CLIENT-ONLY✓ | PaymentOptions.vue | |
| use_customer_credit | **SUSPECT⚠** | PaymentOptions.vue:50 + usePaymentMethods.ts:213 | P0-5 client mutation |
| saldo_enabled | WIRED | saldo hooks both directions | ✓ |

## Suggested execution order

1. P0 wave 1 (posting-date, returns, delete flag) — one commit each, tests
   in test_document_flows pattern.
2. P0 wave 2 (gift-cards feature gate + PKR default, customer-credit gate +
   M-Pesa decision — needs Marco's call on the M-Pesa exception).
3. P1 dead-field removal batch (fixture + patch).
4. P2 documentation/warts.
