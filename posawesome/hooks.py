app_name = "posawesome"
app_title = "POS Awesome"
app_publisher = "defendicon"
app_description = "POS Awesome"
app_icon = "octicon octicon-file-directory"
app_color = "grey"
app_email = "defendicon@github.com"
app_license = "GPLv3"
app_url = "https://github.com/defendicon/POS-Awesome-V15"
app_source_link = "https://github.com/defendicon/POS-Awesome-V15"
source_link = "https://github.com/defendicon/POS-Awesome-V15"

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# POS assets are loaded on-demand from the POS page bootstrap so the Desk shell
# does not retain stale bundles across bench builds.
app_include_js = []
app_include_css = []

# ------------------
# Website route rules
# ------------------
# SPA history-mode fallback. The web-route module `www/posapp.py` only
# claims the exact path `/posapp`. Vue Router uses `createWebHistory`
# (see `frontend/src/posapp/router/index.ts`), which means refreshes /
# direct hits on client-side routes like `/posapp/app`, `/posapp/pos`,
# `/posapp/sales-orders`, etc. would 404 against Frappe's web router.
# Route every `/posapp/<rest>` back to the `posapp` template so the
# SPA can resolve the path client-side on first paint.
website_route_rules = [
	{"from_route": "/posapp/<path:rest>", "to_route": "posapp"},
]

# include js, css files in header of web template
# web_include_css = "/assets/posawesome/css/posawesome.css"
# web_include_js = "/assets/posawesome/js/posawesome.js"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
    "POS Profile": "posawesome/api/pos_profile.js",
    "Sales Invoice": "posawesome/api/invoice.js",
    "Company": "posawesome/api/company.js",
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Website user home page (by function)
# get_website_user_home_page = "posawesome.utils.get_home_page"

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Installation
# ------------

# before_install = "posawesome.install.before_install"
# after_install = "posawesome.install.after_install"
# before_uninstall = "posawesome.uninstall.before_uninstall"
after_uninstall = "posawesome.uninstall.after_uninstall"
after_migrate = [
    "posawesome.patches.add_pos_cash_movement_settings.execute",
    "posawesome.patches.add_cash_movement_to_workspace.execute",
    "posawesome.patches.add_safe_transfer_settings.execute",
    "posawesome.patches.add_customer_display_settings.execute",
    "posawesome.patches.add_dashboard_settings.execute",
    "posawesome.patches.add_dashboard_global_settings.execute",
    "posawesome.patches.reorganize_pos_profile_sections.execute",
    "posawesome.patches.add_gift_card_pos_profile_settings.execute",
    "posawesome.patches.add_customer_card_pos_profile_settings.execute",
    "posawesome.patches.add_rate_band_controls.execute",
    "posawesome.patches.add_gift_card_invoice_redemption_fields.execute",
    "posawesome.patches.add_gift_card_to_workspace.execute",
    "posawesome.patches.add_submission_ledger_to_workspace.execute",
    "posawesome.patches.migrate_pos_supervisor_to_role.execute",
    "posawesome.patches.remove_item_barcode_posa_uom.execute",
]

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "posawesome.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
    "Sales Invoice": {
        "validate": "posawesome.posawesome.api.invoice.validate",
        "before_submit": "posawesome.posawesome.api.invoice.before_submit",
        # Queues a CRM note about the sale and returns — it never writes on the
        # submit path. Absent a CRM it is one `installed_apps` check and out;
        # see `crm_bridge.on_sales_invoice_submit` for why after_commit and why
        # it never creates a record.
        "on_submit": "posawesome.posawesome.api.crm_bridge.on_sales_invoice_submit",
        "before_cancel": "posawesome.posawesome.api.invoice.before_cancel",
        "on_cancel": "posawesome.posawesome.api.invoice.on_cancel",
    },
    "POS Invoice": {
        "validate": "posawesome.posawesome.api.invoice.validate",
        "before_submit": "posawesome.posawesome.api.invoice.before_submit",
        "on_submit": "posawesome.posawesome.api.crm_bridge.on_sales_invoice_submit",
        "before_cancel": "posawesome.posawesome.api.invoice.before_cancel",
        "on_cancel": "posawesome.posawesome.api.invoice.on_cancel",
    },
    "Customer": {
        "validate": "posawesome.posawesome.api.customer.validate",
        "after_insert": "posawesome.posawesome.api.customer.after_insert",
    },
    # Item photos arrive at camera resolution and render into a 132px card
    # slot. Both handlers are fail-open — a thumbnail is an optimisation, so
    # they never block the write that triggered them.
    "Item": {
        "on_update": "posawesome.posawesome.api.item_processing.thumbnails.on_item_update",
    },
    "File": {
        "after_insert": "posawesome.posawesome.api.item_processing.thumbnails.on_file_insert",
    },
    "Bin": {
        "after_insert": [
            "posawesome.posawesome.stock_realtime.publish_bin_stock_change",
            "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
        ],
        "on_update": [
            "posawesome.posawesome.stock_realtime.publish_bin_stock_change",
            "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
        ],
    },
    "Stock Ledger Entry": {
        "after_insert": "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
        "on_cancel": "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
    },
    "Serial No": {
        "after_insert": "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
        "on_update": "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
    },
    "Batch": {
        "after_insert": "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
        "on_update": "posawesome.posawesome.api.item_fetchers.clear_stock_caches",
    },
    # Phase 6: bust the Redis cache for `get_active_pricing_rules`
    # whenever a rule is written, renamed, or deleted. Cheap (one
    # namespace flush); operator sees rule changes on the next POS
    # call instead of waiting for the 5-min TTL.
    "Pricing Rule": {
        "on_update": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
        "on_trash": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
        "after_rename": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
    },
    "Pricing Rule Item Code": {
        "on_update": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
        "on_trash": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
    },
    "Pricing Rule Item Group": {
        "on_update": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
        "on_trash": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
    },
    "Pricing Rule Brand": {
        "on_update": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
        "on_trash": "posawesome.posawesome.api.pricing_rules.invalidate_pricing_rules_cache",
    },
}

