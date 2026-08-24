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
| 5 ✅ | `use_customer_credit` | UI gate only AND M-Pesa flow force-mutates it client-side (`usePaymentMethods.ts:213 profile.use_customer_credit = true`) to bypass its own gate; redemption AMOUNTS are server-validated vs real advances, the feature gate is fiction | profile check in the customer-credit redemption path; decide the M-Pesa exception server-side |
| 6 ✅ | `posa_allow_line_item_name_override` | `_apply_item_name_overrides` applies client name overrides unconditionally — receipt-text tampering (low) | gate on flag |
| 7 ✅ | `posa_use_delivery_charges` | server accepts delivery-charge rows regardless (payment invariant limits theft to mislabeling) | flag check when rows present (low) |

Mitigated-by-design (no action): rate/discount edit flags (server rate band
±20% + `posa_max_discount_allowed` cap + write_off_limit clamp back them),
print/display prefs, offline flags (server re-validates at sync).

That rate-band claim was false between 23ca94e6 (2026-05-25) and the entry
below: the band was disabled outright whenever the profile allowed rate
edits, so `posa_allow_user_to_edit_rate` was a full bypass rather than a
mitigated flag. It is true again as of 2026-08-23.

## P1 — DEAD fields ✅ REMOVED 2026-07-11 (remove_dead_pos_profile_fields patch)

`posa_allow_supervisor_manage_gift_cards` (superseded by role gate),
`posa_allow_zero_rated_items`, `posa_apply_customer_discount`,
`posa_default_card_view`, `posa_fetch_coupon`, `posa_smart_reload_mode`.
Removal = fixture churn + patch; batch them in one cleanup commit.

## P2 — warts ✅ CLOSED 2026-07-12

- ✅ `pose_use_limit_search` → RENAMED `posa_use_limit_search`
  (`rename_pose_use_limit_search` patch: column rename preserves values,
  CF row renamed in place before fixture sync). SPA reads keep a
  `?? pose_use_limit_search` fallback for cached offline profiles.
- ✅ `posa_auto_set_batch` — dead commented call site deleted; client-driven
  (useItemAddition.ts) confirmed as the intended design.
- ✅ `posa_show_customer_balance` in PostingDateRow.vue — documented as
  deliberate: balance renders next to the price-list/posting controls where
  the cashier picks the customer context. No code change.
- ✅ `custom_allow_create_quotation` / `custom_allow_select_sales_order` —
  server gates added via `_scope.assert_profile_feature` (strict when the
  caller names a profile, any-assigned-profile fallback for stale clients):
  quotations.py (search/update/submit — which also had NO scope assert at
  all, now has `assert_company`), sales_orders.search_orders (+ missing
  `assert_company`), invoices.create_sales_invoice_from_order, and
  commercial_flow prepare/commit (+ company scope on source doc). SPA
  threads `pos_profile` through all these calls. Prod values verified
  before gating: select-SO ON everywhere (no behavior change), quotation
  OFF everywhere (UI already hid it).

## Added 2026-08-23 — tarjeta de cliente

Two fields, added by `add_customer_card_pos_profile_settings` (after_migrate,
beside the gift-card pair). They are WIRED from the first commit — the P0-3
lesson applied before it could be repeated, not after.

| field | type | gate it performs |
|---|---|---|
| `posa_use_customer_cards` | Check | `stored_value._require_customer_cards_enabled` refuses `deposit_stored_value` and `enroll_customer_card` when off. The SPA hides the wallet card and the Cobro accrual line on the same flag, but the server never trusts that. |
| `posa_customer_card_program` | Link → Loyalty Program | The programme `enroll_customer_card` writes to `Customer.loyalty_program`. Empty ⇒ enrolment refuses and says so; a programme whose `company` differs from the profile's is refused at enrolment rather than at Cobro, where ERPNext would throw "The Loyalty Program isn't valid for the selected company". |

Neither gate is bypassed by a System Manager the way `_scope`'s tenant
asserts are: flag, register roster (`_ensure_terminal_user`) and an OPEN
shift are checked for every acting user. A deposit also carries the open
shift's name in `Payment Entry.reference_no`, which is the key
`closing_processing/data.get_payments_entries` filters on — that, and only
that, is what puts a cash deposit into the shift's expected cash.

## Added 2026-08-23 — rate band

One field, added by `add_rate_band_controls` (after_migrate, beside
`posa_allow_user_to_edit_rate`). It reopens the ±band cap that 23ca94e6
switched off, and it only means anything on a register that allows rate
edits at all — hence the `depends_on`.

| field | type | gate it performs |
|---|---|---|
| `posa_max_rate_change_pct` | Percent | Half-width of the band `_reprice.assert_rates_within_band` enforces on a rate-edit-enabled register: the pre-discount price a line asserts must land within ±this much of the Item Price, or submit throws `PermissionError` → HTTP 403. |

Semantics worth knowing before you touch the number:

- **Blank or 0 means "not configured" and falls back to 20**, not "no
  deviation allowed". The patch's `default: 20` does reach existing rows
  (verified on doco-mirror), but the column underneath is `NOT NULL
  DEFAULT 0`, so 0 is what you read when the field is cleared by hand or
  written around the meta. Treating that as a zero-width band would
  refuse every rate edit on that till — a silent outage produced by an
  absent value.