# Scheduled Tasks
# ---------------

scheduler_events = {
    "daily": [
        # Prune browser RUM events older than 30 days.
        # Telemetry is keep-it-cheap; we don't need historical retention
        # beyond the rolling window the dashboard reads from.
        "posawesome.posawesome.api.telemetry.prune_old_events",
        # Prune final-state submission-ledger rows older than 45 days
        # (2-3 invoice JSON copies per sale, was unbounded). Non-final
        # rows are the repair trail and are kept.
        "posawesome.posawesome.api.invoice_processing.creation.prune_submission_ledger",
        # Surface the rows that prune deliberately keeps: non-final ledger
        # rows past their repair grace window (SUBMITTED = invoice live,
        # post-submit money work missing). Gauge + grouped Error Log;
        # recovery stays operator-triggered via repair_invoice_submission.
        "posawesome.posawesome.api.invoice_processing.ledger_sweep.sweep_stuck_submission_ledger",
    ],
    "cron": {
        # Keep the get_items page cache warm. The server cache TTL is
        # posa_server_cache_duration minutes (30 on the doco profiles); re-walk
        # every 25 min so the live cache never lapses between operator loads.
        # Cold non-reset walk ~371 ms/page vs ~70 ms/page warm (5.3x). Cheap:
        # ~2.6 s per cache-enabled profile per run. See cache_warmer docstring.
        "*/25 * * * *": [
            "posawesome.posawesome.api.cache_warmer.prewarm_pos_item_cache",
        ],
    },
}

# Testing
# -------

# before_tests = "posawesome.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "posawesome.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "posawesome.task.get_dashboard_data"
# }