- **A negative value (-1) is the per-register kill switch** and restores
  the 23ca94e6 full-bypass behaviour for that register alone. No column
  default can reach a negative by accident, which is why the escape
  hatch lives there rather than on 0.
- The band never touches a register whose `posa_allow_user_to_edit_rate`
  is OFF — that branch still demands an exact price-list match, and a
  wide band must not become a licence to retype prices.

The per-SKU escape hatch is NOT on the profile: `posa_skip_rate_band` on
**Item** and on **Item Group** (same patch) exempts variable-price
SKUs — labour quoted per job, "cambiar pantalla" at 400 against a 150
list entry — which is what broke prod in May and forced the blunt
profile-wide disable. Flagging an Item Group covers a whole category
("Servicio Técnico") in one row. The patch also flags the `PROPINA` tip
item, whose rate is by definition whatever the customer left.

Discount size is deliberately NOT re-gated here: a line's declared
discount is `enforce_discount_limit`'s business, so the band judges the
pre-discount price and an offer-discounted line passes on its merits.

## Added 2026-08-23 — venta fraccionada (labelling-scale labels)

One field, added by `add_embedded_barcode_scheme` (after_migrate, ordered
BEFORE `reorganize_pos_profile_sections` so the reorganizer can anchor it —
`_set_insert_after` silently skips a field that does not exist yet, which on a
fresh install would leave the knob unanchored until the next migrate).

| field | type | what it decides |
|---|---|---|
| `posa_gr_embedded_barcode_scheme` | Select (blank / `weight` / `price`) | What the five measurement digits on an EAN-13 prefix 20–25 label MEAN. `weight` reads them as grams (`00312` = 0.312 kg); `price` reads them as centavos (`04992` = $49.92) and derives the qty against the item's rate. Blank = this register has no labelling scale, and a 20–25 code stays an ordinary barcode. |

Things worth knowing before you touch it:

- **The prefix range 20–25 is FIXED and deliberately not configurable.** It is
  GS1's reserved band for restricted circulation inside one company, which is
  the only reason a scale may mint thousands of these codes. A scale printing
  outside it is colliding with real GS1 assignments, and the fix is the scale's
  settings, not a POS Profile knob.
- **There is no auto-detect and there must not be.** `00312` is 0.312 kg under
  one scheme and $3.12 under the other; a register that sniffed would mis-charge
  by two orders of magnitude on a label it read perfectly.
- **The field is a prefixed name (`posa_gr_`, granel).**
  `scripts/check_fixture_coverage.py` requires a per-vertical prefix on every new
  Custom Field, and this round added `posa_gr_` to its `VERTICAL_PREFIXES` — the
  giros that weigh (abarrotes, carnicería, ferretería a granel).
- **It replaces `posa_scale_barcode_start`**, which the same patch DELETES. That
  Int shipped in the 2020 upstream fixture and never had a reader on either side
  of the wire — an operator could type any number into it and change nothing.
  (LEGACY-FIELD-INVENTORY §5.5 slated it; this closes it.)

The `fractional` capability token is a separate gate and governs the CART
affordances (the decimal pad, «$ Importe», tara) rather than the scan path. A
register may declare a scheme without the token: its scale labels resolve, its
cashiers simply do not get the pad.

### The precision precondition, which is not optional

`Sales Invoice Item.qty` is a plain Float with no field-level precision, so it
is stored at **System Settings → float_precision**. On the doco mirror that is
**2**, and a line saved as 0.312 kg comes back 0.31 kg charging $49.60 — not the
$49.92 the golden flow quotes. Verified live, pinned by
`test_fractional_backstop.test_the_site_keeps_only_float_precision_decimals_of_qty`.

So gram-precision selling needs `float_precision` (or the register's
`posa_decimal_precision`) set to **3**. Where it is not, nothing breaks: the pad,
the «se cobran» sentence and the scan path all derive from the register's
effective precision and quote 0.31, so the ticket and the invoice agree. What
must never happen is the register promising a third decimal the books will not
keep.

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
| posa_allow_user_to_edit_rate | WIRED | _reprice.py:assert_rates_within_band | gates rate editing; width is posa_max_rate_change_pct |
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
| posa_max_rate_change_pct | WIRED | _reprice.py:assert_rates_within_band | band half-width; 0 = default 20, negative = off |
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
| posa_customer_card_program | WIRED | stored_value.py:enroll_customer_card | Link → Loyalty Program; the register's cashback programme |
| posa_use_customer_cards | WIRED | stored_value.py ×3 gates | gate for deposit/enrol/wallet, server-side from day one |
| posa_use_delivery_charges | CLIENT-ONLY⚠ | DeliveryCharges.vue | P0-7 |
| posa_use_gift_cards | **CLIENT-ONLY⚠** | Navbar.vue, Payments.vue | P0-3 |
| posa_use_percentage_discount | CLIENT-ONLY (mitigated) | ×25 | cap backs it |
| posa_use_pos_awesome_payments | WIRED | processor.py | |
| posa_use_server_cache | WIRED | cache_warmer.py ×8 | |
| posa_use_web_route | WIRED (server) | utilities.py + www/posapp.py | opt-OUT, default 1 (2026-07-24) |
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