# Override standard DocTypes with custom classes
override_doctype_class = {
    "POS Invoice": "posawesome.posawesome.overrides.pos_invoice.CustomPOSInvoice",
    "POS Invoice Merge Log": "posawesome.posawesome.overrides.pos_invoice_merge_log.CustomPOSInvoiceMergeLog",
}

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                (
                    "Sales Invoice-posa_pos_opening_shift",
                    "POS Invoice-posa_pos_opening_shift",
                    "Sales Invoice-posa_rt_tab_name",
                    "POS Invoice-posa_rt_tab_name",
                    "Sales Invoice-posa_rt_guest_count",
                    "POS Invoice-posa_rt_guest_count",
                    "Sales Invoice-posa_rt_service_type",
                    "POS Invoice-posa_rt_service_type",
                    # Restaurant provenance on the SETTLED document — the open
                    # ticket is a POS Table Order, never a draft invoice.
                    "Sales Invoice-posa_rt_table",
                    "POS Invoice-posa_rt_table",
                    "Sales Invoice-posa_rt_table_order",
                    "POS Invoice-posa_rt_table_order",
                    "Sales Invoice-posa_rt_waiter",
                    "POS Invoice-posa_rt_waiter",
                    "Sales Invoice-posa_rt_tip_amount",
                    "POS Invoice-posa_rt_tip_amount",
                    "POS Profile-posa_pos_awesome_settings",
                    "POS Profile-posa_section_pricing_controls",
                    "POS Profile-posa_section_sales_returns",
                    "POS Profile-posa_section_sales_purchase",
                    "POS Profile-posa_section_inventory_controls",
                    "POS Profile-posa_section_print_delivery",
                    "POS Profile-posa_section_cash_movement",
                    "POS Profile-posa_allow_delete",
                    "POS Profile-posa_allow_user_to_edit_rate",
                    # Rate-band controls (add_rate_band_controls): how far a
                    # typed rate may stray, and the per-SKU / per-category
                    # opt-out for items priced per job.
                    "POS Profile-posa_max_rate_change_pct",
                    "Item-posa_skip_rate_band",
                    "Item Group-posa_skip_rate_band",
                    "POS Profile-posa_allow_user_to_edit_additional_discount",
                    "POS Profile-posa_allow_user_to_edit_item_discount",
                    "POS Profile-posa_display_items_in_stock",
                    "POS Profile-posa_allow_submissions_in_background_job",
                    "POS Profile-posa_allow_partial_payment",
                    "POS Profile-posa_allow_credit_sale",
                    "POS Profile-posa_pos_awesome_advance_settings",
                    "Batch-posa_batch_price",
                    "POS Profile-posa_max_discount_allowed",
                    "POS Profile-posa_allow_return",
                    "POS Profile-posa_allow_return_without_invoice",
                    "POS Profile-posa_allow_free_batch_return",
                    "POS Profile-posa_col_1",
                    "POS Profile-create_pos_invoice_instead_of_sales_invoice",
                    "POS Invoice-posa_is_printed",
                    "Sales Invoice-posa_is_printed",
                    "Sales Invoice Reference-pos_invoice",
                    "POS Profile-posa_local_storage",
                    "POS Profile-posa_force_server_items",
                    "POS Profile-posa_cash_mode_of_payment",
                    "POS Profile-use_customer_credit",
                    "POS Profile-posa_use_gift_cards",
                    "Sales Invoice-gift_card_redemptions",
                    "POS Invoice-gift_card_redemptions",
                    "POS Profile-use_cashback",
                    "POS Profile-posa_hide_closing_shift",
                    "POS Profile-posa_force_close_stale_shift",
                    "Customer-posa_discount",
                    "Sales Invoice-posa_offers",
                    "POS Invoice-posa_offers",
                    "Sales Invoice-posa_coupons",
                    "POS Invoice-posa_coupons",
                    "Sales Invoice Item-posa_offers",
                    "POS Invoice Item-posa_offers",
                    "Sales Invoice Item-posa_row_id",
                    "POS Invoice Item-posa_row_id",
                    "Sales Invoice Item-posa_offer_applied",
                    "POS Invoice Item-posa_offer_applied",
                    "Sales Invoice Item-posa_is_offer",
                    "POS Invoice Item-posa_is_offer",
                    "Sales Invoice Item-posa_is_replace",
                    "POS Invoice Item-posa_is_replace",
                    "POS Profile-posa_auto_set_batch",
                    "POS Profile-posa_search_serial_no",
                    "Sales Invoice-posa_additional_notes_section",
                    "POS Invoice-posa_additional_notes_section",
                    "Sales Invoice-posa_notes",
                    "Sales Invoice-posa_authorization_code",
                    "POS Invoice-posa_notes",
                    "POS Invoice-posa_authorization_code",
                    "Sales Invoice-posa_column_break_111",
                    "POS Invoice-posa_column_break_111",
                    "Sales Invoice-posa_delivery_date",
                    "POS Invoice-posa_delivery_date",
                    "Sales Invoice Item-posa_notes",
                    "POS Invoice Item-posa_notes",
                    "Sales Invoice Item-posa_delivery_date",
                    "POS Invoice Item-posa_delivery_date",
                    "Sales Order-posa_additional_notes_section",
                    "Sales Order-posa_notes",
                    "Sales Order Item-posa_notes",
                    "POS Profile-posa_allow_sales_order",
                    "POS Profile-custom_allow_select_sales_order",
                    "POS Profile-posa_create_only_sales_order",
                    "POS Profile-posa_column_break_112",
                    "POS Profile-posa_show_template_items",
                    "POS Profile-posa_hide_variants_items",
                    "Customer-posa_referral_code",
                    "Company-posa_referral_section",
                    "Company-posa_auto_referral",
                    "Company-posa_column_break_22",
                    "Company-posa_customer_offer",
                    "Company-posa_primary_offer",
                    "Company-posa_referral_campaign",
                    "Customer-posa_referral_company",
                    "Customer-posa_referral_section",
                    "Customer-posa_birthday",
                    "Sales Order-posa_offers",
                    "Sales Order-posa_coupons",
                    "Sales Order Item-posa_row_id",
                    "POS Profile-posa_tax_inclusive",
                    "POS Profile-posa_use_percentage_discount",
                    "POS Profile-posa_allow_customer_purchase_order",
                    "POS Profile-posa_allow_purchase_order",
                    "POS Profile-posa_allow_purchase_receipt",
                    "POS Profile-posa_allow_create_purchase_items",
                    "POS Profile-posa_allow_create_purchase_suppliers",
                    "POS Profile-posa_allow_print_last_invoice",
                    "POS Profile-posa_display_additional_notes",
                    "POS Profile-posa_display_authorization_code",
                    "POS Profile-posa_allow_write_off_change",
                    "POS Profile-posa_new_line",
                    "POS Profile-posa_input_qty",
                    "POS Profile-posa_display_item_code",
                    "POS Profile-posa_allow_print_draft_invoices",
                    "POS Profile-posa_allow_select_print_format_in_payments",
                    "Address-posa_delivery_charges",
                    "Sales Invoice-posa_delivery_charges",
                    "Sales Invoice-posa_delivery_charges_rate",
                    "POS Invoice-posa_delivery_charges",
                    "POS Invoice-posa_delivery_charges_rate",
                    "POS Profile-posa_auto_set_delivery_charges",
                    "POS Profile-posa_use_delivery_charges",
                    "POS Profile-hide_expected_amount",
                    "POS Profile-posa_display_discount_percentage",
                    "POS Profile-posa_display_discount_amount",
                    "POS Profile-posa_allow_change_posting_date",
                    "POS Profile-posa_default_sales_order",
                    "POS Profile-column_break_dqsba",
                    "POS Profile-posa_use_server_cache",
                    "POS Profile-posa_server_cache_duration",
                    "POS Profile-posa_use_web_route",
                    "POS Profile-posa_allow_duplicate_customer_names",
                    "POS Profile-column_break_anyol",
                    "POS Profile-posa_use_limit_search",
                    "POS Profile-posa_search_batch_no",
                    "POS Profile-pos_awesome_payments",
                    "POS Profile-posa_use_pos_awesome_payments",
                    "POS Profile-posa_allow_make_new_payments",
                    "POS Profile-posa_allow_reconcile_payments",
                    "POS Profile-column_break_uolvm",
                    "POS Profile-posa_allow_mpesa_reconcile_payments",
                    "POS Profile-posa_enable_camera_scanning",
                    "POS Profile-posa_camera_scan_type",
                    "POS Profile-posa_language",
                    "POS Profile-posa_enable_return_validity",
                    "POS Profile-posa_return_validity_days",
                    "POS Profile-posa_enable_cash_movement",
                    "POS Profile-posa_allow_pos_expense",
                    "POS Profile-posa_allow_cash_deposit",
                    "POS Profile-posa_default_expense_account",
                    "POS Profile-posa_allowed_expense_accounts",
                    "POS Profile-posa_default_source_account",
                    "POS Profile-posa_allow_source_account_override",
                    "POS Profile-posa_allowed_source_accounts",
                    "POS Profile-posa_back_office_cash_account",
                    "POS Profile-posa_allow_cancel_submitted_cash_movement",
                    "POS Profile-posa_allow_delete_cancelled_cash_movement",
                    "POS Profile-posa_require_cash_movement_remarks",
                    "POS Profile-posa_cash_movement_max_amount",
                    "POS Profile-posa_enable_safe_transfer",
                    "POS Profile-posa_bank_deposit_account",
                    "POS Profile-posa_safe_transfer_max_amount",
                    "POS Profile-posa_section_awesome_dashboard",
                    "POS Profile-posa_enable_awesome_dashboard",
                    "POS Profile-posa_allow_company_dashboard_scope",
                    "POS Profile-posa_low_stock_alert_threshold",
                    "POS Settings-posa_enable_return_validity",
                    "POS Settings-posa_return_validity_days",
                    "POS Settings-posa_section_dashboard",
                    "POS Settings-posa_enable_awesome_dashboard_global",
                    "POS Settings-posa_dashboard_default_scope",
                    "POS Settings-posa_dashboard_low_stock_alert_threshold",
                    "POS Invoice-posa_return_valid_upto",
                    "Sales Invoice-posa_return_valid_upto",
                    "User-posa_pos_pin",
                    # Fields below were historically created only by patch
                    # scripts and never exported — invisible to fixture
                    # delivery (vertical-profiles plan C8). Keep every
                    # patch-created Custom Field listed here; CI enforces it
                    # (scripts/check_fixture_coverage.py).
                    "POS Profile-posa_hide_items_until_search",
                    "POS Profile-posa_ux_keymap_id",
                    "POS Profile-posa_lean_vertical_layout",
                    "POS Profile-posa_section_customer_display",
                    "POS Profile-posa_enable_customer_display",
                    "POS Profile-posa_auto_open_customer_display",
                    "POS Profile-posa_closing_shift_print_format",
                    "POS Profile-posa_use_charge_requests",
                    "POS Profile-posa_qz_printer_name",
                    "POS Profile-posa_qz_density",
                    "POS Profile-posa_qz_interpolation",
                    "POS Profile-posa_qz_cut_after_print",
                    "POS Profile-posa_scale_barcode_start",
                    "POS Invoice-posa_redeemed_customer_credit",
                    "POS Invoice-posa_remaining_customer_credit_balance",
                    "Sales Invoice-posa_redeemed_customer_credit",
                    "Sales Invoice-posa_remaining_customer_credit_balance",
                    # Merged from a former SECOND "Custom Field" fixtures
                    # entry: frappe writes one file per doctype, so a second
                    # entry for the same doctype OVERWRITES the first's
                    # export (custom_field.json shrank to 2 records). Never
                    # add another Custom Field entry to this list.
                    "POS Profile-posa_allow_multi_currency",
                    "POS Profile-posa_decimal_precision",
                    "POS Profile-posa_gift_card_liability_account",
                    "POS Profile-posa_sales_persons",
                    "POS Profile-posa_capability_profile",
                    # Present in the pre-2026-08-09 fixture file but never in
                    # this list — an export against any site would silently
                    # drop them (and did). Several are live prod behaviour
                    # (client_request_id idempotency, the stock clamp).
                    "POS Invoice-posa_client_request_id",
                    "Sales Invoice-posa_client_request_id",
                    "Payment Entry-posa_client_request_id",
                    "Sales Invoice Item-name_overridden",
                    "POS Profile-custom_allow_create_quotation",
                    "POS Profile-posa_allow_delete_offline_invoice",
                    "POS Profile-posa_allow_line_item_name_override",
                    "POS Profile-posa_allow_offline_sale_without_stock_verification",
                    "POS Profile-posa_allow_price_list_rate_change",
                    "POS Profile-posa_block_sale_beyond_available_qty",
                    "POS Profile-posa_default_country",
                    "POS Profile-posa_force_price_from_customer_price_list",
                    "POS Profile-posa_force_reload_items",
                    "POS Profile-posa_open_print_in_new_tab",
                    "POS Profile-posa_print_format_rules",
                    "POS Profile-posa_search_limit",
                    "POS Profile-posa_show_custom_name_marker_on_print",
                    "POS Profile-posa_show_customer_balance",
                    "POS Profile-posa_silent_print",
                    "POS Profile-posa_tab",
                    # CFDI-POS glue (posa_cfdi_ prefix — see
                    # scripts/check_fixture_coverage.py VERTICAL_PREFIXES).
                    "POS Profile-posa_cfdi_enable_stamping",
                ),
            ]
        ],
    },
    {
        "doctype": "Role",
        "filters": [["name", "in", ("POS Awesome Supervisor",)]],
    },
    {
        "doctype": "Property Setter",
        "filters": [
            [
                "name",
                "in",
                (
                    "Sales Invoice-posa_pos_opening_shift-no_copy",
                    "POS Invoice-posa_pos_opening_shift-no_copy",
                    "Sales Invoice Reference-sales_invoice-reqd",
                    "Sales Invoice-update_outstanding_for_self-default",
                ),
            ]
        ],
    },
]
